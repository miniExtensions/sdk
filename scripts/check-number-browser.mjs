// Local synthetic UI proof; no backend, fixture mutation, credentials or deployment.
// Run after build: node scripts/check-number-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/number-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-number/main.ts'],
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
        response.end(readFileSync('examples/react-number/index.html'));
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
        executablePath: process.env.SDK_NUMBER_CHROMIUM ?? '/usr/bin/chromium',
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
        .getByRole('heading', { name: 'Every value, in its own time.' })
        .waitFor();
    const first = page.getByRole('textbox', { name: 'Quantity', exact: true });
    const writes = async () =>
        Number(await page.locator('#writes').textContent());
    const native = async () =>
        JSON.parse(await page.locator('#native').textContent());
    assert.equal(await page.locator('input').count(), 8);
    assert.equal(await writes(), 0);
    assert.equal(await native(), null);
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(await first.getAttribute('type'), 'text');
    assert.equal(await first.getAttribute('inputmode'), 'decimal');
    assert.equal(await first.getAttribute('placeholder'), 'Enter a quantity');
    assert.equal(await first.getAttribute('aria-required'), 'true');
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Balance', exact: true })
            .inputValue(),
        '0'
    );
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Measurement', exact: true })
            .inputValue(),
        '1.234567'
    );
    for (const name of ['Reserved seats', 'Unavailable editor'])
        assert.equal(
            await page.getByRole('textbox', { name, exact: true }).isDisabled(),
            true
        );
    assert.equal(
        await page
            .getByLabel('Access code', { exact: true })
            .getAttribute('type'),
        'password'
    );
    assert.equal(
        await page.getByLabel('Access code', { exact: true }).isDisabled(),
        true
    );
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Compact amount', exact: true })
            .getAttribute('aria-label'),
        'Compact amount'
    );
    const invalid = page.getByRole('textbox', {
        name: 'Attendees',
        exact: true,
    });
    assert.equal(await invalid.getAttribute('aria-invalid'), 'true');
    assert.equal(
        await invalid.evaluate(
            (node) =>
                document.getElementById(node.getAttribute('aria-describedby'))
                    .textContent
        ),
        'Enter the total number of attendees.'
    );
    await page.screenshot({
        path: join(output, 'number-idle.png'),
        fullPage: true,
    });

    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.keyboard.type('12.50');
    assert.equal(await first.inputValue(), '12.50');
    assert.equal(await native(), 12.5);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('3');
    assert.equal(await first.inputValue(), '12.350');
    assert.equal(await first.evaluate((node) => node.selectionStart), 4);
    await page.keyboard.press('Backspace');
    assert.equal(await first.inputValue(), '12.50');
    assert.equal(await first.evaluate((node) => node.selectionStart), 3);
    const beforeEnter = await writes();
    await first.press('Enter');
    assert.equal(await first.inputValue(), '12.50');
    assert.equal(await native(), 12.5);
    assert.equal(await writes(), beforeEnter);
    assert.equal(await page.locator('#submits').textContent(), '0');
    assert.equal(await page.locator('#rows').textContent(), '0');
    await page.screenshot({
        path: join(output, 'number-focus.png'),
        fullPage: true,
    });

    await first.fill('-');
    assert.equal(await first.inputValue(), '-');
    assert.equal(await first.getAttribute('aria-invalid'), 'true');
    assert.equal(await native(), 12.5);
    assert.equal(await writes(), beforeEnter);
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.inputValue(), '-');
    assert.equal(await writes(), beforeEnter);
    await first.press('Enter');
    assert.equal(await first.inputValue(), '-');
    assert.equal(await writes(), beforeEnter);
    await page.screenshot({
        path: join(output, 'number-partial.png'),
        fullPage: true,
    });
    await page.getByRole('button', { name: 'Lock first field' }).click();
    assert.equal(await first.isDisabled(), true);
    await page.getByRole('button', { name: 'Allow editing' }).click();
    assert.equal(await first.inputValue(), '-');
    assert.equal(await writes(), beforeEnter);
    await page.getByRole('button', { name: 'Update first draft' }).click();
    assert.equal(await first.inputValue(), '42.125');
    assert.equal(await native(), 42.125);
    assert.equal(await first.getAttribute('aria-invalid'), 'false');
    assert.equal(await writes(), beforeEnter);
    for (const partial of ['1e', '1e400', 'NaN', 'Infinity']) {
        await first.fill(partial);
        assert.equal(await first.inputValue(), partial);
        assert.equal(await native(), 42.125);
        assert.equal(await writes(), beforeEnter);
    }
    await first.fill('-2.75');
    assert.equal(await native(), -2.75);
    await first.fill('1e2');
    assert.equal(await first.inputValue(), '1e2');
    assert.equal(await native(), 100);
    await first.fill('');
    assert.equal(await native(), null);
    await first.fill('0');
    assert.equal(await native(), 0);
    assert.equal(await first.getAttribute('aria-invalid'), 'false');
    const beforeRemount = await writes();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.inputValue(), '0');
    assert.equal(await writes(), beforeRemount);
    assert.equal(await page.locator('#rows').textContent(), '0');
    assert.equal(await page.locator('#submits').textContent(), '0');
    await page.emulateMedia({ forcedColors: 'active' });
    await first.focus();
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.screenshot({
        path: join(output, 'number-forced-colors.png'),
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
        path: join(output, 'number-mobile.png'),
        fullPage: true,
    });
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(
            {
                browser: browser.version(),
                transport:
                    'synthetic public scalar model and local drafts only',
                writes: await writes(),
                externalRequests: 0,
                checks: [
                    'native keyboard typing and caret',
                    'native Enter in the synthetic host',
                    'unique labels and feedback associations',
                    'decimal keyboard and exact precision',
                    'zero versus empty native values',
                    'incomplete and nonfinite input retain last native value',
                    'StrictMode/remount preserves incomplete owner input',
                    'permissions and external replacement',
                    'pending and absent scalar capability stay disabled',
                    'configured numeric login masking',
                    'no Portal row activation',
                    'forced colors',
                    'narrow layout',
                ],
                screenshots: [
                    'number-idle.png',
                    'number-focus.png',
                    'number-partial.png',
                    'number-forced-colors.png',
                    'number-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`Number browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
