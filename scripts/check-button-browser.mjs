// Local synthetic UI proof; no backend, fixture mutation, credentials or deployment.
// Run after build: node scripts/check-button-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/button-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-button/main.ts'],
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
        response.end(readFileSync('examples/react-button/index.html'));
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
        executablePath: process.env.SDK_BUTTON_CHROMIUM ?? '/usr/bin/chromium',
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
        .getByRole('heading', { name: 'Small button. Clear action.' })
        .waitFor();
    assert.equal(await page.locator('#requests').textContent(), '0');
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').textContent(), 'View project');
    assert.equal(
        await page
            .locator(':focus')
            .evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    // Verify text contrast for every packaged configured palette, including hover.
    const palette = [
        ...readFileSync('src/react/button.css', 'utf8').matchAll(
            /data-color=['"]([^'"]+)['"]/g
        ),
    ].map((match) => match[1]);
    const contrast = async () =>
        page.getByRole('link', { name: 'View project' }).evaluate((node) => {
            const style = getComputedStyle(node);
            const luminance = (color) =>
                color
                    .match(/[\d.]+/g)
                    .slice(0, 3)
                    .map(Number)
                    .map((value) => value / 255)
                    .map((value) =>
                        value <= 0.04045
                            ? value / 12.92
                            : ((value + 0.055) / 1.055) ** 2.4
                    )
                    .reduce(
                        (sum, value, index) =>
                            sum + value * [0.2126, 0.7152, 0.0722][index],
                        0
                    );
            const [low, high] = [
                luminance(style.color),
                luminance(style.backgroundColor),
            ].sort((a, b) => a - b);
            return (high + 0.05) / (low + 0.05);
        });
    for (const color of palette) {
        await page
            .getByRole('link', { name: 'View project' })
            .evaluate(
                (node, color) => node.setAttribute('data-color', color),
                color
            );
        await page.mouse.move(0, 0);
        assert((await contrast()) >= 4.5, `${color} normal text contrast`);
        await page.getByRole('link', { name: 'View project' }).hover();
        assert((await contrast()) >= 4.5, `${color} hover text contrast`);
    }
    await page
        .getByRole('link', { name: 'View project' })
        .evaluate((node) => node.removeAttribute('data-color'));
    await page.mouse.move(0, 0);
    await page.screenshot({
        path: join(output, 'button-idle.png'),
        fullPage: true,
    });
    const action = page.getByRole('button', { name: 'Prepare project' });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    assert.equal(await action.getAttribute('aria-busy'), 'true');
    assert.equal(await action.isDisabled(), true);
    assert.equal(
        await action
            .locator('.mx-sdk-button-spinner')
            .evaluate((node) => getComputedStyle(node).animationName),
        'none'
    );
    await page.screenshot({
        path: join(output, 'button-pending.png'),
        fullPage: true,
    });
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    await page
        .getByText('Request received. Your project is ready.', { exact: true })
        .waitFor();
    assert.equal(await page.locator('#requests').textContent(), '1');
    await page.getByRole('button', { name: 'Run once' }).click();
    await page.getByText('Error triggering webhook', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(
        await page.getByRole('button', { name: 'Run once' }).isDisabled(),
        true
    );
    assert.equal(await page.locator('#requests').textContent(), '2');
    await page.getByRole('button', { name: 'Envoyer' }).click();
    await page
        .getByText('Webhook déclenché avec succès', { exact: true })
        .waitFor();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.waitForFunction(
        () =>
            document
                .querySelector('[data-color="yellow-light"]')
                .getAttribute('aria-busy') === 'false'
    );
    assert.equal(
        await page
            .getByRole('article')
            .filter({
                has: page.getByRole('heading', { name: 'Quiet success' }),
            })
            .getByRole('status')
            .textContent(),
        ''
    );
    assert.equal(await page.locator('#requests').textContent(), '4');
    assert.ok(
        await page.getByText('Row activations: 0', { exact: true }).isVisible()
    );
    assert.equal(
        await page.getByRole('button', { name: 'View project' }).isDisabled(),
        true
    );
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'View project' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert.equal(new URL(popup.url()).searchParams.get('opened'), 'button');
    await popup.close();
    await page.screenshot({
        path: join(output, 'button-feedback.png'),
        fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
        ),
        false
    );
    await page.screenshot({
        path: join(output, 'button-mobile.png'),
        fullPage: true,
    });
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(
            {
                browser: browser.version(),
                origin,
                transport: 'synthetic only',
                requests: 4,
                externalRequests: 0,
                checks: [
                    'all configured palette text contrasts >= 4.5:1',
                    'keyboard focus and Enter',
                    'pending spinner and reduced motion',
                    'StrictMode/remount singleflight',
                    'uncertainty remains disabled',
                    'localized and empty feedback',
                    'row propagation',
                    'native target blank',
                    'unique IDs',
                    'mobile overflow',
                ],
                screenshots: [
                    'button-idle.png',
                    'button-pending.png',
                    'button-feedback.png',
                    'button-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`Button browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
