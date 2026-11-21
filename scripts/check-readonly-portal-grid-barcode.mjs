// Open the reported URLs in managed Chrome, or pass --chromium /path/to/chrome.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    accessSync,
    constants,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { build, stop, transformSync } from 'esbuild';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import {
    assertBrowserInputs,
    createArchiveMemberReader,
} from './package-checks.mjs';

const [archiveArg, expectedSha256, outputArg, ...options] =
    process.argv.slice(2);
assert(
    archiveArg && outputArg && /^[0-9a-f]{64}$/.test(expectedSha256 ?? ''),
    'Usage: node scripts/check-readonly-portal-grid-barcode.mjs archive.tgz sha256 output [profile ... | --chromium /path/to/chrome]'
);
const supported = ['18.3.1-esm', '18.3.1-cjs', '19.2.0-esm', '19.2.0-cjs'];
const runnerChrome = options[0] === '--chromium';
const requested = runnerChrome ? [] : options;
const selected = requested.length ? requested : supported;
assert.equal(new Set(selected).size, selected.length);
assert(
    selected.every((id) => supported.includes(id)),
    'Unknown profile'
);
let executablePath;
let scratchRoot = realpathSync(tmpdir());
if (runnerChrome) {
    assert(
        options.length === 2 && isAbsolute(options[1]),
        '--chromium requires an absolute executable and runs all four profiles'
    );
    executablePath = realpathSync(options[1]);
    assert(
        statSync(executablePath).isFile(),
        'Chromium executable must be a file'
    );
    accessSync(executablePath, constants.X_OK);
    scratchRoot = process.env.SDK_PORTAL_BARCODE_SCRATCH_ROOT;
    assert(
        scratchRoot && isAbsolute(scratchRoot),
        'Absolute SDK_PORTAL_BARCODE_SCRATCH_ROOT required for runner Chrome'
    );
    assert.equal(realpathSync(dirname(scratchRoot)), dirname(scratchRoot));
    mkdirSync(scratchRoot, { recursive: true });
    assert.equal(realpathSync(scratchRoot), scratchRoot);
}
const archive = realpathSync(archiveArg);
const sha = (data) => createHash('sha256').update(data).digest('hex');
assert.equal(sha(readFileSync(archive)), expectedSha256);
const member = createArchiveMemberReader({
    archivePath: archive,
    expectedSha256,
});
const output = resolve(outputArg);
const fixture = readFileSync(
    new URL('./readonly-portal-grid-barcode-fixture.mjs', import.meta.url),
    'utf8'
);
const [commit, tree] = execFileSync(
    'git',
    ['rev-parse', 'HEAD', 'HEAD^{tree}'],
    { encoding: 'utf8' }
)
    .trim()
    .split('\n');
const report = {
    source: { commit, tree, fixtureSha256: sha(fixture) },
    archiveSha256: expectedSha256,
    mode: runnerChrome ? 'runner-chrome' : 'managed-browser-fixture',
    profiles: [],
    cleanup: null,
    requests: [],
};
const save = () =>
    writeFileSync(
        join(output, 'install-report.json'),
        JSON.stringify(report, null, 2) + '\n'
    );
const cssRoots = ['readonly-portal-grid.css', 'barcode.css'];
const cssFiles = [
    ...cssRoots,
    'field-presentation.css',
    'html-description.css',
    'complete-readonly-text.css',
    'complete-checkbox.css',
    'complete-clearable-text-input.css',
    'complete-barcode-scanner.css',
];
const page = Buffer.from(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Installed readonly Barcode Grid</title>${cssRoots.map((file) => `<link rel="stylesheet" href="${file}">`).join('')}<h1>Installed readonly Barcode Grid</h1><div id="grid"></div><button id="republish">Republish Grid</button><button id="dispose">Dispose Grid</button><pre id="receipt"></pre><script defer src="probe.js"></script></html>`
);
const assets = new Map();
const server = createServer((req, res) => {
    const asset = req.method === 'GET' && assets.get(req.url);
    report.requests.push({
        method: req.method,
        path: req.url,
        status: asset ? 200 : 404,
    });
    if (!asset) return res.writeHead(404).end();
    res.setHeader('Content-Type', asset.type);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"
    );
    res.end(asset.bytes);
});
const consumers = new Map();
const shutdown = new AbortController();
const requestStop = () =>
    shutdown.abort(new Error('Barcode witness interrupted'));
const end = new Promise((done) => {
    shutdown.signal.addEventListener('abort', done, { once: true });
});

async function addProfile(id, origin, temporary) {
    const [react, format] = id.split('-');
    let consumer = consumers.get(react);
    if (!consumer) {
        const path = join(temporary, react);
        mkdirSync(path);
        writeFileSync(
            join(path, 'package.json'),
            JSON.stringify({
                private: true,
                dependencies: {
                    '@miniextensions/sdk': 'file:' + archive,
                    react,
                    'react-dom': react,
                },
            })
        );
        const installation = installAgeQualifiedConsumer({
            directory: path,
            args: ['install', '--ignore-scripts'],
        });
        assert.equal(installation.archiveSha256, expectedSha256);
        for (const dependency of ['react', 'react-dom']) {
            assert.equal(
                JSON.parse(
                    readFileSync(
                        join(path, 'node_modules', dependency, 'package.json'),
                        'utf8'
                    )
                ).version,
                react
            );
        }
        consumer = { path, installation };
        consumers.set(react, consumer);
    }
    const { path, installation } = consumer;
    const entry = 'probe.' + (format === 'esm' ? 'mjs' : 'cjs');
    writeFileSync(
        join(path, entry),
        transformSync(fixture, { format, loader: 'js', target: 'es2022' }).code
    );
    const bundle = await build({
        absWorkingDir: path,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'iife',
        metafile: true,
        write: false,
    });
    await assertBrowserInputs(bundle.metafile, path);
    const sdk = realpathSync(join(path, 'node_modules/@miniextensions/sdk'));
    const inputs = Object.keys(bundle.metafile.inputs).map((file) =>
        realpathSync(resolve(path, file))
    );
    const entries = ['react', 'ui'].map(
        (name) => 'dist/' + format + '/' + name + '/index.js'
    );
    for (const file of entries) {
        assert(
            inputs.includes(realpathSync(join(sdk, file))),
            'Wrong packed export ' + file
        );
        assert.deepEqual(
            readFileSync(join(sdk, file)),
            member('package/' + file)
        );
    }
    const opposite = format === 'esm' ? 'cjs' : 'esm';
    assert(
        !inputs.some((file) =>
            file.startsWith(join(sdk, 'dist', opposite) + '/')
        ),
        'Mixed SDK formats'
    );
    const prefix = '/' + id + '/';
    const css = Object.fromEntries(
        cssFiles.map((name) => {
            const file = 'dist/esm/react/' + name;
            const bytes = readFileSync(join(sdk, file));
            assert.deepEqual(bytes, member('package/' + file));
            assets.set(prefix + name, { type: 'text/css', bytes });
            return [file, sha(bytes)];
        })
    );
    const js = bundle.outputFiles[0].contents;
    assets.set(prefix, { type: 'text/html; charset=utf-8', bytes: page });
    assets.set(prefix + 'probe.js', { type: 'text/javascript', bytes: js });
    report.profiles.push({
        id,
        react,
        format,
        entries,
        installation,
        css,
        bundleSha256: sha(js),
    });
    save();
    console.log(
        JSON.stringify({
            id,
            url: origin + prefix,
            archiveSha256: expectedSha256,
        })
    );
}

async function verifyChromeProfile(browser, profile, origin) {
    const prefix = `/${profile.id}/`;
    const url = origin + prefix;
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const evidence = {
        status: 'started',
        checkpoints: [],
        requests: [],
        responses: [],
        navigations: [],
        denied: [],
        requestFailures: [],
        pageErrors: [],
        popups: 0,
    };
    profile.browser = evidence;
    const routes = new Map([
        [prefix, 'document'],
        [prefix + 'probe.js', 'script'],
        ...cssFiles.map((file) => [prefix + file, 'stylesheet']),
    ]);
    try {
        await context.route('**/*', (route) => {
            const request = route.request();
            const target = new URL(request.url());
            const path = target.pathname + target.search;
            const type = request.resourceType();
            if (
                request.url() === origin + path &&
                request.method() === 'GET' &&
                routes.get(path) === type
            ) {
                evidence.requests.push(path);
                return route.continue();
            }
            evidence.denied.push({ method: request.method(), path, type });
            return route.abort();
        });
        const page = await context.newPage();
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame())
                evidence.navigations.push(frame.url());
        });
        page.on('response', (response) => {
            evidence.responses.push({
                url: response.url(),
                status: response.status(),
            });
        });
        page.on('requestfailed', (request) =>
            evidence.requestFailures.push(request.url())
        );
        page.on('pageerror', (error) =>
            evidence.pageErrors.push(error.message)
        );
        page.on('popup', () => evidence.popups++);
        const readReceipt = async () =>
            JSON.parse(await page.locator('#receipt').textContent());
        const grid = page.getByRole('table', { name: 'Records', exact: true });
        const destination = 'https://example.invalid/scan/00042';
        const link = grid.getByRole('link', { name: destination, exact: true });
        const verifyIdle = async (after) => {
            const controls = await page
                .locator(
                    '#grid :is(input,button,select,textarea,[contenteditable="true"],[role="button"],[aria-selected="true"]), dialog, [role="dialog"], video'
                )
                .count();
            const focus = await page.evaluate(
                () => document.activeElement?.tagName
            );
            assert.equal(controls, 0, `Unexpected control after ${after}`);
            assert.equal(focus, 'BODY', `Unexpected focus after ${after}`);
            assert.equal(
                page.url(),
                url,
                `Unexpected navigation after ${after}`
            );
            assert.equal(await grid.getByRole('link').count(), 1);
            evidence.checkpoints.push({ after, controls, focus });
        };
        const response = await page.goto(url);
        assert(response?.ok(), `Barcode fixture did not load at ${url}`);
        const leading = grid.getByRole('cell', {
            name: '0000042189',
            exact: true,
        });
        await leading.waitFor({ state: 'visible' });
        evidence.receipt = await readReceipt();
        assert.equal(evidence.receipt.error, null);
        assert(evidence.receipt.initial.cameraGuard);
        assert.equal(await link.getAttribute('href'), destination);
        assert.equal(await link.getAttribute('target'), '_blank');
        evidence.link = {
            name: destination,
            href: destination,
            target: '_blank',
        };
        for (const name of ['Empty Keep 4', 'Null Keep 5', 'Omitted Keep 6']) {
            const row = grid.getByRole('row', { name, exact: true });
            assert.equal(
                await row.getByRole('cell', { name: '', exact: true }).count(),
                1
            );
        }
        await verifyIdle('initial');
        await leading.click();
        await verifyIdle('click');
        await page.keyboard.press('Enter');
        await verifyIdle('Enter');
        await page.keyboard.press('Escape');
        await verifyIdle('Escape');
        await page
            .getByRole('button', { name: 'Republish Grid', exact: true })
            .click();
        await page
            .getByRole('button', { name: 'Dispose Grid', exact: true })
            .click();
        evidence.receipt = await readReceipt();
        const { react, error, republished, disposed } = evidence.receipt;
        assert.equal(react, profile.react);
        assert.equal(error, null);
        assert.equal(republished.stableNodes, 24);
        assert.deepEqual(republished.trusted, {
            click: 1,
            Enter: 1,
            Escape: 1,
        });
        assert.equal(disposed.gridSubscriptions, 0);
        assert.equal(disposed.hostSubscriptions, 0);
        assert.equal(disposed.renderedChildren, 0);
        assert(Object.values(disposed.effects).every((value) => value === 0));
        assert.equal(await grid.count(), 0);
        assert.equal(page.url(), url);
        assert.equal(context.pages().length, 1);
        assert.equal(evidence.popups, 0);
        assert.deepEqual(evidence.navigations, [url]);
        assert.deepEqual(evidence.requestFailures, []);
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.denied, []);
        assert.deepEqual(
            [...new Set(evidence.requests)].sort(),
            [...routes.keys()].sort()
        );
        assert(evidence.responses.every(({ status }) => status === 200));
        assert.deepEqual(
            [...new Set(evidence.responses.map(({ url }) => url))].sort(),
            [...routes.keys()].map((path) => origin + path).sort()
        );
        evidence.status = 'passed';
    } finally {
        await context.close();
        save();
    }
}

async function verifyRunnerChrome(origin) {
    const { chromium } = await import('playwright');
    shutdown.signal.throwIfAborted();
    const browser = await chromium.launch({
        executablePath,
        headless: true,
        chromiumSandbox: true,
        timeout: 15000,
    });
    const closeOnStop = () => void browser.close().catch(() => {});
    shutdown.signal.addEventListener('abort', closeOnStop, { once: true });
    try {
        report.chromiumVersion = browser.version();
        for (const profile of report.profiles) {
            shutdown.signal.throwIfAborted();
            await verifyChromeProfile(browser, profile, origin);
        }
        shutdown.signal.throwIfAborted();
        assert.deepEqual(
            report.requests.filter(({ status }) => status !== 200),
            []
        );
    } finally {
        shutdown.signal.removeEventListener('abort', closeOnStop);
        await browser.close();
    }
}

mkdirSync(output);
// The short owned child keeps Chrome's singleton socket within its path limit.
const temporary = realpathSync(
    mkdtempSync(join(scratchRoot, runnerChrome ? 'b-' : 'sdk-barcode-grid-'))
);
process.once('SIGTERM', requestStop);
process.once('SIGINT', requestStop);
try {
    if (runnerChrome) {
        Object.assign(process.env, {
            TMPDIR: temporary,
            TMP: temporary,
            TEMP: temporary,
            XDG_CACHE_HOME: join(temporary, 'cache'),
            XDG_CONFIG_HOME: join(temporary, 'config'),
            npm_config_cache: join(temporary, 'npm-cache'),
        });
    }
    await new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(0, '127.0.0.1', done);
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    writeFileSync(join(output, 'origin.txt'), origin + '\n');
    console.log(origin, 'PID', process.pid);
    for (const id of selected) {
        if (shutdown.signal.aborted) break;
        await addProfile(id, origin, temporary);
    }
    if (runnerChrome) {
        shutdown.signal.throwIfAborted();
        await verifyRunnerChrome(origin);
    } else {
        await end;
    }
} catch (error) {
    report.failure = error.message;
    throw error;
} finally {
    process.off('SIGTERM', requestStop);
    process.off('SIGINT', requestStop);
    await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
    });
    await stop();
    rmSync(temporary, { recursive: true });
    report.cleanup = { loopback: 'closed', consumers: 'removed' };
    save();
}
