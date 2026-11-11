import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    createFormCompletionCountdown,
    dispatchFormCompletionCommands,
    type FormCompletionClock,
} from '../src/forms/index.js';

function clock() {
    let now = 0;
    let next = 0;
    const scheduled = new Map<number, { at: number; callback: () => void }>();
    const stale: (() => void)[] = [];
    const adapter: FormCompletionClock = {
        now: () => now,
        setTimeout(callback, delay) {
            const id = ++next;
            scheduled.set(id, { at: now + delay, callback });
            stale.push(callback);
            return id;
        },
        clearTimeout(handle) {
            scheduled.delete(Number(handle));
        },
    };
    return {
        adapter,
        stale,
        pending: () => scheduled.size,
        tick(ms: number) {
            const until = now + ms;
            while (true) {
                const first = [...scheduled].sort(
                    (a, b) => a[1].at - b[1].at
                )[0];
                if (!first || first[1].at > until) break;
                now = first[1].at;
                scheduled.delete(first[0]);
                first[1].callback();
            }
            now = until;
        },
    };
}

it('retains the first duration while using the current callback and does not replay completion', () => {
    const time = clock();
    const calls: string[] = [];
    const c = createFormCompletionCountdown({
        start: 3,
        clock: time.adapter,
        onComplete: () => calls.push('old'),
    });
    c.start();
    time.tick(1000);
    assert.equal(c.getSnapshot().count, 2);
    c.update({ start: 90, onComplete: () => calls.push('current') });
    c.start(99);
    time.tick(1999);
    assert.deepEqual(calls.slice(), []);
    time.tick(1);
    assert.deepEqual(calls.slice(), ['current']);
    c.start();
    time.tick(100000);
    assert.deepEqual(calls.slice(), ['current']);
    assert.equal(time.pending(), 0);
});
it('accepts explicit zero including an override and consumes dispatch before a throwing callback', () => {
    const time = clock();
    let calls = 0;
    const error = new Error('synthetic external failure');
    const c = createFormCompletionCountdown({
        start: 5,
        clock: time.adapter,
        onComplete: () => {
            calls++;
            throw error;
        },
    });
    assert.throws(() => c.start(0), error);
    assert.equal(c.getSnapshot().count, 0);
    c.start();
    time.tick(10000);
    assert.equal(calls, 1);
    assert.equal(c.getSnapshot().status, 'completed');
});
it('reset while running replaces timers; stale callbacks, stop and retirement cannot mutate a successor', () => {
    const time = clock();
    let calls = 0;
    const c = createFormCompletionCountdown({
        start: 3,
        clock: time.adapter,
        onComplete: () => {
            calls++;
        },
    });
    c.reset(3);
    time.tick(1000);
    const stale = time.stale[0]!;
    c.reset(5);
    stale();
    assert.equal(c.getSnapshot().count, 5);
    assert.equal(time.pending(), 1);
    time.tick(3000);
    assert.equal(c.getSnapshot().count, 2);
    c.stop();
    time.tick(5000);
    assert.equal(calls, 0);
    c.start(0);
    time.tick(0);
    assert.equal(calls, 1);
    c.reset(1);
    c.retire();
    for (const callback of time.stale) callback();
    time.tick(2000);
    assert.equal(calls, 1);
    assert.equal(c.getSnapshot().status, 'retired');
    assert.equal(time.pending(), 0);
});
it('effect disconnect/reconnect preserves the deadline without reviving a retired owner', () => {
    const time = clock();
    let calls = 0;
    const c = createFormCompletionCountdown({
        start: 3,
        clock: time.adapter,
        attached: false,
        onComplete: () => {
            calls++;
        },
    });
    c.start();
    assert.equal(time.pending(), 0);
    const detach = c.attach();
    time.tick(1000);
    detach();
    time.tick(1000);
    assert.equal(calls, 0);
    assert.equal(time.pending(), 0);
    const detachNew = c.attach();
    detach();
    time.tick(1000);
    assert.equal(calls, 1);
    detachNew();
    c.retire();
    c.attach();
    c.reset(0);
    time.tick(0);
    assert.equal(calls, 1);
});
it('distinct controller mounts each own a lifecycle even for the same record', () => {
    const time = clock();
    let calls = 0;
    for (let mount = 0; mount < 2; mount++) {
        const c = createFormCompletionCountdown({
            start: 0,
            clock: time.adapter,
            onComplete: () => {
                calls++;
            },
        });
        c.start();
        time.tick(0);
        c.retire();
    }
    assert.equal(calls, 2);
});
it('rejects invalid explicit durations instead of scheduling an unbounded clock', () => {
    for (const start of [-1, Infinity, NaN]) {
        const c = createFormCompletionCountdown({ onComplete: () => {} });
        assert.throws(() => c.start(start), RangeError);
    }
});
it('drains synchronous plans in order and checks revocation between logout and navigation', async () => {
    let current = true;
    const calls: string[] = [];
    const result = dispatchFormCompletionCommands(['logout', 'navigate'], {
        isCurrent: () => current,
        dispatch(command) {
            calls.push(command);
            current = false;
        },
    });
    assert.deepEqual(calls.slice(), ['logout']);
    assert.deepEqual(await result, { status: 'revoked', attempted: 1 });
});
it('awaits uncertain adapters, preserves ABA retirement and never retries a dispatched command', async () => {
    let finish!: () => void;
    let current = true;
    const calls: string[] = [];
    const run = dispatchFormCompletionCommands(['logout', 'navigate'], {
        isCurrent: () => current,
        dispatch(command) {
            calls.push(command);
            return new Promise<void>((resolve) => {
                finish = resolve;
            });
        },
    });
    current = false;
    finish();
    assert.deepEqual(await run, { status: 'revoked', attempted: 1 });
    assert.deepEqual(calls.slice(), ['logout']);
    current = true;
    assert.deepEqual(calls.slice(), ['logout']);
    const error = new Error('uncertain dispatch');
    const failed = await dispatchFormCompletionCommands(['navigate', 'close'], {
        isCurrent: () => true,
        dispatch(command) {
            calls.push(command);
            throw error;
        },
    });
    assert.deepEqual(failed, { status: 'failed', attempted: 1, error });
    assert.deepEqual(calls.slice(), ['logout', 'navigate']);
});
it('truthfully reports adapter rejection and a failed authority read without calling later effects', async () => {
    const error = new Error('external rejection');
    let calls = 0;
    assert.deepEqual(
        await dispatchFormCompletionCommands([1, 2], {
            isCurrent: () => true,
            dispatch() {
                calls++;
                return Promise.reject(error);
            },
        }),
        { status: 'failed', attempted: 1, error }
    );
    assert.equal(calls, 1);
    assert.deepEqual(
        await dispatchFormCompletionCommands([1], {
            isCurrent() {
                throw error;
            },
            dispatch() {
                calls++;
            },
        }),
        { status: 'failed', attempted: 0, error }
    );
    assert.equal(calls, 1);
});
