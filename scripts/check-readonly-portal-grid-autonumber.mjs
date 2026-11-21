// Installed sandboxed Chromium proof, with same-run admission in Actions.
// node scripts/check-readonly-portal-grid-autonumber.mjs <tgz> <sha256> <new results dir> <chromium>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { build, stop, transformSync } from 'esbuild';
import { chromium } from 'playwright';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import {
    assertBrowserInputs,
    createArchiveMemberReader,
} from './package-checks.mjs';

const [commit, tree] = execFileSync(
    'git',
    ['rev-parse', 'HEAD', 'HEAD^{tree}'],
    { encoding: 'utf8' }
)
    .trim()
    .split('\n');
const digest = (content) => createHash('sha256').update(content).digest('hex');

function managedInputs(env) {
    const absolute = (name) => {
        assert(isAbsolute(env[name] ?? ''), `Missing absolute ${name}`);
        return resolve(env[name]);
    };
    const regular = (path) => {
        assert(lstatSync(path).isFile() && realpathSync(path) === path);
        return readFileSync(path);
    };
    assert.equal(env.GITHUB_ACTIONS, 'true');
    assert.equal(process.platform, 'linux');
    assert.equal(env.GITHUB_SHA, commit);
    assert.match(env.GITHUB_RUN_ID ?? '', /^\d+$/);
    assert.match(env.GITHUB_RUN_ATTEMPT ?? '', /^[1-9]\d*$/);
    assert(['push', 'pull_request'].includes(env.GITHUB_EVENT_NAME));
    const ci = {
        repository: env.GITHUB_REPOSITORY,
        event: env.GITHUB_EVENT_NAME,
        runId: env.GITHUB_RUN_ID,
        runAttempt: env.GITHUB_RUN_ATTEMPT,
        workflowSha: commit,
        node: process.version,
    };
    if (ci.event === 'pull_request') {
        assert.match(env.SDK_PR_HEAD_SHA ?? '', /^[a-f0-9]{40}$/);
        ci.pullRequestHeadSha = env.SDK_PR_HEAD_SHA;
    }
    const directory = absolute('SDK_NATIVE_PACKAGE_DIR');
    const kit = JSON.parse(regular(join(directory, 'artifact-receipt.json')));
    assert.equal(kit.schemaVersion, 1);
    assert.equal(kit.verification?.outcome, 'passed');
    assert.deepEqual(kit.source, { commit, tree });
    assert.deepEqual(kit.ci, ci);
    const { name, filename, bytes, sha256 } = kit.package;
    assert.equal(name, '@miniextensions/sdk');
    assert.deepEqual(
        readdirSync(directory).filter((file) => file.endsWith('.tgz')),
        [filename]
    );
    const archive = join(directory, filename);
    const archiveBytes = regular(archive);
    assert.equal(archiveBytes.length, bytes);
    assert.equal(digest(archiveBytes), sha256);
    return {
        args: [
            archive,
            sha256,
            absolute('SDK_NATIVE_RESULT_DIR'),
            '/usr/bin/google-chrome',
        ],
        scratchRoot: absolute('SDK_NATIVE_SCRATCH_DIR'),
        ci,
    };
}

const params = process.argv.slice(2);
const managed =
    params.length === 1 && params[0] === '--ci'
        ? managedInputs(process.env)
        : null;
const [archivePath, expectedSha256, outputPath, chromePath] =
    managed?.args ?? params;
assert(archivePath && expectedSha256 && outputPath && chromePath);
assert.match(expectedSha256, /^[a-f0-9]{64}$/);
const archive = realpathSync(archivePath);
const archiveBytes = readFileSync(archive);
assert.equal(digest(archiveBytes), expectedSha256);
const executablePath = realpathSync(chromePath);
const output = resolve(outputPath);
const readArchive = createArchiveMemberReader({
    archivePath: archive,
    expectedSha256,
});
const fixture = readFileSync(
    new URL('./readonly-portal-grid-autonumber-fixture.mjs', import.meta.url),
    'utf8'
);
const report = {
    source: { commit, tree, fixtureSha256: digest(fixture) },
    ...(managed && { ci: managed.ci }),
    package: { sha256: expectedSha256, bytes: archiveBytes.length },
    executablePath,
    chromiumSandbox: true,
    profiles: [],
    cleanup: {},
    stage: 'consumer preparation',
};
mkdirSync(output);
const scratchRoot = managed?.scratchRoot ?? realpathSync(tmpdir());
if (managed && !existsSync(scratchRoot)) mkdirSync(scratchRoot);
assert(
    lstatSync(scratchRoot).isDirectory() &&
        realpathSync(scratchRoot) === scratchRoot
);
const scratch = mkdtempSync(join(scratchRoot, 'a-'));
const cssNames = [
    'readonly-portal-grid.css',
    'field-presentation.css',
    'html-description.css',
    'complete-readonly-text.css',
    'complete-checkbox.css',
];
const html =
    '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Installed AutoNumber Grid</title><link rel="icon" href="data:,"><link rel="stylesheet" href="readonly-portal-grid.css"><link rel="stylesheet" href="complete-readonly-text.css"><main><div id="grid"></div><button type="button" id="republish">Republish Grid</button><button type="button" id="dispose">Dispose Grid</button></main><pre id="receipt" hidden></pre><script defer src="fixture.js"></script></html>';
const assets = new Map();

async function prepare(react, directory, installation, format) {
    const entry = `fixture.${format === 'esm' ? 'mjs' : 'cjs'}`;
    writeFileSync(
        join(directory, entry),
        transformSync(fixture, { format, loader: 'js' }).code
    );
    const bundle = await build({
        entryPoints: [entry],
        absWorkingDir: directory,
        bundle: true,
        platform: 'browser',
        format: 'iife',
        metafile: true,
        write: false,
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await assertBrowserInputs(bundle.metafile, directory);
    const sdk = realpathSync(
        join(directory, 'node_modules/@miniextensions/sdk')
    );
    const inputs = Object.keys(bundle.metafile.inputs).map((input) =>
        realpathSync(resolve(directory, input))
    );
    const members = ['react', 'ui', 'formulas'].map(
        (surface) => `dist/${format}/${surface}/index.js`
    );
    for (const member of members) {
        assert(
            inputs.includes(realpathSync(join(sdk, member))),
            `Did not bundle ${member}`
        );
        assert.deepEqual(
            readFileSync(join(sdk, member)),
            readArchive(`package/${member}`)
        );
    }
    const other = format === 'esm' ? 'cjs' : 'esm';
    assert(
        !inputs.some((input) => input.startsWith(join(sdk, `dist/${other}/`))),
        'Mixed SDK export conditions'
    );
    const path = `/${react}-${format}/`;
    assets.set(path, { bytes: html, type: 'text/html' });
    for (const name of cssNames) {
        const member = `dist/esm/react/${name}`;
        const bytes = readFileSync(join(sdk, member));
        assert.deepEqual(bytes, readArchive(`package/${member}`));
        assets.set(path + basename(name), { bytes, type: 'text/css' });
    }
    const script = bundle.outputFiles[0].contents;
    assets.set(path + 'fixture.js', { bytes: script, type: 'text/javascript' });
    report.profiles.push({
        react,
        format,
        path,
        installation,
        members,
        bundleSha256: digest(script),
    });
}

const server = createServer((request, response) => {
    const asset = request.method === 'GET' && assets.get(request.url);
    if (!asset) return response.writeHead(404).end();
    response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': asset.type,
        'Content-Security-Policy':
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    response.end(asset.bytes);
});

async function measure(browser, origin, profile) {
    const context = await browser.newContext({
        viewport: { width: 1000, height: 760 },
        serviceWorkers: 'block',
    });
    const requests = [];
    const refused = [];
    const errors = [];
    try {
        await context.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                url.origin === origin &&
                url.pathname.startsWith(profile.path) &&
                !url.search &&
                request.method() === 'GET' &&
                assets.has(url.pathname) &&
                ['document', 'script', 'stylesheet'].includes(
                    request.resourceType()
                )
            ) {
                requests.push(url.pathname);
                return route.continue();
            }
            refused.push([request.method(), url.origin, url.pathname]);
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin + profile.path);
        const positive = page.getByRole('cell', {
            name: '1234567',
            exact: true,
        });
        await positive.click();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Escape');
        await page
            .getByRole('button', { name: 'Republish Grid', exact: true })
            .click();
        await page
            .getByRole('button', { name: 'Dispose Grid', exact: true })
            .click();
        const receipt = JSON.parse(
            await page.locator('#receipt').textContent()
        );
        profile.receipt = receipt;
        assert.equal(receipt.react, profile.react);
        assert.equal(receipt.error, null);
        assert.equal(receipt.initial.cells.length, 4);
        assert.equal(receipt.republished.retained, 16);
        assert.equal(receipt.disposed.listeners, 0);
        assert.deepEqual(refused, []);
        assert.deepEqual(errors, []);
        assert(requests.includes(profile.path + 'readonly-portal-grid.css'));
        assert(requests.includes(profile.path + 'fixture.js'));
        profile.status = 'passed';
    } finally {
        profile.network = { requests, refused, errors };
        await context.close();
        profile.contextClosed = true;
    }
}

let browser;
try {
    assert(
        Buffer.byteLength(scratch) <= 60,
        'Scratch path too long for sandboxed Chromium sockets'
    );
    for (const react of ['18.3.1', '19.2.0']) {
        const directory = join(scratch, react);
        mkdirSync(directory);
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                dependencies: {
                    '@miniextensions/sdk': `file:${archive}`,
                    react,
                    'react-dom': react,
                },
            })
        );
        const installation = installAgeQualifiedConsumer({
            directory,
            args: ['install', '--ignore-scripts'],
        });
        assert.equal(installation.archiveSha256, expectedSha256);
        for (const name of ['react', 'react-dom']) {
            const peer = JSON.parse(
                readFileSync(
                    join(directory, 'node_modules', name, 'package.json'),
                    'utf8'
                )
            );
            assert.equal(peer.version, react);
        }
        for (const format of ['esm', 'cjs'])
            await prepare(react, directory, installation, format);
    }
    report.stage = 'loopback';
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    report.stage = 'chromium startup';
    browser = await chromium.launch({
        executablePath,
        headless: true,
        chromiumSandbox: true,
        env: {
            ...process.env,
            TMPDIR: scratch,
            XDG_CACHE_HOME: join(scratch, 'cache'),
            XDG_CONFIG_HOME: join(scratch, 'config'),
            XDG_RUNTIME_DIR: scratch,
        },
    });
    report.chromium = browser.version();
    report.stage = 'browser scenario';
    for (const profile of report.profiles)
        await measure(browser, origin, profile);
    report.stage = 'passed';
} catch (error) {
    report.error = error.stack;
    throw error;
} finally {
    const failures = [];
    const finish = async (name, cleanup) => {
        try {
            await cleanup();
            report.cleanup[name] = true;
        } catch (error) {
            report.cleanup[name] = false;
            failures.push(error);
        }
    };
    if (browser)
        await finish('browserClosed', async () => {
            await browser.close();
            assert(!browser.isConnected());
        });
    await finish('loopbackClosed', async () => {
        if (server.listening) {
            const closed = once(server, 'close');
            server.close();
            server.closeAllConnections();
            await closed;
        }
        assert(!server.listening);
    });
    await finish('esbuildStopped', stop);
    if (report.cleanup.browserClosed !== false)
        await finish('scratchRemoved', () => {
            rmSync(scratch, { recursive: true, force: true });
            assert(!existsSync(scratch));
        });
    if (failures.length) {
        if (!report.error) report.stage = 'cleanup';
        report.cleanup.errors = failures.map((error) => error.message);
    }
    writeFileSync(
        join(output, 'report.json'),
        JSON.stringify(report, null, 2) + '\n',
        { flag: 'wx' }
    );
    console.log(
        JSON.stringify({
            stage: report.stage,
            packageSha256: report.package.sha256,
            profiles: report.profiles.map(({ react, format, status }) => ({
                react,
                format,
                status,
            })),
            cleanup: report.cleanup,
        })
    );
    if (failures.length && !report.error)
        throw new AggregateError(failures, 'AutoNumber proof cleanup failed');
}
