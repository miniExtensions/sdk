import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

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
    const alive = (record) => {
        if (!record.pid) return false;
        try {
            process.kill(-record.pid, 0);
            return true;
        } catch (error) {
            if (error.code === 'ESRCH') return false;
            throw error;
        }
    };
    const signal = (record, name) => {
        if (!record.pid) return;
        try {
            process.kill(-record.pid, name);
        } catch (error) {
            if (error.code !== 'ESRCH')
                problem(record, `Cannot send ${name}`, error);
        }
    };
    const stopAll = (reason) => {
        for (const record of records) {
            if (record.groupGone || !record.pid) continue;
            problem(record, reason);
            signal(record, 'SIGTERM');
            record.killTimer ??= setTimeout(
                () => signal(record, 'SIGKILL'),
                terminationGraceMs
            );
            record.drainTimer ??= setTimeout(() => {
                problem(record, 'Worker close/drain timed out');
                if (record.child?.connected) record.child.disconnect();
                record.child?.stdout?.destroy();
                record.child?.stderr?.destroy();
                record.child?.unref();
                record.settle();
            }, terminationGraceMs + drainTimeoutMs);
        }
    };
    const waitGone = async (record, milliseconds) => {
        const deadline = performance.now() + milliseconds;
        while (alive(record) && performance.now() < deadline)
            await delay(
                Math.min(25, Math.max(1, deadline - performance.now()))
            );
        return !alive(record);
    };
    const drain = async (record) => {
        if (await waitGone(record, terminationGraceMs)) return;
        problem(record, 'Process group survived worker close');
        signal(record, 'SIGTERM');
        if (await waitGone(record, terminationGraceMs)) return;
        signal(record, 'SIGKILL');
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
        };
        let complete;
        record.completion = new Promise((resolve) => {
            complete = resolve;
        });
        record.settle = () => {
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
            if (record.problems.length) stopAll(`${suite} worker failed`);
            try {
                await drain(record);
                record.groupGone = true;
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
            child.stdout.pipe(process.stdout, { end: false });
            child.stderr.pipe(process.stderr, { end: false });
            for (const stream of [child.stdout, child.stderr])
                stream.once('error', (error) => {
                    problem(record, 'Worker output error', error);
                    stopAll(`${suite} output failed`);
                });
            child.on('message', (message) => {
                record.messages++;
                try {
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
