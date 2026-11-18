import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    createFormBackgroundComputeCoordinator,
    createFormBackgroundComputeFieldBinding,
    type FormBackgroundComputeClock,
} from '../src/forms/index.js';

function deferred() {
    let resolve!: () => void;
    let reject!: (cause: unknown) => void;
    const promise = new Promise<void>((finish, fail) => {
        resolve = finish;
        reject = fail;
    });
    return { promise, resolve, reject };
}

test('a synchronous allocator can queue one follow-up, and waiting foreground work enters after it', async () => {
    const coordinator = createFormBackgroundComputeCoordinator<symbol>();
    const key = Symbol();
    const gate = deferred();
    const calls: string[] = [];
    const run = (name: string) => async () => {
        calls.push(name);
    };
    let firstWaiter!: Promise<void>;
    let lastWaiter!: Promise<void>;
    const first = coordinator.runBackground(key, async () => {
        calls.push('first');
        firstWaiter = coordinator.runBackground(key, run('superseded'));
        lastWaiter = coordinator.runBackground(key, run('latest'));
        await gate.promise;
    });
    const foreground = coordinator.runForeground(key, run('Save'));
    const independent = coordinator.runForeground(Symbol(), run('independent'));
    assert.deepEqual(calls, ['first', 'independent']);
    gate.resolve();
    await Promise.all([
        first,
        firstWaiter,
        lastWaiter,
        foreground,
        independent,
    ]);
    assert.deepEqual(calls, ['first', 'independent', 'latest', 'Save']);
});

test('an escaped allocation failure clears the session and rejects queued and foreground work', async () => {
    const coordinator = createFormBackgroundComputeCoordinator<string>();
    const gate = deferred();
    const failure = new Error('synthetic allocator failure');
    const first = coordinator.runBackground('form', () => gate.promise);
    const never = async () => assert.fail('failed work must not replay');
    const queued = coordinator.runBackground('form', never);
    const foreground = coordinator.runForeground('form', never);
    const rejected = [first, queued, foreground].map((operation) =>
        assert.rejects(operation, (error) => error === failure)
    );
    gate.reject(failure);
    await Promise.all(rejected);

    let entered = false;
    const next = coordinator.runForeground('form', async () => {
        entered = true;
    });
    assert.equal(entered, true);
    await next;
});

test('the default field binding cancels an unstarted timer and replaces a pending debounce', async ({
    mock,
}) => {
    mock.timers.enable({ apis: ['Date', 'setTimeout'] });
    const field = createFormBackgroundComputeFieldBinding<string>();
    const edits: string[] = [];
    const compute = async (owner: string) => {
        edits.push(owner);
    };
    field.edited('cancelled', compute);
    field.cancelScheduled();
    mock.timers.tick(300);
    assert.deepEqual(edits, []);
    field.edited('first', compute);
    mock.timers.tick(100);
    field.edited('latest', compute);
    mock.timers.tick(299);
    assert.deepEqual(edits, []);
    mock.timers.tick(1);
    assert.deepEqual(edits, ['latest']);
});

test('field cancellation during allocation preserves accepted edits and failures do not rearm them', async () => {
    let time = 0;
    let scheduled: { run: () => Promise<void>; delay: number } | undefined;
    const clock: FormBackgroundComputeClock = {
        now: () => time,
        schedule(run, delay) {
            scheduled = { run, delay };
            return () => {
                scheduled = undefined;
            };
        },
    };
    const take = (delay: number) => {
        assert.equal(scheduled?.delay, delay);
        const task = scheduled;
        scheduled = undefined;
        assert.ok(task);
        return task.run();
    };
    const field = createFormBackgroundComputeFieldBinding<symbol>({ clock });
    const first = deferred();
    const failure = deferred();
    const activeOwner = Symbol('active');
    const successOwner = Symbol('continue');
    const failedOwner = Symbol('failed');
    const calls: symbol[] = [];
    const compute = async (owner: symbol) => {
        calls.push(owner);
        if (owner === activeOwner) await first.promise;
        if (owner === failedOwner) await failure.promise;
    };

    field.edited(activeOwner, compute);
    time = 300;
    const active = take(300);
    time += 1;
    field.edited(successOwner, compute);
    field.cancelScheduled();
    first.resolve();
    await active;
    await take(0);
    assert.deepEqual(calls, [activeOwner, successOwner]);

    field.edited(failedOwner, compute);
    const exhausting = take(300);
    time += 1;
    field.edited(Symbol('discarded on failure'), compute);
    const cause = new Error('synthetic field failure');
    const rejected = assert.rejects(exhausting, (error) => error === cause);
    failure.reject(cause);
    await rejected;
    assert.equal(scheduled, undefined);
    assert.deepEqual(calls, [activeOwner, successOwner, failedOwner]);
});
