// Installed sandboxed Chromium proof, separate from shared package registration.
// node scripts/check-readonly-portal-grid-autonumber.mjs <tgz> <sha256> <new results dir> <chromium>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
    existsSync,
    mkdirSync,
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
import {
    assertBrowserInputs,
    createArchiveMemberReader,
} from './package-checks.mjs';

const [archivePath, expectedSha256, outputPath, chromePath] =
    process.argv.slice(2);
assert(archivePath && expectedSha256 && outputPath && chromePath);
assert.match(expectedSha256, /^[a-f0-9]{64}$/);
const digest = (content) => createHash('sha256').update(content).digest('hex');
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
const [commit, tree] = execFileSync(
    'git',
    ['rev-parse', 'HEAD', 'HEAD^{tree}'],
    { encoding: 'utf8' }
)
    .trim()
    .split('\n');
const report = {
    source: { commit, tree, fixtureSha256: digest(fixture) },
    package: { sha256: expectedSha256, bytes: archiveBytes.length },
    executablePath,
    chromiumSandbox: true,
    profiles: [],
    cleanup: {},
    stage: 'consumer preparation',
};
mkdirSync(output);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'a-')));
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
    try {
        if (browser) {
            await browser.close();
            report.cleanup.browserClosed = !browser.isConnected();
        }
    } finally {
        try {
            if (server.listening) {
                server.close();
                server.closeAllConnections();
                await once(server, 'close');
            }
            report.cleanup.loopbackClosed = !server.listening;
            await stop();
            report.cleanup.esbuildStopped = true;
        } finally {
            rmSync(scratch, { recursive: true, force: true });
            report.cleanup.scratchRemoved = !existsSync(scratch);
            writeFileSync(
                join(output, 'report.json'),
                JSON.stringify(report, null, 2) + '\n',
                { flag: 'wx' }
            );
        }
    }
}
