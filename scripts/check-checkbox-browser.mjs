// Local synthetic UI proof; no backend, fixture mutation, credentials or deployment.
// Run after build: node scripts/check-checkbox-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/checkbox-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-checkbox/main.ts'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    outdir: output,
    write: false,
});
const assets = new Map(
    bundle.outputFiles.map((file) => [
        '/' + file.path.split('/').at(-1),
        file.contents,
    ])
);
const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') {
        response.setHeader('content-type', 'text/html');
        response.end(readFileSync('examples/react-checkbox/index.html'));
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
let browser;
try {
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
        errors = [];
    await context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === origin)
            return route.continue();
        external.push(route.request().url());
        return route.abort();
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
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(
            {
                browser: browser.version(),
                transport: 'synthetic local drafts only',
                writes: 3,
                externalRequests: 0,
                checks: [
                    'native labels and Space',
                    'visible keyboard focus',
                    'unique IDs',
                    'readonly/pending/Calendly',
                    'validation association',
                    'hidden title accessible name',
                    'StrictMode/remount preserves owner',
                    'permission changes',
                    'no Portal row activation or form submission',
                    'forced colors',
                    'mobile overflow',
                ],
                screenshots: [
                    'checkbox-idle.png',
                    'checkbox-focus.png',
                    'checkbox-forced-colors.png',
                    'checkbox-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`Checkbox browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
