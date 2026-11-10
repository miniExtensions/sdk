import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import {
    createFormSaveCoordinator,
    type FormSaveCoordinator,
    type FormSaveInvocation,
} from '../src/forms/index.js';

// Use the native adapter's exact lodash equality, including dirty-ID order.
const isEqual: (a: unknown, b: unknown) => boolean = createRequire(
    import.meta.url
)('lodash/isEqual.js');
type Snapshot = {
    formRecord:
        | { type: 'create'; data: Record<string, string> }
        | {
              type: 'edit';
              recordId: string;
              tableId: string;
              data: Record<string, string>;
          };
    formFieldIdsWithUnsavedChanges: string[];
} | null;
type Invocation = FormSaveInvocation<object, Snapshot>;
const deferred = () => {
    let resolve!: (value?: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const snapshot = (
    value = 'A',
    mode: 'create' | 'edit' = 'edit',
    dirty = ['first']
): Snapshot => ({
    formRecord:
        mode === 'create'
            ? { type: mode, data: { first: value, second: 'Adjacent' } }
            : {
                  type: mode,
                  recordId: 'rec_original',
                  tableId: 'tbl_original',
                  data: { first: value, second: 'Adjacent' },
              },
    formFieldIdsWithUnsavedChanges: dirty,
});

/**
 * Frozen scheduling oracle: native preventConcurrentSaves at d340f6f8,
 * saveOrComputeForm.ts lines 440–475. Only host inputs are parameterized.
 * Separate assertions below specify outcomes as well as differential traces.
 */
const legacy = (): FormSaveCoordinator<object, Snapshot> => {
    const active = new Map<
        object,
        { promise: Promise<unknown>; snapshot: Snapshot }
    >();
    const run = async (invocation: Invocation): Promise<void> => {
        const current = invocation.readSnapshot();
        const pending = active.get(invocation.sessionKey);
        if (pending != null) {
            if (isEqual(pending.snapshot, current)) return;
            try {
                await pending.promise;
            } catch {}
            await run(invocation);
            return;
        }
        const promise = invocation.allocate();
        active.set(invocation.sessionKey, { promise, snapshot: current });
        try {
            await promise;
        } finally {
            if (active.get(invocation.sessionKey)?.promise === promise)
                active.delete(invocation.sessionKey);
        }
    };
    return { run };
};
const extracted = () =>
    createFormSaveCoordinator<object, Snapshot>({ isEqual });

for (const [name, create] of [
    ['native scheduling oracle', legacy],
    ['public SDK coordinator', extracted],
] as const) {
    describe(name, () => {
        for (const mode of ['create', 'edit', null] as const) {
            it(`completes equal ${mode} intent before the original settles`, async () => {
                const coordinator = create();
                const key = {};
                const pending = deferred();
                let calls = 0;
                const run = () =>
                    coordinator.run({
                        sessionKey: key,
                        readSnapshot: () =>
                            mode === null ? null : snapshot('A', mode),
                        allocate: () => {
                            calls++;
                            return pending.promise;
                        },
                    });
                const original = run();
                assert.equal(calls, 1, 'allocation is synchronous');
                await run();
                assert.equal(calls, 1);
                pending.resolve();
                assert.equal(await original, undefined);
            });
        }
        it('retains the original rejection and coalesces three explicit waiters to latest state', async () => {
            const coordinator = create();
            const key = {};
            let current = snapshot();
            const first = deferred();
            const latest = deferred();
            const entered = deferred();
            const payloads: Snapshot[] = [];
            const invoke = () =>
                coordinator.run({
                    sessionKey: key,
                    readSnapshot: () => current,
                    allocate: () => {
                        payloads.push(current);
                        if (payloads.length === 1) return first.promise;
                        entered.resolve();
                        return latest.promise;
                    },
                });
            const error = new Error('synthetic escaped allocation');
            const original = invoke();
            const rejected = assert.rejects(original, (e) => e === error);
            current = snapshot('B');
            const second = invoke();
            current = snapshot('C');
            const third = invoke();
            current = snapshot('D');
            const fourth = invoke();
            current = snapshot('LATEST');
            first.reject(error);
            await rejected;
            await entered.promise;
            await Promise.all([third, fourth]);
            assert.deepEqual(payloads, [snapshot(), snapshot('LATEST')]);
            latest.resolve();
            await second;
        });
        for (const change of [
            'dirty-only',
            'dirty-order',
            'record-identity',
        ] as const) {
            it(`waits for ${change} and reads again rather than replaying captured intent`, async () => {
                const coordinator = create();
                const key = {};
                const first = deferred();
                let current = snapshot('A', 'edit', ['first', 'second']);
                let calls = 0;
                const invoke = () =>
                    coordinator.run({
                        sessionKey: key,
                        readSnapshot: () => current,
                        allocate: () => {
                            calls++;
                            return calls === 1
                                ? first.promise
                                : Promise.resolve();
                        },
                    });
                const original = invoke();
                if (change === 'record-identity') {
                    current = snapshot('A', 'create', ['first', 'second']);
                } else
                    current = snapshot(
                        'A',
                        'edit',
                        change === 'dirty-only'
                            ? ['first']
                            : ['second', 'first']
                    );
                const changed = invoke();
                assert.equal(calls, 1);
                first.resolve();
                await Promise.all([original, changed]);
                assert.equal(calls, 2);
            });
        }
        it('never retries on its own and permits explicit correction after rejection or synchronous throw', async () => {
            const coordinator = create();
            const key = {};
            const error = new Error('synthetic failed allocation');
            let calls = 0;
            const invoke = (allocate: Invocation['allocate']) =>
                coordinator.run({
                    sessionKey: key,
                    readSnapshot: () => snapshot(),
                    allocate: () => {
                        calls++;
                        return allocate();
                    },
                });
            await assert.rejects(
                invoke(() => {
                    throw error;
                }),
                (e) => e === error
            );
            assert.equal(calls, 1);
            const first = deferred();
            const original = invoke(() => first.promise);
            const rejected = assert.rejects(original, (e) => e === error);
            await invoke(() => assert.fail('equal pending must not allocate'));
            first.reject(error);
            await rejected;
            assert.equal(calls, 2);
            await invoke(() => Promise.resolve());
            assert.equal(calls, 3);
        });
        it('runs a final gate after waiting; refusal is void without allocating and fresh correction remains possible', async () => {
            const coordinator = create();
            const key = {};
            const first = deferred();
            let current = snapshot();
            let admitted = true;
            let gates = 0;
            let requests = 0;
            const invoke = () =>
                coordinator.run({
                    sessionKey: key,
                    readSnapshot: () => current,
                    allocate: () => {
                        gates++;
                        if (!admitted) return Promise.resolve();
                        requests++;
                        return requests === 1
                            ? first.promise
                            : Promise.resolve();
                    },
                });
            const original = invoke();
            current = snapshot('changed');
            const changed = invoke();
            admitted = false;
            assert.equal(gates, 1);
            first.resolve();
            await Promise.all([original, changed]);
            assert.equal(gates, 2);
            assert.equal(requests, 1);
            admitted = true;
            await invoke();
            assert.equal(requests, 2);
        });
        it('isolates session key identity and coordinator instances', async () => {
            const first = create();
            const second = create();
            const key = {};
            const pending = deferred();
            let calls = 0;
            const invocation = (sessionKey: object) => ({
                sessionKey,
                readSnapshot: () => snapshot(),
                allocate: () => {
                    calls++;
                    return pending.promise;
                },
            });
            const operations = [
                first.run(invocation(key)),
                first.run(invocation({})),
                second.run(invocation(key)),
            ];
            assert.equal(calls, 3);
            pending.resolve();
            await Promise.all(operations);
        });
        it('compare-clears only the promise it registered, preserving allocated replacement work', async () => {
            const coordinator = create();
            const key = {};
            const outer = deferred();
            const nested = deferred();
            let inner!: Promise<void>;
            const original = coordinator.run({
                sessionKey: key,
                readSnapshot: () => snapshot('outer'),
                allocate: () => {
                    inner = coordinator.run({
                        sessionKey: key,
                        readSnapshot: () => snapshot('inner'),
                        allocate: () => nested.promise,
                    });
                    return outer.promise;
                },
            });
            nested.resolve();
            await inner;
            await coordinator.run({
                sessionKey: key,
                readSnapshot: () => snapshot('outer'),
                allocate: () =>
                    assert.fail('nested cleanup must not clear outer'),
            });
            outer.resolve();
            await original;
        });
    });
}

it('matches native continuation traces including duplicate completion and wait recursion', async () => {
    const trace = async (create: typeof legacy) => {
        const coordinator = create();
        const pending = deferred();
        const next = deferred();
        const key = {};
        const events: string[] = [];
        let current = snapshot();
        let calls = 0;
        const invoke = (label: string) =>
            coordinator
                .run({
                    sessionKey: key,
                    readSnapshot: () => {
                        events.push(`read:${label}`);
                        return current;
                    },
                    allocate: () => {
                        events.push(`allocate:${label}`);
                        return ++calls === 1 ? pending.promise : next.promise;
                    },
                })
                .then(() => {
                    events.push(`done:${label}`);
                });
        const original = invoke('original');
        await invoke('duplicate');
        current = snapshot('B');
        const changed = invoke('changed');
        const equalChanged = invoke('equal-changed');
        pending.resolve();
        await original;
        await equalChanged;
        next.resolve();
        await changed;
        return events;
    };
    const expected = await trace(legacy);
    assert.deepEqual(await trace(extracted), expected);
    assert.deepEqual(expected.slice(0, 5), [
        'read:original',
        'allocate:original',
        'read:duplicate',
        'done:duplicate',
        'read:changed',
    ]);
});
