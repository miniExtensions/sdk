import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { build, stop, transformSync } from 'esbuild';
import { chromium } from 'playwright';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import { assertBrowserInputs } from './package-checks.mjs';
import { checkPortalViewLoss } from './portal-view-loss-scenario.mjs';

// node scripts/check-portal-view-loss.mjs mounted|browser <archive> <sha256> <new receipt>
const [mode, archive, expectedSha256, receipt] = process.argv.slice(2);
assert.equal(process.argv.length, 6);
assert(['mounted', 'browser'].includes(mode));
const managedEndpoint = process.env.SDK_PORTAL_VIEW_LOSS_BROWSER_WS;
if (managedEndpoint) {
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    assert.equal(mode, 'browser');
    assert.match(managedEndpoint, /^ws:\/\/127\.0\.0\.1:[1-9]\d*\/[a-f0-9-]+$/);
}
assert.match(expectedSha256, /^[0-9a-f]{64}$/);
const archivePath = realpathSync(archive);
const archiveBytes = readFileSync(archivePath);
const output = resolve(receipt);
assert(!existsSync(output), 'Refuse an existing receipt');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(archiveBytes), expectedSha256);
const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const fixtureSource = read('./portal-view-loss-fixture.mjs');
const scenarioSource = read('./portal-view-loss-scenario.mjs');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const [commit, tree] = git('rev-parse', 'HEAD', 'HEAD^{tree}').split('\n');
const report = {
    mode,
    checkout: { commit, tree, checkoutStatus: git('status', '--porcelain') },
    inputs: { fixture: sha(fixtureSource), scenario: sha(scenarioSource) },
    package: { bytes: archiveBytes.length, sha256: expectedSha256 },
    prepared: [],
    profiles: [],
    stage: 'install',
    cleanup: {},
};
const consumers = new Set();

async function admitManagedTeardown() {
    if (typeof process.send !== 'function') return;
    let dispose;
    try {
        const reply = await new Promise((done, fail) => {
            const disconnected = () =>
                fail(
                    new Error('Worker supervisor disconnected before teardown')
                );
            const timer = setTimeout(
                () => fail(new Error('Worker teardown admission timed out')),
                5000
            );
            dispose = () => {
                clearTimeout(timer);
                process.removeListener('message', done);
                process.removeListener('disconnect', disconnected);
            };
            process.once('message', done);
            process.once('disconnect', disconnected);
            process.send('view-loss:teardown', (error) => {
                if (error) fail(error);
            });
        });
        assert.equal(reply, 'view-loss:teardown-admitted');
    } finally {
        dispose?.();
        if (process.connected) process.disconnect();
    }
}

const mounted = String.raw`
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { act, createElement as h } from 'react';
import { htmlPresentationFixture } from './html-presentation.mjs';
import { createPortalViewLossFixture } from './fixture.mjs';
import { checkPortalViewLoss } from './scenario.mjs';
test('installed Portal retires Reload on view loss and resumes same-view browsing', async t => {
    const dom = await htmlPresentationFixture(t);
    const fixture = createPortalViewLossFixture(dom.container);
    let disposed = false;
    t.after(() => { if (!disposed) fixture.destroy(); });
    await dom.render(h(fixture.App));
    const observations = await checkPortalViewLoss({
        async call(method, ...args) {
            let result;
            await act(async () => { result = await fixture[method](...args); });
            return result;
        },
        async click(name) {
            const buttons = [...dom.container.querySelectorAll('button')].filter(
                button => (button.getAttribute('aria-label') ?? button.textContent) === name
            );
            assert.equal(buttons.length, 1);
            assert.equal(buttons[0].disabled, false);
            await dom.click(buttons[0]);
        },
        observe: fixture.observe,
    });
    await dom.render(null);
    const cleanup = fixture.destroy();
    disposed = true;
    dom.unchangedEffects();
    writeFileSync('mounted.json', JSON.stringify({ observations, cleanup }));
});
`;

const browserEntry = String.raw`
import { createElement as h, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortalViewLossFixture } from './fixture.mjs';
import '@miniextensions/sdk/react/portal-shell.css';
import '@miniextensions/sdk/react/readonly-portal-list.css';
const container = document.querySelector('#app');
const root = createRoot(container);
const fixture = createPortalViewLossFixture(container);
window.portalViewLoss = {
    ...fixture,
    close() {
        root.unmount();
        return fixture.destroy();
    },
};
root.render(h(StrictMode, null, h(fixture.App)));
`;

function mountedProfile(root) {
    writeFileSync(
        join(root, 'html-presentation.mjs'),
        transformSync(read('../test/fixtures/htmlPresentationFixture.ts'), {
            loader: 'ts',
            format: 'esm',
            target: 'es2022',
        }).code
    );
    writeFileSync(join(root, 'scenario.mjs'), scenarioSource);
    writeFileSync(join(root, 'mounted.test.mjs'), mounted);
    const output = execFileSync(
        process.execPath,
        ['--test', '--test-reporter=tap', 'mounted.test.mjs'],
        { cwd: root, encoding: 'utf8', timeout: 120000 }
    );
    assert.match(output, /^# tests 1$/m);
    assert.match(output, /^# pass 1$/m);
    assert.match(output, /^# fail 0$/m);
    return JSON.parse(readFileSync(join(root, 'mounted.json'), 'utf8'));
}

const html =
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Portal view-loss fixture</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><form id="app"></form><script defer src="/app.js"></script></html>';
let browser;
async function browserProfile(root) {
    writeFileSync(join(root, 'browser.mjs'), browserEntry);
    const bundle = await build({
        absWorkingDir: root,
        entryPoints: ['browser.mjs'],
        entryNames: 'app',
        outdir: 'bundle',
        bundle: true,
        format: 'iife',
        platform: 'browser',
        write: false,
        metafile: true,
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await assertBrowserInputs(bundle.metafile, root);
    const assets = new Map([
        ['/', { content: html, type: 'text/html' }],
        ...bundle.outputFiles.map(({ path, contents }) => [
            '/' + basename(path),
            {
                content: contents,
                type: path.endsWith('.css') ? 'text/css' : 'text/javascript',
            },
        ]),
    ]);
    assert.deepEqual([...assets.keys()].sort(), ['/', '/app.css', '/app.js']);
    const served = [];
    const refused = [];
    const errors = [];
    const server = createServer((request, response) => {
        const asset = request.method === 'GET' && assets.get(request.url);
        if (!asset) {
            refused.push([request.method, request.url]);
            response.writeHead(404).end();
            return;
        }
        served.push(request.url);
        response
            .writeHead(200, {
                'content-type': asset.type,
                'cache-control': 'no-store',
            })
            .end(asset.content);
    });
    let context;
    try {
        report.stage = 'loopback';
        await new Promise((ready, fail) => {
            server.once('error', fail);
            server.listen(0, '127.0.0.1', ready);
        });
        const origin = 'http://127.0.0.1:' + server.address().port;
        report.stage = 'chromium';
        browser ??= managedEndpoint
            ? await chromium.connect(managedEndpoint, { timeout: 5000 })
            : await chromium.launch({
                  ...(process.env.SDK_NATIVE_CHROMIUM
                      ? {
                            executablePath: realpathSync(
                                process.env.SDK_NATIVE_CHROMIUM
                            ),
                        }
                      : { channel: 'chrome' }),
                  headless: true,
                  chromiumSandbox: true,
              });
        report.chromium = browser.version();
        report.stage = 'browser-scenario';
        context = await browser.newContext({
            viewport: { width: 1180, height: 900 },
            serviceWorkers: 'block',
        });
        context.setDefaultTimeout(5000);
        await context.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                url.origin === origin &&
                !url.search &&
                assets.has(url.pathname) &&
                request.method() === 'GET' &&
                ['document', 'script', 'stylesheet'].includes(
                    request.resourceType()
                )
            )
                return route.continue();
            refused.push([request.method(), request.url()]);
            return route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(origin);
        await page
            .getByRole('heading', { name: 'Synthetic Orders Portal' })
            .waitFor();
        const observations = await checkPortalViewLoss({
            call: (method, ...args) =>
                page.evaluate(
                    ([method, args]) => window.portalViewLoss[method](...args),
                    [method, args]
                ),
            click: (name) =>
                page.getByRole('button', { name, exact: true }).click(),
            observe: () =>
                page.evaluate(async () => {
                    await new Promise((resolve) =>
                        requestAnimationFrame(() =>
                            requestAnimationFrame(resolve)
                        )
                    );
                    return window.portalViewLoss.observe();
                }),
        });
        const cleanup = await page.evaluate(() =>
            window.portalViewLoss.close()
        );
        assert.deepEqual([...new Set(served)].sort(), [
            '/',
            '/app.css',
            '/app.js',
        ]);
        assert.deepEqual(refused, []);
        assert.deepEqual(errors, []);
        return { observations, cleanup, network: { served, refused, errors } };
    } finally {
        try {
            if (context) await context.close();
        } finally {
            if (server.listening)
                await new Promise((done, fail) =>
                    server.close((error) => (error ? fail(error) : done()))
                );
            assert.equal(server.listening, false);
            report.cleanup.loopbackClosed = true;
        }
    }
}

try {
    for (const react of ['18.3.1', '19.2.0']) {
        const root = realpathSync(
            mkdtempSync(join(tmpdir(), 'sdk-portal-view-loss-'))
        );
        consumers.add(root);
        try {
            report.stage = 'install';
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': 'file:' + archivePath,
                        react,
                        'react-dom': react,
                        ...(mode === 'mounted'
                            ? { 'happy-dom': '20.0.11' }
                            : {}),
                    },
                })
            );
            const installation = installAgeQualifiedConsumer({
                directory: root,
                args: ['install', '--ignore-scripts'],
            });
            assert.equal(installation.archiveSha256, expectedSha256);
            report.prepared.push({ react, installation });
            writeFileSync(join(root, 'fixture.mjs'), fixtureSource);
            report.stage = mode === 'browser' ? 'bundle' : 'mounted-scenario';
            const measured =
                mode === 'browser'
                    ? await browserProfile(root)
                    : mountedProfile(root);
            assert.equal(measured.observations.opened.react, react);
            assert.deepEqual(measured.cleanup, {
                before: 1,
                after: 0,
                pending: 0,
                outcomes: 0,
            });
            report.profiles.push({ react, ...measured });
        } finally {
            rmSync(root, { recursive: true });
            assert(!existsSync(root));
            consumers.delete(root);
        }
    }
} catch (error) {
    report.error = error.stack;
    if (report.stage === 'mounted-scenario' && typeof error.stdout === 'string')
        report.testOutput = error.stdout;
    process.exitCode = 1;
} finally {
    try {
        await admitManagedTeardown();
    } catch (error) {
        report.cleanup.cohortError = error.stack;
        if (!report.error) {
            report.error = error.stack;
            report.stage = 'cleanup';
        }
        process.exitCode = 1;
    }
    try {
        if (browser) {
            await browser.close();
            report.cleanup.browserClosed = !browser.isConnected();
            assert(report.cleanup.browserClosed);
        }
        if (!report.error) report.stage = 'passed';
    } catch (error) {
        report.cleanup.error = error.stack;
        if (!report.error) report.stage = 'cleanup';
        process.exitCode = 1;
    } finally {
        try {
            await stop();
            report.cleanup.esbuildStopped = true;
        } catch (error) {
            report.cleanup.esbuildError = error.stack;
            if (!report.error) report.stage = 'cleanup';
            process.exitCode = 1;
        }
        report.cleanup.consumersRemoved = consumers.size === 0;
        writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {
            flag: 'wx',
        });
    }
}
console.log(
    JSON.stringify({
        stage: report.stage,
        packageSha256: report.package.sha256,
        prepared: report.prepared.map(({ react }) => react),
        passed: report.profiles.map(({ react }) => react),
        cleanup: report.cleanup,
        receipt: output,
    })
);
