// Chromium against an installed archive and the checked-in synthetic example.
// Run after build: node scripts/check-linked-records-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    copyFileSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { assertBrowserInputs } from './package-checks.mjs';
const root = process.cwd();
const output = resolve(process.argv[2] ?? 'dist/linked-records-browser');
mkdirSync(output, { recursive: true });
const consumer = mkdtempSync(join(tmpdir(), 'sdk-linked-records-browser-'));
const run = (args, cwd = consumer) =>
    execFileSync('npm', args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: join(consumer, 'npm-cache') },
        timeout: 120000,
    });
let browser, server;
try {
    const packed = JSON.parse(
        run(
            [
                'pack',
                '--ignore-scripts',
                '--json',
                '--pack-destination',
                consumer,
            ],
            root
        )
    )[0];
    const archive = join(consumer, packed.filename);
    const sha256 = createHash('sha256')
        .update(readFileSync(archive))
        .digest('hex');
    writeFileSync(
        join(consumer, 'package.json'),
        JSON.stringify({ private: true, type: 'module' })
    );
    run([
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        archive,
        'react@18.3.1',
        'react-dom@18.3.1',
    ]);
    for (const file of ['main.ts', 'styles.css'])
        copyFileSync(
            join(root, 'examples/react-linked-records', file),
            join(consumer, file)
        );
    const bundle = await build({
        absWorkingDir: consumer,
        entryPoints: ['main.ts'],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        outdir: join(consumer, 'bundle'),
        write: false,
        metafile: true,
    });
    await assertBrowserInputs(bundle.metafile, consumer);
    const assets = new Map(
        bundle.outputFiles.map((file) => [
            '/' + file.path.split('/').at(-1),
            file.contents,
        ])
    );
    server = createServer((request, response) => {
        const path = new URL(request.url, 'http://localhost').pathname;
        if (path === '/') {
            response.setHeader('content-type', 'text/html');
            response.end(
                readFileSync('examples/react-linked-records/index.html', 'utf8')
            );
        } else if (assets.has(path)) {
            response.setHeader(
                'content-type',
                path.endsWith('.css') ? 'text/css' : 'text/javascript'
            );
            response.end(assets.get(path));
        } else {
            response.statusCode = 404;
            response.end();
        }
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
        executablePath:
            process.env.SDK_LINKED_RECORDS_CHROMIUM ?? '/usr/bin/chromium',
        headless: true,
        args: ['--disable-gpu'],
    });
    const context = await browser.newContext({
        viewport: { width: 1180, height: 1020 },
        reducedMotion: 'reduce',
    });
    const external = [],
        errors = [],
        transports = [];
    await context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === origin)
            return route.continue();
        external.push(route.request().url());
        return route.abort();
    });
    context.on('request', (request) => {
        if (['fetch', 'xhr'].includes(request.resourceType()))
            transports.push(request.url());
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    await page
        .getByRole('heading', { name: 'Find records. Keep control.' })
        .waitFor();
    const group = (name) => page.getByRole('group', { name, exact: true });
    const form = group('Form projects'),
        grid = group('Grid projects'),
        list = group('List projects'),
        masked = group('Masked projects');
    const selected = (control) =>
        control.locator('.mx-sdk-linked-records-values li span');
    const native = async (index) =>
        JSON.parse(await page.locator(`#native-${index}`).textContent());
    const counter = async (id) =>
        Number(await page.locator(`#${id}`).textContent());
    const initial = ['rec_alpha', 'rec_filtered', 'rec_alpha', 'rec_missing'];
    assert.deepEqual(await native(0), initial);
    assert.equal(await counter('reads'), 0);
    assert.equal(await counter('searches'), 0);
    assert.equal(await counter('pages'), 0);
    assert.equal(await selected(form).count(), 4);
    assert.deepEqual(await selected(grid).allTextContents(), [
        'Alpha',
        'Linked record unavailable',
        'Alpha',
        'Linked record unavailable',
    ]);
    assert.equal(
        await list
            .getByRole('button', { name: 'Clear', exact: true })
            .isDisabled(),
        true
    );
    for (const control of [form, grid, list, masked])
        assert.doesNotMatch(
            await control.innerHTML(),
            /rec_alpha|rec_filtered|rec_missing/
        );
    assert.doesNotMatch(await masked.innerHTML(), /Alpha/);
    assert.equal(
        await masked.locator('input').getAttribute('type'),
        'password'
    );
    await page.screenshot({
        path: join(output, 'linked-records-idle.png'),
        fullPage: true,
    });
    await form
        .getByRole('button', { name: 'Load selected', exact: true })
        .click();
    assert.equal(await counter('reads'), 1);
    assert.deepEqual(await selected(form).allTextContents(), [
        'Alpha',
        'Linked record unavailable',
        'Alpha',
        'Linked record unavailable',
    ]);
    await form
        .getByRole('textbox', { name: 'Search linked records' })
        .fill('Beta');
    assert.equal(await counter('searches'), 0);
    await page.keyboard.press('Enter');
    assert.equal(await counter('submits'), 0);
    assert.equal(await counter('rows'), 0);
    await form.getByRole('button', { name: 'Search', exact: true }).click();
    assert.equal(await counter('searches'), 1);
    assert.ok(
        await form
            .getByRole('button', { name: 'Unnamed linked record' })
            .isVisible()
    );
    assert.doesNotMatch(await form.innerHTML(), /rec_no_label/);
    await form.getByRole('button', { name: 'Beta', exact: true }).click();
    assert.deepEqual(await native(0), [
        'rec_alpha',
        'rec_filtered',
        'rec_missing',
        'rec_beta',
    ]);
    await form.getByRole('button', { name: 'Load more', exact: true }).click();
    assert.equal(await counter('pages'), 1);
    await form.getByRole('button', { name: 'Gamma', exact: true }).click();
    assert.deepEqual(await native(0), [
        'rec_alpha',
        'rec_filtered',
        'rec_missing',
        'rec_beta',
        'rec_gamma',
    ]);
    assert.equal(await counter('saves'), 0);
    await grid
        .getByRole('button', { name: 'Remove selected record 1', exact: true })
        .click();
    assert.deepEqual(await native(1), ['rec_filtered', 'rec_missing']);
    assert.equal(await counter('saves'), 0);
    await masked.getByRole('button', { name: 'Search', exact: true }).click();
    assert.doesNotMatch(await masked.innerHTML(), /Beta|Gamma|rec_no_label/);
    await masked
        .getByRole('button', { name: 'Select masked record 1', exact: true })
        .click();
    assert.deepEqual(await native(3), [
        'rec_alpha',
        'rec_filtered',
        'rec_missing',
        'rec_beta',
    ]);
    assert.equal(await counter('saves'), 0);
    await page
        .getByRole('button', { name: 'Remount renderers', exact: true })
        .click();
    assert.deepEqual(await native(0), [
        'rec_alpha',
        'rec_filtered',
        'rec_missing',
        'rec_beta',
        'rec_gamma',
    ]);
    assert.equal(await counter('reads'), 1);
    assert.equal(await counter('searches'), 2);
    assert.equal(await counter('pages'), 1);
    assert.equal(await counter('rows'), 0);
    assert.equal(await counter('submits'), 0);
    await page.screenshot({
        path: join(output, 'linked-records-draft.png'),
        fullPage: true,
    });
    await page
        .getByRole('button', { name: 'Retire Form owner', exact: true })
        .click();
    assert.equal(await page.locator('#native-0').textContent(), 'Retired');
    assert.equal(await group('Form projects').count(), 0);
    assert.deepEqual(external, []);
    assert.deepEqual(transports, []);
    assert.deepEqual(errors, []);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
    }).trim();
    const receipt = {
        head,
        archive: packed.filename,
        sha256,
        integrity: packed.integrity,
        browser: await browser.version(),
        cases: [
            'native order and duplicate display',
            'Form hydration only on click',
            'explicit search and load-more',
            'typing and Enter do not read or submit',
            'generic ID fallbacks and filtered placeholders',
            'masked labels, options and query',
            'readonly List',
            'Grid draft-only removal',
            'filtered identities retained and duplicate mutation normalization',
            'remount without reads',
            'owner retirement',
        ],
        reads: await counter('reads'),
        searches: await counter('searches'),
        pages: await counter('pages'),
        saves: await counter('saves'),
        rowActivations: await counter('rows'),
        submits: await counter('submits'),
        externalRequests: external,
        transports,
        errors,
    };
    writeFileSync(
        join(output, 'receipt.json'),
        JSON.stringify(receipt, null, 4) + '\n'
    );
    console.log(JSON.stringify(receipt, null, 2));
} finally {
    await browser?.close();
    if (server) await new Promise((done) => server.close(done));
    rmSync(consumer, { recursive: true, force: true });
}
