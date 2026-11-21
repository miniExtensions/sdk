import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    rmdirSync,
    writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProcessGroupObserver } from './process-group-observer.mjs';

const fixtureScript = fileURLToPath(
    new URL('./check-portal-view-loss.mjs', import.meta.url)
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const profiles = ['18.3.1', '19.2.0'];
const drained = ({ state }) => state === 'gone' || state === 'exited';

function regular(path) {
    assert(
        lstatSync(path).isFile() && realpathSync(path) === path,
        'Expected a regular file'
    );
    return readFileSync(path);
}

function absolute(env, key) {
    assert(isAbsolute(env[key] ?? ''), key + ' must be absolute');
    return resolve(env[key]);
}

function checkedKit(env, root) {
    const kit = JSON.parse(regular(join(root, 'artifact-receipt.json')));
    const [commit, tree] = execFileSync(
        'git',
        ['rev-parse', 'HEAD', 'HEAD^{tree}'],
        {
            encoding: 'utf8',
        }
    )
        .trim()
        .split('\n');
    assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
    assert.equal(commit, env.GITHUB_SHA);
    assert.match(env.GITHUB_RUN_ID ?? '', /^\d+$/);
    assert.match(env.GITHUB_RUN_ATTEMPT ?? '', /^[1-9]\d*$/);
    assert(['push', 'pull_request'].includes(env.GITHUB_EVENT_NAME));
    assert.equal(kit.schemaVersion, 1);
    assert.equal(kit.verification?.outcome, 'passed');
    assert.deepEqual(kit.source, { commit, tree });
    const expectedCi = {
        repository: env.GITHUB_REPOSITORY,
        event: env.GITHUB_EVENT_NAME,
        runId: env.GITHUB_RUN_ID,
        runAttempt: env.GITHUB_RUN_ATTEMPT,
        workflowSha: commit,
        ...(env.GITHUB_EVENT_NAME === 'pull_request'
            ? { pullRequestHeadSha: env.SDK_PR_HEAD_SHA }
            : {}),
        node: process.version,
    };
    if (env.GITHUB_EVENT_NAME === 'pull_request')
        assert.match(env.SDK_PR_HEAD_SHA ?? '', /^[a-f0-9]{40}$/);
    assert.deepEqual(kit.ci, expectedCi);
    const { name, filename, bytes, sha256 } = kit.package;
    assert.equal(name, '@miniextensions/sdk');
    assert.equal(basename(filename), filename);
    assert.deepEqual(
        readdirSync(root).filter((file) => file.endsWith('.tgz')),
        [filename]
    );
    const archive = join(root, filename);
    const input = regular(archive);
    assert.equal(input.length, bytes);
    assert.equal(digest(input), sha256);
    return { archive, package: kit.package, source: kit.source, ci: kit.ci };
}

async function waitForObservation(observe, accepts, timeout) {
    const deadline = performance.now() + timeout;
    do {
        const result = await observe();
        if (accepts(result)) return result;
        await delay(25);
    } while (performance.now() < deadline);
    return null;
}

async function signalAndDrain(observer, name, timeout) {
    let sent;
    return waitForObservation(
        async () => {
            if (!sent || sent.state === 'unresolved')
                sent = await observer.signal(name);
            return drained(sent) ? sent : observer.inspect();
        },
        drained,
        timeout
    );
}

export async function runOwnedWorker(args, env, signal, entry = fixtureScript) {
    signal.throwIfAborted();
    const child = spawn(process.execPath, [entry, ...args], {
        env,
        detached: true,
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    const finished = new Promise((done) => {
        child.once('error', (error) => done({ error }));
        child.once('close', (code, signal) => done({ code, signal }));
    });
    if (!child.pid)
        throw new Error('Worker did not spawn', {
            cause: (await finished).error,
        });
    const observer = createProcessGroupObserver({ pid: child.pid });
    let teardown;
    let teardownAdmitted = false;
    child.once('message', (message) => {
        teardown = (async () => {
            if (message === 'view-loss:teardown' && !signal.aborted) {
                const captured = await waitForObservation(
                    observer.capture,
                    ({ state }) => state === 'live',
                    2000
                );
                teardownAdmitted = Boolean(captured) && !signal.aborted;
            }
            if (child.connected)
                await new Promise((done, fail) =>
                    child.send(
                        teardownAdmitted
                            ? 'view-loss:teardown-admitted'
                            : 'view-loss:teardown-refused',
                        (error) => (error ? fail(error) : done())
                    )
                );
        })().catch((error) => {
            teardownAdmitted = false;
            return error;
        });
    });
    let stop;
    const cancelled = new Promise((done) => {
        stop = () => done({ error: signal.reason });
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) stop();
    });
    let passed = false;
    try {
        const captured = await waitForObservation(
            observer.capture,
            ({ state }) => state === 'live' || state === 'gone',
            2000
        );
        assert(captured, 'Worker ownership is unresolved');
        const result = await Promise.race([finished, cancelled]);
        if (result.error) throw result.error;
        assert.equal(
            result.code,
            0,
            'View-loss worker stopped with ' + (result.signal ?? result.code)
        );
        if (entry === fixtureScript)
            assert(
                teardownAdmitted,
                'Worker teardown ownership was not admitted'
            );
        passed = true;
    } finally {
        signal.removeEventListener('abort', stop);
        let neededStop = false;
        try {
            await teardown;
            if (!(await waitForObservation(observer.inspect, drained, 500))) {
                neededStop = true;
                if (!(await signalAndDrain(observer, 'SIGTERM', 2000)))
                    assert(
                        await signalAndDrain(observer, 'SIGKILL', 3000),
                        'Worker process group did not drain: ' +
                            (observer.getEvidence()?.reason ??
                                'group stayed live')
                    );
            }
        } catch (error) {
            error.cleanupSafe = false;
            child.unref();
            throw error;
        } finally {
            observer.dispose();
        }
        assert(
            !(passed && neededStop),
            'Process group survived successful worker close'
        );
    }
}

async function closeBrowser(server) {
    const completed = async (operation) => {
        let timer;
        try {
            return await Promise.race([
                operation.then(
                    () => true,
                    () => false
                ),
                new Promise((done) => {
                    timer = setTimeout(() => done(false), 5000);
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    };
    const closed = await completed(server.close());
    if (!closed)
        assert(
            await completed(server.kill()),
            'Owned Chrome did not exit after hard stop'
        );
    const { exitCode, signalCode } = server.process();
    assert(
        exitCode !== null || signalCode !== null,
        'Owned Chrome has no process exit receipt'
    );
    return { closed, exitCode, signalCode };
}

function verifyReceipt(path, mode, qualified) {
    const report = JSON.parse(regular(path));
    assert.equal(report.mode, mode);
    assert.equal(report.stage, 'passed');
    assert.equal(report.checkout.commit, qualified.source.commit);
    assert.equal(report.checkout.tree, qualified.source.tree);
    assert.equal(report.checkout.checkoutStatus, '');
    assert.equal(report.package.sha256, qualified.package.sha256);
    assert.equal(report.package.bytes, qualified.package.bytes);
    assert.deepEqual(
        report.prepared.map(({ react }) => react),
        profiles
    );
    assert.deepEqual(
        report.profiles.map(({ react }) => react),
        profiles
    );
    for (const { installation } of report.prepared)
        assert.equal(installation.archiveSha256, qualified.package.sha256);
    assert.equal(report.cleanup.consumersRemoved, true);
    assert.equal(report.cleanup.esbuildStopped, true);
    if (mode === 'browser') {
        assert.equal(report.cleanup.loopbackClosed, true);
        assert.equal(report.cleanup.browserClosed, true);
    }
}

async function run() {
    const env = process.env;
    assert.equal(env.GITHUB_ACTIONS, 'true');
    assert.equal(process.platform, 'linux');
    const qualified = checkedKit(env, absolute(env, 'SDK_NATIVE_PACKAGE_DIR'));
    const results = absolute(env, 'SDK_NATIVE_RESULT_DIR');
    const scratchRoot = absolute(env, 'SDK_NATIVE_SCRATCH_DIR');
    const executablePath = realpathSync(absolute(env, 'SDK_NATIVE_CHROMIUM'));
    assert(!existsSync(results), 'Refuse existing view-loss results');
    mkdirSync(results);
    const ownsScratchRoot = !existsSync(scratchRoot);
    if (ownsScratchRoot) mkdirSync(scratchRoot);
    assert(
        lstatSync(scratchRoot).isDirectory() &&
            realpathSync(scratchRoot) === scratchRoot
    );
    const scratch = mkdtempSync(join(scratchRoot, 'v'));
    const summary = {
        source: qualified.source,
        ci: qualified.ci,
        package: qualified.package,
        startedAt: new Date().toISOString(),
        stages: [],
        cleanup: {},
        status: 'failed',
    };
    const controller = new AbortController();
    const interrupt = () =>
        controller.abort(new Error('View-loss proof interrupted'));
    const deadline = setTimeout(
        () => controller.abort(new Error('View-loss proof timed out')),
        240000
    );
    for (const name of ['SIGINT', 'SIGTERM']) process.on(name, interrupt);
    let server,
        cleanupSafe = true;
    try {
        // Chrome uses this directory for its Unix socket. Keep it short and
        // allocate children inside the workflow's always-cleaned scratch root.
        assert(
            Buffer.byteLength(scratch) <= 60,
            'Scratch path too long for sandboxed Chromium sockets'
        );
        Object.assign(env, {
            TMPDIR: scratch,
            TMP: scratch,
            TEMP: scratch,
            XDG_CACHE_HOME: join(scratch, 'cache'),
            XDG_CONFIG_HOME: join(scratch, 'config'),
            XDG_RUNTIME_DIR: scratch,
            npm_config_cache: join(scratch, 'npm-cache'),
        });
        for (const mode of ['mounted', 'browser']) {
            controller.signal.throwIfAborted();
            const receipt = join(results, mode + '.json');
            const stage = {
                mode,
                receipt: basename(receipt),
                startedAt: new Date().toISOString(),
            };
            summary.stages.push(stage);
            const workerEnv = { ...env, SDK_PORTAL_VIEW_LOSS_BROWSER_WS: '' };
            if (mode === 'browser') {
                const { chromium } = await import('playwright');
                server = await chromium.launchServer({
                    host: '127.0.0.1',
                    port: 0,
                    executablePath,
                    headless: true,
                    chromiumSandbox: true,
                    timeout: 30000,
                    handleSIGINT: false,
                    handleSIGTERM: false,
                });
                workerEnv.SDK_PORTAL_VIEW_LOSS_BROWSER_WS = server.wsEndpoint();
            }
            await runOwnedWorker(
                [mode, qualified.archive, qualified.package.sha256, receipt],
                workerEnv,
                controller.signal
            );
            verifyReceipt(receipt, mode, qualified);
            Object.assign(stage, {
                profiles,
                completedAt: new Date().toISOString(),
            });
        }
        controller.signal.throwIfAborted();
        assert.equal(
            digest(regular(qualified.archive)),
            qualified.package.sha256
        );
    } catch (error) {
        cleanupSafe = error.cleanupSafe !== false;
        summary.error = error.stack;
        throw error;
    } finally {
        clearTimeout(deadline);
        try {
            if (server) summary.cleanup.browser = await closeBrowser(server);
        } catch (error) {
            cleanupSafe = false;
            summary.cleanup.error = error.stack;
            throw error;
        } finally {
            try {
                if (cleanupSafe)
                    rmSync(scratch, { recursive: true, force: true });
                summary.cleanup.scratchRemoved = !existsSync(scratch);
                assert(
                    summary.cleanup.scratchRemoved,
                    'Process cleanup unresolved; owned scratch was left to the workflow cleanup step'
                );
                if (ownsScratchRoot) rmdirSync(scratchRoot);
                if (summary.cleanup.browser)
                    assert.deepEqual(
                        summary.cleanup.browser,
                        { closed: true, exitCode: 0, signalCode: null },
                        'Browser did not close cleanly'
                    );
                if (!summary.error) summary.status = 'passed';
            } catch (error) {
                summary.cleanup.error ??= error.stack;
                throw error;
            } finally {
                for (const name of ['SIGINT', 'SIGTERM'])
                    process.removeListener(name, interrupt);
                summary.completedAt = new Date().toISOString();
                writeFileSync(
                    join(results, 'qualification.json'),
                    JSON.stringify(summary, null, 2) + '\n',
                    { flag: 'wx' }
                );
            }
        }
    }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
    await run();
