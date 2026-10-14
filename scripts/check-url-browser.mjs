// Local synthetic UI proof; no backend, fixture mutation, credentials or deployment.
// Run after build: node scripts/check-url-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/url-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-url/main.ts'],
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
        response.end(readFileSync('examples/react-url/index.html'));
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
        executablePath: process.env.SDK_URL_CHROMIUM ?? '/usr/bin/chromium',
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
        .getByRole('heading', { name: 'Keep the value as entered.' })
        .waitFor();
    const first = page.getByRole('textbox', {
        name: 'Website value',
        exact: true,
    });
    const binding = page.getByRole('textbox', {
        name: 'Binding URL',
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
                    'a,area,iframe,video,img,object,embed,input[type="url"]'
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
            .getByRole('form', { name: 'URL gallery' })
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
    const masked = page.getByLabel('Private URL', { exact: true });
    assert.equal(await masked.getAttribute('type'), 'password');
    assert.equal(await masked.isDisabled(), true);
    assert.equal(await native(2), 'Masked');
    assert.equal(
        (await page.locator('body').innerText()).includes(
            'https://demo:synthetic@example.test/private'
        ),
        false
    );
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Pending URL', exact: true })
            .isDisabled(),
        true
    );
    const display = page.getByRole('textbox', {
        name: 'Inert display value',
        exact: true,
    });
    assert.equal(
        await display.getAttribute('aria-label'),
        'Inert display value'
    );
    assert.equal(await display.inputValue(), '例え.テスト/道?q=One%20Two#片');
    const feedback = page.getByRole('textbox', {
        name: 'Reviewed URL',
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
    assert.equal(await page.locator('.binding-url').count(), 1);
    await inert();
    await page.screenshot({
        path: join(output, 'url-idle.png'),
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
        '  Example.TEST/Case?q=One%20Two#Part  ',
        '例え.テスト/道?タグ=日本語',
        'javascript:void(0)',
        'data:text/html,<h1>inert</h1>',
        'https://demo:synthetic@example.test/path',
        'file:///synthetic/inert',
        'not a url',
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
    assert.equal(await first.inputValue(), 'not a url');
    assert.equal(await writes(), beforeRemount);
    await first.focus();
    await page
        .getByRole('form', { name: 'URL gallery' })
        .locator('.card')
        .first()
        .screenshot({ path: join(output, 'url-focus.png') });
    await page
        .getByRole('button', { name: 'Clear Website value', exact: true })
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
            .getByRole('button', { name: 'Clear Website value', exact: true })
            .isDisabled(),
        true
    );
    await noGalleryEvents();

    await binding.fill('  Binding.Example.TEST/道  ');
    const beforeBindingRemount = await writes();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await binding.inputValue(), '  Binding.Example.TEST/道  ');
    assert.equal(await native(5), '"  Binding.Example.TEST/道  "');
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
    const composed = '例え.テスト/道?未完成';
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
    await compositionInput(first, 'unfinished://');
    await page
        .getByRole('button', { name: 'Update first draft' })
        .evaluate((node) => node.click());
    assert.equal(await first.inputValue(), '  External.Example.TEST/道  ');
    const afterExternal = await writes();
    await compositionInput(first, 'late://composition');
    await compose(first, 'compositionend');
    assert.equal(await first.inputValue(), '  External.Example.TEST/道  ');
    assert.equal(await writes(), afterExternal);
    await page.getByRole('button', { name: 'Lock first field' }).click();
    assert.equal(await first.isDisabled(), true);
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.isDisabled(), true);
    assert.equal(await first.inputValue(), '  External.Example.TEST/道  ');
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
            input: 'Single-input URL',
            submitButton: false,
        },
        {
            id: 'button',
            form: 'Form with a submit button',
            input: 'Submit-button URL',
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
            node.urlEnterEvents = [];
            node.addEventListener(
                'keydown',
                (event) => {
                    if (event.key === 'Enter') node.urlEnterEvents.push(event);
                },
                true
            );
        });
        await form.evaluate((node) => {
            node.urlSubmitEvents = [];
            node.addEventListener(
                'submit',
                (event) => node.urlSubmitEvents.push(event),
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
                    const event = node.urlEnterEvents.at(-1);
                    return {
                        isTrusted: event.isTrusted,
                        isComposing: event.isComposing,
                        defaultPrevented: event.defaultPrevented,
                    };
                }),
            };
            assert.equal(await count('keys'), 0);
            assert.equal(await input.inputValue(), 'not a url');
            assert.equal(await native(`enter-${host.id}`), '"not a url"');
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
                node.urlSubmitEvents.map((event) => ({
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
        path: join(output, 'url-native-enter-hosts.png'),
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
        path: join(output, 'url-forced-colors.png'),
        fullPage: true,
    });
    // A fresh narrow page avoids Chromium raster artifacts after forced-colors
    // switching. Its screenshot intentionally shows the initial fixture state.
    const narrow = await context.newPage();
    narrow.on('pageerror', (error) => errors.push(error.message));
    await narrow.setViewportSize({ width: 390, height: 844 });
    await narrow.goto(origin);
    await narrow
        .getByRole('heading', { name: 'Keep the value as entered.' })
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
            .locator('a,area,iframe,video,img,object,embed,input[type="url"]')
            .count(),
        0
    );
    await narrow.screenshot({
        path: join(output, 'url-mobile.png'),
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
                    'public URL slot and binding use the shared text stylesheet',
                    'native text typing and caret',
                    'exact bare hosts, whitespace, case, Unicode, credentials, invalid strings, and inert schemes',
                    'no native URL constraints, normalization, or HTML interpretation',
                    'displayAsButton/displayAsAttachments remain inert',
                    'no anchors, previews, popups, navigation, fetch, or XHR',
                    'clear writes null and retains focus without submission',
                    'StrictMode/remount preserves synthetic owner drafts',
                    'binding custom class, Clear label, exact strings, and remount',
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
                    'url-idle.png',
                    'url-focus.png',
                    'url-native-enter-hosts.png',
                    'url-forced-colors.png',
                    'url-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`URL browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
