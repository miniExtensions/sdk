// Standalone installed witness. This script is not registered in hosted checks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    statfsSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { runAgeQualifiedConsumerInstall } from './age-qualified-consumer-install.mjs';
import { assertBrowserInputs } from './package-checks.mjs';
import { readonlyPortalListFixture } from './readonly-portal-list-fixture.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const [kitArgument, outputArgument] = process.argv.slice(2);
assert(
    kitArgument && outputArgument,
    'Usage: SDK_NATIVE_CHROMIUM=/path/to/Chromium node scripts/check-portal-filter-paging-browser.mjs <kit-dir> <new-output-dir>'
);
const scratchRoot = realpathSync(tmpdir());
const disk = statfsSync(scratchRoot, { bigint: true });
assert(
    disk.bavail * disk.bsize >= 8n * (1n << 30n) && disk.ffree >= 262144n,
    'Scratch filesystem requires 8 GiB free and 262144 free inodes'
);
const kit = realpathSync(kitArgument);
const receipt = JSON.parse(
    readFileSync(join(kit, 'artifact-receipt.json'), 'utf8')
);
assert.equal(receipt.source.commit, '3ffae5e27c92f8c93a8549db660cd64eb875bcbc');
assert.equal(String(receipt.ci.runId), '44560133692');
assert.equal(receipt.package.name, '@miniextensions/sdk');
assert.equal(receipt.package.filename, basename(receipt.package.filename));
const archive = realpathSync(join(kit, receipt.package.filename));
const packageSha256 = sha(readFileSync(archive));
assert.equal(packageSha256, receipt.package.sha256);
assert.equal(
    packageSha256,
    '8e0ee845c17934450ef396a80c24faa4c010d357ad9469d9b8604266173a3ac4'
);
assert(
    process.env.SDK_NATIVE_CHROMIUM,
    'Verified Chromium executable is required'
);
const executablePath = realpathSync(process.env.SDK_NATIVE_CHROMIUM);
assert(lstatSync(executablePath).isFile());
const output = resolve(outputArgument);
assert(!existsSync(output), 'Use a new result directory');
mkdirSync(output);

const evidence = {
    source: receipt.source.commit,
    packageSha256,
    passed: false,
    cleanup: {},
};
let consumer;
let browser;
let context;
let server;
try {
    consumer = mkdtempSync(join(scratchRoot, 'sdk-filter-paging-'));
    const run = (command, args, options = {}) =>
        execFileSync(command, args, {
            cwd: consumer,
            stdio: 'inherit',
            timeout: 120000,
            ...options,
        });
    writeFileSync(
        join(consumer, 'package.json'),
        JSON.stringify({
            private: true,
            type: 'module',
            dependencies: { '@miniextensions/sdk': 'file:' + archive },
        })
    );
    runAgeQualifiedConsumerInstall(run, [
        'install',
        '--ignore-scripts',
        '--strict-peer-deps',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        'react@19.2.0',
        'react-dom@19.2.0',
    ]);
    evidence.ageInstall = JSON.parse(
        readFileSync(
            join(consumer, 'consumer-age-install-receipts.json'),
            'utf8'
        )
    );
    writeFileSync(
        join(consumer, 'list-fixture.mjs'),
        readonlyPortalListFixture
    );
    copyFileSync(
        new URL('./portal-filter-paging-fixture.mjs', import.meta.url),
        join(consumer, 'browser.mjs')
    );
    const bundle = await build({
        absWorkingDir: consumer,
        entryPoints: ['browser.mjs'],
        bundle: true,
        platform: 'browser',
        format: 'iife',
        write: false,
        metafile: true,
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await assertBrowserInputs(bundle.metafile, consumer);
    server = createServer((req, res) => {
        if (req.url === '/') {
            res.setHeader('content-type', 'text/html');
            res.end(
                '<!doctype html><link rel="icon" href="data:,"><script defer src="/app.js"></script><form><main></main></form>'
            );
        } else if (req.url === '/app.js') {
            res.setHeader('content-type', 'text/javascript');
            res.end(bundle.outputFiles[0].contents);
        } else {
            res.writeHead(404).end();
        }
    });
    await new Promise((ok, reject) =>
        server.once('error', reject).listen(0, '127.0.0.1', ok)
    );
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ executablePath, headless: true });
    context = await browser.newContext({ serviceWorkers: 'block' });
    const unexpected = [];
    await context.route('**/*', (route) => {
        const request = route.request();
        if (
            new URL(request.url()).origin === origin &&
            !['fetch', 'xhr'].includes(request.resourceType())
        )
            return route.continue();
        unexpected.push(request.resourceType());
        return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => unexpected.push(error.message));
    await page.goto(origin);
    const filter = page.getByRole('button', { name: 'Filter', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Filter records' });
    const retry = page.getByRole('button', { name: 'Reintentar' });
    const rows = page.locator('[data-fixture="rows"]');
    const snapshot = () =>
        page.evaluate(() => globalThis.filterPaging.snapshot());
    const afterPaint = () =>
        page.evaluate(
            () =>
                new Promise((ok) =>
                    requestAnimationFrame(() => requestAnimationFrame(ok))
                )
        );
    const closeFilter = async (count) => {
        await dialog
            .getByRole('button', { name: 'Done', exact: true })
            .press('Enter');
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(
            (n) => globalThis.filterPaging.snapshot().outcomes.length === n,
            count
        );
    };

    await rows.getByText('Previously accepted', { exact: true }).waitFor();
    assert.equal((await snapshot()).requests.length, 0);
    await filter.press('Enter');
    await dialog
        .getByRole('button', { name: 'Add group', exact: true })
        .click();
    const group = dialog.locator('fieldset').first();
    await group
        .getByRole('button', { name: 'Add condition', exact: true })
        .click();
    await group.getByRole('textbox', { name: 'Value' }).fill('Grouped change');
    await closeFilter(1);
    const first = await snapshot();
    const acknowledged = {
        type: 'allocated',
        requestId: 'read-1',
        generation: 2,
    };
    assert.deepEqual(first.outcomes, [acknowledged]);
    const [acceptedGroup] = first.criteria.conditions;
    assert.equal(acceptedGroup.type, 'groupCondition');
    assert.equal(acceptedGroup.conditions[0].setting.value, 'Grouped change');
    assert.deepEqual(first.requests, [
        {
            intent: 'filter-first',
            requestId: 'read-1',
            generation: 2,
            cursor: null,
        },
    ]);
    assert.equal(
        await page.evaluate(() => globalThis.filterPaging.failFirst()),
        'settled'
    );
    await retry.waitFor();
    assert.equal(
        await page.getByRole('alert').textContent(),
        'Primera página no disponible'
    );
    assert.equal(
        await rows
            .getByText('Previously accepted', { exact: true })
            .isVisible(),
        true
    );
    evidence.firstFailure = {
        requests: first.requests.length,
        retryLabel: await retry.textContent(),
    };
    await page.evaluate(() => globalThis.filterPaging.redraw());
    await afterPaint();
    assert.deepEqual((await snapshot()).requests, first.requests);
    await filter.press('Enter');
    await closeFilter(2);
    assert.deepEqual((await snapshot()).outcomes, [
        acknowledged,
        { type: 'unchanged' },
    ]);
    assert.deepEqual((await snapshot()).requests, first.requests);
    evidence.afterUnchanged = (await snapshot()).requests.length;

    await retry.focus();
    await page.keyboard.press('Enter');
    await retry.waitFor({ state: 'hidden' });
    const retried = await snapshot();
    assert.deepEqual(retried.keyboard, [
        { trusted: true, label: 'Reintentar' },
    ]);
    assert.deepEqual(retried.requests, [
        ...first.requests,
        {
            intent: 'retry-first-page',
            requestId: 'read-2',
            generation: 2,
            cursor: null,
        },
    ]);
    assert.deepEqual(retried.pending, ['read-2']);
    assert.equal(retried.retryAdmittedWhileCurrent, true);

    await page.evaluate(() => globalThis.filterPaging.replaceQuery());
    await rows.getByText('Replacement row', { exact: true }).waitFor();
    const loadMore = page.getByRole('button', { name: 'Más registros' });
    await loadMore.waitFor();
    assert.equal(await loadMore.isEnabled(), true);
    const replacementRows = await rows.innerText();
    const replacement = await snapshot();
    assert.equal(replacement.generation, 3);
    assert.equal(replacement.cursor, 'replacement-page');
    assert.deepEqual(replacement.state, { type: 'ready', hasNextPage: true });
    await page.evaluate(() => globalThis.filterPaging.deliverRetired());
    await afterPaint();
    const settled = await snapshot();
    assert.deepEqual(settled.staleOffer, { current: false, admitted: false });
    assert.equal(settled.staleSettlement, 'retired');
    assert.deepEqual(settled.pending, []);
    assert.deepEqual(settled.requests, replacement.requests);
    assert.deepEqual(settled.state, replacement.state);
    assert.equal(settled.cursor, replacement.cursor);
    assert.equal(await rows.innerText(), replacementRows);
    assert.equal(await loadMore.isEnabled(), true);
    assert.equal(await retry.count(), 0);
    assert.equal(
        await rows.getByText('Retired row', { exact: true }).count(),
        0
    );
    assert.equal(settled.submits, 0);
    assert.equal(settled.react, '19.2.0');
    assert.deepEqual(unexpected, []);
    assert.deepEqual(
        await page.evaluate(() => globalThis.filterPaging.close()),
        { filter: 0, records: 0 }
    );
    Object.assign(evidence, { settled, passed: true });
} catch (error) {
    evidence.error = error.stack ?? String(error);
    throw error;
} finally {
    try {
        const errors = [];
        for (const [name, close] of [
            ['context', context && (() => context.close())],
            ['browser', browser && (() => browser.close())],
            [
                'server',
                server?.listening &&
                    (() =>
                        new Promise((ok, reject) =>
                            server.close((error) =>
                                error ? reject(error) : ok()
                            )
                        )),
            ],
            [
                'consumer',
                consumer && (() => rmSync(consumer, { recursive: true })),
            ],
        ]) {
            if (!close) continue;
            try {
                await close();
                evidence.cleanup[name] = true;
            } catch (error) {
                evidence.cleanup[name] = false;
                errors.push(error);
            }
        }
        if (errors.length) {
            evidence.passed = false;
            throw new AggregateError(
                errors,
                'Installed witness cleanup failed'
            );
        }
    } finally {
        writeFileSync(
            join(output, 'receipt.json'),
            JSON.stringify(evidence, null, 2) + '\n'
        );
    }
}
