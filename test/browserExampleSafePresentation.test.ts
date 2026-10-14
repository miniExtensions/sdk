import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import {
    AirtableFieldType,
    type FormLoadedResult,
    type ListLinkedRecordOptionsResult,
    type MiniExtensionsClient,
    type RuntimeAirtableField,
    type RuntimeConditionsDefinition,
    type RuntimeLinkedRecordDetailField,
    type RuntimeTableStates,
    type SaveFormInput,
    type SaveFormResult,
    type UpdateGridCellInput,
} from '../src/runtime/index.js';
import { loadedForm } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

const root = resolve(process.cwd());
const secret = 'SYNTHETIC_SECRET_DO_NOT_DISPLAY';
const recordId = 'rec_synthetic_allowed';
const visibleTitle = 'Visible target';
type Policy = 'hidden' | 'masked' | 'visible';
type DOMElement = InstanceType<Window['Element']>;
let directory: string;
let moduleRevision = 0;

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-safe-presentation-'));
    for (const entry of ['main', 'portal'])
        await build({
            entryPoints: [join(root, `examples/browser/src/${entry}.ts`)],
            alias: {
                '@miniextensions/sdk/auth': join(root, 'src/auth/index.ts'),
                '@miniextensions/sdk/ui': join(root, 'src/ui/index.ts'),
                '@miniextensions/sdk/forms': join(root, 'src/forms/index.ts'),
                '@miniextensions/sdk/portals': join(
                    root,
                    'src/portals/index.ts'
                ),
                '@miniextensions/sdk/formulas': join(
                    root,
                    'src/formulas/index.ts'
                ),
                '@miniextensions/sdk': join(root, 'src/runtime/index.ts'),
            },
            bundle: true,
            platform: 'node',
            format: 'esm',
            outfile: join(directory, `${entry}.mjs`),
            logLevel: 'silent',
        });
});
after(async () => rm(directory, { recursive: true, force: true }));

const waitFor = async (predicate: () => boolean) => {
    for (let turn = 0; turn < 100; turn++) {
        if (predicate()) return;
        await new Promise<void>((done) => setImmediate(done));
    }
    assert.fail('The actual starter did not reach the expected state.');
};
const submit = (window: Window, node: DOMElement) =>
    node.dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true })
    );
const button = (node: DOMElement, title: string) => {
    const found = Array.from(node.querySelectorAll('button')).find(
        (candidate) => candidate.textContent?.trim() === title
    );
    assert.ok(found, `Missing actual starter button: ${title}`);
    return found;
};
const idle = (window: Window) =>
    window.document.getElementById('screen')?.getAttribute('aria-busy') ===
    'false';
const assertNoSecret = (window: Window) => {
    assert.equal(
        window.document.documentElement.textContent?.includes(secret),
        false
    );
    assert.equal(
        window.document.documentElement.outerHTML.includes(secret),
        false
    );
    for (const node of window.document.querySelectorAll('*'))
        for (const attribute of node.attributes)
            assert.equal(attribute.value?.includes(secret) ?? false, false);
};

const primaryField: RuntimeAirtableField = {
    id: 'fld_target_primary',
    name: 'Target primary',
    description: null,
    isComputed: false,
    isPrimaryField: true,
    config: { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
};
const linkedField: RuntimeAirtableField = {
    id: 'fld_targets',
    name: 'Targets',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: {
        type: AirtableFieldType.MULTIPLE_RECORD_LINKS,
        options: {
            linkedTableId: 'tbl_targets',
            inverseLinkFieldId: 'fld_inverse',
            isReversed: false,
            prefersSingleRecordLink: false,
        },
    },
};
const primaryDetail = (policy: Policy): RuntimeLinkedRecordDetailField => ({
    fieldId: primaryField.id,
    fieldName: primaryField.name,
    titleOverride: null,
    isHidden: policy === 'hidden',
    fieldIsInEditingChildForm: false,
    childFormField: null,
    miniExtConfig: { obscurePassword: policy === 'masked' },
});
const targetStates = (policy: Policy): RuntimeTableStates => ({
    tbl_targets: {
        airtableFields: [structuredClone(primaryField)],
        recordIdsToAirtableRecords: {
            [recordId]: {
                id: recordId,
                fields: {
                    [primaryField.id]:
                        policy === 'visible' ? visibleTitle : secret,
                },
            },
        },
    },
});
const options = (policy: Policy): ListLinkedRecordOptionsResult => ({
    records: [
        targetStates(policy).tbl_targets.recordIdsToAirtableRecords[recordId],
    ],
    offset: null,
    tableIdsToLinkedTableStates: targetStates(policy),
});
const optionsWithNameKeys = (policy: Policy): ListLinkedRecordOptionsResult => {
    const page = options(policy);
    for (const record of [
        ...page.records,
        ...Object.values(
            page.tableIdsToLinkedTableStates.tbl_targets
                .recordIdsToAirtableRecords
        ),
    ]) {
        record.fields[primaryField.name] = record.fields[primaryField.id];
        delete record.fields[primaryField.id];
    }
    return page;
};
const blankValidation: SaveFormResult = {
    type: 'error',
    formValidationErrors: [],
    formErrors: {},
};
const linkedForm = (policy: Policy): FormLoadedResult => {
    const form = loadedForm();
    const title = form.payload.fieldIdsToSchemas.fld_title;
    assert.ok(title);
    const schema = {
        fieldType: AirtableFieldType.MULTIPLE_RECORD_LINKS,
        airtableField: structuredClone(linkedField),
        miniExtConfig: {},
    } as const;
    form.payload.fieldIdsInForm = ['fld_title', linkedField.id];
    form.payload.fieldIdsToSchemas = {
        fld_title: title,
        [linkedField.id]: schema,
    };
    form.payload.fieldNamesToSchemas = { Title: title, Targets: schema };
    form.payload.formRecord = {
        type: 'create',
        data: { fld_title: 'Initial title', [linkedField.id]: [] },
    };
    form.payload.formFieldIdsWithUnsavedChanges = [];
    form.payload.urlPrefilledFieldIds = [];
    form.payload.linkedRecordFieldIdToDetailFields = {
        [linkedField.id]: [primaryDetail(policy)],
    };
    return form;
};

const installGlobals = (
    test: TestContext,
    window: Window,
    fetch?: typeof globalThis.fetch
) => {
    function Option(text = '', value = '') {
        const option = window.document.createElement('option');
        option.textContent = text;
        option.value = value;
        return option;
    }
    const globals = {
        document: window.document,
        location: window.location,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLSelectElement: window.HTMLSelectElement,
        HTMLButtonElement: window.HTMLButtonElement,
        HTMLTextAreaElement: window.HTMLTextAreaElement,
        Option,
        ...(fetch === undefined ? {} : { fetch }),
    };
    const previous = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.assign(globalThis, globals);
    test.after(async () => {
        for (const [key, descriptor] of previous) {
            if (descriptor === undefined)
                Reflect.deleteProperty(globalThis, key);
            else Object.defineProperty(globalThis, key, descriptor);
        }
        await window.happyDOM.close();
    });
};
const mountForm = async (
    test: TestContext,
    form: FormLoadedResult,
    policy: Policy,
    saveResult: SaveFormResult = blankValidation,
    transport: {
        getForm?(): FormLoadedResult;
        saveFailure?: Error;
        nameKeyChoices?: boolean;
    } = {}
) => {
    const saves: SaveFormInput[] = [];
    const reads: unknown[] = [];
    let loads = 0;
    const fetch: typeof globalThis.fetch = async (resource, init) => {
        const url = new URL(String(resource));
        assert.equal(url.origin, 'https://sdk.example.test');
        const route = url.searchParams.get('route');
        if (route === 'fetchExtensionForEndUser') {
            loads++;
            return new Response(JSON.stringify(transport.getForm?.() ?? form));
        }
        if (route === 'fetchRecordsForFormLinkedRecordsSelector') {
            reads.push(JSON.parse(String(init?.body)));
            return new Response(
                JSON.stringify(
                    transport.nameKeyChoices
                        ? optionsWithNameKeys(policy)
                        : options(policy)
                )
            );
        }
        if (route === 'saveForm') {
            saves.push(JSON.parse(String(init?.body)));
            if (transport.saveFailure) throw transport.saveFailure;
            return new Response(JSON.stringify(saveResult));
        }
        throw new Error('Unexpected safe-presentation fixture request.');
    };
    const window = new Window({
        url: 'https://app.example.test',
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
        },
    });
    window.document.write(
        (
            await readFile(join(root, 'examples/browser/index.html'), 'utf8')
        ).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    );
    installGlobals(test, window, fetch);
    await import(
        `${pathToFileURL(join(directory, 'main.mjs')).href}?case=${++moduleRevision}`
    );
    const origin = window.document.getElementById('api-origin');
    const share = window.document.getElementById('share-id');
    const connection = window.document.getElementById('connection-form');
    assert.ok(origin instanceof window.HTMLInputElement);
    assert.ok(share instanceof window.HTMLInputElement);
    assert.ok(connection);
    origin.value = 'https://sdk.example.test';
    share.value = 'share_synthetic';
    submit(window, connection);
    await waitFor(
        () =>
            window.document.querySelector('[data-field-id="fld_title"]') !==
                null && idle(window)
    );
    return { window, saves, reads, loads: () => loads };
};

const driverCondition = (value = true): RuntimeConditionsDefinition => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'synthetic_recovery_visibility',
            type: 'singleCondition',
            setting: {
                type: 'is',
                fieldType: AirtableFieldType.CHECKBOX,
                idOrName: { type: 'id', id: 'fld_driver' },
                value,
            },
        },
    ],
});
const recoveryForm = (): FormLoadedResult => {
    const form = loadedForm();
    const target = form.payload.fieldIdsToSchemas.fld_title;
    assert.ok(target);
    target.airtableField.name = 'Private target';
    target.miniExtConfig = {};
    const adjacent = structuredClone(target);
    adjacent.airtableField.id = 'fld_public';
    adjacent.airtableField.name = 'Public adjacent';
    const driver = {
        fieldType: AirtableFieldType.CHECKBOX,
        airtableField: {
            id: 'fld_driver',
            name: 'Show private target',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: AirtableFieldType.CHECKBOX,
                options: { icon: 'check', color: 'greenBright' },
            },
        },
        miniExtConfig: {},
    } as const;
    form.payload.fieldIdsInForm = ['fld_title', 'fld_public', 'fld_driver'];
    form.payload.fieldIdsToSchemas = {
        fld_title: target,
        fld_public: adjacent,
        fld_driver: driver,
    };
    form.payload.fieldNamesToSchemas = {
        'Private target': target,
        'Public adjacent': adjacent,
        'Show private target': driver,
    };
    form.payload.formRecord = {
        type: 'create',
        data: {
            fld_title: 'Initial private target',
            fld_public: 'Initial public adjacent',
            fld_driver: true,
        },
    };
    form.payload.formFieldIdsWithUnsavedChanges = [];
    form.payload.urlPrefilledFieldIds = [];
    return form;
};
const formInput = (window: Window, fieldId: string) => {
    const input = window.document.querySelector(`[data-field-id="${fieldId}"]`);
    assert.ok(input instanceof window.HTMLInputElement);
    return input;
};
const editInput = (window: Window, fieldId: string, value: string) => {
    const input = formInput(window, fieldId);
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const recoveryPanel = (window: Window) => {
    const panel = window.document.querySelector(
        '[aria-label="Earlier request recovery"]'
    );
    assert.ok(panel);
    return panel;
};
const linkedControl = (window: Window) => {
    const raw = window.document.querySelector(
        `[data-field-id="${linkedField.id}"]`
    );
    assert.ok(raw instanceof window.HTMLTextAreaElement);
    const node = raw.closest('div');
    assert.ok(node);
    return { raw, node };
};
const selectChoice = (window: Window, node: DOMElement) => {
    const choices = node.querySelectorAll(
        '.choice-list input[type="checkbox"]'
    );
    assert.equal(choices.length, 1);
    const choice = choices[0];
    assert.ok(choice instanceof window.HTMLInputElement);
    const label = choice.closest('label');
    assert.ok(label);
    choice.checked = true;
    choice.dispatchEvent(new window.Event('change', { bubbles: true }));
    return label;
};

const mountPortal = async (
    test: TestContext,
    policy: Policy,
    nameKeyChoices = false,
    summary?: {
        field: RuntimeAirtableField;
        detail: RuntimeLinkedRecordDetailField;
        value: import('../src/runtime/index.js').AirtableValue;
    }
) => {
    const window = new Window({ url: 'https://app.example.test' });
    installGlobals(test, window);
    const page = portalPage();
    page.payload.linkedRecordFieldIdToDetailFields = {
        fld_children: [
            {
                fieldId: linkedField.id,
                fieldName: linkedField.name,
                titleOverride: null,
                isHidden: false,
                fieldIsInEditingChildForm: true,
                childFormField: null,
                miniExtConfig: {},
            },
        ],
        [linkedField.id]: [primaryDetail(policy)],
    };
    if (summary)
        page.payload.linkedRecordFieldIdToDetailFields.fld_children = [
            summary.detail,
        ];
    const fixture = portalFixture(async () =>
        portalListPage({
            recordIds: ['record_synthetic_child'],
            tableIdsToLinkedTableStates: {
                table_children: {
                    airtableFields: [
                        structuredClone(summary?.field ?? linkedField),
                    ],
                    recordIdsToAirtableRecords: {
                        record_synthetic_child: {
                            id: 'record_synthetic_child',
                            fields: { [linkedField.id]: summary?.value ?? [] },
                        },
                    },
                },
            },
        })
    );
    const reads: unknown[] = [];
    const updates: UpdateGridCellInput[] = [];
    fixture.client.linkedRecords.listPortalOptions = async (input) => {
        reads.push(structuredClone(input));
        return nameKeyChoices ? optionsWithNameKeys(policy) : options(policy);
    };
    fixture.client.portals.updateGridCell = async (input) => {
        updates.push(structuredClone(input));
        return {
            record: {
                id: input.recordId,
                fields: { [input.recordFieldId]: input.value },
            },
            auditTrail: null,
            auditTrails: [],
        };
    };
    fixture.client.portals.getUserRecord = async () => ({
        id: page.payload.formRecord.recordId,
        fields: {},
    });
    const { createPortalView } = await import(
        `${pathToFileURL(join(directory, 'portal.mjs')).href}?case=${++moduleRevision}`
    );
    const failures: unknown[] = [];
    let pending = Promise.resolve();
    const view = createPortalView({
        page,
        client: fixture.client,
        getScope: () => ({ ownerId: 'synthetic_visitor', revision: 0 }),
        run: (
            _description: string,
            action: (context: {
                client: MiniExtensionsClient;
                signal: AbortSignal;
                current(): boolean;
            }) => Promise<void>
        ) => {
            pending = action({
                client: fixture.client,
                signal: new AbortController().signal,
                current: () => true,
            }).catch((error) => {
                failures.push(error);
            });
            return pending;
        },
        status: () => {},
        confirm: async () => false,
        openChild: () => {
            throw new Error('Unexpected synthetic child Form load.');
        },
    });
    window.document.body.append(view.node);
    test.after(() => view.destroy());
    const click = async (title: string) => {
        button(view.node, title).click();
        await pending;
        assert.deepEqual(failures, []);
    };
    return {
        window,
        view,
        click,
        reads,
        updates,
        settle: () => pending,
        failures,
    };
};

describe(
    'actual starter safe public presentation',
    { concurrency: false },
    () => {
        for (const mode of [
            'number-mask',
            'text-mask',
            'write-mask-only',
            'missing',
            'malformed',
        ] as const)
            it(`uses accepted Portal display policy for ${mode} row summaries without promoting child write policy`, async (test) => {
                const numeric = mode === 'number-mask';
                const field: RuntimeAirtableField = numeric
                    ? {
                          ...linkedField,
                          name: 'Synthetic summary',
                          config: {
                              type: AirtableFieldType.NUMBER,
                              options: { precision: 0 },
                          },
                      }
                    : {
                          ...linkedField,
                          name: 'Synthetic summary',
                          config: {
                              type: AirtableFieldType.SINGLE_LINE_TEXT,
                              options: null,
                          },
                      };
                const display =
                    mode === 'missing'
                        ? undefined
                        : mode === 'malformed'
                          ? { maskPasswordOnLoginScreen: 'false' }
                          : numeric
                            ? { maskPasswordOnLoginScreen: true }
                            : { obscurePassword: mode === 'text-mask' };
                const write =
                    mode === 'write-mask-only' ? { obscurePassword: true } : {};
                const detail = {
                    fieldId: field.id,
                    fieldName: field.name,
                    titleOverride: null,
                    isHidden: false,
                    fieldIsInEditingChildForm: true,
                    childFormField: {
                        idOrName: { type: 'id', id: field.id },
                        config: { type: field.config.type, config: write },
                    },
                    miniExtConfig: display,
                } as RuntimeLinkedRecordDetailField;
                const value = numeric ? 1234 : secret;
                const h = await mountPortal(test, 'visible', false, {
                    field,
                    detail,
                    value,
                });
                await h.click('Load records');
                const cell = h.view.node.querySelector('tbody td');
                assert.ok(cell);
                const expected =
                    mode === 'number-mask' || mode === 'text-mask'
                        ? '••••••••'
                        : mode === 'write-mask-only'
                          ? secret
                          : 'Value unavailable';
                assert.equal(cell.textContent, `${expected}Edit cell`);
                assert.equal(cell.title, '');
                if (mode !== 'write-mask-only') assertNoSecret(h.window);
                assert.equal(h.updates.length, 0);
                if (numeric || mode === 'write-mask-only') {
                    await h.click('Edit cell');
                    const input = formInput(h.window, field.id);
                    assert.equal(input.value, String(value));
                    if (!numeric) assert.equal(input.type, 'password');
                    input.value = numeric ? '5678' : 'Permitted new summary';
                    input.dispatchEvent(
                        new h.window.Event('input', { bubbles: true })
                    );
                    const form = input.closest('form');
                    assert.ok(form);
                    submit(h.window, form);
                    await h.settle();
                    assert.equal(h.updates.length, 1);
                    assert.equal(
                        h.updates[0].value,
                        numeric ? 5678 : 'Permitted new summary'
                    );
                    assert.equal(
                        h.view.node.querySelector('tbody td')?.textContent,
                        `${numeric ? '••••••••' : 'Permitted new summary'}Edit cell`
                    );
                }
                assert.deepEqual(detail.miniExtConfig, display);
                assert.deepEqual(detail.childFormField?.config.config, write);
            });

        for (const outcome of ['validation', 'unknown'] as const)
            it(`withholds a login-masked Number from ${outcome} presentation while preserving its native Save input`, async (test) => {
                const form = recoveryForm();
                const previous = form.payload.fieldIdsToSchemas.fld_title;
                assert.ok(previous);
                const target = {
                    ...previous,
                    fieldType: AirtableFieldType.NUMBER,
                    airtableField: {
                        ...previous.airtableField,
                        config: {
                            type: AirtableFieldType.NUMBER,
                            options: { precision: 0 },
                        },
                    },
                    miniExtConfig: { maskPasswordOnLoginScreen: true },
                } as const;
                form.payload.fieldIdsToSchemas.fld_title = target;
                form.payload.fieldNamesToSchemas['Private target'] = target;
                form.payload.formRecord.data.fld_title = 1234;
                const h = await mountForm(
                    test,
                    form,
                    'visible',
                    {
                        type: 'error',
                        formValidationErrors: [
                            {
                                fieldId: 'fld_title',
                                fieldTitle: `${secret} title`,
                                errorMessage: `${secret} numeric validation`,
                            },
                        ],
                        formErrors: {},
                        concurrentEditErrorMessage: undefined,
                    },
                    outcome === 'unknown'
                        ? {
                              saveFailure: new Error(
                                  'Synthetic Number Save outcome unknown'
                              ),
                          }
                        : undefined
                );
                editInput(h.window, 'fld_title', '5678');
                editInput(h.window, 'fld_public', 'Safe adjacent update');
                const card = formInput(h.window, 'fld_public').closest('form');
                assert.ok(card);
                submit(h.window, card);
                await waitFor(() => h.saves.length === 1 && idle(h.window));
                assert.equal(h.saves[0].formRecord.data.fld_title, 5678);
                assert.ok(
                    h.saves[0].formFieldIdsWithUnsavedChanges.includes(
                        'fld_title'
                    )
                );
                assert.equal(formInput(h.window, 'fld_title').value, '5678');
                assertNoSecret(h.window);
                if (outcome === 'validation') {
                    const errors = card.querySelector(
                        '.error-list[role="alert"]'
                    );
                    assert.ok(errors);
                    assert.equal(errors.closest('[hidden]'), null);
                    assert.ok(
                        errors.textContent?.includes(
                            'A configured field needs attention.'
                        )
                    );
                } else {
                    const panel = recoveryPanel(h.window);
                    assert.equal(panel.closest('[hidden]'), null);
                    assert.ok(
                        panel.textContent?.includes('Safe adjacent update')
                    );
                    assert.equal(
                        panel.textContent?.includes('Private target'),
                        false
                    );
                    assert.equal(panel.textContent?.includes('5678'), false);
                }
                assert.equal(h.saves.length, 1);
            });

        it('reprojects retained recovery input when a driver hides its field after an acknowledged fresh edit load', async (test) => {
            let form = recoveryForm();
            const target = form.payload.fieldIdsToSchemas.fld_title;
            assert.ok(target);
            target.miniExtConfig = {
                conditionalFields: driverCondition(),
            };
            form.payload.formRecord = {
                type: 'edit',
                recordId: 'record_synthetic_allowed',
                tableId: 'table_synthetic',
                data: structuredClone(form.payload.formRecord.data),
            };
            const h = await mountForm(test, form, 'visible', blankValidation, {
                getForm: () => form,
                saveFailure: new Error('Synthetic edit Save outcome unknown'),
            });
            editInput(h.window, 'fld_title', secret);
            const card = formInput(h.window, 'fld_title').closest('form');
            assert.ok(card);
            submit(h.window, card);
            await waitFor(() => h.saves.length === 1 && idle(h.window));
            assert.equal(h.saves[0].formRecord.type, 'edit');
            assert.equal(h.saves[0].formRecord.data.fld_title, secret);
            assert.ok(recoveryPanel(h.window).textContent?.includes(secret));

            form = structuredClone(form);
            form.payload.formRecord.data.fld_title = 'Fresh canonical value';
            const reload = h.window.document.getElementById('reload');
            assert.ok(reload instanceof h.window.HTMLButtonElement);
            reload.click();
            await waitFor(() => h.loads() === 2 && idle(h.window));
            assert.equal(
                formInput(h.window, 'fld_title').value,
                'Fresh canonical value'
            );
            button(recoveryPanel(h.window), 'Use this request').click();
            await waitFor(
                () => h.window.document.querySelector('dialog[open]') !== null
            );
            const dialog = h.window.document.querySelector('dialog[open]');
            assert.ok(dialog);
            button(dialog, 'Use this request').click();
            await waitFor(
                () =>
                    h.window.document.querySelector('dialog[open]') === null &&
                    !Array.from(
                        recoveryPanel(h.window).querySelectorAll('button')
                    ).some(
                        (node) =>
                            node.textContent?.trim() === 'Use this request'
                    )
            );
            assert.ok(recoveryPanel(h.window).textContent?.includes(secret));
            const driver = formInput(h.window, 'fld_driver');
            driver.checked = false;
            driver.dispatchEvent(
                new h.window.Event('change', { bubbles: true })
            );
            assert.ok(formInput(h.window, 'fld_title').closest('[hidden]'));
            assert.equal(
                recoveryPanel(h.window).textContent?.includes(secret),
                false
            );
            assertNoSecret(h.window);
            assert.equal(
                formInput(h.window, 'fld_title').value,
                'Fresh canonical value'
            );
            driver.checked = true;
            driver.dispatchEvent(
                new h.window.Event('change', { bubbles: true })
            );
            assert.equal(
                formInput(h.window, 'fld_title').closest('[hidden]'),
                null
            );
            assert.ok(recoveryPanel(h.window).textContent?.includes(secret));
            assert.equal(h.saves.length, 1);
        });

        it('reprojects aggregate validation errors when a driver hides their field while preserving safe blockers', async (test) => {
            const form = recoveryForm();
            const target = form.payload.fieldIdsToSchemas.fld_title;
            assert.ok(target);
            target.miniExtConfig = {
                conditionalFields: driverCondition(),
            };
            const concurrentMessage = 'Synthetic concurrent edit blocker';
            const h = await mountForm(test, form, 'visible', {
                type: 'error',
                formValidationErrors: [
                    {
                        fieldId: 'fld_title',
                        fieldTitle: 'Private target',
                        errorMessage: `${secret} validation details`,
                    },
                ],
                formErrors: {},
                concurrentEditErrorMessage: concurrentMessage,
            });
            editInput(h.window, 'fld_public', 'Safe adjacent update');
            const card = formInput(h.window, 'fld_public').closest('form');
            assert.ok(card);
            submit(h.window, card);
            await waitFor(() => h.saves.length === 1 && idle(h.window));
            const errors = card.querySelector('.error-list[role="alert"]');
            assert.ok(errors);
            assert.equal(
                formInput(h.window, 'fld_title').closest('[hidden]'),
                null
            );
            assert.ok(errors.textContent?.includes(secret));
            const driver = formInput(h.window, 'fld_driver');
            driver.checked = false;
            driver.dispatchEvent(
                new h.window.Event('change', { bubbles: true })
            );
            assert.ok(formInput(h.window, 'fld_title').closest('[hidden]'));
            assert.equal(errors.textContent?.includes(secret), false);
            assert.equal(errors.closest('[hidden]'), null);
            assert.equal(errors.children.length, 2);
            assert.ok(
                errors.textContent?.includes(
                    'A configured field needs attention.'
                )
            );
            assert.ok(errors.textContent?.includes(concurrentMessage));
            assertNoSecret(h.window);
            assert.equal(
                formInput(h.window, 'fld_title').value,
                'Initial private target'
            );
            driver.checked = true;
            driver.dispatchEvent(
                new h.window.Event('change', { bubbles: true })
            );
            assert.equal(
                formInput(h.window, 'fld_title').closest('[hidden]'),
                null
            );
            assert.ok(errors.textContent?.includes(secret));
            assert.ok(errors.textContent?.includes(concurrentMessage));
            assert.equal(h.saves.length, 1);
        });

        it('withholds a dirty target hidden before an unknown Save from the visible recovery reference while preserving native input', async (test) => {
            const form = recoveryForm();
            const target = form.payload.fieldIdsToSchemas.fld_title;
            assert.ok(target);
            target.miniExtConfig = {
                conditionalFields: driverCondition(),
            };
            const h = await mountForm(test, form, 'visible', blankValidation, {
                saveFailure: new Error('Synthetic Save outcome unknown'),
            });
            editInput(h.window, 'fld_title', secret);
            const driver = formInput(h.window, 'fld_driver');
            driver.checked = false;
            driver.dispatchEvent(
                new h.window.Event('change', { bubbles: true })
            );
            assert.ok(formInput(h.window, 'fld_title').closest('[hidden]'));
            editInput(h.window, 'fld_public', 'Safe recovery text');
            const card = driver.closest('form');
            assert.ok(card);
            submit(h.window, card);
            await waitFor(() => h.saves.length === 1 && idle(h.window));
            const panel = recoveryPanel(h.window);
            assert.equal(panel.closest('[hidden]'), null);
            assert.ok(panel.textContent?.includes('outcome'));
            assert.ok(panel.textContent?.includes('Safe recovery text'));
            assert.equal(panel.textContent?.includes('Private target'), false);
            assert.equal(panel.textContent?.includes(secret), false);
            assertNoSecret(h.window);
            assert.equal(h.saves[0].formRecord.data.fld_title, secret);
            assert.equal(
                h.saves[0].formRecord.data.fld_public,
                'Safe recovery text'
            );
            assert.equal(h.saves[0].formRecord.data.fld_driver, false);
            assert.ok(
                h.saves[0].formFieldIdsWithUnsavedChanges.includes('fld_title')
            );
            assert.equal(h.saves.length, 1);
        });

        for (const replacementPolicy of ['hidden', 'masked'] as const)
            it(`rechecks retained reference provenance after explicit Reload changes a visible field to ${replacementPolicy}`, async (test) => {
                let form = recoveryForm();
                const h = await mountForm(
                    test,
                    form,
                    'visible',
                    blankValidation,
                    {
                        getForm: () => form,
                        saveFailure: new Error(
                            'Synthetic Save outcome unknown'
                        ),
                    }
                );
                editInput(h.window, 'fld_title', secret);
                editInput(h.window, 'fld_public', 'Safe recovery text');
                const card = formInput(h.window, 'fld_public').closest('form');
                assert.ok(card);
                submit(h.window, card);
                await waitFor(() => h.saves.length === 1 && idle(h.window));
                assert.ok(
                    recoveryPanel(h.window).textContent?.includes(secret)
                );
                assert.ok(
                    recoveryPanel(h.window).textContent?.includes(
                        'Safe recovery text'
                    )
                );
                const dispatched = structuredClone(h.saves[0]);

                form = structuredClone(form);
                const replacement = form.payload.fieldIdsToSchemas.fld_title;
                assert.ok(replacement);
                replacement.miniExtConfig =
                    replacementPolicy === 'masked'
                        ? { obscurePassword: true }
                        : { conditionalFields: driverCondition(false) };
                form.payload.formRecord.data.fld_title =
                    'Fresh canonical value';
                const reload = h.window.document.getElementById('reload');
                assert.ok(reload instanceof h.window.HTMLButtonElement);
                reload.click();
                await waitFor(() => h.loads() === 2 && idle(h.window));
                const panel = recoveryPanel(h.window);
                assert.equal(panel.closest('[hidden]'), null);
                assert.ok(panel.textContent?.includes('Safe recovery text'));
                assert.equal(
                    panel.textContent?.includes('Private target'),
                    false
                );
                assert.equal(panel.textContent?.includes(secret), false);
                assertNoSecret(h.window);
                assert.deepEqual(h.saves, [dispatched]);
            });

        it('uses an own primary name-key Form caption while saving canonical native IDs', async (test) => {
            const h = await mountForm(
                test,
                linkedForm('visible'),
                'visible',
                blankValidation,
                { nameKeyChoices: true }
            );
            const control = linkedControl(h.window);
            button(control.node, 'Search choices').click();
            await waitFor(() => h.reads.length === 1 && idle(h.window));
            const label = selectChoice(h.window, control.node);
            assert.equal(label.textContent, visibleTitle);
            assert.deepEqual(JSON.parse(control.raw.value), [recordId]);
            const card = control.node.closest('form');
            assert.ok(card);
            submit(h.window, card);
            await waitFor(() => h.saves.length === 1 && idle(h.window));
            assert.deepEqual(h.saves[0].formRecord.data[linkedField.id], [
                recordId,
            ]);
        });
        it('uses an own primary name-key Portal caption while preserving canonical cell writes', async (test) => {
            const h = await mountPortal(test, 'visible', true);
            await h.click('Load records');
            await h.click('Edit cell');
            await h.click('Search choices');
            const label = selectChoice(h.window, h.view.node);
            assert.equal(label.textContent, visibleTitle);
            const form = label.closest('form');
            assert.ok(form);
            submit(h.window, form);
            await h.settle();
            assert.deepEqual(h.failures, []);
            assert.equal(h.updates.length, 1);
            assert.deepEqual(h.updates[0].value, [recordId]);
        });
        for (const policy of ['hidden', 'masked', 'visible'] as const) {
            it(`uses the ${policy} target primary policy for Form choice captions without changing native selections`, async (test) => {
                const h = await mountForm(test, linkedForm(policy), policy);
                const control = linkedControl(h.window);
                button(control.node, 'Search choices').click();
                await waitFor(() => h.reads.length === 1 && idle(h.window));
                const label = selectChoice(h.window, control.node);
                if (policy === 'visible')
                    assert.equal(label.textContent, visibleTitle);
                else assertNoSecret(h.window);
                assert.deepEqual(JSON.parse(control.raw.value), [recordId]);
                const card = control.node.closest('form');
                assert.ok(card);
                submit(h.window, card);
                await waitFor(() => h.saves.length === 1 && idle(h.window));
                assert.deepEqual(h.saves[0].formRecord.data[linkedField.id], [
                    recordId,
                ]);
                if (policy !== 'visible') assertNoSecret(h.window);
            });

            it(`uses the ${policy} target primary policy for Portal inline choice captions without changing canonical writes`, async (test) => {
                const h = await mountPortal(test, policy);
                await h.click('Load records');
                await h.click('Edit cell');
                await h.click('Search choices');
                assert.equal(h.reads.length, 1);
                const label = selectChoice(h.window, h.view.node);
                if (policy === 'visible')
                    assert.equal(label.textContent, visibleTitle);
                else assertNoSecret(h.window);
                const form = label.closest('form');
                assert.ok(form);
                submit(h.window, form);
                await h.settle();
                assert.deepEqual(h.failures, []);
                assert.equal(h.updates.length, 1);
                assert.deepEqual(h.updates[0].value, [recordId]);
                if (policy !== 'visible') assertNoSecret(h.window);
            });
        }

        for (const policy of ['hidden', 'masked'] as const)
            it(`shows a visible safe blocker for a ${policy} Form validation error`, async (test) => {
                const form = linkedForm('visible');
                const title = form.payload.fieldIdsToSchemas.fld_title;
                assert.ok(title);
                const privateField = structuredClone(title);
                privateField.airtableField.id = 'fld_private';
                privateField.airtableField.name = 'Private field';
                privateField.miniExtConfig =
                    policy === 'hidden'
                        ? {
                              conditionalFields: {
                                  logicalOperator: 'and',
                                  conditions: [
                                      {
                                          id: 'private_visibility',
                                          type: 'singleCondition',
                                          setting: {
                                              type: 'is',
                                              fieldType:
                                                  AirtableFieldType.SINGLE_LINE_TEXT,
                                              idOrName: {
                                                  type: 'id',
                                                  id: 'fld_title',
                                              },
                                              value: 'Never match synthetic title',
                                          },
                                      },
                                  ],
                              },
                          }
                        : { obscurePassword: true };
                form.payload.fieldIdsInForm = ['fld_title', 'fld_private'];
                form.payload.fieldIdsToSchemas = {
                    fld_title: title,
                    fld_private: privateField,
                };
                form.payload.fieldNamesToSchemas = {
                    Title: title,
                    'Private field': privateField,
                };
                form.payload.formRecord.data = {
                    fld_title: 'Initial title',
                    fld_private:
                        policy === 'hidden' ? null : 'Opaque native input',
                };
                const h = await mountForm(test, form, 'visible', {
                    type: 'error',
                    formValidationErrors: [
                        {
                            fieldId: 'fld_private',
                            fieldTitle: `${secret} title`,
                            errorMessage: `${secret} message`,
                        },
                    ],
                    formErrors: {},
                });
                const privateInput = formInput(h.window, 'fld_private');
                assert.equal(
                    privateInput.closest('[hidden]') !== null,
                    policy === 'hidden',
                    'The regression must exercise the actual field visibility.'
                );
                const titleInput = h.window.document.querySelector(
                    '[data-field-id="fld_title"]'
                );
                assert.ok(titleInput instanceof h.window.HTMLInputElement);
                titleInput.value = 'Changed title';
                titleInput.dispatchEvent(
                    new h.window.Event('input', { bubbles: true })
                );
                const card = titleInput.closest('form');
                assert.ok(card);
                submit(h.window, card);
                await waitFor(() => h.saves.length === 1 && idle(h.window));
                const errors = card.querySelector('.error-list[role="alert"]');
                assert.ok(errors);
                assert.equal(errors.closest('[hidden]'), null);
                assert.ok(
                    errors.textContent?.trim(),
                    'A denied field still needs a visible blocking explanation.'
                );
                assertNoSecret(h.window);
                assert.equal(h.saves.length, 1);
            });
    }
);
