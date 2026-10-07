import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import {
    AirtableFieldType,
    type ListPortalLinkedRecordsResult,
    type MiniExtensionsClient,
    type PortalLoadedResult,
    type RuntimeAirtableField,
    type UpdateGridCellInput,
} from '../src/runtime/index.js';
import {
    createPortalCollection,
    PortalCollectionError,
    type PortalCollectionCriteria,
} from '../src/portals/index.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

const criteria: PortalCollectionCriteria = {
    selectedCustomViewId: 'view_example',
    searchTerm: null,
    sortFieldsByEndUser: null,
    filtersByEndUser: null,
    searchParamsMap: {},
};
const readOptions = { pagesToFetch: 1, refreshLoggedInPortalRecord: true };
const titleField: RuntimeAirtableField = {
    id: 'fld_title',
    name: 'Title',
    description: null,
    isComputed: false,
    isPrimaryField: true,
    config: { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
};
const descriptionField: RuntimeAirtableField = {
    ...titleField,
    id: 'fld_description',
    name: 'Description',
    isPrimaryField: false,
};
const listedPage = (
    ids = ['record_child'],
    offset: string | null = null
): ListPortalLinkedRecordsResult =>
    portalListPage({
        recordIds: ids,
        airtableOffset: offset,
        tableIdsToLinkedTableStates: {
            table_children: {
                airtableFields: [
                    structuredClone(titleField),
                    structuredClone(descriptionField),
                ],
                recordIdsToAirtableRecords: Object.fromEntries(
                    ids.map((id) => [
                        id,
                        {
                            id,
                            fields: {
                                fld_title: 'Original title',
                                fld_description: 'Unchanged description',
                            },
                        },
                    ])
                ),
            },
        },
    });
const editablePage = (): PortalLoadedResult => {
    const page = portalPage();
    page.payload.linkedRecordFieldIdToDetailFields.fld_children = [
        {
            fieldId: 'fld_title',
            fieldName: 'Title',
            titleOverride: null,
            isHidden: false,
            fieldIsInEditingChildForm: true,
            childFormField: null,
            miniExtConfig: {},
        },
        {
            fieldId: 'fld_description',
            fieldName: 'Description',
            titleOverride: null,
            isHidden: false,
            fieldIsInEditingChildForm: true,
            childFormField: null,
            miniExtConfig: { readOnly: true },
        },
    ];
    return page;
};

describe('deep review Portal collection contract controls', () => {
    it('preserves offset 0, traverses empty pages, and stops only at null', async () => {
        const replies = [
            listedPage([], '0'),
            listedPage([], 'next'),
            listedPage(),
        ];
        const fixture = portalFixture(async () => replies.shift()!);
        const collection = createPortalCollection({
            client: fixture.client,
            portal: portalPage(),
            portalFieldId: 'fld_children',
            criteria,
            getScope: () => ({ ownerId: 'visitor_A', revision: 0 }),
        });
        await collection.readFirst(readOptions);
        await collection.readNext(readOptions);
        await collection.readNext(readOptions);
        assert.deepEqual(
            fixture.calls.map((call) => call.input.airtableOffset),
            [null, '0', 'next']
        );
        const child = collection.childFormRequest({
            access: { type: 'edit', recordId: 'record_child' },
            configuredChildExtensionId: 'extension_child',
        });
        assert.equal(await collection.readNext(readOptions), null);
        assert.equal(child.isCurrent(), true);
        assert.equal(fixture.calls.length, 3);
    });

    it('does not turn a cached nested record into selected-table edit membership', async () => {
        const page = listedPage();
        page.tableIdsToLinkedTableStates.table_nested = {
            airtableFields: [structuredClone(titleField)],
            recordIdsToAirtableRecords: {
                nested_only: {
                    id: 'nested_only',
                    fields: { fld_title: 'Nested' },
                },
            },
        };
        const fixture = portalFixture(async () => page);
        const collection = createPortalCollection({
            client: fixture.client,
            portal: portalPage(),
            portalFieldId: 'fld_children',
            criteria,
            getScope: () => ({ ownerId: 'visitor_A', revision: 0 }),
        });
        await collection.readFirst(readOptions);
        assert.throws(
            () =>
                collection.childFormRequest({
                    access: { type: 'edit', recordId: 'nested_only' },
                    configuredChildExtensionId: 'extension_child',
                }),
            (error) =>
                error instanceof PortalCollectionError &&
                error.code === 'record-not-listed'
        );
        assert.equal(fixture.mutations, 0);
    });
});

const root = resolve(process.cwd());
const packedRoot = process.env.SDK_REVIEW_PACKED_ROOT;
const sdkEntry = (entry: string) =>
    packedRoot === undefined
        ? join(root, 'src', entry, 'index.ts')
        : join(packedRoot, 'dist/esm', entry, 'index.js');
let directory: string;
let moduleRevision = 0;
before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-deep-review-portals-'));
    await build({
        entryPoints: [join(root, 'examples/browser/src/portal.ts')],
        alias: {
            '@miniextensions/sdk/ui': sdkEntry('ui'),
            '@miniextensions/sdk/forms': sdkEntry('forms'),
            '@miniextensions/sdk/portals': sdkEntry('portals'),
            '@miniextensions/sdk/auth': sdkEntry('auth'),
            '@miniextensions/sdk/formulas': sdkEntry('formulas'),
            '@miniextensions/sdk': sdkEntry('runtime'),
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'portal.mjs'),
        logLevel: 'silent',
    });
});
after(async () => rm(directory, { recursive: true, force: true }));

const mountPortal = async (test: TestContext, page = editablePage()) => {
    const window = new Window({ url: 'https://app.example.test' });
    function Option(text = '', value = '') {
        const option = window.document.createElement('option');
        option.textContent = text;
        option.value = value;
        return option;
    }
    const globals = {
        document: window.document,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLSelectElement: window.HTMLSelectElement,
        HTMLButtonElement: window.HTMLButtonElement,
        Option,
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
    const fixture = portalFixture(async () => listedPage());
    const updates: UpdateGridCellInput[] = [];
    fixture.client.portals.updateGridCell = async (input) => {
        updates.push(structuredClone(input));
        // Airtable omits a blank edited field; the canonical handler assigns
        // undefined and JSON transport drops that key from its record.fields.
        return {
            record: { id: input.recordId, fields: {} },
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
        getScope: () => ({ ownerId: 'visitor_A', revision: 0 }),
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
            throw new Error('Unexpected diagnostic child load.');
        },
    });
    test.after(() => view.destroy());
    window.document.body.append(view.node);
    const buttons = (text: string) =>
        Array.from(window.document.querySelectorAll('button')).filter(
            (node) => node.textContent?.trim() === text
        );
    const click = async (text: string) => {
        const button = buttons(text)[0];
        assert.ok(button, `Missing diagnostic button: ${text}`);
        button.click();
        await pending;
    };
    return {
        window,
        view,
        fixture,
        updates,
        failures,
        buttons,
        click,
        settle: () => pending,
    };
};

describe(
    'deep review actual Portal browser diagnostics',
    { concurrency: false },
    () => {
        it('masks the configured Portal password cell while preserving its native edit value', async (test) => {
            const page = editablePage();
            page.payload.linkedRecordFieldIdToDetailFields.fld_children[0].miniExtConfig =
                { obscurePassword: true };
            const h = await mountPortal(test, page);
            await h.click('Load records');
            const cell = h.view.node.querySelector('tbody td');
            assert.ok(cell);
            assert.equal(cell.textContent, '••••••••Edit cell');
            assert.equal(
                h.view.node.textContent!.includes('Original title'),
                false
            );
            await h.click('Edit cell');
            const control = h.window.document.querySelector(
                'input[data-field-id="fld_title"]'
            );
            assert.ok(control instanceof h.window.HTMLInputElement);
            assert.equal(control.type, 'password');
            assert.equal(control.value, 'Original title');
            assert.equal(h.updates.length, 0);
            assert.deepEqual(h.failures, []);
        });

        it('keeps an edited Grid field blank when the wire response omits its value', async (test) => {
            const h = await mountPortal(test);
            await h.click('Load records');
            await h.click('Edit cell');
            const control = h.window.document.querySelector(
                'input[data-field-id="fld_title"]'
            );
            assert.ok(control instanceof h.window.HTMLInputElement);
            control.value = '';
            control.dispatchEvent(
                new h.window.Event('input', { bubbles: true })
            );
            const form = control.closest('form');
            assert.ok(form);
            form.dispatchEvent(
                new h.window.Event('submit', {
                    bubbles: true,
                    cancelable: true,
                })
            );
            await h.settle();
            assert.equal(h.updates.length, 1);
            assert.equal(h.updates[0].value, null);
            assert.deepEqual(h.failures, []);
            const row = h.view.node.querySelector(
                'tr[data-record-id="record_child"]'
            );
            assert.ok(row);
            assert.equal(
                row.querySelectorAll('td')[1].textContent,
                'Unchanged description',
                'Saving one cell must preserve other unreturned values.'
            );
            await h.click('Edit cell');
            const reopened = h.window.document.querySelector(
                'input[data-field-id="fld_title"]'
            );
            assert.ok(reopened instanceof h.window.HTMLInputElement);
            assert.equal(
                reopened.value,
                '',
                'The persisted clear must replace the old nonempty cell.'
            );
        });

        for (const source of ['Portal field', 'custom view'] as const) {
            it(`uses the canonical default Grid layout when ${source} omits layout`, async (test) => {
                const page = editablePage();
                const schema = page.payload.fieldIdsToSchemas.fld_children;
                assert.equal(
                    schema.fieldType,
                    AirtableFieldType.MULTIPLE_RECORD_LINKS
                );
                if (
                    schema.fieldType !== AirtableFieldType.MULTIPLE_RECORD_LINKS
                )
                    throw new Error('Expected linked-record Portal fixture.');
                const config = schema.miniExtConfig;
                assert.ok(config);
                assert.ok('layout' in config);
                assert.ok('customViews' in config);
                if (source === 'Portal field') delete config.layout;
                else
                    config.customViews = [
                        {
                            id: 'view_example',
                            config: { viewBehavior: 'custom' },
                        },
                    ];
                const h = await mountPortal(test, page);
                await h.click('Load records');
                assert.deepEqual(h.failures, []);
                assert.equal(
                    h.buttons('Edit cell').length,
                    1,
                    'An omitted layout defaults to Grid in the canonical contract.'
                );
            });
        }
    }
);
