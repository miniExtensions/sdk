import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build, stop } from 'esbuild';
import { chromium } from 'playwright';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import { assertCSVBrowserInputs } from './csv-export-consumer-checks.mjs';
import {
    assertBrowserInputs,
    createArchiveMemberReader,
} from './package-checks.mjs';

const fileName = 'Synthetic Grid.csv';
const expected = Buffer.from(
    'Company,Region\n"Zoë, ""Z""","Blue\nGreen"\nAmber,West\n'
);
const profiles = ['18.3.1', '19.2.0'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixture = readFileSync(
    new URL('./readonly-portal-grid-csv-download-fixture.mjs', import.meta.url)
);
const html =
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Installed Grid and CSV export</title><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="./app.css"><div id="root"></div><button type="button" id="finish-fixture">Finish fixture</button><pre id="fixture-receipt" hidden></pre><pre id="cleanup-receipt" hidden></pre><script defer src="./app.js"></script></html>';

function regularFile(path) {
    const absolute = resolve(path);
    assert(lstatSync(absolute).isFile());
    assert.equal(realpathSync(absolute), absolute, 'Refuse redirected input');
    return absolute;
}

async function prepare(directory, archive, readMember, evidence) {
    writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({
            private: true,
            type: 'module',
            dependencies: {
                '@miniextensions/sdk': `file:${archive}`,
                react: evidence.react,
                'react-dom': evidence.react,
            },
        })
    );
    evidence.installation = installAgeQualifiedConsumer({
        directory,
        args: ['install'],
    });
    const require = createRequire(join(directory, 'package.json'));
    assert.equal(require('react/package.json').version, evidence.react);
    assert.equal(require('react-dom/package.json').version, evidence.react);
    const installed = realpathSync(
        join(directory, 'node_modules/@miniextensions/sdk')
    );
    writeFileSync(join(directory, 'fixture.mjs'), fixture);
    const bundle = await build({
        absWorkingDir: directory,
        entryPoints: ['fixture.mjs'],
        outfile: 'app.js',
        bundle: true,
        write: false,
        metafile: true,
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await assertBrowserInputs(bundle.metafile, directory);
    assertCSVBrowserInputs(bundle.metafile);
    const inputNames = Object.keys(bundle.metafile.inputs);
    evidence.installedMembers = inputNames.flatMap((name) => {
        const path = realpathSync(resolve(directory, name));
        if (!path.startsWith(installed + '/')) return [];
        const member = 'package/' + relative(installed, path);
        const content = readFileSync(path);
        assert.deepEqual(content, readMember(member));
        return [{ member, sha256: sha256(content) }];
    });
    for (const name of [
        'react/ReadonlyPortalGrid.js',
        'react/CSVExportButton.js',
        'react/csv-export.css',
        'react/readonly-portal-grid.css',
        'portals/csvExport.js',
    ]) {
        assert(
            evidence.installedMembers.some(
                ({ member }) => member === 'package/dist/esm/' + name
            ),
            'Expected installed ' + name
        );
    }
    evidence.bundle = Object.fromEntries(
        bundle.outputFiles.map(({ path, contents }) => [
            basename(path),
            sha256(contents),
        ])
    );
    evidence.status = 'bundled';
    return new Map([
        ['/', ['text/html; charset=utf-8', html]],
        ['/favicon.ico', ['image/x-icon', Buffer.alloc(0)]],
        ...bundle.outputFiles.map(({ path, contents }) => [
            '/' + basename(path),
            [path.endsWith('.css') ? 'text/css' : 'text/javascript', contents],
        ]),
    ]);
}

async function measure(page, origin, evidence) {
    const grid = page.getByRole('table');
    const ids = () =>
        grid
            .locator('tbody tr[data-record-id]')
            .evaluateAll((rows) => rows.map((row) => row.dataset.recordId));
    const state = () => page.evaluate(() => window.readGridCSVFixture());
    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    await page.goto(origin, { waitUntil: 'networkidle' });
    await grid.waitFor({ state: 'visible' });
    const before = await state();
    assert.equal(before.react, evidence.react);
    assert.deepEqual(await ids(), ['recZoe', 'recAmber']);
    assert.deepEqual(before.visibleKeys, [
        '__proto__',
        'Region descriptor',
        'Internal descriptor',
    ]);
    assert.equal(before.projection.status, 'ready');
    assert(
        await grid
            .getByRole('columnheader', { name: 'Internal note' })
            .isVisible()
    );
    assert(await grid.getByText('PRIVATE-ZOE', { exact: true }).isVisible());
    assert.equal(
        await grid.getByText('OUT-OF-SCOPE', { exact: true }).count(),
        0
    );

    await page.getByRole('button', { name: 'Hide columns' }).click();
    const dialog = page.getByRole('dialog', { name: 'Hide columns' });
    const toggle = dialog.getByRole('switch', { name: 'Internal note' });
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    const hidden = await state();
    assert.deepEqual(hidden.snapshot.hidden, { fldNote: true });
    assert.deepEqual(hidden.visibleKeys, ['__proto__', 'Region descriptor']);
    assert.equal(
        await grid.getByRole('columnheader', { name: 'Internal note' }).count(),
        0
    );
    assert.equal(
        await grid.getByText('PRIVATE-ZOE', { exact: true }).count(),
        0
    );

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download CSV' }).click(),
    ]);
    assert.equal(download.suggestedFilename(), fileName);
    assert(download.url().startsWith('blob:' + origin + '/'));
    assert.equal(await download.failure(), null);
    const chunks = [];
    for await (const chunk of await download.createReadStream())
        chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    evidence.download = {
        suggestedFilename: download.suggestedFilename(),
        bytes: bytes.length,
        sha256: sha256(bytes),
        utf8: bytes.toString('utf8'),
    };
    assert.deepEqual(
        bytes,
        expected,
        'Expected exact UTF-8, LF and final newline'
    );

    await page.getByRole('button', { name: 'Show in borrowed scope' }).click();
    assert.equal(
        await page.getByRole('button', { name: 'Download CSV' }).count(),
        0
    );
    assert.deepEqual(await ids(), ['recZoe', 'recAmber']);
    const borrowed = await state();
    assert.equal(borrowed.snapshot.borrowedRecords, true);
    assert.deepEqual(borrowed.snapshot.records, before.snapshot.records);
    assert.deepEqual(borrowed.visibleKeys, hidden.visibleKeys);
    assert.deepEqual(borrowed.projection, {
        status: 'blocked',
        reason: 'denied',
        count: 2,
        hasDocument: false,
    });
    assert.deepEqual(borrowed.effects, {
        preferences: [{ fieldId: 'fldNote', isHidden: true }],
        hideGestures: [true],
        exportGestures: [true],
        exportsFailed: [],
        inputs: 0,
        submits: 0,
        blockedConnections: 0,
    });
    assert.equal(downloads.length, 1);
    evidence.committed = { before, hidden, borrowed };
    evidence.downloadCount = downloads.length;
    await page.evaluate(() => window.unmountGridCSVFixture());
    assert.equal(await grid.count(), 0);
    assert.equal(
        await page.evaluate(() => 'readGridCSVFixture' in window),
        false
    );
    await download.delete();
    evidence.cleanup.unmounted = true;
    evidence.cleanup.downloadRemoved = true;
}

function fixtureServer(assets, requests) {
    return createServer((request, response) => {
        const asset = request.method === 'GET' && assets.get(request.url);
        if (!asset) {
            requests.push({
                method: request.method,
                path: new URL(request.url, 'http://127.0.0.1').pathname,
            });
            return response.writeHead(404).end();
        }
        response
            .writeHead(200, {
                'Content-Type': asset[0],
                'Cache-Control': 'no-store',
                'Content-Security-Policy':
                    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'",
            })
            .end(asset[1]);
    });
}

async function listen(server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
    if (server.listening) {
        const closed = once(server, 'close');
        server.close();
        server.closeAllConnections();
        await closed;
    }
}

async function exercise(browser, assets, evidence) {
    const requests = [];
    const server = fixtureServer(assets, requests);
    let context;
    const errors = [];
    try {
        const origin = await listen(server);
        context = await browser.newContext({
            acceptDownloads: true,
            serviceWorkers: 'block',
        });
        await context.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                request.method() === 'GET' &&
                url.origin === origin &&
                !['fetch', 'xhr'].includes(request.resourceType()) &&
                assets.has(url.pathname)
            )
                return route.continue();
            requests.push({ method: request.method(), path: url.pathname });
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(7000);
        page.on('pageerror', (error) => errors.push(error.message));
        await measure(page, origin, evidence);
        assert.deepEqual(requests, []);
        assert.deepEqual(errors, []);
    } finally {
        evidence.requests = requests;
        evidence.pageErrors = errors;
        try {
            if (context) await context.close();
            evidence.cleanup.contextClosed =
                !context || context.pages().length === 0;
        } finally {
            await closeServer(server);
            evidence.cleanup.loopbackClosed = !server.listening;
        }
    }
}

async function serve(ready, report, output) {
    const assets = new Map([
        ['/favicon.ico', ['image/x-icon', Buffer.alloc(0)]],
    ]);
    for (const [files, { react }] of ready)
        for (const [path, file] of files)
            if (path !== '/favicon.ico') assets.set('/' + react + path, file);
    const requests = [];
    const server = fixtureServer(assets, requests);
    const stopped = new Promise((done) => {
        process.once('SIGINT', done);
        process.once('SIGTERM', done);
    });
    try {
        const origin = await listen(server);
        writeFileSync(join(output, 'origin.txt'), origin + '\n');
        console.log(`Managed browser fixture: ${origin} (PID ${process.pid})`);
        await stopped;
        assert.deepEqual(requests, []);
    } finally {
        report.requests = requests;
        await closeServer(server);
        report.cleanup.loopbackClosed = !server.listening;
    }
}

const { values } = parseArgs({
    options: {
        archive: { type: 'string' },
        sha256: { type: 'string' },
        output: { type: 'string' },
        chromium: { type: 'string' },
        'prepare-only': { type: 'boolean' },
        serve: { type: 'boolean' },
    },
});
assert(
    values.archive &&
        values.sha256 &&
        values.output &&
        [values.chromium, values['prepare-only'], values.serve].filter(Boolean)
            .length === 1,
    'Pass --archive, --sha256, --output and exactly one of --chromium, --serve or --prepare-only'
);
const archive = regularFile(values.archive);
const archiveBytes = readFileSync(archive);
assert.equal(sha256(archiveBytes), values.sha256);
const readMember = createArchiveMemberReader({
    archivePath: archive,
    expectedSha256: values.sha256,
});
const output = resolve(values.output);
mkdirSync(output);
const report = {
    package: { sha256: values.sha256, bytes: archiveBytes.length },
    fixtureSha256: sha256(fixture),
    profiles: [],
    cleanup: {},
};
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'sdk-grid-csv-')));
let browser;
try {
    const ready = [];
    for (const react of profiles) {
        const evidence = { react, status: 'installing', cleanup: {} };
        report.profiles.push(evidence);
        const directory = join(scratch, react);
        mkdirSync(directory);
        ready.push([
            await prepare(directory, archive, readMember, evidence),
            evidence,
        ]);
    }
    if (values.chromium) {
        browser = await chromium.launch({
            executablePath: regularFile(values.chromium),
            headless: true,
            chromiumSandbox: true,
        });
        report.browser = browser.version();
        for (const [assets, evidence] of ready) {
            await exercise(browser, assets, evidence);
            evidence.status = 'passed';
        }
    } else if (values.serve) await serve(ready, report, output);
    assert.equal(sha256(readFileSync(archive)), report.package.sha256);
} catch (error) {
    report.failure = error.message;
    throw error;
} finally {
    try {
        if (browser) await browser.close();
        report.cleanup.browser = browser ? 'closed' : 'not-started';
    } finally {
        await stop();
        rmSync(scratch, { recursive: true });
        report.cleanup.consumersRemoved = !existsSync(scratch);
        writeFileSync(
            join(output, 'report.json'),
            JSON.stringify(report, null, 2) + '\n'
        );
    }
}
