import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createProcessGroupObserver } from './process-group-observer.mjs';

const expected = {
    attachment: { checks: 104, browserChecks: 90 },
    review: { checks: 51 },
};

// Private package-check orchestration. Optional transport/timing arguments let
// guard tests use real fixture children without replacing SDK behavior.
export async function runPackedTailChecks({
    consumerDirectory,
    happyDomModulePath,
    workerFile = fileURLToPath(
        new URL('./packed-tail-worker.mjs', import.meta.url)
    ),
    timeoutMs = 360000,
    terminationGraceMs = 2000,
    drainTimeoutMs = 3000,
    execPath = process.execPath,
    createObserver = createProcessGroupObserver,
}) {
    assert.notEqual(
        process.platform,
        'win32',
        'Packed-tail CI workers require POSIX process groups'
    );
    for (const value of [timeoutMs, terminationGraceMs, drainTimeoutMs])
        assert(Number.isFinite(value) && value > 0);
    const records = [];
    const handlers = new Map();
    const problem = (record, message, cause) => {
        if (
            !record.problems.some(
                (error) => error.message === `[${record.suite}] ${message}`
            )
        )
            record.problems.push(
                new Error(`[${record.suite}] ${message}`, { cause })
            );
    };
    const drained = (state) =>
        state.state === 'gone' || state.state === 'exited';
    const signal = (record, name) => {
        record.signalWork = record.signalWork
            .then(async () => {
                if (record.settled || !record.observer) return;
                const state = await record.observer.signal(name);
                if (state.state === 'unresolved')
                    problem(
                        record,
                        `Cannot safely send ${name}: ${state.reason}`
                    );
                return state;
            })
            .catch((error) => problem(record, `Cannot send ${name}`, error));
        return record.signalWork;
    };
    const stopAll = (reason) => {
        for (const record of records) {
            if (record.groupGone || !record.pid) continue;
            record.stopping = true;
            problem(record, reason);
            void signal(record, 'SIGTERM');
            record.killTimer ??= setTimeout(() => {
                void signal(record, 'SIGKILL');
            }, terminationGraceMs);
            record.drainTimer ??= setTimeout(() => {
                problem(record, 'Worker close/drain timed out');
                record.observer?.dispose();
                if (record.child?.connected) record.child.disconnect();
                record.child?.stdout?.destroy();
                record.child?.stderr?.destroy();
                record.child?.unref();
                record.settle();
            }, terminationGraceMs + drainTimeoutMs);
        }
    };
    const waitGone = async (record, milliseconds, retrySignal) => {
        const deadline = performance.now() + milliseconds;
        do {
            if (record.settled) return false;
            // A refused signal already has an unresolved fresh observation.
            // Retry its own ownership proof before another full inspection can
            // consume the cooperative window. Never extend that window.
            if (performance.now() < deadline) await retrySignal?.();
            const state = record.observer
                ? await record.observer.inspect()
                : record.pid
                  ? {
                        state: 'unresolved',
                        reason: 'Owned PID has no process-group observer',
                    }
                  : { state: 'gone' };
            record.observation = state;
            if (drained(state)) return true;
            if (performance.now() >= deadline) return false;
            await delay(
                Math.min(25, Math.max(1, deadline - performance.now()))
            );
        } while (performance.now() <= deadline);
        return false;
    };
    const drain = async (record) => {
        if (await waitGone(record, terminationGraceMs)) return;
        problem(record, 'Process group survived worker close');
        let termState = await signal(record, 'SIGTERM');
        if (
            await waitGone(record, terminationGraceMs, async () => {
                // Proc churn may refuse a signal without sending it. Retry only
                // after a fresh proof, within the existing cooperative window.
                if (termState?.state === 'unresolved')
                    termState = await signal(record, 'SIGTERM');
            })
        )
            return;
        await signal(record, 'SIGKILL');
        assert(
            await waitGone(record, drainTimeoutMs),
            'Process group did not drain'
        );
    };
    const launch = (suite) => {
        const record = {
            suite,
            pid: null,
            closed: false,
            groupGone: false,
            problems: [],
            messages: 0,
            report: null,
            signalWork: Promise.resolve(),
            handshakeWork: Promise.resolve(),
            handshakeStage: 0,
            capturing: false,
            settled: false,
            stopping: false,
        };
        let complete;
        record.completion = new Promise((resolve) => {
            complete = resolve;
        });
        record.settle = () => {
            if (record.settled) return;
            record.settled = true;
            record.observer?.dispose();
            clearTimeout(record.deadline);
            clearTimeout(record.killTimer);
            clearTimeout(record.drainTimer);
            complete();
        };
        records.push(record);
        const closed = async (code, exitSignal) => {
            if (record.closed) return;
            record.closed = true;
            if (code !== 0 || exitSignal)
                problem(
                    record,
                    `Worker exit code ${code}, signal ${exitSignal}`
                );
            if (record.messages !== 1 || !record.report)
                problem(record, 'Missing single valid result');
            if (record.handshakeStage !== 2)
                problem(record, 'Missing accepted worker cohort handshake');
            if (record.problems.length) stopAll(`${suite} worker failed`);
            try {
                await record.handshakeWork;
                await drain(record);
                await record.signalWork;
                if (record.settled) return;
                record.observation = record.observer
                    ? await record.observer.inspect()
                    : record.pid
                      ? {
                            state: 'unresolved',
                            reason: 'Owned PID has no process-group observer',
                        }
                      : { state: 'gone' };
                if (record.settled) return;
                assert(
                    drained(record.observation),
                    'Final process-group observation is unresolved'
                );
                record.groupGone = true;
                if (record.observation?.state === 'exited')
                    console.log(
                        `[${suite}] operational zombie group drained (not reaped): ${JSON.stringify(record.observation)}`
                    );
            } catch (error) {
                problem(record, 'Cannot confirm process-group cleanup', error);
                stopAll(`${suite} cleanup failed`);
            } finally {
                record.settle();
            }
        };
        try {
            const child = fork(
                workerFile,
                [suite, consumerDirectory, happyDomModulePath],
                {
                    execPath,
                    execArgv: [],
                    detached: true,
                    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
                }
            );
            record.child = child;
            record.pid = child.pid ?? null;
            if (record.pid)
                record.observer = createObserver({ pid: record.pid });
            child.stdout.pipe(process.stdout, { end: false });
            child.stderr.pipe(process.stderr, { end: false });
            for (const stream of [child.stdout, child.stderr])
                stream.once('error', (error) => {
                    problem(record, 'Worker output error', error);
                    stopAll(`${suite} output failed`);
                });
            child.on('message', (message) => {
                if (
                    message &&
                    typeof message === 'object' &&
                    Object.hasOwn(message, 'phase')
                ) {
                    try {
                        assert.equal(
                            record.capturing,
                            false,
                            'Overlapping cohort handshake'
                        );
                        const phase = ['start', 'finish'][
                            record.handshakeStage
                        ];
                        assert.ok(phase, 'Unexpected cohort handshake');
                        assert.deepEqual(message, {
                            schemaVersion: 1,
                            suite,
                            phase,
                        });
                        record.capturing = true;
                        record.handshakeWork = (async () => {
                            const captureStarted = performance.now();
                            const deadline = record.workerDeadline;
                            let state;
                            do {
                                if (record.settled || record.stopping) break;
                                state = await record.observer.capture();
                                if (
                                    state.state === 'live' ||
                                    state.state === 'gone'
                                )
                                    break;
                                await delay(25);
                            } while (performance.now() < deadline);
                            const accepted =
                                !record.settled &&
                                !record.stopping &&
                                !record.closed &&
                                child.connected &&
                                child.exitCode === null &&
                                child.signalCode === null &&
                                performance.now() <= deadline &&
                                state?.state === 'live';
                            if (!accepted) {
                                const refusal = {
                                    phase,
                                    elapsedMs:
                                        performance.now() - captureStarted,
                                    captureBudgetMs: deadline - captureStarted,
                                    observation: state?.state ?? null,
                                    reason: state?.reason ?? null,
                                    refusal: record.settled
                                        ? 'settled'
                                        : record.stopping
                                          ? 'stopping'
                                          : record.closed ||
                                              child.exitCode !== null ||
                                              child.signalCode !== null
                                            ? 'child-exited'
                                            : !child.connected
                                              ? 'ipc-disconnected'
                                              : performance.now() > deadline
                                                ? 'capture-budget-expired'
                                                : 'observation-unresolved',
                                };
                                problem(
                                    record,
                                    `Cannot capture ${phase} worker cohort: ${JSON.stringify(refusal)}`
                                );
                                console.error(
                                    `[${suite}] worker cohort refused: ${JSON.stringify(refusal)}`
                                );
                            }
                            if (accepted) record.handshakeStage++;
                            if (!record.settled && child.connected)
                                await new Promise((resolve, reject) =>
                                    child.send(
                                        {
                                            schemaVersion: 1,
                                            suite,
                                            phase,
                                            accepted,
                                        },
                                        (error) =>
                                            error ? reject(error) : resolve()
                                    )
                                );
                            record.capturing = false;
                            if (!accepted)
                                stopAll(`${suite} cohort capture failed`);
                        })().catch((error) => {
                            record.capturing = false;
                            problem(
                                record,
                                'Worker cohort handshake failed',
                                error
                            );
                            stopAll(`${suite} cohort handshake failed`);
                        });
                    } catch (error) {
                        problem(
                            record,
                            'Invalid worker cohort handshake',
                            error
                        );
                        stopAll(`${suite} protocol failed`);
                    }
                    return;
                }
                record.messages++;
                try {
                    assert.equal(
                        record.handshakeStage,
                        2,
                        'Result before accepted cohort handshake'
                    );
                    assert.equal(
                        record.capturing,
                        false,
                        'Result overlaps cohort handshake'
                    );
                    assert.equal(record.messages, 1, 'Duplicate worker result');
                    assert.deepEqual(message, {
                        schemaVersion: 1,
                        suite,
                        result: expected[suite],
                    });
                    record.report = message.result;
                } catch (error) {
                    problem(record, 'Invalid worker result', error);
                    stopAll(`${suite} protocol failed`);
                }
            });
            child.once('error', (error) => {
                problem(record, 'Worker process error', error);
                stopAll(`${suite} process failed`);
                if (!record.pid) void closed(null, null);
            });
            child.once('exit', (code, exitSignal) => {
                if (code !== 0 || exitSignal) {
                    problem(
                        record,
                        `Worker exit code ${code}, signal ${exitSignal}`
                    );
                    stopAll(`${suite} worker failed`);
                }
            });
            child.once('close', (code, exitSignal) => {
                void closed(code, exitSignal);
            });
            record.workerDeadline = performance.now() + timeoutMs;
            record.deadline = setTimeout(() => {
                problem(record, 'Worker timed out');
                stopAll(`${suite} timed out`);
            }, timeoutMs);
        } catch (error) {
            problem(record, 'Worker launch failed', error);
            stopAll(`${suite} launch failed`);
            void closed(null, null);
        }
        return record;
    };
    try {
        for (const name of ['SIGINT', 'SIGTERM']) {
            const handler = () => stopAll(`Parent received ${name}`);
            handlers.set(name, handler);
            process.on(name, handler);
        }
        const attachment = launch('attachment');
        const review = launch('review');
        // Completion never rejects: neither a failed peer nor a pending stdio
        // close can be skipped by an early Promise rejection.
        await Promise.all(records.map((record) => record.completion));
        const errors = records.flatMap((record) => record.problems);
        if (errors.length) {
            const error = new AggregateError(
                errors,
                'Packed-tail checks failed'
            );
            error.cleanupSafe = records.every(
                (record) => record.closed && record.groupGone
            );
            throw error;
        }
        return { attachment: attachment.report, review: review.report };
    } finally {
        for (const [name, handler] of handlers) process.off(name, handler);
    }
}
