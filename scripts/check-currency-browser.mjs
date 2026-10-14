// Local synthetic UI proof; Save is an in-memory checkpoint with no transport.
// Run after build: node scripts/check-currency-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/currency-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-currency/main.ts'],
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
        response.end(readFileSync('examples/react-currency/index.html'));
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
            process.env.SDK_CURRENCY_CHROMIUM ?? '/usr/bin/chromium',
        headless: true,
        args: ['--disable-gpu'],
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
        .getByRole('heading', { name: 'Amounts, without rounding surprises.' })
        .waitFor();
    const first = page.getByRole('textbox', {
        name: 'Project budget',
        exact: true,
    });
    const binding = page.getByRole('textbox', {
        name: 'Binding amount',
        exact: true,
    });
    const writes = async () =>
        Number(await page.locator('#writes').textContent());
    const saves = async () =>
        Number(await page.locator('#saves').textContent());
    const saved = async () => page.locator('#saved').textContent();
    const native = async (index = 0) =>
        page.locator(`#native-${index}`).textContent();
    const descriptions = (input) =>
        input.evaluate((node) =>
            (node.getAttribute('aria-describedby') ?? '')
                .split(' ')
                .filter(Boolean)
                .map((id) => document.getElementById(id)?.textContent)
        );
    const noEvents = async () => {
        assert.equal(await page.locator('#rows').textContent(), '0');
        assert.equal(await page.locator('#submits').textContent(), '0');
    };
    const singleLineSymbols = async (symbols) => {
        const fits = await page
            .locator('.mx-sdk-currency-symbol')
            .evaluateAll(
                (nodes, names) =>
                    nodes
                        .filter((node) => names.includes(node.textContent))
                        .map(
                            (node) =>
                                node.getBoundingClientRect().height <=
                                parseFloat(getComputedStyle(node).lineHeight) +
                                    1
                        ),
                symbols
            );
        assert.equal(fits.length, symbols.length);
        assert(
            fits.every(Boolean),
            'Short currency symbols should stay on one line.'
        );
    };
    assert.equal(await writes(), 0);
    assert.equal(await saves(), 0);
    assert.equal(await saved(), '1234.56789');
    assert.equal(await page.locator('input').count(), 11);
    assert.equal(await first.inputValue(), '1234.56789');
    assert.equal(await native(), '1234.56789');
    assert.equal(await first.getAttribute('type'), 'text');
    assert.equal(await first.getAttribute('inputmode'), 'decimal');
    assert.equal(await first.getAttribute('aria-required'), 'true');
    assert.deepEqual(await descriptions(first), ['$']);
    const euro = page.getByRole('textbox', {
        name: 'Euro amount',
        exact: true,
    });
    assert.equal(await euro.inputValue(), '12.3');
    assert.deepEqual(await descriptions(euro), ['€']);
    const literal = page.getByRole('textbox', {
        name: 'Custom-symbol amount',
        exact: true,
    });
    assert.deepEqual(await descriptions(literal), ['<coin>']);
    assert.equal(await page.locator('coin').count(), 0);
    await singleLineSymbols(['$', '<coin>', 'US$', 'CAD', 'A$', 'R$']);
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length);
    for (const name of [
        'Recorded amount',
        'Pending amount',
        'Configured readonly amount',
    ]) {
        assert.equal(
            await page.getByRole('textbox', { name, exact: true }).isDisabled(),
            true
        );
    }
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Recorded amount', exact: true })
            .inputValue(),
        '9876.54321'
    );
    assert.equal(
        await page
            .getByRole('textbox', {
                name: 'Configured readonly amount',
                exact: true,
            })
            .inputValue(),
        '150.12345'
    );
    assert.equal(
        await page
            .getByLabel('Private amount', { exact: true })
            .getAttribute('type'),
        'password'
    );
    assert.equal(await native(5), 'Masked');
    assert.equal(
        (await page.locator('body').innerText()).includes('88.76543'),
        false
    );
    const compact = page.getByRole('textbox', {
        name: 'Compact amount',
        exact: true,
    });
    assert.equal(await compact.getAttribute('aria-label'), 'Compact amount');
    assert.equal(await compact.inputValue(), '0');
    assert.equal(await native(8), '0');
    const invalid = page.getByRole('textbox', {
        name: 'Review amount',
        exact: true,
    });
    assert.equal(await invalid.getAttribute('aria-invalid'), 'true');
    assert.deepEqual(await descriptions(invalid), [
        'CAD',
        'Enter the review amount.',
    ]);
    assert.equal(await page.locator('.binding-currency').count(), 1);
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
        ),
        false
    );
    await page.screenshot({
        path: join(output, 'currency-idle.png'),
        fullPage: true,
    });

    // Native keyboard input keeps the caret and never invokes the Save checkpoint.
    for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    const initial = await first.inputValue();
    for (let i = 0; i < initial.length; i++) await first.press('ArrowRight');
    await first.press('ArrowLeft');
    await page.keyboard.type('X');
    assert.equal(
        await first.inputValue(),
        initial.slice(0, -1) + 'X' + initial.slice(-1)
    );
    assert.equal(
        await first.evaluate((node) => node.selectionStart),
        initial.length
    );
    assert.equal(await native(), '1234.56789');
    assert.equal(await writes(), 0);
    await first.press('Backspace');
    assert.equal(await first.inputValue(), initial);
    assert.equal(
        await first.evaluate((node) => node.selectionStart),
        initial.length - 1
    );
    assert.equal(await native(), '1234.56789');
    assert.equal(await saves(), 0);
    await first.fill('00123.4500');
    assert.equal(await first.inputValue(), '00123.4500');
    assert.equal(await native(), '123.45');
    await first.blur();
    assert.equal(await first.inputValue(), '00123.4500');
    const beforeRawRemount = await writes();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.inputValue(), '00123.4500');
    assert.equal(await writes(), beforeRawRemount);
    assert.equal(await saved(), '1234.56789');
    assert.equal(await saves(), 0);
    await first.press('Enter');
    await noEvents();
    assert.equal(await saves(), 0);
    await page
        .getByRole('button', { name: 'Save first draft locally' })
        .click();
    assert.equal(await saves(), 1);
    assert.equal(await saved(), '123.45');
    assert.equal(await writes(), beforeRawRemount);

    await first.fill('-');
    assert.equal(await first.getAttribute('aria-invalid'), 'true');
    assert.equal(await native(), '123.45');
    await page
        .getByRole('button', { name: 'Save first draft locally' })
        .click();
    assert.equal(await saves(), 1);
    assert.equal(await saved(), '123.45');
    assert.match(
        await page.locator('#save-status').textContent(),
        /^Save blocked:/
    );
    await first.fill('1e');
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.inputValue(), '1e');
    assert.equal(await first.getAttribute('aria-invalid'), 'true');
    const beforeSymbol = await writes();
    await page.getByRole('button', { name: 'Change currency symbol' }).click();
    assert.equal(await first.inputValue(), '1e');
    assert.deepEqual(await descriptions(first), [
        'CHF',
        'Enter a valid finite number.',
    ]);
    assert.equal(await native(), '123.45');
    assert.equal(await writes(), beforeSymbol);
    assert.equal(await saved(), '123.45');
    await first.fill('1e3');
    assert.equal(await first.inputValue(), '1e3');
    assert.equal(await native(), '1000');
    await first.blur();
    assert.equal(await first.inputValue(), '1e3');
    const beforeSecondSave = await writes();
    assert.equal(await saves(), 1);
    await page
        .getByRole('button', { name: 'Save first draft locally' })
        .click();
    assert.equal(await saves(), 2);
    assert.equal(await saved(), '1000');
    assert.equal(await writes(), beforeSecondSave);
    for (const input of [
        'Infinity',
        'NaN',
        '1e309',
        '$1.00',
        '1,234.50',
        '1 234',
    ]) {
        await first.fill(input);
        assert.equal(await first.inputValue(), input);
        assert.equal(await first.getAttribute('aria-invalid'), 'true');
        assert.equal(await native(), '1000');
        assert.equal(await writes(), beforeSecondSave);
    }
    await first.fill('1e');
    await page.screenshot({
        path: join(output, 'currency-invalid-focus.png'),
        fullPage: true,
    });
    await first.fill('-0.000125');
    assert.equal(await native(), '-0.000125');
    assert.equal(await first.inputValue(), '-0.000125');
    await first.fill('1234.56789');
    assert.equal(await native(), '1234.56789');
    assert.equal(await first.inputValue(), '1234.56789');
    await first.fill('0');
    assert.equal(await native(), '0');
    assert.equal(await first.inputValue(), '0');
    const beforeClear = await writes();
    await page
        .getByRole('button', { name: 'Clear Project budget', exact: true })
        .click();
    assert.equal(await native(), 'null');
    assert.equal(await first.inputValue(), '');
    assert.equal(await writes(), beforeClear + 1);
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await page
            .getByRole('button', { name: 'Clear Project budget', exact: true })
            .isDisabled(),
        true
    );
    assert.equal(await saved(), '1000');
    assert.equal(await saves(), 2);
    await noEvents();

    await binding.fill('1e');
    assert.equal(await native(9), '61.23456');
    const beforeBindingRemount = await writes();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await binding.inputValue(), '1e');
    assert.equal(await writes(), beforeBindingRemount);
    await binding.fill('2.5e-3');
    assert.equal(await native(9), '0.0025');
    await binding.blur();
    assert.equal(await binding.inputValue(), '2.5e-3');
    await binding.press('Enter');
    await page
        .getByRole('button', { name: 'Clear binding currency', exact: true })
        .click();
    assert.equal(await native(9), 'null');
    assert.equal(
        await binding.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(await saves(), 2);
    await noEvents();

    await first.fill('1e');
    const beforeExternal = await writes();
    await page.getByRole('button', { name: 'Update first draft' }).click();
    assert.equal(await first.inputValue(), '-9876.54321');
    assert.equal(await native(), '-9876.54321');
    assert.equal(await writes(), beforeExternal);
    await page.getByRole('button', { name: 'Lock first field' }).click();
    assert.equal(await first.isDisabled(), true);
    assert.equal(await first.inputValue(), '-9876.54321');
    await page
        .getByRole('button', { name: 'Save first draft locally' })
        .click();
    assert.equal(await saves(), 2);
    assert.equal(await saved(), '1000');
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.isDisabled(), true);
    assert.equal(await writes(), beforeExternal);
    await page.getByRole('button', { name: 'Allow editing' }).click();
    assert.equal(await first.isDisabled(), false);
    await page.getByRole('button', { name: 'Hide first field' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Hidden');
    assert.equal(await saved(), 'Hidden');
    assert.equal(
        (await page.locator('body').innerText()).includes('-9876.54321'),
        false
    );
    await page.getByRole('button', { name: 'Show first field' }).click();
    assert.equal(await first.inputValue(), '-9876.54321');
    await page.emulateMedia({ forcedColors: 'active' });
    await first.focus();
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.screenshot({
        path: join(output, 'currency-forced-colors.png'),
        fullPage: true,
    });
    await page.emulateMedia({ forcedColors: 'none' });
    await page.setViewportSize({ width: 390, height: 844 });
    await singleLineSymbols(['CHF', '<coin>', 'US$', 'CAD', 'A$', 'R$']);
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
        ),
        false
    );
    await page.screenshot({
        path: join(output, 'currency-mobile.png'),
        fullPage: false,
    });
    await page.getByRole('button', { name: 'Retire first owner' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Retired');
    assert.equal(await saved(), 'Retired');
    assert.equal(
        await page
            .getByRole('button', { name: 'Save first draft locally' })
            .isDisabled(),
        true
    );
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await writes(), beforeExternal);
    assert.equal(await saves(), 2);
    await noEvents();
    assert.equal(await page.locator('iframe,video,a,coin').count(), 0);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(
            {
                browser: browser.version(),
                transport:
                    'synthetic local drafts and in-memory Save checkpoint only',
                writes: await writes(),
                explicitLocalSaves: await saves(),
                externalRequests: 0,
                checks: [
                    'raw numeric precision without grouping, rounding or padding',
                    'literal symbols outside inputs with accessible descriptions',
                    'short symbols stay on one line on desktop and narrow screens',
                    'markup-like symbol remains plain text',
                    'native keyboard typing and caret',
                    'raw accepted input survives blur and remount',
                    'minus and exponent partial drafts survive remount without native writes',
                    'symbol and precision metadata changes preserve partial and native drafts',
                    'finite exponents accepted; nonfinite and localized input refused',
                    'negative fractions preserve precision',
                    'zero distinct from null; clear retains focus',
                    'explicit Save alone changes local checkpoint; invalid and readonly Save refused',
                    'binding component shares scalar model and custom clear label',
                    'external replacement resets input without writing',
                    'readonly slot preserves precision without editing model',
                    'permission, pending and configured-readonly guards',
                    'hidden and retired hosts omit controls and private readouts',
                    'password masking',
                    'validation association and unique IDs',
                    'hidden title accessible name',
                    'visible keyboard focus',
                    'no Portal row activation or implicit submission',
                    'forced colors',
                    'desktop and narrow layout without horizontal overflow, including long symbol',
                ],
                screenshots: [
                    'currency-idle.png',
                    'currency-invalid-focus.png',
                    'currency-forced-colors.png',
                    'currency-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`Currency browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
