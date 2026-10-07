import type { ChildQuerySnapshots } from './childQueries.js';
import {
    createMiniExtensionsClient,
    AirtableFieldType,
    SDKError,
    withExtensionPassword,
    withLoginToken,
    type FormLoadedResult,
    type LoadExtensionInput,
    type LoadExtensionResult,
    type LoginPageResult,
    type MiniExtensionsClient,
    type PortalLoadedResult,
    type RuntimeSession,
    type SaveFormInput,
    type AirtableValue,
    type RuntimeQuery,
    type RuntimeTableStates,
    type ListLinkedRecordOptionsResult,
} from '@miniextensions/sdk';
import {
    shouldMaskLoginFieldInput,
    getLoginVerificationDestination,
} from '@miniextensions/sdk/auth';
import {
    composeFormFieldVisibility,
    createFormSaveInput,
    normalizeFormSaveResult,
    openLoadedFormDraft,
    type FormFieldVisibility,
} from '@miniextensions/sdk/forms';
import {
    getSelectFieldPolicy,
    resolveSelectFieldAvailability,
} from '@miniextensions/sdk/ui';
import {
    button,
    element,
    inputById,
    labeled,
    nodeById,
    settings,
} from './dom.js';
import { displayValue, formFieldControl, type FieldControl } from './fields.js';
import { flatChoiceConditionRecord } from './choiceAvailability.js';
import { createPortalView, type PortalView } from './portal.js';
import {
    createConditionalLinkedFilters,
    type ConditionalLinkedFilters,
} from './linkedFilters.js';
import {
    FormDraftStore,
    type FormDraftSnapshot,
    type ParentFormDraftScope,
} from './drafts.js';
import { prepareFormReviewRows } from './review.js';
import { createPendingFiles } from './pendingFiles.js';
import { formAttachmentControl } from './attachmentPresentation.js';
import {
    admittedAttachmentValues,
    appendedAttachmentValues,
} from './attachmentUpload.js';
import { createLinkedReviewPresentation } from './linkedReview.js';
import {
    RecoveryJournal,
    recoveryOwner,
    sameRecoveryRelationship,
    type RecoveryScope,
    type RecoveryAttempt,
} from './recovery.js';
import {
    cancelConfirmation,
    requestConfirmation,
    type ConfirmationOptions,
} from './confirmation.js';

type Visitor = {
    client: MiniExtensionsClient | null;
    screen: LoadExtensionResult | null;
    root: PortalLoadedResult | null;
    portal: PortalView | null;
    revision: number;
    formLoadVersion: number;
    recoveryCandidate: RecoveryAttempt | null;
    preparedAttempt: RecoveryAttempt | null;
    formAuthority: (() => boolean) | null;
    formContext: SaveFormInput['context'];
    formParentScope: ParentFormDraftScope | null;
    formQueries:
        | (ChildQuerySnapshots & {
              page: FormLoadedResult;
              loadVersion: number;
          })
        | null;
    drafts: FormDraftStore<AirtableValue>;
    uncertainFormDraftScopes: Set<string>;
    verification: { loginPage: LoginPageResult; verificationId: string } | null;
};
const newVisitor = (): Visitor => ({
    client: null,
    screen: null,
    root: null,
    portal: null,
    revision: 0,
    formLoadVersion: 0,
    recoveryCandidate: null,
    preparedAttempt: null,
    formAuthority: null,
    formContext: { type: 'direct-url' },
    formParentScope: null,
    formQueries: null,
    drafts: new FormDraftStore<AirtableValue>(),
    uncertainFormDraftScopes: new Set(),
    verification: null,
});
const visitors = { A: newVisitor(), B: newVisitor() };
let activeVisitor: keyof typeof visitors = 'A';
const recovery = new RecoveryJournal();
let formLoadSequence = 0;
let connection: {
    apiOrigin: string;
    input: Extract<LoadExtensionInput, { shareId: string }>;
} | null = null;
let request: AbortController | null = null;
let disposeFormControls = (): void => {};
let updateFormActivity = (): void => {};
const sessionKey = (client: MiniExtensionsClient): string =>
    JSON.stringify(
        Object.entries(client.getSession()).sort(([a], [b]) =>
            a.localeCompare(b)
        )
    );
// Only direct/root Form prefills enter this example's connection query.
const currentConditionalPrefills = (): RuntimeQuery => {
    const query: RuntimeQuery = {};
    for (const [key, value] of new URLSearchParams(location.search)) {
        if (!key.startsWith('prefill_')) continue;
        const previous = query[key];
        if (typeof previous === 'string') query[key] = [previous, value];
        else if (Array.isArray(previous)) previous.push(value);
        else query[key] = value;
    }
    for (const value of Object.values(query))
        if (Array.isArray(value)) Object.freeze(value);
    return Object.freeze(query);
};
const screenNode = nodeById('screen');
const statusNode = nodeById('status');
const connectionForm = nodeById('connection-form');
const visitorSelect = nodeById('visitor');
if (!(visitorSelect instanceof HTMLSelectElement))
    throw new Error('Missing visitor selector.');

const formRecoveryScope = (
    visitor: Visitor,
    page: FormLoadedResult
): RecoveryScope => {
    const parentFieldId = visitor.formParentScope?.portalFieldId ?? null;
    const parentField =
        parentFieldId == null
            ? undefined
            : visitor.root?.payload.fieldIdsToSchemas[parentFieldId]
                  ?.airtableField;
    return {
        owner:
            visitor.root != null && connection != null
                ? recoveryOwner(
                      connection.apiOrigin,
                      connection.input.shareId,
                      visitor.root
                  )
                : JSON.stringify([
                      'standalone',
                      activeVisitor,
                      connection == null
                          ? null
                          : new URL(connection.apiOrigin).origin,
                      connection?.input.shareId,
                  ]),
        parentFieldId,
        tableId:
            parentField?.config.type === AirtableFieldType.MULTIPLE_RECORD_LINKS
                ? parentField.config.options.linkedTableId
                : page.payload.formRecord.type === 'edit'
                  ? page.payload.formRecord.tableId
                  : null,
        childExtensionId: page.extensionId,
        context: visitor.formContext.type,
    };
};
const status = (message: string, error = false): void => {
    statusNode.textContent = message;
    statusNode.classList.toggle('error', error);
};
const setBusy = (busy: boolean): void => {
    screenNode.inert = busy;
    connectionForm.inert = busy;
    updateFormActivity();
    screenNode.setAttribute('aria-busy', String(busy));
    for (const id of ['reload', 'logout', 'cancel']) {
        const node = nodeById(id);
        if (node instanceof HTMLButtonElement) {
            node.disabled =
                id === 'cancel' ? !busy : busy || connection == null;
        }
    }
};
const sessionSummary = (): void => {
    const visitor = visitors[activeVisitor];
    const count = Object.keys(visitor.client?.getSession() ?? {}).length;
    nodeById('session-summary').textContent =
        connection == null
            ? 'Not connected'
            : `Visitor ${activeVisitor} · ${count === 0 ? 'Anonymous' : 'Authenticated session'} · memory only`;
};

/** Every response must still belong to its visitor, session and connection. */
const run = async (
    description: string,
    action: (context: {
        visitor: Visitor;
        client: MiniExtensionsClient;
        signal: AbortSignal;
        current(): boolean;
    }) => Promise<void>,
    ownsUI: () => boolean = () => true,
    ownsBusyLease: () => boolean = ownsUI
): Promise<void> => {
    cancelConfirmation();
    if (request != null) return;
    const visitor = visitors[activeVisitor];
    const client = visitor.client;
    if (client == null) {
        status('Connect an extension first.', true);
        return;
    }
    const identity = activeVisitor;
    const revision = visitor.revision;
    const controller = new AbortController();
    request = controller;
    const current = () =>
        !controller.signal.aborted &&
        visitors[identity] === visitor &&
        activeVisitor === identity &&
        visitor.revision === revision &&
        visitor.client === client;
    setBusy(true);
    status(description);
    try {
        await action({ visitor, client, signal: controller.signal, current });
    } catch (error) {
        if (current() && ownsUI()) {
            if (error instanceof SDKError) {
                status(
                    `${error.message}${error.code == null ? '' : ` (${error.code})`}${error.status == null ? '' : ` · HTTP ${error.status}`}`,
                    true
                );
            } else {
                status(
                    error instanceof Error
                        ? error.message
                        : 'The request failed.',
                    true
                );
            }
        }
    } finally {
        if (request === controller) {
            request = null;
            if (ownsBusyLease()) {
                setBusy(false);
                sessionSummary();
            }
        }
    }
};
const confirmCurrent = async (
    options: ConfirmationOptions
): Promise<boolean> => {
    if (request != null) return false;
    const identity = activeVisitor;
    const visitor = visitors[identity];
    const client = visitor.client;
    const revision = visitor.revision;
    const screen = visitor.screen;
    const accepted = await requestConfirmation(options);
    return (
        accepted &&
        request == null &&
        activeVisitor === identity &&
        visitors[identity] === visitor &&
        visitor.client === client &&
        visitor.revision === revision &&
        visitor.screen === screen
    );
};
const invalidate = (visitor: Visitor): void => {
    cancelConfirmation();
    visitor.portal?.destroy();
    visitor.revision += 1;
    visitor.screen = null;
    visitor.root = null;
    visitor.portal = null;
    visitor.verification = null;
    visitor.formContext = { type: 'direct-url' };
    visitor.formParentScope = null;
    visitor.formQueries = null;
    visitor.recoveryCandidate = null;
    visitor.preparedAttempt = null;
    visitor.formAuthority = null;
    visitor.drafts.clear();
    visitor.uncertainFormDraftScopes.clear();
    request?.abort();
    request = null;
    setBusy(false);
};
const replaceSession = (visitor: Visitor, next: RuntimeSession): void => {
    cancelConfirmation();
    visitor.portal?.destroy();
    visitor.client?.setSession(next);
    // A successful explicit login becomes a new owner for future responses.
    visitor.revision += 1;
    visitor.portal = null;
    visitor.root = null;
    visitor.verification = null;
    visitor.formParentScope = null;
    visitor.formQueries = null;
    visitor.recoveryCandidate = null;
    visitor.preparedAttempt = null;
    visitor.formAuthority = null;
    visitor.drafts.clear();
    visitor.uncertainFormDraftScopes.clear();
};

const load = (): void => {
    cancelConfirmation();
    void run(
        'Loading the published extension…',
        async ({ visitor, client, signal, current }) => {
            if (connection == null) return;
            const query = structuredClone(connection.input.query ?? {});
            const result = await client.loadExtension(connection.input, {
                signal,
            });
            if (!current()) return;
            // Reload replaces this visitor's drafts only after a fresh read.
            visitor.drafts.clear();
            visitor.uncertainFormDraftScopes.clear();
            visitor.portal?.destroy();
            visitor.screen = result;
            visitor.formLoadVersion = ++formLoadSequence;
            visitor.recoveryCandidate = null;
            visitor.preparedAttempt = null;
            visitor.formAuthority = null;
            visitor.root =
                result.extensionScreen === 'portal_loaded' ? result : null;
            visitor.portal = null;
            visitor.formContext = { type: 'direct-url' };
            visitor.formParentScope = null;
            visitor.formQueries = null;
            visitor.verification = null;
            if (result.extensionScreen === 'form_loaded') {
                visitor.formQueries = {
                    page: result,
                    loadVersion: visitor.formLoadVersion,
                    cascade: query,
                    save: structuredClone(query),
                    diagnostic: null,
                };
            }
            render();
            status(
                result.extensionScreen == null
                    ? 'The extension requested a redirect.'
                    : `Loaded ${result.extensionScreen.replaceAll('_', ' ')}.`
            );
        }
    );
};

const applyLogin = (
    visitor: Visitor,
    page: LoginPageResult,
    token: string
): void => {
    if (visitor.client == null) return;
    replaceSession(
        visitor,
        withLoginToken(visitor.client.getSession(), {
            extensionId: page.extensionId,
            tableId: page.payload.tableId,
            loginFieldNames: page.payload.loginFieldNames,
            encryptedLoginToken: token,
        })
    );
    visitor.screen = null;
    render();
    status(
        'Login applied to this visitor. Choose Reload to load the authenticated screen.'
    );
};

const renderPassword = (
    page: Extract<LoadExtensionResult, { extensionScreen: 'password' }>
): void => {
    const card = element('form', undefined, 'card');
    card.append(element('h2', 'Extension password'));
    const password = element('input');
    password.type = 'password';
    password.autocomplete = 'current-password';
    password.required = true;
    card.append(labeled('Password', password));
    const submit = element('button', 'Verify and use password');
    submit.type = 'submit';
    card.append(submit);
    card.addEventListener('submit', (event) => {
        event.preventDefault();
        void run(
            'Verifying the password…',
            async ({ visitor, client, signal, current }) => {
                const result = await client.auth.verifyExtensionPassword(
                    {
                        extensionId: page.extensionId,
                        extensionPassword: password.value,
                    },
                    { signal }
                );
                if (!current()) return;
                password.value = '';
                if (result.type !== 'correct') {
                    status(
                        result.type === 'wrong'
                            ? 'Incorrect password.'
                            : 'Password attempts are temporarily blocked.',
                        true
                    );
                    return;
                }
                replaceSession(
                    visitor,
                    withExtensionPassword(client.getSession(), {
                        extensionId: page.extensionId,
                        encryptedExtensionPassword:
                            result.encryptedExtensionPassword,
                    })
                );
                visitor.screen = null;
                render();
                status(
                    'Password applied to this visitor. Choose Reload to continue.'
                );
            }
        );
    });
    screenNode.append(card);
};

const renderLogin = (page: LoginPageResult): void => {
    const visitor = visitors[activeVisitor];
    const card = element('form', undefined, 'card');
    card.append(element('h2', 'Visitor login'));
    const controls = new Map<string, HTMLInputElement>();
    const fields = element('div', undefined, 'fields');
    for (const name of page.payload.loginFieldNames) {
        const input = element('input');
        const schema = page.payload.fieldNamesToSchemas[name];
        const masked = shouldMaskLoginFieldInput(schema);
        input.type = masked
            ? 'password'
            : schema?.fieldType === AirtableFieldType.EMAIL
              ? 'email'
              : 'text';
        input.autocomplete =
            input.type === 'password' ? 'current-password' : 'off';
        input.value = page.payload.prefillFieldNamesToValues[name] ?? '';
        input.required = true;
        fields.append(labeled(name, input));
        controls.set(name, input);
    }
    card.append(fields);
    const actions = element('div', undefined, 'actions');
    const submit = element('button', 'Log in and use session');
    submit.type = 'submit';
    actions.append(submit);
    const credentials = () =>
        Object.fromEntries(
            Array.from(controls, ([name, input]) => [name, input.value])
        );
    let codeForm: HTMLFormElement | null = null;
    let codeInput: HTMLInputElement | null = null;
    const retireVerification = (owner: Visitor): void => {
        owner.verification = null;
        if (codeInput != null) codeInput.value = '';
        codeForm?.remove();
    };
    if (settings(page.payload.publicFields).ifRecordDoesNotExist === 'signUp') {
        actions.append(
            button('Sign up', () => {
                void run(
                    'Creating a visitor account…',
                    async ({ visitor: owner, client, signal, current }) => {
                        if (
                            !card.isConnected ||
                            owner !== visitor ||
                            owner.screen !== page
                        )
                            return;
                        const signUpCredentials = credentials();
                        retireVerification(owner);
                        const result = await client.auth.signUp(
                            {
                                extensionId: page.extensionId,
                                signUpCredentials,
                            },
                            { signal }
                        );
                        if (current())
                            status(
                                result.ok
                                    ? 'Sign-up accepted. Use the configured login flow to continue.'
                                    : 'Sign-up was not accepted.',
                                !result.ok
                            );
                    }
                );
            })
        );
    }
    card.append(actions);
    card.addEventListener('submit', (event) => {
        event.preventDefault();
        void run(
            'Checking visitor login…',
            async ({ visitor: owner, client, signal, current }) => {
                if (
                    !card.isConnected ||
                    owner !== visitor ||
                    owner.screen !== page
                )
                    return;
                const loginCredentials = credentials();
                retireVerification(owner);
                const result = await client.auth.login(
                    {
                        extensionId: page.extensionId,
                        loginCredentials,
                    },
                    { signal }
                );
                if (!current()) return;
                if (result.type === 'found-record')
                    applyLogin(owner, page, result.encryptedLoginToken);
                else if (result.type === 'no-record')
                    status('No matching login record was found.', true);
                else {
                    owner.verification = {
                        loginPage: page,
                        verificationId: result.verificationId,
                    };
                    render();
                    status(
                        `A verification ${result.verificationType === 'email' ? 'email' : 'message'} was sent to ${getLoginVerificationDestination(page, result)}.`
                    );
                }
            }
        );
    });
    screenNode.append(card);
    const verification = visitor.verification;
    if (verification != null) {
        codeForm = element('form', undefined, 'card');
        const code = element('input');
        codeInput = code;
        code.autocomplete = 'one-time-code';
        code.required = true;
        codeForm.append(labeled('Verification code', code));
        const confirm = element('button', 'Confirm and use session');
        confirm.type = 'submit';
        codeForm.append(confirm);
        codeForm.addEventListener('submit', (event) => {
            event.preventDefault();
            void run(
                'Confirming verification code…',
                async ({ visitor: owner, client, signal, current }) => {
                    if (
                        !codeForm?.isConnected ||
                        owner !== visitor ||
                        owner.screen !== page ||
                        owner.verification !== verification
                    )
                        return;
                    const verificationCode = code.value;
                    code.value = '';
                    const result = await client.auth.confirmVerificationCode(
                        {
                            verificationId: verification.verificationId,
                            verificationCode,
                            language: page.language,
                        },
                        { signal }
                    );
                    if (
                        current() &&
                        owner.screen === page &&
                        owner.verification === verification
                    )
                        applyLogin(
                            owner,
                            verification.loginPage,
                            result.encryptedLoginToken
                        );
                }
            );
        });
        screenNode.append(codeForm);
    }
};

const renderForm = (page: FormLoadedResult): void => {
    const visitor = visitors[activeVisitor];
    const context = visitor.formContext;
    const scope = formRecoveryScope(visitor, page);
    const loadVersion = visitor.formLoadVersion;
    const formQueries =
        visitor.formQueries?.page === page &&
        visitor.formQueries.loadVersion === loadVersion
            ? visitor.formQueries
            : null;
    const cascadeQuery = structuredClone(formQueries?.cascade ?? {});
    const saveQuery = structuredClone(formQueries?.save ?? {});
    const recordId =
        page.payload.formRecord.type === 'edit'
            ? page.payload.formRecord.recordId
            : null;
    const candidate = visitor.recoveryCandidate;
    const card = element('form', undefined, 'card');
    if (formQueries?.diagnostic != null)
        card.append(
            element('p', formQueries.diagnostic, 'child-query-diagnostic')
        );
    card.noValidate = true; // Display the server's complete validation result.
    card.append(element('h2', page.payload.extensionName ?? 'Custom Form'));
    if (visitor.root != null)
        card.append(
            button('Back to Portal', () => {
                visitor.screen = visitor.root;
                visitor.formContext = { type: 'direct-url' };
                visitor.formParentScope = null;
                visitor.formQueries = null;
                render();
            })
        );
    const inspectionAttempt =
        candidate?.outcome === 'unknown' && candidate.acknowledgment === 'none'
            ? candidate
            : recovery.blocking(scope, recordId);
    const freshInspection =
        recordId != null &&
        inspectionAttempt != null &&
        loadVersion > inspectionAttempt.loadVersion &&
        sameRecoveryRelationship(scope, inspectionAttempt.scope) &&
        (visitor.formAuthority?.() ?? true);
    let draft = openLoadedFormDraft({
        store: visitor.drafts,
        loaded: page,
        parent: visitor.formParentScope,
    });
    if (freshInspection) {
        // The journal already retains the earlier input as reference only.
        // A newer response is not inspected while an old cached draft masks it.
        visitor.drafts.discard(draft);
        draft = openLoadedFormDraft({
            store: visitor.drafts,
            loaded: page,
            parent: visitor.formParentScope,
        });
    }
    const ownsForm = (): boolean =>
        card.isConnected &&
        visitors[activeVisitor] === visitor &&
        visitor.screen === page &&
        visitor.formLoadVersion === loadVersion &&
        (visitor.formAuthority?.() ?? true) &&
        visitor.drafts.snapshot(draft) != null;
    const mayUseForm = (): boolean =>
        ownsForm() &&
        recovery.blocking(scope, recordId) == null &&
        !(
            candidate?.outcome === 'unknown' &&
            candidate.acknowledgment === 'none'
        );
    let updateComments = (): void => {};
    let reviewPending = false;
    let formRetired = false;
    let activeUpload: RecoveryAttempt | null = null;
    const controls = new Map<string, FieldControl>();
    let updateSelectAvailability = (): void => {};
    const linkedFilterViews = new Map<string, ConditionalLinkedFilters>();
    const formClient = visitor.client;
    const formRevision = visitor.revision;
    const formSession = formClient == null ? null : sessionKey(formClient);
    const ownsLinkedFilters = (): boolean =>
        mayUseForm() &&
        visitor.client === formClient &&
        visitor.revision === formRevision &&
        formClient != null &&
        sessionKey(formClient) === formSession;
    const configurationKey = (): string =>
        JSON.stringify([
            page.extensionId,
            page.payload.extensionAccessToken,
            page.payload.formRecord.type === 'edit'
                ? [
                      page.payload.formRecord.type,
                      page.payload.formRecord.recordId,
                      page.payload.formRecord.tableId,
                  ]
                : [page.payload.formRecord.type],
            page.payload.fieldIdsInForm,
            page.payload.fieldIdsToSchemas,
            page.payload.linkedRecordFieldIdToDetailFields,
            page.payload.publicFields,
            page.payload.persistedAddOnlyAttachmentValuesByFieldId,
            visitor.formContext,
            visitor.formParentScope,
            connection,
            formClient == null ? null : sessionKey(formClient),
        ]);
    let reviewConfiguration = configurationKey();
    let reviewConfigurationRevision = 0;
    const observeReviewConfiguration = (): number => {
        const next = configurationKey();
        if (next !== reviewConfiguration) {
            reviewConfiguration = next;
            reviewConfigurationRevision++;
        }
        return reviewConfigurationRevision;
    };
    const pendingPanel = element('section');
    pendingPanel.setAttribute('aria-label', 'Pending attachment selections');
    const pendingInputs = new Set<HTMLInputElement>();
    const pendingStatuses = new Map<HTMLInputElement, HTMLElement>();
    const clearPending = button('Clear pending files', () => {
        let cleared = false;
        for (const input of pendingInputs)
            if (pendingFiles.capture(input) != null)
                cleared = pendingFiles.clear(input) || cleared;
        if (cleared) status('Pending file selections cleared.');
    });
    clearPending.hidden = pendingPanel.hidden = true;
    pendingPanel.append(clearPending);
    const pendingFiles = createPendingFiles(
        () =>
            ownsForm() &&
            visitor.client === formClient &&
            visitor.revision === formRevision &&
            formClient != null &&
            sessionKey(formClient) === formSession,
        () => {
            clearPending.hidden = pendingPanel.hidden = !pendingFiles.pending();
            for (const [input, notice] of pendingStatuses)
                notice.textContent =
                    pendingFiles.capture(input) == null
                        ? 'No file selected.'
                        : 'File selected; upload or clear explicitly.';
            if (reviewPending) cancelConfirmation();
        }
    );
    let metadataPromise: Promise<RuntimeTableStates> | null = null;
    const linkedPresentation = createLinkedReviewPresentation(
        page,
        ownsLinkedFilters
    );
    const readFilterMetadata = (context: {
        client: MiniExtensionsClient;
        signal: AbortSignal;
        current(): boolean;
    }): Promise<RuntimeTableStates> => {
        context.signal.throwIfAborted();
        if (
            !ownsLinkedFilters() ||
            !context.current() ||
            context.client !== formClient
        )
            throw new Error('Reopen the current Form before loading filters.');
        if (metadataPromise == null) {
            const pending = context.client.linkedRecords
                .loadSelectedRecords(
                    { extensionAccessToken: page.payload.extensionAccessToken },
                    {
                        signal: context.signal,
                        session: context.client.getSession(),
                    }
                )
                .then((result) => {
                    if (
                        !context.signal.aborted &&
                        ownsLinkedFilters() &&
                        context.current()
                    )
                        linkedPresentation.acceptHydration(result);
                    return result;
                });
            metadataPromise = pending;
            // A failed read permits a new explicit Load action, never an automatic retry.
            void pending.catch(() => {
                if (metadataPromise === pending) metadataPromise = null;
            });
        }
        return metadataPromise;
    };
    const retainInput = (
        attempt: RecoveryAttempt,
        selectedFile?: { fieldId: string }
    ): void => {
        const snapshot = visitor.drafts.snapshot(draft);
        attempt.retainedInput = (snapshot?.dirtyFieldIds ?? []).flatMap(
            (fieldId) => {
                const schema = page.payload.fieldIdsToSchemas[fieldId];
                const control = controls.get(fieldId);
                if (schema == null || control == null) return [];
                const config = schema.miniExtConfig;
                // Masked values must never enter the reference journal.
                if (
                    config != null &&
                    'obscurePassword' in config &&
                    config.obscurePassword === true
                )
                    return [];
                if (schema.fieldType === AirtableFieldType.MULTIPLE_ATTACHMENTS)
                    return [];
                if (!control.editable) return [];
                const text = displayValue(snapshot!.data[fieldId]);
                return [{ title: schema.airtableField.name, value: text }];
            }
        );
        if (
            selectedFile != null ||
            (snapshot?.dirtyFieldIds ?? []).some(
                (fieldId) =>
                    page.payload.fieldIdsToSchemas[fieldId]?.fieldType ===
                    AirtableFieldType.MULTIPLE_ATTACHMENTS
            )
        )
            attempt.retainedInput.push({
                title: 'Attachment activity',
                value: 'Attachment details are not retained.',
            });
    };
    disposeFormControls = () => {
        formRetired = true;
        linkedPresentation.retire();
        pendingFiles.retire();
        pendingInputs.clear();
        pendingStatuses.clear();
        if (reviewPending) cancelConfirmation();
        updateFormActivity = () => {};
        for (const view of linkedFilterViews.values()) view.destroy();
        linkedFilterViews.clear();
        for (const control of controls.values()) control.destroy();
        controls.clear();
    };
    const fields = element('div', undefined, 'fields');
    const visibilityMessage = element(
        'p',
        'Some fields cannot be displayed with this published configuration. Review the Form configuration before saving.',
        'error'
    );
    visibilityMessage.setAttribute('role', 'alert');
    let fieldVisibility: Readonly<Record<string, FormFieldVisibility>> = {};
    const ownsAddressReads = (): boolean =>
        ownsLinkedFilters() && !screenNode.inert && !fields.inert;
    updateFormActivity = () => {
        observeReviewConfiguration();
        for (const [fieldId, control] of controls) {
            if ('refresh' in control && typeof control.refresh === 'function')
                control.refresh();
            control.setActive?.(
                ownsAddressReads() &&
                    fieldVisibility[fieldId]?.type === 'visible'
            );
        }
    };
    const updateFieldVisibility = (): void => {
        const snapshot = visitor.drafts.snapshot(draft);
        if (snapshot == null) return;
        fieldVisibility = composeFormFieldVisibility({
            fieldIds: page.payload.fieldIdsInForm.filter(
                (id) => page.payload.fieldIdsToSchemas[id] != null
            ),
            fieldIdsToSchemas: page.payload.fieldIdsToSchemas,
            airtableFields: Object.values(page.payload.fieldIdsToSchemas).map(
                (schema) => schema.airtableField
            ),
            data: snapshot.data,
            formRecordType: page.payload.formRecord.type,
            evaluationMode: 'runtime',
            invalidConditionMode: 'strict',
        });
        for (const [fieldId, control] of controls)
            control.node.hidden = fieldVisibility[fieldId]?.type !== 'visible';
        updateFormActivity();
        visibilityMessage.hidden = !Object.values(fieldVisibility).some(
            (result) => result.type === 'blocked'
        );
    };
    for (const fieldId of page.payload.fieldIdsInForm) {
        const schema = page.payload.fieldIdsToSchemas[fieldId];
        if (schema == null) continue;
        const createdChoices = visitor.drafts.choices(draft, fieldId);
        const fieldConfig = schema.airtableField.config;
        if (
            createdChoices.length !== 0 &&
            (fieldConfig.type === AirtableFieldType.SINGLE_SELECT ||
                fieldConfig.type === AirtableFieldType.MULTIPLE_SELECTS)
        ) {
            const choices = new Map(
                (fieldConfig.options?.choices ?? []).map((choice) => [
                    choice.id,
                    choice,
                ])
            );
            for (const choice of createdChoices) choices.set(choice.id, choice);
            fieldConfig.options = {
                ...fieldConfig.options,
                choices: [...choices.values()],
            };
        }
        const control: FieldControl =
            schema.fieldType === AirtableFieldType.MULTIPLE_ATTACHMENTS
                ? formAttachmentControl(
                      page,
                      fieldId,
                      visitor.drafts.read(draft, fieldId)
                  )
                : formFieldControl(
                      schema,
                      visitor.drafts.read(draft, fieldId),
                      () => {
                          if (
                              !mayUseForm() ||
                              fieldVisibility[fieldId]?.type !== 'visible'
                          )
                              return;
                          if (reviewPending) cancelConfirmation();
                          try {
                              visitor.drafts.write(
                                  draft,
                                  fieldId,
                                  control.read()
                              );
                              updateFieldVisibility();
                              updateSelectAvailability();
                          } catch (error) {
                              status(
                                  error instanceof Error
                                      ? error.message
                                      : 'Invalid field value.',
                                  true
                              );
                          }
                      },
                      false,
                      formClient == null
                          ? undefined
                          : {
                                extensionAccessToken:
                                    page.payload.extensionAccessToken,
                                reads: formClient.addresses,
                                isCurrent: () =>
                                    ownsAddressReads() &&
                                    fieldVisibility[fieldId]?.type ===
                                        'visible',
                            }
                  );
        controls.set(fieldId, control);
        fields.append(control.node);
        const config = schema.miniExtConfig;
        if (
            (config !== undefined &&
                'readOnly' in config &&
                config.readOnly === true) ||
            schema.airtableField.isComputed === true
        )
            continue;
        if (
            (schema.fieldType === AirtableFieldType.SINGLE_SELECT ||
                schema.fieldType === AirtableFieldType.MULTIPLE_SELECTS) &&
            getSelectFieldPolicy(schema).allowAddingNewOptions
        ) {
            const choice = element('input');
            choice.placeholder = 'New choice name';
            control.node.append(
                labeled('Add a choice', choice),
                button('Create choice', () => {
                    if (
                        !mayUseForm() ||
                        !getSelectFieldPolicy(schema).allowAddingNewOptions ||
                        control.selectAvailabilityReady?.() === false
                    )
                        return;
                    const policy = getSelectFieldPolicy(schema);
                    const currentValue = control.read();
                    if (
                        schema.fieldType ===
                            AirtableFieldType.MULTIPLE_SELECTS &&
                        policy.maxSelections !== null &&
                        Array.isArray(currentValue) &&
                        currentValue.length >= policy.maxSelections
                    ) {
                        status(
                            'Remove a selected choice before adding another.',
                            true
                        );
                        return;
                    }
                    if (choice.value.trim() === '') {
                        status('Enter a new choice name.', true);
                        return;
                    }
                    void run(
                        'Creating the configured select choice…',
                        async ({ client, signal, current }) => {
                            if (
                                !mayUseForm() ||
                                !getSelectFieldPolicy(schema)
                                    .allowAddingNewOptions ||
                                control.selectAvailabilityReady?.() === false
                            )
                                return;
                            const dispatchPolicy = getSelectFieldPolicy(schema);
                            const dispatchValue = control.read();
                            if (
                                schema.fieldType ===
                                    AirtableFieldType.MULTIPLE_SELECTS &&
                                dispatchPolicy.maxSelections !== null &&
                                Array.isArray(dispatchValue) &&
                                dispatchValue.length >=
                                    dispatchPolicy.maxSelections
                            )
                                return;
                            signal.throwIfAborted();
                            const result = await client.forms.addSelectOption(
                                {
                                    extensionAccessToken:
                                        page.payload.extensionAccessToken,
                                    airtableFieldId: fieldId,
                                    newChoiceText: choice.value,
                                },
                                { signal }
                            );
                            if (!current() || !mayUseForm()) return;
                            visitor.drafts.addChoice(
                                draft,
                                fieldId,
                                result.newChoice
                            );
                            const fieldConfig = schema.airtableField.config;
                            if (
                                fieldConfig.type ===
                                    AirtableFieldType.SINGLE_SELECT ||
                                fieldConfig.type ===
                                    AirtableFieldType.MULTIPLE_SELECTS
                            ) {
                                fieldConfig.options = {
                                    ...fieldConfig.options,
                                    choices: [
                                        ...(
                                            fieldConfig.options?.choices ?? []
                                        ).filter(
                                            (option) =>
                                                option.id !==
                                                result.newChoice.id
                                        ),
                                        result.newChoice,
                                    ],
                                };
                                control.updateSelectChoices?.(
                                    fieldConfig.options.choices
                                );
                                updateFieldVisibility();
                                updateSelectAvailability();
                            }
                            if (
                                control.selectAvailabilityReady?.() === false ||
                                control.isSelectOptionAvailable?.(
                                    result.newChoice
                                ) !== true
                            ) {
                                choice.value = '';
                                status(
                                    'This choice is not currently selectable.'
                                );
                                return;
                            }
                            const previous = control.read();
                            const maximum =
                                getSelectFieldPolicy(schema).maxSelections;
                            if (
                                schema.fieldType ===
                                    AirtableFieldType.MULTIPLE_SELECTS &&
                                maximum !== null &&
                                Array.isArray(previous) &&
                                previous.length >= maximum
                            ) {
                                choice.value = '';
                                status(
                                    'Choice created. Remove a selected choice before selecting it.'
                                );
                                return;
                            }
                            control.write(
                                schema.fieldType ===
                                    AirtableFieldType.MULTIPLE_SELECTS
                                    ? [
                                          ...(Array.isArray(previous)
                                              ? previous
                                              : []),
                                          result.newChoice.name,
                                      ]
                                    : result.newChoice.name
                            );
                            visitor.drafts.write(
                                draft,
                                fieldId,
                                control.read()
                            );
                            updateFieldVisibility();
                            updateSelectAvailability();
                            choice.value = '';
                            status(
                                'Choice created and selected in the draft. Save to update the record.'
                            );
                        }
                    );
                })
            );
        }
        if (schema.fieldType === AirtableFieldType.MULTIPLE_RECORD_LINKS) {
            const search = element('input');
            search.placeholder = 'Search available linked records';
            const choices = element('div', undefined, 'choice-list');
            let offset: string | null = null;
            let generation = 0;
            let requestVersion = 0;
            let conditionalFilters: ConditionalLinkedFilters | null = null;
            const resetChoices = (): void => {
                generation += 1;
                requestVersion += 1;
                offset = null;
                choices.replaceChildren();
                moreButton.disabled = true;
            };
            const fetchOptions = (more: boolean): void => {
                if (!ownsLinkedFilters() || (more && offset == null)) return;
                if (!more) resetChoices();
                const capturedGeneration = generation;
                const capturedRequest = ++requestVersion;
                const capturedFilterRevision = conditionalFilters?.revision();
                const capturedSearch = search.value;
                const capturedOffset = more ? offset : null;
                const filterValues = conditionalFilters?.snapshot() ?? {};
                void run(
                    'Loading allowed linked records…',
                    async ({ client, signal, current }) => {
                        if (!ownsLinkedFilters() || client !== formClient)
                            return;
                        const accepted = (): boolean =>
                            current() &&
                            ownsLinkedFilters() &&
                            capturedGeneration === generation &&
                            capturedRequest === requestVersion &&
                            capturedFilterRevision ===
                                conditionalFilters?.revision() &&
                            capturedSearch === search.value;
                        signal.throwIfAborted();
                        let result: ListLinkedRecordOptionsResult;
                        try {
                            result = await client.linkedRecords.listFormOptions(
                                {
                                    extensionAccessToken:
                                        page.payload.extensionAccessToken,
                                    linkedRecordFieldId: fieldId,
                                    filter: {
                                        viewType: 'list',
                                        searchTerm: capturedSearch,
                                    },
                                    offset: capturedOffset,
                                    conditionalLinkedRecordFilteringValues:
                                        filterValues,
                                },
                                { signal, session: client.getSession() }
                            );
                        } catch (error) {
                            if (!accepted()) return;
                            throw error;
                        }
                        if (!accepted()) return;
                        linkedPresentation.acceptOptions(fieldId, result);
                        offset = result.offset;
                        for (const record of result.records) {
                            const choice = element('input');
                            choice.type = 'checkbox';
                            const selectedValue = control.read();
                            choice.checked =
                                Array.isArray(selectedValue) &&
                                selectedValue.includes(record.id);
                            choice.addEventListener('change', () => {
                                if (
                                    !ownsLinkedFilters() ||
                                    generation !== capturedGeneration ||
                                    conditionalFilters?.revision() !==
                                        capturedFilterRevision ||
                                    !choices.contains(choice)
                                )
                                    return;
                                const value = control.read();
                                const selected = new Set(
                                    Array.isArray(value)
                                        ? value.filter(
                                              (entry): entry is string =>
                                                  typeof entry === 'string'
                                          )
                                        : []
                                );
                                if (selected.has(record.id) === choice.checked)
                                    return;
                                if (
                                    conditionalFilters != null &&
                                    !conditionalFilters.canChange(
                                        choice.checked
                                    )
                                ) {
                                    choice.checked = selected.has(record.id);
                                    status(
                                        'Load the configured filters and choose the required driver before changing linked records.',
                                        true
                                    );
                                    return;
                                }
                                if (choice.checked) selected.add(record.id);
                                else selected.delete(record.id);
                                control.write([...selected]);
                                visitor.drafts.write(
                                    draft,
                                    fieldId,
                                    control.read()
                                );
                                updateFieldVisibility();
                                updateSelectAvailability();
                            });
                            const tableId =
                                schema.airtableField.config.type ===
                                AirtableFieldType.MULTIPLE_RECORD_LINKS
                                    ? schema.airtableField.config.options
                                          .linkedTableId
                                    : '';
                            const primary = result.tableIdsToLinkedTableStates[
                                tableId
                            ]?.airtableFields.find(
                                (field) => field.isPrimaryField
                            );
                            choices.append(
                                labeled(
                                    primary == null
                                        ? record.id
                                        : displayValue(
                                              record.fields[primary.id]
                                          ) || record.id,
                                    choice
                                )
                            );
                        }
                        moreButton.disabled = offset == null;
                        status(
                            `Loaded ${result.records.length} allowed linked records.`
                        );
                    }
                );
            };
            const moreButton = button('More choices', () => fetchOptions(true));
            moreButton.disabled = true;
            search.addEventListener('input', () => {
                if (ownsLinkedFilters()) resetChoices();
            });
            conditionalFilters = createConditionalLinkedFilters({
                schema,
                extensionAccessToken: page.payload.extensionAccessToken,
                query: cascadeQuery,
                current: ownsLinkedFilters,
                readMetadata: readFilterMetadata,
                request: (description, work) => {
                    void run(description, work);
                },
                changed: resetChoices,
                status,
            });
            if (conditionalFilters != null) {
                linkedFilterViews.set(fieldId, conditionalFilters);
                control.node.append(conditionalFilters.node);
            }
            control.node.append(
                search,
                button('Search choices', () => fetchOptions(false)),
                moreButton,
                choices
            );
        }
        if (schema.fieldType === AirtableFieldType.MULTIPLE_ATTACHMENTS) {
            const file = element('input');
            file.type = 'file';
            file.hidden = true;
            file.setAttribute('aria-hidden', 'true');
            file.tabIndex = -1;
            file.dataset.pendingFieldId = fieldId;
            pendingFiles.register(file);
            pendingInputs.add(file);
            const notice = element('p', 'No file selected.');
            notice.setAttribute('role', 'status');
            pendingStatuses.set(file, notice);
            control.node.append(
                button('Choose a file', () => {
                    if (
                        !mayUseForm() ||
                        reviewPending ||
                        request != null ||
                        fieldVisibility[fieldId]?.type !== 'visible'
                    )
                        return;
                    file.click();
                }),
                notice,
                file,
                button('Upload selected file', () => {
                    // Refuse before run/begin: retained hidden controls cannot dispatch.
                    if (
                        !ownsLinkedFilters() ||
                        formRetired ||
                        request != null ||
                        reviewPending
                    )
                        return;
                    const uploadConfiguration = observeReviewConfiguration();
                    // Configuration can retire an upload intent without retiring its DOM mount.
                    const ownsUploadRender = (): boolean =>
                        !formRetired &&
                        card.isConnected &&
                        visitors[activeVisitor] === visitor &&
                        visitor.screen === page &&
                        visitor.formLoadVersion === loadVersion &&
                        visitor.client === formClient &&
                        visitor.revision === formRevision;
                    const ownsUploadUI = (): boolean =>
                        ownsUploadRender() &&
                        ownsForm() &&
                        formClient != null &&
                        sessionKey(formClient) === formSession &&
                        observeReviewConfiguration() === uploadConfiguration;
                    const selection = pendingFiles.capture(file);
                    if (selection == null) {
                        if (ownsUploadUI())
                            status('Choose a file first.', true);
                        return;
                    }
                    const selected = selection.file;
                    const nativeRevision = visitor.drafts.revision(draft);
                    try {
                        updateFieldVisibility();
                        const snapshot = visitor.drafts.snapshot(draft);
                        if (
                            !ownsUploadUI() ||
                            snapshot == null ||
                            fieldVisibility[fieldId]?.type !== 'visible'
                        )
                            return;
                        admittedAttachmentValues(
                            page,
                            fieldId,
                            snapshot.data[fieldId],
                            selected
                        );
                    } catch {
                        if (ownsUploadUI())
                            status(
                                'The attachment cannot be added with the current Form settings.',
                                true
                            );
                        return;
                    }
                    void run(
                        'Uploading the selected attachment…',
                        async ({ client, signal, current }) => {
                            if (
                                !ownsUploadUI() ||
                                !current() ||
                                visitor.drafts.revision(draft) !==
                                    nativeRevision
                            )
                                return;
                            signal.throwIfAborted();
                            const attempt = recovery.begin(
                                scope,
                                recordId,
                                'upload',
                                loadVersion,
                                fieldId
                            );
                            activeUpload = attempt;
                            retainInput(attempt, { fieldId });
                            updateRecovery();
                            const ownsAttempt = (): boolean =>
                                ownsUploadUI() &&
                                current() &&
                                activeUpload === attempt &&
                                attempt.flight &&
                                attempt.outcome === 'unknown' &&
                                attempt.acknowledgment === 'none' &&
                                attempt.operation === 'upload' &&
                                attempt.fieldId === fieldId &&
                                attempt.recordId === recordId &&
                                attempt.loadVersion === loadVersion &&
                                recovery.blocking(scope, recordId) ===
                                    attempt &&
                                visitor.drafts.revision(draft) ===
                                    nativeRevision;
                            try {
                                const attachment =
                                    await client.attachments.uploadFile(
                                        {
                                            file: selected,
                                            filename: selected.name,
                                            extensionAccessToken:
                                                page.payload
                                                    .extensionAccessToken,
                                            fieldId,
                                        },
                                        { signal }
                                    );
                                if (!ownsAttempt()) {
                                    if (ownsUploadUI() && current())
                                        status(
                                            'Upload outcome needs inspection; it was not added to the draft.',
                                            true
                                        );
                                    return;
                                }
                                const snapshot = visitor.drafts.snapshot(draft);
                                if (snapshot == null) return;
                                const next = appendedAttachmentValues(
                                    page,
                                    fieldId,
                                    snapshot.data[fieldId],
                                    selected,
                                    attachment
                                );
                                // No await between the final fence and authoritative commit.
                                if (
                                    !ownsAttempt() ||
                                    !visitor.drafts.write(draft, fieldId, next)
                                )
                                    return;
                                recovery.accepted(attempt, 'uploaded');
                                // Presentation may throw; it must not turn a committed append unknown.
                                try {
                                    control.write(next);
                                    updateFieldVisibility();
                                    updateSelectAvailability();
                                } finally {
                                    if (ownsUploadUI())
                                        pendingFiles.clear(file, selection);
                                }
                                if (ownsUploadUI())
                                    status(
                                        'File uploaded. Choose Save to attach it to the record.'
                                    );
                            } catch {
                                if (ownsUploadUI() && current())
                                    status(
                                        attempt.outcome === 'uploaded'
                                            ? 'The attachment was added to the draft; reopen the Form to refresh its presentation.'
                                            : 'Upload outcome needs inspection; it was not added to the draft.',
                                        true
                                    );
                            } finally {
                                recovery.finishFlight(attempt);
                                if (activeUpload === attempt)
                                    activeUpload = null;
                                if (ownsUploadRender()) {
                                    updateRecovery();
                                    if (
                                        current() &&
                                        attempt.outcome === 'unknown'
                                    )
                                        status(
                                            'Upload outcome needs inspection; it was not added to the draft.',
                                            true
                                        );
                                }
                            }
                        },
                        ownsUploadUI,
                        ownsUploadRender
                    );
                })
            );
        }
    }
    updateSelectAvailability = () => {
        if (!ownsForm()) return;
        const snapshot = visitor.drafts.snapshot(draft);
        if (snapshot == null) return;
        const airtableFields = Object.values(
            page.payload.fieldIdsToSchemas
        ).map((schema) => schema.airtableField);
        for (const [fieldId, control] of controls) {
            if (control.updateSelectAvailability == null) continue;
            const field = page.payload.fieldIdsToSchemas[fieldId];
            if (field == null) continue;
            control.updateSelectAvailability(
                resolveSelectFieldAvailability({
                    field,
                    airtableFields,
                    recordForConditionEvaluation: flatChoiceConditionRecord(
                        page,
                        field,
                        snapshot.data
                    ),
                    mode: control.editable
                        ? 'runtime'
                        : 'configuration-preview',
                    invalidConditionMode: 'compatibility',
                })
            );
        }
    };
    updateFieldVisibility();
    card.append(visibilityMessage, fields);
    const errors = element('ul', undefined, 'error-list');
    errors.setAttribute('role', 'alert');
    const uncertainSaveMessage =
        'We could not confirm the earlier attempt. It may have completed. Check the latest requests before taking another action.';
    if (visitor.uncertainFormDraftScopes.has(draft.scope))
        errors.append(element('li', uncertainSaveMessage));
    card.append(errors);
    const actions = element('div', undefined, 'actions');
    const submit = element('button', 'Save');
    submit.type = 'submit';
    submit.disabled = visitor.uncertainFormDraftScopes.has(draft.scope);
    actions.append(submit);
    const discard = button('Discard draft', () => {
        if (
            !ownsForm() ||
            recovery.blocking(scope, recordId) != null ||
            (candidate?.outcome === 'unknown' &&
                candidate.acknowledgment === 'none')
        ) {
            status(uncertainSaveMessage, true);
            return;
        }
        visitor.drafts.discard(draft);
        render();
        status('This Form draft was discarded. No record was saved.');
    });
    discard.disabled = submit.disabled;
    actions.append(discard);
    let deleteRecord: HTMLButtonElement | null = null;
    if (
        page.payload.formRecord.type === 'edit' &&
        settings(page.payload.publicFields).allowDeletingRecords === true
    ) {
        deleteRecord = button(
            'Delete this record',
            async () => {
                const mayDelete = mayUseForm;
                if (!mayDelete()) return;
                if (
                    !(await confirmCurrent({
                        title: 'Delete this record?',
                        message:
                            'This deletes the current Form record from Airtable.',
                        confirmLabel: 'Delete record',
                    })) ||
                    !mayDelete()
                )
                    return;
                await run(
                    'Deleting the current record…',
                    async ({ client, signal, current }) => {
                        if (!mayDelete()) return;
                        signal.throwIfAborted();
                        await client.forms.deleteCurrentRecord(
                            {
                                extensionAccessToken:
                                    page.payload.extensionAccessToken,
                            },
                            { signal }
                        );
                        if (!current() || !ownsForm()) return;
                        visitor.drafts.discard(draft);
                        visitor.formParentScope = null;
                        visitor.formQueries = null;
                        visitor.screen = visitor.root;
                        render();
                        status(
                            'Record deleted. Reload to refresh the current records.'
                        );
                    }
                );
            },
            'danger'
        );
        actions.append(deleteRecord);
    }
    card.append(actions, pendingPanel);
    const recoveryPanel = element('section');
    recoveryPanel.setAttribute('aria-label', 'Earlier request recovery');
    recoveryPanel.setAttribute('aria-live', 'polite');
    card.append(recoveryPanel);
    const updateRecovery = (): void => {
        const pending = recovery.blocking(scope, recordId);
        const selected =
            candidate?.outcome === 'unknown' &&
            candidate.acknowledgment === 'none'
                ? candidate
                : null;
        const expired = !(visitor.formAuthority?.() ?? true);
        submit.disabled = pending != null || selected != null || expired;
        discard.disabled = submit.disabled;
        if (deleteRecord != null) deleteRecord.disabled = submit.disabled;
        updateComments();
        fields.inert = submit.disabled;
        updateFormActivity();
        recoveryPanel.replaceChildren();
        if (visitor.preparedAttempt?.outcome === 'not-submitted')
            recoveryPanel.append(
                element(
                    'p',
                    `New local attempt: ${visitor.preparedAttempt.id}. No Form save has been submitted for this local attempt.`
                )
            );
        const attempt = selected ?? pending;
        for (const earlier of recovery
            .unknown(scope.owner)
            .filter(
                (earlier) =>
                    sameRecoveryRelationship(scope, earlier.scope) &&
                    (earlier.recordId === recordId ||
                        (recordId != null &&
                            earlier.associatedRecordId === recordId) ||
                        earlier === candidate)
            )) {
            if (earlier.retainedInput.length === 0) continue;
            const reference = element('details');
            reference.setAttribute(
                'aria-label',
                'Earlier local input (reference only)'
            );
            reference.append(
                element(
                    'summary',
                    `${earlier.id}: Earlier local input (reference only)`
                ),
                element(
                    'p',
                    'These were local values at the earlier dispatch, not the freshly loaded server values. They are never copied back or submitted automatically. Attachment details are not retained.'
                )
            );
            for (const field of earlier.retainedInput)
                reference.append(
                    element('p', `${field.title}: ${field.value}`)
                );
            recoveryPanel.append(reference);
        }
        if (expired)
            recoveryPanel.append(
                element(
                    'p',
                    'This form belongs to an earlier request view. Return to the Portal, load its latest records, and reopen the form before editing.'
                )
            );
        if (attempt == null) return;
        recoveryPanel.append(
            element('h3', 'Earlier outcome not confirmed'),
            element('p', `${attempt.id}: ${uncertainSaveMessage}`)
        );
        if (attempt.operation === 'upload')
            recoveryPanel.append(
                element(
                    'p',
                    'The file may have uploaded without being attached to a request. It will not be uploaded again automatically.'
                )
            );
        if (visitor.root != null)
            recoveryPanel.append(
                button('Check latest requests', () => {
                    if (
                        !card.isConnected ||
                        visitors[activeVisitor] !== visitor ||
                        visitor.screen !== page
                    )
                        return;
                    visitor.screen = visitor.root;
                    visitor.formParentScope = null;
                    visitor.formQueries = null;
                    visitor.recoveryCandidate = null;
                    render();
                    visitor.portal?.checkLatestRequests();
                })
            );
        else
            recoveryPanel.append(
                element(
                    'p',
                    'Inspect the outcome through your usual request access or ask the form owner. This standalone form has no authorized request list to check here.'
                )
            );
        const freshKnownRecord =
            !expired &&
            freshInspection &&
            inspectionAttempt === attempt &&
            recordId != null &&
            loadVersion > attempt.loadVersion &&
            sameRecoveryRelationship(scope, attempt.scope) &&
            (selected != null || attempt.recordId === recordId);
        if (freshKnownRecord)
            recoveryPanel.append(
                button('Use this request', async () => {
                    if (
                        !(await confirmCurrent({
                            title: 'Use this request?',
                            message:
                                'You selected and opened this request. Using it does not prove the earlier attempt saved it. Continue with this request without replaying the earlier attempt?',
                            confirmLabel: 'Use this request',
                        })) ||
                        !ownsForm() ||
                        !sameRecoveryRelationship(scope, attempt.scope) ||
                        attempt.flight
                    )
                        return;
                    recovery.acknowledgeExisting(attempt, recordId);
                    visitor.recoveryCandidate = null;
                    updateRecovery();
                    status(
                        'This request is ready for a separate edit. The earlier outcome remains unconfirmed.'
                    );
                })
            );
    };
    updateRecovery();
    const save = (prepared?: {
        snapshot: FormDraftSnapshot<AirtableValue>;
        current(): boolean;
    }): Promise<void> =>
        run('Saving the Form…', async ({ client, signal, current }) => {
            // Reject an invalid visible control instead of saving its last
            // valid draft value (for example, a non-finite numeric input).
            for (const [fieldId, control] of controls)
                if (
                    control.editable &&
                    fieldVisibility[fieldId]?.type === 'visible'
                )
                    control.read();
            if (prepared != null && !prepared.current()) return;
            const snapshot =
                prepared?.snapshot ?? visitor.drafts.snapshot(draft);
            if (snapshot == null) return;
            if (linkedFilterViews.size !== 0 && !ownsLinkedFilters()) {
                status(
                    'Reopen the current Form before saving its conditional filters.',
                    true
                );
                return;
            }
            const input = createFormSaveInput({
                loaded: page,
                draft: snapshot,
                options: {
                    captchaVal: null,
                    isComputeMode: false,
                    searchQuery: structuredClone(saveQuery),
                    context,
                    conditionalLinkedRecordFieldIdsToFilteringValues:
                        Object.fromEntries(
                            Array.from(linkedFilterViews, ([id, view]) => [
                                id,
                                view.snapshot(),
                            ])
                        ),
                },
            });
            signal.throwIfAborted();
            if (
                !current() ||
                !ownsForm() ||
                (prepared != null && !prepared.current())
            )
                return;
            const attempt = recovery.begin(
                scope,
                recordId,
                'save',
                loadVersion,
                null,
                visitor.preparedAttempt
            );
            retainInput(attempt);
            visitor.preparedAttempt = null;
            // Retire this scope before dispatch. Only an accepted result or
            // an accepted result or explicit inspected-outcome acknowledgment can unlock a new operation.
            visitor.uncertainFormDraftScopes.add(draft.scope);
            submit.disabled = true;
            discard.disabled = true;
            let normalized: ReturnType<typeof normalizeFormSaveResult>;
            try {
                const rawResult = await client.forms.save(input, { signal });
                if (!current() || !ownsForm()) return;
                normalized = normalizeFormSaveResult(rawResult, page);
                if (
                    normalized.type !== 'error' &&
                    (typeof normalized.raw.record.id !== 'string' ||
                        normalized.raw.record.id === '' ||
                        (recordId != null &&
                            normalized.raw.record.id !== recordId))
                )
                    throw new Error(
                        'The save response does not match this request. Check the latest requests.'
                    );
                recovery.accepted(
                    attempt,
                    normalized.type === 'error' ? 'validation-error' : 'saved'
                );
            } catch (error) {
                if (current())
                    errors.replaceChildren(element('li', uncertainSaveMessage));
                throw error;
            } finally {
                recovery.finishFlight(attempt);
                if (ownsForm()) updateRecovery();
            }
            visitor.uncertainFormDraftScopes.delete(draft.scope);
            submit.disabled = false;
            discard.disabled = false;
            errors.replaceChildren();
            if (normalized.type === 'error') {
                for (const error of normalized.validationErrors)
                    errors.append(
                        element(
                            'li',
                            `${error.fieldTitle}: ${error.errorMessage}`
                        )
                    );
                if (normalized.concurrentEditErrorMessage != null)
                    errors.append(
                        element('li', normalized.concurrentEditErrorMessage)
                    );
                status(
                    'The Form was not saved. Review the validation errors.',
                    true
                );
                return;
            }
            const result = normalized.raw;
            visitor.drafts.discard(draft);
            visitor.formParentScope = null;
            visitor.formQueries = null;
            if (visitor.root != null && result.loggedInUserRecord != null) {
                visitor.root.payload.formRecord.data = {
                    ...result.loggedInUserRecord.fields,
                };
                visitor.portal?.refreshRequired();
                visitor.screen = visitor.root;
                render();
            } else {
                visitor.screen = null;
                render();
            }
            const warnings = result.postSubmissionWarnings
                ?.map((warning) => warning.type)
                .join(', ');
            status(
                `Saved record ${result.record.id}.${warnings == null || warnings === '' ? '' : ` Post-submission warning: ${warnings}.`}`
            );
        });
    card.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!ownsForm() || request != null || reviewPending) return;
        if (
            recovery.blocking(scope, recordId) != null ||
            (candidate?.outcome === 'unknown' &&
                candidate.acknowledgment === 'none')
        ) {
            status(uncertainSaveMessage, true);
            return;
        }
        updateFieldVisibility();
        if (!visibilityMessage.hidden) {
            status(
                'Review the unavailable fields before saving this Form.',
                true
            );
            return;
        }
        if (
            settings(page.payload.publicFields).promptUserBeforeSubmission !==
            true
        ) {
            void save();
            return;
        }
        if (pendingFiles.pending()) {
            status('Upload or clear the selected file before reviewing.', true);
            return;
        }
        // Native modal focus prevents ordinary edits. The inert field owner
        // also retires prediction/detail intents before the accepted capture.
        reviewPending = true;
        fields.inert = true;
        updateFormActivity();
        try {
            for (const [fieldId, control] of controls)
                if (
                    control.editable &&
                    fieldVisibility[fieldId]?.type === 'visible'
                )
                    control.read();
            const snapshot = visitor.drafts.snapshot(draft);
            const draftRevision = visitor.drafts.revision(draft);
            if (
                snapshot == null ||
                draftRevision == null ||
                !ownsLinkedFilters()
            )
                return;
            const linkedSnapshot = linkedPresentation.snapshot();
            const rows = prepareFormReviewRows(
                page,
                snapshot.data,
                linkedSnapshot
            );
            const formConnection = connection;
            const parentScope = visitor.formParentScope;
            const capturedConfiguration = observeReviewConfiguration();
            const pendingRevision = pendingFiles.revision();
            const preparedCurrent = (): boolean =>
                ownsLinkedFilters() &&
                linkedSnapshot.current() &&
                visitor.formContext === context &&
                visitor.formParentScope === parentScope &&
                connection === formConnection &&
                visitor.drafts.revision(draft) === draftRevision &&
                observeReviewConfiguration() === capturedConfiguration &&
                pendingFiles.revision() === pendingRevision &&
                !pendingFiles.pending();
            const accepted = await requestConfirmation({
                title: 'Review your answers',
                message:
                    'Choose Edit to return to the Form, or Confirm to submit these answers.',
                confirmLabel: 'Confirm',
                cancelLabel: 'Edit',
                rows,
            });
            if (!accepted || request != null || !preparedCurrent()) return;
            // run() owns the single request and uncertain-outcome contract;
            // it checks this same captured intent again before dispatch.
            await save({
                snapshot,
                current: preparedCurrent,
            });
        } catch (error) {
            if (ownsForm())
                status(
                    error instanceof Error
                        ? error.message
                        : 'Review is unavailable.',
                    true
                );
        } finally {
            // Restore only this card. A superseded review cannot reactivate a
            // newer visitor's controls or repeat an old address query.
            reviewPending = false;
            if (ownsForm()) updateRecovery();
        }
    });
    screenNode.append(card);
    updateSelectAvailability();
    updateFormActivity();
    if (
        page.payload.formRecord.type === 'edit' &&
        page.payload.hasParentExtension &&
        page.enableCommentsOnChildForms
    )
        updateComments = renderComments(page, mayUseForm);
};

const renderComments = (
    page: FormLoadedResult,
    isCurrent: () => boolean
): (() => void) => {
    const card = element('section', undefined, 'card');
    card.append(element('h2', 'Record comments'));
    const output = element('div');
    let sendingDisabled = false;
    const load = button('Load comments', () => {
        if (!isCurrent()) return;
        void run(
            'Loading record comments…',
            async ({ client, signal, current }) => {
                if (!isCurrent()) return;
                signal.throwIfAborted();
                const result = await client.comments.listForRecord(
                    {
                        childExtensionAccessToken:
                            page.payload.extensionAccessToken,
                    },
                    { signal }
                );
                if (!current() || !isCurrent()) return;
                output.replaceChildren();
                for (const comment of result.comments)
                    output.append(element('p', comment.text, 'comment'));
                sendingDisabled = result.disableSending === true;
                update();
                status(`Loaded ${result.comments.length} comments.`);
            }
        );
    });
    card.append(load, output);
    const text = element('textarea');
    text.placeholder = 'Write a comment';
    const add = button('Add comment', () => {
        if (!isCurrent()) return;
        if (text.value.trim() === '') {
            status('Enter a comment.', true);
            return;
        }
        void run(
            'Adding a record comment…',
            async ({ client, signal, current }) => {
                if (!isCurrent()) return;
                signal.throwIfAborted();
                await client.comments.addToRecord(
                    {
                        childExtensionAccessToken:
                            page.payload.extensionAccessToken,
                        comment: text.value,
                    },
                    { signal }
                );
                if (!current() || !isCurrent()) return;
                text.value = '';
                status('Comment added. Load comments to refresh.');
            }
        );
    });
    card.append(labeled('Comment', text), add);
    screenNode.append(card);
    const update = (): void => {
        load.disabled = !isCurrent();
        add.disabled = sendingDisabled || !isCurrent();
        text.disabled = !isCurrent();
    };
    update();
    return update;
};

const render = (): void => {
    cancelConfirmation();
    disposeFormControls();
    disposeFormControls = () => {};
    screenNode.replaceChildren();
    sessionSummary();
    const visitor = visitors[activeVisitor];
    const page = visitor.screen;
    if (page == null) {
        screenNode.append(element('p', 'Choose Reload when ready.', 'hint'));
        return;
    }
    if (page.extensionScreen == null) {
        const link = element('a', 'Continue to the configured redirect');
        const url = new URL(page.url, connection?.apiOrigin);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
            link.href = url.href;
            link.rel = 'noopener noreferrer';
            screenNode.append(link);
        }
        return;
    }
    if (page.extensionScreen === 'password') renderPassword(page);
    else if (page.extensionScreen === 'login_page') renderLogin(page);
    else if (page.extensionScreen === 'form_loaded') renderForm(page);
    else {
        const ownerId = activeVisitor;
        if (visitor.client == null) return;
        visitor.portal ??= createPortalView({
            page,
            client: visitor.client,
            getScope: () => ({ ownerId, revision: visitor.revision }),
            run,
            status,
            confirm: confirmCurrent,
            recovery:
                connection == null
                    ? undefined
                    : {
                          journal: recovery,
                          owner: recoveryOwner(
                              connection.apiOrigin,
                              connection.input.shareId,
                              page
                          ),
                      },
            openChild: (child, context, scope, recoveryHandoff, queries) => {
                if (
                    recoveryHandoff?.newAttempt != null ||
                    recoveryHandoff?.candidate != null
                )
                    visitor.drafts.clear();
                visitor.formLoadVersion = ++formLoadSequence;
                visitor.recoveryCandidate = recoveryHandoff?.candidate ?? null;
                visitor.preparedAttempt = recoveryHandoff?.newAttempt ?? null;
                visitor.formAuthority = recoveryHandoff?.isCurrent ?? null;
                if (visitor.preparedAttempt != null)
                    visitor.preparedAttempt.loadVersion =
                        visitor.formLoadVersion;
                visitor.screen = child;
                visitor.formContext = context;
                visitor.formParentScope = scope;
                visitor.formQueries = {
                    ...structuredClone(
                        queries ?? { cascade: {}, save: {}, diagnostic: null }
                    ),
                    page: child,
                    loadVersion: visitor.formLoadVersion,
                };
                render();
            },
        });
        visitor.portal.refreshRecovery();
        screenNode.append(visitor.portal.node);
    }
};

connectionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const visitor of Object.values(visitors)) invalidate(visitor);
    try {
        const apiOrigin = inputById('api-origin').value.trim();
        const shareId = inputById('share-id').value.trim();
        const recordId = inputById('record-id').value.trim() || null;
        if (shareId === '') throw new Error('Enter the published share ID.');
        for (const visitor of Object.values(visitors))
            visitor.client = createMiniExtensionsClient({
                apiOrigin,
            });
        connection = {
            apiOrigin,
            input: {
                shareId,
                recordId,
                context: { type: 'direct-url' },
                query: currentConditionalPrefills(),
                clientTimeZone:
                    Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
        };
        render();
        load();
    } catch (error) {
        connection = null;
        for (const visitor of Object.values(visitors)) visitor.client = null;
        render();
        status(
            error instanceof Error
                ? error.message
                : 'Connection settings are invalid.',
            true
        );
    }
});
visitorSelect.addEventListener('change', () => {
    if (visitorSelect.value !== 'A' && visitorSelect.value !== 'B') return;
    if (visitorSelect.value === activeVisitor) return;
    cancelConfirmation();
    // Advance both owners even for A→B→A with no intervening helper call.
    for (const identity of [activeVisitor, visitorSelect.value] as const) {
        visitors[identity].revision += 1;
        visitors[identity].portal?.retireCollection();
    }
    request?.abort();
    request = null;
    activeVisitor = visitorSelect.value;
    setBusy(false);
    render();
    status(
        `Switched to Visitor ${activeVisitor}. No pending response can change this visitor's session.`
    );
});
nodeById('reload').addEventListener('click', load);
nodeById('logout').addEventListener('click', () => {
    recovery.scrubRetainedInput();
    const visitor = visitors[activeVisitor];
    visitor.client?.setSession({});
    invalidate(visitor);
    render();
    status('This visitor is anonymous again. Choose Reload to continue.');
});
nodeById('cancel').addEventListener('click', () => {
    request?.abort();
    request = null;
    setBusy(false);
    status(
        'Request cancelled. A write may already have committed; reload and inspect before submitting again.'
    );
});
nodeById('disconnect').addEventListener('click', () => {
    recovery.scrubRetainedInput();
    for (const visitor of Object.values(visitors)) {
        invalidate(visitor);
        visitor.client = null;
    }
    connection = null;
    render();
    status('Disconnected. Both visitor sessions have been cleared.');
    setBusy(false);
});
setBusy(false);
render();
