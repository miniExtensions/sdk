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
    createMiniExtensionsClient,
    type AirtableValue,
    type LoadExtensionInput,
    type RuntimeFieldSchema,
    type SaveFormInput,
    type SelectFieldChoice,
    type UpdateGridCellInput,
} from '../src/runtime/index.js';
import { loadedForm } from './formsFixtures.js';
import { portalListPage, portalPage } from './portalFixtures.js';

type DOMSelect = InstanceType<Window['HTMLSelectElement']>;
type DOMElement = InstanceType<Window['Element']>;
const root = resolve(process.cwd());
let directory: string;
let moduleRevision = 0;

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-browser-selects-'));
    // Exercise the real example modules without requiring its separately
    // installed archive or copying any renderer into these regressions.
    await Promise.all(
        ['fields', 'main', 'portal'].map((name) =>
            build({
                entryPoints: [join(root, 'examples/browser/src', `${name}.ts`)],
                alias: {
                    '@miniextensions/sdk/auth': join(root, 'src/auth/index.ts'),
                    '@miniextensions/sdk/ui': join(root, 'src/ui/index.ts'),
                    '@miniextensions/sdk/forms': join(
                        root,
                        'src/forms/index.ts'
                    ),
                    '@miniextensions/sdk/portals': join(
                        root,
                        'src/portals/index.ts'
                    ),
                    '@miniextensions/sdk': join(root, 'src/runtime/index.ts'),
                },
                bundle: true,
                platform: 'node',
                format: 'esm',
                outfile: join(directory, `${name}.mjs`),
                logLevel: 'silent',
            })
        )
    );
});

after(async () => rm(directory, { recursive: true, force: true }));
const example = (name: string) =>
    import(
        `${pathToFileURL(join(directory, `${name}.mjs`)).href}?case=${++moduleRevision}`
    );

const environment = async (
    test: TestContext,
    fetch?: typeof globalThis.fetch
) => {
    const window = new Window({
        url: 'https://app.example.test',
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
        },
    });
    const markup = await readFile(
        join(root, 'examples/browser/index.html'),
        'utf8'
    );
    window.document.write(
        markup.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    );
    // HappyDOM lacks the browser Option constructor. Its native option elements
    // still exercise selection, events and the actual example renderer.
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
        Option,
        fetch:
            fetch ??
            (async () => {
                throw new Error('Unexpected network request.');
            }),
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
    return window;
};

const selectSchema = (
    multiple = true
): Extract<
    RuntimeFieldSchema,
    { fieldType: 'singleSelect' | 'multipleSelects' }
> => {
    const metadata = {
        id: 'fld_colors',
        name: 'Colors',
        description: null,
        isComputed: false,
        isPrimaryField: false,
    };
    const options = {
        choices: [
            { id: 'sel_red', name: 'Red' },
            { id: 'sel_blue', name: 'Blue' },
        ],
    };
    return multiple
        ? {
              fieldType: AirtableFieldType.MULTIPLE_SELECTS,
              airtableField: {
                  ...metadata,
                  config: { type: AirtableFieldType.MULTIPLE_SELECTS, options },
              },
              miniExtConfig: { title: 'Colors', allowAddingNewOptions: true },
          }
        : {
              fieldType: AirtableFieldType.SINGLE_SELECT,
              airtableField: {
                  ...metadata,
                  config: { type: AirtableFieldType.SINGLE_SELECT, options },
              },
          };
};
const selected = (select: DOMSelect) =>
    Array.from(select.options)
        .filter((option) => option.selected)
        .map((option) => option.value);
const change = (window: Window, node: DOMElement) =>
    node.dispatchEvent(new window.Event('change', { bubbles: true }));
const submit = (window: Window, node: DOMElement) =>
    node.dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true })
    );
const colorSelect = (window: Window): DOMSelect => {
    const select = window.document.querySelector(
        'select[data-field-id="fld_colors"]'
    );
    assert.ok(select instanceof window.HTMLSelectElement);
    return select;
};
const chooseBlue = (window: Window, select: DOMSelect) => {
    const option = Array.from(select.options).find(
        (entry) => entry.value === 'Blue'
    );
    assert.ok(option);
    option.selected = true;
    change(window, select);
};
const button = (window: Window, title: string) => {
    const found = Array.from(window.document.querySelectorAll('button')).find(
        (node) => node.textContent?.trim() === title
    );
    assert.ok(found, `Missing button: ${title}`);
    return found;
};
const waitFor = async (predicate: () => boolean) => {
    for (let turn = 0; turn < 30; turn++) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.fail('Example action did not reach its expected state.');
};
const selectForm = () => {
    const form = loadedForm();
    form.payload.fieldIdsInForm = ['fld_colors'];
    form.payload.fieldIdsToSchemas = { fld_colors: selectSchema() };
    form.payload.formRecord.data.fld_colors = ['Legacy', 'Red'];
    return form;
};

const dynamicSelectForm = (multiple: boolean) => {
    const form = loadedForm();
    const schema = selectSchema(multiple);
    schema.miniExtConfig = {
        enableConditionalOptions: true,
        singleOrMultiSelectLimitSelectionOptions: ['sel_red', 'sel_blue'],
        maxNumberOfSelections: 2,
        conditionsForOptions: [
            {
                id: 'rule_blue',
                config: {
                    optionForConditions: 'sel_blue',
                    name: 'Conditional Blue',
                    conditionsForOption: {
                        logicalOperator: 'and',
                        conditions: [
                            {
                                id: 'driver_contains',
                                type: 'singleCondition',
                                setting: {
                                    type: 'contains',
                                    fieldType: 'singleLineText',
                                    idOrName: { type: 'id', id: 'fld_driver' },
                                    value: 'allowed',
                                },
                            },
                        ],
                    },
                },
            },
        ],
    };
    const driver: RuntimeFieldSchema = {
        fieldType: AirtableFieldType.SINGLE_LINE_TEXT,
        airtableField: {
            id: 'fld_driver',
            name: 'Driver',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
        },
    };
    form.payload.fieldIdsInForm = ['fld_driver', 'fld_colors'];
    form.payload.fieldIdsToSchemas = { fld_driver: driver, fld_colors: schema };
    form.payload.fieldNamesToSchemas = { Driver: driver, Colors: schema };
    form.payload.formRecord = {
        type: 'create',
        data: {
            fld_driver: 'denied',
            fld_colors: multiple ? [] : null,
            fld_adjacent: 'Preserved adjacent baseline',
        },
    };
    form.payload.formFieldIdsWithUnsavedChanges = [];
    form.payload.urlPrefilledFieldIds = [];
    return form;
};

const mountDynamicSelectForm = async (
    test: TestContext,
    form: ReturnType<typeof dynamicSelectForm>,
    additionalRequest?: (url: URL, init: RequestInit | undefined) => Response
) => {
    const saves: SaveFormInput[] = [];
    const requests: string[] = [];
    const window = await environment(test, async (input, init) => {
        const url = new URL(String(input));
        requests.push(url.pathname + url.search);
        if (url.searchParams.get('route') === 'fetchExtensionForEndUser')
            return new Response(JSON.stringify(form));
        if (url.searchParams.get('route') === 'saveForm') {
            saves.push(JSON.parse(String(init?.body)));
            return new Response(
                JSON.stringify({
                    type: 'error',
                    formValidationErrors: [],
                    formErrors: {},
                })
            );
        }
        if (additionalRequest) return additionalRequest(url, init);
        throw new Error('Unexpected configured-choice fixture request.');
    });
    await example('main');
    const origin = window.document.getElementById('api-origin');
    const share = window.document.getElementById('share-id');
    const connection = window.document.getElementById('connection-form');
    assert.ok(origin instanceof window.HTMLInputElement);
    assert.ok(share instanceof window.HTMLInputElement);
    assert.ok(connection);
    origin.value = 'https://sdk.example.test';
    share.value = 'share_example';
    submit(window, connection);
    await waitFor(
        () =>
            window.document.querySelector(
                'select[data-field-id="fld_colors"]'
            ) !== null
    );
    return { window, saves, requests };
};

describe('actual Form starter configured scalar choices', () => {
    for (const multiple of [false, true]) {
        it(`${multiple ? 'multi' : 'single'} recomputes from accepted driver edits, retains denied names, and saves native removal`, async (test) => {
            const form = dynamicSelectForm(multiple);
            const { window, saves, requests } = await mountDynamicSelectForm(
                test,
                form
            );
            const select = colorSelect(window);
            const driver = window.document.querySelector(
                'input[data-field-id="fld_driver"]'
            );
            assert.ok(driver instanceof window.HTMLInputElement);
            const eligible = () =>
                Array.from(select.options)
                    .map((option) => option.value)
                    .filter(Boolean);
            assert.deepEqual(eligible(), ['Red']);
            assert.equal(saves.length, 0);
            assert.equal(requests.length, 1);
            driver.value = 'allowed';
            change(window, driver);
            assert.equal(colorSelect(window), select);
            assert.deepEqual(eligible(), ['Red', 'Blue']);
            chooseBlue(window, select);
            driver.value = 'denied again';
            change(window, driver);
            assert.deepEqual(selected(select), ['Blue']);
            const retained = Array.from(select.options).find(
                (option) => option.value === 'Blue'
            );
            assert.ok(retained);
            assert.equal(retained.textContent, 'Conditional Blue');
            assert.equal(retained.disabled, false);
            assert.equal(saves.length, 0);
            assert.equal(requests.length, 1);
            const card = select.closest('form');
            assert.ok(card);
            submit(window, card);
            await waitFor(
                () =>
                    saves.length === 1 &&
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            assert.deepEqual(
                saves[0]!.formRecord.data.fld_colors,
                multiple ? ['Blue'] : 'Blue'
            );
            assert.equal(saves[0]!.formRecord.data.fld_driver, 'denied again');
            assert.equal(
                saves[0]!.formRecord.data.fld_adjacent,
                'Preserved adjacent baseline'
            );
            for (const option of select.options) option.selected = false;
            if (!multiple) select.value = '';
            change(window, select);
            assert.deepEqual(eligible(), ['Red']);
            const injected = window.document.createElement('option');
            injected.value = 'Blue';
            injected.selected = true;
            select.append(injected);
            change(window, select);
            assert.deepEqual(selected(select).filter(Boolean), []);
            submit(window, card);
            await waitFor(
                () =>
                    saves.length === 2 &&
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            assert.deepEqual(
                saves[1]!.formRecord.data.fld_colors,
                multiple ? [] : null
            );
            assert.equal(
                saves[1]!.formRecord.data.fld_adjacent,
                'Preserved adjacent baseline'
            );
            assert.deepEqual(
                new Set(saves[1]!.formFieldIdsWithUnsavedChanges),
                new Set(['fld_driver', 'fld_colors'])
            );
            assert.equal(
                requests.length,
                3,
                'Availability and driver edits must not issue requests'
            );
        });
    }

    for (const multiple of [false, true]) {
        it(`${multiple ? 'multi' : 'single'} does not reselect a denied existing choice returned by Add Choice after removal`, async (test) => {
            const form = dynamicSelectForm(multiple);
            const schema = form.payload.fieldIdsToSchemas.fld_colors!;
            const config = schema.miniExtConfig;
            assert.ok(config && 'enableConditionalOptions' in config);
            config.singleOrMultiSelectLimitSelectionOptions = [];
            config.allowAddingNewOptions = true;
            form.payload.formRecord.data.fld_colors = multiple
                ? ['Blue']
                : 'Blue';
            let creationCalls = 0;
            const { window, saves, requests } = await mountDynamicSelectForm(
                test,
                form,
                (url) => {
                    assert.equal(
                        url.pathname,
                        '/api/trpc/airtable.addNewAirtableOptionForFormField'
                    );
                    creationCalls++;
                    // The canonical route can reuse an equivalent existing
                    // name without evaluating that choice's conditions.
                    return new Response(
                        JSON.stringify({
                            result: {
                                data: {
                                    newChoice: { id: 'sel_blue', name: 'Blue' },
                                },
                            },
                        })
                    );
                }
            );
            const select = colorSelect(window);
            assert.deepEqual(selected(select), ['Blue']);
            for (const option of select.options) option.selected = false;
            if (!multiple) select.value = '';
            change(window, select);
            assert.deepEqual(selected(select).filter(Boolean), []);
            assert.equal(
                Array.from(select.options).some(
                    (option) => option.value === 'Blue'
                ),
                false
            );
            const card = select.closest('form');
            assert.ok(card);
            submit(window, card);
            await waitFor(
                () =>
                    saves.length === 1 &&
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            assert.deepEqual(
                saves[0]!.formRecord.data.fld_colors,
                multiple ? [] : null
            );
            const dirtyBefore = [...saves[0]!.formFieldIdsWithUnsavedChanges];
            const choice = window.document.querySelector(
                'input[placeholder="New choice name"]'
            );
            assert.ok(choice instanceof window.HTMLInputElement);
            choice.value = ' blue ';
            button(window, 'Create choice').click();
            await waitFor(
                () =>
                    creationCalls === 1 &&
                    choice.value === '' &&
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            // Decisive actual-control sink: ready status alone must not make
            // the reused denied native name selectable through setValue.
            assert.deepEqual(selected(colorSelect(window)).filter(Boolean), []);
            assert.equal(
                Array.from(colorSelect(window).options).some(
                    (option) => option.value === 'Blue'
                ),
                false
            );
            assert.equal(saves.length, 1, 'Add Choice must not save a record');
            submit(window, card);
            await waitFor(
                () =>
                    saves.length === 2 &&
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            assert.deepEqual(
                saves[1]!.formRecord.data.fld_colors,
                multiple ? [] : null
            );
            assert.deepEqual(
                saves[1]!.formFieldIdsWithUnsavedChanges,
                dirtyBefore
            );
            assert.equal(saves[1]!.formRecord.data.fld_driver, 'denied');
            assert.equal(
                saves[1]!.formRecord.data.fld_adjacent,
                'Preserved adjacent baseline'
            );
            assert.equal(requests.length, 4);
        });
    }

    it('blocks a broader projected context with finite presentation status while permitting retained removal', async (test) => {
        const form = dynamicSelectForm(true);
        const driver = form.payload.fieldIdsToSchemas.fld_driver!;
        driver.miniExtConfig = {
            conditionalFields: { logicalOperator: 'and', conditions: [] },
        };
        form.payload.formRecord.data.fld_colors = ['Blue'];
        const { window, saves, requests } = await mountDynamicSelectForm(
            test,
            form
        );
        const select = colorSelect(window);
        assert.deepEqual(selected(select), ['Blue']);
        assert.deepEqual(
            Array.from(select.options).map((option) => option.value),
            ['Blue']
        );
        const diagnostic = window.document.querySelector(
            '[data-choice-availability-field-id="fld_colors"]'
        );
        assert.ok(diagnostic instanceof window.HTMLElement);
        assert.equal(diagnostic.dataset.choiceAvailability, 'blocked');
        assert.equal(
            diagnostic.dataset.choiceAvailabilityCode,
            'unavailable-record'
        );
        assert.equal(select.disabled, false);
        assert.equal(saves.length, 0);
        for (const option of select.options) option.selected = false;
        change(window, select);
        assert.equal(select.options.length, 0);
        const card = select.closest('form');
        assert.ok(card);
        submit(window, card);
        await waitFor(
            () =>
                saves.length === 1 &&
                window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        assert.deepEqual(saves[0]!.formRecord.data.fld_colors, []);
        assert.equal(
            saves[0]!.formRecord.data.fld_adjacent,
            'Preserved adjacent baseline'
        );
        assert.equal(requests.length, 2);
    });
});

const selectPortal = async (
    test: TestContext,
    schema = selectSchema(),
    initialValue: AirtableValue = ['Legacy', 'Red'],
    childConfig?: Extract<
        RuntimeFieldSchema,
        { fieldType: 'multipleSelects' }
    >['miniExtConfig']
) => {
    const window = await environment(test);
    const { createPortalView } = await example('portal');
    const page = portalPage({
        customViews: [
            { id: 'view_example', config: { name: 'Example view' } },
            { id: 'view_other', config: { name: 'Other view' } },
        ],
    });
    page.payload.linkedRecordFieldIdToDetailFields.fld_children = [
        {
            fieldId: 'fld_colors',
            fieldName: 'Colors',
            titleOverride: null,
            isHidden: false,
            fieldIsInEditingChildForm: true,
            childFormField:
                childConfig === undefined
                    ? null
                    : {
                          idOrName: { type: 'id', id: 'fld_colors' },
                          config: {
                              type: 'multipleSelects',
                              config: childConfig,
                          },
                      },
            miniExtConfig: schema.miniExtConfig,
        },
    ];
    const scope = { ownerId: 'visitor_A', revision: 0 };
    let nativeValue = structuredClone(initialValue);
    const updates: UpdateGridCellInput[] = [];
    const errors: string[] = [];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        fetch: async () => {
            throw new Error('Unexpected fixture network.');
        },
    });
    client.portals.listLinkedRecords = async () =>
        portalListPage({
            recordIds: ['record_child'],
            tableIdsToLinkedTableStates: {
                table_children: {
                    airtableFields: [structuredClone(schema.airtableField)],
                    recordIdsToAirtableRecords: {
                        record_child: {
                            id: 'record_child',
                            fields: {
                                fld_colors: structuredClone(nativeValue),
                            },
                        },
                    },
                },
            },
        });
    client.portals.updateGridCell = async (input) => {
        updates.push(structuredClone(input));
        nativeValue = structuredClone(input.value);
        return {
            record: {
                id: 'record_child',
                fields: { fld_colors: structuredClone(input.value) },
            },
            auditTrail: null,
            auditTrails: [],
        };
    };
    client.portals.getUserRecord = async () => null;
    let pending = Promise.resolve();
    const view = createPortalView({
        page,
        client,
        getScope: () => scope,
        run: (
            _description: string,
            action: (context: {
                client: typeof client;
                signal: AbortSignal;
                current(): boolean;
            }) => Promise<void>
        ) => {
            const revision = scope.revision;
            const ownerId = scope.ownerId;
            pending = action({
                client,
                signal: new AbortController().signal,
                current: () =>
                    scope.revision === revision &&
                    scope.ownerId === ownerId &&
                    view.node.isConnected,
            }).catch((error: Error) => {
                errors.push(error.message);
            });
            return pending;
        },
        status: () => {},
        confirm: async () => false,
        openChild: () => {
            throw new Error('Unexpected child Form.');
        },
    });
    window.document.body.append(view.node);
    test.after(() => view.destroy());
    return {
        window,
        view,
        scope,
        updates,
        errors,
        pending: () => pending,
        load: async () => {
            button(window, 'Load records').click();
            await pending;
        },
        open: () => {
            button(window, 'Edit cell').click();
            return colorSelect(window);
        },
        save: async (select: DOMSelect) => {
            const form = select.closest('form');
            assert.ok(form);
            submit(window, form);
            await pending;
        },
    };
};

describe(
    'actual browser example select controls',
    { concurrency: false },
    () => {
        it('enforces a published ID allowlist at the actual Form and Add Choice sink', async (test) => {
            const form = selectForm();
            const schema = selectSchema();
            schema.miniExtConfig = {
                allowAddingNewOptions: true,
                singleOrMultiSelectLimitSelectionOptions: ['sel_blue'],
                enableConditionalOptions: true,
                conditionsForOptions: [
                    {
                        id: 'display_blue',
                        config: {
                            optionForConditions: 'sel_blue',
                            name: '  Azure  ',
                            conditionsForOption: {
                                logicalOperator: 'and',
                                conditions: [],
                            },
                        },
                    },
                ],
            };
            form.payload.fieldIdsToSchemas.fld_colors = schema;
            const saves: SaveFormInput[] = [];
            let choiceCalls = 0;
            const window = await environment(test, async (input, init) => {
                const url = new URL(String(input));
                if (
                    url.searchParams.get('route') === 'fetchExtensionForEndUser'
                )
                    return new Response(JSON.stringify(form));
                if (url.searchParams.get('route') === 'saveForm') {
                    saves.push(JSON.parse(String(init?.body)));
                    return new Response(
                        JSON.stringify({
                            type: 'error',
                            formValidationErrors: [],
                            formErrors: {},
                        })
                    );
                }
                choiceCalls++;
                throw new Error(
                    'A restricted choice must not dispatch a mutation.'
                );
            });
            await example('main');
            const origin = window.document.getElementById('api-origin');
            const share = window.document.getElementById('share-id');
            const connection =
                window.document.getElementById('connection-form');
            assert.ok(origin instanceof window.HTMLInputElement);
            assert.ok(share instanceof window.HTMLInputElement);
            assert.ok(connection);
            origin.value = 'https://sdk.example.test';
            share.value = 'share_example';
            submit(window, connection);
            await waitFor(
                () =>
                    window.document.querySelector(
                        'select[data-field-id="fld_colors"]'
                    ) !== null
            );
            assert.equal(
                window.document.querySelector(
                    'input[placeholder="New choice name"]'
                ),
                null
            );
            assert.equal(
                Array.from(window.document.querySelectorAll('button')).some(
                    (node) => node.textContent === 'Create choice'
                ),
                false
            );
            const select = colorSelect(window);
            assert.equal(
                Array.from(select.options).find(
                    (option) => option.value === 'Blue'
                )?.textContent,
                'Azure'
            );
            assert.deepEqual(
                new Set(selected(select)),
                new Set(['Legacy', 'Red'])
            );
            chooseBlue(window, select);
            const card = select.closest('form');
            assert.ok(card);
            submit(window, card);
            await waitFor(
                () =>
                    saves.length === 1 &&
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            assert.deepEqual(saves[0].formRecord.data.fld_colors, [
                'Legacy',
                'Red',
                'Blue',
            ]);
            assert.equal(
                saves[0].formFieldIdsWithUnsavedChanges.filter(
                    (id) => id === 'fld_colors'
                ).length,
                1
            );
            assert.equal(choiceCalls, 0);
        });

        it('blocks Add Choice at the maximum and selects a confirmed choice only after removal', async (test) => {
            const form = selectForm();
            const schema = selectSchema();
            schema.miniExtConfig = {
                allowAddingNewOptions: true,
                singleOrMultiSelectLimitSelectionOptions: [],
                maxNumberOfSelections: 2,
            };
            form.payload.fieldIdsToSchemas.fld_colors = schema;
            const saves: SaveFormInput[] = [];
            let choiceCalls = 0;
            const window = await environment(test, async (input, init) => {
                const url = new URL(String(input));
                if (
                    url.searchParams.get('route') === 'fetchExtensionForEndUser'
                )
                    return new Response(JSON.stringify(form));
                if (url.searchParams.get('route') === 'saveForm') {
                    saves.push(JSON.parse(String(init?.body)));
                    return new Response(
                        JSON.stringify({
                            type: 'error',
                            formValidationErrors: [],
                            formErrors: {},
                        })
                    );
                }
                if (
                    url.pathname ===
                    '/api/trpc/airtable.addNewAirtableOptionForFormField'
                ) {
                    choiceCalls++;
                    return new Response(
                        JSON.stringify({
                            result: {
                                data: {
                                    newChoice: {
                                        id: 'sel_green',
                                        name: 'Green',
                                        color: 'greenLight2',
                                    },
                                },
                            },
                        })
                    );
                }
                throw new Error('Unexpected select fixture dispatch.');
            });
            await example('main');
            const origin = window.document.getElementById('api-origin');
            const share = window.document.getElementById('share-id');
            const connection =
                window.document.getElementById('connection-form');
            assert.ok(origin instanceof window.HTMLInputElement);
            assert.ok(share instanceof window.HTMLInputElement);
            assert.ok(connection);
            origin.value = 'https://sdk.example.test';
            share.value = 'share_example';
            submit(window, connection);
            await waitFor(
                () =>
                    window.document.querySelector(
                        'input[placeholder="New choice name"]'
                    ) !== null
            );
            const choice = window.document.querySelector(
                'input[placeholder="New choice name"]'
            );
            assert.ok(choice instanceof window.HTMLInputElement);
            choice.value = 'Green';
            button(window, 'Create choice').click();
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.equal(choiceCalls, 0);
            const select = colorSelect(window);
            const legacy = Array.from(select.options).find(
                (option) => option.value === 'Legacy'
            );
            assert.ok(legacy);
            legacy.selected = false;
            change(window, select);
            button(window, 'Create choice').click();
            await waitFor(
                () =>
                    choiceCalls === 1 &&
                    selected(colorSelect(window)).includes('Green')
            );
            const card = colorSelect(window).closest('form');
            assert.ok(card);
            submit(window, card);
            await waitFor(
                () =>
                    saves.length === 1 &&
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            assert.deepEqual(saves[0].formRecord.data.fld_colors, [
                'Red',
                'Green',
            ]);
            assert.equal(
                saves[0].formFieldIdsWithUnsavedChanges.filter(
                    (id) => id === 'fld_colors'
                ).length,
                1
            );
            assert.equal(choiceCalls, 1);
        });

        it('preserves unavailable Form selections, dirties only on a real change, and emits once', async (test) => {
            const window = await environment(test);
            const { formFieldControl } = await example('fields');
            const writes: AirtableValue[] = [];
            const control = formFieldControl(
                selectSchema(),
                ['Legacy', 'Red'],
                () => writes.push(control.read())
            );
            test.after(() => control.destroy());
            window.document.body.append(control.node);
            const select = colorSelect(window);
            assert.deepEqual(control.read(), ['Legacy', 'Red']);
            assert.deepEqual(
                new Set(selected(select)),
                new Set(['Legacy', 'Red'])
            );
            change(window, select);
            assert.deepEqual(writes, []);
            chooseBlue(window, select);
            select.dispatchEvent(new window.Event('input', { bubbles: true }));
            assert.deepEqual(control.read(), ['Legacy', 'Red', 'Blue']);
            assert.deepEqual(writes, [['Legacy', 'Red', 'Blue']]);
            const legacy = Array.from(select.options).find(
                (option) => option.value === 'Legacy'
            );
            assert.ok(legacy);
            legacy.selected = false;
            change(window, select);
            assert.deepEqual(control.read(), ['Red', 'Blue']);
            assert.equal(
                Array.from(select.options).some(
                    (option) => option.value === 'Legacy'
                ),
                false
            );
        });

        it('keeps single-select persisted names until deliberate clear and writes silently', async (test) => {
            const window = await environment(test);
            const { formFieldControl } = await example('fields');
            const writes: AirtableValue[] = [];
            const control = formFieldControl(
                selectSchema(false),
                'Legacy',
                () => writes.push(control.read())
            );
            test.after(() => control.destroy());
            window.document.body.append(control.node);
            const select = colorSelect(window);
            assert.equal(select.value, 'Legacy');
            control.write('Blue');
            assert.equal(control.read(), 'Blue');
            assert.equal(select.value, 'Blue');
            assert.deepEqual(writes, []);
            select.value = '';
            change(window, select);
            assert.equal(control.read(), null);
            assert.deepEqual(writes, [null]);
        });

        it('updates confirmed choices without losing persisted values or emitting hydration changes', async (test) => {
            const window = await environment(test);
            const { formFieldControl } = await example('fields');
            const writes: AirtableValue[] = [];
            const control = formFieldControl(
                selectSchema(),
                ['Legacy', 'Red'],
                () => writes.push(control.read())
            );
            test.after(() => control.destroy());
            window.document.body.append(control.node);
            const green: SelectFieldChoice = {
                id: 'sel_green',
                name: 'Green',
                color: 'greenLight2',
            };
            control.updateSelectChoices([
                { id: 'sel_red', name: 'Red' },
                green,
            ]);
            control.write(['Legacy', 'Red', green.name]);
            assert.deepEqual(control.read(), ['Legacy', 'Red', 'Green']);
            assert.deepEqual(
                new Set(selected(colorSelect(window))),
                new Set(['Legacy', 'Red', 'Green'])
            );
            assert.deepEqual(writes, []);
            assert.equal(
                Array.from(colorSelect(window).options).some(
                    (option) => option.value === 'Blue'
                ),
                false
            );
        });

        it('honors read-only/computed/forced flags and disposes old change handlers', async (test) => {
            const window = await environment(test);
            const { formFieldControl } = await example('fields');
            for (const mode of ['readOnly', 'computed', 'forced']) {
                const schema = selectSchema(false);
                if (mode === 'readOnly')
                    schema.miniExtConfig = { readOnly: true };
                if (mode === 'computed') schema.airtableField.isComputed = true;
                const writes: AirtableValue[] = [];
                const control = formFieldControl(
                    schema,
                    'Legacy',
                    () => writes.push(control.read()),
                    mode === 'forced'
                );
                window.document.body.append(control.node);
                const select = colorSelect(window);
                assert.equal(control.editable, false);
                assert.equal(select.disabled, true);
                select.value = 'Blue';
                change(window, select);
                assert.equal(control.read(), 'Legacy');
                assert.equal(select.value, 'Legacy');
                assert.deepEqual(writes, []);
                control.destroy();
                control.node.remove();
            }
            let changes = 0;
            const control = formFieldControl(
                selectSchema(false),
                'Red',
                () => changes++
            );
            window.document.body.append(control.node);
            const select = colorSelect(window);
            control.destroy();
            control.destroy();
            control.write('Blue');
            assert.equal(select.value, 'Red');
            select.value = 'Blue';
            change(window, select);
            assert.equal(changes, 0);
        });

        it('preserves the generic Portal value on unchanged read/save, edits, clear, and disposal', async (test) => {
            const window = await environment(test);
            const { fieldControl } = await example('fields');
            const schema = selectSchema();
            let changes = 0;
            const control = fieldControl(
                schema.airtableField,
                schema.miniExtConfig,
                ['Legacy', 'Red'],
                () => changes++
            );
            window.document.body.append(control.node);
            const select = colorSelect(window);
            assert.deepEqual(control.read(), ['Legacy', 'Red']);
            chooseBlue(window, select);
            assert.deepEqual(control.read(), ['Legacy', 'Red', 'Blue']);
            control.write(['Legacy']);
            assert.equal(changes, 1);
            assert.deepEqual(control.read(), ['Legacy']);
            control.destroy();
            select.value = 'Blue';
            change(window, select);
            assert.equal(changes, 1);
            control.node.remove();
            const single = selectSchema(false);
            const cleared = fieldControl(
                single.airtableField,
                single.miniExtConfig,
                'Legacy',
                () => changes++
            );
            test.after(() => cleared.destroy());
            window.document.body.append(cleared.node);
            const singleSelect = colorSelect(window);
            assert.equal(cleared.read(), 'Legacy');
            singleSelect.value = '';
            change(window, singleSelect);
            assert.equal(cleared.read(), null);
            assert.equal(
                Array.from(singleSelect.options).some(
                    (option) => option.value === 'Legacy'
                ),
                false
            );
        });

        it('sends an unchanged Portal grid value intact and closes/reconstructs the editor', async (test) => {
            const window = await environment(test);
            const { createPortalView } = await example('portal');
            const schema = selectSchema();
            const page = portalPage();
            page.payload.linkedRecordFieldIdToDetailFields.fld_children = [
                {
                    fieldId: 'fld_colors',
                    fieldName: 'Colors',
                    titleOverride: null,
                    isHidden: false,
                    fieldIsInEditingChildForm: true,
                    childFormField: null,
                    miniExtConfig: {},
                },
            ];
            const record = {
                id: 'record_child',
                fields: { fld_colors: ['Legacy', 'Red'] },
            };
            const updates: UpdateGridCellInput[] = [];
            const client = createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async () => {
                    throw new Error('Unexpected fixture network request.');
                },
            });
            client.portals.listLinkedRecords = async () =>
                portalListPage({
                    recordIds: [record.id],
                    tableIdsToLinkedTableStates: {
                        table_children: {
                            airtableFields: [schema.airtableField],
                            recordIdsToAirtableRecords: {
                                [record.id]: structuredClone(record),
                            },
                        },
                    },
                });
            client.portals.updateGridCell = async (input) => {
                updates.push(structuredClone(input));
                return {
                    record: {
                        id: record.id,
                        fields: { fld_colors: input.value },
                    },
                    auditTrail: null,
                    auditTrails: [],
                };
            };
            client.portals.getUserRecord = async () => null;
            let pending = Promise.resolve();
            const view = createPortalView({
                page,
                client,
                getScope: () => ({ ownerId: 'visitor_A', revision: 0 }),
                run: (
                    _description: string,
                    action: (context: {
                        client: typeof client;
                        signal: AbortSignal;
                        current(): boolean;
                    }) => Promise<void>
                ) => {
                    pending = action({
                        client,
                        signal: new AbortController().signal,
                        current: () => true,
                    });
                    return pending;
                },
                status: () => {},
                confirm: async () => false,
                openChild: () => {
                    throw new Error('Unexpected child Form.');
                },
            });
            test.after(() => view.closeEditor());
            window.document.body.append(view.node);
            button(window, 'Load records').click();
            await pending;
            button(window, 'Edit cell').click();
            const oldSelect = colorSelect(window);
            const form = oldSelect.closest('form');
            assert.ok(form);
            submit(window, form);
            await pending;
            assert.equal(updates.length, 1);
            assert.ok(Array.isArray(updates[0].value));
            assert.deepEqual(updates[0].value, ['Legacy', 'Red']);
            assert.equal(
                window.document.querySelector(
                    'select[data-field-id="fld_colors"]'
                ),
                null
            );
            button(window, 'Edit cell').click();
            assert.deepEqual(
                new Set(selected(colorSelect(window))),
                new Set(['Legacy', 'Red'])
            );
            view.closeEditor();
            view.closeEditor();
            assert.equal(
                window.document.querySelector(
                    'select[data-field-id="fld_colors"]'
                ),
                null
            );
            chooseBlue(window, oldSelect);
            assert.equal(updates.length, 1);
            button(window, 'Edit cell').click();
            chooseBlue(window, colorSelect(window));
            const edited = colorSelect(window).closest('form');
            assert.ok(edited);
            submit(window, edited);
            await pending;
            assert.ok(Array.isArray(updates[1].value));
            assert.deepEqual(updates[1].value, ['Legacy', 'Red', 'Blue']);
        });

        it('keeps actual Form drafts across visitor rerenders, disposes stale controls, and selects confirmed new choices', async (test) => {
            const saves: SaveFormInput[] = [];
            let choiceCalls = 0;
            const form = selectForm();
            const fetch: typeof globalThis.fetch = async (input, init) => {
                const url = new URL(String(input));
                if (
                    url.searchParams.get('route') === 'fetchExtensionForEndUser'
                )
                    return new Response(JSON.stringify(form));
                if (url.searchParams.get('route') === 'saveForm') {
                    saves.push(JSON.parse(String(init?.body)));
                    return new Response(
                        JSON.stringify({
                            type: 'error',
                            formValidationErrors: [],
                            formErrors: {},
                        })
                    );
                }
                if (
                    url.pathname ===
                    '/api/trpc/airtable.addNewAirtableOptionForFormField'
                ) {
                    choiceCalls++;
                    return new Response(
                        JSON.stringify({
                            result: {
                                data: {
                                    newChoice: {
                                        id: 'sel_green',
                                        name: 'Green',
                                        color: 'greenLight2',
                                    },
                                },
                            },
                        })
                    );
                }
                throw new Error(
                    `Unexpected fixture route: ${url.pathname}${url.search}`
                );
            };
            const window = await environment(test, fetch);
            await example('main');
            const origin = window.document.getElementById('api-origin');
            const share = window.document.getElementById('share-id');
            assert.ok(origin instanceof window.HTMLInputElement);
            assert.ok(share instanceof window.HTMLInputElement);
            origin.value = 'https://sdk.example.test';
            share.value = 'share_example';
            const connection =
                window.document.getElementById('connection-form');
            assert.ok(connection);
            submit(window, connection);
            await waitFor(
                () =>
                    window.document.querySelector(
                        'select[data-field-id="fld_colors"]'
                    ) !== null
            );
            const first = colorSelect(window);
            const card = first.closest('form');
            assert.ok(card);
            submit(window, card);
            await waitFor(
                () =>
                    saves.length === 1 &&
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            assert.deepEqual(saves[0].formRecord.data.fld_colors, [
                'Legacy',
                'Red',
            ]);
            assert.equal(
                saves[0].formFieldIdsWithUnsavedChanges.includes('fld_colors'),
                false
            );
            chooseBlue(window, first);
            const visitor = window.document.getElementById('visitor');
            assert.ok(visitor instanceof window.HTMLSelectElement);
            visitor.value = 'B';
            change(window, visitor);
            first.value = 'Red';
            change(window, first);
            visitor.value = 'A';
            change(window, visitor);
            const restored = colorSelect(window);
            assert.notEqual(restored, first);
            assert.deepEqual(
                new Set(selected(restored)),
                new Set(['Legacy', 'Red', 'Blue'])
            );
            const choice = window.document.querySelector(
                'input[placeholder="New choice name"]'
            );
            assert.ok(choice instanceof window.HTMLInputElement);
            choice.value = 'Green';
            button(window, 'Create choice').click();
            await waitFor(
                () =>
                    choiceCalls === 1 &&
                    Array.from(colorSelect(window).options).some(
                        (option) => option.value === 'Green' && option.selected
                    )
            );
            const savedCard = colorSelect(window).closest('form');
            assert.ok(savedCard);
            submit(window, savedCard);
            await waitFor(
                () =>
                    saves.length === 2 &&
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            assert.deepEqual(saves[1].formRecord.data.fld_colors, [
                'Legacy',
                'Red',
                'Blue',
                'Green',
            ]);
            assert.equal(
                saves[1].formFieldIdsWithUnsavedChanges.filter(
                    (id) => id === 'fld_colors'
                ).length,
                1
            );
            button(window, "Clear this visitor's session").click();
            restored.value = 'Red';
            change(window, restored);
            button(window, 'Reload').click();
            await waitFor(
                () =>
                    window.document.querySelector(
                        'select[data-field-id="fld_colors"]'
                    ) !== null
            );
            assert.deepEqual(
                new Set(selected(colorSelect(window))),
                new Set(['Legacy', 'Red'])
            );
            assert.equal(choiceCalls, 1);
            assert.equal(saves.length, 2);
        });

        it('retains the cached Portal inline draft across visitor switches and clears it on explicit reset', async (test) => {
            const schema = selectSchema();
            const page = portalPage();
            page.payload.linkedRecordFieldIdToDetailFields.fld_children = [
                {
                    fieldId: 'fld_colors',
                    fieldName: 'Colors',
                    titleOverride: null,
                    isHidden: false,
                    fieldIsInEditingChildForm: true,
                    childFormField: null,
                    miniExtConfig: {},
                },
            ];
            const list = portalListPage({
                recordIds: ['record_child'],
                tableIdsToLinkedTableStates: {
                    table_children: {
                        airtableFields: [schema.airtableField],
                        recordIdsToAirtableRecords: {
                            record_child: {
                                id: 'record_child',
                                fields: { fld_colors: ['Legacy', 'Red'] },
                            },
                        },
                    },
                },
            });
            let writes = 0;
            const fetch: typeof globalThis.fetch = async (input) => {
                const url = new URL(String(input));
                if (
                    url.searchParams.get('route') === 'fetchExtensionForEndUser'
                )
                    return new Response(JSON.stringify(page));
                if (
                    url.searchParams.get('route') ===
                    'fetchRecordsForLinkedTableOnPortal'
                )
                    return new Response(JSON.stringify(list));
                writes++;
                throw new Error(
                    `Unexpected fixture route: ${url.pathname}${url.search}`
                );
            };
            const window = await environment(test, fetch);
            await example('main');
            const origin = window.document.getElementById('api-origin');
            const share = window.document.getElementById('share-id');
            const connection =
                window.document.getElementById('connection-form');
            assert.ok(origin instanceof window.HTMLInputElement);
            assert.ok(share instanceof window.HTMLInputElement);
            assert.ok(connection);
            origin.value = 'https://sdk.example.test';
            share.value = 'share_example';
            submit(window, connection);
            await waitFor(() =>
                Array.from(window.document.querySelectorAll('button')).some(
                    (node) => node.textContent === 'Load records'
                )
            );
            button(window, 'Load records').click();
            await waitFor(() =>
                Array.from(window.document.querySelectorAll('button')).some(
                    (node) => node.textContent === 'Edit cell'
                )
            );
            button(window, 'Edit cell').click();
            const original = colorSelect(window);
            const originalEditor = original.closest('form');
            assert.ok(originalEditor);
            chooseBlue(window, original);
            const visitor = window.document.getElementById('visitor');
            assert.ok(visitor instanceof window.HTMLSelectElement);
            visitor.value = 'B';
            change(window, visitor);
            submit(window, originalEditor);
            assert.equal(
                window.document.querySelector(
                    'select[data-field-id="fld_colors"]'
                ),
                null
            );
            visitor.value = 'A';
            change(window, visitor);
            assert.equal(colorSelect(window), original);
            assert.deepEqual(
                new Set(selected(original)),
                new Set(['Legacy', 'Red', 'Blue'])
            );
            submit(window, originalEditor);
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.equal(writes, 0);
            button(window, "Clear this visitor's session").click();
            assert.equal(
                window.document.querySelector(
                    'select[data-field-id="fld_colors"]'
                ),
                null
            );
            chooseBlue(window, original);
            submit(window, originalEditor);
            button(window, 'Reload').click();
            await waitFor(() =>
                Array.from(window.document.querySelectorAll('button')).some(
                    (node) => node.textContent === 'Load records'
                )
            );
            button(window, 'Load records').click();
            await waitFor(() =>
                Array.from(window.document.querySelectorAll('button')).some(
                    (node) => node.textContent === 'Edit cell'
                )
            );
            button(window, 'Edit cell').click();
            assert.notEqual(colorSelect(window), original);
            assert.deepEqual(
                new Set(selected(colorSelect(window))),
                new Set(['Legacy', 'Red'])
            );
            assert.equal(writes, 0);
        });
    }
);

describe('Portal inline static select policy', { concurrency: false }, () => {
    it('uses configured IDs and display labels without truncating native baselines', async (test) => {
        const window = await environment(test);
        const { fieldControl } = await example('fields');
        const schema = selectSchema();
        schema.miniExtConfig = {
            singleOrMultiSelectLimitSelectionOptions: ['sel_blue'],
            maxNumberOfSelections: 2,
            enableConditionalOptions: true,
            conditionsForOptions: [
                {
                    id: 'blue_label',
                    config: {
                        optionForConditions: 'sel_blue',
                        name: ' Azure ',
                        conditionsForOption: {
                            logicalOperator: 'and',
                            conditions: [],
                        },
                    },
                },
            ],
        };
        const baseline = ['Legacy', 'Red', 'Older'];
        const changes: AirtableValue[] = [];
        const control = fieldControl(
            schema.airtableField,
            schema.miniExtConfig,
            baseline,
            () => changes.push(control.read())
        );
        test.after(() => control.destroy());
        window.document.body.append(control.node);
        const select = colorSelect(window);
        assert.deepEqual(control.read(), baseline);
        const blue = Array.from(select.options).find(
            (option) => option.value === 'Blue'
        );
        assert.ok(blue);
        assert.equal(blue.textContent, 'Azure');
        assert.equal(blue.disabled, true);
        blue.disabled = false;
        blue.selected = true;
        change(window, select);
        assert.deepEqual(control.read(), baseline);
        assert.deepEqual(changes, []);
        for (const option of select.options)
            option.selected = option.value === 'Red';
        change(window, select);
        assert.deepEqual(control.read(), ['Red']);
        const injected = window.document.createElement('option');
        injected.value = 'Legacy';
        injected.textContent = 'Injected legacy';
        injected.selected = true;
        select.append(injected);
        blue.selected = true;
        change(window, select);
        assert.deepEqual(control.read(), ['Red', 'Blue']);
        assert.equal(
            Array.from(select.options).some(
                (option) => option.value === 'Legacy'
            ),
            false
        );
        assert.deepEqual(changes, [['Red'], ['Red', 'Blue']]);
    });

    it('keeps single-select names canonical and denies name-shaped allowlist IDs', async (test) => {
        const window = await environment(test);
        const { fieldControl } = await example('fields');
        const schema = selectSchema(false);
        schema.miniExtConfig = {
            singleOrMultiSelectLimitSelectionOptions: ['Blue'],
        };
        const control = fieldControl(
            schema.airtableField,
            schema.miniExtConfig,
            'Legacy',
            () => {}
        );
        test.after(() => control.destroy());
        window.document.body.append(control.node);
        const select = colorSelect(window);
        assert.equal(control.read(), 'Legacy');
        select.value = '';
        change(window, select);
        assert.equal(control.read(), null);
        const injected = window.document.createElement('option');
        injected.value = 'Blue';
        select.append(injected);
        select.value = 'Blue';
        change(window, select);
        assert.equal(control.read(), null);
    });

    it('allows removal from a zero maximum and fails closed on malformed policy', async (test) => {
        const window = await environment(test);
        const { fieldControl } = await example('fields');
        const schema = selectSchema();
        schema.miniExtConfig = { maxNumberOfSelections: 0 };
        const control = fieldControl(
            schema.airtableField,
            schema.miniExtConfig,
            ['Red'],
            () => {}
        );
        test.after(() => control.destroy());
        window.document.body.append(control.node);
        const select = colorSelect(window);
        chooseBlue(window, select);
        assert.deepEqual(control.read(), ['Red']);
        for (const option of select.options) option.selected = false;
        change(window, select);
        assert.deepEqual(control.read(), []);
        chooseBlue(window, select);
        assert.deepEqual(control.read(), []);
        assert.throws(
            () =>
                fieldControl(
                    schema.airtableField,
                    { maxNumberOfSelections: Number.NaN },
                    [],
                    () => {}
                ),
            /nonnegative number/
        );
    });

    it('keeps generic read-only, computed and forced controls immutable and disposable', async (test) => {
        const window = await environment(test);
        const { fieldControl } = await example('fields');
        let changes = 0;
        for (const mode of ['readOnly', 'computed', 'forced']) {
            const schema = selectSchema(false);
            if (mode === 'readOnly') schema.miniExtConfig = { readOnly: true };
            if (mode === 'computed') schema.airtableField.isComputed = true;
            const control = fieldControl(
                schema.airtableField,
                schema.miniExtConfig,
                'Legacy',
                () => changes++,
                mode === 'forced'
            );
            window.document.body.append(control.node);
            const select = colorSelect(window);
            assert.equal(control.editable, false);
            assert.equal(select.disabled, true);
            select.value = 'Blue';
            change(window, select);
            assert.equal(control.read(), 'Legacy');
            assert.equal(select.value, 'Legacy');
            control.destroy();
            control.destroy();
            select.value = 'Blue';
            change(window, select);
            assert.equal(changes, 0);
            control.node.remove();
        }
    });

    it('uses the child config and writes exact native values through the actual Portal editor', async (test) => {
        const schema = selectSchema();
        schema.miniExtConfig = {
            readOnly: true,
            singleOrMultiSelectLimitSelectionOptions: ['sel_red'],
        };
        const fixture = await selectPortal(test, schema, ['Legacy', 'Red'], {
            singleOrMultiSelectLimitSelectionOptions: ['sel_blue'],
            enableConditionalOptions: true,
            conditionsForOptions: [],
            conditionalFields: { logicalOperator: 'and', conditions: [] },
        });
        await fixture.load();
        const select = fixture.open();
        assert.deepEqual(new Set(selected(select)), new Set(['Legacy', 'Red']));
        assert.equal(
            Array.from(select.options).find((option) => option.value === 'Blue')
                ?.textContent,
            'Blue'
        );
        assert.equal(
            fixture.window.document.querySelector(
                'input[placeholder="New choice name"]'
            ),
            null
        );
        assert.equal(
            Array.from(fixture.window.document.querySelectorAll('button')).some(
                (node) => node.textContent === 'Create choice'
            ),
            false
        );
        for (const option of select.options)
            option.selected = option.value === 'Blue';
        change(fixture.window, select);
        const denied = fixture.window.document.createElement('option');
        denied.value = 'Red';
        denied.selected = true;
        select.append(denied);
        change(fixture.window, select);
        await fixture.save(select);
        assert.deepEqual(fixture.updates, [
            {
                portalExtensionAccessToken: 'portal_access_example',
                portalFieldId: 'fld_children',
                recordFieldId: 'fld_colors',
                recordId: 'record_child',
                value: ['Blue'],
                selectedCustomViewId: 'view_example',
            },
        ]);
        assert.deepEqual(fixture.errors, []);
    });

    it('preserves over-limit order on unchanged saves and removes before adding', async (test) => {
        const schema = selectSchema();
        schema.miniExtConfig = { maxNumberOfSelections: 2 };
        const baseline = ['Legacy', 'Red', 'Older'];
        const fixture = await selectPortal(test, schema, baseline);
        await fixture.load();
        await fixture.save(fixture.open());
        assert.deepEqual(fixture.updates[0].value, baseline);
        const select = fixture.open();
        chooseBlue(fixture.window, select);
        for (const option of select.options)
            option.selected = option.value === 'Red';
        change(fixture.window, select);
        chooseBlue(fixture.window, select);
        await fixture.save(select);
        assert.deepEqual(fixture.updates[1].value, ['Red', 'Blue']);
        assert.deepEqual(fixture.errors, []);
    });

    it('retains an A-to-B-to-A draft but prevents its expired owner from dispatching', async (test) => {
        const fixture = await selectPortal(test);
        await fixture.load();
        const select = fixture.open();
        chooseBlue(fixture.window, select);
        fixture.scope.ownerId = 'visitor_B';
        fixture.scope.revision++;
        fixture.view.retireCollection();
        fixture.view.node.remove();
        await fixture.save(select);
        fixture.scope.ownerId = 'visitor_A';
        fixture.scope.revision++;
        fixture.window.document.body.append(fixture.view.node);
        assert.deepEqual(
            new Set(selected(select)),
            new Set(['Legacy', 'Red', 'Blue'])
        );
        await fixture.save(select);
        assert.equal(fixture.updates.length, 0);
        await fixture.load();
        const fresh = fixture.open();
        assert.notEqual(fresh, select);
        await fixture.save(fresh);
        assert.deepEqual(fixture.updates[0].value, ['Legacy', 'Red']);
    });

    it('prevents disposed, replaced and view-reset editor forms from dispatching clears', async (test) => {
        const fixture = await selectPortal(test);
        await fixture.load();
        const canceled = fixture.open();
        const canceledForm = canceled.closest('form');
        assert.ok(canceledForm);
        fixture.view.closeEditor();
        submit(fixture.window, canceledForm);
        const replaced = fixture.open();
        const replacedForm = replaced.closest('form');
        assert.ok(replacedForm);
        fixture.open();
        submit(fixture.window, replacedForm);
        const reset = colorSelect(fixture.window);
        const resetForm = reset.closest('form');
        assert.ok(resetForm);
        const viewSelect = fixture.view.node.querySelectorAll('select')[1];
        assert.ok(viewSelect);
        viewSelect.value = 'view_other';
        change(fixture.window, viewSelect);
        submit(fixture.window, resetForm);
        await fixture.load();
        const disposed = fixture.open();
        const disposedForm = disposed.closest('form');
        assert.ok(disposedForm);
        fixture.view.destroy();
        chooseBlue(fixture.window, disposed);
        submit(fixture.window, disposedForm);
        await fixture.pending();
        assert.equal(fixture.updates.length, 0);
        assert.deepEqual(fixture.errors, []);
    });

    for (const mode of ['readOnly', 'computed']) {
        it(`does not offer or dispatch a ${mode} Portal cell edit`, async (test) => {
            const schema = selectSchema();
            if (mode === 'readOnly') schema.miniExtConfig = { readOnly: true };
            else schema.airtableField.isComputed = true;
            const fixture = await selectPortal(test, schema);
            await fixture.load();
            assert.equal(
                Array.from(
                    fixture.window.document.querySelectorAll('button')
                ).some((node) => node.textContent === 'Edit cell'),
                false
            );
            assert.equal(
                fixture.view.node.querySelector(
                    'select[data-field-id="fld_colors"]'
                ),
                null
            );
            assert.equal(fixture.updates.length, 0);
        });
    }

    for (const enabled of [true, false]) {
        it(`denies child option conditions with enableConditionalOptions=${enabled}`, async (test) => {
            const schema = selectSchema();
            schema.miniExtConfig = {
                singleOrMultiSelectLimitSelectionOptions: ['sel_blue'],
            };
            const fixture = await selectPortal(test, schema, ['Red'], {
                enableConditionalOptions: enabled,
                conditionsForOptions: [
                    {
                        id: 'blue_label',
                        config: {
                            optionForConditions: 'sel_blue',
                            name: 'Azure',
                            conditionsForOption: {
                                logicalOperator: 'and',
                                conditions: [],
                            },
                        },
                    },
                ],
            });
            await fixture.load();
            assert.equal(
                Array.from(
                    fixture.window.document.querySelectorAll('button')
                ).some((node) => node.textContent === 'Edit cell'),
                false
            );
            assert.equal(fixture.updates.length, 0);
        });
    }

    it('denies nonempty conditional fields instead of evaluating them inline', async (test) => {
        const schema = selectSchema();
        schema.miniExtConfig = {
            conditionalFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'nested_empty_group',
                        type: 'groupCondition',
                        logicalOperator: 'and',
                        conditions: [],
                    },
                ],
            },
        };
        const fixture = await selectPortal(test, schema);
        await fixture.load();
        assert.equal(
            Array.from(fixture.window.document.querySelectorAll('button')).some(
                (node) => node.textContent === 'Edit cell'
            ),
            false
        );
        assert.equal(fixture.updates.length, 0);
    });
});

describe(
    'Portal select and readable-prefill interaction',
    { concurrency: false },
    () => {
        const mount = async (test: TestContext, initiallyFormatted = false) => {
            const schema = selectSchema();
            schema.miniExtConfig = {
                singleOrMultiSelectLimitSelectionOptions: ['sel_blue'],
                maxNumberOfSelections: 2,
            };
            let nativeColors: AirtableValue = ['Legacy', 'Red'];
            let parentQuery: AirtableValue = ['**prefill_Title**=Red'];
            let formatted = initiallyFormatted;
            let parentLoads = 0;
            let parentRefreshes = 0;
            let reads = 0;
            const gridWrites: UpdateGridCellInput[] = [];
            const childLoads: LoadExtensionInput[] = [];
            const saves: SaveFormInput[] = [];
            const unexpected: string[] = [];
            const freshPortal = () => {
                const page = portalPage({ disableInlineEdit: false });
                page.payload.formRecord.data.fld_prefill =
                    structuredClone(parentQuery);
                page.payload.fieldIdsToSchemas.fld_prefill = {
                    fieldType: AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
                    airtableField: {
                        id: 'fld_prefill',
                        name: 'Current parent lookup',
                        description: null,
                        isPrimaryField: false,
                        isComputed: true,
                        config: {
                            type: AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
                            options: {
                                isValid: true,
                                recordLinkFieldId: 'fld_children',
                                fieldIdInLinkedTable: 'fld_query',
                                result: formatted
                                    ? {
                                          type: AirtableFieldType.RICH_TEXT,
                                          options: null,
                                      }
                                    : {
                                          type: AirtableFieldType.SINGLE_LINE_TEXT,
                                          options: null,
                                      },
                            },
                        },
                    },
                };
                page.payload.linkedRecordFieldIdToDetailFields.fld_children = [
                    {
                        fieldId: 'fld_colors',
                        fieldName: 'Colors',
                        titleOverride: null,
                        isHidden: false,
                        fieldIsInEditingChildForm: true,
                        childFormField: null,
                        miniExtConfig: schema.miniExtConfig,
                    },
                ];
                return page;
            };
            const fetch: typeof globalThis.fetch = async (input, init) => {
                const url = new URL(String(input));
                const route = url.searchParams.get('route') ?? url.pathname;
                const body = JSON.parse(String(init?.body ?? '{}'));
                if (route === 'fetchExtensionForEndUser') {
                    if (body.childExtensionInfo) {
                        childLoads.push(structuredClone(body));
                        const child = loadedForm();
                        child.extensionId = 'extension_child';
                        child.payload.hasParentExtension = true;
                        child.payload.fieldIdsInForm = ['fld_title'];
                        child.payload.formRecord = {
                            type: 'create',
                            data: { fld_title: 'Returned child title' },
                        };
                        child.payload.formFieldIdsWithUnsavedChanges = [];
                        child.payload.urlPrefilledFieldIds = [];
                        return new Response(JSON.stringify(child));
                    }
                    parentLoads++;
                    return new Response(JSON.stringify(freshPortal()));
                }
                if (route === 'fetchRecordsForLinkedTableOnPortal') {
                    reads++;
                    return new Response(
                        JSON.stringify(
                            portalListPage({
                                recordIds: ['record_child'],
                                tableIdsToLinkedTableStates: {
                                    table_children: {
                                        airtableFields: [schema.airtableField],
                                        recordIdsToAirtableRecords: {
                                            record_child: {
                                                id: 'record_child',
                                                fields: {
                                                    fld_colors: nativeColors,
                                                },
                                            },
                                        },
                                    },
                                },
                            })
                        )
                    );
                }
                if (route === '/api/trpc/airtable.updatePortalRecord') {
                    gridWrites.push(structuredClone(body));
                    nativeColors = structuredClone(body.value);
                    // Synthetic returned state changes; the SDK does not evaluate
                    // a lookup expression or infer fresh metadata from its value.
                    parentQuery = ['**prefill_Title**=Blue'];
                    formatted = true;
                    return new Response(
                        JSON.stringify({
                            result: {
                                data: {
                                    record: {
                                        id: 'record_child',
                                        fields: { fld_colors: nativeColors },
                                    },
                                    auditTrail: null,
                                    auditTrails: [],
                                },
                            },
                        })
                    );
                }
                if (route === '/api/trpc/airtable.getUserRecord') {
                    parentRefreshes++;
                    return new Response(
                        JSON.stringify({
                            result: {
                                data: {
                                    id: 'record_parent',
                                    fields: { fld_prefill: parentQuery },
                                },
                            },
                        })
                    );
                }
                if (route === 'saveForm') {
                    saves.push(structuredClone(body));
                    return new Response(
                        JSON.stringify({
                            type: 'error',
                            formValidationErrors: [],
                            formErrors: {},
                        })
                    );
                }
                unexpected.push(route);
                throw new Error('Unexpected composition fixture route.');
            };
            const window = await environment(test, fetch);
            await example('main');
            const origin = window.document.getElementById('api-origin');
            const share = window.document.getElementById('share-id');
            const connection =
                window.document.getElementById('connection-form');
            assert.ok(origin instanceof window.HTMLInputElement);
            assert.ok(share instanceof window.HTMLInputElement);
            assert.ok(connection);
            origin.value = 'https://sdk.example.test';
            share.value = 'share_example';
            const idle = () =>
                window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false';
            submit(window, connection);
            await waitFor(() => parentLoads === 1 && idle());
            const load = async () => {
                const before = reads;
                button(window, 'Load records').click();
                await waitFor(() => reads === before + 1 && idle());
            };
            const reload = async () => {
                const before = parentLoads;
                button(window, 'Reload').click();
                await waitFor(() => parentLoads === before + 1 && idle());
            };
            const create = async () => {
                const before = childLoads.length;
                button(window, 'Create record').click();
                await waitFor(() => childLoads.length === before + 1 && idle());
            };
            return {
                window,
                gridWrites,
                childLoads,
                saves,
                unexpected,
                idle,
                load,
                reload,
                create,
                parentRefreshes: () => parentRefreshes,
            };
        };
        const prefill = (value: string) => ({
            toLinkToParent: {
                reversedFieldIdToPrefill: 'fld_parent',
                parentFormRecordId: 'record_parent',
            },
            prefillQueryForChildExtension: value,
        });

        it('saves native allowed names then explicitly reloads current lookup metadata for identical child load/save prefills', async (test) => {
            const h = await mount(test);
            await h.load();
            assert.equal(h.gridWrites.length, 0);
            assert.equal(h.childLoads.length, 0);
            assert.equal(h.saves.length, 0);
            button(h.window, 'Edit cell').click();
            const select = colorSelect(h.window);
            for (const option of select.options)
                option.selected = option.value === 'Blue';
            change(h.window, select);
            // Exercise policy at the real Save sink, including native-option
            // injection after the unavailable persisted values were removed.
            for (const value of ['Red', 'sel_blue']) {
                const injected = h.window.document.createElement('option');
                injected.value = value;
                injected.selected = true;
                select.append(injected);
                change(h.window, select);
            }
            const editor = select.closest('form');
            assert.ok(editor);
            submit(h.window, editor);
            await waitFor(() => h.gridWrites.length === 1 && h.idle());
            assert.deepEqual(h.gridWrites[0], {
                portalExtensionAccessToken: 'portal_access_example',
                portalFieldId: 'fld_children',
                recordFieldId: 'fld_colors',
                recordId: 'record_child',
                value: ['Blue'],
                selectedCustomViewId: 'view_example',
            });
            assert.equal(h.childLoads.length, 0);
            assert.equal(h.saves.length, 0);
            assert.equal(h.parentRefreshes(), 1);
            assert.equal(button(h.window, 'Create record').disabled, true);
            await h.reload();
            assert.equal(
                h.gridWrites.length,
                1,
                'Reload must not replay the select write.'
            );
            assert.equal(h.childLoads.length, 0);
            await h.load();
            assert.equal(h.gridWrites.length, 1);
            await h.create();
            const expected = prefill('prefill_Title=Blue');
            const childLoad = h.childLoads[0];
            assert.ok(childLoad);
            assert.ok('childExtensionAccessData' in childLoad);
            assert.deepEqual(childLoad.context, {
                type: 'modal',
                linkedTableIdOfLinkedRecordField: 'table_children',
                prefillDataForLinkedRecordsForm: expected,
            });
            assert.deepEqual(childLoad.childExtensionAccessData, {
                parentExtensionAccessToken: 'portal_access_example',
                fieldIdUsedToAccessExtension: 'fld_children',
            });
            assert.equal(
                h.saves.length,
                0,
                'Opening a child must not automatically save it.'
            );
            const title = h.window.document.querySelector(
                'input[data-field-id="fld_title"]'
            );
            assert.ok(title instanceof h.window.HTMLInputElement);
            title.value = 'Explicit composed request';
            title.dispatchEvent(new h.window.Event('input', { bubbles: true }));
            const form = title.closest('form');
            assert.ok(form);
            submit(h.window, form);
            await waitFor(() => h.saves.length === 1 && h.idle());
            assert.deepEqual(h.saves[0].context, {
                type: 'modal',
                prefillData: expected,
            });
            assert.equal(
                h.saves[0].formRecord.data.fld_title,
                'Explicit composed request'
            );
            assert.deepEqual(h.unexpected, []);
        });

        it('denies an A-to-B-to-A select draft without writes and preserves current child prefill after explicit reload', async (test) => {
            const h = await mount(test, true);
            await h.load();
            button(h.window, 'Edit cell').click();
            const select = colorSelect(h.window);
            for (const option of select.options)
                option.selected = option.value === 'Blue';
            change(h.window, select);
            const editor = select.closest('form');
            assert.ok(editor);
            const visitor = h.window.document.getElementById('visitor');
            assert.ok(visitor instanceof h.window.HTMLSelectElement);
            visitor.value = 'B';
            change(h.window, visitor);
            submit(h.window, editor);
            visitor.value = 'A';
            change(h.window, visitor);
            assert.equal(colorSelect(h.window), select);
            assert.deepEqual(selected(select), ['Blue']);
            submit(h.window, editor);
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.equal(h.gridWrites.length, 0);
            assert.equal(h.childLoads.length, 0);
            assert.equal(h.saves.length, 0);
            await h.reload();
            await h.load();
            assert.equal(h.gridWrites.length, 0);
            await h.create();
            const childLoad = h.childLoads[0];
            assert.ok(childLoad);
            assert.ok('childExtensionAccessData' in childLoad);
            assert.deepEqual(childLoad.context, {
                type: 'modal',
                linkedTableIdOfLinkedRecordField: 'table_children',
                prefillDataForLinkedRecordsForm: prefill('prefill_Title=Red'),
            });
            assert.deepEqual(childLoad.childExtensionAccessData, {
                parentExtensionAccessToken: 'portal_access_example',
                fieldIdUsedToAccessExtension: 'fld_children',
            });
            assert.equal(h.gridWrites.length, 0);
            assert.equal(h.saves.length, 0);
            assert.deepEqual(h.unexpected, []);
        });
    }
);
