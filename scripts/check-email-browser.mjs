// Local synthetic UI proof; no backend, fixture mutation, credentials or deployment.
// Run after build: node scripts/check-email-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/email-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-email/main.ts'],
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
        response.end(readFileSync('examples/react-email/index.html'));
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
        executablePath: process.env.SDK_EMAIL_CHROMIUM ?? '/usr/bin/chromium',
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
        .getByRole('heading', { name: 'Your text, kept exactly.' })
        .waitFor();
    const first = page.getByRole('textbox', {
        name: 'Form email',
        exact: true,
    });
    const grid = page.getByRole('textbox', { name: 'Grid email', exact: true });
    const capped = page.getByRole('textbox', {
        name: 'Composed email',
        exact: true,
    });
    const ownerReceipt = async () =>
        JSON.parse(await page.locator('#owner-receipt').textContent());
    const writes = async () => {
        const receipt = await ownerReceipt();
        return (
            receipt.formWrites +
            receipt.gridWrites +
            Number(await page.locator('#fixture-writes').textContent())
        );
    };
    const native = async (index = 0) =>
        page.locator(`#native-${index}`).textContent();
    const noGalleryEvents = async () => {
        assert.equal(await page.locator('#rows').textContent(), '0');
        assert.equal(await page.locator('#submits').textContent(), '0');
    };
    const noSaves = async () => {
        const receipt = await ownerReceipt();
        assert.equal(receipt.formSaves, 0);
        assert.equal(receipt.gridSaves, 0);
        assert.equal(receipt.fetchAttempts, 0);
    };
    assert.equal(await writes(), 0);
    assert.equal(
        await page
            .getByRole('form', { name: 'Email gallery' })
            .locator('input')
            .count(),
        9
    );
    assert.equal(await first.inputValue(), '');
    assert.equal(await native(), 'null');
    assert.equal(await first.getAttribute('type'), 'text');
    assert.equal(await first.getAttribute('autocomplete'), 'off');
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(
        await page
            .getByLabel('Private email', { exact: true })
            .getAttribute('type'),
        'password'
    );
    assert.equal(await native(4), 'Masked');
    assert.equal(
        (await page.locator('body').innerText()).includes(
            'private@example.test'
        ),
        false
    );
    for (const name of ['List email', 'Pending email', 'Computed email']) {
        assert.equal(
            await page.getByRole('textbox', { name, exact: true }).isDisabled(),
            true
        );
    }
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Compact email', exact: true })
            .getAttribute('aria-label'),
        'Compact email'
    );
    const feedback = page.getByRole('textbox', {
        name: 'Reviewed email',
        exact: true,
    });
    assert.equal(await feedback.getAttribute('aria-invalid'), 'true');
    assert.equal(
        await feedback.evaluate(
            (node) =>
                document.getElementById(node.getAttribute('aria-describedby'))
                    .textContent
        ),
        'Synthetic owner feedback: review this value.'
    );
    assert.equal(await page.locator('.binding-email').count(), 1);
    await page.screenshot({
        path: join(output, 'email-idle.png'),
        fullPage: true,
    });

    await page.getByRole('button', { name: 'Save Grid draft locally' }).focus();
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
    const exactEmail = '  Mixed.Case+タグ@Example.TEST  ';
    await first.fill(exactEmail);
    assert.equal(await first.inputValue(), exactEmail);
    assert.equal(await native(), JSON.stringify(exactEmail));
    const beforeRemount = await writes();
    await first.press('Enter');
    await noGalleryEvents();
    await noSaves();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.inputValue(), exactEmail);
    assert.equal(await writes(), beforeRemount);
    await first.fill('<b>not an email</b>');
    assert.equal(await native(), '"<b>not an email</b>"');
    assert.equal(await first.getAttribute('aria-invalid'), 'false');
    assert.equal(
        await first.evaluate((node) => node.validity.typeMismatch),
        false
    );
    assert.equal(await first.evaluate((node) => node.checkValidity()), true);
    assert.equal(await page.locator('b').count(), 0);
    await first.focus();
    await page.screenshot({
        path: join(output, 'email-focus.png'),
        fullPage: true,
    });
    const beforeClear = await writes();
    await page
        .getByRole('button', { name: 'Clear Form draft', exact: true })
        .click();
    assert.equal(await first.inputValue(), '');
    assert.equal(await native(), 'null');
    assert.equal(await writes(), beforeClear + 1);
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await page
            .getByRole('button', { name: 'Clear Form draft', exact: true })
            .isDisabled(),
        true
    );
    await noGalleryEvents();
    await noSaves();

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
    await capped.focus();
    const beforeComposition = await writes();
    await compose(capped, 'compositionstart');
    const composed = '日本語の長い名前を入力する';
    await compositionInput(capped, composed);
    assert.equal(await capped.inputValue(), composed);
    assert.equal(await native(3), '"Studio"');
    assert.equal(await writes(), beforeComposition);
    await compose(capped, 'compositionend');
    assert.equal(await capped.inputValue(), composed);
    assert.equal(await writes(), beforeComposition + 1);
    await compositionInput(capped, composed);
    assert.equal(await capped.inputValue(), composed);
    assert.equal(await writes(), beforeComposition + 1);

    await first.focus();
    await compose(first, 'compositionstart');
    await compositionInput(first, 'unfinished@');
    assert.equal(await native(), 'null');
    await page
        .getByRole('button', { name: 'Update Form draft' })
        .evaluate((node) => node.click());
    assert.equal(await first.inputValue(), ' External@Example.TEST ');
    const afterExternal = await writes();
    await compositionInput(first, 'late-composition@');
    await compose(first, 'compositionend');
    assert.equal(await first.inputValue(), ' External@Example.TEST ');
    assert.equal(await writes(), afterExternal);
    await page.getByRole('button', { name: 'Lock Form field' }).click();
    assert.equal(await first.isDisabled(), true);
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.isDisabled(), true);
    assert.equal(await first.inputValue(), ' External@Example.TEST ');
    await page.getByRole('button', { name: 'Allow editing' }).click();
    assert.equal(await first.isDisabled(), false);
    assert.equal(await writes(), afterExternal);
    await noSaves();
    // Native submission is owned by the enclosing form. Test both layouts
    // explicitly; stopping propagation alone does not cancel the default action.
    const nativeEnterHosts = [];
    for (const host of [
        {
            id: 'single',
            form: 'Single-input form',
            input: 'Single-input email',
            submitButton: false,
        },
        {
            id: 'button',
            form: 'Form with a submit button',
            input: 'Submit-button email',
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
            node.emailEnterEvents = [];
            node.addEventListener(
                'keydown',
                (event) => {
                    if (event.key === 'Enter')
                        node.emailEnterEvents.push(event);
                },
                true
            );
        });
        await form.evaluate((node) => {
            node.emailSubmitEvents = [];
            node.addEventListener(
                'submit',
                (event) => node.emailSubmitEvents.push(event),
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
                    const event = node.emailEnterEvents.at(-1);
                    return {
                        isTrusted: event.isTrusted,
                        isComposing: event.isComposing,
                        defaultPrevented: event.defaultPrevented,
                    };
                }),
            };
            assert.equal(await count('keys'), 0);
            assert.equal(await input.inputValue(), 'not-an-email');
            assert.equal(await native(`enter-${host.id}`), '"not-an-email"');
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
                node.emailSubmitEvents.map((event) => ({
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
        path: join(output, 'email-native-enter-hosts.png'),
    });

    await noSaves();
    await grid.fill(exactEmail);
    assert.equal(await native(1), JSON.stringify(exactEmail));
    await noSaves();
    await page.getByRole('button', { name: 'Save Grid draft locally' }).click();
    await page.waitForFunction(
        () =>
            JSON.parse(document.getElementById('owner-receipt').textContent)
                .gridSaves === 1
    );
    assert.equal((await ownerReceipt()).gridSavedValue, exactEmail);
    assert.equal(
        await page
            .getByRole('button', { name: 'Save Grid draft locally' })
            .isDisabled(),
        true
    );
    // Invalid syntax remains an exact draft. Only this deliberate local owner
    // action invokes its injected Save; page/server validators are not simulated.
    await first.fill('<b>not an email</b>');
    await page.getByRole('button', { name: 'Save Form draft locally' }).click();
    await page.waitForFunction(
        () =>
            JSON.parse(document.getElementById('owner-receipt').textContent)
                .formSaves === 1
    );
    assert.equal((await ownerReceipt()).formSavedValue, '<b>not an email</b>');
    assert.equal(
        await page
            .getByRole('button', { name: 'Save Form draft locally' })
            .isDisabled(),
        true
    );
    assert.equal((await ownerReceipt()).fetchAttempts, 0);
    await noGalleryEvents();
    await page.emulateMedia({ forcedColors: 'active' });
    await capped.focus();
    assert.equal(
        await capped.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.screenshot({
        path: join(output, 'email-forced-colors.png'),
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
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
        path: join(output, 'email-mobile.png'),
        fullPage: false,
    });
    await page.getByRole('button', { name: 'Retire Form owner' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Retired');
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(
        await page.locator('iframe,video,a,input[type="email"]').count(),
        0
    );
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(
            {
                browser: browser.version(),
                transport:
                    'public owners with injected in-memory responses only',
                writes: await writes(),
                ownerReceipt: await ownerReceipt(),
                externalRequests: 0,
                nativeEnterHosts,
                compositionScope:
                    'Synthetic composition events only; no OS IME certification. Untrusted key events do not exercise native submission.',
                checks: [
                    'public Form binding, accepted Grid cell, and read-only List detail',
                    'native keyboard typing and caret',
                    'exact case, whitespace, Unicode, and literal invalid text',
                    'no native email constraint validation, links, or HTML interpretation',
                    'only deliberate Form and Grid owner actions invoke local Save',
                    'explicit Save receipts retain exact raw values',
                    'local Save buttons disable after their one-shot owner completion',
                    'clear writes null and retains focus without Save or gallery submission',
                    'StrictMode/remount preserves accepted owner drafts',
                    'simulated composition buffers then commits once',
                    'external replacement cancels stale composition',
                    'permission changes and disabled remount',
                    'read-only List, pending, and computed controls',
                    'masked value omitted from plain-text draft readout',
                    'returned validation association and unique IDs',
                    'hidden visual title retains accessible name',
                    'binding custom class and Clear label',
                    'owner retirement removes Form control and draft readout',
                    'no row activation or submission in the multiple-input gallery without submit button',
                    'native Enter submits single-input and submit-button hosts without invoking Save',
                    'synthetic composition kept distinct from trusted native Enter and real IME',
                    'visible keyboard focus and forced colors',
                    'narrow viewport without horizontal overflow',
                    'zero external requests and zero live fetch attempts',
                ],
                screenshots: [
                    'email-idle.png',
                    'email-focus.png',
                    'email-native-enter-hosts.png',
                    'email-forced-colors.png',
                    'email-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`Email browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
