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
} from '@miniextensions/sdk';
import {
    createFormSaveInput,
    normalizeFormSaveResult,
    openLoadedFormDraft,
} from '@miniextensions/sdk/forms';
import {
    button,
    element,
    inputById,
    labeled,
    nodeById,
    settings,
} from './dom.js';
import { displayValue, formFieldControl, type FieldControl } from './fields.js';
import { createPortalView, type PortalView } from './portal.js';
import { FormDraftStore, type ParentFormDraftScope } from './drafts.js';
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
    formContext: SaveFormInput['context'];
    formParentScope: ParentFormDraftScope | null;
    drafts: FormDraftStore<AirtableValue>;
    verification: { loginPage: LoginPageResult; verificationId: string } | null;
};
const newVisitor = (): Visitor => ({
    client: null,
    screen: null,
    root: null,
    portal: null,
    revision: 0,
    formContext: { type: 'direct-url' },
    formParentScope: null,
    drafts: new FormDraftStore<AirtableValue>(),
    verification: null,
});
const visitors = { A: newVisitor(), B: newVisitor() };
let activeVisitor: keyof typeof visitors = 'A';
let connection: {
    apiOrigin: string;
    input: LoadExtensionInput;
} | null = null;
let request: AbortController | null = null;
let disposeFormControls = (): void => {};
const screenNode = nodeById('screen');
const statusNode = nodeById('status');
const connectionForm = nodeById('connection-form');
const visitorSelect = nodeById('visitor');
if (!(visitorSelect instanceof HTMLSelectElement))
    throw new Error('Missing visitor selector.');

const status = (message: string, error = false): void => {
    statusNode.textContent = message;
    statusNode.classList.toggle('error', error);
};
const setBusy = (busy: boolean): void => {
    screenNode.inert = busy;
    connectionForm.inert = busy;
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
    }) => Promise<void>
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
        if (current()) {
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
            setBusy(false);
            sessionSummary();
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
    visitor.portal?.closeEditor();
    visitor.revision += 1;
    visitor.screen = null;
    visitor.root = null;
    visitor.portal = null;
    visitor.verification = null;
    visitor.formContext = { type: 'direct-url' };
    visitor.formParentScope = null;
    visitor.drafts.clear();
    request?.abort();
    request = null;
    setBusy(false);
};
const replaceSession = (visitor: Visitor, next: RuntimeSession): void => {
    cancelConfirmation();
    visitor.portal?.closeEditor();
    visitor.client?.setSession(next);
    // A successful explicit login becomes a new owner for future responses.
    visitor.revision += 1;
    visitor.portal = null;
    visitor.root = null;
    visitor.verification = null;
    visitor.formParentScope = null;
    visitor.drafts.clear();
};

const load = (): void => {
    cancelConfirmation();
    void run(
        'Loading the published extension…',
        async ({ visitor, client, signal, current }) => {
            if (connection == null) return;
            const result = await client.loadExtension(connection.input, {
                signal,
            });
            if (!current()) return;
            // Reload replaces this visitor's drafts only after a fresh read.
            visitor.drafts.clear();
            visitor.portal?.closeEditor();
            visitor.screen = result;
            visitor.root =
                result.extensionScreen === 'portal_loaded' ? result : null;
            visitor.portal = null;
            visitor.formContext = { type: 'direct-url' };
            visitor.formParentScope = null;
            visitor.verification = null;
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
        const config = schema?.miniExtConfig;
        input.type =
            schema?.fieldType === AirtableFieldType.EMAIL
                ? 'email'
                : config !== undefined &&
                    'obscurePassword' in config &&
                    config.obscurePassword === true
                  ? 'password'
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
    if (settings(page.payload.publicFields).ifRecordDoesNotExist === 'signUp') {
        actions.append(
            button('Sign up', () => {
                void run(
                    'Creating a visitor account…',
                    async ({ client, signal, current }) => {
                        const result = await client.auth.signUp(
                            {
                                extensionId: page.extensionId,
                                signUpCredentials: credentials(),
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
                const result = await client.auth.login(
                    {
                        extensionId: page.extensionId,
                        loginCredentials: credentials(),
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
                        `A verification ${result.verificationType === 'email' ? 'email' : 'message'} was sent to ${result.emailOrPhoneNumber}.`
                    );
                }
            }
        );
    });
    screenNode.append(card);
    const verification = visitor.verification;
    if (verification != null) {
        const codeForm = element('form', undefined, 'card');
        const code = element('input');
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
                    const result = await client.auth.confirmVerificationCode(
                        {
                            verificationId: verification.verificationId,
                            verificationCode: code.value,
                            language: page.language,
                        },
                        { signal }
                    );
                    if (current())
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
    const card = element('form', undefined, 'card');
    card.noValidate = true; // Display the server's complete validation result.
    card.append(element('h2', page.payload.extensionName ?? 'Custom Form'));
    if (visitor.root != null)
        card.append(
            button('Back to Portal', () => {
                visitor.screen = visitor.root;
                visitor.formContext = { type: 'direct-url' };
                visitor.formParentScope = null;
                render();
            })
        );
    const draft = openLoadedFormDraft({
        store: visitor.drafts,
        loaded: page,
        parent: visitor.formParentScope,
    });
    const controls = new Map<string, FieldControl>();
    disposeFormControls = () => {
        for (const control of controls.values()) control.destroy();
        controls.clear();
    };
    const fields = element('div', undefined, 'fields');
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
        const control: FieldControl = formFieldControl(
            schema,
            visitor.drafts.read(draft, fieldId),
            () => {
                try {
                    visitor.drafts.write(draft, fieldId, control.read());
                } catch (error) {
                    status(
                        error instanceof Error
                            ? error.message
                            : 'Invalid field value.',
                        true
                    );
                }
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
            config !== undefined &&
            'allowAddingNewOptions' in config &&
            config.allowAddingNewOptions === true
        ) {
            const choice = element('input');
            choice.placeholder = 'New choice name';
            control.node.append(
                labeled('Add a choice', choice),
                button('Create choice', () => {
                    if (choice.value.trim() === '') {
                        status('Enter a new choice name.', true);
                        return;
                    }
                    void run(
                        'Creating the configured select choice…',
                        async ({ client, signal, current }) => {
                            const result = await client.forms.addSelectOption(
                                {
                                    extensionAccessToken:
                                        page.payload.extensionAccessToken,
                                    airtableFieldId: fieldId,
                                    newChoiceText: choice.value,
                                },
                                { signal }
                            );
                            if (!current()) return;
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
                            }
                            const previous = control.read();
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
            const fetchOptions = (more: boolean): void => {
                void run(
                    'Loading allowed linked records…',
                    async ({ client, signal, current }) => {
                        const result =
                            await client.linkedRecords.listFormOptions(
                                {
                                    extensionAccessToken:
                                        page.payload.extensionAccessToken,
                                    linkedRecordFieldId: fieldId,
                                    filter: {
                                        viewType: 'list',
                                        searchTerm: search.value,
                                    },
                                    offset: more ? offset : null,
                                    conditionalLinkedRecordFilteringValues: {},
                                },
                                { signal }
                            );
                        if (!current()) return;
                        if (!more) choices.replaceChildren();
                        offset = result.offset;
                        for (const record of result.records) {
                            const choice = element('input');
                            choice.type = 'checkbox';
                            const selectedValue = control.read();
                            choice.checked =
                                Array.isArray(selectedValue) &&
                                selectedValue.includes(record.id);
                            choice.addEventListener('change', () => {
                                const value = control.read();
                                const selected = new Set(
                                    Array.isArray(value)
                                        ? value.filter(
                                              (entry): entry is string =>
                                                  typeof entry === 'string'
                                          )
                                        : []
                                );
                                if (choice.checked) selected.add(record.id);
                                else selected.delete(record.id);
                                control.write([...selected]);
                                visitor.drafts.write(
                                    draft,
                                    fieldId,
                                    control.read()
                                );
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
                offset = null;
                moreButton.disabled = true;
            });
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
            control.node.append(
                file,
                button('Upload selected file', () => {
                    const selected = file.files?.[0];
                    if (selected == null) {
                        status('Choose a file first.', true);
                        return;
                    }
                    void run(
                        'Uploading the selected attachment…',
                        async ({ client, signal, current }) => {
                            const attachment =
                                await client.attachments.uploadFile(
                                    {
                                        file: selected,
                                        filename: selected.name,
                                        extensionAccessToken:
                                            page.payload.extensionAccessToken,
                                        fieldId,
                                    },
                                    { signal }
                                );
                            if (!current()) return;
                            const existing = control.read();
                            control.write([
                                ...(Array.isArray(existing) ? existing : []),
                                attachment,
                            ]);
                            visitor.drafts.write(
                                draft,
                                fieldId,
                                control.read()
                            );
                            file.value = '';
                            status(
                                'File uploaded. Choose Save to attach it to the record.'
                            );
                        }
                    );
                })
            );
        }
    }
    card.append(fields);
    const errors = element('ul', undefined, 'error-list');
    errors.setAttribute('role', 'alert');
    card.append(errors);
    const actions = element('div', undefined, 'actions');
    const submit = element('button', 'Save');
    submit.type = 'submit';
    actions.append(submit);
    actions.append(
        button('Discard draft', () => {
            visitor.drafts.discard(draft);
            render();
            status('This Form draft was discarded. No record was saved.');
        })
    );
    if (
        page.payload.formRecord.type === 'edit' &&
        settings(page.payload.publicFields).allowDeletingRecords === true
    ) {
        actions.append(
            button(
                'Delete this record',
                async () => {
                    if (
                        !(await confirmCurrent({
                            title: 'Delete this record?',
                            message:
                                'This deletes the current Form record from Airtable.',
                            confirmLabel: 'Delete record',
                        }))
                    )
                        return;
                    await run(
                        'Deleting the current record…',
                        async ({ client, signal, current }) => {
                            await client.forms.deleteCurrentRecord(
                                {
                                    extensionAccessToken:
                                        page.payload.extensionAccessToken,
                                },
                                { signal }
                            );
                            if (!current()) return;
                            visitor.drafts.discard(draft);
                            visitor.formParentScope = null;
                            visitor.screen = visitor.root;
                            render();
                            status(
                                'Record deleted. Reload to refresh the current records.'
                            );
                        }
                    );
                },
                'danger'
            )
        );
    }
    card.append(actions);
    card.addEventListener('submit', (event) => {
        event.preventDefault();
        void run('Saving the Form…', async ({ client, signal, current }) => {
            // Reject an invalid visible control instead of saving its last
            // valid draft value (for example, a non-finite numeric input).
            for (const control of controls.values())
                if (control.editable) control.read();
            const snapshot = visitor.drafts.snapshot(draft);
            if (snapshot == null) return;
            const rawResult = await client.forms.save(
                createFormSaveInput({
                    loaded: page,
                    draft: snapshot,
                    options: {
                        captchaVal: null,
                        isComputeMode: false,
                        searchQuery: connection?.input.query ?? {},
                        context,
                        conditionalLinkedRecordFieldIdsToFilteringValues: {},
                    },
                }),
                { signal }
            );
            if (!current()) return;
            const normalized = normalizeFormSaveResult(rawResult, page);
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
    });
    screenNode.append(card);
    if (
        page.payload.formRecord.type === 'edit' &&
        page.payload.hasParentExtension &&
        page.enableCommentsOnChildForms
    )
        renderComments(page);
};

const renderComments = (page: FormLoadedResult): void => {
    const card = element('section', undefined, 'card');
    card.append(element('h2', 'Record comments'));
    const output = element('div');
    card.append(
        button('Load comments', () => {
            void run(
                'Loading record comments…',
                async ({ client, signal, current }) => {
                    const result = await client.comments.listForRecord(
                        {
                            childExtensionAccessToken:
                                page.payload.extensionAccessToken,
                        },
                        { signal }
                    );
                    if (!current()) return;
                    output.replaceChildren();
                    for (const comment of result.comments)
                        output.append(element('p', comment.text, 'comment'));
                    add.disabled = result.disableSending === true;
                    status(`Loaded ${result.comments.length} comments.`);
                }
            );
        }),
        output
    );
    const text = element('textarea');
    text.placeholder = 'Write a comment';
    const add = button('Add comment', () => {
        if (text.value.trim() === '') {
            status('Enter a comment.', true);
            return;
        }
        void run(
            'Adding a record comment…',
            async ({ client, signal, current }) => {
                await client.comments.addToRecord(
                    {
                        childExtensionAccessToken:
                            page.payload.extensionAccessToken,
                        comment: text.value,
                    },
                    { signal }
                );
                if (!current()) return;
                text.value = '';
                status('Comment added. Load comments to refresh.');
            }
        );
    });
    card.append(labeled('Comment', text), add);
    screenNode.append(card);
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
        visitor.portal ??= createPortalView({
            page,
            run,
            status,
            confirm: confirmCurrent,
            openChild: (child, context, scope) => {
                visitor.screen = child;
                visitor.formContext = context;
                visitor.formParentScope = scope;
                render();
            },
        });
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
                query: {},
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
    cancelConfirmation();
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
