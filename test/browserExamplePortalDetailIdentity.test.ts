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
    createMiniExtensionsClient,
    type ListPortalLinkedRecordsResult,
    type RuntimeAirtableField,
    type RuntimeLinkedRecordDetailField,
    type UpdateGridCellInput,
} from '../src/runtime/index.js';
import { portalListPage, portalPage } from './portalFixtures.js';

const root = resolve(process.cwd());
// Exact synthetic identities/values from the peer's seven diagnostic fixtures.
const fieldId = 'fld_synthetic_title';
const tableId = 'table_children';
const recordId = 'rec_synthetic_child';
const permittedValue = 'Synthetic permitted value';
const editedValue = 'Synthetic edited value';
let directory: string;
let revision = 0;

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-portal-detail-identity-'));
    // Run the actual starter and SDK source, with only its HTTP boundary replaced.
    await build({
        entryPoints: [join(root, 'examples/browser/src/portal.ts')],
        alias: {
            '@miniextensions/sdk/auth': join(root, 'src/auth/index.ts'),
            '@miniextensions/sdk/ui': join(root, 'src/ui/index.ts'),
            '@miniextensions/sdk/forms': join(root, 'src/forms/index.ts'),
            '@miniextensions/sdk/portals': join(root, 'src/portals/index.ts'),
            '@miniextensions/sdk/formulas': join(root, 'src/formulas/index.ts'),
            '@miniextensions/sdk': join(root, 'src/runtime/index.ts'),
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'portal.mjs'),
        logLevel: 'silent',
    });
});
after(async () => rm(directory, { recursive: true, force: true }));

const physicalField = (): RuntimeAirtableField => ({
    id: fieldId,
    name: 'Synthetic title',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
});
const detailField = (): RuntimeLinkedRecordDetailField => ({
    fieldId,
    fieldName: 'Synthetic title',
    titleOverride: null,
    isHidden: false,
    fieldIsInEditingChildForm: true,
    childFormField: {
        idOrName: { type: 'id', id: fieldId },
        config: {
            type: AirtableFieldType.SINGLE_LINE_TEXT,
            config: { readOnly: false },
        },
    },
    miniExtConfig: { readOnly: false },
});
const listPage = (): ListPortalLinkedRecordsResult =>
    portalListPage({
        recordIds: [recordId],
        customViewDetailFields: { fld_children: [detailField()] },
        tableIdsToLinkedTableStates: {
            [tableId]: {
                airtableFields: [physicalField()],
                recordIdsToAirtableRecords: {
                    [recordId]: {
                        id: recordId,
                        fields: {
                            [fieldId]: permittedValue,
                        },
                    },
                },
            },
        },
    });
const details = (page: ListPortalLinkedRecordsResult) => {
    assert.ok(page.customViewDetailFields);
    return page.customViewDetailFields.fld_children!;
};
const suppliedChild = (): NonNullable<
    RuntimeLinkedRecordDetailField['childFormField']
> => ({
    idOrName: { type: 'id', id: fieldId },
    config: {
        type: AirtableFieldType.SINGLE_LINE_TEXT,
        config: { readOnly: false },
    },
});

const mount = async (
    test: TestContext,
    returned: ListPortalLinkedRecordsResult
) => {
    const window = new Window({
        url: 'https://app.example.test',
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
        },
    });
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
    };
    const previous = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.assign(globalThis, globals);
    let destroyView = () => {};
    test.after(async () => {
        destroyView();
        for (const [key, descriptor] of previous) {
            if (descriptor === undefined)
                Reflect.deleteProperty(globalThis, key);
            else Object.defineProperty(globalThis, key, descriptor);
        }
        await window.happyDOM.close();
    });
    const { createPortalView } = await import(
        `${pathToFileURL(join(directory, 'portal.mjs')).href}?case=${++revision}`
    );
    const page = portalPage({ disableInlineEdit: false });
    const saves: UpdateGridCellInput[] = [];
    const routes: string[] = [];
    const failures: unknown[] = [];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'synthetic-detail-owner' },
        fetch: async (input, init) => {
            const url = new URL(String(input));
            const route = url.searchParams.get('route') ?? url.pathname;
            routes.push(route);
            if (route === 'fetchRecordsForLinkedTableOnPortal')
                return new Response(JSON.stringify(returned));
            if (route === '/api/trpc/airtable.updatePortalRecord') {
                const save = JSON.parse(
                    String(init?.body)
                ) as UpdateGridCellInput;
                saves.push(structuredClone(save));
                return new Response(
                    JSON.stringify({
                        result: {
                            data: {
                                record: {
                                    id: recordId,
                                    fields: { [fieldId]: save.value },
                                },
                                auditTrail: null,
                                auditTrails: [],
                            },
                        },
                    })
                );
            }
            if (route === '/api/trpc/airtable.getUserRecord')
                return new Response(
                    JSON.stringify({
                        result: {
                            data: {
                                id: page.payload.formRecord.recordId,
                                fields: page.payload.formRecord.data,
                            },
                        },
                    })
                );
            throw new Error(`Unexpected synthetic route: ${route}`);
        },
    });
    const actions: Promise<void>[] = [];
    const scope = { ownerId: 'detail-owner', revision: 0 };
    const view = createPortalView({
        page,
        client,
        initialCriteria: {
            selectedCustomViewId: 'view_example',
            searchTerm: null,
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            searchParamsMap: {},
            supportsEndUserSortCleanup: true,
            supportsEndUserFilterCleanup: true,
        },
        getScope: () => scope,
        run: (
            _description: string,
            action: (context: {
                client: typeof client;
                signal: AbortSignal;
                current(): boolean;
            }) => Promise<void>
        ) => {
            const pending = Promise.resolve()
                .then(() =>
                    action({
                        client,
                        signal: new AbortController().signal,
                        current: () => view.node.isConnected,
                    })
                )
                .catch((error: unknown) => {
                    failures.push(error);
                });
            actions.push(pending);
            return pending;
        },
        status: () => {},
        confirm: async () => false,
        openChild: () => {
            throw new Error('Unexpected synthetic child open.');
        },
    });
    window.document.body.append(view.node);
    destroyView = () => view.destroy();
    // The example is dynamically bundled; recover its public DOM node type so
    // button queries retain their native click/textContent types under strict TS.
    const node: HTMLElement = view.node;
    const buttons = (title: string) =>
        Array.from(node.querySelectorAll('button')).filter(
            (button) => button.textContent?.trim() === title
        );
    const click = async (title: string) => {
        const matches = buttons(title);
        assert.equal(matches.length, 1, `Expected one actual ${title} control`);
        matches[0]!.click();
        await Promise.all(actions);
    };
    await click('Load records');
    assert.deepEqual(failures, []);
    assert.equal(view.node.querySelectorAll('tbody tr').length, 1);
    return {
        window,
        view,
        page,
        saves,
        routes,
        failures,
        buttons,
        click,
        settle: () => Promise.all(actions),
    };
};

const editAndSave = async (
    test: TestContext,
    returned: ListPortalLinkedRecordsResult
) => {
    const untouched = structuredClone(returned);
    const fixture = await mount(test, returned);
    await fixture.click('Edit cell');
    const input = fixture.view.node.querySelector(
        `input[data-field-id="${fieldId}"]`
    );
    assert.ok(input instanceof fixture.window.HTMLInputElement);
    assert.equal(input.value, permittedValue);
    input.value = editedValue;
    input.dispatchEvent(new fixture.window.Event('input', { bubbles: true }));
    const form = input.closest('form');
    assert.ok(form);
    form.dispatchEvent(
        new fixture.window.Event('submit', { bubbles: true, cancelable: true })
    );
    // The submit listener synchronously records its action before the first await.
    await fixture.settle();
    assert.deepEqual(fixture.failures, []);
    assert.equal(fixture.saves.length, 1);
    const save = fixture.saves[0]!;
    assert.equal(
        save.portalExtensionAccessToken,
        fixture.page.payload.extensionAccessToken
    );
    assert.equal(save.portalFieldId, 'fld_children');
    assert.equal(save.recordId, recordId);
    assert.equal(save.recordFieldId, fieldId);
    assert.equal(save.selectedCustomViewId, 'view_example');
    assert.equal(save.value, editedValue);
    assert.equal(
        fixture.routes.filter(
            (route) => route === 'fetchRecordsForLinkedTableOnPortal'
        ).length,
        1
    );
    assert.equal(
        fixture.routes.filter(
            (route) => route === '/api/trpc/airtable.getUserRecord'
        ).length,
        1
    );
    assert.deepEqual(
        returned,
        untouched,
        'Returned native values and metadata stay untouched'
    );
};

const refuseDetail = async (
    test: TestContext,
    returned: ListPortalLinkedRecordsResult
) => {
    const untouched = structuredClone(returned);
    const fixture = await mount(test, returned);
    const node: HTMLElement = fixture.view.node;
    assert.equal(fixture.buttons('Edit cell').length, 0);
    assert.equal(node.querySelector(`input[data-field-id="${fieldId}"]`), null);
    assert.equal(node.textContent?.includes(permittedValue), false);
    assert.equal(node.outerHTML.includes(permittedValue), false);
    for (const control of node.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement
    >('input, textarea'))
        assert.equal(control.value.includes(permittedValue), false);
    assert.deepEqual(fixture.saves, []);
    assert.deepEqual(fixture.routes, ['fetchRecordsForLinkedTableOnPortal']);
    assert.deepEqual(fixture.failures, []);
    assert.deepEqual(returned, untouched);
};

type PeerCase = {
    number: number;
    name: string;
    accepted: boolean;
    change(detail: RuntimeLinkedRecordDetailField): void;
};
const peerCases: PeerCase[] = [
    {
        number: 1,
        name: 'supplied child ID mismatches the physical field',
        accepted: false,
        change(detail) {
            detail.childFormField = {
                ...suppliedChild(),
                idOrName: {
                    type: 'id',
                    id: 'fld_different_synthetic_field',
                },
            };
        },
    },
    {
        number: 2,
        name: 'supplied child uses the mismatched name selector',
        accepted: false,
        change(detail) {
            detail.childFormField = {
                ...suppliedChild(),
                idOrName: { type: 'name', name: 'Different synthetic title' },
            };
        },
    },
    {
        number: 3,
        name: 'supplied child has no idOrName',
        accepted: false,
        change(detail) {
            const child = suppliedChild();
            Reflect.deleteProperty(child, 'idOrName');
            detail.childFormField = child;
        },
    },
    {
        number: 4,
        name: 'supplied child NUMBER type mismatches SINGLE_LINE_TEXT',
        accepted: false,
        change(detail) {
            detail.childFormField = {
                idOrName: { type: 'id', id: fieldId },
                config: {
                    type: AirtableFieldType.NUMBER,
                    config: { readOnly: false },
                },
            };
        },
    },
    {
        number: 5,
        name: 'membership false and null child preserves returned-config fallback',
        accepted: true,
        change(detail) {
            detail.fieldIsInEditingChildForm = false;
            detail.childFormField = null;
        },
    },
    {
        number: 6,
        name: 'membership false retains the matching supplied child',
        accepted: true,
        change(detail) {
            detail.fieldIsInEditingChildForm = false;
        },
    },
    {
        number: 7,
        name: 'missing membership flag retains the matching supplied child',
        accepted: true,
        change(detail) {
            Reflect.deleteProperty(detail, 'fieldIsInEditingChildForm');
        },
    },
];

describe('actual starter exact seven peer Portal detail diagnostics', () => {
    it('keeps the unmodified peer baseline Edit and native Save', async (test) => {
        await editAndSave(test, listPage());
    });
    for (const peer of peerCases) {
        it(`peer ${peer.number}: ${peer.name}`, async (test) => {
            const returned = listPage();
            peer.change(details(returned)[0]!);
            if (peer.accepted) await editAndSave(test, returned);
            else await refuseDetail(test, returned);
        });
    }
});

describe('additional Portal identity controls beyond the seven peer diagnostics', () => {
    it('keeps null-child fallback when the editing membership flag is true', async (test) => {
        const returned = listPage();
        details(returned)[0]!.childFormField = null;
        await editAndSave(test, returned);
    });

    it('keeps coherent child write config separate from returned display policy', async (test) => {
        const returned = listPage();
        details(returned)[0]!.miniExtConfig = { readOnly: true };
        await editAndSave(test, returned);
    });

    it('uses exact physical IDs when distinct fields share a display name', async (test) => {
        const returned = listPage();
        returned.tableIdsToLinkedTableStates[tableId]!.airtableFields.push({
            ...physicalField(),
            id: 'fld_other_title',
        });
        returned.tableIdsToLinkedTableStates[
            tableId
        ]!.recordIdsToAirtableRecords[recordId]!.fields.fld_other_title =
            'Other native title';
        await editAndSave(test, returned);
    });

    it('refuses the malformed detail locally while keeping a valid neighboring editor', async (test) => {
        const returned = listPage();
        const neighborId = 'fld_neighbor_title';
        const neighborValue = 'Synthetic neighboring value';
        details(returned)[0]!.childFormField = {
            ...suppliedChild(),
            idOrName: { type: 'id', id: 'fld_different_synthetic_field' },
        };
        details(returned).push({
            ...detailField(),
            fieldId: neighborId,
            fieldName: 'Neighbor title',
            childFormField: {
                ...suppliedChild(),
                idOrName: { type: 'id', id: neighborId },
            },
        });
        returned.tableIdsToLinkedTableStates[tableId]!.airtableFields.push({
            ...physicalField(),
            id: neighborId,
            name: 'Neighbor title',
        });
        returned.tableIdsToLinkedTableStates[
            tableId
        ]!.recordIdsToAirtableRecords[recordId]!.fields[neighborId] =
            neighborValue;
        const untouched = structuredClone(returned);
        const fixture = await mount(test, returned);
        const node: HTMLElement = fixture.view.node;
        assert.equal(fixture.buttons('Edit cell').length, 1);
        assert.equal(node.textContent?.includes(permittedValue), false);
        assert.equal(node.textContent?.includes(neighborValue), true);
        await fixture.click('Edit cell');
        const input = fixture.window.document.querySelector(
            `input[data-field-id="${neighborId}"]`
        );
        assert.ok(input instanceof fixture.window.HTMLInputElement);
        assert.equal(input.value, neighborValue);
        assert.equal(
            node.querySelector(`input[data-field-id="${fieldId}"]`),
            null
        );
        assert.deepEqual(fixture.saves, []);
        assert.deepEqual(fixture.routes, [
            'fetchRecordsForLinkedTableOnPortal',
        ]);
        assert.deepEqual(returned, untouched);
    });

    const ambiguous: [string, (page: ListPortalLinkedRecordsResult) => void][] =
        [
            [
                'returned detail ID is duplicated',
                (returned) => {
                    details(returned).push(
                        structuredClone(details(returned)[0]!)
                    );
                },
            ],
            [
                'selected-table physical ID is duplicated',
                (returned) => {
                    returned.tableIdsToLinkedTableStates[
                        tableId
                    ]!.airtableFields.push(physicalField());
                },
            ],
            [
                'physical ID also appears in another returned table',
                (returned) => {
                    returned.tableIdsToLinkedTableStates.table_other = {
                        airtableFields: [physicalField()],
                        recordIdsToAirtableRecords: {},
                    };
                },
            ],
        ];
    for (const [name, change] of ambiguous) {
        it(`refuses native display and inline edits when ${name}`, async (test) => {
            const returned = listPage();
            change(returned);
            await refuseDetail(test, returned);
        });
    }
});
