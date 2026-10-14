// Local synthetic UI proof; no backend, fixture mutation, credentials or deployment.
// Run after build: node scripts/check-multiline-text-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/multiline-text-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-multiline-text/main.ts'],
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
        response.end(readFileSync('examples/react-multiline-text/index.html'));
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
            process.env.SDK_MULTILINE_TEXT_CHROMIUM ?? '/usr/bin/chromium',
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
    await page.getByRole('heading', { name: 'Keep every line.' }).waitFor();
    const first = page.getByRole('textbox', { name: 'Notes', exact: true });
    const binding = page.getByRole('textbox', {
        name: 'Binding notes',
        exact: true,
    });
    const crlf = page.getByRole('textbox', { name: 'CRLF notes', exact: true });
    const gallery = page.getByRole('form', {
        name: 'Multiline gallery',
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
    const inertSelector =
        'a,area,iframe,video,img,object,embed,input,[contenteditable="true"]';
    const inert = async () => {
        assert.equal(await page.locator(inertSelector).count(), 0);
        assert.equal(page.url(), origin + '/');
        assert.equal(context.pages().length, 1);
        assert.deepEqual(popups, []);
        assert.deepEqual(navigations, []);
        assert.deepEqual(transports, []);
    };
    const sensitiveValues = [
        'ADD_ONLY_PRIVATE_NATIVE',
        'ATTACHMENT_PRIVATE_NATIVE',
        'PASSWORD_PRIVATE_NATIVE',
    ];
    const unsupported = async (surface) => {
        const cards = surface
            .getByRole('form', { name: 'Multiline gallery', exact: true })
            .locator('.card');
        for (const index of [7, 8, 9]) {
            const card = cards.nth(index);
            assert.equal(
                await card.locator('textarea,input,button').count(),
                0
            );
            assert.equal(await card.getByRole('status').count(), 1);
            assert.match(
                await card.getByRole('status').textContent(),
                /require a custom renderer\./
            );
            assert.equal(
                await surface.locator(`#native-${index}`).textContent(),
                'Unavailable'
            );
        }
        const text = await surface.locator('body').innerText();
        for (const value of sensitiveValues)
            assert.equal(text.includes(value), false);
    };
    const crlfNative = 'First\r\n\r\nSecond\r\n';
    const crlfDom = 'First\n\nSecond\n';
    assert.equal(await writes(), 0);
    assert.equal(await gallery.locator('textarea').count(), 6);
    assert.equal(await first.evaluate((node) => node.tagName), 'TEXTAREA');
    assert.equal(await first.getAttribute('rows'), '4');
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).resize),
        'vertical'
    );
    assert.equal(await first.inputValue(), '');
    assert.equal(await native(), 'null');
    assert.equal(await first.getAttribute('aria-required'), 'true');
    assert.equal(await crlf.inputValue(), crlfDom);
    assert.equal(await native(1), JSON.stringify(crlfNative));
    for (const name of ['Read-only notes', 'Pending notes']) {
        assert.equal(
            await page.getByRole('textbox', { name, exact: true }).isDisabled(),
            true
        );
        assert.equal(
            await page
                .getByRole('button', { name: `Clear ${name}`, exact: true })
                .isDisabled(),
            true
        );
    }
    const feedback = page.getByRole('textbox', {
        name: 'Reviewed notes',
        exact: true,
    });
    assert.equal(await feedback.getAttribute('aria-invalid'), 'true');
    assert.equal(
        await feedback.evaluate((node) =>
            node
                .getAttribute('aria-describedby')
                .split(/\s+/)
                .map((id) => document.getElementById(id).textContent)
                .join('\n')
        ),
        'Synthetic feedback: review this note.'
    );
    assert.equal(await page.locator('.binding-multiline').count(), 1);
    assert.equal(await binding.getAttribute('aria-label'), 'Binding notes');
    assert.equal(await binding.inputValue(), 'Binding\ninitial');
    assert.equal(
        await page.getByLabel('Custom multiline readout').textContent(),
        'Custom presentation supplied by the application.'
    );
    assert.equal(
        await page
            .locator('#custom-multiline')
            .getAttribute('data-current-binding'),
        'true'
    );
    assert.equal(await native(6), 'Unavailable');
    assert.equal(
        await gallery.locator('.card').nth(6).locator('textarea,input').count(),
        0
    );
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length);
    await unsupported(page);
    await inert();
    await page.screenshot({
        path: join(output, 'multiline-text-idle.png'),
        fullPage: true,
    });

    // Browsers expose LF in textarea.value; merely viewing or remounting must
    // leave the accepted owner's original CRLF bytes unchanged.
    await crlf.focus();
    await first.focus();
    assert.equal(await native(1), JSON.stringify(crlfNative));
    assert.equal(await writes(), 0);
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await crlf.inputValue(), crlfDom);
    assert.equal(await native(1), JSON.stringify(crlfNative));
    assert.equal(await writes(), 0);
    await crlf.evaluate((node) => {
        node.focus();
        node.setSelectionRange(node.value.length, node.value.length);
    });
    await page.keyboard.type('!');
    assert.equal(await crlf.inputValue(), crlfDom + '!');
    assert.equal(await native(1), JSON.stringify(crlfDom + '!'));
    assert.equal(await writes(), 1);
    const crlfReceipt = {
        acceptedOwner: crlfNative,
        untouchedDOM: crlfDom,
        ownerAfterDeliberateEdit: crlfDom + '!',
    };

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
    await page.keyboard.type('First');
    await first.press('Enter');
    await page.keyboard.type('Second');
    assert.equal(await first.inputValue(), 'First\nSecond');
    for (let i = 0; i < 3; i++) await first.press('ArrowLeft');
    await page.keyboard.type('X');
    assert.equal(await first.inputValue(), 'First\nSecXond');
    assert.equal(await first.evaluate((node) => node.selectionStart), 10);
    await first.press('Backspace');
    assert.equal(await first.inputValue(), 'First\nSecond');
    assert.equal(await first.evaluate((node) => node.selectionStart), 9);
    await noGalleryEvents();
    const rawValues = [
        '  Leading spaces\n\nBlank line above\nTrailing spaces  ',
        '\tTabbed\ttext\n\tSecond line\t',
        '日本語 👩🏽‍💻\nالعربية\n𝄞 e\u0301  ',
        '\n\n  \n',
        '<h1>Literal markup</h1>\n<script>window.multilineInjection = true</script>',
        '  Last line  \n\n',
    ];
    for (const value of rawValues) {
        await first.fill(value);
        assert.equal(await first.inputValue(), value);
        assert.equal(await native(), JSON.stringify(value));
        assert.equal(await first.getAttribute('aria-invalid'), 'false');
        assert.equal(
            await first.evaluate((node) => node.checkValidity()),
            true
        );
        await inert();
    }
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(
        await page.evaluate(() => typeof window.multilineInjection),
        'undefined'
    );
    const beforeRemount = await writes();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.inputValue(), rawValues.at(-1));
    assert.equal(await native(), JSON.stringify(rawValues.at(-1)));
    assert.equal(await writes(), beforeRemount);
    await first.focus();
    await gallery
        .locator('.card')
        .first()
        .screenshot({ path: join(output, 'multiline-text-focus.png') });
    await page
        .getByRole('button', { name: 'Clear Notes', exact: true })
        .click();
    assert.equal(await first.inputValue(), '');
    assert.equal(await native(), 'null');
    assert.equal(await writes(), beforeRemount + 1);
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await page
            .getByRole('button', { name: 'Clear Notes', exact: true })
            .isDisabled(),
        true
    );
    await noGalleryEvents();

    await first.fill('Erase this\nline');
    const beforeEmptyEdit = await writes();
    await first.fill('');
    assert.equal(await native(), 'null');
    assert.equal(await writes(), beforeEmptyEdit + 1);

    const bindingText = '  Binding\n\n\t日本語  \n';
    await binding.fill(bindingText);
    const beforeBindingRemount = await writes();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await binding.inputValue(), bindingText);
    assert.equal(await native(5), JSON.stringify(bindingText));
    assert.equal(await writes(), beforeBindingRemount);
    await page
        .getByRole('button', { name: 'Clear binding draft', exact: true })
        .click();
    assert.equal(await native(5), 'null');
    assert.equal(
        await binding.evaluate((node) => node === document.activeElement),
        true
    );

    const compose = (input, type) => input.dispatchEvent(type, { data: '' });
    const compositionInput = (input, value) =>
        input.evaluate((node, text) => {
            Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
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
    const composed = '日本語\n続き  ';
    await compositionInput(first, composed);
    assert.equal(await first.inputValue(), composed);
    assert.equal(await native(), 'null');
    assert.equal(await writes(), beforeComposition);
    assert.equal(
        await page
            .getByRole('button', { name: 'Clear Notes', exact: true })
            .isDisabled(),
        true
    );
    await compose(first, 'compositionend');
    assert.equal(await native(), JSON.stringify(composed));
    assert.equal(await writes(), beforeComposition + 1);
    await compositionInput(first, composed);
    assert.equal(await writes(), beforeComposition + 1);
    await compose(first, 'compositionstart');
    await compositionInput(first, 'Unfinished\ncomposition');
    await page
        .getByRole('button', { name: 'Update first draft' })
        .evaluate((node) => node.click());
    const replacement = 'Owner\nreplacement  ';
    assert.equal(await first.inputValue(), replacement);
    const afterReplacement = await writes();
    await compositionInput(first, 'Late\ncomposition');
    await compose(first, 'compositionend');
    assert.equal(await first.inputValue(), replacement);
    assert.equal(await native(), JSON.stringify(replacement));
    assert.equal(await writes(), afterReplacement);
    await page.getByRole('button', { name: 'Lock first field' }).click();
    assert.equal(await first.isDisabled(), true);
    await compositionInput(first, 'Disabled\nwrite');
    assert.equal(await native(), JSON.stringify(replacement));
    assert.equal(await writes(), afterReplacement);
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.isDisabled(), true);
    assert.equal(await first.inputValue(), replacement);
    await page.getByRole('button', { name: 'Allow editing' }).click();
    assert.equal(await first.isDisabled(), false);
    assert.equal(await writes(), afterReplacement);

    // One fixed-key binding component changes source identity while its owners
    // remain outside React. DOM click avoids a blur cancelling composition first.
    const switched = () =>
        page.getByRole('textbox', { name: /^(First|Second) switched notes$/ });
    const firstSwitchValue = await switched().inputValue();
    const firstSwitchNative = await native('switch');
    const originalElement = await switched().elementHandle();
    const beforeSwitch = await writes();
    await switched().focus();
    await compose(switched(), 'compositionstart');
    await compositionInput(switched(), 'Uncommitted\nfirst owner');
    assert.equal(await native('switch'), firstSwitchNative);
    await page
        .getByRole('button', { name: 'Show second owner', exact: true })
        .evaluate((node) => node.click());
    assert.equal(
        (await switched().getAttribute('aria-label')) ??
            (await switched().evaluate((node) => node.labels[0]?.textContent)),
        'Second switched notes'
    );
    const secondSwitchValue = await switched().inputValue();
    const secondSwitchNative = await native('switch');
    assert.equal(
        await switched().evaluate(
            (node, original) => node === original,
            originalElement
        ),
        true
    );
    await compositionInput(switched(), 'Stale\nfirst owner event');
    await compose(switched(), 'compositionend');
    assert.equal(await switched().inputValue(), secondSwitchValue);
    assert.equal(await native('switch'), secondSwitchNative);
    assert.equal(await writes(), beforeSwitch);
    await page
        .getByRole('button', { name: 'Show first owner', exact: true })
        .click();
    assert.equal(await switched().inputValue(), firstSwitchValue);
    assert.equal(await native('switch'), firstSwitchNative);
    await switched().fill('First owner\nretained  ');
    await page
        .getByRole('button', { name: 'Show second owner', exact: true })
        .click();
    assert.equal(await switched().inputValue(), secondSwitchValue);
    await switched().fill('Second owner\n\tretained');
    const afterSwitchEdits = await writes();
    await page
        .getByRole('button', { name: 'Show first owner', exact: true })
        .click();
    assert.equal(await switched().inputValue(), 'First owner\nretained  ');
    assert.equal(
        await native('switch'),
        JSON.stringify('First owner\nretained  ')
    );
    await page
        .getByRole('button', { name: 'Show second owner', exact: true })
        .click();
    assert.equal(await switched().inputValue(), 'Second owner\n\tretained');
    assert.equal(
        await native('switch'),
        JSON.stringify('Second owner\n\tretained')
    );
    assert.equal(await writes(), afterSwitchEdits);
    await originalElement.dispose();

    // A textarea's trusted Enter default inserts LF, including inside a form
    // with a submit button. Synthetic keys do not exercise that native default.
    const nativeEnterHosts = [];
    for (const host of [
        {
            id: 'single',
            form: 'Single-textarea form',
            input: 'Single textarea',
            submitButton: false,
        },
        {
            id: 'button',
            form: 'Form with a submit button',
            input: 'Submit-button textarea',
            submitButton: true,
        },
    ]) {
        const form = page.getByRole('form', { name: host.form, exact: true });
        const input = form.getByRole('textbox', {
            name: host.input,
            exact: true,
        });
        assert.equal(await form.locator('textarea').count(), 1);
        assert.equal(await form.locator('input').count(), 0);
        assert.equal(await input.isEnabled(), true);
        assert.equal(
            await form.locator('button[type="submit"]').count(),
            host.submitButton ? 1 : 0
        );
        assert.equal(await input.inputValue(), 'Line one');
        await input.evaluate((node) => {
            node.multilineEnterEvents = [];
            node.addEventListener(
                'keydown',
                (event) => {
                    if (event.key === 'Enter')
                        node.multilineEnterEvents.push(event);
                },
                true
            );
        });
        await form.evaluate((node) => {
            node.multilineSubmitEvents = [];
            node.addEventListener(
                'submit',
                (event) => node.multilineSubmitEvents.push(event),
                true
            );
        });
        const count = async (suffix) =>
            Number(
                await page.locator(`#enter-${host.id}-${suffix}`).textContent()
            );
        const beforeWrites = await writes();
        const phases = {};
        const observe = async (name, action, expectedValue, expectedWrites) => {
            const beforeSubmits = await count('submits');
            const beforeClicks = await count('clicks');
            const beforePhaseWrites = await writes();
            await action();
            phases[name] = {
                submissions: (await count('submits')) - beforeSubmits,
                submitButtonActivations: (await count('clicks')) - beforeClicks,
                draftWrites: (await writes()) - beforePhaseWrites,
                domValue: await input.inputValue(),
                nativeValue: JSON.parse(await native(`enter-${host.id}`)),
                enter: await input.evaluate((node) => {
                    const event = node.multilineEnterEvents.at(-1);
                    return {
                        isTrusted: event.isTrusted,
                        isComposing: event.isComposing,
                        defaultPrevented: event.defaultPrevented,
                    };
                }),
            };
            assert.equal(phases[name].submissions, 0);
            assert.equal(phases[name].submitButtonActivations, 0);
            assert.equal(phases[name].draftWrites, expectedWrites);
            assert.equal(phases[name].domValue, expectedValue);
            assert.equal(phases[name].nativeValue, expectedValue);
            assert.equal(await count('keys'), 0);
            assert.equal(page.url(), origin + '/');
        };
        await input.evaluate((node) => {
            node.focus();
            node.setSelectionRange(node.value.length, node.value.length);
        });
        await observe(
            'nativeEnter',
            () => input.press('Enter'),
            'Line one\n',
            1
        );
        await observe(
            'untrustedComposingKey',
            async () => {
                await compose(input, 'compositionstart');
                for (const type of ['keydown', 'keyup'])
                    await input.dispatchEvent(type, {
                        key: 'Enter',
                        code: 'Enter',
                        isComposing: true,
                        bubbles: true,
                        cancelable: true,
                    });
                await compose(input, 'compositionend');
            },
            'Line one\n',
            0
        );
        // This lifecycle is synthetic: trusted Playwright Enter still reports
        // isComposing=false. It exercises textarea defaults, not a real OS IME.
        await input.evaluate((node) =>
            node.setSelectionRange(node.value.length, node.value.length)
        );
        await observe(
            'nativeEnterDuringSimulatedLifecycle',
            async () => {
                await compose(input, 'compositionstart');
                await input.press('Enter');
                await compose(input, 'compositionend');
            },
            'Line one\n\n',
            1
        );
        const trusted = {
            isTrusted: true,
            isComposing: false,
            defaultPrevented: false,
        };
        assert.deepEqual(phases.nativeEnter.enter, trusted);
        assert.deepEqual(
            phases.nativeEnterDuringSimulatedLifecycle.enter,
            trusted
        );
        assert.deepEqual(phases.untrustedComposingKey.enter, {
            isTrusted: false,
            isComposing: true,
            defaultPrevented: false,
        });
        const receipt = {
            host: host.form,
            textareaCount: 1,
            submitButton: host.submitButton,
            phases,
            submissions: await form.evaluate(
                (node) => node.multilineSubmitEvents.length
            ),
            bubbledKeydowns: await count('keys'),
            draftWrites: (await writes()) - beforeWrites,
        };
        assert.equal(receipt.submissions, 0);
        assert.equal(receipt.draftWrites, 2);
        nativeEnterHosts.push(receipt);
        console.log(`Textarea Enter observation: ${JSON.stringify(receipt)}`);
    }
    await page.getByRole('region', { name: 'Native Enter hosts' }).screenshot({
        path: join(output, 'multiline-text-native-enter-hosts.png'),
    });
    await noGalleryEvents();
    await inert();

    const finalWrites = await writes();
    await page.getByRole('button', { name: 'Hide first field' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Hidden');
    assert.equal(
        (await page.locator('body').innerText()).includes(
            JSON.stringify(replacement)
        ),
        false
    );
    await page.getByRole('button', { name: 'Show first field' }).click();
    assert.equal(await first.inputValue(), replacement);
    assert.equal(await writes(), finalWrites);
    await page.emulateMedia({ forcedColors: 'active' });
    await first.focus();
    assert.equal(
        await first.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.screenshot({
        path: join(output, 'multiline-text-forced-colors.png'),
        fullPage: true,
    });

    // A fresh narrow page shows the initial fixture, independently of the edited
    // desktop captures, and avoids Chromium's post-resize raster artifacts.
    const narrow = await context.newPage();
    narrow.on('pageerror', (error) => errors.push(error.message));
    await narrow.setViewportSize({ width: 390, height: 844 });
    await narrow.goto(origin);
    await narrow.getByRole('heading', { name: 'Keep every line.' }).waitFor();
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
    assert.equal(await narrow.locator(inertSelector).count(), 0);
    assert.equal(await narrow.locator('#writes').textContent(), '0');
    assert.equal(
        await narrow.locator('#native-1').textContent(),
        JSON.stringify(crlfNative)
    );
    await unsupported(narrow);
    await narrow.screenshot({
        path: join(output, 'multiline-text-mobile.png'),
        fullPage: false,
    });
    await narrow.close();
    const detached = await first.elementHandle();
    await page.getByRole('button', { name: 'Retire first owner' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Retired');
    await detached.evaluate((node) => {
        Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value'
        ).set.call(node, 'Stale\nwrite');
        node.dispatchEvent(
            new InputEvent('input', { bubbles: true, inputType: 'insertText' })
        );
    });
    await detached.dispose();
    await page.getByRole('button', { name: 'Remount renderers' }).click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(), 'Retired');
    assert.equal(await writes(), finalWrites);
    await unsupported(page);
    await noGalleryEvents();
    await inert();
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(
            {
                browser: browser.version(),
                transport:
                    'typed synthetic presentation hosts and bindings; no Save or transport connected',
                writes: await writes(),
                saveCalls: 0,
                externalRequests: 0,
                popups: 0,
                navigations: 0,
                fetchOrXhrRequests: 0,
                rawValues,
                crlf: crlfReceipt,
                nativeEnterHosts,
                compositionScope:
                    'Synthetic composition buffering and untrusted composing keys only. Trusted Enter during the synthetic lifecycle is not OS IME certification.',
                checks: [
                    'public MultilineText slot and binding use text.css and a four-row textarea',
                    'vertical resize and keyboard focus remain visible',
                    'exact LF, blank lines, tabs, Unicode, and trailing spaces reach the owner',
                    'literal HTML remains inert text without generated elements or execution',
                    'untouched CRLF owner value survives focus and remount while DOM exposes LF',
                    'only a deliberate edit commits DOM-normalized line endings to the owner',
                    'native Enter and caret editing preserve multiline content',
                    'empty DOM edits and Clear write null; Clear retains focus',
                    'StrictMode/remount preserves owner drafts without writes',
                    'binding className, custom Clear label, and multiline values remain intact',
                    'custom rendering replaces the stock textarea',
                    'simulated composition buffers, disables Clear, and commits once',
                    'external replacement cancels stale composition',
                    'fixed-key binding source switch cancels stale composition without cross-owner writes',
                    'switched owners retain independent multiline drafts',
                    'readonly and pending textareas and their Clear buttons are disabled',
                    'add-only, attachment-display, and password modes expose status without control or sensitive readout',
                    'feedback is associated with a unique control ID',
                    'permission changes prevent edits and survive remount',
                    'native Enter inserts LF in both enclosing-form layouts without submission or Save',
                    'untrusted composing keys are distinct from trusted textarea defaults',
                    'hidden and retired hosts omit controls and readouts',
                    'detached input event after retirement cannot write',
                    'fresh narrow initial-state layout has no horizontal overflow',
                    'zero external requests, popup, navigation, fetch, XHR, and connected Save',
                ],
                screenshots: [
                    'multiline-text-idle.png',
                    'multiline-text-focus.png',
                    'multiline-text-native-enter-hosts.png',
                    'multiline-text-forced-colors.png',
                    'multiline-text-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`Multiline text browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
