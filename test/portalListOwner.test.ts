import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import type { PortalCollectionCriteria } from '../src/portals/types.js';
import type {
    ListPortalLinkedRecordsResult,
    RuntimeAirtableField,
    RuntimeLinkedRecordDetailField,
} from '../src/runtime/types.js';
import {
    portalPage,
    portalListPage,
    portalFixture,
    deferredPortal,
} from './portalFixtures.js';
const criteria = (): PortalCollectionCriteria => ({
    selectedCustomViewId: 'view_example',
    searchTerm: 'Exact search',
    searchParamsMap: { fld_title: 'Retained' },
    sortFieldsByEndUser: null,
    filtersByEndUser: null,
    supportsEndUserSortCleanup: true,
    supportsEndUserFilterCleanup: true,
});
const readOptions = { pagesToFetch: 1, refreshLoggedInPortalRecord: false };
const richField: RuntimeAirtableField = {
    id: 'fld_native',
    name: 'Native',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: {
        type: 'multipleRecordLinks',
        options: {
            linkedTableId: 'table_nested',
            isReversed: false,
            prefersSingleRecordLink: false,
        },
    },
};
const richDetail: RuntimeLinkedRecordDetailField = {
    fieldId: 'fld_native',
    fieldName: 'Native',
    titleOverride: '',
    isHidden: false,
    fieldIsInEditingChildForm: false,
    childFormField: null,
    miniExtConfig: undefined,
};
const richPage = (projection: 'missing' | 'null' | 'present' = 'present') =>
    portalListPage({
        recordIds: ['record_b', 'record_a'],
        customViewDetailFields:
            projection === 'null'
                ? null
                : projection === 'missing'
                  ? {}
                  : { fld_children: [richDetail] },
        tableIdsToLinkedTableStates: {
            table_children: {
                airtableFields: [richField],
                recordIdsToAirtableRecords: {
                    record_a: {
                        id: 'record_a',
                        fields: {
                            fld_native: ['nested_a'],
                            foreign_field: 'Not projected',
                        },
                    },
                    record_b: { id: 'record_b', fields: { fld_native: [] } },
                },
            },
            table_nested: {
                airtableFields: [],
                recordIdsToAirtableRecords: {
                    nested_a: { id: 'nested_a', fields: {} },
                },
            },
        },
    });
const rows = (ids: string[], cursor: string | null = null) =>
    portalListPage({
        recordIds: ids,
        airtableOffset: cursor,
        tableIdsToLinkedTableStates: {
            table_children: {
                airtableFields: [],
                recordIdsToAirtableRecords: Object.fromEntries(
                    ids.map((id) => [
                        id,
                        { id, fields: { fld_private: 'Retained native' } },
                    ])
                ),
            },
        },
    });
const setup = (
    read: Parameters<typeof portalFixture>[0] = async () => rows(['record_1']),
    portal = portalPage()
) => {
    const api = portalFixture(read);
    let revision = 0,
        configuration = 0;
    const owner = createPortalListOwner({
        client: api.client,
        portal,
        portalFieldId: 'fld_children',
        criteria: criteria(),
        getScope: () => ({ ownerId: 'A', revision }),
        configurationRevision: () => configuration,
    });
    return {
        owner,
        portal,
        ...api,
        get mutations() {
            return api.mutations;
        },
        scope: () => {
            revision++;
            owner.getSnapshot();
        },
        configuration: () => {
            configuration++;
            owner.getSnapshot();
        },
    };
};
it('mounting is inert, first/next preserve server order and copied native values while replacing row eligibility', async () => {
    let count = 0;
    const f = setup(async () =>
        ++count === 1
            ? rows(['record_b', 'record_a'], 'cursor')
            : rows(['record_a', 'record_c'])
    );
    let state = f.owner.getSnapshot();
    const stop = f.owner.subscribe(() => {});
    assert.equal(f.calls.length, 0);
    assert.equal(state.phase, 'idle');
    assert.equal(await f.owner.readFirst(state.revision, readOptions), true);
    state = f.owner.getSnapshot();
    assert.deepEqual(state.page!.recordIds, ['record_b', 'record_a']);
    const first = state.revision;
    const plan = f.owner.childFormRequest(first, {
        access: { type: 'edit', recordId: 'record_b' },
        configuredChildExtensionId: 'extension_child',
    });
    assert.equal(plan.isCurrent(), true);
    assert.equal(await f.owner.readNext(first, readOptions), true);
    assert.equal(plan.isCurrent(), false);
    assert.equal(f.owner.isCurrent(first), false);
    state = f.owner.getSnapshot();
    assert.deepEqual(state.page!.recordIds, [
        'record_b',
        'record_a',
        'record_c',
    ]);
    assert.deepEqual(f.calls[1]!.input.alreadyLoadedRecordIds, [
        'record_b',
        'record_a',
    ]);
    assert.equal(f.calls[1]!.input.airtableOffset, 'cursor');
    state.page!.recordIds.push('mutation');
    state.criteria!.searchTerm = 'mutation';
    assert.deepEqual(f.owner.getSnapshot().page!.recordIds, [
        'record_b',
        'record_a',
        'record_c',
    ]);
    assert.equal(f.owner.getSnapshot().criteria!.searchTerm, 'Exact search');
    assert.equal(
        await f.owner.readNext(f.owner.getSnapshot().revision, readOptions),
        false
    );
    assert.equal(f.calls.length, 2);
    assert.equal(f.mutations, 0);
    stop();
    f.owner.destroy();
});
it('complete criteria replacement retires paging and child context, preserves unrelated criteria and performs no read', async () => {
    const f = setup(async () => rows(['record_1'], 'cursor'));
    await f.owner.readFirst(0, readOptions);
    const state = f.owner.getSnapshot();
    const child = f.owner.childFormRequest(state.revision, {
        access: { type: 'edit', recordId: 'record_1' },
        configuredChildExtensionId: 'extension_child',
    });
    const next = { ...state.criteria!, searchTerm: 'Replacement' };
    assert.equal(f.owner.setCriteria(state.revision, next), true);
    next.searchParamsMap.fld_title = 'Mutated';
    assert.equal(child.isCurrent(), false);
    assert.equal(f.owner.getSnapshot().page, null);
    assert.equal(f.owner.getSnapshot().readRequired, true);
    assert.equal(
        f.owner.getSnapshot().criteria!.searchParamsMap.fld_title,
        'Retained'
    );
    assert.equal(f.calls.length, 1);
    assert.equal(await f.owner.readNext(state.revision, readOptions), false);
    await f.owner.readFirst(f.owner.getSnapshot().revision, readOptions);
    assert.equal(f.calls[1]!.input.airtableOffset, null);
    assert.deepEqual(f.calls[1]!.input.alreadyLoadedRecordIds, []);
    f.owner.destroy();
});
it('sequential cleanup requires explicit current acceptance and patches only returned keys', async () => {
    let count = 0;
    const f = setup(async () =>
        ++count === 1
            ? portalListPage({ endUserSortCleanup: { sortFields: [] } })
            : count === 2
              ? portalListPage({ endUserFilterCleanup: { filters: null } })
              : rows([])
    );
    await f.owner.readFirst(0, readOptions);
    const first = f.owner.getSnapshot();
    assert.equal(first.phase, 'cleanup');
    assert.equal(f.owner.isCurrent(first.revision), false);
    assert.equal(f.owner.acceptCleanup(first.revision - 1), false);
    assert.equal(f.owner.acceptCleanup(first.revision), true);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.owner.getSnapshot().criteria!.sortFieldsByEndUser, []);
    assert.equal(f.owner.getSnapshot().criteria!.searchTerm, 'Exact search');
    await f.owner.readFirst(f.owner.getSnapshot().revision, readOptions);
    const second = f.owner.getSnapshot();
    assert.equal(f.owner.acceptCleanup(first.revision), false);
    assert.equal(f.owner.acceptCleanup(second.revision), true);
    assert.deepEqual(f.owner.getSnapshot().criteria!.sortFieldsByEndUser, []);
    assert.equal(f.owner.getSnapshot().criteria!.filtersByEndUser, null);
    assert.deepEqual(f.owner.getSnapshot().criteria!.searchParamsMap, {
        fld_title: 'Retained',
    });
    assert.equal(
        f.owner.getSnapshot().criteria!.supportsEndUserSortCleanup,
        true
    );
    assert.equal(f.calls.length, 2);
    await f.owner.readFirst(f.owner.getSnapshot().revision, readOptions);
    assert.equal(f.owner.getSnapshot().phase, 'empty');
    f.owner.destroy();
});
for (const transition of [
    'owner-aba',
    'session',
    'token',
    'configuration-aba',
    'criteria',
    'dispose',
] as const) {
    it(`held ${transition} response cannot restore old page or actions`, async () => {
        const held = deferredPortal<ListPortalLinkedRecordsResult>();
        const f = setup(() => held.promise);
        const loading = f.owner.readFirst(0, readOptions);
        const pending = f.owner.getSnapshot();
        assert.equal(pending.pending, true);
        assert.equal(
            await f.owner.readFirst(pending.revision, readOptions),
            false
        );
        if (transition === 'owner-aba') {
            f.scope();
            f.scope();
        }
        if (transition === 'session') f.client.setSession({ visitor: 'B' });
        if (transition === 'token') {
            f.portal.payload.extensionAccessToken = 'synthetic_replacement';
            f.owner.getSnapshot();
        }
        if (transition === 'configuration-aba') {
            f.configuration();
            f.configuration();
        }
        if (transition === 'criteria')
            f.owner.setCriteria(pending.revision, {
                ...criteria(),
                searchTerm: 'New',
            });
        if (transition === 'dispose') f.owner.destroy();
        held.resolve(rows(['record_old']));
        assert.equal(await loading, false);
        assert.equal(f.owner.getSnapshot().page, null);
        assert.equal(f.calls.length, 1);
        f.owner.destroy();
    });
}
it('cancellation creates a fresh read context; late old response cannot clear successor loading', async () => {
    const old = deferredPortal<ListPortalLinkedRecordsResult>(),
        fresh = deferredPortal<ListPortalLinkedRecordsResult>();
    let count = 0;
    const f = setup(() => (++count === 1 ? old.promise : fresh.promise));
    const loading = f.owner.readFirst(0, readOptions);
    f.owner.cancel(f.owner.getSnapshot().revision);
    assert.equal(f.owner.getSnapshot().pending, false);
    assert.equal(f.owner.getSnapshot().phase, 'error');
    const successor = f.owner.readFirst(
        f.owner.getSnapshot().revision,
        readOptions
    );
    old.resolve(rows(['record_old']));
    assert.equal(await loading, false);
    assert.equal(f.owner.getSnapshot().pending, true);
    fresh.resolve(rows(['record_new']));
    assert.equal(await successor, true);
    assert.deepEqual(f.owner.getSnapshot().page!.recordIds, ['record_new']);
    assert.equal(f.calls.length, 2);
    f.owner.destroy();
});
it('reentrant abort-listener fresh reads and renderer exceptions cannot be overwritten by old cancellation', async () => {
    const old = deferredPortal<ListPortalLinkedRecordsResult>();
    let successor: Promise<boolean> | null = null;
    let f: ReturnType<typeof setup>;
    f = setup((call) => {
        if (f.calls.length === 1) {
            call.options!.signal!.addEventListener('abort', () => {
                successor = f.owner.readFirst(
                    f.owner.getSnapshot().revision,
                    readOptions
                );
            });
            return old.promise;
        }
        return Promise.resolve(rows(['record_new']));
    });
    const stop = f.owner.subscribe(() => {
        throw Error('Renderer');
    });
    const loading = f.owner.readFirst(0, readOptions);
    f.owner.cancel(f.owner.getSnapshot().revision);
    assert.equal(await successor, true);
    old.resolve(rows(['record_old']));
    assert.equal(await loading, false);
    assert.deepEqual(f.owner.getSnapshot().page!.recordIds, ['record_new']);
    stop();
    f.owner.destroy();
});
it('empty page with a cursor remains pageable; read errors require a fresh explicit Load', async () => {
    let count = 0;
    const f = setup(async () => {
        if (++count === 1) return rows([], 'cursor');
        if (count === 2) throw Error('Synthetic');
        return rows(['record_new']);
    });
    await f.owner.readFirst(0, readOptions);
    assert.equal(f.owner.getSnapshot().phase, 'empty');
    assert.equal(f.owner.getSnapshot().hasNext, true);
    assert.equal(
        await f.owner.readNext(f.owner.getSnapshot().revision, readOptions),
        false
    );
    assert.equal(f.owner.getSnapshot().phase, 'error');
    assert.equal(f.owner.getSnapshot().page, null);
    assert.equal(
        await f.owner.readNext(f.owner.getSnapshot().revision, readOptions),
        false
    );
    assert.equal(f.calls.length, 2);
    assert.equal(
        await f.owner.readFirst(f.owner.getSnapshot().revision, readOptions),
        true
    );
    assert.deepEqual(f.owner.getSnapshot().page!.recordIds, ['record_new']);
    f.owner.destroy();
});

for (const ending of ['session', 'owner'] as const) {
    it(`subscriber ${ending} replacement suppresses later native-page delivery`, async () => {
        const f = setup();
        const delivered: string[] = [];
        const first = f.owner.subscribe((state) => {
            if (state.phase === 'ready') {
                if (ending === 'session') f.client.setSession({ visitor: 'B' });
                else f.scope();
            }
        });
        const second = f.owner.subscribe((state) => {
            if (state.page) delivered.push(...state.page.recordIds);
        });
        assert.equal(
            await f.owner.readFirst(
                f.owner.getSnapshot().revision,
                readOptions
            ),
            false
        );
        assert.deepEqual(delivered, []);
        assert.equal(f.owner.getSnapshot().phase, 'retired');
        first();
        second();
        f.owner.destroy();
    });
}

for (const ending of ['session', 'owner'] as const) {
    it(`immediate accepted-page subscription ${ending} change retires existing renderers`, async () => {
        const f = setup();
        let rendered = f.owner.getSnapshot();
        const first = f.owner.subscribe((state) => {
            rendered = state;
        });
        assert.equal(
            await f.owner.readFirst(rendered.revision, readOptions),
            true
        );
        assert.equal(rendered.phase, 'ready');
        const second = f.owner.subscribe((state) => {
            if (state.phase === 'ready') {
                if (ending === 'session') f.client.setSession({ visitor: 'B' });
                else f.scope();
            }
        });
        assert.equal(rendered.phase, 'retired');
        assert.equal(rendered.page, null);
        first();
        second();
        f.owner.destroy();
    });
}
it('external cancellation retires an abort-ignoring read and cannot cancel a successor', async () => {
    const old = deferredPortal<ListPortalLinkedRecordsResult>();
    const next = deferredPortal<ListPortalLinkedRecordsResult>();
    let count = 0;
    const f = setup(async () => (++count === 1 ? old.promise : next.promise));
    const signal = new AbortController();
    const first = f.owner.readFirst(f.owner.getSnapshot().revision, {
        ...readOptions,
        signal: signal.signal,
    });
    signal.abort();
    assert.equal(f.owner.getSnapshot().pending, false);
    const second = f.owner.readFirst(
        f.owner.getSnapshot().revision,
        readOptions
    );
    assert.equal(count, 2);
    old.resolve(rows(['old']));
    assert.equal(await first, false);
    assert.equal(f.owner.getSnapshot().pending, true);
    next.resolve(rows(['new']));
    assert.equal(await second, true);
    assert.deepEqual(f.owner.getSnapshot().page!.recordIds, ['new']);
    f.owner.destroy();
});

it('record presentation is detached, ordered, field/table scoped and does no I/O', async () => {
    const f = setup(async () => richPage());
    assert.equal(f.owner.getRecords(0), null);
    assert.equal(f.calls.length, 0);
    await f.owner.readFirst(0, readOptions);
    const revision = f.owner.getSnapshot().revision;
    const value = f.owner.getRecords(revision)!;
    assert.deepEqual(
        value.records.map((record) => record.id),
        ['record_b', 'record_a']
    );
    assert.deepEqual(value.records[1]!.fields, { fld_native: ['nested_a'] });
    assert.equal(value.portalFieldId, 'fld_children');
    assert.equal(value.linkedTableId, 'table_children');
    assert.equal(value.detailProjection, 'present');
    assert.equal(value.detailFields[0]!.titleOverride, '');
    assert.deepEqual(
        Object.keys(value).sort(),
        [
            'detailFields',
            'detailProjection',
            'linkedTableId',
            'portalFieldId',
            'records',
            'table',
        ].sort()
    );
    value.records[1]!.fields.fld_native = ['mutated'];
    value.table.airtableFields[0]!.name = 'mutated';
    value.detailFields[0]!.titleOverride = 'mutated';
    const again = f.owner.getRecords(revision)!;
    assert.deepEqual(again.records[1]!.fields.fld_native, ['nested_a']);
    assert.equal(again.table.airtableFields[0]!.name, 'Native');
    assert.equal(again.detailFields[0]!.titleOverride, '');
    assert.equal(f.calls.length, 1);
    assert.equal(f.mutations, 0);
    f.owner.destroy();
    assert.equal(f.owner.getRecords(revision), null);
});

for (const projection of ['null', 'missing', 'present'] as const) {
    it(`record presentation preserves ${projection} detail projection`, async () => {
        const response = richPage(projection);
        if (projection === 'present')
            response.customViewDetailFields = { fld_children: [] };
        const f = setup(async () => response);
        f.portal.payload.linkedRecordFieldIdToDetailFields.fld_children = [
            richDetail,
        ];
        // Construct an owner after installing accepted legacy metadata.
        f.owner.destroy();
        const owner = createPortalListOwner({
            client: f.client,
            portal: f.portal,
            portalFieldId: 'fld_children',
            criteria: criteria(),
            getScope: () => ({ ownerId: 'A', revision: 0 }),
        });
        await owner.readFirst(0, readOptions);
        const value = owner.getRecords(owner.getSnapshot().revision)!;
        assert.equal(value.detailProjection, projection);
        assert.deepEqual(
            value.detailFields,
            projection === 'null' ? [richDetail] : []
        );
        assert.equal(f.calls.length, 1);
        owner.destroy();
    });
}

for (const transition of [
    'criteria',
    'view',
    'field',
    'owner-aba',
    'session-aba',
    'configuration-aba',
] as const) {
    it(`record presentation retires on ${transition}`, async () => {
        const portal = portalPage({
            customViews: [
                { id: 'view_example', config: { name: 'Example' } },
                { id: 'other_view', config: { name: 'Other' } },
            ],
        });
        portal.payload.fieldIdsInPortal.push('fld_other');
        const other = structuredClone(
            portal.payload.fieldIdsToSchemas.fld_children!
        );
        other.airtableField.id = 'fld_other';
        portal.payload.fieldIdsToSchemas.fld_other = other;
        const f = setup(async () => richPage(), portal);
        await f.owner.readFirst(0, readOptions);
        const revision = f.owner.getSnapshot().revision;
        assert(f.owner.getRecords(revision));
        if (transition === 'criteria')
            f.owner.setCriteria(revision, {
                ...criteria(),
                searchTerm: 'Changed',
            });
        if (transition === 'view')
            f.owner.setCriteria(revision, {
                ...criteria(),
                selectedCustomViewId: 'other_view',
            });
        if (transition === 'field')
            f.owner.setField(revision, 'fld_other', {
                ...criteria(),
                searchTerm: 'Other field lease',
            });
        if (transition === 'owner-aba') {
            f.scope();
            f.scope();
        }
        if (transition === 'configuration-aba') {
            f.configuration();
            f.configuration();
        }
        if (transition === 'session-aba') {
            const session = f.client.getSession();
            f.client.setSession({ visitor: 'B' });
            f.owner.getRecords(revision);
            f.client.setSession(session);
        }
        assert.equal(f.owner.getRecords(revision), null);
        assert.equal(f.calls.length, 1);
        f.owner.destroy();
    });
}

for (const invalid of [
    'missing-record',
    'duplicate-schema',
    'missing-schema',
    'cross-table-record',
    'malformed-schema',
] as const) {
    it(`record presentation refuses ${invalid} without an extra read`, async () => {
        const response = richPage();
        const table = response.tableIdsToLinkedTableStates.table_children!;
        if (invalid === 'missing-record')
            delete table.recordIdsToAirtableRecords.record_a;
        if (invalid === 'duplicate-schema')
            table.airtableFields.push(structuredClone(richField));
        if (invalid === 'missing-schema') table.airtableFields = [];
        if (invalid === 'cross-table-record')
            response.tableIdsToLinkedTableStates.table_nested!.recordIdsToAirtableRecords.record_a =
                { id: 'record_a', fields: {} };
        if (invalid === 'malformed-schema')
            table.airtableFields[0]!.config = {
                type: 'multipleRecordLinks',
                options: null,
            } as never;
        const f = setup(async () => response);
        await f.owner.readFirst(0, readOptions);
        assert.equal(f.owner.getRecords(f.owner.getSnapshot().revision), null);
        assert.equal(f.calls.length, 1);
        f.owner.destroy();
    });
}

it('record facet cannot accept a cancelled late page or disturb a pending successor', async () => {
    const old = deferredPortal<ListPortalLinkedRecordsResult>();
    const next = deferredPortal<ListPortalLinkedRecordsResult>();
    let count = 0;
    const f = setup(() => (++count === 1 ? old.promise : next.promise));
    const first = f.owner.readFirst(0, readOptions);
    assert.equal(f.owner.getRecords(f.owner.getSnapshot().revision), null);
    f.owner.cancel(f.owner.getSnapshot().revision);
    const second = f.owner.readFirst(
        f.owner.getSnapshot().revision,
        readOptions
    );
    old.resolve(richPage());
    assert.equal(await first, false);
    assert.equal(f.owner.getRecords(f.owner.getSnapshot().revision), null);
    assert.equal(f.owner.getSnapshot().pending, true);
    next.resolve(richPage());
    assert.equal(await second, true);
    assert(f.owner.getRecords(f.owner.getSnapshot().revision));
    assert.equal(f.calls.length, 2);
    f.owner.destroy();
});

it('accepted empty records and explicit empty details stay empty', async () => {
    const response = richPage();
    response.recordIds = [];
    response.customViewDetailFields = { fld_children: [] };
    const f = setup(async () => response);
    await f.owner.readFirst(0, readOptions);
    const value = f.owner.getRecords(f.owner.getSnapshot().revision)!;
    assert.deepEqual(value.records, []);
    assert.deepEqual(value.detailFields, []);
    assert.equal(value.detailProjection, 'present');
    assert.equal(f.owner.getSnapshot().phase, 'empty');
    assert.equal(f.calls.length, 1);
    f.owner.destroy();
});
