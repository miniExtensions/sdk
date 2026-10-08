import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import type { PortalCollectionCriteria } from '../src/portals/types.js';
import type { ListPortalLinkedRecordsResult } from '../src/runtime/types.js';
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
    read: Parameters<typeof portalFixture>[0] = async () => rows(['record_1'])
) => {
    const api = portalFixture(read);
    const portal = portalPage();
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
