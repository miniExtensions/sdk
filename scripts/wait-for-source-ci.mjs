import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Fail closed: a package is publishable only after the source job for this
// exact workflow attempt and revision has completed successfully.
export async function waitForSourceCheck({
    query,
    runId,
    headSha,
    now = () => performance.now(),
    sleep = delay,
    timeoutMs = 15 * 60 * 1000,
    intervalMs = 5000,
}) {
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
        const response = await query();
        if (
            !response ||
            !Number.isSafeInteger(response.total_count) ||
            response.total_count < 0 ||
            response.total_count > 100 ||
            !Array.isArray(response.jobs) ||
            response.jobs.length !== response.total_count
        )
            throw new Error('Invalid or incomplete workflow job response');
        const matching = response.jobs.filter(
            (job) => job.name === 'source (24)'
        );
        if (matching.length > 1) throw new Error('Ambiguous source job');
        if (matching.length === 1) {
            const source = matching[0];
            if (source.run_id !== runId || source.head_sha !== headSha)
                throw new Error('Source job identity mismatch');
            if (source.status === 'completed') {
                if (source.conclusion !== 'success')
                    throw new Error(
                        `Source job did not succeed: ${source.conclusion}`
                    );
                return;
            }
            if (
                ![
                    'queued',
                    'in_progress',
                    'waiting',
                    'pending',
                    'requested',
                ].includes(source.status)
            )
                throw new Error('Unexpected source job status');
        }
        const remaining = deadline - now();
        if (remaining <= 0) break;
        await sleep(Math.min(intervalMs, remaining));
    }
    throw new Error('Timed out waiting for source job; rerun all jobs');
}

async function main() {
    const {
        GITHUB_API_URL,
        GITHUB_REPOSITORY,
        GITHUB_RUN_ID,
        GITHUB_RUN_ATTEMPT,
        GITHUB_SHA,
        SDK_PR_HEAD_SHA,
        GH_TOKEN,
    } = process.env;
    const headSha = SDK_PR_HEAD_SHA || GITHUB_SHA;
    if (
        !/^https:\/\/api\.github\.com$/.test(GITHUB_API_URL ?? '') ||
        !/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY ?? '') ||
        !/^[1-9]\d*$/.test(GITHUB_RUN_ID ?? '') ||
        !/^[1-9]\d*$/.test(GITHUB_RUN_ATTEMPT ?? '') ||
        !/^[0-9a-f]{40}$/.test(headSha ?? '') ||
        !GH_TOKEN
    )
        throw new Error('Invalid workflow identity or missing read token');
    const runId = Number(GITHUB_RUN_ID);
    if (!Number.isSafeInteger(runId)) throw new Error('Invalid workflow run');
    const url = `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}/jobs?per_page=100`;
    await waitForSourceCheck({
        runId,
        headSha,
        query: async () => {
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${GH_TOKEN}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
                signal: AbortSignal.timeout(10000),
            });
            if (!response.ok)
                throw new Error(
                    `Workflow jobs API returned ${response.status}`
                );
            return response.json();
        },
    });
    console.log('Source checks passed for this workflow attempt.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    await main();
