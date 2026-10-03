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

describe(
    'actual browser example select controls',
    { concurrency: false },
    () => {
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
            chooseBlue(window, original);
            const visitor = window.document.getElementById('visitor');
            assert.ok(visitor instanceof window.HTMLSelectElement);
            visitor.value = 'B';
            change(window, visitor);
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
            button(window, "Clear this visitor's session").click();
            assert.equal(
                window.document.querySelector(
                    'select[data-field-id="fld_colors"]'
                ),
                null
            );
            chooseBlue(window, original);
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
