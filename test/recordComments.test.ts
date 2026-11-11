import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    createRecordCommentsController,
    presentRecordComment,
    type RecordComment,
    type RecordCommentsControllerOptions,
    type RecordCommentsController,
} from '../src/ui/index.js';
import type {
    AddRecordCommentInput,
    ListRecordCommentsInput,
    ListRecordCommentsResult,
} from '../src/runtime/types.js';

const comment = (id: string): RecordComment => ({
    id,
    text: id,
    createdTime: '2024-01-01T00:00:00Z',
    lastUpdatedTime: null,
    author: { id: 'author', name: null, email: 'author@example.invalid' },
    mentioned: {},
});
const page = (
    ids: string[],
    patch: Partial<ListRecordCommentsResult> = {}
): ListRecordCommentsResult => ({
    readableVersionOfRecordPrimaryValue: null,
    comments: ids.map(comment),
    ...patch,
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
async function waitForRead(
    controller: RecordCommentsController,
    status: 'ready' | 'error'
) {
    if (controller.getSnapshot().readStatus === status) return;
    await new Promise<void>((resolve) => {
        const stop = controller.subscribe(() => {
            if (controller.getSnapshot().readStatus === status) {
                stop();
                resolve();
            }
        });
    });
}
function fixture(patch: Partial<RecordCommentsControllerOptions> = {}) {
    const reads: ListRecordCommentsInput[] = [];
    const writes: AddRecordCommentInput[] = [];
    const invalidations: ListRecordCommentsInput[] = [];
    let current = true;
    const controller = createRecordCommentsController({
        owner: { isCurrent: () => current },
        childExtensionAccessToken: 'captured-A',
        list: async (input) => {
            reads.push(input);
            return page(['new']);
        },
        append: async (input) => {
            writes.push(input);
        },
        invalidate: (input) => {
            invalidations.push(input);
        },
        ...patch,
    });
    return {
        controller,
        reads,
        writes,
        invalidations,
        retire: () => {
            current = false;
        },
    };
}

it('preserves native actor attribution and raw text for every actor arm', () => {
    for (const actor of [
        { type: 'user', uid: 'user' } as const,
        { type: 'public', extensionId: 'extension' } as const,
        {
            type: 'system',
            extensionId: 'extension',
            service: 'bulk-scheduler',
        } as const,
    ]) {
        assert.deepEqual(
            presentRecordComment({
                id: 'native',
                text: '{{forged}}: @[user]',
                createdTime: '2024-01-01T00:00:00Z',
                lastUpdatedTime: null,
                actor,
                authorLabel: '<Verified>',
            }),
            { author: '<Verified>', text: '{{forged}}: @[user]', mentions: {} }
        );
    }
});

it('preserves unanchored legacy substring semantics and own-property mentions', () => {
    const legacy = comment('legacy');
    assert.ok('author' in legacy);
    legacy.text = 'xx{{Alias}}: raw';
    legacy.mentioned = Object.assign(
        Object.create({ inherited: { type: 'userGroup', name: 'forged' } }),
        {
            known: { type: 'userGroup', id: 'known', name: '<Ops>' },
            user: {
                type: 'user',
                id: 'user',
                name: null,
                email: 'email@example.invalid',
            },
        }
    );
    const result = presentRecordComment(legacy);
    assert.equal(result.author, 'Alias');
    assert.equal(result.text, legacy.text.substring('{{Alias}}: '.length));
    assert.deepEqual(result.mentions, {
        known: '<Ops>',
        user: 'email@example.invalid',
    });
    assert.equal(
        presentRecordComment(comment('plain')).author,
        'author@example.invalid'
    );
});

it('loads only explicitly, prepends exact page order and uses newest sending policy', async () => {
    const reads: ListRecordCommentsInput[] = [];
    const f = fixture({
        list: async (input) => {
            reads.push(input);
            return reads.length === 1
                ? page(['n2', 'n1'], {
                      nextCursor: 'opaque /+=',
                      disableSending: false,
                  })
                : page(['o2', 'o1'], { disableSending: true });
        },
    });
    assert.deepEqual(reads, []);
    await f.controller.start();
    await f.controller.start();
    assert.equal(reads.length, 1);
    await f.controller.loadOlder();
    assert.deepEqual(reads[1], {
        childExtensionAccessToken: 'captured-A',
        cursor: 'opaque /+=',
    });
    assert.deepEqual(
        f.controller.getSnapshot().history.map((x) => x.id),
        ['o2', 'o1', 'n2', 'n1']
    );
    assert.equal(f.controller.getSnapshot().disableSending, false);
    assert.equal(await f.controller.loadOlder(), false);
    assert.equal(reads.length, 2);
});

it('refresh atomically replaces history and rejects late old pagination', async () => {
    const older = deferred<ListRecordCommentsResult>();
    let count = 0;
    const f = fixture({
        list: async () =>
            ++count === 1
                ? page(['new'], { nextCursor: 'old' })
                : count === 2
                  ? older.promise
                  : page(['replacement'], {
                        nextCursor: 'new-cursor',
                        disableSending: true,
                    }),
    });
    await f.controller.start();
    const pending = f.controller.loadOlder();
    assert.equal(await f.controller.loadOlder(), false);
    await f.controller.refresh();
    older.resolve(page(['stale']));
    await pending;
    assert.deepEqual(
        f.controller.getSnapshot().history.map((x) => x.id),
        ['replacement']
    );
    assert.equal(f.controller.getSnapshot().nextCursor, 'new-cursor');
    assert.equal(f.controller.getSnapshot().disableSending, true);
});

it('refresh failure retains history internally and requires explicit recovery', async () => {
    const failure = new Error('read boundary failed');
    let count = 0;
    const f = fixture({
        list: async () => {
            if (++count === 2) throw failure;
            return page(['accepted'], { nextCursor: 'cursor' });
        },
    });
    await f.controller.start();
    await f.controller.refresh();
    assert.equal(f.controller.getSnapshot().readError, failure);
    assert.equal(f.controller.getSnapshot().readStatus, 'error');
    assert.equal(f.controller.getSnapshot().history[0].id, 'accepted');
    f.controller.setDraft('retained');
    assert.equal(await f.controller.send(), false);
    assert.equal(await f.controller.loadOlder(), false);
    assert.equal(count, 2);
    await f.controller.refresh();
    assert.equal(f.controller.getSnapshot().readStatus, 'ready');
});

it('admits one raw draft synchronously and prefixes exactly once', async () => {
    for (const includeCommenterPrefix of [undefined, true, false]) {
        const append = deferred<void>();
        const writes: AddRecordCommentInput[] = [];
        const f = fixture({
            list: async () =>
                page([], {
                    readableVersionOfRecordPrimaryValue: 'Ada',
                    includeCommenterPrefix,
                }),
            append: async (input) => {
                writes.push(input);
                await append.promise;
            },
        });
        await f.controller.start();
        assert.equal(await f.controller.send(), false);
        f.controller.setDraft(' \n raw @[id] ');
        const pending = f.controller.send();
        // A same-owner value echo is not a newer edit or an owner retirement.
        f.controller.setDraft(' \n raw @[id] ');
        assert.equal(await f.controller.send(), false);
        assert.equal(writes.length, 1);
        assert.equal(
            writes[0].comment,
            includeCommenterPrefix === false
                ? ' \n raw @[id] '
                : '{{Ada}}:  \n raw @[id] '
        );
        append.resolve();
        assert.equal(await pending, true);
        assert.equal(f.controller.getSnapshot().draft, '');
        assert.equal(await f.controller.send(), false);
        assert.deepEqual(f.invalidations, [
            { childExtensionAccessToken: 'captured-A' },
        ]);
    }
});

it('accepted append and failed refresh stay separate with no restored replay draft', async () => {
    let reads = 0;
    const f = fixture({
        list: async () => {
            if (++reads === 2) throw new Error('refresh failed');
            return page([]);
        },
    });
    await f.controller.start();
    f.controller.setDraft('once');
    assert.equal(await f.controller.send(), true);
    await waitForRead(f.controller, 'error');
    assert.equal(f.controller.getSnapshot().sendError, null);
    assert.equal(f.controller.getSnapshot().draft, '');
    assert.equal(f.controller.getSnapshot().readStatus, 'error');
    assert.equal(await f.controller.send(), false);
    assert.equal(f.writes.length, 1);
});

it('throwing invalidation or presentation observers cannot reclassify accepted append', async () => {
    const failures: unknown[] = [];
    const failure = new Error('cache observer failed');
    const f = fixture({
        invalidate: () => {
            throw failure;
        },
        onPresentationError: (error) => {
            failures.push(error);
            throw error;
        },
        onAppendError: () => {
            assert.fail('append accepted');
        },
    });
    await f.controller.start();
    f.controller.setDraft('once');
    assert.equal(await f.controller.send(), true);
    assert.deepEqual(failures, [failure]);
    assert.equal(f.controller.getSnapshot().sendError, null);
    assert.equal(f.writes.length, 1);
    assert.equal(f.reads.length, 2);
});

it('failed and uncertain appends retain draft and never auto-resend or invalidate', async () => {
    for (const failure of [
        new Error('reject'),
        new DOMException('post-dispatch uncertain', 'AbortError'),
    ]) {
        const presented: unknown[] = [];
        let attempts = 0;
        const f = fixture({
            append: async () => {
                attempts++;
                throw failure;
            },
            onAppendError: (error) => presented.push(error),
        });
        await f.controller.start();
        f.controller.setDraft('raw');
        assert.equal(await f.controller.send(), false);
        assert.equal(f.controller.getSnapshot().draft, 'raw');
        assert.equal(f.controller.getSnapshot().sendError, failure);
        assert.deepEqual(presented, [failure]);
        assert.deepEqual(f.invalidations, []);
        assert.equal(f.reads.length, 1);
        assert.equal(attempts, 1);
    }
});

it('matching draft clearing observes edit generations including ABA', async () => {
    const append = deferred<void>();
    const f = fixture({ append: () => append.promise });
    await f.controller.start();
    f.controller.setDraft('A');
    const pending = f.controller.send();
    f.controller.setDraft('B');
    f.controller.setDraft('A');
    append.resolve();
    await pending;
    assert.equal(f.controller.getSnapshot().draft, 'A');
    assert.equal(f.controller.getSnapshot().sendError, null);
});

it('retirement never aborts admitted append and settlement invalidates only captured query', async () => {
    const append = deferred<void>();
    const f = fixture({ append: () => append.promise });
    const successor = fixture({ childExtensionAccessToken: 'successor' });
    await f.controller.start();
    await successor.controller.start();
    f.controller.setDraft('original');
    successor.controller.setDraft('successor draft');
    const pending = f.controller.send();
    f.retire();
    f.controller.dispose();
    append.resolve();
    assert.equal(await pending, true);
    assert.deepEqual(f.invalidations, [
        { childExtensionAccessToken: 'captured-A' },
    ]);
    assert.equal(f.reads.length, 1);
    assert.equal(successor.controller.getSnapshot().draft, 'successor draft');
    assert.deepEqual(successor.invalidations, []);
    assert.equal(await f.controller.send(), false);
});

it('append settlement supersedes an already pending pre-append refresh', async () => {
    const old = deferred<ListRecordCommentsResult>();
    const append = deferred<void>();
    let count = 0;
    const f = fixture({
        list: async () =>
            ++count === 1
                ? page([])
                : count === 2
                  ? old.promise
                  : page(['after-append']),
        append: () => append.promise,
    });
    await f.controller.start();
    f.controller.setDraft('send');
    const sending = f.controller.send();
    const refreshing = f.controller.refresh();
    append.resolve();
    await sending;
    old.resolve(page(['before-append']));
    await refreshing;
    assert.equal(count, 3);
    assert.equal(f.controller.getSnapshot().history[0].id, 'after-append');
});

it('a throwing accepted-state subscriber cannot turn append success into a failed send', async () => {
    let appended = false;
    const failures: unknown[] = [];
    const f = fixture({
        append: async () => {
            appended = true;
        },
        onPresentationError: (error) => {
            failures.push(error);
        },
    });
    await f.controller.start();
    f.controller.setDraft('once');
    const failure = new Error('presentation failed after receipt');
    const stop = f.controller.subscribe(() => {
        if (appended && f.controller.getSnapshot().draft === '') throw failure;
    });
    assert.equal(await f.controller.send(), true);
    stop();
    assert.ok(failures.includes(failure));
    assert.equal(f.controller.getSnapshot().sendError, null);
    assert.equal(await f.controller.send(), false);
    assert.equal(f.invalidations.length, 1);
    assert.equal(f.reads.length, 2);
});

it('empty continued pages and opaque empty cursors require explicit paging without deduplication', async () => {
    let reads = 0;
    const f = fixture({
        list: async (input) => {
            reads++;
            return input.cursor === undefined
                ? page([], { nextCursor: '' })
                : page(['same', 'same']);
        },
    });
    await f.controller.start();
    assert.equal(reads, 1);
    assert.deepEqual(f.controller.getSnapshot().history, []);
    await f.controller.loadOlder();
    assert.equal(reads, 2);
    assert.deepEqual(
        f.controller.getSnapshot().history.map((x) => x.id),
        ['same', 'same']
    );
});

it('retired owners cannot start, paginate or send and cannot be revived after ABA', async () => {
    const f = fixture();
    f.controller.dispose();
    await f.controller.start();
    await f.controller.refresh();
    await f.controller.loadOlder();
    f.controller.setDraft('forged');
    await f.controller.send();
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.writes, []);
    assert.equal(f.controller.getSnapshot().draft, '');
});

it(
    'append receipt completes before a held cache invalidation or refresh',
    { timeout: 1000 },
    async () => {
        const invalidation = deferred<void>();
        const refresh = deferred<ListRecordCommentsResult>();
        let reads = 0;
        const f = fixture({
            list: async () => (++reads === 1 ? page([]) : refresh.promise),
            invalidate: () => invalidation.promise,
        });
        await f.controller.start();
        f.controller.setDraft('accepted');
        try {
            assert.equal(await f.controller.send(), true);
            assert.equal(f.controller.getSnapshot().sending, false);
            assert.equal(f.controller.getSnapshot().draft, '');
            assert.equal(reads, 1);
            invalidation.resolve();
            await Promise.resolve();
            assert.equal(reads, 2);
            assert.equal(f.controller.getSnapshot().readStatus, 'loading');
            assert.equal(await f.controller.send(), false);
        } finally {
            invalidation.resolve();
            refresh.resolve(page(['accepted-result']));
        }
        await waitForRead(f.controller, 'ready');
        assert.equal(
            f.controller.getSnapshot().history[0].id,
            'accepted-result'
        );
    }
);

it('actual owner revocation refuses new I/O and late read publication without relying on dispose', async () => {
    const f = fixture();
    await f.controller.start();
    f.controller.setDraft('admitted owner draft');
    f.retire();
    assert.equal(await f.controller.send(), false);
    assert.equal(await f.controller.refresh(), false);
    assert.equal(await f.controller.loadOlder(), false);
    f.controller.setDraft('successor cannot be targeted');
    assert.equal(f.controller.getSnapshot().draft, 'admitted owner draft');
    assert.deepEqual(f.writes, []);
    assert.equal(f.reads.length, 1);

    const held = deferred<ListRecordCommentsResult>();
    const late = fixture({ list: () => held.promise });
    const pending = late.controller.start();
    late.retire();
    held.resolve(page(['foreign-successor-proof']));
    assert.equal(await pending, false);
    assert.deepEqual(late.controller.getSnapshot().history, []);
    assert.deepEqual(late.invalidations, []);
});

it('a late older-page failure cannot mark the replacement history as failed', async () => {
    const older = deferred<ListRecordCommentsResult>();
    let reads = 0;
    const f = fixture({
        list: async () =>
            ++reads === 1
                ? page(['initial'], { nextCursor: 'older' })
                : reads === 2
                  ? older.promise
                  : page(['replacement']),
    });
    await f.controller.start();
    const pending = f.controller.loadOlder();
    await f.controller.refresh();
    older.reject(new Error('retired older page'));
    assert.equal(await pending, false);
    assert.equal(f.controller.getSnapshot().readStatus, 'ready');
    assert.equal(f.controller.getSnapshot().olderError, null);
    assert.deepEqual(
        f.controller.getSnapshot().history.map((row) => row.id),
        ['replacement']
    );
});
