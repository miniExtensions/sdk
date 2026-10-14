// Local synthetic UI proof; no backend, credentials, fixture mutation or Save.
// Run after build: node scripts/check-datetime-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/datetime-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-datetime/main.ts'],
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
        response.end(readFileSync('examples/react-datetime/index.html'));
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
            process.env.SDK_DATETIME_CHROMIUM ?? '/usr/bin/chromium',
        headless: true,
        args: ['--disable-gpu'],
    });
    const context = await browser.newContext({
        viewport: { width: 1180, height: 940 },
        reducedMotion: 'reduce',
        // Native timestamps retain explicit offsets independently of browser timezone.
        timezoneId: 'America/Los_Angeles',
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
        .getByRole('heading', { name: 'An instant, with its offset.' })
        .waitFor();
    const first = page.getByRole('textbox', {
        name: 'Target datetime',
        exact: true,
    });
    const binding = page.getByRole('textbox', {
        name: 'Binding datetime',
        exact: true,
    });
    const writes = async () =>
        Number(await page.locator('#writes').textContent());
    const native = async (index = 0) =>
        page.locator(`#native-${index}`).textContent();
    const noEvents = async () => {
        assert.equal(await page.locator('#rows').textContent(), '0');
        assert.equal(await page.locator('#submits').textContent(), '0');
    };
    assert.equal(await writes(), 0);
    assert.equal(await page.locator('input').count(), 8);
    assert.equal(await first.inputValue(), '2026-10-14T09:30:00.120+05:45');
    assert.equal(await native(), '"2026-10-14T09:30:00.120+05:45"');
    assert.equal(await first.getAttribute('type'), 'text');
    assert.equal(
        await first.getAttribute('placeholder'),
        'YYYY-MM-DDTHH:mm:ssZ'
    );
    assert.equal(await first.getAttribute('aria-required'), 'true');
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(
        await page
            .getByLabel('Private milestone', { exact: true })
            .getAttribute('type'),
        'password'
    );
    assert.equal(await native(1), 'Masked');
    assert.equal(
        (await page.locator('body').innerText()).includes(
            '2025-06-17T08:45:00Z'
        ),
        false
    );
    for (const name of ['Archive datetime', 'Release datetime']) {
        assert.equal(
            await page.getByRole('textbox', { name, exact: true }).isDisabled(),
            true
        );
    }
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Compact datetime', exact: true })
            .getAttribute('aria-label'),
        'Compact datetime'
    );
    const invalid = page.getByRole('textbox', {
        name: 'Review datetime',
        exact: true,
    });
    assert.equal(await invalid.getAttribute('aria-invalid'), 'true');
    assert.equal(
        await invalid.evaluate(
            (node) =>
                document.getElementById(node.getAttribute('aria-describedby'))
                    .textContent
        ),
        'Choose a review instant.'
    );
    assert.equal(await page.locator('.binding-datetime').count(), 1);
    await page.screenshot({
        path: join(output, 'datetime-idle.png'),
        fullPage: true,
    });

    // Native keyboard editing must keep both the caret and unfinished text.
    for (let i = 0; i < 7; i++) await page.keyboard.press('Tab');
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    // Arrow navigation works consistently on macOS and Linux text controls.
    for (let i = 0; i < 29; i++) await first.press('ArrowRight');
    await first.press('ArrowLeft');
    await page.keyboard.type('X');
    assert.equal(await first.inputValue(), '2026-10-14T09:30:00.120+05:4X5');
    assert.equal(await first.evaluate((node) => node.selectionStart), 29);
    assert.equal(await native(), '"2026-10-14T09:30:00.120+05:45"');
    assert.equal(await writes(), 0);
    await first.press('Backspace');
    assert.equal(await first.inputValue(), '2026-10-14T09:30:00.120+05:45');
    assert.equal(await first.evaluate((node) => node.selectionStart), 28);
    await first.fill('2024-02-29T12:');
    assert.equal(await first.inputValue(), '2024-02-29T12:');
    assert.equal(await first.getAttribute('aria-invalid'), 'true');
    assert.equal(await native(), '"2026-10-14T09:30:00.120+05:45"');
    const beforeRemount = await writes();
    await first.press('Enter');
    await noEvents();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.inputValue(), '2024-02-29T12:');
    assert.equal(await native(), '"2026-10-14T09:30:00.120+05:45"');
    assert.equal(await writes(), beforeRemount);
    await first.fill('2024-02-29T12:30:45.007+05:45');
    assert.equal(await native(), '"2024-02-29T12:30:45.007+05:45"');
    assert.equal(await first.getAttribute('aria-invalid'), 'false');
    const afterLeapDay = await writes();
    for (const input of [
        '2024-02-29T12:30:45',
        '2024-02-29T12:30Z',
        '2024-02-29T12:30:60Z',
        '2024-02-29T12:30:45-00:00',
        '2024-02-29T12:30:45.1234Z',
        '2023-02-29T12:30:45.007+05:45',
    ]) {
        await first.fill(input);
        assert.equal(await first.inputValue(), input);
        assert.equal(await first.getAttribute('aria-invalid'), 'true');
        assert.equal(await native(), '"2024-02-29T12:30:45.007+05:45"');
        assert.equal(await writes(), afterLeapDay);
    }
    await first.focus();
    await page.screenshot({
        path: join(output, 'datetime-invalid-focus.png'),
        fullPage: true,
    });
    await page
        .getByRole('button', { name: 'Clear Target datetime', exact: true })
        .click();
    assert.equal(await first.inputValue(), '');
    assert.equal(await native(), 'null');
    assert.equal(await writes(), afterLeapDay + 1);
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await page
            .getByRole('button', { name: 'Clear Target datetime', exact: true })
            .isDisabled(),
        true
    );
    await noEvents();

    // The binding API uses the same owner-held partial/valid/clear semantics.
    await binding.fill('2028-02-29T01:30:');
    assert.equal(await binding.inputValue(), '2028-02-29T01:30:');
    assert.equal(await native(6), '"2024-02-29T12:30:00Z"');
    const beforeBindingRemount = await writes();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await binding.inputValue(), '2028-02-29T01:30:');
    assert.equal(await writes(), beforeBindingRemount);
    await binding.fill('2028-02-29T01:30:00.120-07:00');
    assert.equal(await native(6), '"2028-02-29T01:30:00.120-07:00"');
    await binding.press('Enter');
    await page
        .getByRole('button', { name: 'Clear binding datetime', exact: true })
        .click();
    assert.equal(await native(6), 'null');
    assert.equal(
        await binding.evaluate((node) => node === document.activeElement),
        true
    );
    await noEvents();

    await first.fill('2030-');
    const beforeExternal = await writes();
    await page.getByRole('button', { name: 'Update first draft' }).click();
    assert.equal(await first.inputValue(), '2024-11-03T01:30:00.120-04:00');
    assert.equal(await native(), '"2024-11-03T01:30:00.120-04:00"');
    assert.equal(await writes(), beforeExternal);
    await page.getByRole('button', { name: 'Lock first field' }).click();
    assert.equal(await first.isDisabled(), true);
    assert.equal(await first.inputValue(), '2024-11-03T01:30:00.120-04:00');
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.isDisabled(), true);
    assert.equal(await writes(), beforeExternal);
    await page.getByRole('button', { name: 'Allow editing' }).click();
    assert.equal(await first.isDisabled(), false);
    await page.getByRole('button', { name: 'Hide first field' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Hidden');
    assert.equal(
        (await page.locator('body').innerText()).includes(
            '2024-11-03T01:30:00.120-04:00'
        ),
        false
    );
    await page.getByRole('button', { name: 'Show first field' }).click();
    assert.equal(await first.inputValue(), '2024-11-03T01:30:00.120-04:00');
    assert.equal(await writes(), beforeExternal);

    const client = page.getByRole('textbox', {
        name: 'Client-zone appointment',
        exact: true,
    });
    assert.equal(await client.inputValue(), '2024-07-01T12:00:00Z');
    await page.getByRole('button', { name: 'Change client timezone' }).click();
    assert.equal(await client.count(), 0);
    assert.equal(await native(7), 'Retired');
    assert.equal(await first.isDisabled(), false);
    assert.equal(await first.inputValue(), '2024-11-03T01:30:00.120-04:00');
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await client.count(), 0);
    assert.equal(await first.isDisabled(), false);
    assert.equal(await writes(), beforeExternal);

    await page.emulateMedia({ forcedColors: 'active' });
    await first.focus();
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.screenshot({
        path: join(output, 'datetime-forced-colors.png'),
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
    // Keep the narrow viewport in evidence; avoid browser full-page tiling.
    await page.screenshot({
        path: join(output, 'datetime-mobile.png'),
        fullPage: false,
    });
    await page.getByRole('button', { name: 'Retire first owner' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Retired');
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await writes(), beforeExternal);
    await noEvents();
    assert.equal(await page.locator('iframe,video,a').count(), 0);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(
            {
                browser: browser.version(),
                transport: 'synthetic local drafts only',
                timezone: 'America/Los_Angeles',
                writes: await writes(),
                externalRequests: 0,
                checks: [
                    'native keyboard typing and caret',
                    'partial input retains the accepted native draft',
                    'explicit offset and subseconds preserved; invalid timestamp retained without native write',
                    'clear writes null and retains focus without submission',
                    'StrictMode/remount preserves owner input and native state',
                    'binding component uses the same owner semantics and custom clear label',
                    'external replacement resets partial input',
                    'explicit-offset DST instant preserved without local-time inference',
                    'seconds and known explicit offset required; leap second and excessive precision refused',
                    'client timezone replacement retires its owner while fixed-zone control remains editable',
                    'read-only and pending controls',
                    'permission changes',
                    'hidden and retired hosts omit controls and private readouts',
                    'masked datetime does not appear in plain text',
                    'validation association and unique IDs',
                    'hidden title accessible name',
                    'visible keyboard focus',
                    'no Portal row activation or implicit form submission',
                    'forced colors',
                    'mobile overflow',
                ],
                screenshots: [
                    'datetime-idle.png',
                    'datetime-invalid-focus.png',
                    'datetime-forced-colors.png',
                    'datetime-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`DateTime browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
