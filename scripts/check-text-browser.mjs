// Local synthetic UI proof; no backend, fixture mutation, credentials or deployment.
// Run after build: node scripts/check-text-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/text-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-text/main.ts'],
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
        response.end(readFileSync('examples/react-text/index.html'));
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
        executablePath: process.env.SDK_TEXT_CHROMIUM ?? '/usr/bin/chromium',
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
        .getByRole('heading', { name: 'Room for the right words.' })
        .waitFor();
    const first = page.getByRole('textbox', {
        name: 'Project name',
        exact: true,
    });
    const capped = page.getByRole('textbox', {
        name: 'Short name',
        exact: true,
    });
    const writes = async () =>
        Number(await page.locator('#writes').textContent());
    assert.equal(await writes(), 0);
    assert.equal(await page.locator('input').count(), 8);
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(
        await first.getAttribute('placeholder'),
        'Give your project a name'
    );
    assert.equal(await first.getAttribute('aria-required'), 'true');
    assert.equal(
        await page
            .getByLabel('Access phrase', { exact: true })
            .getAttribute('type'),
        'password'
    );
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Reference', exact: true })
            .isDisabled(),
        true
    );
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Release name', exact: true })
            .isDisabled(),
        true
    );
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Compact note', exact: true })
            .getAttribute('aria-label'),
        'Compact note'
    );
    const invalid = page.getByRole('textbox', {
        name: 'Team name',
        exact: true,
    });
    assert.equal(await invalid.getAttribute('aria-invalid'), 'true');
    assert.equal(
        await invalid.evaluate(
            (node) =>
                document.getElementById(node.getAttribute('aria-describedby'))
                    .textContent
        ),
        'Please enter a team name.'
    );
    await page.screenshot({
        path: join(output, 'text-idle.png'),
        fullPage: true,
    });

    // Native keyboard edits in the middle must preserve the selection/caret.
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.keyboard.type('Studio');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('X');
    assert.equal(await first.inputValue(), 'StuXdio');
    assert.equal(await first.evaluate((node) => node.selectionStart), 4);
    await page.keyboard.press('Backspace');
    assert.equal(await first.inputValue(), 'Studio');
    assert.equal(await first.evaluate((node) => node.selectionStart), 3);
    await page.screenshot({
        path: join(output, 'text-focus.png'),
        fullPage: true,
    });
    await first.fill('  Exact text  ');
    assert.equal(await first.inputValue(), '  Exact text  ');
    // Exercise the browser's Enter default action in the synthetic host form.
    const beforeEnter = await writes();
    await first.press('Enter');
    assert.equal(await first.inputValue(), '  Exact text  ');
    assert.equal(await writes(), beforeEnter);
    assert.equal(await page.locator('#rows').textContent(), '0');
    assert.equal(await page.locator('#submits').textContent(), '0');
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    const beforeRemount = await writes();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.inputValue(), '  Exact text  ');
    assert.equal(await writes(), beforeRemount);
    await page
        .getByRole('button', { name: 'Clear Project name', exact: true })
        .click();
    assert.equal(await first.inputValue(), '');
    assert.equal(await writes(), beforeRemount + 1);
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await page
            .getByRole('button', { name: 'Clear Project name', exact: true })
            .isDisabled(),
        true
    );
    await capped.fill('abcdefghijklmnop');
    assert.equal(await capped.inputValue(), 'abcdefghijkl');
    assert.equal(
        await page.locator('.mx-sdk-text-count').textContent(),
        '12/12'
    );

    // Real Chromium dispatch/order with a synthetic IME; no OS IME claim.
    const compose = async (input, type) =>
        input.evaluate((node, eventType) => {
            node.dispatchEvent(
                new CompositionEvent(eventType, { bubbles: true })
            );
        }, type);
    const compositionInput = async (input, value) =>
        input.evaluate((node, text) => {
            Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value'
            ).set.call(node, text);
            node.dispatchEvent(
                new InputEvent('input', {
                    bubbles: true,
                    isComposing: true,
                    inputType: 'insertCompositionText',
                })
            );
        }, value);
    await capped.focus();
    const beforeComposition = await writes();
    await compose(capped, 'compositionstart');
    const composed = '日本語の長い名前を入力する';
    await compositionInput(capped, composed);
    assert.equal(await capped.inputValue(), composed);
    assert.equal(await writes(), beforeComposition);
    // Enter must not prematurely commit the simulated composition or submit.
    await capped.press('Enter');
    assert.equal(await capped.inputValue(), composed);
    assert.equal(await writes(), beforeComposition);
    assert.equal(await page.locator('#rows').textContent(), '0');
    assert.equal(await page.locator('#submits').textContent(), '0');
    await compose(capped, 'compositionend');
    assert.equal(await capped.inputValue(), composed.slice(0, 12));
    assert.equal(await writes(), beforeComposition + 1);
    await compositionInput(capped, composed);
    assert.equal(await writes(), beforeComposition + 1);
    assert.equal(await capped.inputValue(), composed.slice(0, 12));

    await first.focus();
    await compose(first, 'compositionstart');
    await compositionInput(first, 'unfinished');
    const beforeReplacement = await writes();
    // Programmatic click avoids blur, so the owner changes mid-composition.
    await page
        .getByRole('button', { name: 'Update first draft' })
        .evaluate((node) => node.click());
    assert.equal(await first.inputValue(), 'External update');
    await compositionInput(first, 'late composition');
    await compose(first, 'compositionend');
    assert.equal(await first.inputValue(), 'External update');
    assert.equal(await writes(), beforeReplacement);
    await page.getByRole('button', { name: 'Lock first field' }).click();
    assert.equal(await first.isDisabled(), true);
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.inputValue(), 'External update');
    assert.equal(await first.isDisabled(), true);
    assert.equal(await writes(), beforeReplacement);
    await page.getByRole('button', { name: 'Allow editing' }).click();
    assert.equal(await first.isDisabled(), false);
    assert.equal(await page.locator('#rows').textContent(), '0');
    assert.equal(await page.locator('#submits').textContent(), '0');
    assert.equal(await page.locator('iframe,video,a').count(), 0);
    await page.emulateMedia({ forcedColors: 'active' });
    await first.focus();
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.screenshot({
        path: join(output, 'text-forced-colors.png'),
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
        path: join(output, 'text-mobile.png'),
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
                writes: await writes(),
                externalRequests: 0,
                checks: [
                    'native keyboard typing and caret',
                    'native Enter preserves draft without row activation or form submission',
                    'visible keyboard focus',
                    'unique IDs',
                    'exact whitespace',
                    'character cap and count',
                    'password masking',
                    'read-only and pending',
                    'validation association',
                    'hidden title accessible name',
                    'clear and focus',
                    'StrictMode/remount preserves owner',
                    'simulated IME commits once',
                    'Enter during simulated IME does not commit or submit',
                    'replacement during composition cancels',
                    'permission changes',
                    'no Portal row activation or implicit submission',
                    'forced colors',
                    'mobile overflow',
                ],
                screenshots: [
                    'text-idle.png',
                    'text-focus.png',
                    'text-forced-colors.png',
                    'text-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`Text browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
