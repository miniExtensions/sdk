import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createNativePortalCollectionKernel,
    type NativePortalCollectionScope,
} from '../src/portals/nativeCollectionKernel.js';

const scope: NativePortalCollectionScope = {
    sessionId: 'session',
    fieldId: 'linked',
    linkedTableId: 'table',
    bindingKey: 'binding-a',
    fetchOwnerKey: 'token-a',
    cacheOwnerEpoch: 0,
};
type Row = { id: string; fields: Record<string, string> };
const make = () =>
    createNativePortalCollectionKernel<
        Row,
        { id: string },
        { fieldId: string },
        { cache: string }
    >();
const response = (ids = ['one'], nextOffset: string | null = 'cursor') => ({
    recordIds: ids,
    recordsById: Object.fromEntries(
        ids.map((id) => [id, { id, fields: { title: id } } as Row])
    ),
    schema: [{ id: 'title' }],
    linkedTableId: 'table',
    details: { presence: 'present' as const, fields: [{ fieldId: 'title' }] },
    primary: { fieldId: 'title' },
    nextOffset,
    projection: { cache: 'response-only' },
});
const loaded = () => {
    const k = make();
    const b = k.begin(k.createState(scope), {
        requestId: 'first',
        mode: 'first',
    })!;
    return { k, state: k.succeed(b.state, b.receipt, response())!.state };
};

describe('native-compatible Portal transition corpus (SDK contract; native harness separately held)', () => {
    it('A: cache-only First skips and forced First supersedes with exact receipt authority', () => {
        const { k, state } = loaded();
        assert.equal(
            k.begin(state, {
                requestId: 'cache',
                mode: 'first',
                onlyIfNotFetched: true,
            }),
            null
        );
        const a = k.begin(state, { requestId: 'a', mode: 'first' })!;
        const b = k.begin(a.state, { requestId: 'b', mode: 'first' })!;
        assert.equal(k.succeed(b.state, a.receipt, response()), null);
        assert.equal(k.isCurrent(b.state, { ...b.receipt }), false);
        assert.ok(k.succeed(b.state, b.receipt, response()));
    });
    it('B: pending Next/reload retain rows; retained failure retries the exact empty cursor', () => {
        const { k, state } = loaded();
        const s = k.succeed(
            k.begin(state, { requestId: 'empty', mode: 'reload' })!.state,
            k.begin(state, { requestId: 'unused', mode: 'reload' })!.receipt,
            response()
        );
        assert.equal(s, null);
        const replace = k.begin(state, {
            requestId: 'empty-real',
            mode: 'reload',
        })!;
        const empty = k.succeed(
            replace.state,
            replace.receipt,
            response(['one'], '')
        )!.state;
        const next = k.begin(empty, {
            requestId: 'next',
            mode: 'next',
            retainNextOnFailure: true,
        })!;
        assert.equal(next.plan.cursor, '');
        assert.deepEqual(next.state.frame?.recordIds, ['one']);
        assert.equal(next.state.paging.isPaginating, true);
        const failed = k.fail(next.state, next.receipt, 'retry')!.state;
        assert.equal(failed.paging.type, 'loaded');
        assert.equal(failed.paging.nextOffset, '');
        assert.equal(failed.paging.errorMessage, 'retry');
        const retry = k.begin(failed, { requestId: 'retry', mode: 'next' })!;
        assert.equal(retry.plan.cursor, '');
        assert.ok(
            k.succeed(retry.state, retry.receipt, response(['two'], null))
        );
        const reload = k.begin(state, { requestId: 'reload', mode: 'reload' })!;
        assert.deepEqual(reload.state.paging.recordIds, ['one']);
        assert.equal(
            k.fail(reload.state, reload.receipt, 'ordinary')!.state.paging.type,
            'failed'
        );
    });
    it('C: observed ABA retires; benign enrichment preserves identity; successor token reloads', () => {
        const { k, state } = loaded();
        const b = k.begin(state, { requestId: 'next', mode: 'next' })!;
        assert.equal(k.observe(b.state, { ...scope }), b.state);
        const away = k.observe(b.state, {
            ...scope,
            bindingKey: 'b',
            fetchOwnerKey: 'token-b',
        });
        const back = k.observe(away, scope);
        assert.equal(k.succeed(back, b.receipt, response()), null);
        const token = k.observe(state, {
            ...scope,
            bindingKey: 'new-token',
            fetchOwnerKey: 'token-b',
        });
        assert.equal(
            k.begin(token, { requestId: 'next-new-token', mode: 'next' })!.plan
                .mode,
            'reload'
        );
        for (const mode of ['replace', 'append', 'clear']) {
            const changed = k.observe(b.state, scope, { idsOnly: true });
            assert.equal(k.succeed(changed, b.receipt, response()), null, mode);
            assert.equal(changed.frame, null);
        }
    });
    it('D: raw duplicate compatibility IDs and detached response-only whole-row replacement', () => {
        const { k, state } = loaded();
        const b = k.begin(state, { requestId: 'next', mode: 'next' })!;
        const r = response(['one', 'two', 'two'], null);
        r.recordsById.one = { id: 'one', fields: { replacement: 'only' } };
        const result = k.succeed(b.state, b.receipt, r)!;
        assert.deepEqual(result.compatibility?.recordIds, [
            'one',
            'one',
            'two',
            'two',
        ]);
        assert.deepEqual(result.state.frame?.recordIds, ['one', 'two']);
        assert.deepEqual(result.state.frame?.records[0].fields, {
            replacement: 'only',
        });
        r.recordsById.one.fields.replacement = 'mutated';
        assert.equal(result.state.frame?.records[0].fields.replacement, 'only');
        assert.ok(Object.isFrozen(result.state.frame?.records[0].fields));
        const bad = k.begin(state, { requestId: 'withheld', mode: 'reload' })!;
        const withheld = response();
        delete withheld.recordsById.one;
        const rejected = k.succeed(bad.state, bad.receipt, withheld)!;
        assert.equal(rejected.state.frame, null);
        assert.equal(rejected.state.paging.type, 'loaded');
        assert.deepEqual(rejected.compatibility?.recordIds, ['one']);
    });
    it('E: exact parent/cursor and exhausted Next; stale outcomes have no effects', () => {
        const { k, state } = loaded();
        const b = k.begin(state, { requestId: 'next', mode: 'next' })!;
        const changed = k.observe(b.state, scope, {
            idsOnly: true,
            paging: { ...state.paging, nextOffset: 'other' },
        });
        assert.equal(k.fail(changed, b.receipt, 'old'), null);
        assert.equal(k.cleanup(changed, b.receipt, 'sort', []), null);
        const last = k.begin(state, { requestId: 'last', mode: 'reload' })!;
        const end = k.succeed(
            last.state,
            last.receipt,
            response(['one'], null)
        )!.state;
        assert.equal(
            k.begin(end, { requestId: 'exhausted', mode: 'next' }),
            null
        );
    });
    it('F: plans are immutable and a superseded receipt is no longer current', () => {
        const { k, state } = loaded();
        const b = k.begin(state, { requestId: 'outer', mode: 'reload' })!;
        // Host commits one snapshot, then listeners may synchronously supersede it.
        let canonical = b.state;
        canonical = k.begin(canonical, {
            requestId: 'inner',
            mode: 'reload',
        })!.state;
        assert.equal(k.isCurrent(canonical, b.receipt), false);
        assert.throws(() => {
            (b.state.paging.recordIds as string[]).push('poison');
        });
    });
    it('G: cleanup exposes a guarded forced-First continuation; stale cleanup yields nothing', () => {
        const { k, state } = loaded();
        const b = k.begin(state, { requestId: 'cleanup', mode: 'next' })!;
        const c = k.cleanup(b.state, b.receipt, 'sort', [{ id: 'safe' }])!;
        assert.equal(c.state.frame, state.frame);
        assert.equal(c.compatibility, undefined);
        assert.ok(k.isCleanupCurrent(c.state, c.cleanup!.receipt));
        const done = k.completeCleanup(c.state, c.cleanup!.receipt)!;
        assert.equal(done.read.mode, 'first');
        assert.equal(done.read.onlyIfNotFetched, false);
        const newer = k.begin(c.state, { requestId: 'newer', mode: 'reload' })!;
        assert.equal(k.completeCleanup(newer.state, c.cleanup!.receipt), null);
    });
    it('H: presentation unmount leaves canonical completion live; explicit retirement settles nothing', () => {
        const { k, state } = loaded();
        const b = k.begin(state, { requestId: 'allocated', mode: 'reload' })!;
        const canonical = b.state;
        assert.ok(k.succeed(canonical, b.receipt, response()));
        const disposed = k.retire(canonical);
        assert.equal(k.succeed(disposed, b.receipt, response()), null);
        assert.equal(
            k.begin(disposed, { requestId: 'after-disposal', mode: 'first' }),
            null
        );
    });
});
