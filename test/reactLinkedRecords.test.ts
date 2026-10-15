import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    FieldRenderer,
    renderMultipleRecordLinksField,
} from '../src/react/index.js';
import { FieldRendererSource } from '../src/react/fieldRendererSource.js';
import type { FieldRendererProps } from '../src/ui/rendererRegistry.js';
import type { FormLinkedRecordsSnapshot } from '../src/forms/linkedRecords.js';
import { createSelectionModel } from '../src/ui/model.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import {
    createFormFieldRendererHost,
    createPortalCellRendererHost,
    createPortalDetailRendererHost,
} from '../src/ui/rendererHosts.js';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import { createPortalCellBinding } from '../src/portals/cell.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

type Props = FieldRendererProps<'multipleRecordLinks'>;
const primary = {
    id: 'name',
    name: 'Name',
    description: null,
    isComputed: false,
    isPrimaryField: true,
    config: { type: 'singleLineText', options: null },
} as const;
const field: Props['field'] = {
    ...primary,
    id: 'links',
    name: 'Projects',
    isPrimaryField: false,
    config: {
        type: 'multipleRecordLinks',
        options: {
            linkedTableId: 'labels',
            isReversed: false,
            prefersSingleRecordLink: false,
        },
    },
};
const detail = {
    fieldId: 'name',
    fieldName: 'Name',
    titleOverride: null,
    isHidden: false,
    fieldIsInEditingChildForm: false,
    childFormField: null,
    miniExtConfig: {},
};
const record = (id: string, name: string) => ({ id, fields: { name } });
const records = [record('rec_b', 'Bravo'), record('rec_blank', '')];
const rich: FormLinkedRecordsSnapshot = {
    phase: 'ready',
    pending: false,
    error: null,
    linkedTableId: 'labels',
    selectedRecords: records,
    unresolvedSelectedIds: ['rec_missing'],
    candidateRecords: [record('rec_hidden', 'Private hidden label')],
    table: { airtableFields: [primary] },
    detailProjection: 'present',
    detailFields: [detail],
    selectedPolicy: {
        supported: true,
        reasons: [],
        state: 'applied',
        diagnostics: [],
    },
};
const native = ['rec_b', 'rec_hidden', 'rec_b', 'rec_blank', 'rec_missing'];
const defer = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((a, b) => {
        resolve = a;
        reject = b;
    });
    return { promise, resolve, reject };
};
async function fixture(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    const changes: (readonly string[])[] = [];
    const queries: string[] = [];
    const model = createSelectionModel({
        multiple: true,
        value: native,
        options: [
            { value: 'rec_b', label: 'Bypass label' },
            { value: 'rec_hidden', label: 'Private hidden label' },
            { value: 'rec_new', label: '<img> New' },
            { value: 'rec_disabled', label: 'Disabled', disabled: true },
        ],
        onChange: (value) => changes.push(value),
    });
    let reads = 0,
        searches = 0,
        pages = 0;
    const props = (): Props => ({
        physicalKind: 'multipleRecordLinks',
        presentation: { type: 'physical', config: field.config },
        fieldId: 'links',
        field,
        title: 'Projects',
        displayConfig: {},
        writeConfig: {},
        context: 'form',
        computed: false,
        dirty: false,
        pending: false,
        error: null,
        validation: [],
        value: [...native],
        linkedRecords: {
            source: 'form',
            state: structuredClone(rich),
            readSelected: async () => {
                reads++;
                return true;
            },
        },
        capability: {
            type: 'editable',
            setValue: () => {
                throw Error('No fallback');
            },
            selection: {
                state: model.getState(),
                choose: (values) => {
                    changes.push([...values]);
                },
                toggle: () => {
                    throw Error('No toggle');
                },
                clear: () => {
                    changes.push([]);
                },
                setSearchInput: (input) => {
                    queries.push(input);
                    model.setSearchInput(input);
                },
                reload: async () => {
                    searches++;
                },
                loadMore: async () => {
                    pages++;
                },
                cancel: () => {
                    throw Error('No borrowed cancellation');
                },
            },
        },
    });
    const render = async (node: ReactNode) => {
        await act(async () => root.render(h(StrictMode, null, node)));
    };
    const button = (name: string) => {
        const node = [...container.querySelectorAll('button')].find(
            (node) =>
                node.getAttribute('aria-label') === name ||
                node.textContent === name
        );
        assert.ok(node, name);
        return node;
    };
    const type = async (value: string) => {
        const input = container.querySelector('input')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )!.set!.call(input, value);
            input.dispatchEvent(new window.Event('input', { bubbles: true }));
        });
        return input;
    };
    t.after(async () => {
        await act(async () => root.unmount());
        model.destroy();
        keys.forEach((key, i) => {
            if (originals[i])
                Object.defineProperty(globalThis, key, originals[i]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    return {
        window,
        container,
        render,
        props,
        button,
        type,
        changes,
        queries,
        counts: () => ({ reads, searches, pages }),
    };
}

it('renders native occurrences in order, with filtered/blank/missing placeholders and no candidate-label fallback or IDs', async (t) => {
    const f = await fixture(t);
    const props = f.props();
    await f.render(renderMultipleRecordLinksField(props));
    assert.deepEqual(
        [
            ...f.container.querySelectorAll(
                '.mx-sdk-linked-records-values li span'
            ),
        ].map((n) => n.textContent),
        [
            'Bravo',
            'Linked record unavailable',
            'Bravo',
            'Linked record unavailable',
            'Linked record unavailable',
        ]
    );
    assert.doesNotMatch(
        f.container.innerHTML,
        /rec_b|rec_hidden|rec_blank|rec_missing|Private hidden label|Bypass label/
    );
    assert.equal(f.container.querySelector('img'), null);
    assert.match(f.container.textContent!, /<img> New/);
    assert.deepEqual(f.counts(), { reads: 0, searches: 0, pages: 0 });
    assert.deepEqual(props.value, native);
    await act(async () => f.button('<img> New').click());
    assert.deepEqual(f.changes.at(-1), [...native, 'rec_new']);
    await act(async () => f.button('Remove selected record 1').click());
    assert.deepEqual(f.changes.at(-1), [
        'rec_hidden',
        'rec_blank',
        'rec_missing',
    ]);
    await act(async () => f.button('Clear').click());
    assert.deepEqual(f.changes.at(-1), []);
});

it('only dispatches explicit reads/search/paging, prevents Enter submission, and contains row gestures', async (t) => {
    const f = await fixture(t);
    const props = f.props();
    if (props.capability.type !== 'editable' || !props.capability.selection)
        throw Error();
    props.capability.selection.state.offset = 'next';
    let rows = 0;
    await f.render(
        h(
            'form',
            {
                onSubmit: () => {
                    throw Error('No submit');
                },
            },
            h(
                'div',
                {
                    onClick: () => rows++,
                    onPointerDown: () => rows++,
                    onDoubleClick: () => rows++,
                    onAuxClick: () => rows++,
                    onChange: () => rows++,
                    onKeyDown: () => rows++,
                    onKeyUp: () => rows++,
                },
                renderMultipleRecordLinksField(props),
                renderMultipleRecordLinksField({
                    ...props,
                    title: 'Other',
                    displayConfig: { showTitle: false },
                })
            )
        )
    );
    const ids = [...f.container.querySelectorAll('[id]')].map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length);
    const input = await f.type('query');
    assert.deepEqual(f.queries, ['query']);
    assert.equal(f.counts().searches, 0);
    const enter = new f.window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
    });
    await act(async () => input.dispatchEvent(enter));
    assert.equal(enter.defaultPrevented, true);
    for (const kind of [
        'click',
        'dblclick',
        'pointerdown',
        'auxclick',
        'keyup',
    ])
        await act(async () =>
            input.dispatchEvent(new f.window.Event(kind, { bubbles: true }))
        );
    await act(async () => f.button('Search').click());
    await act(async () => f.button('Load more').click());
    await act(async () => f.button('Load selected').click());
    assert.deepEqual(f.counts(), { reads: 1, searches: 1, pages: 1 });
    assert.equal(rows, 0);
    assert.equal(f.changes.length, 0);
});

for (const source of ['displayConfig', 'writeConfig'] as const)
    for (const flag of [
        'obscurePassword',
        'maskPasswordOnLoginScreen',
    ] as const)
        it(`masks labels, candidate text, feedback and query with ${source}.${flag}`, async (t) => {
            const f = await fixture(t);
            const props = {
                ...f.props(),
                [source]: { [flag]: true },
                error: 'Private hidden label rec_hidden',
                validation: [
                    {
                        fieldId: 'links',
                        fieldTitle: 'Projects',
                        errorMessage: 'Bravo private',
                    },
                ],
            } as Props;
            await f.render(renderMultipleRecordLinksField(props));
            await f.type('secret');
            assert.doesNotMatch(
                f.container.innerHTML,
                /Bravo|Private|Bypass|<img>|rec_hidden|secret/
            );
            assert.match(f.container.textContent!, /••••/);
            assert.equal(f.container.querySelector('input')?.type, 'password');
            assert.ok(f.button('Select masked record 1'));
        });

it('fails closed on missing or unsupported projection and hidden/masked primary metadata', async (t) => {
    const f = await fixture(t);
    for (const state of [
        {
            ...rich,
            selectedPolicy: {
                ...rich.selectedPolicy,
                supported: false,
                state: 'waiting-data' as const,
            },
        },
        { ...rich, phase: 'retired' as const },
        { ...rich, phase: 'unavailable' as const },
        { ...rich, detailProjection: 'missing' as const },
        { ...rich, detailProjection: 'null' as const },
        { ...rich, detailFields: [] },
        { ...rich, detailFields: [{ ...detail, isHidden: true }] },
        {
            ...rich,
            detailFields: [
                { ...detail, miniExtConfig: { obscurePassword: true } },
            ],
        },
        { ...rich, table: null },
        { ...rich, table: { airtableFields: [primary, primary] } },
        { ...rich, linkedTableId: 'foreign' },
    ]) {
        await f.render(
            renderMultipleRecordLinksField({
                ...f.props(),
                linkedRecords: {
                    source: 'form',
                    state,
                    readSelected: async () => false,
                },
            })
        );
        assert.doesNotMatch(f.container.textContent!, /Bravo/);
    }
    await f.render(
        renderMultipleRecordLinksField({
            ...f.props(),
            linkedRecords: undefined,
            value: null,
            title: ' ',
        })
    );
    assert.match(f.container.textContent!, /No linked records/);
    assert.equal(f.button('Clear').disabled, true);
    await f.render(
        renderMultipleRecordLinksField({
            ...f.props(),
            linkedRecords: {
                source: 'portal-pills',
                items: [
                    {
                        nativeIndex: 0,
                        state: 'resolved',
                        label: 'Portal label',
                    },
                    { nativeIndex: 2, state: 'blank', label: null },
                ],
            },
        })
    );
    assert.match(f.container.textContent!, /Portal label/);
    assert.equal(
        [...f.container.querySelectorAll('button')].some(
            (n) => n.textContent === 'Load selected'
        ),
        false
    );
});

it('obeys readonly, computed, pending, absent and disabled selection capabilities without setValue fallback', async (t) => {
    const f = await fixture(t);
    const props = f.props();
    if (props.capability.type !== 'editable' || !props.capability.selection)
        throw Error();
    const selection = props.capability.selection;
    for (const variant of [
        { ...props, capability: { type: 'readonly' as const } },
        {
            ...props,
            capability: {
                type: 'editable' as const,
                setValue: props.capability.setValue,
            },
        },
        { ...props, displayConfig: { readOnly: true } },
        { ...props, writeConfig: { readOnly: true } },
        { ...props, computed: true },
        { ...props, pending: true },
        ...['disabled', 'readOnly', 'loading'].map((flag) => ({
            ...props,
            capability: {
                ...props.capability,
                selection: {
                    ...selection,
                    state: { ...selection.state, [flag]: true },
                },
            },
        })),
    ] as Props[]) {
        await f.render(renderMultipleRecordLinksField(variant));
        assert.equal(f.button('Remove selected record 1').disabled, true);
        assert.equal(f.button('Clear').disabled, true);
        const search = [...f.container.querySelectorAll('button')].find(
            (n) => n.textContent === 'Search'
        );
        if (search) assert.equal(search.disabled, true);
    }
    assert.equal(f.changes.length, 0);
    await f.render(
        renderMultipleRecordLinksField({
            ...props,
            capability: { type: 'readonly' },
        })
    );
    await act(async () => f.button('Load selected').click());
    assert.equal(f.counts().reads, 1);
});

it('fences async rejection across direct props A→B→A and unmount, without cancelling the owner', async (t) => {
    const f = await fixture(t);
    const pending = defer<boolean>();
    const a = f.props();
    a.linkedRecords = {
        source: 'form',
        state: rich,
        readSelected: () => pending.promise,
    };
    await f.render(renderMultipleRecordLinksField(a));
    await act(async () => {
        f.button('Load selected').click();
        f.button('Load selected').click();
    });
    assert.equal(f.button('Load selected').disabled, true);
    await f.render(renderMultipleRecordLinksField(f.props()));
    await f.render(renderMultipleRecordLinksField(a));
    await act(async () => pending.reject(Error('private stale error')));
    assert.equal(f.container.querySelector('[role=status]')?.textContent, '');
    const next = defer<boolean>();
    const b = {
        ...a,
        linkedRecords: {
            source: 'form' as const,
            state: rich,
            readSelected: () => next.promise,
        },
    };
    await f.render(renderMultipleRecordLinksField(b));
    await act(async () => f.button('Load selected').click());
    await f.render(null);
    await act(async () => next.reject(Error('retired')));
    assert.equal(f.container.textContent, '');
});

it('retains pending feedback across snapshots of one source and handles sync/async failures generically', async (t) => {
    const f = await fixture(t);
    const source = {};
    const pending = defer<boolean>();
    const props = f.props();
    props.linkedRecords = {
        source: 'form',
        state: rich,
        readSelected: () => pending.promise,
    };
    const render = (p: Props) =>
        f.render(
            h(
                FieldRendererSource.Provider,
                { value: source },
                renderMultipleRecordLinksField(p)
            )
        );
    await render(props);
    await act(async () => f.button('Load selected').click());
    await render({ ...props });
    assert.equal(f.button('Load selected').disabled, true);
    await act(async () => pending.reject(Error('private error rec_hidden')));
    assert.match(f.container.textContent!, /could not be updated/);
    assert.doesNotMatch(f.container.textContent!, /private error|rec_hidden/);
    await render({
        ...props,
        linkedRecords: {
            source: 'form',
            state: rich,
            readSelected: () => {
                throw Error('sync private');
            },
        },
    });
    await act(async () => f.button('Load selected').click());
    assert.match(f.container.textContent!, /could not be updated/);
});

it('uses a real Form host with explicit hydration/search, preserves filtered identities on edits and existing normalization, and never saves', async (t) => {
    const f = await fixture(t);
    const loaded = loadedForm();
    loaded.payload.fieldIdsInForm = ['links'];
    loaded.payload.formRecord.data.links = [...native];
    loaded.payload.fieldIdsToSchemas.links = {
        fieldType: 'multipleRecordLinks',
        airtableField: field,
        miniExtConfig: {
            filterLinkedRecordsConditionFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'visible',
                        type: 'singleCondition',
                        setting: {
                            fieldType: 'singleLineText',
                            type: 'is',
                            value: 'Bravo',
                            idOrName: { type: 'id', id: 'name' },
                        },
                    },
                ],
            },
        },
    };
    loaded.payload.linkedRecordFieldIdToDetailFields.links = [detail];
    let reads = 0,
        searches = 0,
        saves = 0,
        revision = 0;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://synthetic.invalid',
        fetch: async () => {
            throw Error('No network');
        },
    });
    client.linkedRecords.loadSelectedRecords = async () => {
        reads++;
        return {
            labels: {
                airtableFields: [primary],
                recordIdsToAirtableRecords: Object.fromEntries(
                    [
                        ...records,
                        record('rec_hidden', 'Private filtered label'),
                    ].map((r) => [r.id, r])
                ),
            },
        };
    };
    client.forms.save = async () => {
        saves++;
        throw Error('No implicit Save');
    };
    const owner = createFormFieldBindings({
        loaded,
        client,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'form', revision: 0 }),
        configurationRevision: () => revision,
    });
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'links',
        isCurrent: () => true,
        configurationRevision: () => revision,
    });
    owner.setLinkedLoader('links', async () => {
        searches++;
        return {
            options: [{ value: 'rec_new', label: 'New record' }],
            offset: 'next',
        };
    });
    t.after(() => {
        host.dispose();
        owner.destroy();
    });
    await f.render(
        h(FieldRenderer, {
            host,
            renderers: { renderMultipleRecordLinksField },
        })
    );
    assert.equal(reads, 0);
    assert.equal(searches, 0);
    await act(async () => f.button('Load selected').click());
    assert.equal(reads, 1);
    assert.match(f.container.textContent!, /Bravo/);
    assert.doesNotMatch(
        f.container.innerHTML,
        /Private filtered label|rec_hidden/
    );
    assert.deepEqual(
        owner
            .linkedRecords('links')
            .getSnapshot()
            .selectedRecords.map((r) => r.id),
        ['rec_b', 'rec_b']
    );
    await act(async () => f.button('Search').click());
    await act(async () => f.button('New record').click());
    assert.deepEqual(owner.field('links').getSnapshot().value, [
        'rec_b',
        'rec_hidden',
        'rec_blank',
        'rec_missing',
        'rec_new',
    ]);
    assert.equal(saves, 0);
    revision++;
    await act(async () => f.button('Clear').click());
    assert.deepEqual(owner.field('links').getSnapshot().value, [
        'rec_b',
        'rec_hidden',
        'rec_blank',
        'rec_missing',
        'rec_new',
    ]);
    assert.equal(saves, 0);
});

for (const layout of ['grid', 'list'] as const)
    for (const mask of [false, true])
        it(`renders actual Portal ${layout} host with ${mask ? 'masked' : 'literal'} labels, native duplicates, draft-only edits and retirement`, async (t) => {
            const f = await fixture(t);
            const api = portalFixture(async () =>
                portalListPage({
                    recordIds: ['record_1'],
                    customViewDetailFields: {
                        fld_children: [
                            {
                                ...detail,
                                fieldId: 'links',
                                fieldName: 'Projects',
                                fieldIsInEditingChildForm: true,
                                miniExtConfig: {
                                    maskPasswordOnLoginScreen: mask,
                                },
                            },
                        ],
                    },
                    tableIdsToLinkedTableStates: {
                        table_children: {
                            airtableFields: [field],
                            recordIdsToAirtableRecords: {
                                record_1: {
                                    id: 'record_1',
                                    fields: { links: [...native] },
                                },
                            },
                        },
                        labels: {
                            airtableFields: [primary],
                            recordIdsToAirtableRecords: Object.fromEntries(
                                records.map((r) => [r.id, r])
                            ),
                        },
                    },
                })
            );
            const owner = createPortalListOwner({
                client: api.client,
                portal: portalPage({ layout, disableInlineEdit: false }),
                portalFieldId: 'fld_children',
                criteria: {
                    selectedCustomViewId: 'view_example',
                    searchTerm: '',
                    searchParamsMap: {},
                    sortFieldsByEndUser: null,
                    filtersByEndUser: null,
                    supportsEndUserSortCleanup: true,
                    supportsEndUserFilterCleanup: true,
                },
                getScope: () => ({ ownerId: 'portal', revision: 0 }),
            });
            await owner.readFirst(owner.getSnapshot().revision, {
                pagesToFetch: 1,
                refreshLoggedInPortalRecord: false,
            });
            const cell = createPortalCellBinding({
                client: api.client,
                schema: {
                    fieldType: 'multipleRecordLinks',
                    airtableField: field,
                    miniExtConfig: { maskPasswordOnLoginScreen: mask },
                },
                value: [...native],
                input: {
                    portalExtensionAccessToken: 'portal_access_example',
                    portalFieldId: 'fld_children',
                    recordId: 'record_1',
                    recordFieldId: 'links',
                    selectedCustomViewId: 'view_example',
                },
                getScope: () => ({ ownerId: 'portal', revision: 0 }),
                isCurrent: () => true,
                recovery: {
                    journal: new RecoveryJournal(),
                    scope: {
                        owner: 'portal',
                        parentFieldId: 'fld_children',
                        tableId: 'table_children',
                        childExtensionId: '',
                        context: 'modal',
                    },
                    loadVersion: 1,
                },
            });
            const options = {
                owner,
                client: api.client,
                recordId: 'record_1',
                isCurrent: () => true,
                configurationRevision: () => 0,
            };
            const host =
                layout === 'grid'
                    ? createPortalCellRendererHost({
                          ...options,
                          cell,
                          fieldId: 'links',
                      })
                    : createPortalDetailRendererHost(options);
            t.after(() => {
                host.dispose();
                cell.destroy();
                owner.destroy();
            });
            await f.render(
                h(FieldRenderer, {
                    host,
                    renderers: { renderMultipleRecordLinksField },
                })
            );
            assert.equal(
                f.container.querySelectorAll('.mx-sdk-linked-records-values li')
                    .length,
                5
            );
            assert.equal(
                f.button('Remove selected record 1').disabled,
                layout === 'list'
            );
            assert.equal(api.calls.length, 1);
            assert.equal(api.mutations, 0);
            assert.doesNotMatch(
                f.container.innerHTML,
                /rec_hidden|rec_b|rec_missing/
            );
            if (mask) {
                assert.doesNotMatch(f.container.textContent!, /Bravo/);
                assert.match(f.container.textContent!, /••••/);
            } else assert.match(f.container.textContent!, /Bravo/);
            if (layout === 'grid') {
                await act(async () =>
                    f.button('Remove selected record 1').click()
                );
                assert.deepEqual(cell.binding.getSnapshot().value, [
                    'rec_hidden',
                    'rec_blank',
                    'rec_missing',
                ]);
                assert.equal(api.mutations, 0);
            }
            await act(async () => owner.destroy());
            assert.equal(f.container.textContent, '');
        });

it('uses the existing single-selection action and gives blank or ID-fallback candidates generic labels', async (t) => {
    const f = await fixture(t);
    const props = f.props();
    if (props.capability.type !== 'editable' || !props.capability.selection)
        throw Error();
    props.capability.selection.state.multiple = false;
    props.capability.selection.state.options = [
        { value: 'rec_new', label: '' },
        { value: 'rec_id_fallback', label: 'rec_id_fallback' },
    ];
    await f.render(renderMultipleRecordLinksField(props));
    assert.doesNotMatch(f.container.innerHTML, /rec_id_fallback/);
    assert.equal(
        f.container.querySelectorAll('.mx-sdk-linked-records-options button')
            .length,
        2
    );
    await act(async () => f.button('Unnamed linked record').click());
    assert.deepEqual(f.changes.at(-1), ['rec_new']);
});

it('redacts raw record IDs in unmasked option labels, accessible names and every feedback source', async (t) => {
    const f = await fixture(t);
    const base = f.props();
    if (base.capability.type !== 'editable' || !base.capability.selection)
        throw Error();
    const selection = base.capability.selection;
    const variants: Props[] = [
        { ...base, error: 'rec_private error' },
        {
            ...base,
            validation: [
                {
                    fieldId: 'links',
                    fieldTitle: 'Projects',
                    errorMessage: 'rec_private validation',
                },
            ],
        },
        {
            ...base,
            capability: {
                ...base.capability,
                selection: {
                    ...selection,
                    state: { ...selection.state, error: 'rec_private search' },
                },
            },
        },
        {
            ...base,
            linkedRecords: {
                source: 'form',
                state: { ...rich, error: 'rec_private hydration' },
                readSelected: async () => false,
            },
        },
    ];
    for (const props of variants) {
        if (props.capability.type === 'editable' && props.capability.selection)
            props.capability.selection.state.options = [
                { value: 'rec_fallback', label: 'rec_fallback' },
            ];
        await f.render(renderMultipleRecordLinksField(props));
        assert.doesNotMatch(
            f.container.innerHTML,
            /rec_private|rec_fallback|rec_hidden|rec_missing|rec_b/
        );
        assert.equal(
            f.container.querySelector('[role=status]')?.textContent,
            'Linked records could not be updated. Review the field and try again.'
        );
        assert.equal(
            f.button('Unnamed linked record').getAttribute('aria-label'),
            null
        );
        assert.equal(
            f.button('Remove selected record 1').getAttribute('aria-label'),
            'Remove selected record 1'
        );
    }
});
