// Local Chromium against a real installed archive. No live QA or backend writes.
// Run after build: node scripts/check-multiple-select-browser.mjs [evidence-directory]
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
const output = resolve(process.argv[2] ?? 'dist/multiple-select-browser');
mkdirSync(output, { recursive: true });
const consumer = mkdtempSync(join(tmpdir(), 'sdk-multiple-select-browser-'));
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
            join(root, 'examples/react-multiple-select', file),
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
                readFileSync('examples/react-multiple-select/index.html')
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
            process.env.SDK_MULTIPLE_SELECT_CHROMIUM ?? '/usr/bin/chromium',
        headless: true,
        args: ['--disable-gpu'],
    });
    const context = await browser.newContext({
        viewport: { width: 1180, height: 940 },
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
        .getByRole('heading', { name: 'Choose more. Keep the order.' })
        .waitFor();
    const group = (name) => page.getByRole('group', { name, exact: true });
    const native = async (index) =>
        JSON.parse(await page.locator(`#native-${index}`).textContent());
    const counters = async () => {
        assert.equal(await page.locator('#rows').textContent(), '0');
        assert.equal(await page.locator('#submits').textContent(), '0');
    };
    assert.equal(await page.locator('#writes').textContent(), '0');
    assert.deepEqual(await native(0), ['Red']);
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(ids.length, new Set(ids).size);
    await page.screenshot({
        path: join(output, 'multiple-select-idle.png'),
        fullPage: true,
    });
    const grid = group('Grid colors');
    assert.equal(
        await grid.getByRole('checkbox', { name: 'Green' }).isDisabled(),
        true
    );
    await grid
        .getByRole('button', { name: 'Remove Azure', exact: true })
        .click();
    assert.deepEqual(await native(1), ['Red']);
    await grid.getByRole('checkbox', { name: 'Green' }).focus();
    await page.keyboard.press('Space');
    assert.deepEqual(await native(1), ['Red', 'Green']);
    const form = group('Form colors');
    await form.getByRole('textbox', { name: 'New choice name' }).fill('Mint');
    await page.keyboard.press('Enter');
    await counters();
    assert.equal(await page.locator('#creations').textContent(), '0');
    await form.getByRole('button', { name: 'Add choice', exact: true }).click();
    assert.equal(await page.locator('#creations').textContent(), '1');
    assert.deepEqual(await native(0), ['Red', 'Mint']);
    const blocked = group('Blocked colors');
    await blocked
        .getByRole('button', { name: 'Remove Legacy', exact: true })
        .click();
    assert.deepEqual(await native(3), ['Red']);
    await blocked
        .getByRole('button', { name: 'Clear Blocked colors', exact: true })
        .click();
    assert.deepEqual(await native(3), []);
    assert.equal(await blocked.getByRole('checkbox').count(), 0);
    for (const name of ['List colors', 'Read-only colors', 'Pending colors']) {
        const controls = group(name).locator('button,input');
        for (const control of await controls.all())
            assert.equal(await control.isDisabled(), true);
        assert.equal(await group(name).getByRole('textbox').count(), 0);
    }
    assert.equal(await grid.getByRole('textbox').count(), 0);
    await counters();
    const writes = await page.locator('#writes').textContent();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.deepEqual(await native(0), ['Red', 'Mint']);
    assert.deepEqual(await native(1), ['Red', 'Green']);
    assert.equal(await page.locator('#writes').textContent(), writes);
    await page.setViewportSize({ width: 420, height: 900 });
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
    );
    await page.screenshot({
        path: join(output, 'multiple-select-narrow.png'),
        fullPage: true,
    });
    await page.getByRole('button', { name: 'Retire Form owner' }).click();
    assert.equal(await group('Form colors').count(), 0);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(transports, []);
    await counters();
    writeFileSync(
        join(output, 'receipt.json'),
        JSON.stringify(
            {
                packageSha256: sha256,
                node: process.version,
                browser: browser.version(),
                outcome: 'passed',
                nativeOrder: true,
                maxRemoval: true,
                retainedUnavailable: true,
                formOnlyCreation: true,
                implicitSave: false,
                rowEvents: 0,
                formSubmissions: 0,
                externalRequests: 0,
                pageErrors: errors,
            },
            null,
            4
        ) + '\n'
    );
    console.log(
        `Multiple Select packed Chromium checks passed; evidence: ${output}`
    );
} finally {
    await browser?.close();
    if (server) await new Promise((done) => server.close(done));
    rmSync(consumer, { recursive: true, force: true });
}
