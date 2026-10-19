import type { ChildQuerySnapshots } from './childQueries.js';
import {
    createMiniExtensionsClient,
    DEFAULT_API_ORIGIN,
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
    type SessionRestoration,
    type AuthVerificationChallenge,
    type AuthCredentialGrant,
} from '@miniextensions/sdk/auth';
import {
    composeFormFieldVisibility,
    createFormFieldBindings,
    createFormPageOwner,
    FormPageError,
    createFormSaveInput,
    normalizeFormSaveResult,
    openLoadedFormDraft,
    type FormFieldVisibility,
    type FormAttachmentController,
    type FormPageOwner,
    type FormPageSnapshot,
    type FormControllerSaveOptions,
} from '@miniextensions/sdk/forms';
import {
    getSelectFieldPolicy,
    type SelectionLoader,
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
import {
    displayValue,
    formFieldControl,
    mountBoundFormField,
    canPresentFieldValidation,
    type FieldControl,
} from './fields.js';
import { flatChoiceConditionRecord } from './choiceAvailability.js';
import { hasMaskedValuePolicy } from './privacy.js';
import { createPortalView, type PortalView } from './portal.js';
import { createLinkedChildPanel } from './linkedChildPanel.js';
import {
    createConditionalLinkedFilters,
    type ConditionalLinkedFilters,
} from './linkedFilters.js';
import {
    FormDraftStore,
    type FormDraftSnapshot,
    type ParentFormDraftScope,
} from './drafts.js';
import { prepareFormReviewRows, captureReviewDateContext } from './review.js';
import { createPendingFiles } from './pendingFiles.js';
import { formAttachmentControl } from './attachmentPresentation.js';
import { admittedAttachmentValues } from './attachmentUpload.js';
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

import { createRememberedSession } from './rememberedSession.js';
import {
    createBrowserCreateProgress,
    forgetBrowserCreateProgress,
    retireBrowserCreateProgress,
    type BrowserCreateProgress,
} from './progress.js';

type Visitor = {
    client: MiniExtensionsClient | null;
    remembered: ReturnType<typeof createRememberedSession> | null;
    pendingSessionCleanup: Set<ReturnType<typeof createRememberedSession>>;
    authentication: SessionRestoration | null;
    restorationError: {
        page: Extract<
            LoadExtensionResult,
            { extensionScreen: 'password' | 'login_page' }
        >;
        message: string;
    } | null;
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
    verification: {
        loginPage: LoginPageResult;
        verificationId: string;
        challenge?: AuthVerificationChallenge;
    } | null;
};
const newVisitor = (): Visitor => ({
    client: null,
    remembered: null,
    pendingSessionCleanup: new Set(),
    authentication: null,
    restorationError: null,
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
// Presentation identity stays local to the example, outside the native journal.
// A null identity denotes only the fixed, non-sensitive attachment notice.
const retainedInputFields = new WeakMap<
    RecoveryAttempt['retainedInput'][number],
    string | null
>();
let formLoadSequence = 0;
let connection: {
    apiOrigin: string;
    remember: boolean;
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
            : `Visitor ${activeVisitor} · ${count === 0 ? 'Anonymous' : 'Authenticated session'} · ${visitor.remembered ? 'remembering opted in for this tab' : 'memory only'}${visitor.pendingSessionCleanup.size > 0 ? ' · storage cleanup pending' : ''}`;
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
            const statusCode = error instanceof SDKError ? error.status : null;
            const httpStatus =
                typeof statusCode === 'number' &&
                Number.isInteger(statusCode) &&
                statusCode >= 100 &&
                statusCode <= 599
                    ? ` · HTTP ${statusCode}`
                    : '';
            status(
                `The request failed. Reload and inspect the current state before deciding whether to retry.${httpStatus}`,
                true
            );
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
    for (const [identity, owned] of Object.entries(visitors))
        if (owned === visitor) retireBrowserCreateProgress(identity);
    cancelConfirmation();
    visitor.portal?.destroy();
    visitor.remembered?.destroy();
    visitor.authentication = null;
    visitor.restorationError = null;
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
    const replacementRevision = visitor.revision + 1;
    const replacementClient = visitor.client;
    for (const [identity, owned] of Object.entries(visitors))
        if (owned === visitor)
            void forgetBrowserCreateProgress(identity).then((complete) => {
                if (
                    !complete &&
                    visitors[activeVisitor] === visitor &&
                    visitor.revision === replacementRevision &&
                    visitor.client === replacementClient
                )
                    status(
                        'Remembered answers could not be fully cleared. Clear this tab’s session storage before sharing it.',
                        true
                    );
            });
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

const acceptRootLoad = (
    visitor: Visitor,
    result: LoadExtensionResult,
    query: RuntimeQuery
): void => {
    // A fresh accepted read replaces this visitor's memory draft, never an old response.
    visitor.drafts.clear();
    visitor.uncertainFormDraftScopes.clear();
    visitor.portal?.destroy();
    visitor.screen = result;
    visitor.formLoadVersion = ++formLoadSequence;
    visitor.recoveryCandidate = null;
    visitor.preparedAttempt = null;
    visitor.formAuthority = null;
    visitor.root = result.extensionScreen === 'portal_loaded' ? result : null;
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
};
const load = (sessionNotice?: string): void => {
    cancelConfirmation();
    void run(
        'Loading the published extension…',
        async ({ visitor, client, signal, current }) => {
            if (connection == null) return;
            const query = structuredClone(connection.input.query ?? {});
            let result = await client.loadExtension(connection.input, {
                signal,
            });
            if (!current()) return;
            if (
                visitor.remembered &&
                (result.extensionScreen === 'password' ||
                    result.extensionScreen === 'login_page')
            ) {
                const provisional = result;
                const adapter = visitor.remembered.prepare(provisional);
                visitor.authentication = adapter;
                visitor.restorationError = null;
                status('Checking this visitor’s remembered session…');
                const cancel = () => {
                    adapter.destroy();
                    if (visitor.authentication === adapter) {
                        visitor.authentication = null;
                        visitor.restorationError = {
                            page: provisional,
                            message:
                                'Session restoration was cancelled. Retry or continue with login explicitly.',
                        };
                    }
                };
                signal.addEventListener('abort', cancel, { once: true });
                let restored: LoadExtensionResult | null;
                try {
                    restored = await adapter.restore();
                } finally {
                    signal.removeEventListener('abort', cancel);
                }
                if (!current()) return;
                const state = adapter.getSnapshot();
                if (restored && state.phase === 'restored') result = restored;
                else if (state.phase !== 'login-required') {
                    visitor.restorationError = {
                        page: provisional,
                        message:
                            state.message ??
                            'The remembered session could not be checked.',
                    };
                    render();
                    status(
                        'Session not restored. Retry or explicitly continue with login.',
                        true
                    );
                    return;
                }
            }
            visitor.remembered?.accept(result, current);
            if (!current()) return;
            visitor.restorationError = null;
            acceptRootLoad(visitor, result, query);
            render();
            const loadedMessage =
                result.extensionScreen == null
                    ? 'The extension requested a redirect.'
                    : `Loaded ${result.extensionScreen.replaceAll('_', ' ')}.`;
            status(
                sessionNotice == null
                    ? loadedMessage
                    : `${sessionNotice} ${loadedMessage}`
            );
        }
    );
};

/** A successful user submission may continue with one read after its busy lease ends. */
const continueAfterSessionApplied = (
    visitor: Visitor,
    notice: string,
    signal: AbortSignal
): (() => void) => {
    const identity = activeVisitor;
    const client = visitor.client;
    const revision = visitor.revision;
    return () => {
        if (
            connection != null &&
            !signal.aborted &&
            request == null &&
            activeVisitor === identity &&
            visitors[identity] === visitor &&
            visitor.client === client &&
            visitor.revision === revision
        )
            load(notice);
    };
};

const applyLogin = (
    visitor: Visitor,
    page: LoginPageResult,
    token: string,
    signal: AbortSignal,
    grant?: AuthCredentialGrant
): (() => void) | undefined => {
    if (visitor.client == null) return;
    if (grant && visitor.authentication)
        visitor.authentication.applySession(grant);
    const rememberedMessage = grant
        ? visitor.authentication?.getSnapshot().message
        : null;
    replaceSession(
        visitor,
        grant
            ? visitor.client.getSession()
            : withLoginToken(visitor.client.getSession(), {
                  extensionId: page.extensionId,
                  tableId: page.payload.tableId,
                  loginFieldNames: page.payload.loginFieldNames,
                  encryptedLoginToken: token,
              })
    );
    visitor.screen = null;
    render();
    const notice = rememberedMessage ?? 'Login applied to this visitor.';
    status(notice);
    return continueAfterSessionApplied(visitor, notice, signal);
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
        let continueLoading: (() => void) | undefined;
        void run(
            'Verifying the password…',
            async ({ visitor, client, signal, current }) => {
                const flow = visitor.authentication?.flow;
                const result =
                    flow?.screen === 'password'
                        ? await flow.verifyPassword(
                              { extensionPassword: password.value },
                              { signal }
                          )
                        : await client.auth.verifyExtensionPassword(
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
                if ('grant' in result)
                    visitor.authentication!.applySession(result.grant);
                const rememberedMessage =
                    'grant' in result
                        ? visitor.authentication?.getSnapshot().message
                        : null;
                replaceSession(
                    visitor,
                    'grant' in result
                        ? client.getSession()
                        : withExtensionPassword(client.getSession(), {
                              extensionId: page.extensionId,
                              encryptedExtensionPassword:
                                  result.encryptedExtensionPassword,
                          })
                );
                visitor.screen = null;
                render();
                const notice =
                    rememberedMessage ?? 'Password applied to this visitor.';
                status(notice);
                continueLoading = continueAfterSessionApplied(
                    visitor,
                    notice,
                    signal
                );
            }
        ).then(() => continueLoading?.());
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
        let continueLoading: (() => void) | undefined;
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
                const flow = owner.authentication?.flow;
                const result =
                    flow?.screen === 'login_page'
                        ? await flow.login({ loginCredentials }, { signal })
                        : await client.auth.login(
                              {
                                  extensionId: page.extensionId,
                                  loginCredentials,
                              },
                              { signal }
                          );
                if (!current()) return;
                if (result.type === 'found-record')
                    continueLoading = applyLogin(
                        owner,
                        page,
                        'encryptedLoginToken' in result
                            ? result.encryptedLoginToken
                            : '',
                        signal,
                        'grant' in result ? result.grant : undefined
                    );
                else if (result.type === 'no-record')
                    status('No matching login record was found.', true);
                else {
                    owner.verification = {
                        loginPage: page,
                        verificationId:
                            'verificationId' in result
                                ? result.verificationId
                                : '',
                        ...('challenge' in result
                            ? { challenge: result.challenge }
                            : {}),
                    };
                    render();
                    status(
                        `A verification ${result.verificationType === 'email' ? 'email' : 'message'} was sent to ${getLoginVerificationDestination(page, result)}.`
                    );
                }
            }
        ).then(() => continueLoading?.());
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
            let continueLoading: (() => void) | undefined;
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
                    const flow = owner.authentication?.flow;
                    const grant =
                        flow?.screen === 'login_page' && verification.challenge
                            ? await flow.confirmVerificationCode(
                                  {
                                      challenge: verification.challenge,
                                      verificationCode,
                                  },
                                  { signal }
                              )
                            : null;
                    const result = grant
                        ? null
                        : await client.auth.confirmVerificationCode(
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
                        continueLoading = applyLogin(
                            owner,
                            verification.loginPage,
                            result?.encryptedLoginToken ?? '',
                            signal,
                            grant ?? undefined
                        );
                }
            ).then(() => continueLoading?.());
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
                const currentBack = (): boolean =>
                    !formRetired &&
                    card.isConnected &&
                    visitors[activeVisitor] === visitor &&
                    visitor.screen === page &&
                    visitor.formLoadVersion === loadVersion;
                if (!currentBack()) return;
                const pending = mayUseForm() && pendingFiles.pending();
                if (!currentBack()) return;
                if (pending) {
                    status(
                        'Upload or clear pending file selections before returning to the Portal.',
                        true
                    );
                    return;
                }
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
    let reviewIntentRevision = 0;
    let formRetired = false;
    let updateValidationPresentation = (): void => {};
    let updateRecoveryReferences = (): void => {};
    let formProgress: BrowserCreateProgress | null = null;
    let progressInputRevision = 0;
    let progressSaveCleanups = 0;
    let activeUpload: RecoveryAttempt | null = null;
    let pageReviewPresentation: AbortController | null = null;
    let retirePageReview = (): void => {};
    const controls = new Map<string, FieldControl>();
    const childPanels = new Map<
        string,
        ReturnType<typeof createLinkedChildPanel>
    >();
    const childBlocksParent = () =>
        [...childPanels.values()].some((panel) => panel.blocksParent());
    let updateChildParentActivity = () => {};
    const manualPages =
        settings(page.payload.publicFields).multiPageFormMode === 'multi-page';
    let formPages: FormPageOwner | null = null;
    let currentPageFields: Set<string> | null = null;
    const pageFields = new Map<string, HTMLDivElement>();
    const inCurrentPage = (id: string): boolean =>
        currentPageFields == null || currentPageFields.has(id);
    let updatePageNavigation = (_snapshot?: FormPageSnapshot): void => {};
    let updateSelectAvailability = (): void => {};
    const linkedFilterViews = new Map<string, ConditionalLinkedFilters>();
    const formClient = visitor.client;
    const formRevision = visitor.revision;
    const formSession = formClient == null ? null : sessionKey(formClient);
    const ownsLinkedRender = (): boolean =>
        ownsForm() &&
        visitor.client === formClient &&
        visitor.revision === formRevision &&
        formClient != null &&
        sessionKey(formClient) === formSession;
    const ownsLinkedFilters = (): boolean => mayUseForm() && ownsLinkedRender();
    // Constructors may read the epoch before the normalized observer exists.
    // All accepted owners begin at zero; later observations use the same clock.
    let bindingConfigurationRevision = () => 0;
    // The controller's accepted-render fence must be live before its first snapshot.
    screenNode.append(card);
    const bindingOwner =
        formClient == null || !ownsForm()
            ? null
            : createFormFieldBindings({
                  client: formClient,
                  loaded: page,
                  configurationRevision: () => bindingConfigurationRevision(),
                  store: visitor.drafts,
                  parent: visitor.formParentScope,
                  saveOptions: {
                      captchaVal: null,
                      isComputeMode: false,
                      searchQuery: saveQuery,
                      context,
                      conditionalLinkedRecordFieldIdsToFilteringValues: {},
                  },
                  getScope: () => ({
                      ownerId: String(activeVisitor),
                      revision: visitor.revision,
                  }),
                  isCurrent: () =>
                      ownsForm() &&
                      !formRetired &&
                      visitor.client === formClient,
                  canWrite: mayUseForm,
                  canWriteField: (id) =>
                      manualPages || fieldVisibility[id]?.type === 'visible',
              });
    const configurationKey = (
        schemas = page.payload.fieldIdsToSchemas
    ): string =>
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
            schemas,
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
            pageReviewPresentation?.abort();
        }
        return reviewConfigurationRevision;
    };
    // Successful Add Choice installs native choices into this accepted owner.
    // Keep every other configuration change in the navigation epoch.
    const navigationConfigurationKey = (): string => {
        const schemas = structuredClone(page.payload.fieldIdsToSchemas);
        for (const schema of Object.values(schemas)) {
            const config = schema.airtableField.config;
            if (
                (schema.fieldType === 'singleSelect' ||
                    schema.fieldType === 'multipleSelects') &&
                config.type === schema.fieldType &&
                config.options != null &&
                Object.hasOwn(config.options, 'choices') &&
                Array.isArray(config.options.choices)
            )
                config.options.choices = [];
        }
        return configurationKey(schemas);
    };
    let navigationConfiguration = navigationConfigurationKey();
    let navigationConfigurationRevision = 0;
    const observeNavigationConfiguration = (): number => {
        const next = navigationConfigurationKey();
        if (next !== navigationConfiguration) {
            navigationConfiguration = next;
            navigationConfigurationRevision++;
        }
        return navigationConfigurationRevision;
    };
    bindingConfigurationRevision = observeNavigationConfiguration;
    const pendingPanel = element('section');
    pendingPanel.setAttribute('aria-label', 'Pending attachment selections');
    const pendingInputs = new Set<HTMLInputElement>();
    const pendingStatuses = new Map<HTMLInputElement, HTMLElement>();
    const pendingControllers = new Map<
        HTMLInputElement,
        FormAttachmentController
    >();
    const clearPending = button('Clear pending files', () => {
        let cleared = false;
        for (const input of pendingInputs)
            if (
                pendingFiles.capture(input) != null &&
                pendingFiles.clear(input)
            ) {
                pendingControllers.get(input)?.clear();
                cleared = true;
            }
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
            for (const [input, model] of pendingControllers) {
                const captured = pendingFiles.capture(input);
                if (captured == null) model.clear();
                else model.select([captured.file]);
            }
            pageReviewPresentation?.abort();
            if (reviewPending) cancelConfirmation();
        }
    );
    let metadataPromise: Promise<RuntimeTableStates> | null = null;
    const linkedPresentation = createLinkedReviewPresentation(
        page,
        ownsLinkedRender
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
                if (
                    schema?.airtableField.id !== fieldId ||
                    control == null ||
                    fieldVisibility[fieldId]?.type !== 'visible'
                )
                    return [];
                const config = schema.miniExtConfig;
                // Masked values must never enter the reference journal.
                if (hasMaskedValuePolicy(config)) return [];
                if (schema.fieldType === AirtableFieldType.MULTIPLE_ATTACHMENTS)
                    return [];
                if (!control.editable) return [];
                const text = displayValue(snapshot!.data[fieldId]);
                const entry = { title: schema.airtableField.name, value: text };
                retainedInputFields.set(entry, fieldId);
                return [entry];
            }
        );
        if (
            selectedFile != null ||
            (snapshot?.dirtyFieldIds ?? []).some(
                (fieldId) =>
                    page.payload.fieldIdsToSchemas[fieldId]?.fieldType ===
                    AirtableFieldType.MULTIPLE_ATTACHMENTS
            )
        ) {
            const notice = {
                title: 'Attachment activity',
                value: 'Attachment details are not retained.',
            };
            retainedInputFields.set(notice, null);
            attempt.retainedInput.push(notice);
        }
    };
    const formControlDisposers: Array<() => void> = [];
    disposeFormControls = () => {
        formRetired = true;
        updateValidationPresentation = () => {};
        updateRecoveryReferences = () => {};
        retirePageReview();
        formProgress?.retire();
        formPages?.dispose();
        for (const panel of childPanels.values()) {
            panel.destroy();
            panel.close();
        }
        childPanels.clear();
        for (const stop of formControlDisposers) stop();
        bindingOwner?.destroy();
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
    if (manualPages) {
        const rejectInactiveInput = (event: Event): void => {
            if (!(event.target instanceof HTMLElement)) return;
            const id = event.target
                .closest('[data-form-page-field-id]')
                ?.getAttribute('data-form-page-field-id');
            if (id == null || inCurrentPage(id)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        for (const type of [
            'beforeinput',
            'input',
            'change',
            'click',
            'keydown',
            'compositionstart',
            'compositionupdate',
            'compositionend',
        ])
            fields.addEventListener(type, rejectInactiveInput, true);
    }
    const observeProgressInput = () => {
        progressInputRevision++;
        pageReviewPresentation?.abort();
        formProgress?.changed();
    };
    fields.addEventListener('input', observeProgressInput, true);
    fields.addEventListener('change', observeProgressInput, true);
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
                    inCurrentPage(fieldId) &&
                    fieldVisibility[fieldId]?.type === 'visible'
            );
        }
        updatePageNavigation();
        for (const panel of childPanels.values()) panel.refresh();
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
        bindingOwner?.refresh();
        for (const [fieldId, control] of controls)
            control.node.hidden = fieldVisibility[fieldId]?.type !== 'visible';
        updateFormActivity();
        visibilityMessage.hidden = !Object.values(fieldVisibility).some(
            (result) => result.type === 'blocked'
        );
        updateValidationPresentation();
        updateRecoveryReferences();
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
                : bindingOwner == null
                  ? formFieldControl(
                        schema,
                        visitor.drafts.read(draft, fieldId),
                        () => {},
                        true
                    )
                  : mountBoundFormField(
                        bindingOwner.field(fieldId),
                        schema,
                        () => {
                            if (
                                !mayUseForm() ||
                                fieldVisibility[fieldId]?.type !== 'visible'
                            )
                                return;
                            if (reviewPending) cancelConfirmation();
                            try {
                                bindingOwner.refresh();
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
                        formClient == null
                            ? undefined
                            : {
                                  extensionAccessToken:
                                      page.payload.extensionAccessToken,
                                  reads: formClient.addresses,
                                  isCurrent: () =>
                                      ownsAddressReads() &&
                                      inCurrentPage(fieldId) &&
                                      fieldVisibility[fieldId]?.type ===
                                          'visible',
                              },
                        () => {
                            if (
                                mayUseForm() &&
                                fieldVisibility[fieldId]?.type === 'visible' &&
                                reviewPending
                            )
                                cancelConfirmation();
                        },
                        (error) => {
                            if (ownsForm())
                                status(
                                    error instanceof Error
                                        ? error.message
                                        : 'Invalid field value.',
                                    true
                                );
                        }
                    );
        controls.set(fieldId, control);
        if (manualPages) {
            const wrapper = element('div');
            wrapper.dataset.formPageFieldId = fieldId;
            wrapper.append(control.node);
            pageFields.set(fieldId, wrapper);
            fields.append(wrapper);
        } else fields.append(control.node);
        const config = schema.miniExtConfig;
        if (
            bindingOwner != null &&
            schema.fieldType === AirtableFieldType.MULTIPLE_RECORD_LINKS &&
            page.payload.hasParentExtension === false &&
            context.type === 'direct-url' &&
            visitor.root === null &&
            visitor.formParentScope === null &&
            config != null &&
            (('allowCreatingRecords' in config &&
                config.allowCreatingRecords === true) ||
                ('allowEditingRecords' in config &&
                    config.allowEditingRecords === true))
        ) {
            const configuration = observeNavigationConfiguration();
            let retired = false;
            const childCurrent = () => {
                if (
                    !ownsLinkedRender() ||
                    formRetired ||
                    observeNavigationConfiguration() !== configuration ||
                    !ownsLinkedRender()
                )
                    retired = true;
                return !retired;
            };
            const panel = createLinkedChildPanel({
                fields: bindingOwner,
                fieldId,
                recovery: { journal: recovery, loadVersion },
                isCurrent: childCurrent,
                isVisible: () =>
                    inCurrentPage(fieldId) &&
                    fieldVisibility[fieldId]?.type === 'visible',
                canStart: () =>
                    childCurrent() &&
                    mayUseForm() &&
                    !reviewPending &&
                    inCurrentPage(fieldId) &&
                    fieldVisibility[fieldId]?.type === 'visible' &&
                    request == null &&
                    !screenNode.inert &&
                    !fields.inert,
                request: (description, work) => {
                    void run(
                        description,
                        async ({ client, signal, current }) => {
                            if (client === formClient && childCurrent())
                                await work(
                                    signal,
                                    () => current() && childCurrent()
                                );
                        },
                        childCurrent,
                        // Configuration retirement rejects the result, but the
                        // same render still releases its global busy lease.
                        ownsLinkedRender
                    );
                },
                changed: () => updateChildParentActivity(),
                reconciled: () => {
                    if (!childCurrent()) return;
                    updateFieldVisibility();
                    updateSelectAvailability();
                },
                status,
            });
            childPanels.set(fieldId, panel);
            // A readonly parent editor is inert; child Edit remains an
            // independent configured action beside that native control.
            fields.append(panel.node);
        }
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
            choice.setAttribute('aria-label', 'New choice name');
            const creator = bindingOwner?.selectChoice(
                fieldId,
                { journal: recovery, scope, loadVersion },
                {
                    getLoaded: () => page,
                    isCurrent: () =>
                        ownsLinkedRender() && !reviewPending && !formRetired,
                    configurationRevision: observeReviewConfiguration,
                    canAccept: () =>
                        ownsLinkedRender() &&
                        !reviewPending &&
                        !formRetired &&
                        !(
                            candidate?.outcome === 'unknown' &&
                            candidate.acknowledgment === 'none'
                        ) &&
                        fieldVisibility[fieldId]?.type === 'visible',
                    onAttempt: () => updateRecovery(),
                }
            );
            if (creator != null) {
                const create = button('Create choice', () => {
                    if (!ownsLinkedRender() || reviewPending || request != null)
                        return;
                    const captured = choice.value;
                    void run(
                        'Creating the configured select choice…',
                        async ({ signal, current }) => {
                            const cancel = () => creator.cancel();
                            signal.addEventListener('abort', cancel, {
                                once: true,
                            });
                            try {
                                const accepted = await creator.create(captured);
                                if (!current() || !ownsLinkedRender()) return;
                                if (accepted) {
                                    const fresh =
                                        bindingOwner!.getLoaded().payload
                                            .fieldIdsToSchemas[fieldId]!;
                                    const freshConfig =
                                        fresh.airtableField.config;
                                    if (
                                        freshConfig.type !==
                                            AirtableFieldType.SINGLE_SELECT &&
                                        freshConfig.type !==
                                            AirtableFieldType.MULTIPLE_SELECTS
                                    )
                                        throw new Error(
                                            'The returned choice field is unavailable.'
                                        );
                                    schema.airtableField.config =
                                        structuredClone(freshConfig);
                                    const config = schema.airtableField.config;
                                    if (
                                        config.type === 'singleSelect' ||
                                        config.type === 'multipleSelects'
                                    )
                                        control.updateSelectChoices?.(
                                            config.options?.choices ?? []
                                        );
                                    control.write(
                                        bindingOwner!
                                            .field(fieldId)
                                            .getSnapshot().value ?? null
                                    );
                                    updateFieldVisibility();
                                    updateSelectAvailability();
                                    if (choice.value === captured)
                                        choice.value = '';
                                    status(
                                        creator.getSnapshot().phase ===
                                            'created-selected'
                                            ? 'Choice created and selected in the draft. Save to update the record.'
                                            : 'Choice created but not currently selectable. The record has not been saved.'
                                    );
                                } else
                                    status(
                                        creator.getSnapshot().error ??
                                            'This choice cannot be created with the current Form settings.',
                                        true
                                    );
                            } finally {
                                signal.removeEventListener('abort', cancel);
                                if (ownsLinkedRender()) updateRecovery();
                            }
                        },
                        ownsLinkedRender,
                        ownsLinkedRender
                    );
                });
                const stop = creator.subscribe((state) => {
                    if (!ownsLinkedRender()) return;
                    // Leave a blocked button reachable for explicit refusal/status, as other starter actions do.
                    create.disabled = state.busy || state.phase === 'retired';
                });
                formControlDisposers.push(stop);
                control.node.append(choice, create);
            }
        }

        if (schema.fieldType === AirtableFieldType.MULTIPLE_RECORD_LINKS) {
            const search = element('input');
            search.placeholder = 'Search available linked records';
            const choices = element('div', undefined, 'choice-list');
            let offset: string | null = null;
            let generation = 0;
            let requestVersion = 0;
            let conditionalFilters: ConditionalLinkedFilters | null = null;
            let currentLoader: SelectionLoader | null = null;
            let loaderInstalled = false;
            const resetChoices = (): void => {
                generation += 1;
                requestVersion += 1;
                offset = null;
                choices.replaceChildren();
                moreButton.disabled = true;
                if (bindingOwner != null) {
                    bindingOwner.setLinkedLoader(fieldId, (request) => {
                        if (currentLoader == null)
                            throw new Error('No linked read is active.');
                        return currentLoader(request);
                    });
                    loaderInstalled = true;
                }
            };
            const fetchOptions = (more: boolean): void => {
                if (!ownsLinkedFilters() || (more && offset == null)) return;
                if (!more) resetChoices();
                const capturedGeneration = generation;
                const capturedRequest = ++requestVersion;
                const capturedFilterRevision = conditionalFilters?.revision();
                const capturedSearch = search.value;
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
                        let result: ListLinkedRecordOptionsResult | undefined;
                        try {
                            if (bindingOwner == null) return;
                            const model =
                                bindingOwner.field(fieldId).selection!;
                            currentLoader = async (request) => {
                                const abort = () => model.cancel();
                                signal.addEventListener('abort', abort, {
                                    once: true,
                                });
                                try {
                                    const response =
                                        await client.linkedRecords.listFormOptions(
                                            {
                                                extensionAccessToken:
                                                    page.payload
                                                        .extensionAccessToken,
                                                linkedRecordFieldId: fieldId,
                                                filter: {
                                                    viewType: 'list',
                                                    searchTerm:
                                                        request.searchTerm,
                                                },
                                                offset: request.offset,
                                                conditionalLinkedRecordFilteringValues:
                                                    filterValues,
                                            },
                                            {
                                                signal: request.signal,
                                                session: client.getSession(),
                                            }
                                        );
                                    if (!accepted())
                                        throw new Error(
                                            'This linked read is no longer current.'
                                        );
                                    result = response;
                                    return {
                                        options: response.records.map(
                                            (record) => ({
                                                value: record.id,
                                                label: 'Linked record',
                                            })
                                        ),
                                        offset: response.offset,
                                    };
                                } finally {
                                    signal.removeEventListener('abort', abort);
                                }
                            };
                            if (!loaderInstalled) {
                                bindingOwner.setLinkedLoader(
                                    fieldId,
                                    (request) => {
                                        if (currentLoader == null)
                                            throw new Error(
                                                'No linked read is active.'
                                            );
                                        return currentLoader(request);
                                    }
                                );
                                loaderInstalled = true;
                            }
                            if (more) await model.loadMore();
                            else await model.setSearchTerm(capturedSearch);
                            if (model.getState().error != null)
                                throw new Error(model.getState().error!);
                            if (result == null) return;
                        } catch (error) {
                            if (!accepted()) return;
                            throw error;
                        }
                        if (!accepted()) return;
                        if (result == null) return;
                        linkedPresentation.acceptOptions(fieldId, result);
                        bindingOwner?.setLinkedOptions(
                            fieldId,
                            result.records.map((record) => ({
                                value: record.id,
                                label: 'Linked record',
                            })),
                            more
                        );
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
                                bindingOwner
                                    ?.field(fieldId)
                                    .selection?.choose([...selected]);
                                control.write(
                                    visitor.drafts.read(draft, fieldId) ?? null
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
            let uploadAttempt: RecoveryAttempt | null = null;
            const uploadModel = bindingOwner?.attachment(
                fieldId,
                {
                    journal: recovery,
                    scope,
                    loadVersion,
                },
                {
                    getLoaded: () => page,
                    isCurrent: ownsLinkedRender,
                    configurationRevision: observeReviewConfiguration,
                    onAttempt: (attempt) => {
                        uploadAttempt = activeUpload = attempt;
                        retainInput(attempt, { fieldId });
                        updateRecovery();
                    },
                }
            );
            if (uploadModel != null) pendingControllers.set(file, uploadModel);
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
                            if (
                                uploadModel == null ||
                                !uploadModel.select([selected])
                            )
                                return;
                            const abortUpload = () => uploadModel.cancel();
                            signal.addEventListener('abort', abortUpload, {
                                once: true,
                            });
                            try {
                                const accepted = await uploadModel.upload();
                                if (!ownsUploadUI() || !current()) return;
                                if (!accepted) {
                                    status(
                                        'Upload outcome needs inspection; it was not added to the draft.',
                                        true
                                    );
                                    return;
                                }
                                // The SDK committed and accepted before any renderer callback.
                                try {
                                    control.write(
                                        visitor.drafts.read(draft, fieldId) ??
                                            null
                                    );
                                    updateFieldVisibility();
                                    updateSelectAvailability();
                                } finally {
                                    if (
                                        ownsUploadUI() &&
                                        pendingFiles.clear(file, selection)
                                    )
                                        uploadModel.clear();
                                }
                                status(
                                    'File uploaded. Choose Save to attach it to the record.'
                                );
                            } catch {
                                if (ownsUploadUI() && current())
                                    status(
                                        uploadAttempt?.outcome === 'uploaded'
                                            ? 'The attachment was added to the draft; reopen the Form to refresh its presentation.'
                                            : 'Upload outcome needs inspection; it was not added to the draft.',
                                        true
                                    );
                            } finally {
                                signal.removeEventListener(
                                    'abort',
                                    abortUpload
                                );
                                if (activeUpload === uploadAttempt)
                                    activeUpload = null;
                                if (ownsUploadRender()) {
                                    updateRecovery();
                                    if (
                                        current() &&
                                        uploadAttempt?.outcome === 'unknown'
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
    const progressConnection = connection;
    if (
        bindingOwner != null &&
        progressConnection != null &&
        progressConnection.input.recordId === null &&
        visitor.root === null &&
        visitor.formParentScope === null &&
        context.type === 'direct-url' &&
        page.payload.hasParentExtension === false &&
        Object.keys(formClient?.getSession() ?? {}).length === 0 &&
        candidate == null &&
        visitor.preparedAttempt == null &&
        mayUseForm()
    ) {
        formProgress = createBrowserCreateProgress({
            page,
            visitor: activeVisitor,
            apiOrigin: progressConnection.apiOrigin,
            shareId: progressConnection.input.shareId,
            report: status,
            isCurrent: () =>
                ownsLinkedRender() &&
                !formRetired &&
                connection === progressConnection &&
                visitor.root === null &&
                visitor.formParentScope === null &&
                visitor.formContext === context &&
                formClient != null &&
                Object.keys(formClient.getSession()).length === 0 &&
                mayUseForm(),
            getDraft: () => bindingOwner.controller.getState().draft,
            getRevision: () => visitor.drafts.revision(draft),
            getInputRevision: () =>
                progressInputRevision + pendingFiles.revision(),
            restore: async (values, accepts, consume) => {
                if (request != null || !ownsLinkedFilters()) return;
                const restoreRevision = visitor.drafts.revision(draft);
                const restoreInputRevision =
                    progressInputRevision + pendingFiles.revision();
                if (
                    restoreRevision !== 0 ||
                    restoreInputRevision !== 0 ||
                    pendingFiles.pending()
                )
                    return;
                await run(
                    'Checking remembered answers against the current Form…',
                    async ({ client, signal, current }) => {
                        const query = structuredClone(
                            progressConnection.input.query ?? {}
                        );
                        const result = await client.loadExtension(
                            {
                                ...progressConnection.input,
                                query,
                                context: {
                                    type: 'direct-url',
                                    localStorageRecord: values,
                                },
                            },
                            { signal, session: {} }
                        );
                        if (!current() || !ownsLinkedFilters()) return;
                        if (
                            visitor.drafts.revision(draft) !==
                                restoreRevision ||
                            progressInputRevision + pendingFiles.revision() !==
                                restoreInputRevision ||
                            pendingFiles.pending()
                        ) {
                            status(
                                'Current answers were retained. Reload replaces current inputs before Restore can be used.',
                                true
                            );
                            return;
                        }
                        if (
                            result.extensionScreen !== 'form_loaded' ||
                            !accepts(result)
                        ) {
                            status(
                                'Remembered answers were not restored because the Form or its access configuration changed.',
                                true
                            );
                            return;
                        }
                        if (
                            !(await consume(
                                () =>
                                    current() &&
                                    ownsLinkedFilters() &&
                                    visitor.drafts.revision(draft) ===
                                        restoreRevision &&
                                    progressInputRevision +
                                        pendingFiles.revision() ===
                                        restoreInputRevision &&
                                    !pendingFiles.pending()
                            )) ||
                            !current() ||
                            !ownsLinkedFilters() ||
                            !accepts(result) ||
                            visitor.drafts.revision(draft) !==
                                restoreRevision ||
                            progressInputRevision + pendingFiles.revision() !==
                                restoreInputRevision ||
                            pendingFiles.pending()
                        ) {
                            status(
                                'Remembered answers could not be safely accepted. The current Form was retained.',
                                true
                            );
                            return;
                        }
                        acceptRootLoad(visitor, result, query);
                        render();
                        status(
                            'Remembered answers restored after a fresh read. No record was saved.'
                        );
                    },
                    ownsLinkedRender,
                    () =>
                        visitors[activeVisitor] === visitor &&
                        visitor.client === formClient &&
                        visitor.revision === formRevision &&
                        connection === progressConnection
                );
            },
        });
        if (formProgress) {
            card.append(formProgress.node);
            let progressRevision = visitor.drafts.revision(draft);
            formControlDisposers.push(
                bindingOwner.controller.subscribe((state) => {
                    if (state.draftRevision === progressRevision) return;
                    progressRevision = state.draftRevision;
                    formProgress?.changed();
                })
            );
        }
    }
    const errors = element('ul', undefined, 'error-list');
    errors.setAttribute('role', 'alert');
    const uncertainSaveMessage =
        'We could not confirm the earlier attempt. It may have completed. Check the latest requests before taking another action.';
    if (visitor.uncertainFormDraftScopes.has(draft.scope))
        errors.append(element('li', uncertainSaveMessage));
    card.append(errors);
    const navigation = element('section');
    navigation.setAttribute('aria-label', 'Form pages');
    navigation.hidden = true;
    const pageCounter = element('p');
    pageCounter.setAttribute('aria-live', 'polite');
    const pageTitle = element('h3');
    const pageProblems = element('ul', undefined, 'error-list');
    pageProblems.setAttribute('role', 'status');
    navigation.append(pageCounter, pageTitle, pageProblems);
    if (manualPages) card.append(navigation);
    const actions = element('div', undefined, 'actions');
    const submit = element('button', 'Save');
    submit.type = 'submit';
    submit.disabled = visitor.uncertainFormDraftScopes.has(draft.scope);
    const readCurrentPage = (): void => {
        for (const [fieldId, control] of controls)
            if (
                control.editable &&
                inCurrentPage(fieldId) &&
                fieldVisibility[fieldId]?.type === 'visible'
            )
                control.read();
    };
    const navigate = (direction: 'back' | 'next'): void => {
        if (
            formPages == null ||
            !ownsLinkedRender() ||
            formRetired ||
            request != null ||
            reviewPending ||
            !mayUseForm() ||
            childBlocksParent()
        )
            return;
        if (pendingFiles.pending()) {
            status(
                'Upload or clear the selected file before changing pages.',
                true
            );
            return;
        }
        try {
            if (direction === 'next') readCurrentPage();
            updateFieldVisibility();
            const snapshot = formPages.getSnapshot();
            const result = formPages[direction](snapshot.revision);
            updatePageNavigation();
            if (!result.accepted)
                status(
                    'Review the current page before continuing. No Save was sent.',
                    true
                );
        } catch (error) {
            status(
                error instanceof Error
                    ? error.message
                    : 'Review the current page before continuing.',
                true
            );
        }
    };
    const back = button('Back', () => navigate('back'));
    const next = button('Next', () => navigate('next'));
    if (manualPages) actions.append(back, next);
    actions.append(submit);
    const discard = button('Discard draft', async () => {
        if (
            childBlocksParent() ||
            !ownsForm() ||
            recovery.blocking(scope, recordId) != null ||
            (candidate?.outcome === 'unknown' &&
                candidate.acknowledgment === 'none')
        ) {
            status(uncertainSaveMessage, true);
            return;
        }
        const discardRequest = request;
        const discardReviewRevision = reviewIntentRevision;
        const discardDraftRevision = visitor.drafts.revision(draft);
        const discardInputRevision =
            progressInputRevision + pendingFiles.revision();
        const discardConfiguration = observeReviewConfiguration();
        if (formProgress && !(await formProgress.discard())) return;
        if (
            !ownsLinkedRender() ||
            formRetired ||
            !mayUseForm() ||
            childBlocksParent()
        )
            return;
        if (
            (request != null && request !== discardRequest) ||
            reviewIntentRevision !== discardReviewRevision ||
            progressSaveCleanups > 0
        ) {
            if (progressSaveCleanups === 0) formProgress?.resume();
            return;
        }
        if (
            visitor.drafts.revision(draft) !== discardDraftRevision ||
            progressInputRevision + pendingFiles.revision() !==
                discardInputRevision ||
            observeReviewConfiguration() !== discardConfiguration
        ) {
            formProgress?.resume();
            status(
                'The Form changed while remembered answers were cleared. Review it before discarding the current draft.',
                true
            );
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
                const mayDelete = () => mayUseForm() && !childBlocksParent();
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
                        // A completed Delete invalidates the cached parent
                        // membership and cursor. Retained Back controls must
                        // not reconstruct that Portal before an explicit Reload.
                        const retiredPortal = visitor.portal;
                        visitor.portal = null;
                        visitor.root = null;
                        visitor.screen = null;
                        visitor.formContext = { type: 'direct-url' };
                        visitor.formParentScope = null;
                        visitor.formQueries = null;
                        visitor.formAuthority = null;
                        visitor.recoveryCandidate = null;
                        visitor.preparedAttempt = null;
                        visitor.drafts.discard(draft);
                        retiredPortal?.destroy();
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
    const recoveryReferences = element('div');
    updateRecoveryReferences = (): void => {
        recoveryReferences.replaceChildren();
        if (formRetired || !ownsForm()) return;
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
            const referenceFields = earlier.retainedInput.flatMap((field) => {
                if (formRetired || !ownsForm()) return [];
                const fieldId = retainedInputFields.get(field);
                if (fieldId === null)
                    return [
                        {
                            title: 'Attachment activity',
                            value: 'Attachment details are not retained.',
                        },
                    ];
                if (fieldId === undefined) return [];
                const schema = page.payload.fieldIdsToSchemas[fieldId];
                // Reload or a local edit may mask, hide or remove a public field.
                // Resolve exact accepted identity before reading retained text.
                if (
                    !page.payload.fieldIdsInForm.includes(fieldId) ||
                    schema?.airtableField.id !== fieldId ||
                    fieldVisibility[fieldId]?.type !== 'visible' ||
                    hasMaskedValuePolicy(schema.miniExtConfig)
                )
                    return [];
                return [
                    { title: schema.airtableField.name, value: field.value },
                ];
            });
            if (referenceFields.length === 0) continue;
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
            for (const field of referenceFields)
                reference.append(
                    element('p', `${field.title}: ${field.value}`)
                );
            recoveryReferences.append(reference);
        }
    };
    const updateRecovery = (): void => {
        const pending = recovery.blocking(scope, recordId);
        const selected =
            candidate?.outcome === 'unknown' &&
            candidate.acknowledgment === 'none'
                ? candidate
                : null;
        const expired = !(visitor.formAuthority?.() ?? true);
        const blocked = pending != null || selected != null || expired;
        submit.disabled = blocked || childBlocksParent();
        discard.disabled = submit.disabled;
        if (deleteRecord != null) deleteRecord.disabled = submit.disabled;
        updateComments();
        fields.inert = blocked;
        updateFormActivity();
        recoveryPanel.replaceChildren();
        if (visitor.preparedAttempt?.outcome === 'not-submitted')
            recoveryPanel.append(
                element(
                    'p',
                    `New local attempt: ${visitor.preparedAttempt.id}. No Form save has been submitted for this local attempt.`
                )
            );
        updateRecoveryReferences();
        recoveryPanel.append(recoveryReferences);
        const attempt = selected ?? pending;
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
            element(
                'p',
                `${attempt.id}: ${attempt.operation === 'choice' ? 'Choice creation outcome is unknown; the record has not been saved by this action.' : uncertainSaveMessage}`
            )
        );
        if (attempt.operation === 'choice')
            recoveryPanel.append(
                element(
                    'p',
                    'The choice may have been created. Inspect current choices before acknowledging a new intent; it will not be created again automatically. This is separate from record Save.'
                )
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
        if (
            attempt.operation === 'choice' &&
            !expired &&
            !attempt.flight &&
            loadVersion > attempt.loadVersion
        )
            recoveryPanel.append(
                button('Acknowledge inspected choice outcome', async () => {
                    const observed = observeReviewConfiguration();
                    if (
                        !(await confirmCurrent({
                            title: 'Choices inspected?',
                            message:
                                'Inspect the freshly loaded choices first. This acknowledges a separate new intent without declaring the earlier creation failed or retrying it. No choice or record will be created by this acknowledgment.',
                            confirmLabel: 'Acknowledge inspection',
                        })) ||
                        !ownsLinkedRender() ||
                        observed !== observeReviewConfiguration() ||
                        attempt.flight ||
                        recovery.blocking(scope, recordId) !== attempt
                    )
                        return;
                    recovery.acknowledgeNewIntent(attempt);
                    bindingOwner?.refresh();
                    updateRecovery();
                    status(
                        'Earlier choice outcome remains unknown. Any new creation or Save requires its own explicit action.'
                    );
                })
            );
        const freshKnownRecord =
            attempt.operation !== 'choice' &&
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
    const clearProgressBeforeSave = async (
        current: () => boolean
    ): Promise<boolean> => {
        const progressDraftRevision = visitor.drafts.revision(draft);
        const progressInputEpoch =
            progressInputRevision + pendingFiles.revision();
        const progressConfiguration = observeReviewConfiguration();
        if (formProgress) {
            progressSaveCleanups++;
            let cleared = false;
            try {
                cleared = await formProgress.beforeSave();
            } finally {
                progressSaveCleanups--;
                if (
                    progressSaveCleanups === 0 &&
                    !current() &&
                    ownsLinkedRender() &&
                    !formRetired &&
                    mayUseForm()
                )
                    formProgress?.resume();
            }
            if (!cleared) return false;
        }
        if (!current() || !ownsForm()) return false;
        if (
            visitor.drafts.revision(draft) !== progressDraftRevision ||
            progressInputRevision + pendingFiles.revision() !==
                progressInputEpoch ||
            observeReviewConfiguration() !== progressConfiguration ||
            !current()
        ) {
            formProgress?.resume();
            status(
                'The Form changed while remembered answers were cleared. Review it before a new Save.',
                true
            );
            return false;
        }
        return true;
    };
    if (manualPages && bindingOwner != null) {
        formPages = createFormPageOwner({
            fields: bindingOwner,
            isCurrent: () => ownsLinkedRender() && !formRetired,
            configurationRevision: observeNavigationConfiguration,
            review: async (request) => {
                if (
                    !request.isCurrent() ||
                    !ownsLinkedFilters() ||
                    pendingFiles.pending()
                )
                    return { type: 'edit' };
                retirePageReview();
                const presentation = new AbortController();
                pageReviewPresentation = presentation;
                const linkedSnapshot = linkedPresentation.snapshot();
                const abort = () => presentation.abort();
                request.signal.addEventListener('abort', abort, { once: true });
                linkedSnapshot.signal.addEventListener('abort', abort, {
                    once: true,
                });
                if (request.signal.aborted || linkedSnapshot.signal.aborted)
                    abort();
                const releaseReviewUI = () => {
                    if (
                        pageReviewPresentation !== presentation ||
                        !reviewPending
                    )
                        return;
                    reviewPending = false;
                    reviewIntentRevision++;
                    if (!formRetired && ownsForm()) updateRecovery();
                };
                const release = () => {
                    request.signal.removeEventListener('abort', abort);
                    linkedSnapshot.signal.removeEventListener('abort', abort);
                    abort();
                    releaseReviewUI();
                    if (pageReviewPresentation === presentation)
                        pageReviewPresentation = null;
                    if (retirePageReview === release)
                        retirePageReview = () => {};
                };
                retirePageReview = release;
                reviewPending = true;
                reviewIntentRevision++;
                fields.inert = true;
                updateFormActivity();
                try {
                    const dateContext = captureReviewDateContext();
                    // Linked labels belong to the original accepted page. The
                    // page owner supplies only detached native presentation data.
                    const rows = prepareFormReviewRows(
                        page,
                        request.draft.data,
                        linkedSnapshot,
                        dateContext
                    );
                    const clientDateZoneRequired = rows.some(({ fieldId }) => {
                        const config =
                            page.payload.fieldIdsToSchemas[fieldId]
                                ?.airtableField.config;
                        return (
                            config?.type === 'dateTime' &&
                            config.options.timeZone === 'client'
                        );
                    });
                    const draftRevision = visitor.drafts.revision(draft);
                    const inputRevision =
                        progressInputRevision + pendingFiles.revision();
                    const configuration = observeReviewConfiguration();
                    const formConnection = connection;
                    const parentScope = visitor.formParentScope;
                    const current = () => {
                        if (presentation.signal.aborted) return false;
                        const accepted =
                            request.isCurrent() &&
                            ownsLinkedRender() &&
                            linkedSnapshot.current() &&
                            connection === formConnection &&
                            visitor.formContext === context &&
                            visitor.formParentScope === parentScope &&
                            visitor.drafts.revision(draft) === draftRevision &&
                            progressInputRevision + pendingFiles.revision() ===
                                inputRevision &&
                            observeReviewConfiguration() === configuration &&
                            !pendingFiles.pending() &&
                            (!clientDateZoneRequired ||
                                captureReviewDateContext().clientTimeZone ===
                                    dateContext.clientTimeZone);
                        if (!accepted) abort();
                        return accepted;
                    };
                    status('Review your answers before saving.');
                    const confirmed = await requestConfirmation({
                        title: 'Review your answers',
                        message:
                            'Choose Edit to return to the final page, or Confirm to submit these answers.',
                        confirmLabel: 'Confirm',
                        cancelLabel: 'Edit',
                        rows,
                        signal: presentation.signal,
                    });
                    if (!confirmed || !current()) {
                        if (ownsForm())
                            status(
                                'Review closed. Your answers were retained; no Save was sent.'
                            );
                        return { type: 'edit' };
                    }
                    // Review/Edit must not clear opted-in remembered answers.
                    // The existing cleanup and revision fences run after Confirm.
                    if (!(await clearProgressBeforeSave(current)) || !current())
                        return { type: 'edit' };
                    return {
                        type: 'confirm',
                        signal: presentation.signal,
                        isCurrent: current,
                    };
                } catch (error) {
                    if (ownsForm())
                        status(
                            error instanceof Error
                                ? error.message
                                : 'Review is unavailable.',
                            true
                        );
                    return { type: 'edit' };
                } finally {
                    releaseReviewUI();
                }
            },
        });
        updatePageNavigation = (accepted) => {
            if (formPages == null) return;
            const snapshot = accepted ?? formPages.getSnapshot();
            currentPageFields = new Set(snapshot.currentFieldIds);
            for (const [id, wrapper] of pageFields) {
                wrapper.hidden = !inCurrentPage(id);
                wrapper.inert = wrapper.hidden;
                controls
                    .get(id)
                    ?.setActive?.(
                        ownsAddressReads() &&
                            inCurrentPage(id) &&
                            fieldVisibility[id]?.type === 'visible'
                    );
            }
            const visible = snapshot.pages.flatMap((entry, index) =>
                entry.hidden ? [] : [index]
            );
            const current = snapshot.pages[snapshot.activePageIndex];
            const last = visible.at(-1);
            const busy =
                request != null ||
                reviewPending ||
                !mayUseForm() ||
                childBlocksParent();
            navigation.hidden = false;
            pageCounter.textContent =
                visible.length === 0
                    ? 'No available pages'
                    : `Page ${visible.indexOf(snapshot.activePageIndex) + 1} of ${visible.length}`;
            pageTitle.textContent = current?.title ?? '';
            pageTitle.hidden = pageTitle.textContent === '';
            back.hidden = !visible.some(
                (index) => index < snapshot.activePageIndex
            );
            back.disabled = busy || !snapshot.canBack;
            next.hidden = !visible.some(
                (index) => index > snapshot.activePageIndex
            );
            // Keep validation refusal reachable; the SDK owns its admission.
            next.disabled = busy || snapshot.status !== 'ready';
            submit.hidden = snapshot.activePageIndex !== last;
            const reviewRequired =
                settings(page.payload.publicFields)
                    .promptUserBeforeSubmission === true;
            submit.textContent = reviewRequired ? 'Review answers' : 'Save';
            submit.disabled =
                busy ||
                !(reviewRequired ? snapshot.canReview : snapshot.canSubmit);
            pageProblems.replaceChildren();
            for (const problem of snapshot.problems) {
                const title =
                    problem.fieldId == null
                        ? 'Form'
                        : (page.payload.fieldIdsToSchemas[problem.fieldId]
                              ?.airtableField.name ?? 'Field');
                pageProblems.append(
                    element(
                        'li',
                        `${title}: ${problem.code.replaceAll('-', ' ')}.`
                    )
                );
            }
            if (snapshot.status === 'retired')
                pageProblems.append(
                    element('li', 'Reload this Form before continuing.')
                );
        };
        formControlDisposers.push(formPages.subscribe(updatePageNavigation));
    }
    updateChildParentActivity = () => {
        if (ownsLinkedRender()) updateRecovery();
    };
    updateRecovery();
    updatePageNavigation();
    const save = (prepared?: {
        snapshot: FormDraftSnapshot<AirtableValue>;
        current(forOwnSave?: boolean): boolean;
    }): Promise<void> =>
        run('Saving the Form…', async ({ client, signal, current }) => {
            if (childBlocksParent()) return;
            // Reject an invalid visible control instead of saving its last
            // valid draft value (for example, a non-finite numeric input).
            readCurrentPage();
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
                childBlocksParent() ||
                (prepared != null && !prepared.current())
            )
                return;
            if (bindingOwner == null) return;
            if (
                !(
                    formPages != null &&
                    settings(page.payload.publicFields)
                        .promptUserBeforeSubmission === true
                ) &&
                !(await clearProgressBeforeSave(
                    () => current() && (prepared?.current() ?? true)
                ))
            )
                return;
            submit.disabled = true;
            discard.disabled = true;
            let normalized: ReturnType<typeof normalizeFormSaveResult>;
            let dispatched = false;
            let knownNotDispatched = false;
            try {
                const {
                    extensionAccessToken: _token,
                    formRecord: _record,
                    formFieldIdsWithUnsavedChanges: _dirty,
                    ...freshOptions
                } = input;
                const dispatchOptions: FormControllerSaveOptions = {
                    signal,
                    options: freshOptions,
                    isCurrent: () =>
                        current() &&
                        ownsForm() &&
                        (prepared?.current(dispatched) ?? true),
                    lifecycle: {
                        dispatch: () => {
                            const attempt = recovery.begin(
                                scope,
                                recordId,
                                'save',
                                loadVersion,
                                null,
                                visitor.preparedAttempt
                            );
                            retainInput(attempt);
                            dispatched = true;
                            visitor.preparedAttempt = null;
                            visitor.uncertainFormDraftScopes.add(draft.scope);
                            if (formPages != null) updateRecovery();
                            return {
                                accepted: (result) => {
                                    if (
                                        result.type !== 'error' &&
                                        (typeof result.raw.record.id !==
                                            'string' ||
                                            result.raw.record.id === '' ||
                                            (recordId != null &&
                                                result.raw.record.id !==
                                                    recordId))
                                    )
                                        throw new Error(
                                            'The save response does not match this request. Check the latest requests.'
                                        );
                                    recovery.accepted(
                                        attempt,
                                        result.type === 'error'
                                            ? 'validation-error'
                                            : 'saved'
                                    );
                                },
                                finish: (disposition) => {
                                    if (
                                        disposition === 'not-dispatched' &&
                                        recovery.notDispatched(attempt)
                                    ) {
                                        dispatched = false;
                                        knownNotDispatched = true;
                                        visitor.uncertainFormDraftScopes.delete(
                                            draft.scope
                                        );
                                    } else recovery.finishFlight(attempt);
                                    if (ownsForm()) updateRecovery();
                                },
                            };
                        },
                    },
                };
                normalized =
                    formPages == null
                        ? await bindingOwner.save(dispatchOptions)
                        : await formPages.submit(
                              formPages.getSnapshot().revision,
                              dispatchOptions
                          );
                if (!current() || !ownsForm()) return;
            } catch (error) {
                if (
                    formPages != null &&
                    error instanceof FormPageError &&
                    !dispatched
                ) {
                    formProgress?.resume();
                    if (current() && ownsForm()) {
                        if (error.reason === 'review-cancelled') {
                            updateRecovery();
                            return;
                        }
                        updateValidationPresentation = () => {};
                        errors.replaceChildren(
                            element(
                                'li',
                                'The Save was not sent. Review the current Form pages before saving.'
                            )
                        );
                        updateRecovery();
                    }
                    return;
                }
                if (knownNotDispatched) formProgress?.resume();
                if (current() && ownsForm()) {
                    updateValidationPresentation = () => {};
                    errors.replaceChildren(
                        element(
                            'li',
                            knownNotDispatched
                                ? 'The Save was not sent. Check the current Form before a new explicit Save.'
                                : uncertainSaveMessage
                        )
                    );
                }
                throw error;
            } finally {
                retirePageReview();
            }
            visitor.uncertainFormDraftScopes.delete(draft.scope);
            submit.disabled = false;
            discard.disabled = false;
            updateValidationPresentation = () => {};
            errors.replaceChildren();
            if (normalized.type === 'error') {
                formProgress?.resume();
                const validation = normalized;
                updateValidationPresentation = () => {
                    if (formRetired || !ownsForm()) return;
                    errors.replaceChildren();
                    for (const error of validation.validationErrors) {
                        const field = bindingOwner.controller
                            .getState()
                            .fields.some(
                                (field) => field.fieldId === error.fieldId
                            )
                            ? bindingOwner.field(error.fieldId).getSnapshot()
                            : undefined;
                        errors.append(
                            element(
                                'li',
                                canPresentFieldValidation(field)
                                    ? `${field!.field!.title}: ${error.errorMessage}`
                                    : 'A field needs attention before saving.'
                            )
                        );
                    }
                    if (validation.concurrentEditErrorMessage != null)
                        errors.append(
                            element('li', validation.concurrentEditErrorMessage)
                        );
                };
                updateValidationPresentation();
                status(
                    'The Form was not saved. Review the validation errors.',
                    true
                );
                return;
            }
            const result = normalized.raw;
            formProgress?.retire();
            visitor.drafts.discard(draft);
            visitor.formParentScope = null;
            visitor.formQueries = null;
            const parentRefreshMismatch =
                visitor.root != null &&
                result.loggedInUserRecord != null &&
                result.loggedInUserRecord.id !==
                    visitor.root.payload.formRecord.recordId;
            if (parentRefreshMismatch) {
                // The child Save is acknowledged. Refuse the foreign parent
                // without reviving cached Portal actions or replaying Save.
                visitor.portal?.destroy();
                visitor.portal = null;
                visitor.root = null;
            }
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
            if (parentRefreshMismatch)
                screenNode.append(
                    element(
                        'p',
                        'The parent Portal refresh did not match. Choose Reload to load the Portal before continuing.',
                        'hint'
                    )
                );
            const warnings = new Set<string>();
            let updateLinkEmailFailed = false;
            for (const warning of normalized.postSubmissionWarnings) {
                // Result arrays may contain unknown runtime members. Never
                // echo response metadata or fail an already accepted Save.
                switch (warning?.type) {
                    case 'userConfirmationEmailFailed':
                        warnings.add(
                            'The confirmation email could not be sent.'
                        );
                        break;
                    case 'adminNotificationEmailFailed':
                        warnings.add(
                            'The administrator notification email could not be sent.'
                        );
                        break;
                    case 'smsConfirmationFailed':
                        warnings.add(
                            'The confirmation text message could not be sent.'
                        );
                        break;
                    case 'saveAndContinueUpdateLinkEmailFailed':
                        updateLinkEmailFailed = true;
                        warnings.add(
                            'The update link email could not be sent.'
                        );
                        break;
                    default:
                        warnings.add(
                            'An additional post-submission warning was reported.'
                        );
                }
            }
            const messages = [`Saved record ${result.record.id}.`];
            if (
                !updateLinkEmailFailed &&
                normalized.postSubmissionNotifications.some(
                    (notification) =>
                        notification?.type ===
                        'saveAndContinueUpdateLinkEmailSent'
                )
            )
                messages.push('An update link email was sent.');
            status([...messages, ...warnings].join(' '));
        });
    card.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (
            !ownsForm() ||
            request != null ||
            reviewPending ||
            childBlocksParent()
        )
            return;
        if (
            recovery.blocking(scope, recordId) != null ||
            (candidate?.outcome === 'unknown' &&
                candidate.acknowledgment === 'none')
        ) {
            status(uncertainSaveMessage, true);
            return;
        }
        updateFieldVisibility();
        if (formPages != null) {
            try {
                readCurrentPage();
            } catch {
                status(
                    'Review the current page before continuing. No Save was sent.',
                    true
                );
                return;
            }
            const snapshot = formPages.getSnapshot();
            if (
                snapshot.pages.some(
                    (entry, index) =>
                        index > snapshot.activePageIndex && !entry.hidden
                )
            ) {
                navigate('next');
                return;
            }
            const reviewRequired =
                settings(page.payload.publicFields)
                    .promptUserBeforeSubmission === true;
            if (
                pendingFiles.pending() ||
                !(reviewRequired ? snapshot.canReview : snapshot.canSubmit)
            ) {
                updatePageNavigation();
                status(
                    'Review the Form pages before saving. No Save was sent.',
                    true
                );
                return;
            }
            if (reviewRequired) {
                void save();
                return;
            }
        }
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
        reviewIntentRevision++;
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
            const dateContext = captureReviewDateContext();
            const rows = prepareFormReviewRows(
                page,
                snapshot.data,
                linkedSnapshot,
                dateContext
            );
            const clientDateZoneRequired = rows.some(({ fieldId }) => {
                const config =
                    page.payload.fieldIdsToSchemas[fieldId]?.airtableField
                        .config;
                return (
                    config?.type === 'dateTime' &&
                    config.options.timeZone === 'client'
                );
            });
            const formConnection = connection;
            const parentScope = visitor.formParentScope;
            const capturedConfiguration = observeReviewConfiguration();
            const pendingRevision = pendingFiles.revision();
            const preparedCurrent = (forOwnSave = false): boolean =>
                (!clientDateZoneRequired ||
                    captureReviewDateContext().clientTimeZone ===
                        dateContext.clientTimeZone) &&
                (forOwnSave ? ownsLinkedRender() : ownsLinkedFilters()) &&
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
            reviewIntentRevision++;
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
    const restoration = visitor.restorationError;
    if (restoration) {
        const card = element('section', undefined, 'card');
        card.append(
            element('h2', 'Session could not be restored'),
            element('p', restoration.message)
        );
        card.append(
            button('Retry session restoration', () => {
                if (
                    visitors[activeVisitor] === visitor &&
                    visitor.restorationError === restoration
                )
                    load();
            })
        );
        card.append(
            button('Continue with login', () => {
                if (
                    request ||
                    visitors[activeVisitor] !== visitor ||
                    visitor.restorationError !== restoration
                )
                    return;
                if (!visitor.authentication?.flow.isCurrent()) {
                    visitor.authentication =
                        visitor.remembered?.prepare(restoration.page) ?? null;
                }
                visitor.restorationError = null;
                visitor.screen = restoration.page;
                render();
                status(
                    'Log in explicitly. The failed restoration did not authenticate this visitor.'
                );
            })
        );
        screenNode.append(card);
        return;
    }
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

const forgetRememberedSessions = (visitor: Visitor, forgetOnly = false) => {
    const owners = new Set(visitor.pendingSessionCleanup);
    if (visitor.remembered) owners.add(visitor.remembered);
    for (const owner of owners) {
        if (owner.clear(forgetOnly))
            visitor.pendingSessionCleanup.delete(owner);
        else visitor.pendingSessionCleanup.add(owner);
    }
    return visitor.pendingSessionCleanup.size === 0;
};

// Prefill once; an installed application's explicit input remains authoritative.
const apiOriginInput = inputById('api-origin');
if (apiOriginInput.value === '') apiOriginInput.value = DEFAULT_API_ORIGIN;

connectionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    let nextConnection: NonNullable<typeof connection>;
    const nextVisitors = new Map<
        Visitor,
        { client: MiniExtensionsClient; remembered: Visitor['remembered'] }
    >();
    try {
        // Validate the complete proposal before clearing storage or retiring
        // current owners. Client/session-wrapper construction performs no I/O.
        const apiOrigin = inputById('api-origin').value.trim();
        const shareId = inputById('share-id').value.trim();
        const recordId = inputById('record-id').value.trim() || null;
        const remember = inputById('remember-session').checked;
        if (shareId === '') throw new Error('Missing published share ID.');
        const query = currentConditionalPrefills();
        const clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const context = location.pathname.split('/')[1] ?? '';
        for (const visitor of Object.values(visitors))
            nextVisitors.set(visitor, {
                client: createMiniExtensionsClient({ apiOrigin }),
                remembered: null,
            });
        nextConnection = {
            apiOrigin: new URL(apiOrigin).origin,
            remember,
            input: {
                shareId,
                recordId,
                context: { type: 'direct-url' },
                query,
                clientTimeZone,
            },
        };
        if (remember)
            for (const [identity, visitor] of Object.entries(visitors)) {
                const next = nextVisitors.get(visitor)!;
                next.remembered = createRememberedSession({
                    client: next.client,
                    apiOrigin: nextConnection.apiOrigin,
                    input: nextConnection.input,
                    visitor: identity,
                    context,
                    storage: () => document.defaultView!.sessionStorage,
                });
            }
    } catch {
        // Do not render: replacing controls would lose pending native input.
        status(
            'Connection settings are invalid. Use an HTTP(S) origin without credentials, a path, query or fragment, and enter the published share ID. Current connections and answers are unchanged.',
            true
        );
        return;
    }
    if (!nextConnection.remember) {
        for (const visitor of Object.values(visitors)) {
            if (!forgetRememberedSessions(visitor, true)) {
                sessionSummary();
                status(
                    'Remembering could not be disabled because browser storage could not be cleared. Your current connection and drafts are retained.',
                    true
                );
                return;
            }
        }
    }
    try {
        for (const visitor of Object.values(visitors)) invalidate(visitor);
        for (const [visitor, next] of nextVisitors) {
            visitor.client = next.client;
            visitor.remembered = next.remembered;
        }
        connection = nextConnection;
        render();
        load();
    } catch (error) {
        connection = null;
        for (const visitor of Object.values(visitors)) {
            invalidate(visitor);
            visitor.client = null;
        }
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
        retireBrowserCreateProgress(identity);
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
nodeById('reload').addEventListener('click', () => load());
nodeById('logout').addEventListener('click', () => {
    recovery.scrubRetainedInput();
    const visitor = visitors[activeVisitor];
    const progressCleanup = forgetBrowserCreateProgress(activeVisitor);
    const forgotten = forgetRememberedSessions(visitor);
    visitor.client?.setSession({});
    invalidate(visitor);
    visitor.remembered = null; // Logout disables restoration until a new explicit connection opt-in.
    render();
    status(
        forgotten
            ? 'This visitor is anonymous again. Remembering is off for this visitor until you reconnect and opt in.'
            : 'This visitor is anonymous, but browser storage could not be cleared. Clear this site’s session storage before using a shared tab.',
        !forgotten
    );
    const retiredRevision = visitor.revision;
    void progressCleanup.then((complete) => {
        if (
            !complete &&
            visitors[activeVisitor] === visitor &&
            visitor.revision === retiredRevision
        )
            status(
                'This visitor is anonymous, but remembered answers could not be fully cleared. Clear this tab’s session storage before sharing it.',
                true
            );
    });
});
nodeById('cancel').addEventListener('click', () => {
    request?.abort();
    request = null;
    setBusy(false);
    if (visitors[activeVisitor].restorationError) {
        render();
        status(
            'Session restoration cancelled. No late response can authenticate this visitor.'
        );
        return;
    }
    status(
        'Request cancelled. A write may already have committed; reload and inspect before submitting again.'
    );
});
nodeById('disconnect').addEventListener('click', () => {
    recovery.scrubRetainedInput();
    let forgotten = true;
    const progressCleanup = Promise.all(
        Object.keys(visitors).map(forgetBrowserCreateProgress)
    );
    for (const visitor of Object.values(visitors)) {
        forgotten = forgetRememberedSessions(visitor) && forgotten;
        invalidate(visitor);
        visitor.remembered = null;
        visitor.client = null;
    }
    connection = null;
    render();
    status(
        forgotten
            ? 'Disconnected. Both visitor sessions have been cleared.'
            : 'Disconnected. Browser storage could not be cleared; clear this site’s session storage before using a shared tab.',
        !forgotten
    );
    setBusy(false);
    void progressCleanup.then((results) => {
        if (connection === null && results.some((complete) => !complete))
            status(
                'Disconnected. Remembered answers could not be fully cleared. Clear this tab’s session storage before sharing it.',
                true
            );
    });
});
setBusy(false);
render();
