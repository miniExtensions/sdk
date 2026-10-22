import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    createButtonDispatchGate,
    type ButtonDispatchGate,
} from '../src/ui/buttonDispatchGate.js';

const deferred = () => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};

it('matches the hosted explicit-click baseline across success, error and retry without a journal', async () => {
    const trace: string[] = [];
    let calls = 0;
    const lostResponse = new Error('synthetic lost response');
    const gate = createButtonDispatchGate({
        isCurrent: () => true,
        canTrigger: () => true,
        pendingChanged: (busy) => trace.push(`pending:${busy}`),
        dispatch: async () => {
            calls++;
            trace.push(`dispatch:${calls}`);
            if (calls === 2) throw lostResponse;
        },
    });
    assert.equal(await gate.run(), true);
    await assert.rejects(gate.run(), (error) => error === lostResponse);
    assert.equal(await gate.run(), true);
    assert.deepEqual(trace, [
        'pending:true',
        'dispatch:1',
        'pending:false',
        'pending:true',
        'dispatch:2',
        'pending:false',
        'pending:true',
        'dispatch:3',
        'pending:false',
    ]);
});

it('refuses duplicate activations until the exact allocated promise settles', async () => {
    const held = deferred();
    let dispatches = 0;
    const gate = createButtonDispatchGate({
        isCurrent: () => true,
        canTrigger: () => true,
        dispatch: () => {
            dispatches++;
            return held.promise;
        },
    });
    const running = gate.run();
    assert.equal(await gate.run(), false);
    assert.equal(dispatches, 1);
    held.resolve();
    assert.equal(await running, true);
    assert.equal(await gate.run(), true);
    assert.equal(dispatches, 2);
});

for (const callback of [
    'current',
    'available',
    'pending',
    'settled',
] as const) {
    it(`claims the flight before reentrant ${callback} callbacks`, async () => {
        const nested: Promise<boolean>[] = [];
        let dispatches = 0;
        let gate!: ButtonDispatchGate;
        gate = createButtonDispatchGate({
            isCurrent: () => {
                if (callback === 'current') nested.push(gate.run());
                return true;
            },
            canTrigger: () => {
                if (callback === 'available') nested.push(gate.run());
                return true;
            },
            pendingChanged: (busy) => {
                if (
                    (busy && callback === 'pending') ||
                    (!busy && callback === 'settled')
                )
                    nested.push(gate.run());
            },
            dispatch: async () => {
                dispatches++;
            },
        });
        assert.equal(await gate.run(), true);
        assert.ok(nested.length > 0);
        assert.ok(
            (await Promise.all(nested)).every((result) => result === false)
        );
        assert.equal(dispatches, 1);
    });
}

for (const ending of ['false', 'throw'] as const) {
    it(`permanently retires a ${ending} current-owner observation across A-B-A`, async () => {
        let current = true;
        let dispatches = 0;
        const gate = createButtonDispatchGate({
            isCurrent: () => {
                if (!current && ending === 'throw')
                    throw Error('owner unavailable');
                return current;
            },
            canTrigger: () => true,
            dispatch: async () => {
                dispatches++;
            },
        });
        current = false;
        assert.equal(await gate.run(), false);
        current = true;
        assert.equal(await gate.run(), false);
        assert.equal(dispatches, 0);
    });
}

it('permits availability recovery without retiring the unchanged owner', async () => {
    let available = false;
    let throws = true;
    let dispatches = 0;
    const gate = createButtonDispatchGate({
        isCurrent: () => true,
        canTrigger: () => {
            if (throws) throw Error('unavailable source');
            return available;
        },
        dispatch: async () => {
            dispatches++;
        },
    });
    assert.equal(await gate.run(), false);
    throws = false;
    assert.equal(await gate.run(), false);
    available = true;
    assert.equal(await gate.run(), true);
    assert.equal(dispatches, 1);
});

for (const change of ['dispose', 'owner', 'availability'] as const) {
    it(`rechecks ${change} after pending presentation before dispatch`, async () => {
        let current = true;
        let available = true;
        let dispatches = 0;
        const pending: boolean[] = [];
        let gate!: ButtonDispatchGate;
        gate = createButtonDispatchGate({
            isCurrent: () => current,
            canTrigger: () => available,
            pendingChanged: (busy) => {
                pending.push(busy);
                if (busy) {
                    if (change === 'dispose') gate.dispose();
                    if (change === 'owner') current = false;
                    if (change === 'availability') available = false;
                }
            },
            dispatch: async () => {
                dispatches++;
            },
        });
        assert.equal(await gate.run(), false);
        assert.equal(dispatches, 0);
        assert.deepEqual(
            pending,
            change === 'availability' ? [true, false] : [true]
        );
    });
}

it('disposal before admission invokes no host callback', async () => {
    let callbacks = 0;
    const unexpected = (): never => {
        callbacks++;
        throw Error('unexpected callback');
    };
    const gate = createButtonDispatchGate({
        isCurrent: unexpected,
        canTrigger: unexpected,
        dispatch: unexpected,
        pendingChanged: unexpected,
    });
    gate.dispose();
    gate.dispose();
    assert.equal(await gate.run(), false);
    assert.equal(callbacks, 0);
});

for (const ending of ['success', 'error'] as const) {
    it(`retains allocated ${ending} settlement after disposal without notifying a successor`, async () => {
        const old = deferred();
        const next = deferred();
        const pending: string[] = [];
        const failure = new Error('old action failed');
        const first = createButtonDispatchGate({
            isCurrent: () => true,
            canTrigger: () => true,
            dispatch: () => old.promise,
            pendingChanged: (busy) => pending.push(`old:${busy}`),
        });
        const running = first.run();
        first.dispose();
        const successor = createButtonDispatchGate({
            isCurrent: () => true,
            canTrigger: () => true,
            dispatch: () => next.promise,
            pendingChanged: (busy) => pending.push(`next:${busy}`),
        });
        const successorRunning = successor.run();
        if (ending === 'error') {
            old.reject(failure);
            await assert.rejects(running, (error) => error === failure);
        } else {
            old.resolve();
            assert.equal(await running, true);
        }
        assert.equal(await first.run(), false);
        assert.equal(await successor.run(), false);
        assert.deepEqual(pending, ['old:true', 'next:true']);
        next.resolve();
        assert.equal(await successorRunning, true);
        assert.deepEqual(pending, ['old:true', 'next:true', 'next:false']);
    });
}

it('presentation exceptions cannot veto dispatch or retain the completed flight', async () => {
    let dispatches = 0;
    const gate = createButtonDispatchGate({
        isCurrent: () => true,
        canTrigger: () => true,
        dispatch: async () => {
            dispatches++;
        },
        pendingChanged: () => {
            throw Error('presentation failed');
        },
    });
    assert.equal(await gate.run(), true);
    assert.equal(await gate.run(), true);
    assert.equal(dispatches, 2);
});

it('preserves synchronous dispatch errors and permits an explicit later retry', async () => {
    let first = true;
    const failure = new Error('synchronous host error');
    const gate = createButtonDispatchGate({
        isCurrent: () => true,
        canTrigger: () => true,
        dispatch: () => {
            if (first) {
                first = false;
                throw failure;
            }
            return Promise.resolve();
        },
    });
    await assert.rejects(gate.run(), (error) => error === failure);
    assert.equal(await gate.run(), true);
});

it('does not infer webhook success from a host-handled failure', async () => {
    let attempts = 0;
    const gate = createButtonDispatchGate({
        isCurrent: () => true,
        canTrigger: () => true,
        dispatch: async () => {
            attempts++; /* host handled its own feedback */
        },
    });
    assert.equal(await gate.run(), true);
    assert.equal(await gate.run(), true);
    assert.equal(attempts, 2);
});
