import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    createBorrowedButtonActionController,
    type BorrowedButtonActionController,
    type BorrowedButtonActionOptions,
    type BorrowedButtonContext,
    type BorrowedButtonTransportOutcome,
} from '../src/ui/borrowedButtonActionController.js';
const held = <T>() => {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const setup = (
    change: Partial<BorrowedButtonActionOptions<object, object, object>> = {}
) => {
    const owner = {},
        request = {},
        receipt = {},
        value = {};
    let context: BorrowedButtonContext | null = {
        owner,
        revision: 1,
        visible: true,
        available: true,
    };
    let permitted = true,
        changed = () => {},
        allocations = 0,
        unsubscribed = 0;
    const settlements: Array<{
        receipt: object;
        outcome: BorrowedButtonTransportOutcome<object>;
        current: boolean;
    }> = [];
    const options: BorrowedButtonActionOptions<object, object, object> = {
        readContext: () => context,
        subscribe: (notify) => {
            changed = notify;
            return () => {
                unsubscribed++;
            };
        },
        mayStartNewIntent: () => permitted,
        captureIntent: () => ({ request, receipt }),
        allocate: async (native) => {
            assert.equal(native, request);
            allocations++;
            return value;
        },
        settleAllocated: (native, outcome, feedback) => {
            settlements.push({
                receipt: native,
                outcome,
                current: feedback.isCurrent(),
            });
        },
        ...change,
    };
    const model = createBorrowedButtonActionController(options);
    return {
        model,
        options,
        owner,
        request,
        receipt,
        value,
        settlements,
        get allocations() {
            return allocations;
        },
        get unsubscribed() {
            return unsubscribed;
        },
        setContext(value: BorrowedButtonContext | null) {
            context = value;
            changed();
        },
        setPermitted(value: boolean) {
            permitted = value;
            changed();
        },
        context: () => context,
    };
};
it('has no implicit dispatch and retains opaque native request/receipt/result identities', async () => {
    let privateReads = 0;
    const request = Object.defineProperty({}, 'private', {
            get() {
                privateReads++;
                throw Error('opaque request');
            },
        }),
        receipt = {},
        value = { file: new Blob(['native']), date: new Date(0) };
    const seen: unknown[] = [];
    const f = setup({
        captureIntent: () => ({ request, receipt }),
        allocate: async (input) => {
            seen.push(input);
            return value;
        },
        settleAllocated: (r, o) => {
            seen.push(r, o);
        },
    });
    assert.equal(f.allocations, 0);
    assert.equal(f.model.getSnapshot().canTrigger, true);
    const answer = await f.model.trigger();
    assert.equal(answer.type, 'settled');
    if (answer.type !== 'settled') throw Error('Expected settlement');
    assert.equal(answer.outcome.type, 'resolved');
    if (answer.outcome.type === 'resolved')
        assert.equal(answer.outcome.value, value);
    assert.equal(seen[0], request);
    assert.equal(seen[1], receipt);
    assert.equal(seen[2], answer.outcome);
    assert.equal(privateReads, 0);
    assert.equal(answer.settlementFailure, null);
    f.model.dispose();
});
it('keeps native false reports and original errors opaque, allowing only explicit next-click retry', async () => {
    const value = { success: false },
        error = {},
        outcomes: unknown[] = [];
    let calls = 0;
    const f = setup({
        allocate: () => {
            calls++;
            return calls === 2 ? Promise.reject(error) : Promise.resolve(value);
        },
        settleAllocated: (_r, o) => {
            outcomes.push(o);
        },
    });
    const first = await f.model.trigger();
    assert.equal(calls, 1);
    assert.equal(first.type, 'settled');
    const second = await f.model.trigger();
    assert.equal(second.type, 'settled');
    if (second.type === 'settled' && second.outcome.type === 'rejected')
        assert.equal(second.outcome.error, error);
    else assert.fail('Expected native rejection');
    await f.model.trigger();
    assert.equal(calls, 3);
    assert.equal(outcomes.length, 3);
    f.model.dispose();
});
it('settles a synchronous allocation error exactly once with its original identity', async () => {
    const error = {};
    const f = setup({
        allocate: () => {
            throw error;
        },
    });
    const a = await f.model.trigger();
    assert.equal(a.type, 'settled');
    if (a.type === 'settled') {
        assert.equal(a.outcome.type, 'rejected');
        if (a.outcome.type === 'rejected') {
            assert.equal(a.outcome.phase, 'allocation');
            assert.equal(a.outcome.error, error);
        }
    }
    assert.equal(f.settlements.length, 1);
    f.model.dispose();
});
for (const change of [
    'dispose',
    'owner',
    'revision',
    'context absent',
] as const)
    for (const rejected of [false, true])
        it(`settles allocated ${rejected ? 'rejection' : 'success'} exactly once after ${change}`, async () => {
            const pending = held<object>(),
                value = {},
                error = {};
            let calls = 0;
            const f = setup({
                allocate: () => {
                    calls++;
                    return pending.promise;
                },
            });
            const running = f.model.trigger();
            assert.equal((await f.model.trigger()).type, 'refused');
            if (change === 'dispose') f.model.dispose();
            else
                f.setContext(
                    change === 'context absent'
                        ? null
                        : {
                              owner: change === 'owner' ? {} : f.owner,
                              revision: change === 'revision' ? 2 : 1,
                              visible: true,
                              available: true,
                          }
                );
            if (rejected) pending.reject(error);
            else pending.resolve(value);
            const a = await running;
            assert.equal(a.type, 'settled');
            if (a.type === 'settled') {
                assert.equal(a.settlementFailure, null);
                if (a.outcome.type === 'resolved')
                    assert.equal(a.outcome.value, value);
                else assert.equal(a.outcome.error, error);
            }
            assert.equal(f.settlements.length, 1);
            assert.equal(f.settlements[0].current, false);
            assert.equal((await f.model.trigger()).type, 'refused');
            assert.equal(calls, 1);
            f.model.dispose();
        });
it('holds the singleflight slot through async host settlement and final notification', async () => {
    const settlement = held<void>();
    let calls = 0;
    const nested: Array<Promise<unknown>> = [];
    const f = setup({
        allocate: async () => {
            calls++;
            return {};
        },
        settleAllocated: () => settlement.promise,
    });
    f.model.subscribe((s) => {
        if (s.phase === 'settled') nested.push(f.model.trigger());
    });
    const running = f.model.trigger();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(f.model.getSnapshot().busy, true);
    assert.equal((await f.model.trigger()).type, 'refused');
    settlement.resolve();
    await running;
    assert.equal(f.model.getSnapshot().busy, false);
    assert.equal(f.model.getSnapshot().canTrigger, true);
    assert.equal(nested.length, 1);
    assert.equal(((await nested[0]) as { type: string }).type, 'refused');
    assert.equal(calls, 1);
    f.model.dispose();
});
for (const port of [
    'read',
    'recovery',
    'capture',
    'allocate',
    'settle',
    'pending',
    'settling',
    'settled',
] as const)
    it(`blocks reentrant dispatch from ${port} without losing original settlement`, async () => {
        const nested: Array<Promise<{ type: string }>> = [];
        let model: BorrowedButtonActionController<object> | undefined,
            calls = 0,
            observed = 0;
        const owner = {};
        const reenter = () => {
            if (model) {
                observed++;
                nested.push(model.trigger());
            }
        };
        model = createBorrowedButtonActionController({
            readContext: () => {
                if (port === 'read') reenter();
                return { owner, revision: 1, visible: true, available: true };
            },
            subscribe: () => () => {},
            mayStartNewIntent: () => {
                if (port === 'recovery') reenter();
                return true;
            },
            captureIntent: () => {
                if (port === 'capture') reenter();
                return { request: {}, receipt: {} };
            },
            allocate: async () => {
                if (port === 'allocate') reenter();
                calls++;
                return {};
            },
            settleAllocated: () => {
                if (port === 'settle') reenter();
            },
        });
        model.subscribe((s) => {
            if (s.phase === port) reenter();
        });
        await model.trigger();
        assert.ok(observed > 0);
        assert.ok(
            (await Promise.all(nested)).every((a) => a.type === 'refused')
        );
        assert.equal(calls, 1);
        model.dispose();
    });
for (const key of ['owner', 'revision', 'visible', 'available'] as const)
    for (const rejected of [false, true])
        it(`observes real ${key} getter faults without vetoing allocated ${rejected ? 'rejection' : 'success'}`, async () => {
            let armed = false,
                faults = 0;
            const error = {},
                value = {},
                pending = held<object>(),
                owner = {};
            const f = setup({
                readContext: () => {
                    const data = {
                        owner,
                        revision: 1,
                        visible: true,
                        available: true,
                    };
                    const original = data[key];
                    Object.defineProperty(data, key, {
                        get() {
                            if (armed) {
                                faults++;
                                throw Error('Synthetic presentation getter');
                            }
                            return original;
                        },
                    });
                    return data;
                },
                allocate: () => pending.promise,
                settleAllocated: (receipt, outcome) => {
                    assert.ok(
                        faults > 0,
                        'Expected observed getter fault before settlement'
                    );
                    f.settlements.push({ receipt, outcome, current: false });
                },
            });
            f.model.subscribe(() => {});
            const running = f.model.trigger();
            armed = true;
            if (rejected) pending.reject(error);
            else pending.resolve(value);
            const a = await running;
            assert.ok(faults > 0);
            assert.equal(f.settlements.length, 1);
            assert.equal(a.type, 'settled');
            if (a.type === 'settled') {
                assert.equal(a.settlementFailure, null);
                if (a.outcome.type === 'resolved')
                    assert.equal(a.outcome.value, value);
                else assert.equal(a.outcome.error, error);
            }
            f.model.dispose();
        });
for (const phase of ['pending', 'settling', 'settled'] as const)
    for (const rejected of [false, true])
        it(`contains an observed throwing ${phase} listener during allocated ${rejected ? 'rejection' : 'success'}`, async () => {
            let faults = 0;
            const error = {},
                value = {};
            const f = setup({
                allocate: () =>
                    rejected ? Promise.reject(error) : Promise.resolve(value),
            });
            f.model.subscribe((s) => {
                if (s.phase === phase) {
                    faults++;
                    throw Error('Synthetic listener');
                }
            });
            const a = await f.model.trigger();
            assert.ok(faults > 0);
            assert.equal(f.settlements.length, 1);
            assert.equal(a.type, 'settled');
            if (a.type === 'settled') assert.equal(a.settlementFailure, null);
            f.model.dispose();
        });
for (const reason of [
    'hidden',
    'unavailable',
    'recovery false',
    'recovery throws',
    'capture null',
    'capture throws',
] as const)
    it(`refuses ${reason} before native allocation, with current recovery`, async () => {
        let allowed = false,
            captures = 0,
            reads = 0;
        const owner = {};
        const model = createBorrowedButtonActionController({
            readContext: () => ({
                owner,
                revision: 1,
                visible: reason === 'hidden' ? allowed : true,
                available: reason === 'unavailable' ? allowed : true,
            }),
            subscribe: () => () => {},
            mayStartNewIntent: () => {
                if (reason === 'recovery throws' && !allowed)
                    throw Error('Recovery unavailable');
                return reason === 'recovery false' ? allowed : true;
            },
            captureIntent: () => {
                captures++;
                if (reason === 'capture throws' && !allowed)
                    throw Error('Capture unavailable');
                if (reason === 'capture null' && !allowed) return null;
                return { request: {}, receipt: {} };
            },
            allocate: async () => {
                reads++;
                return {};
            },
            settleAllocated: () => {},
        });
        assert.equal((await model.trigger()).type, 'refused');
        assert.equal(reads, 0);
        if (
            [
                'hidden',
                'unavailable',
                'recovery false',
                'recovery throws',
            ].includes(reason)
        )
            assert.equal(captures, 0);
        allowed = true;
        assert.equal((await model.trigger()).type, 'settled');
        assert.equal(reads, 1);
        model.dispose();
    });
for (const change of [
    'owner',
    'revision',
    'recovery',
    'availability',
    'dispose',
] as const)
    it(`rechecks ${change} after pending notification before allocation`, async () => {
        let owner: object = {},
            revision = 1,
            available = true,
            allowed = true,
            calls = 0;
        let model: BorrowedButtonActionController<object>;
        model = createBorrowedButtonActionController({
            readContext: () => ({ owner, revision, visible: true, available }),
            subscribe: () => () => {},
            mayStartNewIntent: () => allowed,
            captureIntent: () => ({ request: {}, receipt: {} }),
            allocate: async () => {
                calls++;
                return {};
            },
            settleAllocated: () => {},
        });
        model.subscribe((s) => {
            if (s.phase !== 'pending') return;
            if (change === 'owner') owner = {};
            if (change === 'revision') revision++;
            if (change === 'recovery') allowed = false;
            if (change === 'availability') available = false;
            if (change === 'dispose') model.dispose();
        });
        assert.equal((await model.trigger()).type, 'refused');
        assert.equal(calls, 0);
        model.dispose();
    });
it('preserves original transport outcome when host settlement rejects or throws', async () => {
    const transport = {},
        settlement = {};
    const f = setup({
        allocate: () => Promise.reject(transport),
        settleAllocated: () => Promise.reject(settlement),
    });
    const a = await f.model.trigger();
    assert.equal(a.type, 'settled');
    if (a.type === 'settled') {
        assert.equal(a.settlementFailure?.error, settlement);
        if (a.outcome.type === 'rejected')
            assert.equal(a.outcome.error, transport);
        else assert.fail('Expected transport error');
    }
    f.model.dispose();
});
it('permanently retires observed revision ABA while preserving unrelated same-owner notifications', async () => {
    const f = setup();
    f.setContext({
        owner: f.owner,
        revision: 1,
        visible: true,
        available: true,
    });
    assert.equal((await f.model.trigger()).type, 'settled');
    f.setContext({
        owner: f.owner,
        revision: 2,
        visible: true,
        available: true,
    });
    f.setContext({
        owner: f.owner,
        revision: 1,
        visible: true,
        available: true,
    });
    assert.equal((await f.model.trigger()).type, 'refused');
    assert.equal(f.allocations, 1);
    f.model.dispose();
});
it('contains subscription and cleanup faults without allocating or changing native results', async () => {
    const f = setup({
        subscribe: () => {
            throw Error('Subscription unavailable');
        },
    });
    assert.equal((await f.model.trigger()).type, 'refused');
    f.model.dispose();
    const other = setup({
        subscribe: () => () => {
            throw Error('Cleanup unavailable');
        },
    });
    await other.model.trigger();
    other.model.dispose();
    other.model.dispose();
    assert.equal(other.settlements.length, 1);
});

for (const owner of ['native-host', 0, () => {}])
    it(`accepts an opaque ${typeof owner} owner without inspecting it`, async () => {
        const f = setup({
            readContext: () => ({
                owner,
                revision: 'native-epoch',
                visible: true,
                available: true,
            }),
        });
        assert.equal((await f.model.trigger()).type, 'settled');
        f.model.dispose();
    });
for (const patch of [
    { owner: null },
    { owner: '' },
    { owner: Number.NaN },
    { revision: Number.NaN },
    { revision: false },
    { visible: 'yes' },
    { available: 1 },
])
    it(`fails closed on malformed context metadata ${JSON.stringify(patch)}`, async () => {
        const f = setup({
            readContext: () =>
                ({
                    owner: {},
                    revision: 1,
                    visible: true,
                    available: true,
                    ...patch,
                }) as unknown as BorrowedButtonContext,
        });
        assert.equal(f.model.getSnapshot().canTrigger, false);
        assert.equal((await f.model.trigger()).type, 'refused');
        assert.equal(f.allocations, 0);
        f.model.dispose();
    });
it('fails closed on an initial reader exception or malformed subscription result', async () => {
    const f = setup({
        readContext: () => {
            throw Error('Unavailable native context');
        },
    });
    assert.equal((await f.model.trigger()).type, 'refused');
    f.model.dispose();
    const other = setup({
        subscribe: () => undefined as unknown as () => void,
    });
    assert.equal((await other.model.trigger()).type, 'refused');
    other.model.dispose();
});
for (const key of ['request', 'receipt'] as const)
    it(`preserves original capture ${key} getter error before any allocation`, async () => {
        const error = {},
            intent = { request: {}, receipt: {} };
        Object.defineProperty(intent, key, {
            get() {
                throw error;
            },
        });
        const f = setup({ captureIntent: () => intent });
        const result = await f.model.trigger();
        assert.equal(result.type, 'refused');
        if (result.type === 'refused') assert.equal(result.error, error);
        assert.equal(f.allocations, 0);
        assert.equal(f.settlements.length, 0);
        f.model.dispose();
    });
it('revalidates retirement caused by capture before allocation', async () => {
    let revision = 1;
    const owner = {};
    let allocations = 0;
    const model = createBorrowedButtonActionController({
        readContext: () => ({
            owner,
            revision,
            visible: true,
            available: true,
        }),
        subscribe: () => () => {},
        mayStartNewIntent: () => true,
        captureIntent: () => {
            revision++;
            return { request: {}, receipt: {} };
        },
        allocate: async () => {
            allocations++;
            return {};
        },
        settleAllocated: () => {
            assert.fail('Nothing allocated');
        },
    });
    assert.equal((await model.trigger()).type, 'refused');
    assert.equal(allocations, 0);
    model.dispose();
});
it('contains synchronous settlement and unsubscribe failures after allocation', async () => {
    const pending = held<object>(),
        value = {},
        settlementError = {};
    let settled = 0;
    const f = setup({
        subscribe: () => () => {
            throw Error('Cleanup failed');
        },
        allocate: () => pending.promise,
        settleAllocated: () => {
            settled++;
            throw settlementError;
        },
    });
    const running = f.model.trigger();
    f.model.dispose();
    pending.resolve(value);
    const result = await running;
    assert.equal(result.type, 'settled');
    if (result.type === 'settled') {
        assert.equal(result.settlementFailure?.error, settlementError);
        if (result.outcome.type === 'resolved')
            assert.equal(result.outcome.value, value);
        else assert.fail('Expected native success');
    }
    assert.equal(settled, 1);
});
it('snapshot observation never dispatches through reentrant recovery callbacks', async () => {
    let model: BorrowedButtonActionController<object> | undefined,
        calls = 0,
        observed = 0;
    const nested: Promise<{ type: string }>[] = [];
    model = createBorrowedButtonActionController({
        readContext: () => ({
            owner: 'native',
            revision: 1,
            visible: true,
            available: true,
        }),
        subscribe: () => () => {},
        mayStartNewIntent: () => {
            if (model) {
                observed++;
                nested.push(model.trigger());
                model.getSnapshot();
            }
            return true;
        },
        captureIntent: () => ({ request: {}, receipt: {} }),
        allocate: async () => {
            calls++;
            return {};
        },
        settleAllocated: () => {},
    });
    model.getSnapshot();
    assert.ok(observed > 0);
    assert.equal(calls, 0);
    assert.ok((await Promise.all(nested)).every((a) => a.type === 'refused'));
    model.dispose();
    assert.equal(model.getSnapshot().phase, 'retired');
    const stop = model.subscribe(() => assert.fail('Disposed notification'));
    stop();
});

for (const phase of ['pending', 'settling', 'settled'] as const)
    for (const rejected of [false, true])
        it(`contains observed async ${phase} notification rejection during native ${rejected ? 'rejection' : 'success'}`, async () => {
            let faults = 0;
            const error = {};
            const f = setup({
                allocate: () =>
                    rejected ? Promise.reject(error) : Promise.resolve(f.value),
            });
            f.model.subscribe(async (snapshot) => {
                if (snapshot.phase === phase) {
                    faults++;
                    throw Error('Async presentation fault');
                }
            });
            const result = await f.model.trigger();
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.ok(faults > 0);
            assert.equal(f.settlements.length, 1);
            assert.equal(result.type, 'settled');
            if (result.type === 'settled') {
                assert.equal(result.settlementFailure, null);
                if (rejected && result.outcome.type === 'rejected')
                    assert.equal(result.outcome.error, error);
            }
            f.model.dispose();
        });
it('contains an observed async cleanup rejection without aborting allocated work', async () => {
    let faults = 0;
    const pending = held<object>(),
        error = {};
    const f = setup({
        subscribe: () => async () => {
            faults++;
            throw Error('Async cleanup fault');
        },
        allocate: () => pending.promise,
    });
    const running = f.model.trigger();
    f.model.dispose();
    pending.reject(error);
    const result = await running;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(faults, 1);
    assert.equal(f.settlements.length, 1);
    assert.equal(result.type, 'settled');
    if (result.type === 'settled' && result.outcome.type === 'rejected')
        assert.equal(result.outcome.error, error);
    else assert.fail('Expected original rejection');
});

// Calibrate the actual final metadata observation rather than guessing a read count.
const reentrantReadFixture = (
    target: number,
    change: (
        model: BorrowedButtonActionController<object>,
        publish: () => void,
        setRevision: (value: number) => void
    ) => void
) => {
    let reads = 0,
        allocated = 0,
        settled = 0,
        observed = 0,
        publications = 0,
        lastAllocationRead = 0,
        nativeRevision = 1,
        changed = () => {};
    const owner = {};
    let model!: BorrowedButtonActionController<object>;
    model = createBorrowedButtonActionController({
        readContext() {
            const index = ++reads,
                revision = nativeRevision;
            return {
                owner,
                revision,
                visible: true,
                get available() {
                    if (index === target) {
                        change(
                            model,
                            () => {
                                publications++;
                                changed();
                            },
                            (value) => {
                                nativeRevision = value;
                            }
                        );
                        observed++;
                    }
                    return true;
                },
            };
        },
        subscribe: (notify) => {
            changed = notify;
            return () => {};
        },
        mayStartNewIntent: () => true,
        captureIntent: () => ({ request: {}, receipt: {} }),
        allocate: async () => {
            allocated++;
            lastAllocationRead = reads;
            return {};
        },
        settleAllocated: () => {
            settled++;
        },
    });
    return {
        model,
        get allocated() {
            return allocated;
        },
        get settled() {
            return settled;
        },
        get observed() {
            return observed;
        },
        get publications() {
            return publications;
        },
        get lastAllocationRead() {
            return lastAllocationRead;
        },
    };
};
for (const change of ['dispose', 'publication', 'publication ABA'] as const)
    it(`rejects final-read ${change} before new allocation with an observed callback`, async () => {
        const control = reentrantReadFixture(-1, () => {});
        await control.model.trigger();
        assert.equal(control.allocated, 1);
        const target = control.lastAllocationRead;
        assert.ok(target > 0);
        control.model.dispose();
        const f = reentrantReadFixture(
            target,
            (model, publish, setRevision) => {
                if (change === 'dispose') model.dispose();
                else {
                    setRevision(2);
                    publish();
                    if (change === 'publication ABA') {
                        setRevision(1);
                        publish();
                    }
                }
            }
        );
        const answer = await f.model.trigger();
        assert.equal(
            f.observed,
            1,
            'The final getter callback must actually execute'
        );
        assert.equal(
            f.publications,
            change === 'dispose' ? 0 : change === 'publication' ? 1 : 2
        );
        assert.equal(f.allocated, 0);
        assert.equal(f.settled, 0);
        assert.equal(answer.type, 'refused');
        f.model.dispose();
    });
for (const change of ['dispose', 'publication', 'publication ABA'] as const)
    for (const rejected of [false, true])
        it(`denies stale feedback during observed ${change} read and preserves allocated ${rejected ? 'rejection' : 'success'}`, async () => {
            const owner = {},
                value = {},
                error = {};
            let armed = false,
                observed = 0,
                publications = 0,
                nativeRevision = 1,
                changed = () => {},
                settled = 0,
                feedbackValue: boolean | undefined;
            let model!: BorrowedButtonActionController<object>;
            model = createBorrowedButtonActionController({
                readContext() {
                    const revision = nativeRevision;
                    return {
                        owner,
                        revision,
                        visible: true,
                        get available() {
                            if (armed) {
                                armed = false;
                                if (change === 'dispose') model.dispose();
                                else {
                                    nativeRevision = 2;
                                    publications++;
                                    changed();
                                    if (change === 'publication ABA') {
                                        nativeRevision = 1;
                                        publications++;
                                        changed();
                                    }
                                }
                                observed++;
                            }
                            return true;
                        },
                    };
                },
                subscribe: (notify) => {
                    changed = notify;
                    return () => {};
                },
                mayStartNewIntent: () => true,
                captureIntent: () => ({ request: {}, receipt: {} }),
                allocate: () =>
                    rejected ? Promise.reject(error) : Promise.resolve(value),
                settleAllocated: (_receipt, outcome, feedback) => {
                    settled++;
                    armed = true;
                    feedbackValue = feedback.isCurrent();
                    if (outcome.type === 'resolved')
                        assert.equal(outcome.value, value);
                    else assert.equal(outcome.error, error);
                },
            });
            const answer = await model.trigger();
            assert.equal(observed, 1, 'Feedback getter must actually run');
            assert.equal(
                publications,
                change === 'dispose' ? 0 : change === 'publication' ? 1 : 2
            );
            assert.equal(feedbackValue, false);
            assert.equal(settled, 1);
            assert.equal(answer.type, 'settled');
            if (answer.type === 'settled') {
                assert.equal(answer.settlementFailure, null);
                if (answer.outcome.type === 'resolved')
                    assert.equal(answer.outcome.value, value);
                else assert.equal(answer.outcome.error, error);
            }
            model.dispose();
        });
for (const rejected of [false, true])
    it(`never invokes a selected listener after its snapshot read disposes the controller; native ${rejected ? 'rejection' : 'success'} settles`, async () => {
        const pending = held<object>(),
            value = {},
            error = {},
            owner = {};
        let armed = false,
            disposedInRead = false,
            observed = 0,
            lateNotifications = 0,
            settled = 0;
        let model!: BorrowedButtonActionController<object>;
        model = createBorrowedButtonActionController({
            readContext: () => ({
                owner,
                revision: 1,
                visible: true,
                get available() {
                    if (armed) {
                        armed = false;
                        disposedInRead = true;
                        model.dispose();
                        observed++;
                    }
                    return true;
                },
            }),
            subscribe: () => () => {},
            mayStartNewIntent: () => true,
            captureIntent: () => ({ request: {}, receipt: {} }),
            allocate: () => pending.promise,
            settleAllocated: (_receipt, outcome) => {
                settled++;
                if (outcome.type === 'resolved')
                    assert.equal(outcome.value, value);
                else assert.equal(outcome.error, error);
            },
        });
        model.subscribe(() => {
            if (disposedInRead) lateNotifications++;
        });
        const running = model.trigger();
        armed = true;
        if (rejected) pending.reject(error);
        else pending.resolve(value);
        const answer = await running;
        assert.equal(observed, 1, 'Snapshot disposal getter must actually run');
        assert.equal(lateNotifications, 0);
        assert.equal(settled, 1);
        assert.equal(answer.type, 'settled');
        if (answer.type === 'settled')
            assert.equal(answer.settlementFailure, null);
        model.dispose();
    });
