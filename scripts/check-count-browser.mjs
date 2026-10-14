// Local synthetic UI proof; no backend, fixture mutation, credentials or deployment.
// Run after build: node scripts/check-count-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/count-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-count/main.ts'],
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
        response.end(readFileSync('examples/react-count/index.html'));
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
        executablePath: process.env.SDK_COUNT_CHROMIUM ?? '/usr/bin/chromium',
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
    const counter = async (id) =>
        Number(await page.locator(`#${id}`).textContent());
    const native = async (id = 0) =>
        page.locator(`#native-${id}`).textContent();
    const inert = async () => {
        assert.equal(
            await page
                .locator(
                    'a,area,iframe,video,img,object,embed,input[type="number"],input[type="range"],progress,meter,[role="slider"],[role="spinbutton"]'
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
    const injectText = async (input, value) =>
        input.evaluate((node, text) => {
            Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value'
            ).set.call(node, text);
            node.dispatchEvent(
                new InputEvent('input', {
                    bubbles: true,
                    inputType: 'insertText',
                    data: text,
                })
            );
            node.dispatchEvent(new Event('change', { bubbles: true }));
        }, value);
    const first = page.getByRole('textbox', {
        name: 'Related count',
        exact: true,
    });
    const neighbor = page.getByRole('textbox', {
        name: 'Editable neighbor',
        exact: true,
    });
    await first.waitFor();
    const noReadonlyActions = async () => {
        assert.equal(await counter('count-writes'), 0);
        assert.equal(await counter('saves'), 0);
        assert.equal(await counter('row-events'), 0);
        assert.equal(await counter('requests'), 0);
        assert.equal(await counter('portal-reads'), 2);
    };
    const expectedValues = [
        { index: 0, label: 'Related count', input: '42', native: 42 },
        { index: 1, label: 'Bound zero', input: '0', native: 0 },
        {
            index: 2,
            label: 'Fractional value',
            input: '-1.125',
            native: -1.125,
        },
        { index: 3, label: 'Exponent value', input: '1e+21', native: 1e21 },
        { index: 4, label: 'Empty value', input: '', native: null },
        { index: 5, label: 'Missing value', input: '', missing: true },
        { index: 8, label: 'Pending value', input: '27', native: 27 },
        { index: 9, label: 'Feedback value', input: '28', native: 28 },
        { index: 10, label: 'Hidden title', input: '314', native: 314 },
        { index: 11, label: 'Fallback count', input: '2718', native: 2718 },
        { index: 15, label: 'Lifecycle value', input: '99', native: 99 },
    ];
    assert.equal(await page.locator('[id^="card-"]').count(), 16);
    assert.equal(await page.locator('[id^="card-"] input').count(), 14);
    assert.equal(await page.locator('[id^="card-"] button').count(), 0);
    assert.equal(await page.locator('#card-0 .custom-count').count(), 1);
    assert.equal(await counter('writes'), 0);
    for (const item of expectedValues) {
        const input = page.getByRole('textbox', {
            name: item.label,
            exact: true,
        });
        assert.equal(await input.inputValue(), item.input);
        assert.equal(await input.isDisabled(), true);
        assert.equal(await input.getAttribute('type'), 'text');
        assert.equal(await input.getAttribute('inputmode'), 'decimal');
        assert.equal(await input.getAttribute('min'), null);
        assert.equal(await input.getAttribute('max'), null);
        assert.equal(await input.getAttribute('step'), null);
        if (!item.missing)
            assert.equal(await native(item.index), JSON.stringify(item.native));
    }
    const originalMissingReadout = await native(5);
    assert.equal(originalMissingReadout, 'Missing');
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Hidden title', exact: true })
            .getAttribute('aria-label'),
        'Hidden title'
    );
    assert.equal(await page.locator('#card-10 label').count(), 0);
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Pending value', exact: true })
            .getAttribute('aria-busy'),
        'true'
    );
    const feedback = page.getByRole('textbox', {
        name: 'Feedback value',
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
        'Synthetic read-only feedback.'
    );
    const masks = [
        { index: 6, label: 'Display mask', value: '987' },
        { index: 7, label: 'Write mask', value: '654' },
    ];
    const assertMasks = async (surface) => {
        for (const mask of masks) {
            const card = surface.locator(`#card-${mask.index}`);
            const input = surface.getByLabel(mask.label, { exact: true });
            assert.equal(await input.getAttribute('type'), 'password');
            assert.equal(await input.isDisabled(), true);
            assert.equal(await input.inputValue(), mask.value);
            assert.equal(
                await surface.locator(`#native-${mask.index}`).textContent(),
                'Masked'
            );
            assert.equal((await card.innerText()).includes(mask.value), false);
        }
    };
    await assertMasks(page);
    assert.equal(await page.locator('#card-13 input').count(), 0);
    assert.equal(
        await page.locator('#card-13').getByRole('status').textContent(),
        'This control supports Count fields.'
    );
    assert.equal(await page.locator('#card-14 input').count(), 0);
    assert.equal(
        (await page.locator('#card-14').innerText()).includes(
            'Application-owned read-only presentation.'
        ),
        true
    );
    assert.equal(await neighbor.isEnabled(), true);
    assert.equal(await neighbor.inputValue(), '7');
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length);
    await noReadonlyActions();
    await inert();
    await page.screenshot({
        path: join(output, 'count-idle.png'),
        fullPage: true,
    });

    // Count metadata availability is independent of the accepted native number.
    for (const [valid, expected] of [
        [false, ''],
        [true, '42'],
        [false, ''],
        [true, '42'],
    ]) {
        await page
            .getByRole('button', { name: 'Toggle Count validity', exact: true })
            .click();
        assert.equal(await first.inputValue(), expected);
        assert.equal(await first.isDisabled(), true);
        assert.equal(await native(0), '42');
        await page
            .getByRole('button', { name: 'Remount controls', exact: true })
            .click();
        assert.equal(await first.inputValue(), expected);
        assert.equal(await native(0), '42');
        await noReadonlyActions();
    }

    // Native focus/pointer attempts cannot turn disabled Count displays into
    // editing controls. Type only after confirming no text input holds focus.
    await page.evaluate(() => document.activeElement?.blur());
    await first.evaluate((node) => node.focus());
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        false
    );
    await first.click({ force: true });
    assert.equal(
        await first.evaluate((node) => node === document.activeElement),
        false
    );
    assert.equal(
        await page.evaluate(() => document.activeElement?.tagName === 'INPUT'),
        false
    );
    await page.keyboard.type('999');
    assert.equal(await first.inputValue(), '42');
    assert.equal(await native(0), '42');
    assert.equal(await neighbor.inputValue(), '7');
    assert.equal(await counter('writes'), 0);
    await noReadonlyActions();

    // Deliberately injected events exercise the presentation handler's disabled
    // branch. They are not ordinary user editing or OS keyboard/IME proof.
    for (const item of expectedValues) {
        const input = page.getByRole('textbox', {
            name: item.label,
            exact: true,
        });
        const before = await native(item.index);
        await injectText(input, '999.125');
        assert.equal(await input.inputValue(), item.input);
        assert.equal(await native(item.index), before);
    }
    for (const mask of masks) {
        await injectText(
            page.getByLabel(mask.label, { exact: true }),
            '999.125'
        );
    }
    await assertMasks(page);
    await noReadonlyActions();
    assert.equal(await counter('writes'), 0);
    await page
        .getByRole('button', { name: 'Remount controls', exact: true })
        .click();
    for (const item of expectedValues) {
        assert.equal(
            await page
                .getByRole('textbox', { name: item.label, exact: true })
                .inputValue(),
            item.input
        );
    }
    assert.equal(await native(5), originalMissingReadout);
    assert.equal(await counter('writes'), 0);
    await noReadonlyActions();

    // The sole editable Number neighbor must remain reachable with the keyboard;
    // disabled Count inputs are skipped in the native tab order.
    await page
        .getByRole('button', { name: 'Retire lifecycle binding', exact: true })
        .focus();
    await page.keyboard.press('Tab');
    assert.equal(
        await neighbor.evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await neighbor.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await neighbor.fill('');
    assert.equal(await native(12), 'null');
    await page.keyboard.type('12.5000');
    assert.equal(await neighbor.inputValue(), '12.5000');
    assert.equal(await native(12), '12.5');
    await neighbor.press('ArrowLeft');
    await neighbor.press('ArrowLeft');
    await page.keyboard.type('3');
    assert.equal(await neighbor.inputValue(), '12.50300');
    assert.equal(await neighbor.evaluate((node) => node.selectionStart), 6);
    await neighbor.press('Backspace');
    assert.equal(await neighbor.inputValue(), '12.5000');
    assert.equal(await neighbor.evaluate((node) => node.selectionStart), 5);
    const neighborWritesBeforePartial = await counter('writes');
    await neighbor.fill('1e');
    assert.equal(await neighbor.inputValue(), '1e');
    assert.equal(await neighbor.getAttribute('aria-invalid'), 'true');
    assert.equal(await native(12), '12.5');
    assert.equal(await counter('writes'), neighborWritesBeforePartial);
    await page
        .getByRole('button', { name: 'Remount controls', exact: true })
        .click();
    assert.equal(await neighbor.inputValue(), '1e');
    assert.equal(await native(12), '12.5');
    assert.equal(await counter('writes'), neighborWritesBeforePartial);
    await neighbor.focus();
    await page
        .locator('#card-12')
        .screenshot({ path: join(output, 'count-neighbor-focus.png') });
    await neighbor.fill('-2.75');
    assert.equal(await native(12), '-2.75');
    await neighbor.fill('0');
    assert.equal(await native(12), '0');
    await neighbor.fill('');
    assert.equal(await native(12), 'null');
    await neighbor.fill('7');
    assert.equal(await native(12), '7');
    const finalNeighborWrites = await counter('writes');
    for (const item of expectedValues) {
        assert.equal(
            await page
                .getByRole('textbox', { name: item.label, exact: true })
                .inputValue(),
            item.input
        );
    }
    await noReadonlyActions();

    await page
        .getByRole('button', { name: 'Replace count value', exact: true })
        .click();
    assert.equal(await first.inputValue(), '101');
    assert.equal(await first.isDisabled(), true);
    assert.equal(await native(0), '101');
    assert.equal(await counter('writes'), finalNeighborWrites);
    await noReadonlyActions();
    await page
        .getByRole('button', { name: 'Remount controls', exact: true })
        .click();
    assert.equal(await first.inputValue(), '101');
    assert.equal(await neighbor.inputValue(), '7');
    assert.equal(await counter('writes'), finalNeighborWrites);
    await page
        .getByRole('button', {
            name: 'Toggle count visibility',
            exact: true,
        })
        .click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(0), 'Hidden');
    assert.equal(
        (await page.locator('#card-0').innerText()).includes('101'),
        false
    );
    await page
        .getByRole('button', {
            name: 'Toggle count visibility',
            exact: true,
        })
        .click();
    assert.equal(await first.inputValue(), '101');
    assert.equal(await first.isDisabled(), true);
    assert.equal(await counter('writes'), finalNeighborWrites);
    await noReadonlyActions();
    await assertMasks(page);
    await inert();

    await page.emulateMedia({ forcedColors: 'active' });
    await neighbor.focus();
    assert.equal(
        await neighbor.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.screenshot({
        path: join(output, 'count-forced-colors.png'),
        fullPage: true,
    });
    // Fresh initial-state page avoids Chromium raster artifacts after mode or
    // viewport changes; it intentionally differs from the edited desktop page.
    const narrow = await context.newPage();
    narrow.on('pageerror', (error) => errors.push(error.message));
    await narrow.setViewportSize({ width: 390, height: 844 });
    await narrow.goto(origin);
    await narrow
        .getByRole('textbox', { name: 'Related count', exact: true })
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
    assert.equal(await narrow.locator('#count-writes').textContent(), '0');
    assert.equal(await narrow.locator('#writes').textContent(), '0');
    assert.equal(await narrow.locator('#saves').textContent(), '0');
    assert.equal(
        await narrow
            .getByRole('textbox', { name: 'Related count', exact: true })
            .inputValue(),
        '42'
    );
    await assertMasks(narrow);
    await narrow.screenshot({
        path: join(output, 'count-mobile.png'),
        fullPage: false,
    });
    await narrow.close();

    const lifecycle = page.getByRole('textbox', {
        name: 'Lifecycle value',
        exact: true,
    });
    const detached = await lifecycle.elementHandle();
    await page
        .getByRole('button', { name: 'Retire lifecycle binding', exact: true })
        .click();
    assert.equal(await lifecycle.count(), 0);
    assert.equal(await native(15), 'Retired');
    await detached.evaluate((node) => {
        Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        ).set.call(node, '999');
        node.dispatchEvent(
            new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: '999',
            })
        );
    });
    await detached.dispose();
    await page
        .getByRole('button', { name: 'Remount controls', exact: true })
        .click();
    assert.equal(await lifecycle.count(), 0);
    assert.equal(await native(15), 'Retired');
    assert.equal(await first.inputValue(), '101');
    assert.equal(await first.isDisabled(), true);
    assert.equal(await neighbor.inputValue(), '7');
    assert.equal(await counter('writes'), finalNeighborWrites);
    await noReadonlyActions();
    await assertMasks(page);
    await inert();
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(
            {
                browser: browser.version(),
                transport:
                    'real Form owner and accepted Portal grid/list detail owners over local synthetic data; presentation edge fixtures and editable Number neighbor; no network or Save connected',
                countSetterCalls: await counter('count-writes'),
                syntheticPortalReads: await counter('portal-reads'),
                runtimeFetchCalls: await counter('requests'),
                neighborWrites: await counter('writes'),
                saveCalls: await counter('saves'),
                rowEvents: await counter('row-events'),
                externalRequests: 0,
                popups: 0,
                navigations: 0,
                fetchOrXhrRequests: 0,
                readonlyValues: expectedValues,
                checks: [
                    'public Count slot and binding use readonly disabled NumberControl and number.css',
                    'real Form owner exposes readonly computed Count with no scalar',
                    'real Portal grid/list owners provide accepted readonly detail projections, without computed cell bindings',
                    'false Count metadata hides native 42, true metadata restores it, without writes across remount',
                    'zero, negative fractions, and exponent values display their raw String form',
                    'null and missing values remain blank without deriving a count',
                    'Count controls expose no Clear, calculation, range, or editing action',
                    'native focus, pointer, and keyboard attempts do not edit disabled Count values',
                    'injected input/change events restore owner display without calling Count setters',
                    'read-only values and missing state survive remount without writes',
                    'pending state, returned feedback, unique IDs, hidden title, and fallback title remain accessible',
                    'display-side and write-side masks hide plain-text readouts',
                    'wrong physical binding produces status without an input',
                    'custom rendering takes precedence over wrong-kind stock rendering',
                    'native tab order skips disabled Count displays and reaches the editable neighbor',
                    'Number neighbor typing, caret, partial model retention, and zero/null remain functional',
                    'neighbor edits do not change any Count value or call its setter',
                    'external replacement updates readonly display without rendering-generated writes',
                    'hidden and retired owners omit controls and private readouts',
                    'detached-input probe left the Count setter count unchanged',
                    'visible neighbor focus and forced colors',
                    'fresh narrow initial-state layout without horizontal overflow',
                    'zero external requests, popup, navigation, fetch, XHR, and connected Save',
                ],
                screenshots: [
                    'count-idle.png',
                    'count-neighbor-focus.png',
                    'count-forced-colors.png',
                    'count-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`Count browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
