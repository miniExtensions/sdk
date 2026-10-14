// Local synthetic UI proof; no backend, fixture mutation, credentials or deployment.
// Run after build: node scripts/check-phone-number-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/phone-number-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-phone-number/main.ts'],
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
        response.end(readFileSync('examples/react-phone-number/index.html'));
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
            process.env.SDK_PHONE_NUMBER_CHROMIUM ?? '/usr/bin/chromium',
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
    const popups = [],
        navigations = [],
        transports = [];
    page.on('popup', (popup) => popups.push(popup.url()));
    context.on('request', (request) => {
        if (['fetch', 'xhr'].includes(request.resourceType()))
            transports.push(request.url());
    });
    await page.goto(origin);
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    await page
        .getByRole('heading', { name: 'Keep every character.' })
        .waitFor();
    const first = page.getByRole('textbox', {
        name: 'Phone value',
        exact: true,
    });
    const binding = page.getByRole('textbox', {
        name: 'Binding phone',
        exact: true,
    });
    const writes = async () =>
        Number(await page.locator('#writes').textContent());
    const native = async (index = 0) =>
        page.locator(`#native-${index}`).textContent();
    const noGalleryEvents = async () => {
        assert.equal(await page.locator('#rows').textContent(), '0');
        assert.equal(await page.locator('#submits').textContent(), '0');
    };
    const inert = async () => {
        assert.equal(
            await page
                .locator(
                    'a,area,iframe,video,img,object,embed,input[type="tel"],select,[role="combobox"]'
                )
                .count(),
            0
        );
        assert.equal(page.url(), origin + '/');
        assert.equal(context.pages().length, 1);
        assert.deepEqual(popups, []);
        assert.deepEqual(navigations, []);
        assert.deepEqual(transports, []);
    };
    assert.equal(await writes(), 0);
    assert.equal(
        await page
            .getByRole('form', { name: 'phone gallery' })
            .locator('input')
            .count(),
        6
    );
    assert.equal(await first.inputValue(), '');
    assert.equal(await native(), 'null');
    assert.equal(await first.getAttribute('type'), 'text');
    assert.equal(
        await first.getAttribute('placeholder'),
        'Paste or type a value'
    );
    assert.equal(await first.getAttribute('aria-required'), 'true');
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length);
    const masked = page.getByLabel('Private phone', { exact: true });
    assert.equal(await masked.getAttribute('type'), 'password');
    assert.equal(await masked.isDisabled(), true);
    assert.equal(await native(2), 'Masked');
    assert.equal(
        (await page.locator('body').innerText()).includes(
            '+000 555 0100 private'
        ),
        false
    );
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Pending phone', exact: true })
            .isDisabled(),
        true
    );
    const display = page.getByRole('textbox', {
        name: 'Country-configured phone',
        exact: true,
    });
    assert.equal(
        await display.getAttribute('aria-label'),
        'Country-configured phone'
    );
    assert.equal(await display.inputValue(), '001 (020) 555-0100 ext. 09');
    const feedback = page.getByRole('textbox', {
        name: 'Reviewed phone',
        exact: true,
    });
    assert.equal(await feedback.getAttribute('aria-invalid'), 'true');
    assert.equal(
        await feedback.evaluate(
            (node) =>
                document.getElementById(node.getAttribute('aria-describedby'))
                    .textContent
        ),
        'Synthetic feedback: review this value.'
    );
    assert.equal(await page.locator('.binding-phone').count(), 1);
    assert.equal(
        await page.getByLabel('Custom phone readout').textContent(),
        '"  ００１２ ext. 四  "'
    );
    assert.equal(
        await page
            .locator('#custom-phone')
            .getAttribute('data-current-binding'),
        'true'
    );
    assert.equal(
        await page
            .getByRole('form', { name: 'phone gallery' })
            .locator('.card')
            .nth(6)
            .locator('input')
            .count(),
        0
    );

    await inert();
    await page.screenshot({
        path: join(output, 'phone-idle.png'),
        fullPage: true,
    });

    await page.getByRole('button', { name: 'Retire first owner' }).focus();
    await page.keyboard.press('Tab');
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.keyboard.type('Studio');
    for (let i = 0; i < 3; i++) await first.press('ArrowLeft');
    await page.keyboard.type('X');
    assert.equal(await first.inputValue(), 'StuXdio');
    assert.equal(await first.evaluate((node) => node.selectionStart), 4);
    await first.press('Backspace');
    assert.equal(await first.inputValue(), 'Studio');
    assert.equal(await first.evaluate((node) => node.selectionStart), 3);
    const rawValues = [
        '+001 (020) 555-0100 ext. 09',
        '  000123  ',
        '*#06#,;123',
        '+٤٤ ٠٢٠ ７１２３ 内線四',
        'tel:+1-202-555-0100;ext=07',
        'sms:+0005550100',
        'not a phone number',
    ];
    for (const value of rawValues) {
        await first.fill(value);
        assert.equal(await first.inputValue(), value);
        assert.equal(await native(), JSON.stringify(value));
        assert.equal(await first.getAttribute('aria-invalid'), 'false');
        assert.equal(
            await first.evaluate((node) => node.validity.typeMismatch),
            false
        );
        assert.equal(
            await first.evaluate((node) => node.checkValidity()),
            true
        );
        await inert();
    }
    assert.equal(await page.locator('h1').count(), 1);
    const beforeRemount = await writes();
    await first.press('Enter');
    await noGalleryEvents();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.inputValue(), 'not a phone number');
    assert.equal(await writes(), beforeRemount);
    await first.focus();
    await page
        .getByRole('form', { name: 'phone gallery' })
        .locator('.card')
        .first()
        .screenshot({ path: join(output, 'phone-focus.png') });
    await page
        .getByRole('button', { name: 'Clear Phone value', exact: true })
        .click();
    assert.equal(await native(), 'null');
    assert.equal(await first.inputValue(), '');
    assert.equal(await writes(), beforeRemount + 1);
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await page
            .getByRole('button', { name: 'Clear Phone value', exact: true })
            .isDisabled(),
        true
    );
    await noGalleryEvents();

    await binding.fill('  +000 (020) ext. 四  ');
    const beforeBindingRemount = await writes();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await binding.inputValue(), '  +000 (020) ext. 四  ');
    assert.equal(await native(5), '"  +000 (020) ext. 四  "');
    assert.equal(await writes(), beforeBindingRemount);
    await page
        .getByRole('button', { name: 'Clear binding draft', exact: true })
        .click();
    assert.equal(await native(5), 'null');
    assert.equal(
        await binding.evaluate((node) => node === document.activeElement),
        true
    );

    const compose = async (input, type) =>
        input.dispatchEvent(type, { data: '' });
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
    await first.focus();
    const beforeComposition = await writes();
    await compose(first, 'compositionstart');
    const composed = '+００１ 内線四';
    await compositionInput(first, composed);
    assert.equal(await first.inputValue(), composed);
    assert.equal(await native(), 'null');
    assert.equal(await writes(), beforeComposition);
    await compose(first, 'compositionend');
    assert.equal(await first.inputValue(), composed);
    assert.equal(await native(), JSON.stringify(composed));
    assert.equal(await writes(), beforeComposition + 1);
    await compositionInput(first, composed);
    assert.equal(await writes(), beforeComposition + 1);
    await compose(first, 'compositionstart');
    await compositionInput(first, '+');
    await page
        .getByRole('button', { name: 'Update first draft' })
        .evaluate((node) => node.click());
    assert.equal(await first.inputValue(), '  +000 (020) 555-0100 ext. 四  ');
    const afterExternal = await writes();
    await compositionInput(first, 'late extension');
    await compose(first, 'compositionend');
    assert.equal(await first.inputValue(), '  +000 (020) 555-0100 ext. 四  ');
    assert.equal(await writes(), afterExternal);
    await page.getByRole('button', { name: 'Lock first field' }).click();
    assert.equal(await first.isDisabled(), true);
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.isDisabled(), true);
    assert.equal(await first.inputValue(), '  +000 (020) 555-0100 ext. 四  ');
    await page.getByRole('button', { name: 'Allow editing' }).click();
    assert.equal(await first.isDisabled(), false);
    assert.equal(await writes(), afterExternal);
    // Native submission is owned by the enclosing form. Test both layouts
    // explicitly; stopping propagation alone does not cancel the default action.
    const nativeEnterHosts = [];
    for (const host of [
        {
            id: 'single',
            form: 'Single-input form',
            input: 'Single-input phone',
            submitButton: false,
        },
        {
            id: 'button',
            form: 'Form with a submit button',
            input: 'Submit-button phone',
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
            node.phoneEnterEvents = [];
            node.addEventListener(
                'keydown',
                (event) => {
                    if (event.key === 'Enter')
                        node.phoneEnterEvents.push(event);
                },
                true
            );
        });
        await form.evaluate((node) => {
            node.phoneSubmitEvents = [];
            node.addEventListener(
                'submit',
                (event) => node.phoneSubmitEvents.push(event),
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
                    const event = node.phoneEnterEvents.at(-1);
                    return {
                        isTrusted: event.isTrusted,
                        isComposing: event.isComposing,
                        defaultPrevented: event.defaultPrevented,
                    };
                }),
            };
            assert.equal(await count('keys'), 0);
            assert.equal(await input.inputValue(), 'not a phone number');
            assert.equal(
                await native(`enter-${host.id}`),
                '"not a phone number"'
            );
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
                node.phoneSubmitEvents.map((event) => ({
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
        path: join(output, 'phone-native-enter-hosts.png'),
    });

    await inert();
    await noGalleryEvents();
    await page.emulateMedia({ forcedColors: 'active' });
    await first.focus();
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.screenshot({
        path: join(output, 'phone-forced-colors.png'),
        fullPage: true,
    });
    // A fresh narrow page avoids Chromium raster artifacts after forced-colors
    // switching. Its screenshot intentionally shows the initial fixture state.
    const narrow = await context.newPage();
    narrow.on('pageerror', (error) => errors.push(error.message));
    await narrow.setViewportSize({ width: 390, height: 844 });
    await narrow.goto(origin);
    await narrow
        .getByRole('heading', { name: 'Keep every character.' })
        .waitFor();
    await narrow.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done))
        );
    });
    assert.equal(
        await narrow.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
        ),
        false
    );
    assert.equal(
        await narrow
            .locator(
                'a,area,iframe,video,img,object,embed,input[type="tel"],select,[role="combobox"]'
            )
            .count(),
        0
    );
    await narrow.screenshot({
        path: join(output, 'phone-mobile.png'),
        fullPage: false,
    });
    await narrow.close();
    await page.getByRole('button', { name: 'Retire first owner' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Retired');
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await writes(), afterExternal);
    await inert();
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(
            {
                browser: browser.version(),
                transport:
                    'typed synthetic presentation hosts and binding only; no Save or transport connected',
                writes: await writes(),
                saveCalls: 0,
                externalRequests: 0,
                popups: 0,
                navigations: 0,
                fetchOrXhrRequests: 0,
                rawValues,
                nativeEnterHosts,
                compositionScope:
                    'Synthetic composition only; untrusted keys do not exercise native submission or certify OS IMEs.',
                checks: [
                    'public PhoneNumber slot and binding use the shared text stylesheet',
                    'native text typing and caret',
                    'exact plus, leading zeros, extensions, punctuation, star/hash, comma/semicolon, Unicode, whitespace, invalid, and tel-looking strings',
                    'no phone syntax rules, normalization, dialing, or native tel input',
                    'showCountryCodes/defaultCountryCode remain inert without selector or prefix',
                    'no anchors, previews, popups, navigation, fetch, or XHR',
                    'clear writes null and retains focus without submission',
                    'StrictMode/remount preserves synthetic owner drafts',
                    'binding custom class, Clear label, exact strings, and remount',
                    'custom render receives the current binding and exact snapshot value',
                    'simulated composition buffers and commits once',
                    'external replacement cancels stale composition',
                    'permission changes and disabled remount preserve owner authority',
                    'masked read-only and pending controls',
                    'masked value omitted from plain-text readout',
                    'feedback association and unique IDs',
                    'hidden visual title retains accessible name',
                    'retirement removes control and private readout',
                    'multiple-input gallery has zero row activation and no implicit submission',
                    'native Enter submits both enclosing-form layouts without draft writes or Save',
                    'synthetic composing keys are distinct from native keyboard and OS IME behavior',
                    'visible keyboard focus and forced colors',
                    'fresh narrow initial-state layout without horizontal overflow',
                    'zero external requests and no connected Save action',
                ],
                screenshots: [
                    'phone-idle.png',
                    'phone-focus.png',
                    'phone-native-enter-hosts.png',
                    'phone-forced-colors.png',
                    'phone-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`Phone number browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
