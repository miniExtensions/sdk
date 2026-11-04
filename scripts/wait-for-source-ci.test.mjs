import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForSourceCheck } from './wait-for-source-ci.mjs';

const headSha = 'a'.repeat(40);
const source = (status, conclusion = null) => ({
    name: 'source (24)',
    run_id: 42,
    head_sha: headSha,
    status,
    conclusion,
});
const response = (...jobs) => ({ total_count: jobs.length, jobs });
function fixture(responses) {
    let clock = 0;
    let calls = 0;
    return {
        args: {
            query: async () =>
                responses[Math.min(calls++, responses.length - 1)],
            runId: 42,
            headSha,
            now: () => clock,
            sleep: async (ms) => {
                clock += ms;
            },
            timeoutMs: 100,
            intervalMs: 10,
        },
        calls: () => calls,
    };
}

test('waits for the effective source result to succeed', async () => {
    const f = fixture([
        response(),
        response(source('queued')),
        response(source('in_progress')),
        response(source('completed', 'success')),
    ]);
    await waitForSourceCheck(f.args);
    assert.equal(f.calls(), 4);
});

test('accepts a carried-forward successful source result for the same run and revision', async () => {
    const prior = {
        ...source('completed', 'success'),
        started_at: '2026-11-04T01:00:00Z',
        completed_at: '2026-11-04T01:04:00Z',
    };
    await waitForSourceCheck(fixture([response(prior)]).args);
});

test('fails closed on failure, cancellation, skipped and unknown status', async () => {
    for (const conclusion of [
        'failure',
        'cancelled',
        'skipped',
        'timed_out',
        null,
    ]) {
        const f = fixture([response(source('completed', conclusion))]);
        await assert.rejects(waitForSourceCheck(f.args), /did not succeed/);
    }
    await assert.rejects(
        waitForSourceCheck(fixture([response(source('unknown'))]).args),
        /Unexpected/
    );
});

test('fails closed on wrong identity, duplicates and incomplete results', async () => {
    for (const bad of [
        response({ ...source('completed', 'success'), run_id: 43 }),
        response({
            ...source('completed', 'success'),
            head_sha: 'b'.repeat(40),
        }),
        response(
            source('completed', 'success'),
            source('completed', 'success')
        ),
        { total_count: 101, jobs: [] },
        { total_count: 2, jobs: [source('completed', 'success')] },
        null,
    ])
        await assert.rejects(waitForSourceCheck(fixture([bad]).args));
});

test('fails closed on API error or missing job at deadline', async () => {
    const f = fixture([response()]);
    await assert.rejects(waitForSourceCheck(f.args), /Timed out/);
    assert.equal(f.calls(), 10);
    const error = Error('API unavailable');
    await assert.rejects(
        waitForSourceCheck({
            ...f.args,
            query: async () => {
                throw error;
            },
        }),
        (actual) => actual === error
    );
});
