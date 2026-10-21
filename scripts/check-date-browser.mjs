// Local synthetic UI proof; no backend, credentials, fixture mutation or Save.
// Run after build: node scripts/check-date-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/date-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-date/main.ts'],
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
        response.end(readFileSync('examples/react-date/index.html'));
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
        executablePath: process.env.SDK_DATE_CHROMIUM ?? '/usr/bin/chromium',
        headless: true,
        args: ['--disable-gpu'],
    });
    const context = await browser.newContext({
        viewport: { width: 1180, height: 940 },
        reducedMotion: 'reduce',
        // A calendar date must survive a zone with a skipped civil day.
        timezoneId: 'Pacific/Apia',
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
        .getByRole('heading', { name: 'A day, exactly as entered.' })
        .waitFor();
    const first = page.getByRole('textbox', {
        name: 'Target date',
        exact: true,
    });
    const binding = page.getByRole('textbox', {
        name: 'Binding date',
        exact: true,
    });
    const writes = async () =>
        Number(await page.locator('#writes').textContent());
    const native = async (index = 0) =>
        page.locator(`#native-${index}`).textContent();
    // This gallery has multiple text inputs and no submit button. Its lack of
    // implicit submission is not a guarantee for other enclosing form layouts.
    const noGalleryEvents = async () => {
        assert.equal(await page.locator('#rows').textContent(), '0');
        assert.equal(await page.locator('#submits').textContent(), '0');
    };
    assert.equal(await writes(), 0);
    assert.equal(
        await page
            .getByRole('form', { name: 'Date gallery' })
            .locator('input')
            .count(),
        7
    );
    assert.equal(await first.inputValue(), '2026-10-14');
    assert.equal(await native(), '"2026-10-14"');
    assert.equal(await first.getAttribute('type'), 'text');
    assert.equal(await first.getAttribute('placeholder'), 'YYYY-MM-DD');
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
        (await page.locator('body').innerText()).includes('2025-06-17'),
        false
    );
    for (const name of ['Archive date', 'Release date']) {
        assert.equal(
            await page.getByRole('textbox', { name, exact: true }).isDisabled(),
            true
        );
    }
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Compact date', exact: true })
            .getAttribute('aria-label'),
        'Compact date'
    );
    const invalid = page.getByRole('textbox', {
        name: 'Review date',
        exact: true,
    });
    assert.equal(await invalid.getAttribute('aria-invalid'), 'true');
    assert.equal(
        await invalid.evaluate(
            (node) =>
                document.getElementById(node.getAttribute('aria-describedby'))
                    .textContent
        ),
        'Choose a review date.'
    );
    assert.equal(await page.locator('.binding-date').count(), 1);
    await page.screenshot({
        path: join(output, 'date-idle.png'),
        fullPage: true,
    });

    // Native keyboard editing must keep both the caret and unfinished text.
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    // Arrow navigation works consistently on macOS and Linux text controls.
    for (let i = 0; i < 10; i++) await first.press('ArrowRight');
    await first.press('ArrowLeft');
    await page.keyboard.type('X');
    assert.equal(await first.inputValue(), '2026-10-1X4');
    assert.equal(await first.evaluate((node) => node.selectionStart), 10);
    assert.equal(await native(), '"2026-10-14"');
    assert.equal(await writes(), 0);
    await first.press('Backspace');
    assert.equal(await first.inputValue(), '2026-10-14');
    assert.equal(await first.evaluate((node) => node.selectionStart), 9);
    await first.fill('2024-');
    assert.equal(await first.inputValue(), '2024-');
    assert.equal(await first.getAttribute('aria-invalid'), 'true');
    assert.equal(await native(), '"2026-10-14"');
    const beforeRemount = await writes();
    await first.press('Enter');
    await noGalleryEvents();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.inputValue(), '2024-');
    assert.equal(await native(), '"2026-10-14"');
    assert.equal(await writes(), beforeRemount);
    await first.fill('2024-02-29');
    assert.equal(await native(), '"2024-02-29"');
    assert.equal(await first.getAttribute('aria-invalid'), 'false');
    const afterLeapDay = await writes();
    await first.fill('2023-02-29');
    assert.equal(await first.inputValue(), '2023-02-29');
    assert.equal(await first.getAttribute('aria-invalid'), 'true');
    assert.equal(await native(), '"2024-02-29"');
    assert.equal(await writes(), afterLeapDay);
    await first.focus();
    await page.screenshot({
        path: join(output, 'date-invalid-focus.png'),
        fullPage: true,
    });
    await page
        .getByRole('button', { name: 'Clear Target date', exact: true })
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
            .getByRole('button', { name: 'Clear Target date', exact: true })
            .isDisabled(),
        true
    );
    await noGalleryEvents();

    // The binding API uses the same owner-held partial/valid/clear semantics.
    await binding.fill('2028-02-');
    assert.equal(await binding.inputValue(), '2028-02-');
    assert.equal(await native(6), '"2024-02-29"');
    const beforeBindingRemount = await writes();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await binding.inputValue(), '2028-02-');
    assert.equal(await writes(), beforeBindingRemount);
    await binding.fill('2028-02-29');
    assert.equal(await native(6), '"2028-02-29"');
    await binding.press('Enter');
    await page
        .getByRole('button', { name: 'Clear binding date', exact: true })
        .click();
    assert.equal(await native(6), 'null');
    assert.equal(
        await binding.evaluate((node) => node === document.activeElement),
        true
    );
    await noGalleryEvents();

    await first.fill('2030-');
    const beforeExternal = await writes();
    await page.getByRole('button', { name: 'Update first draft' }).click();
    assert.equal(await first.inputValue(), '2011-12-30');
    assert.equal(await native(), '"2011-12-30"');
    assert.equal(await writes(), beforeExternal);
    await page.getByRole('button', { name: 'Lock first field' }).click();
    assert.equal(await first.isDisabled(), true);
    assert.equal(await first.inputValue(), '2011-12-30');
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.isDisabled(), true);
    assert.equal(await writes(), beforeExternal);
    await page.getByRole('button', { name: 'Allow editing' }).click();
    assert.equal(await first.isDisabled(), false);
    await page.getByRole('button', { name: 'Hide first field' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Hidden');
    assert.equal(
        (await page.locator('body').innerText()).includes('2011-12-30'),
        false
    );
    await page.getByRole('button', { name: 'Show first field' }).click();
    assert.equal(await first.inputValue(), '2011-12-30');
    assert.equal(await writes(), beforeExternal);

    // Native submission is owned by the enclosing form. Test both layouts
    // explicitly; stopping propagation alone does not cancel the default action.
    const nativeEnterHosts = [];
    for (const host of [
        {
            id: 'single',
            form: 'Single-input form',
            input: 'Single-input date',
            submitButton: false,
        },
        {
            id: 'button',
            form: 'Form with a submit button',
            input: 'Submit-button date',
            submitButton: true,
        },
    ]) {
        const form = page.getByRole('form', { name: host.form, exact: true });
        const input = form.getByRole('textbox', {
            name: host.input,
            exact: true,
        });
        assert.equal(await form.locator('input').count(), 1);
        assert.equal(await input.getAttribute('type'), 'text');
        assert.equal(await input.isEnabled(), true);
        assert.equal(
            await form.locator('button[type="submit"]').count(),
            host.submitButton ? 1 : 0
        );
        // Keep event references so defaultPrevented is read after propagation,
        // including the synthetic host's submit handler, has finished.
        await input.evaluate((node) => {
            node.dateEnterEvents = [];
            node.addEventListener(
                'keydown',
                (event) => {
                    if (event.key === 'Enter') node.dateEnterEvents.push(event);
                },
                true
            );
        });
        await form.evaluate((node) => {
            node.dateSubmitEvents = [];
            node.addEventListener(
                'submit',
                (event) => node.dateSubmitEvents.push(event),
                true
            );
        });
        const count = async (suffix) =>
            Number(
                await page.locator(`#enter-${host.id}-${suffix}`).textContent()
            );
        const beforeWrites = await writes();
        const phases = {};
        const observe = async (name, action) => {
            const beforeSubmits = await count('submits');
            const beforeClicks = await count('clicks');
            await action();
            phases[name] = {
                submissions: (await count('submits')) - beforeSubmits,
                submitButtonActivations: (await count('clicks')) - beforeClicks,
                enter: await input.evaluate((node) => {
                    const event = node.dateEnterEvents.at(-1);
                    return {
                        isTrusted: event.isTrusted,
                        isComposing: event.isComposing,
                        defaultPrevented: event.defaultPrevented,
                    };
                }),
            };
            assert.equal(await count('keys'), 0);
            assert.equal(await input.inputValue(), '2024-02-29');
            assert.equal(await native(`enter-${host.id}`), '"2024-02-29"');
            assert.equal(await writes(), beforeWrites);
            assert.equal(page.url(), origin + '/');
        };
        await observe('nativeEnter', () => input.press('Enter'));
        await observe('untrustedComposingKey', async () => {
            await input.dispatchEvent('compositionstart', { data: '' });
            for (const type of ['keydown', 'keyup']) {
                await input.dispatchEvent(type, {
                    key: 'Enter',
                    code: 'Enter',
                    isComposing: true,
                    bubbles: true,
                    cancelable: true,
                });
            }
            await input.dispatchEvent('compositionend', { data: '' });
        });
        // A synthetic composition lifecycle does not turn native keyboard input
        // into an OS IME session. Record isComposing instead of assuming it.
        await observe('nativeEnterDuringSimulatedLifecycle', async () => {
            await input.dispatchEvent('compositionstart', { data: '' });
            await input.press('Enter');
            await input.dispatchEvent('compositionend', { data: '' });
        });
        const receipt = {
            host: host.form,
            inputCount: 1,
            submitButton: host.submitButton,
            phases,
            submissions: await form.evaluate((node) =>
                node.dateSubmitEvents.map((event) => ({
                    isTrusted: event.isTrusted,
                    defaultPrevented: event.defaultPrevented,
                    submitter: event.submitter?.textContent ?? null,
                }))
            ),
            bubbledKeydowns: await count('keys'),
            draftWrites: (await writes()) - beforeWrites,
        };
        console.log(`Native Enter observation: ${JSON.stringify(receipt)}`);
        const nativeResult = {
            submissions: 1,
            submitButtonActivations: host.submitButton ? 1 : 0,
            enter: {
                isTrusted: true,
                isComposing: false,
                defaultPrevented: false,
            },
        };
        assert.deepEqual(phases.nativeEnter, nativeResult);
        assert.deepEqual(
            phases.nativeEnterDuringSimulatedLifecycle,
            nativeResult
        );
        assert.deepEqual(phases.untrustedComposingKey, {
            submissions: 0,
            submitButtonActivations: 0,
            enter: {
                isTrusted: false,
                isComposing: true,
                defaultPrevented: false,
            },
        });
        assert.deepEqual(
            receipt.submissions,
            Array.from({ length: 2 }, () => ({
                isTrusted: true,
                defaultPrevented: true,
                submitter: host.submitButton ? 'Count native submission' : null,
            }))
        );
        nativeEnterHosts.push(receipt);
    }
    await page.getByRole('region', { name: 'Native Enter hosts' }).screenshot({
        path: join(output, 'date-native-enter-hosts.png'),
    });

    await page.emulateMedia({ forcedColors: 'active' });
    await first.focus();
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.screenshot({
        path: join(output, 'date-forced-colors.png'),
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
        path: join(output, 'date-mobile.png'),
        fullPage: false,
    });
    await page.getByRole('button', { name: 'Retire first owner' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Retired');
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await writes(), beforeExternal);
    await noGalleryEvents();
    assert.equal(await page.locator('iframe,video,a').count(), 0);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(
            {
                browser: browser.version(),
                transport: 'synthetic local drafts only',
                timezone: 'Pacific/Apia',
                writes: await writes(),
                externalRequests: 0,
                nativeEnterHosts,
                compositionScope:
                    'Synthetic composition events only; no OS IME certification. Untrusted key events do not exercise native submission.',
                checks: [
                    'native keyboard typing and caret',
                    'partial input retains the accepted native draft',
                    'valid leap date accepted; invalid calendar date retained without native write',
                    'clear writes null and retains focus without submission',
                    'StrictMode/remount preserves owner input and native state',
                    'binding component uses the same owner semantics and custom clear label',
                    'external replacement resets partial input',
                    'calendar-only value preserved in Pacific/Apia',
                    'read-only and pending controls',
                    'permission changes',
                    'hidden and retired hosts omit controls and private readouts',
                    'masked date does not appear in plain text',
                    'validation association and unique IDs',
                    'hidden title accessible name',
                    'visible keyboard focus',
                    'no Portal row activation; no submission in the multi-input gallery without a submit button',
                    'native Enter submits both single-input and submit-button hosts without draft writes; host prevents navigation',
                    'simulated composition stays distinct from native IME; renderer isolation does not cancel native Enter',
                    'forced colors',
                    'mobile overflow',
                ],
                screenshots: [
                    'date-idle.png',
                    'date-invalid-focus.png',
                    'date-native-enter-hosts.png',
                    'date-forced-colors.png',
                    'date-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`Date browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
