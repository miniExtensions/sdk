import assert from 'node:assert/strict';
import { it } from 'node:test';
import { File as NodeFile } from 'node:buffer';
import {
    createBorrowedAttachmentController,
    type BorrowedAttachmentBatchResult,
    type BorrowedAttachmentField,
    type BorrowedAttachmentControllerOptions,
} from '../src/ui/borrowedAttachmentController.js';
const file = (name = 'native.txt') =>
    new NodeFile(['native'], name) as unknown as File;
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const fixture = (
    override: Partial<BorrowedAttachmentControllerOptions<object, object>> = {}
) => {
    const native = Object.freeze({ id: 'native-existing' });
    let canonical: readonly object[] = [native];
    const owner = {};
    let field: BorrowedAttachmentField<object> = {
        owner,
        revision: 0,
        visible: true,
        editable: true,
        valueReadable: true,
        get value() {
            return canonical;
        },
    };
    let notify = () => {};
    const allocations: Array<{ file: File; index: number }> = [];
    const settled: Array<BorrowedAttachmentBatchResult<object>> = [];
    const receipt = {};
    let stops = 0;
    const options: BorrowedAttachmentControllerOptions<object, object> = {
        readField: () => field,
        subscribe: (changed) => {
            notify = changed;
            return () => {
                stops++;
            };
        },
        captureBatch: () => ({ receipt, canAllocate: () => true }),
        allocate: (nativeFile, index) => {
            allocations.push({ file: nativeFile, index });
            return { completion: Promise.resolve(nativeFile) };
        },
        settleCompleted: (accepted, outcome) => {
            assert.equal(accepted, receipt);
            settled.push(outcome);
            canonical = canonical.concat(
                outcome.completed.map((entry) => entry.attachment)
            );
        },
        ...override,
    };
    const controller = createBorrowedAttachmentController(options);
    return {
        controller,
        options,
        allocations,
        settled,
        native,
        owner,
        receipt,
        get canonical() {
            return canonical;
        },
        set canonical(value: readonly object[]) {
            canonical = value;
        },
        get field() {
            return field;
        },
        set field(value: BorrowedAttachmentField<object>) {
            field = value;
        },
        notify: () => notify(),
        stops: () => stops,
    };
};

it('borrows native identity and original occurrence order, without implicit dispatch', async () => {
    const f = fixture();
    const original = file();
    assert.equal(f.allocations.length, 0);
    assert.equal(f.controller.getSnapshot().value?.[0], f.native);
    const source = [original, original];
    const pending = f.controller.start(source);
    source.length = 0;
    assert.equal(f.allocations.length, 1);
    const outcome = await pending;
    assert.equal(outcome.outcome, 'completed');
    assert.deepEqual(f.allocations, [
        { file: original, index: 0 },
        { file: original, index: 1 },
    ]);
    assert.equal(outcome.completed[0].file, original);
    assert.equal(outcome.completed[1].attachment, original);
    assert.equal(f.canonical[0], f.native);
    assert.equal(f.canonical[1], original);
    assert.equal(f.settled.length, 1);
    f.controller.dispose();
});
it('retains ordered partial success and original completion error, with no third allocation', async () => {
    const error = {};
    const a = file('a'),
        b = file('b'),
        c = file('c');
    const first = {};
    const calls: File[] = [];
    const f = fixture({
        allocate: (native) => {
            calls.push(native);
            return {
                completion:
                    native === b
                        ? Promise.reject(error)
                        : Promise.resolve(first),
            };
        },
    });
    const outcome = await f.controller.start([a, b, c]);
    assert.deepEqual(calls, [a, b]);
    assert.equal(outcome.failure?.error, error);
    assert.equal(outcome.failure?.phase, 'completion');
    assert.equal(outcome.completed[0].attachment, first);
    assert.deepEqual(f.canonical, [f.native, first]);
    assert.equal(f.settled.length, 1);
    assert.deepEqual(f.controller.getSnapshot().files, [b, c]);
    f.controller.dispose();
});
it('cancel during allocation requests host cancel once but preserves a late success', async () => {
    const held = deferred<object>();
    let cancel = 0;
    const f = fixture({
        allocate: () => ({
            completion: held.promise,
            cancel: () => {
                cancel++;
            },
        }),
    });
    const a = file(),
        accepted = {};
    const pending = f.controller.start([a, file('skip')]);
    f.controller.cancel();
    f.controller.cancel();
    held.resolve(accepted);
    const outcome = await pending;
    assert.equal(cancel, 1);
    assert.equal(outcome.outcome, 'cancelled');
    assert.equal(outcome.allocatedCount, 1);
    assert.equal(f.canonical[1], accepted);
    assert.equal(f.settled.length, 1);
    f.controller.dispose();
});
for (const change of [
    'owner',
    'owner ABA',
    'readonly ABA',
    'hidden ABA',
    'dispose',
] as const) {
    it(`retires new allocation after ${change} without dropping allocated settlement`, async () => {
        const held = deferred<object>();
        let cancel = 0;
        const f = fixture({
            allocate: () => ({
                completion: held.promise,
                cancel: () => {
                    cancel++;
                },
            }),
        });
        const a = file();
        const accepted = {};
        const pending = f.controller.start([a, file('unallocated')]);
        const original = f.field;
        if (change === 'dispose') f.controller.dispose();
        else {
            f.field = {
                ...original,
                owner: change.startsWith('owner') ? {} : original.owner,
                editable: change !== 'readonly ABA',
                visible: change !== 'hidden ABA',
            };
            f.notify();
            if (change.endsWith('ABA')) {
                f.field = original;
                f.notify();
            }
        }
        held.resolve(accepted);
        const outcome = await pending;
        assert.equal(outcome.outcome, 'retired');
        assert.equal(outcome.allocatedCount, 1);
        assert.equal(f.canonical[1], accepted);
        assert.equal(cancel, 0);
        assert.equal(f.settled.length, 1);
        f.controller.dispose();
        assert.equal(f.stops(), 1);
    });
}
it('rebases only through the host writer after concurrent native values/revision change', async () => {
    const held = deferred<object>();
    let n = 0;
    const accepted = {},
        second = {},
        concurrent = {};
    const f = fixture({
        allocate: () => ({
            completion: n++ === 0 ? held.promise : Promise.resolve(second),
        }),
    });
    const pending = f.controller.start([file('a'), file('b')]);
    f.canonical = [f.native, concurrent];
    f.field = {
        ...f.field,
        revision: 17,
        get value() {
            return f.canonical;
        },
    };
    f.notify();
    held.resolve(accepted);
    assert.equal((await pending).outcome, 'completed');
    assert.deepEqual(f.canonical, [f.native, concurrent, accepted, second]);
    assert.equal(f.canonical[1], concurrent);
    f.controller.dispose();
});
it('host next-allocation capacity refusal retains the completed prefix', async () => {
    const f = fixture({
        captureBatch: () => ({
            receipt: {},
            canAllocate: (_file, _index, completed) => completed.length === 0,
        }),
        settleCompleted: (_receipt, outcome) => {
            assert.equal(outcome.completed.length, 1);
        },
    });
    const outcome = await f.controller.start([file(), file('skip')]);
    assert.equal(outcome.outcome, 'retired');
    assert.equal(outcome.allocatedCount, 1);
    f.controller.dispose();
});
it('capture reentrancy cannot allocate another batch, and cancellation before allocation settles nothing', async () => {
    let nested!: Promise<BorrowedAttachmentBatchResult<object>>;
    const f = fixture();
    f.options.captureBatch = () => {
        nested = f.controller.start([file('nested')]);
        f.controller.cancel();
        return { receipt: f.receipt, canAllocate: () => true };
    };
    assert.equal((await f.controller.start([file()])).outcome, 'cancelled');
    assert.equal((await nested).outcome, 'not-started');
    assert.equal(f.allocations.length, 0);
    assert.equal(f.settled.length, 0);
    f.controller.dispose();
});
for (const during of ['admission', 'notification', 'allocation'] as const) {
    it(`handles synchronous cancellation during ${during}`, async () => {
        const f = fixture();
        let cancels = 0;
        if (during === 'admission')
            f.options.captureBatch = () => ({
                receipt: f.receipt,
                canAllocate: () => {
                    f.controller.cancel();
                    return true;
                },
            });
        if (during === 'notification')
            f.controller.subscribe((s) => {
                if (s.phase === 'uploading') f.controller.cancel();
            });
        if (during === 'allocation')
            f.options.allocate = () => {
                f.controller.cancel();
                return {
                    completion: Promise.resolve(f.native),
                    cancel: () => {
                        cancels++;
                    },
                };
            };
        const outcome = await f.controller.start([file(), file('skip')]);
        assert.equal(outcome.outcome, 'cancelled');
        assert.equal(outcome.allocatedCount, during === 'allocation' ? 1 : 0);
        assert.equal(f.settled.length, during === 'allocation' ? 1 : 0);
        assert.equal(cancels, during === 'allocation' ? 1 : 0);
        f.controller.dispose();
    });
}
for (const stage of ['read', 'capture', 'admission', 'allocation'] as const) {
    it(`preserves original ${stage} error and delegates cleanup only after allocation`, async () => {
        const f = fixture();
        const error = {};
        let cleanup = 0;
        if (stage === 'read')
            f.options.readField = () => {
                throw error;
            };
        if (stage === 'capture')
            f.options.captureBatch = () => {
                throw error;
            };
        if (stage === 'admission')
            f.options.captureBatch = () => ({
                receipt: f.receipt,
                canAllocate: () => {
                    throw error;
                },
            });
        if (stage === 'allocation')
            f.options.allocate = () => {
                throw error;
            };
        f.options.settleCompleted = () => {
            cleanup++;
        };
        const outcome = await f.controller.start([file()]);
        assert.equal(outcome.failure?.error, error);
        assert.equal(outcome.failure?.phase, stage);
        assert.equal(cleanup, stage === 'allocation' ? 1 : 0);
        f.controller.dispose();
    });
}
it('keeps completion and settlement errors separate, with no repeated cleanup or replay', async () => {
    const original = {},
        cleanupError = {};
    let cleanups = 0;
    const f = fixture({
        allocate: () => ({ completion: Promise.reject(original) }),
        settleCompleted: () => {
            cleanups++;
            throw cleanupError;
        },
    });
    const outcome = await f.controller.start([file()]);
    assert.equal(outcome.failure?.error, original);
    assert.equal(outcome.settlementFailure?.error, cleanupError);
    assert.equal(f.controller.getSnapshot().phase, 'failed');
    assert.equal(cleanups, 1);
    f.controller.dispose();
});
it('asynchronous host cleanup holds singleflight through settlement', async () => {
    const held = deferred<void>();
    let entered = false;
    const f = fixture({
        settleCompleted: async () => {
            entered = true;
            await held.promise;
        },
    });
    const pending = f.controller.start([file()]);
    while (!entered) await Promise.resolve();
    assert.equal(
        (await f.controller.start([file('duplicate')])).outcome,
        'not-started'
    );
    assert.equal(f.controller.getSnapshot().busy, true);
    held.resolve();
    await pending;
    assert.equal(f.controller.getSnapshot().busy, false);
    f.controller.dispose();
});
it('hides lazy native values before reading and allocates nothing when hidden', async () => {
    const f = fixture();
    let reads = 0;
    f.field = {
        ...f.field,
        visible: false,
        get value(): readonly object[] {
            reads++;
            throw Error('hidden');
        },
    };
    f.notify();
    assert.equal(f.controller.getSnapshot().value, null);
    assert.equal((await f.controller.start([file()])).allocatedCount, 0);
    assert.equal(reads, 0);
    f.controller.dispose();
});
it('settlement callbacks cannot reenter allocation or change completion rows', async () => {
    const f = fixture();
    let nested!: Promise<BorrowedAttachmentBatchResult<object>>;
    f.options.settleCompleted = (_receipt, outcome) => {
        assert.equal(Object.isFrozen(outcome.completed), true);
        assert.equal(Object.isFrozen(outcome.completed[0]), true);
        nested = f.controller.start([file('nested')]);
    };
    await f.controller.start([file()]);
    assert.equal((await nested).outcome, 'not-started');
    assert.equal(f.allocations.length, 1);
    f.controller.dispose();
});
it('observer errors and host cancellation errors cannot discard allocated success', async () => {
    const held = deferred<object>();
    const f = fixture({
        allocate: () => ({
            completion: held.promise,
            cancel: () => {
                throw Error('feedback');
            },
        }),
    });
    f.controller.subscribe(() => {
        throw Error('view');
    });
    const pending = f.controller.start([file()]);
    f.controller.cancel();
    held.resolve(f.native);
    assert.equal((await pending).completed[0].attachment, f.native);
    assert.equal(f.settled.length, 1);
    f.controller.dispose();
});
it('permits a fresh explicitly admitted batch after retirement, without retaining a stale owner', async () => {
    const f = fixture({ captureBatch: () => null });
    assert.equal((await f.controller.start([file()])).outcome, 'retired');
    f.options.captureBatch = () => ({
        receipt: f.receipt,
        canAllocate: () => true,
    });
    assert.equal((await f.controller.start([file()])).outcome, 'completed');
    f.controller.dispose();
});

it('a presentation getter error after allocation cannot skip host settlement', async () => {
    const f = fixture();
    f.options.allocate = () => {
        f.field = {
            ...f.field,
            get value(): readonly object[] {
                throw Error('presentation only');
            },
        };
        return { completion: Promise.resolve(f.native) };
    };
    const answer = await f.controller.start([file()]);
    assert.equal(f.settled.length, 1);
    assert.equal(answer.outcome, 'completed');
    assert.equal(answer.settlementFailure, null);
    f.controller.dispose();
});
it('captures the host settlement receipt once before allocation', async () => {
    const f = fixture();
    let allocated = false,
        reads = 0;
    f.options.captureBatch = () => ({
        get receipt() {
            reads++;
            if (allocated) throw Error('obsolete capture access');
            return f.receipt;
        },
        canAllocate: () => true,
    });
    f.options.allocate = () => {
        allocated = true;
        return { completion: Promise.resolve(f.native) };
    };
    const answer = await f.controller.start([file()]);
    assert.equal(f.settled.length, 1);
    assert.equal(answer.settlementFailure, null);
    assert.equal(reads, 1);
    f.controller.dispose();
});
it('a completed file cannot replace the next allocation progress with a retained callback', async () => {
    const f = fixture();
    const first = deferred<object>(),
        second = deferred<object>();
    let oldProgress!: (value: {
        bytesTransferred: number;
        totalBytes: number;
    }) => void;
    let secondStarted = false;
    f.options.allocate = (_file, index, progress) => {
        if (index === 0) oldProgress = progress;
        else {
            secondStarted = true;
            progress({ bytesTransferred: 1, totalBytes: 10 });
        }
        return { completion: index === 0 ? first.promise : second.promise };
    };
    const pending = f.controller.start([file(), file('second')]);
    first.resolve({});
    while (!secondStarted) await Promise.resolve();
    oldProgress({ bytesTransferred: 9, totalBytes: 9 });
    const observed = f.controller.getSnapshot().progress;
    second.resolve({});
    await pending;
    assert.deepEqual(observed, { bytesTransferred: 1, totalBytes: 10 });
    f.controller.dispose();
});
it('masked native values are never read or exposed in activity snapshots', async () => {
    const f = fixture();
    let reads = 0;
    f.field = {
        ...f.field,
        valueReadable: false,
        get value(): readonly object[] {
            reads++;
            throw Error('masked native');
        },
    };
    assert.equal(f.controller.getSnapshot().value, null);
    assert.equal((await f.controller.start([file()])).outcome, 'completed');
    assert.equal(f.settled.length, 1);
    assert.equal(reads, 0);
    assert.equal(f.controller.getSnapshot().result, null);
    assert.deepEqual(f.controller.getSnapshot().files, []);
    f.controller.dispose();
});
it('a new owner cannot receive old native completion or File activity through snapshots', async () => {
    const held = deferred<object>();
    const f = fixture({ allocate: () => ({ completion: held.promise }) });
    const pending = f.controller.start([file(), file('skip')]);
    let nativeReads = 0;
    f.field = {
        ...f.field,
        owner: {},
        get value() {
            nativeReads++;
            return [f.native];
        },
    };
    f.notify();
    assert.deepEqual(f.controller.getSnapshot().files, []);
    assert.equal(f.controller.getSnapshot().value, null);
    held.resolve({});
    await pending;
    assert.equal(f.settled.length, 1);
    assert.equal(f.controller.getSnapshot().result, null);
    assert.equal(nativeReads, 0);
    f.controller.dispose();
});
it('a final observer can start a successor without delivering obsolete snapshots afterward', async () => {
    const f = fixture();
    let started = false;
    let successor!: Promise<BorrowedAttachmentBatchResult<object>>;
    const received: string[] = [];
    const obsolete: string[] = [];
    f.controller.subscribe((s) => {
        if (s.phase === 'completed' && !started) {
            started = true;
            successor = f.controller.start([file('successor')]);
        }
    });
    f.controller.subscribe((s) => {
        received.push(s.phase);
        if (s.phase === 'completed' && f.settled.length === 1)
            obsolete.push(s.phase);
    });
    await f.controller.start([file()]);
    await successor;
    assert.equal(f.settled.length, 2);
    assert.deepEqual(obsolete, []);
    assert.deepEqual(received.slice(-3), [
        'uploading',
        'settling',
        'completed',
    ]);
    f.controller.dispose();
});
it('a throwing receipt getter fails before transport with its original error', async () => {
    const f = fixture();
    const error = {};
    f.options.captureBatch = () => ({
        get receipt(): object {
            throw error;
        },
        canAllocate: () => true,
    });
    const answer = await f.controller.start([file()]);
    assert.equal(answer.failure?.error, error);
    assert.equal(answer.failure?.phase, 'capture');
    assert.equal(f.allocations.length, 0);
    assert.equal(f.settled.length, 0);
    f.controller.dispose();
});

for (const probe of [
    { key: 'revision', throwOn: 1 },
    { key: 'visible', throwOn: 3 },
    { key: 'valueReadable', throwOn: 2 },
    { key: 'owner', throwOn: 3 },
    { key: 'editable', throwOn: 1 },
    { key: 'visible', throwOn: 1 },
] as const) {
    for (const rejected of [false, true]) {
        it(`settles allocated ${rejected ? 'rejection' : 'success'} once despite ${probe.key} getter fault at read ${probe.throwOn}`, async () => {
            const held = deferred<object>();
            const transportError = {},
                presentationError = {},
                accepted = {};
            const f = fixture({
                allocate: () => ({ completion: held.promise }),
            });
            let armed = false;
            f.options.readField = () => {
                const field = { ...f.field };
                const original = field[probe.key];
                let reads = 0;
                Object.defineProperty(field, probe.key, {
                    enumerable: true,
                    get() {
                        if (armed && ++reads >= probe.throwOn)
                            throw presentationError;
                        return original;
                    },
                });
                return field;
            };
            const pending = f.controller.start([file()]);
            armed = true;
            if (rejected) held.reject(transportError);
            else held.resolve(accepted);
            const outcome = await pending;
            assert.equal(f.settled.length, 1);
            assert.equal(outcome.allocatedCount, 1);
            assert.equal(outcome.settlementFailure, null);
            if (rejected) {
                assert.equal(outcome.outcome, 'failed');
                assert.equal(outcome.failure?.phase, 'completion');
                assert.equal(outcome.failure?.error, transportError);
                assert.deepEqual(outcome.completed, []);
            } else {
                assert.equal(outcome.outcome, 'completed');
                assert.equal(outcome.failure, null);
                assert.equal(outcome.completed[0].attachment, accepted);
                assert.equal(f.canonical[1], accepted);
            }
            f.controller.dispose();
        });
    }
}
