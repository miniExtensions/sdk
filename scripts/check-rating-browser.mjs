// Local synthetic UI proof; no backend, fixture mutation, credentials or deployment.
// Run after build: node scripts/check-rating-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/rating-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-rating/main.ts'],
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
        response.end(readFileSync('examples/react-rating/index.html'));
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
        executablePath: process.env.SDK_RATING_CHROMIUM ?? '/usr/bin/chromium',
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
        .getByRole('heading', { name: 'Keep the native rating.' })
        .waitFor();
    const first = page.getByRole('textbox', {
        name: 'Rating value',
        exact: true,
    });
    const binding = page.getByRole('textbox', {
        name: 'Binding rating',
        exact: true,
    });
    const writes = async () =>
        Number(await page.locator('#writes').textContent());
    const native = async (id = 0) =>
        page.locator(`#native-${id}`).textContent();
    const noGalleryEvents = async () => {
        assert.equal(await page.locator('#rows').textContent(), '0');
        assert.equal(await page.locator('#submits').textContent(), '0');
    };
    const inert = async () => {
        assert.equal(
            await page
                .locator(
                    'a,area,iframe,video,img,object,embed,svg,input[type="number"],input[type="range"],progress,meter,[role="progressbar"],[role="slider"],[role="spinbutton"],[role="radiogroup"],[role="radio"]'
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
    const gallery = page.getByRole('form', { name: 'rating gallery' });
    assert.equal(await gallery.locator('input').count(), 7);
    assert.equal(await gallery.locator('button').count(), 0);
    assert.equal(await writes(), 0);
    assert.equal(await first.inputValue(), '3');
    assert.equal(await native(), '3');
    assert.equal(await first.getAttribute('type'), 'text');
    assert.equal(await first.getAttribute('inputmode'), 'decimal');
    assert.equal(await first.getAttribute('placeholder'), null);
    assert.equal(await first.getAttribute('aria-required'), 'true');
    assert.equal(await first.getAttribute('min'), null);
    assert.equal(await first.getAttribute('max'), null);
    assert.equal(await first.getAttribute('step'), null);
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Precise rating', exact: true })
            .inputValue(),
        '0.125'
    );
    const masked = page.getByLabel('Private rating', { exact: true });
    assert.equal(await masked.getAttribute('type'), 'password');
    assert.equal(await masked.isDisabled(), true);
    assert.equal(await native(2), 'Masked');
    assert.equal(
        (await page.locator('body').innerText()).includes('0.87654321'),
        false
    );
    for (const name of ['Pending rating', 'Unavailable rating'])
        assert.equal(
            await page.getByRole('textbox', { name, exact: true }).isDisabled(),
            true
        );
    assert.equal(await binding.inputValue(), '0');
    assert.equal(await binding.getAttribute('aria-label'), 'Binding rating');
    assert.equal(await page.locator('.binding-rating').count(), 1);
    assert.equal(
        await page.getByLabel('Custom rating readout').textContent(),
        '0.125'
    );
    assert.equal(
        await page
            .locator('#custom-rating')
            .getAttribute('data-current-binding'),
        'true'
    );
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length);
    const feedback = page.getByRole('textbox', {
        name: 'Reviewed rating',
        exact: true,
    });
    assert.equal(await feedback.getAttribute('aria-invalid'), 'true');
    assert.equal(
        await feedback.evaluate(
            (node) =>
                document.getElementById(node.getAttribute('aria-describedby'))
                    .textContent
        ),
        'Synthetic feedback: review this rating.'
    );
    await inert();
    await page.screenshot({
        path: join(output, 'rating-idle.png'),
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
    await first.fill('');
    assert.equal(await native(), 'null');
    await page.keyboard.type('3.0000');
    assert.equal(await first.inputValue(), '3.0000');
    assert.equal(await native(), '3');
    await first.press('ArrowLeft');
    await first.press('ArrowLeft');
    await page.keyboard.type('3');
    assert.equal(await first.inputValue(), '3.00300');
    assert.equal(await first.evaluate((node) => node.selectionStart), 5);
    await first.press('Backspace');
    assert.equal(await first.inputValue(), '3.0000');
    assert.equal(await first.evaluate((node) => node.selectionStart), 4);
    const beforeRemount = await writes();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.inputValue(), '3.0000');
    assert.equal(await writes(), beforeRemount);
    await first.press('Enter');
    await noGalleryEvents();
    assert.equal(await writes(), beforeRemount);
    for (const partial of [
        '-',
        '1e',
        '1e400',
        'NaN',
        'Infinity',
        '25%',
        '1,25',
        ' 0.25 ',
    ]) {
        await first.fill(partial);
        assert.equal(await first.inputValue(), partial);
        assert.equal(await native(), '3');
        assert.equal(await first.getAttribute('aria-invalid'), 'true');
        assert.equal(await writes(), beforeRemount);
    }
    await first.fill('1e');
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.inputValue(), '1e');
    assert.equal(await writes(), beforeRemount);
    await first.focus();
    await gallery
        .locator('.card')
        .first()
        .screenshot({ path: join(output, 'rating-partial-focus.png') });
    await page.getByRole('button', { name: 'Lock first field' }).click();
    assert.equal(await first.isDisabled(), true);
    await first.evaluate((node) => {
        Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        ).set.call(node, '99');
        node.dispatchEvent(
            new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: '99',
            })
        );
    });
    // This host removes the editing capability while locked. The readonly slot
    // shows the last native value; the external owner still retains its draft.
    assert.equal(await first.inputValue(), '3');
    assert.equal(await writes(), beforeRemount);
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.isDisabled(), true);
    assert.equal(await first.inputValue(), '3');
    await page.getByRole('button', { name: 'Allow editing' }).click();
    assert.equal(await first.inputValue(), '1e');
    await page.getByRole('button', { name: 'Update first draft' }).click();
    assert.equal(await first.inputValue(), '-0.987654321');
    assert.equal(await native(), '-0.987654321');
    assert.equal(await writes(), beforeRemount);
    const acceptedValues = ['6', '-1.5', '0.125', '1e2', '0'];
    for (const value of acceptedValues) {
        await first.fill(value);
        assert.equal(await first.inputValue(), value);
        assert.equal(await native(), String(Number(value)));
        assert.equal(await first.getAttribute('aria-invalid'), 'false');
    }
    await first.fill('');
    assert.equal(await native(), 'null');
    await first.fill('0');
    assert.equal(await native(), '0');
    await binding.fill('-');
    assert.equal(await binding.inputValue(), '-');
    assert.equal(await native(5), '0');
    const beforeBindingRemount = await writes();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await binding.inputValue(), '-');
    assert.equal(await writes(), beforeBindingRemount);
    await binding.fill('0.3750');
    assert.equal(await native(5), '0.375');
    await binding.fill('');
    assert.equal(await native(5), 'null');
    // One NumberField component keeps its key while separate owners are selected.
    const peer = () => page.locator('#peer-card input');
    assert.equal(await peer().inputValue(), '3');
    await peer().fill('-');
    assert.equal(await native('peer'), '3');
    await page
        .getByRole('button', { name: 'Show Number', exact: true })
        .click();
    assert.equal(await peer().inputValue(), '12.34567');
    await peer().fill('1e');
    assert.equal(await native('peer'), '12.34567');
    await page
        .getByRole('button', { name: 'Show Currency', exact: true })
        .click();
    assert.equal(await peer().inputValue(), '1234.56789');
    assert.equal(
        await page.locator('#peer-card .mx-sdk-currency-symbol').textContent(),
        '$'
    );
    await peer().fill('-');
    assert.equal(await native('peer'), '1234.56789');
    await page
        .getByRole('button', { name: 'Show Duration', exact: true })
        .click();
    assert.equal(await peer().inputValue(), '1:01:01');
    assert.equal(await native('peer'), '3661.234');
    await peer().fill('-');
    assert.equal(await native('peer'), '3661.234');
    const peerWrites = await writes();
    for (const [kind, expected, value] of [
        ['Rating', '-', '3'],
        ['Number', '1e', '12.34567'],
        ['Currency', '-', '1234.56789'],
        ['Duration', '-', '3661.234'],
    ]) {
        await page
            .getByRole('button', { name: `Show ${kind}`, exact: true })
            .click();
        assert.equal(await peer().inputValue(), expected);
        assert.equal(await native('peer'), value);
    }
    assert.equal(await writes(), peerWrites);
    await peer().fill('1:02:03.456');
    assert.equal(await native('peer'), '3723.456');
    await page
        .getByRole('button', { name: 'Show Rating', exact: true })
        .click();
    await page
        .getByRole('button', { name: 'Show Duration', exact: true })
        .click();
    assert.equal(await peer().inputValue(), '1:02:03');
    assert.equal(await native('peer'), '3723.456');
    await page
        .getByRole('button', { name: 'Show Rating', exact: true })
        .click();
    await peer().fill('3');
    // Native submission is owned by the enclosing form. Test both layouts
    // explicitly; stopping propagation alone does not cancel the default action.
    const nativeEnterHosts = [];
    for (const host of [
        {
            id: 'single',
            form: 'Single-input form',
            input: 'Single-input rating',
            submitButton: false,
        },
        {
            id: 'button',
            form: 'Form with a submit button',
            input: 'Submit-button rating',
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
            node.ratingEnterEvents = [];
            node.addEventListener(
                'keydown',
                (event) => {
                    if (event.key === 'Enter')
                        node.ratingEnterEvents.push(event);
                },
                true
            );
        });
        await form.evaluate((node) => {
            node.ratingSubmitEvents = [];
            node.addEventListener(
                'submit',
                (event) => node.ratingSubmitEvents.push(event),
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
                    const event = node.ratingEnterEvents.at(-1);
                    return {
                        isTrusted: event.isTrusted,
                        isComposing: event.isComposing,
                        defaultPrevented: event.defaultPrevented,
                    };
                }),
            };
            assert.equal(await count('keys'), 0);
            assert.equal(await input.inputValue(), '3');
            assert.equal(await native(`enter-${host.id}`), '3');
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
                node.ratingSubmitEvents.map((event) => ({
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
        path: join(output, 'rating-native-enter-hosts.png'),
    });

    await inert();
    await noGalleryEvents();
    await page.getByRole('button', { name: 'Update first draft' }).click();
    const finalWrites = await writes();
    await page.getByRole('button', { name: 'Hide first field' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Hidden');
    assert.equal(
        (await page.locator('body').innerText()).includes('-0.987654321'),
        false
    );
    await page.getByRole('button', { name: 'Show first field' }).click();
    assert.equal(await first.inputValue(), '-0.987654321');
    assert.equal(await writes(), finalWrites);
    await page.emulateMedia({ forcedColors: 'active' });
    await first.focus();
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.screenshot({
        path: join(output, 'rating-forced-colors.png'),
        fullPage: true,
    });
    // Fresh initial-state page avoids the known Chromium post-resize raster strip.
    const narrow = await context.newPage();
    narrow.on('pageerror', (error) => errors.push(error.message));
    await narrow.setViewportSize({ width: 390, height: 844 });
    await narrow.goto(origin);
    await narrow
        .getByRole('heading', { name: 'Keep the native rating.' })
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
    await narrow.screenshot({
        path: join(output, 'rating-mobile.png'),
        fullPage: false,
    });
    await narrow.close();
    const stale = await first.elementHandle();
    await page.getByRole('button', { name: 'Retire first owner' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Retired');
    await stale.evaluate((node) => {
        Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        ).set.call(node, '123');
        node.dispatchEvent(
            new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: '123',
            })
        );
    });
    await stale.dispose();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Retired');
    assert.equal(await writes(), finalWrites);
    await inert();
    await noGalleryEvents();
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(
            {
                browser: browser.version(),
                transport:
                    'typed synthetic hosts and bindings with public scalar models; no Save or transport connected',
                writes: await writes(),
                saveCalls: 0,
                externalRequests: 0,
                popups: 0,
                navigations: 0,
                fetchOrXhrRequests: 0,
                acceptedValues,
                nativeEnterHosts,
                compositionScope:
                    'Numeric control delegates immediately to its existing scalar; only untrusted composing Enter versus trusted native Enter is simulated, not OS IME certification.',
                checks: [
                    'public Rating slot, binding, and shared number.css',
                    'native ratings remain raw numbers without scaling or star widgets',
                    'metadata max 5 does not clamp 6; negative and fractional values remain native',
                    'rating metadata adds no min/max/step constraints or SVG, range, slider, radio, or progress widgets',
                    'native keyboard editing and caret',
                    'raw trailing zeros survive blur and remount without native rounding',
                    'incomplete, nonfinite, suffixed, grouped, and spaced input retains the last native number',
                    'zero and empty/null stay distinct without a Clear button',
                    'binding className and partial draft remount',
                    'custom render receives current binding and exact snapshot',
                    'readonly masked, pending, and absent scalar controls are disabled',
                    'masked native value omitted from text readout',
                    'feedback association, unique IDs, and hidden visual title accessible name',
                    'permission changes reject synthetic disabled input and survive remount',
                    'external replacement resets partial input without native write',
                    'same-mounted NumberField switches Rating/Number/Currency/Duration owners',
                    'each switched owner keeps its partial draft and native units',
                    'Duration blur formats display without changing precise native seconds',
                    'hidden and retired hosts omit controls and readouts',
                    'stale detached input cannot write after retirement',
                    'multiple-input gallery has no row activation or implicit submission',
                    'native Enter submits both single-input host layouts without draft writes or Save',
                    'untrusted composing keys are distinct from trusted keyboard defaults',
                    'visible keyboard focus and forced colors',
                    'fresh narrow initial-state layout has no horizontal overflow',
                    'zero external requests, popup, navigation, fetch, XHR, and Save',
                ],
                screenshots: [
                    'rating-idle.png',
                    'rating-partial-focus.png',
                    'rating-native-enter-hosts.png',
                    'rating-forced-colors.png',
                    'rating-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`Rating browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
