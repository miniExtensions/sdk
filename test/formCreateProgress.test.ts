import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createFormProgressStorage,
    type FormProgressLockManager,
    type FormProgressReadResult,
    type FormProgressSnapshot,
    type FormProgressStorage,
    type FormProgressStorageOptions,
    type FormProgressToken,
    type FormProgressValues,
    type FormProgressWriteResult,
} from '../src/forms/createProgress.js';

class MemoryStorage {
    readonly bytes = new Map<string, string>();
    reads = 0;
    writes = 0;
    removals = 0;
    getItem(key: string): string | null {
        this.reads++;
        return this.bytes.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.writes++;
        this.bytes.set(key, value);
    }
    removeItem(key: string): void {
        this.removals++;
        this.bytes.delete(key);
    }
}

// A cooperating serial queue: each name owns its callback until settlement.
class Locks implements FormProgressLockManager {
    readonly names: string[] = [];
    private readonly tails = new Map<string, Promise<void>>();
    hold(name: string): () => void {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const previous = this.tails.get(name) ?? Promise.resolve();
        this.tails.set(
            name,
            previous.then(() => gate)
        );
        return release;
    }
    request<Result>(name: string, callback: () => Result): Promise<Result> {
        this.names.push(name);
        const previous = this.tails.get(name) ?? Promise.resolve();
        const result = previous.then(callback);
        this.tails.set(
            name,
            result.then(
                () => {},
                () => {}
            )
        );
        return result;
    }
}

const lockName = (scope: string) =>
    `miniExtensions-sdk:create-progress:v1:${scope}`;
const setup = (overrides: Partial<FormProgressStorageOptions> = {}) => {
    const local = new MemoryStorage();
    const locks = new Locks();
    const state = { current: true, ids: 0, storage: 0, locks: 0, checks: 0 };
    const owner = createFormProgressStorage({
        scope: 'opaque-synthetic-create',
        getStorage: () => {
            state.storage++;
            return local;
        },
        getLocks: () => {
            state.locks++;
            return locks;
        },
        createId: () => `synthetic-id-${++state.ids}`,
        isCurrent: () => {
            state.checks++;
            return state.current;
        },
        ...overrides,
    });
    return { owner, local, locks, state };
};
const written = (result: FormProgressWriteResult): FormProgressSnapshot => {
    assert.equal(result.status, 'written');
    if (result.status !== 'written')
        throw new Error('Expected stored progress.');
    return result.snapshot;
};
const read = (result: FormProgressReadResult): FormProgressSnapshot | null => {
    assert.equal(result.status, 'read');
    if (result.status !== 'read')
        throw new Error('Expected a successful read.');
    return result.snapshot;
};
const arbitraryToken = (): FormProgressToken => ({
    draftId: 'draft',
    writeId: 'write',
});

describe('explicit scalar create progress', { concurrency: false }, () => {
    it('constructs without invoking capabilities, identity generation or owner callbacks', () => {
        const denied = () => {
            throw new Error('Must not run during construction.');
        };
        const owner = createFormProgressStorage({
            scope: 'opaque',
            getStorage: denied,
            getLocks: denied,
            createId: denied,
            isCurrent: denied,
        });
        owner.destroy();
        assert.deepEqual(owner.read(), { status: 'retired' });
    });

    it('reads absence explicitly without locks, identity generation or writes', () => {
        const h = setup({
            getLocks: () => {
                throw new Error('Read must not lock.');
            },
        });
        assert.equal(read(h.owner.read()), null);
        assert.equal(h.local.reads, 1);
        assert.equal(h.local.writes + h.local.removals + h.state.ids, 0);
    });

    it('round-trips scalar bytes and special own keys without retaining caller references', async () => {
        const h = setup();
        const values: FormProgressValues = {
            title: '',
            money: 12.5,
            zero: 0,
            checked: false,
            empty: null,
            ['__proto__']: 'ordinary data',
            constructor: 'own constructor',
        };
        const snapshot = written(
            await h.owner.write({ expected: null, values })
        );
        values.title = 'caller changed';
        snapshot.values.money = 99;
        snapshot.token.writeId = 'caller changed token';
        const stored = read(h.owner.read())!;
        assert.deepEqual(stored.values, { ...values, title: '', money: 12.5 });
        assert.notEqual(stored.token.writeId, snapshot.token.writeId);
        assert.equal(Object.getPrototypeOf(stored.values), Object.prototype);
        assert.equal(Object.hasOwn(stored.values, '__proto__'), true);
        stored.values.title = 'read copy changed';
        assert.equal(read(h.owner.read())!.values.title, '');
        const envelope = JSON.parse([...h.local.bytes.values()][0]!);
        assert.deepEqual(Object.keys(envelope).sort(), [
            'draftId',
            'kind',
            'values',
            'version',
            'writeId',
        ]);
        assert.equal(envelope.kind, 'miniExtensions-sdk-create-progress');
        assert.equal(envelope.version, 1);
        assert.notEqual(stored.token.draftId, stored.token.writeId);
    });

    it('keeps opaque scopes independent and uses the same scoped key for locks and storage', async () => {
        const local = new MemoryStorage();
        const locks = new Locks();
        let ids = 0;
        const make = (scope: string) =>
            setup({
                scope,
                getStorage: () => local,
                getLocks: () => locks,
                createId: () => `id-${++ids}`,
            }).owner;
        const a = make('scope-A');
        const b = make('scope-B');
        const one = written(
            await a.write({ expected: null, values: { title: 'A' } })
        );
        written(await b.write({ expected: null, values: { title: 'B' } }));
        assert.deepEqual(
            [...local.bytes.keys()],
            [lockName('scope-A'), lockName('scope-B')]
        );
        assert.deepEqual(locks.names, [
            lockName('scope-A'),
            lockName('scope-B'),
        ]);
        assert.deepEqual(await a.remove(one.token), { status: 'removed' });
        assert.equal(read(b.read())!.values.title, 'B');
    });

    it('retains the draft incarnation but changes the write token and refuses late exact cleanup', async () => {
        const h = setup();
        const one = written(
            await h.owner.write({
                expected: null,
                values: { title: 'Submitted input' },
            })
        );
        const two = written(
            await h.owner.write({
                expected: one.token,
                values: { title: 'Newer unsaved input' },
            })
        );
        assert.equal(two.token.draftId, one.token.draftId);
        assert.notEqual(two.token.writeId, one.token.writeId);
        assert.deepEqual(await h.owner.remove(one.token), {
            status: 'conflict',
        });
        assert.deepEqual(read(h.owner.read()), two);
        assert.deepEqual(await h.owner.remove(two.token), {
            status: 'removed',
        });
        assert.deepEqual(await h.owner.remove(two.token), { status: 'absent' });
    });

    it('rejects stale writes and cleanup after delete/recreate even across current owners', async () => {
        const local = new MemoryStorage();
        const locks = new Locks();
        let ids = 0;
        const options = {
            getStorage: () => local,
            getLocks: () => locks,
            createId: () => `global-${++ids}`,
        };
        const a = setup(options).owner;
        const b = setup(options).owner;
        const old = written(
            await a.write({
                expected: null,
                values: { title: 'Old incarnation' },
            })
        );
        assert.deepEqual(await a.remove(old.token), { status: 'removed' });
        const successor = written(
            await b.write({
                expected: null,
                values: { title: 'New incarnation' },
            })
        );
        assert.notEqual(successor.token.draftId, old.token.draftId);
        assert.deepEqual(
            await a.write({
                expected: old.token,
                values: { title: 'Stale overwrite' },
            }),
            { status: 'conflict' }
        );
        assert.deepEqual(await a.remove(old.token), { status: 'conflict' });
        assert.deepEqual(read(b.read()), successor);
    });

    it('allows another current owner to continue only the exact observed token', async () => {
        const local = new MemoryStorage();
        const locks = new Locks();
        let ids = 0;
        const options = {
            getStorage: () => local,
            getLocks: () => locks,
            createId: () => `global-${++ids}`,
        };
        const a = setup(options).owner;
        const b = setup(options).owner;
        const one = written(
            await a.write({ expected: null, values: { title: 'Observed' } })
        );
        const two = written(
            await b.write({
                expected: one.token,
                values: { title: 'Accepted continuation' },
            })
        );
        assert.equal(two.token.draftId, one.token.draftId);
        assert.deepEqual(
            await a.write({ expected: one.token, values: { title: 'Stale' } }),
            { status: 'conflict' }
        );
        assert.deepEqual(read(a.read()), two);
    });

    it('compares draft and write identities independently for both replacement and cleanup', async () => {
        const h = setup();
        const saved = written(
            await h.owner.write({
                expected: null,
                values: { title: 'Keep exact identity' },
            })
        );
        for (const wrong of [
            { ...saved.token, draftId: 'different-incarnation' },
            { ...saved.token, writeId: 'different-write' },
        ]) {
            assert.deepEqual(
                await h.owner.write({
                    expected: wrong,
                    values: { title: 'Wrong target' },
                }),
                { status: 'conflict' }
            );
            assert.deepEqual(await h.owner.remove(wrong), {
                status: 'conflict',
            });
        }
        assert.deepEqual(read(h.owner.read()), saved);
        assert.equal(h.local.writes, 1);
        assert.equal(h.local.removals, 0);
    });

    it('serializes concurrent absence claims without silently overwriting the winning draft', async () => {
        const h = setup();
        const first = h.owner.write({
            expected: null,
            values: { title: 'First' },
        });
        const second = h.owner.write({
            expected: null,
            values: { title: 'Second' },
        });
        const accepted = written(await first);
        assert.deepEqual(await second, { status: 'conflict' });
        assert.deepEqual(read(h.owner.read()), accepted);
        assert.equal(h.local.writes, 1);
    });

    it('copies tokens and values before queued arguments can be reassigned or mutated', async () => {
        const h = setup();
        const first = written(
            await h.owner.write({
                expected: null,
                values: { title: 'Initial' },
            })
        );
        const release = h.locks.hold(lockName('opaque-synthetic-create'));
        const expected = { ...first.token };
        const values = { title: 'Captured' };
        const args = { expected, values };
        const pending = h.owner.write(args);
        expected.draftId = 'redirect';
        expected.writeId = 'redirect';
        values.title = 'Mutated';
        args.expected = arbitraryToken();
        args.values = { title: 'Reassigned' };
        release();
        const saved = written(await pending);
        assert.equal(saved.token.draftId, first.token.draftId);
        assert.deepEqual(saved.values, { title: 'Captured' });
        const cleanupToken = { ...saved.token };
        const releaseCleanup = h.locks.hold(
            lockName('opaque-synthetic-create')
        );
        const cleanup = h.owner.remove(cleanupToken);
        cleanupToken.writeId = 'changed';
        releaseCleanup();
        assert.deepEqual(await cleanup, { status: 'removed' });
    });

    it('requires locks for mutation and never retries rejected locks without one', async () => {
        for (const getLocks of [
            () => undefined,
            () => ({
                request: async () => {
                    throw new Error('Denied lock');
                },
            }),
        ]) {
            const h = setup({ getLocks });
            assert.deepEqual(
                await h.owner.write({
                    expected: null,
                    values: { title: 'Keep' },
                }),
                { status: 'unavailable' }
            );
            assert.deepEqual(await h.owner.remove(arbitraryToken()), {
                status: 'unavailable',
            });
            assert.equal(
                h.state.storage +
                    h.local.reads +
                    h.local.writes +
                    h.local.removals +
                    h.state.ids,
                0
            );
        }
    });

    it('preserves invalid bytes and refuses both replacement and cleanup', async () => {
        for (const bytes of [
            '{broken',
            '{}',
            '{"title":"legacy"}',
            '{"kind":"miniExtensions-sdk-create-progress","version":2,"draftId":"d","writeId":"w","values":{}}',
        ]) {
            const h = setup();
            h.local.bytes.set(lockName('opaque-synthetic-create'), bytes);
            assert.deepEqual(h.owner.read(), { status: 'invalid' });
            assert.deepEqual(
                await h.owner.write({
                    expected: null,
                    values: { title: 'Would replace invalid bytes' },
                }),
                { status: 'invalid' }
            );
            assert.deepEqual(await h.owner.remove(arbitraryToken()), {
                status: 'invalid',
            });
            assert.equal(
                h.local.bytes.get(lockName('opaque-synthetic-create')),
                bytes
            );
            assert.equal(h.local.writes + h.local.removals, 0);
        }
    });

    it('rejects non-scalar values before acquiring locks or accessing storage', async () => {
        for (const cell of [
            undefined,
            NaN,
            Infinity,
            -Infinity,
            {},
            [],
            new Date(0),
            () => 'value',
            Symbol('value'),
            1n,
        ]) {
            const h = setup();
            assert.deepEqual(
                await h.owner.write({
                    expected: null,
                    values: { field: cell } as unknown as FormProgressValues,
                }),
                { status: 'invalid' }
            );
            assert.equal(h.state.storage + h.state.locks + h.state.ids, 0);
        }
        const h = setup();
        const values = { [Symbol('hidden loss')]: 'not representable' };
        assert.deepEqual(await h.owner.write({ expected: null, values }), {
            status: 'invalid',
        });
        assert.equal(h.state.storage + h.state.locks, 0);
    });

    it('copies only own enumerable scalar fields and never reads inherited values', async () => {
        const h = setup();
        const values = Object.create({
            inherited: 'must not persist',
        }) as FormProgressValues;
        Object.defineProperty(values, 'nonenumerable', {
            value: 'must not persist',
        });
        values.own = false;
        assert.deepEqual(
            written(await h.owner.write({ expected: null, values })).values,
            { own: false }
        );
        assert.deepEqual(read(h.owner.read())!.values, { own: false });
    });

    it('rejects malformed tokens without touching storage or locks', async () => {
        for (const token of [
            undefined,
            {},
            { draftId: '', writeId: 'w' },
            { draftId: 'd', writeId: 2 },
            { draftId: 'same', writeId: 'same' },
            Object.create(arbitraryToken()),
        ]) {
            const h = setup();
            assert.deepEqual(
                await h.owner.write({
                    expected: token as FormProgressToken,
                    values: {},
                }),
                { status: 'invalid' }
            );
            assert.deepEqual(await h.owner.remove(token as FormProgressToken), {
                status: 'invalid',
            });
            assert.equal(h.state.storage + h.state.locks + h.state.ids, 0);
        }
    });

    it('refuses blank or reused generated identities without changing stored bytes', async () => {
        for (const id of ['', ' ', 'same']) {
            const h = setup({ createId: () => id });
            assert.deepEqual(
                await h.owner.write({ expected: null, values: {} }),
                { status: 'invalid' }
            );
            assert.equal(h.local.writes, 0);
        }
        const ids = ['d', 'w', 'w'];
        const h = setup({ createId: () => ids.shift()! });
        const first = written(
            await h.owner.write({ expected: null, values: { title: 'Keep' } })
        );
        assert.deepEqual(
            await h.owner.write({
                expected: first.token,
                values: { title: 'Lost' },
            }),
            { status: 'invalid' }
        );
        assert.deepEqual(read(h.owner.read()), first);
    });

    it('fails closed on denied reads and proves each operation reached that boundary', async () => {
        const local = new MemoryStorage();
        const key = lockName('opaque-synthetic-create');
        local.bytes.set(key, 'foreign bytes');
        let deniedReads = 0;
        const h = setup({
            getStorage: () => ({
                getItem: () => {
                    deniedReads++;
                    throw new Error('Denied private storage read');
                },
                setItem: (...args) => local.setItem(...args),
                removeItem: (...args) => local.removeItem(...args),
            }),
        });
        assert.deepEqual(h.owner.read(), { status: 'unavailable' });
        assert.deepEqual(await h.owner.write({ expected: null, values: {} }), {
            status: 'unavailable',
        });
        assert.deepEqual(await h.owner.remove(arbitraryToken()), {
            status: 'unavailable',
        });
        assert.equal(deniedReads, 3);
        assert.equal(local.writes + local.removals, 0);
        assert.equal(local.bytes.get(key), 'foreign bytes');
    });

    it('contains quota and removal errors without leaking their text or retrying', async () => {
        const h = setup();
        const snapshot = written(
            await h.owner.write({ expected: null, values: { title: 'Keep' } })
        );
        let writes = 0;
        let removals = 0;
        const replacement = setup({
            createId: () => 'distinct-write-id',
            getStorage: () => ({
                getItem: (key) => h.local.getItem(key),
                setItem: () => {
                    writes++;
                    throw new Error('Private quota detail');
                },
                removeItem: () => {
                    removals++;
                    throw new Error('Private remove detail');
                },
            }),
        }).owner;
        assert.deepEqual(
            await replacement.write({
                expected: snapshot.token,
                values: { title: 'New' },
            }),
            { status: 'unavailable' }
        );
        assert.deepEqual(await replacement.remove(snapshot.token), {
            status: 'unavailable',
        });
        assert.equal(writes, 1);
        assert.equal(removals, 1);
        assert.deepEqual(read(h.owner.read()), snapshot);
    });

    it('selects one storage adapter for the entire locked operation', async () => {
        const h = setup();
        const other = new MemoryStorage();
        let resolves = 0;
        const owner = setup({
            getStorage: () => (++resolves === 1 ? h.local : other),
        }).owner;
        written(
            await owner.write({
                expected: null,
                values: { title: 'One adapter' },
            })
        );
        assert.equal(resolves, 1);
        assert.equal(h.local.reads, 1);
        assert.equal(h.local.writes, 1);
        assert.equal(other.reads + other.writes, 0);
    });

    it('destroy retires queued writes and cleanup before either resolves storage', async () => {
        const h = setup();
        const first = written(
            await h.owner.write({ expected: null, values: { title: 'Keep' } })
        );
        const before = h.state.storage;
        const release = h.locks.hold(lockName('opaque-synthetic-create'));
        const write = h.owner.write({
            expected: first.token,
            values: { title: 'Retired' },
        });
        const remove = h.owner.remove(first.token);
        h.owner.destroy();
        release();
        assert.deepEqual(await write, { status: 'retired' });
        assert.deepEqual(await remove, { status: 'retired' });
        assert.equal(h.state.storage, before);
        assert.equal(
            JSON.parse([...h.local.bytes.values()][0]!).values.title,
            'Keep'
        );
    });

    it('permanently retires queued work after an observed owner/session change, including restoration', async () => {
        const h = setup();
        const release = h.locks.hold(lockName('opaque-synthetic-create'));
        const pending = h.owner.write({
            expected: null,
            values: { title: 'Old session' },
        });
        h.state.current = false;
        release();
        assert.deepEqual(await pending, { status: 'retired' });
        h.state.current = true;
        assert.deepEqual(h.owner.read(), { status: 'retired' });
        assert.equal(h.state.storage + h.local.writes, 0);
    });

    it('contains throwing or reentrant owner checks without recursive reads', () => {
        const throwing = setup({
            isCurrent: () => {
                throw new Error('Private session error');
            },
        });
        assert.deepEqual(throwing.owner.read(), { status: 'retired' });
        assert.equal(throwing.state.storage, 0);
        let owner!: FormProgressStorage;
        let checks = 0;
        owner = setup({
            isCurrent: () => {
                checks++;
                assert.deepEqual(owner.read(), { status: 'retired' });
                return true;
            },
        }).owner;
        assert.deepEqual(owner.read(), { status: 'retired' });
        assert.equal(checks, 1);
    });

    it('checks ownership after scalar getters and token getters before queueing', async () => {
        const h = setup();
        const values = {
            get title() {
                h.state.current = false;
                return 'Old owner';
            },
        };
        assert.deepEqual(await h.owner.write({ expected: null, values }), {
            status: 'retired',
        });
        assert.equal(h.state.locks + h.state.storage, 0);
        const other = setup();
        const token = {
            get draftId() {
                other.owner.destroy();
                return 'd';
            },
            writeId: 'w',
        };
        assert.deepEqual(await other.owner.remove(token), {
            status: 'retired',
        });
        assert.equal(other.state.locks + other.state.storage, 0);
    });

    it('refuses caller reentry from a values getter rather than recursively mutating storage', async () => {
        const h = setup();
        const values = {
            get title() {
                assert.deepEqual(h.owner.read(), { status: 'retired' });
                return 'No write';
            },
        };
        assert.deepEqual(await h.owner.write({ expected: null, values }), {
            status: 'retired',
        });
        assert.equal(h.state.storage + h.state.locks, 0);
    });

    it('rechecks a lock resolver and a storage resolver before any storage call', async () => {
        const state = { current: true };
        let requests = 0;
        const h = setup({
            isCurrent: () => state.current,
            getLocks: () => {
                state.current = false;
                return {
                    request: async (_name, callback) => {
                        requests++;
                        return callback();
                    },
                };
            },
        });
        assert.deepEqual(await h.owner.write({ expected: null, values: {} }), {
            status: 'retired',
        });
        assert.equal(requests + h.state.storage, 0);
        let current = true;
        const local = new MemoryStorage();
        const other = setup({
            isCurrent: () => current,
            getStorage: () => {
                current = false;
                return local;
            },
        });
        assert.deepEqual(
            await other.owner.write({ expected: null, values: {} }),
            { status: 'retired' }
        );
        assert.equal(local.reads + local.writes, 0);
    });

    it('rechecks ownership after a storage read and identity generation before mutation', async () => {
        const local = new MemoryStorage();
        let current = true;
        const reading = setup({
            isCurrent: () => current,
            getStorage: () => ({
                getItem: (key) => {
                    current = false;
                    return local.getItem(key);
                },
                setItem: (...args) => local.setItem(...args),
                removeItem: (...args) => local.removeItem(...args),
            }),
        });
        assert.deepEqual(
            await reading.owner.write({ expected: null, values: {} }),
            { status: 'retired' }
        );
        assert.equal(local.reads, 1);
        assert.equal(local.writes + local.removals, 0);
        const generating = setup({
            createId: () => {
                generating.owner.destroy();
                return 'fresh';
            },
        });
        assert.deepEqual(
            await generating.owner.write({ expected: null, values: {} }),
            { status: 'retired' }
        );
        assert.equal(generating.local.writes, 0);
    });

    it('rechecks ownership after serialization and before calling a setter', async () => {
        const h = setup();
        const stringify = JSON.stringify;
        let serialized = 0;
        JSON.stringify = ((value: unknown) => {
            serialized++;
            h.owner.destroy();
            return stringify(value);
        }) as typeof JSON.stringify;
        try {
            assert.deepEqual(
                await h.owner.write({
                    expected: null,
                    values: { title: 'No commit' },
                }),
                { status: 'retired' }
            );
        } finally {
            JSON.stringify = stringify;
        }
        assert.equal(serialized, 1);
        assert.equal(h.local.writes, 0);
        const local = new MemoryStorage();
        let owner!: FormProgressStorage;
        owner = setup({
            getStorage: () => ({
                getItem: (key) => local.getItem(key),
                get setItem() {
                    owner.destroy();
                    return (key: string, bytes: string) =>
                        local.setItem(key, bytes);
                },
                removeItem: (key) => local.removeItem(key),
            }),
        }).owner;
        assert.deepEqual(await owner.write({ expected: null, values: {} }), {
            status: 'retired',
        });
        assert.equal(local.writes, 0);
    });

    it('does not accept a lock promise that skipped its critical section or replay a rejected callback', async () => {
        const skipped = setup({
            getLocks: () => ({
                request: async <Result>() => ({ status: 'written' }) as Result,
            }),
        });
        assert.deepEqual(
            await skipped.owner.write({ expected: null, values: {} }),
            { status: 'unavailable' }
        );
        assert.equal(skipped.state.storage, 0);
        let late!: () => unknown;
        const h = setup({
            getLocks: () => ({
                request: async (_name, callback) => {
                    late = callback;
                    throw new Error('Denied before admission');
                },
            }),
        });
        assert.deepEqual(await h.owner.write({ expected: null, values: {} }), {
            status: 'unavailable',
        });
        assert.deepEqual(late(), { status: 'retired' });
        assert.equal(h.state.storage + h.local.writes, 0);
    });
});
