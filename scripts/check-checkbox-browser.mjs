// Packed local synthetic UI proof; no backend, fixture mutation or deployment.
// Run after build: node scripts/check-checkbox-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import {
    copyFileSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { assertBrowserInputs } from './package-checks.mjs';

const root = process.cwd();
const output = resolve(process.argv[2] ?? 'dist/checkbox-browser');
mkdirSync(output, { recursive: true });
const consumer = mkdtempSync(join(tmpdir(), 'sdk-checkbox-browser-'));
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
            join(root, 'examples/react-checkbox', file),
            join(consumer, file)
        );
    copyFileSync(
        join(root, 'scripts/checkbox-input-browser-fixture.mjs'),
        join(consumer, 'input.mjs')
    );
    const bundle = await build({
        absWorkingDir: consumer,
        entryPoints: ['main.ts', 'input.mjs'],
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
        if (path === '/' || path === '/input') {
            response.setHeader('content-type', 'text/html');
            response.end(
                path === '/'
                    ? readFileSync('examples/react-checkbox/index.html')
                    : '<!doctype html><html lang="en"><title>Host checkbox input</title><div id="app"></div><script type="module" src="/input.js"></script></html>'
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
            process.env.SDK_CHECKBOX_CHROMIUM ?? '/usr/bin/chromium',
        headless: true,
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
        .getByRole('heading', { name: 'One choice. Clear state.' })
        .waitFor();
    const first = page.getByRole('checkbox', { name: 'Approve this request' });
    assert.equal(await page.locator('#writes').textContent(), '0');
    assert.equal(await first.isChecked(), false);
    assert.equal(await page.getByRole('checkbox').count(), 7);
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length);
    for (const name of [
        'Review completed',
        'Include in the next release',
        'Meeting booked',
    ]) {
        assert.equal(
            await page.getByRole('checkbox', { name }).isDisabled(),
            true
        );
    }
    assert.equal(
        await page
            .getByRole('checkbox', { name: 'Compact row approval' })
            .getAttribute('aria-label'),
        'Compact row approval'
    );
    const invalid = page.getByRole('checkbox', {
        name: 'I have reviewed the details',
    });
    assert.equal(await invalid.getAttribute('aria-invalid'), 'true');
    assert.equal(
        await invalid.evaluate(
            (node) =>
                document.getElementById(node.getAttribute('aria-describedby'))
                    .textContent
        ),
        'Please confirm that you have reviewed the details.'
    );
    await page.screenshot({
        path: join(output, 'checkbox-idle.png'),
        fullPage: true,
    });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.keyboard.press('Space');
    assert.equal(await first.isChecked(), true);
    assert.equal(await page.locator('#writes').textContent(), '1');
    await page.screenshot({
        path: join(output, 'checkbox-focus.png'),
        fullPage: true,
    });
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.isChecked(), true);
    assert.equal(await page.locator('#writes').textContent(), '1');
    await page.getByText('Approve this request', { exact: true }).click();
    assert.equal(await first.isChecked(), false);
    assert.equal(await page.locator('#writes').textContent(), '2');
    await invalid.click();
    assert.equal(await page.locator('#writes').textContent(), '3');
    await page.getByRole('button', { name: 'Lock first field' }).click();
    assert.equal(await first.isDisabled(), true);
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.isDisabled(), true);
    assert.equal(await page.locator('#writes').textContent(), '3');
    await page.getByRole('button', { name: 'Allow editing' }).click();
    assert.equal(await first.isDisabled(), false);
    assert.equal(await page.locator('#rows').textContent(), '0');
    assert.equal(await page.locator('#submits').textContent(), '0');
    await page.emulateMedia({ forcedColors: 'active' });
    assert.notEqual(
        await first.evaluate((node) => getComputedStyle(node).appearance),
        'none'
    );
    await page.screenshot({
        path: join(output, 'checkbox-forced-colors.png'),
        fullPage: true,
    });
    await page.emulateMedia({ forcedColors: 'none' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
        ),
        false
    );
    await page.screenshot({
        path: join(output, 'checkbox-mobile.png'),
        fullPage: true,
    });
    const inputPage = await context.newPage();
    inputPage.on('pageerror', (error) => errors.push(error.message));
    await inputPage.goto(`${origin}/input`);
    const input = inputPage.getByRole('checkbox', { name: 'Host consent' });
    await input.waitFor();
    const state = async () =>
        JSON.parse(await inputPage.locator('#bare-state').textContent());
    const clickButton = (name) =>
        inputPage.getByRole('button', { name, exact: true }).click();
    assert.equal(await input.isChecked(), false);
    assert.deepEqual((await state()).changes, []);
    assert.equal(await inputPage.locator('label').count(), 1);
    assert.equal(await inputPage.locator('#bare-host > *').count(), 1);
    assert.equal(
        await inputPage.locator('#bare-host > input[type=checkbox]').count(),
        1
    );
    assert.equal(await input.getAttribute('class'), 'host-checkbox');
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
    assert.deepEqual(
        await input.evaluate((node) => ({
            form: node.form?.id,
            external: !node.form?.contains(node),
            descriptions: node
                .getAttribute('aria-describedby')
                .split(' ')
                .map((id) => document.getElementById(id)?.textContent),
        })),
        {
            form: 'bare-form',
            external: true,
            descriptions: ['Host help', 'Host error'],
        }
    );

    await inputPage.getByText('Host consent', { exact: true }).click();
    assert.equal(await input.isChecked(), true);
    assert.deepEqual((await state()).changes, [true]);
    assert.deepEqual((await state()).events, {
        click: 1,
        change: 1,
        pointerdown: 0,
        keydown: 0,
        keyup: 0,
    });
    await input.press('Space');
    assert.equal(await input.isChecked(), false);
    assert.deepEqual((await state()).changes, [true, false]);
    assert.deepEqual((await state()).events, {
        click: 2,
        change: 2,
        pointerdown: 0,
        keydown: 1,
        keyup: 1,
    });
    await input.click();
    assert.equal(await input.isChecked(), true);
    assert.deepEqual((await state()).changes, [true, false, true]);
    assert.deepEqual((await state()).events, {
        click: 3,
        change: 3,
        pointerdown: 1,
        keydown: 1,
        keyup: 1,
    });
    const beforeRemount = await state();
    await clickButton('Remount input');
    assert.equal(await input.isChecked(), true);
    assert.deepEqual(await state(), beforeRemount);
    await clickButton('Reset host value');
    assert.equal(await input.isChecked(), false);
    assert.deepEqual((await state()).changes, [true, false, true]);

    await clickButton('Toggle acceptance');
    await input.click();
    assert.equal(await input.isChecked(), false);
    assert.deepEqual((await state()).changes, [true, false, true, true]);
    await clickButton('Toggle acceptance');
    await clickButton('Toggle readOnly');
    assert.equal(await input.evaluate((node) => node.readOnly), true);
    await input.click();
    assert.equal(await input.isChecked(), true);
    assert.deepEqual((await state()).changes, [true, false, true, true, true]);

    await clickButton('Toggle disabled');
    assert.equal(await input.isDisabled(), true);
    const beforeDisabled = await state();
    const box = await input.boundingBox();
    assert.ok(box);
    await inputPage.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const bareInput = await state();
    assert.equal(await input.isChecked(), true);
    assert.deepEqual(bareInput.changes, beforeDisabled.changes);
    assert.equal(bareInput.events.click, beforeDisabled.events.click);
    assert.equal(bareInput.events.change, beforeDisabled.events.change);
    assert.deepEqual(bareInput.currentTargets, [true, true, true, true, true]);
    assert.equal(bareInput.submits, 0);
    assert.equal(await page.locator('#writes').textContent(), '3');
    await inputPage.screenshot({
        path: join(output, 'checkbox-input.png'),
        fullPage: true,
    });
    assert.deepEqual(external, []);
    assert.deepEqual(transports, []);
    assert.deepEqual(errors, []);
    const git = (...args) =>
        execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(
            {
                head: git('rev-parse', 'HEAD'),
                tree: git('rev-parse', 'HEAD^{tree}'),
                worktreeClean: git('status', '--porcelain') === '',
                archive: packed.filename,
                sha256,
                integrity: packed.integrity,
                packageSource:
                    'freshly installed archive; all bundler inputs confined to consumer',
                browser: browser.version(),
                transport: 'synthetic local drafts only',
                writes: 3,
                externalRequests: 0,
                transports,
                errors,
                bareInput,
                bareInputChecks: [
                    'public export from installed archive',
                    'external label, form and feedback associations',
                    'one native callback per label, Space and pointer activation',
                    'native currentTarget and host click/change/pointer/keyboard bubbling',
                    'host value reset and remount without callbacks',
                    'host-rejected change restores controlled checked value',
                    'readOnly alone retains native activation; disabled prevents it',
                    'no form submission or wrapper owner mutation',
                ],
                checks: [
                    'native labels and Space',
                    'visible keyboard focus',
                    'unique IDs',
                    'wrapper readonly/pending/Calendly-disabled presentation',
                    'validation association',
                    'hidden title accessible name',
                    'StrictMode/remount preserves synthetic owner',
                    'synthetic host permission changes',
                    'synthetic wrapper row containment; no form submission',
                    'forced colors',
                    'mobile overflow',
                ],
                screenshots: [
                    'checkbox-idle.png',
                    'checkbox-focus.png',
                    'checkbox-forced-colors.png',
                    'checkbox-mobile.png',
                    'checkbox-input.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`Checkbox browser checks passed: ${output}`);
} finally {
    try {
        await browser?.close();
    } finally {
        try {
            if (server) await new Promise((done) => server.close(done));
        } finally {
            rmSync(consumer, { recursive: true, force: true });
        }
    }
}
