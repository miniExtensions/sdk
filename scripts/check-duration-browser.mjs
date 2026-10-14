// Local synthetic UI proof; no backend, credentials, fixture mutation or Save.
// Run after build: node scripts/check-duration-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { getFormattedDuration } from '@miniextensions/sdk/formulas';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/duration-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-duration/main.ts'],
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
// Keep native implicit submission separate from the dashboard's multiple-input
// form. This public-model fixture contains exactly one form-associated text input.
const enterBundle = await build({
    stdin: {
        resolveDir: process.cwd(),
        sourcefile: 'duration-enter-fixture.js',
        contents: `
import { createElement as h, StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createDurationFieldModel } from '@miniextensions/sdk/ui';
import { renderDurationField } from '@miniextensions/sdk/react';
let native = 61.23456;
const counters = { submissions: [], parentKeyDowns: 0, writes: 0, keys: [] };
const report = () => {
    document.getElementById('enter-result').textContent = JSON.stringify({ ...counters, native });
};
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    queueMicrotask(() => {
        counters.keys.push({ isTrusted: event.isTrusted, isComposing: event.isComposing, defaultPrevented: event.defaultPrevented });
        report();
    });
}, true);
const model = createDurationFieldModel({
    getValue: () => native,
    getDurationFormat: () => 'h:mm:ss.SSS',
    canEdit: () => true,
    isCurrent: () => true,
    write: (value) => { native = value; counters.writes++; report(); return true; },
});
const config = { type: 'duration', options: { durationFormat: 'h:mm:ss.SSS' } };
const submitButton = new URLSearchParams(location.search).get('submit') === 'button';
function App() {
    useSyncExternalStore(model.subscribe, () => model.getState().revision);
    const props = {
        physicalKind: 'duration', presentation: { type: 'physical', config },
        fieldId: 'enter-duration', title: 'Enter duration',
        field: { id: 'enter-duration', name: 'Enter duration', description: null, isPrimaryField: false, isComputed: false, config },
        displayConfig: {}, writeConfig: {}, value: native, context: 'form',
        computed: false, dirty: counters.writes > 0, pending: false, validation: [], error: null,
        capability: {
            type: 'editable',
            setValue: () => { throw Error('No direct value fallback'); },
            scalar: { state: model.getState(), setInput: model.setInput, setChecked: model.setChecked, setFocused: model.setFocused },
        },
    };
    return h('form', {
        id: 'enter-form',
        onKeyDown: () => { counters.parentKeyDowns++; report(); },
        onSubmit: (event) => {
            // Observe the browser submit event, then prevent navigation. No SDK Save.
            event.preventDefault();
            counters.submissions.push({ submitter: event.nativeEvent.submitter?.textContent ?? null });
            report();
        },
    }, renderDurationField(props), submitButton ? h('button', { type: 'submit' }, 'Native submit') : null);
}
report();
createRoot(document.getElementById('enter-app')).render(h(StrictMode, null, h(App)));
`,
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    outfile: join(output, 'duration-enter.js'),
    write: false,
});
assets.set('/duration-enter.js', enterBundle.outputFiles[0].contents);
const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') {
        response.setHeader('content-type', 'text/html');
        response.end(readFileSync('examples/react-duration/index.html'));
    } else if (path === '/enter') {
        response.setHeader('content-type', 'text/html');
        response.end(
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Duration native Enter fixture</title></head><body><main id="enter-app"></main><pre id="enter-result"></pre><script type="module" src="/duration-enter.js"></script></body></html>'
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
let browser;
try {
    browser = await chromium.launch({
        executablePath:
            process.env.SDK_DURATION_CHROMIUM ?? '/usr/bin/chromium',
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
        .getByRole('heading', { name: 'Time, without losing precision.' })
        .waitFor();
    const first = page.getByRole('textbox', {
        name: 'Work duration',
        exact: true,
    });
    const binding = page.getByRole('textbox', {
        name: 'Binding duration',
        exact: true,
    });
    const writes = async () =>
        Number(await page.locator('#writes').textContent());
    const native = async (index = 0) =>
        page.locator(`#native-${index}`).textContent();
    const noDashboardEvents = async () => {
        assert.equal(await page.locator('#rows').textContent(), '0');
        assert.equal(await page.locator('#submits').textContent(), '0');
    };
    assert.equal(await writes(), 0);
    assert.equal(await page.locator('input').count(), 12);
    const formats = [
        ['Work duration', 'h:mm:ss.SSS', 3661.23456],
        ['Meeting duration', 'h:mm', 3661.23456],
        ['Travel duration', 'h:mm:ss', 3661.23456],
        ['Lap duration', 'h:mm:ss.S', 61.23456],
        ['Stage duration', 'h:mm:ss.SS', 61.23456],
    ];
    for (const [name, format, value] of formats) {
        const input = page.getByRole('textbox', { name, exact: true });
        assert.equal(
            await input.inputValue(),
            getFormattedDuration(String(value), format, true)
        );
        assert.equal(await input.getAttribute('placeholder'), format);
        assert.equal(await input.getAttribute('inputmode'), 'text');
    }
    assert.equal(await native(), '3661.23456');
    assert.equal(await first.getAttribute('aria-required'), 'true');
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length);
    const readonly = page.getByRole('textbox', {
        name: 'Recorded duration',
        exact: true,
    });
    assert.equal(await readonly.isDisabled(), true);
    assert.equal(
        await readonly.inputValue(),
        getFormattedDuration('9876.54321', 'h:mm:ss.SS', true)
    );
    assert.equal(await native(5), '9876.54321');
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Pending duration', exact: true })
            .isDisabled(),
        true
    );
    assert.equal(
        await page
            .getByLabel('Private duration', { exact: true })
            .getAttribute('type'),
        'password'
    );
    assert.equal(await native(6), 'Masked');
    assert.equal(
        (await page.locator('body').innerText()).includes('55.123'),
        false
    );
    const compact = page.getByRole('textbox', {
        name: 'Compact duration',
        exact: true,
    });
    assert.equal(await compact.getAttribute('aria-label'), 'Compact duration');
    assert.equal(
        await compact.inputValue(),
        getFormattedDuration('0', 'h:mm:ss', true)
    );
    assert.equal(await native(9), '0');
    const invalid = page.getByRole('textbox', {
        name: 'Review duration',
        exact: true,
    });
    assert.equal(await invalid.getAttribute('aria-invalid'), 'true');
    assert.equal(
        await invalid.evaluate(
            (node) =>
                document.getElementById(node.getAttribute('aria-describedby'))
                    .textContent
        ),
        'Enter the review duration.'
    );
    assert.equal(await page.locator('.binding-duration').count(), 1);
    await page.screenshot({
        path: join(output, 'duration-idle.png'),
        fullPage: true,
    });

    // Focusing, blurring and remounting never round native seconds.
    for (let i = 0; i < 7; i++) await page.keyboard.press('Tab');
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await first.blur();
    assert.equal(await native(), '3661.23456');
    assert.equal(await writes(), 0);
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await native(), '3661.23456');
    assert.equal(await writes(), 0);

    // A deliberate keyboard edit may commit the rounded visible value.
    await first.focus();
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
    assert.equal(await native(), '3661.23456');
    assert.equal(await writes(), 0);
    await first.press('Backspace');
    assert.equal(await first.inputValue(), initial);
    assert.equal(
        await first.evaluate((node) => node.selectionStart),
        initial.length - 1
    );
    assert.equal(await native(), '3661.235');

    await first.fill('0001:2:3.120');
    assert.equal(await first.inputValue(), '0001:2:3.120');
    assert.equal(await native(), '3723.12');
    const beforeRawRemount = await writes();
    // Remount without blur so the owner retains its focused raw input.
    await page
        .getByRole('button', { name: 'Remount renderers' })
        .evaluate((node) => node.click());
    assert.equal(await first.inputValue(), '0001:2:3.120');
    assert.equal(await writes(), beforeRawRemount);
    await first.focus();
    await first.blur();
    assert.equal(
        await first.inputValue(),
        getFormattedDuration('3723.12', 'h:mm:ss.SSS', true)
    );
    assert.equal(await native(), '3723.12');
    assert.equal(await writes(), beforeRawRemount);
    await first.fill('1:');
    assert.equal(await first.getAttribute('aria-invalid'), 'true');
    await first.blur();
    assert.equal(await first.inputValue(), '1:');
    assert.equal(await native(), '3723.12');
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.inputValue(), '1:');
    assert.equal(await writes(), beforeRawRemount);
    await first.press('Enter');
    await noDashboardEvents();
    for (const input of ['-', '1e3', '1..2', '1:2:3.1234', '9'.repeat(310)]) {
        await first.fill(input);
        assert.equal(await first.inputValue(), input);
        assert.equal(await first.getAttribute('aria-invalid'), 'true');
        assert.equal(await native(), '3723.12');
        assert.equal(await writes(), beforeRawRemount);
    }
    await first.fill('1:');
    await page.screenshot({
        path: join(output, 'duration-invalid-focus.png'),
        fullPage: true,
    });

    const minutes = page.getByRole('textbox', {
        name: 'Meeting duration',
        exact: true,
    });
    const seconds = page.getByRole('textbox', {
        name: 'Travel duration',
        exact: true,
    });
    await minutes.fill('90');
    assert.equal(await native(1), '5400');
    await minutes.fill('1:90');
    assert.equal(await native(1), '9000');
    await minutes.blur();
    assert.equal(await minutes.inputValue(), '2:30');
    await seconds.fill('90');
    assert.equal(await native(2), '90');
    await seconds.fill('1:90');
    assert.equal(await native(2), '150');
    await seconds.blur();
    assert.equal(await seconds.inputValue(), '2:30');
    await first.fill('-1:02:03.125');
    assert.equal(await native(), '-3723.125');
    await first.fill('1:90:90.125');
    assert.equal(await native(), '9090.125');
    const beforeOverflowBlur = await writes();
    await first.blur();
    assert.equal(
        await first.inputValue(),
        getFormattedDuration('9090.125', 'h:mm:ss.SSS', true)
    );
    assert.equal(await writes(), beforeOverflowBlur);

    await first.fill('0');
    assert.equal(await native(), '0');
    await first.blur();
    assert.equal(
        await first.inputValue(),
        getFormattedDuration('0', 'h:mm:ss.SSS', true)
    );
    const beforeClear = await writes();
    await page
        .getByRole('button', { name: 'Clear Work duration', exact: true })
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
            .getByRole('button', { name: 'Clear Work duration', exact: true })
            .isDisabled(),
        true
    );
    await noDashboardEvents();

    await binding.fill('001:02.120');
    assert.equal(await native(10), '62.12');
    const beforeBindingRemount = await writes();
    await page
        .getByRole('button', { name: 'Remount renderers' })
        .evaluate((node) => node.click());
    assert.equal(await binding.inputValue(), '001:02.120');
    assert.equal(await writes(), beforeBindingRemount);
    await binding.focus();
    await binding.blur();
    assert.equal(
        await binding.inputValue(),
        getFormattedDuration('62.12', 'h:mm:ss.SSS', true)
    );
    assert.equal(await writes(), beforeBindingRemount);
    await binding.fill('-');
    assert.equal(await binding.getAttribute('aria-invalid'), 'true');
    assert.equal(await native(10), '62.12');
    await binding.press('Enter');
    await page
        .getByRole('button', { name: 'Clear binding duration', exact: true })
        .click();
    assert.equal(await native(10), 'null');
    assert.equal(
        await binding.evaluate((node) => node === document.activeElement),
        true
    );
    await noDashboardEvents();

    await first.fill('1:');
    const beforeExternal = await writes();
    await page.getByRole('button', { name: 'Update first draft' }).click();
    const replacement = getFormattedDuration(
        '-7322.34567',
        'h:mm:ss.SSS',
        true
    );
    assert.equal(await first.inputValue(), replacement);
    assert.equal(await native(), '-7322.34567');
    assert.equal(await writes(), beforeExternal);
    await page.getByRole('button', { name: 'Lock first field' }).click();
    assert.equal(await first.isDisabled(), true);
    assert.equal(await first.inputValue(), replacement);
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.isDisabled(), true);
    assert.equal(await writes(), beforeExternal);
    await page.getByRole('button', { name: 'Allow editing' }).click();
    assert.equal(await first.isDisabled(), false);
    await page.getByRole('button', { name: 'Hide first field' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Hidden');
    assert.equal(
        (await page.locator('body').innerText()).includes('-7322.34567'),
        false
    );
    await page.getByRole('button', { name: 'Show first field' }).click();
    assert.equal(await first.inputValue(), replacement);
    const configurable = page.getByRole('textbox', {
        name: 'Configurable duration',
        exact: true,
    });
    assert.equal(await configurable.count(), 1);
    await page.getByRole('button', { name: 'Change duration format' }).click();
    assert.equal(await configurable.count(), 0);
    assert.equal(await native(11), 'Retired');
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await configurable.count(), 0);
    assert.equal(await first.isDisabled(), false);
    assert.equal(await writes(), beforeExternal);

    await page.emulateMedia({ forcedColors: 'active' });
    await first.focus();
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.screenshot({
        path: join(output, 'duration-forced-colors.png'),
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
        path: join(output, 'duration-mobile.png'),
        fullPage: false,
    });
    await page.getByRole('button', { name: 'Retire first owner' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Retired');
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await writes(), beforeExternal);
    await noDashboardEvents();
    assert.equal(await page.locator('iframe,video,a').count(), 0);

    const implicitSubmission = [];
    for (const submitButton of [false, true]) {
        const enterPage = await context.newPage();
        enterPage.on('pageerror', (error) => errors.push(error.message));
        try {
            await enterPage.goto(
                `${origin}/enter?submit=${submitButton ? 'button' : 'none'}`
            );
            const input = enterPage.getByRole('textbox', {
                name: 'Enter duration',
                exact: true,
            });
            await input.waitFor();
            const state = async () =>
                JSON.parse(
                    await enterPage.locator('#enter-result').textContent()
                );
            assert.equal(
                await enterPage.locator('#enter-form input').count(),
                1
            );
            assert.equal(
                await enterPage
                    .locator('#enter-form button[type="submit"]')
                    .count(),
                submitButton ? 1 : 0
            );
            const initialInput = await input.inputValue();
            await input.press('Enter');
            const normal = await state();
            assert.equal(normal.submissions.length, 1);
            assert.equal(
                normal.submissions[0].submitter,
                submitButton ? 'Native submit' : null
            );
            assert.deepEqual(normal.keys.at(-1), {
                isTrusted: true,
                isComposing: false,
                defaultPrevented: false,
            });
            assert.equal(normal.parentKeyDowns, 0);

            // Dispatching composition events does not engage the OS/browser IME.
            // An untrusted isComposing key has no native submit default action;
            // it records cancellation behavior, not real IME submission safety.
            await input.dispatchEvent('compositionstart', { data: '' });
            const syntheticKey = await input.evaluate((node) => {
                const event = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    isComposing: true,
                    bubbles: true,
                    cancelable: true,
                });
                node.dispatchEvent(event);
                return {
                    isTrusted: event.isTrusted,
                    isComposing: event.isComposing,
                    defaultPrevented: event.defaultPrevented,
                };
            });
            assert.deepEqual(syntheticKey, {
                isTrusted: false,
                isComposing: true,
                defaultPrevented: false,
            });
            const afterSynthetic = await state();
            assert.equal(afterSynthetic.submissions.length, 1);
            await input.press('Enter');
            const duringSyntheticComposition = await state();
            assert.equal(duringSyntheticComposition.submissions.length, 2);
            assert.deepEqual(duringSyntheticComposition.keys.at(-1), {
                isTrusted: true,
                isComposing: false,
                defaultPrevented: false,
            });
            await input.dispatchEvent('compositionend', { data: '' });
            const final = await state();
            assert.equal(final.parentKeyDowns, 0);
            assert.equal(final.writes, 0);
            assert.equal(final.native, 61.23456);
            assert.equal(await input.inputValue(), initialInput);
            implicitSubmission.push({
                form: submitButton
                    ? 'one input with submit button'
                    : 'one input without submit button',
                normalEnter: {
                    submissions: normal.submissions.length,
                    key: normal.keys.at(-1),
                },
                simulatedComposition: {
                    syntheticKey,
                    syntheticKeySubmissions:
                        afterSynthetic.submissions.length -
                        normal.submissions.length,
                    trustedEnterSubmissions:
                        duringSyntheticComposition.submissions.length -
                        afterSynthetic.submissions.length,
                    trustedKey: duringSyntheticComposition.keys.at(-1),
                    provesNativeImeBehavior: false,
                },
                parentKeyDowns: final.parentKeyDowns,
                nativeDraftWrites: final.writes,
            });
        } finally {
            await enterPage.close();
        }
    }
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
                implicitSubmission,
                checks: [
                    'all five canonical duration formats',
                    'native precision survives focus, blur and remount without writes',
                    'native keyboard typing and caret',
                    'raw accepted input survives focused remount and formats on blur without writes',
                    'partial and invalid input retains accepted native seconds through blur and remount',
                    'invalid grammar and numeric overflow refused',
                    'h:mm bare input uses minutes; seconds formats use seconds',
                    'two-component clocks use the configured units',
                    'negative clocks and component overflow preserve model semantics',
                    'zero distinct from null; clear retains focus without submission',
                    'binding component shares input/focus model and custom clear label',
                    'explicit external replacement resets input without a write',
                    'readonly slot formats native seconds without an editing model',
                    'permission and pending guards',
                    'format replacement retires accepted owner',
                    'hidden and retired hosts omit controls and private readouts',
                    'password masking',
                    'validation association and unique IDs',
                    'hidden title accessible name',
                    'visible keyboard focus',
                    'no Portal row activation in the dashboard; its multiple-input form without a submit button did not submit',
                    'native Enter submits a single-input form with or without a submit button despite stopped key bubbling',
                    'simulated composition records uncancelled keys; it does not prove native IME behavior',
                    'forced colors',
                    'mobile overflow',
                ],
                screenshots: [
                    'duration-idle.png',
                    'duration-invalid-focus.png',
                    'duration-forced-colors.png',
                    'duration-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`Duration browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
