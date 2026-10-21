// Local synthetic UI proof; no backend, fixture mutation, credentials or deployment.
// Run after build: node scripts/check-external-sync-source-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/external-sync-source-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-external-sync-source/main.ts'],
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
        response.end(
            readFileSync('examples/react-external-sync-source/index.html')
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
            process.env.SDK_EXTERNAL_SYNC_SOURCE_CHROMIUM ??
            '/usr/bin/chromium',
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
        name: 'Native source',
        exact: true,
    });
    const neighbor = page.getByRole('textbox', {
        name: 'Editable neighbor',
        exact: true,
    });
    await first.waitFor();
    const noReadonlyActions = async () => {
        assert.equal(await counter('source-writes'), 0);
        assert.equal(await counter('saves'), 0);
        assert.equal(await counter('row-events'), 0);
        assert.equal(await counter('requests'), 0);
        assert.equal(await counter('portal-reads'), 2);
    };
    const sourceValue = '  Unlisted 日本語 👩🏽‍💻  ';
    const expectedValues = [
        {
            index: 0,
            label: 'Native source',
            input: sourceValue,
            native: sourceValue,
        },
        {
            index: 1,
            label: 'Bound source',
            input: 'Form native source',
            native: 'Form native source',
        },
        {
            index: 2,
            label: 'Literal markup',
            input: '<script>window.sourceInjection = true</script>',
            native: '<script>window.sourceInjection = true</script>',
        },
        {
            index: 3,
            label: 'Grid source',
            input: 'https://example.invalid/source?x=1',
            native: 'https://example.invalid/source?x=1',
        },
        { index: 4, label: 'Empty source', input: '', native: null },
        { index: 5, label: 'Missing source', input: '', missing: true },
        {
            index: 8,
            label: 'Pending source',
            input: 'Pending native',
            native: 'Pending native',
        },
        {
            index: 9,
            label: 'Feedback source',
            input: 'Reviewed native',
            native: 'Reviewed native',
        },
        {
            index: 10,
            label: 'Hidden title',
            input: 'Accessible native',
            native: 'Accessible native',
        },
        {
            index: 11,
            label: 'Fallback source',
            input: 'List native source',
            native: 'List native source',
        },
        {
            index: 15,
            label: 'Lifecycle source',
            input: 'Retirable source',
            native: 'Retirable source',
        },
        {
            index: 16,
            label: 'Noncomputed source',
            input: 'Owner reports editable',
            native: 'Owner reports editable',
        },
    ];
    assert.equal(await page.locator('[id^="card-"]').count(), 17);
    assert.equal(await page.locator('[id^="card-"] input').count(), 15);
    assert.equal(await page.locator('[id^="card-"] button').count(), 15);
    assert.equal(await page.locator('#card-0 .custom-source').count(), 1);
    assert.equal(await counter('writes'), 0);
    for (const item of expectedValues) {
        const input = page.getByRole('textbox', {
            name: item.label,
            exact: true,
        });
        assert.equal(await input.inputValue(), item.input);
        assert.equal(await input.isDisabled(), true);
        assert.equal(await input.getAttribute('type'), 'text');
        assert.equal(await input.getAttribute('inputmode'), null);
        assert.equal(
            await page.locator(`#card-${item.index} button`).isDisabled(),
            true
        );
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
            .getByRole('textbox', { name: 'Pending source', exact: true })
            .getAttribute('aria-busy'),
        'true'
    );
    const feedback = page.getByRole('textbox', {
        name: 'Feedback source',
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
        { index: 6, label: 'Display mask', value: 'DISPLAY_PRIVATE_SOURCE' },
        { index: 7, label: 'Write mask', value: 'WRITE_PRIVATE_SOURCE' },
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
        'This control supports External Sync Source fields.'
    );
    assert.equal(await page.locator('#card-14 input').count(), 0);
    assert.equal(
        (await page.locator('#card-14').innerText()).includes(
            'Application-owned read-only presentation.'
        ),
        true
    );
    assert.equal(await neighbor.isEnabled(), true);
    assert.equal(await neighbor.inputValue(), 'Text draft');
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(
        await page.locator('#card-16').getAttribute('data-owner-can-edit'),
        'true'
    );
    assert.notEqual(
        await page.locator('#card-16').getAttribute('data-owner-admission'),
        'ready'
    );
    assert.equal(
        await page
            .locator('#card-0')
            .getByRole('button', {
                name: 'Clear read-only source',
                exact: true,
            })
            .isDisabled(),
        true
    );
    assert.equal(await page.evaluate(() => window.sourceInjection), undefined);
    await noReadonlyActions();
    await inert();
    await page.screenshot({
        path: join(output, 'source-idle.png'),
        fullPage: true,
    });

    // Choices are metadata, not a lookup or normalization layer for native text.
    for (let i = 0; i < 3; i++) {
        await page
            .getByRole('button', {
                name: 'Change choice metadata',
                exact: true,
            })
            .click();
        assert.equal(await first.inputValue(), sourceValue);
        assert.equal(await native(0), JSON.stringify(sourceValue));
        await page
            .getByRole('button', { name: 'Remount controls', exact: true })
            .click();
        assert.equal(await first.inputValue(), sourceValue);
        await noReadonlyActions();
    }

    // Native focus/pointer attempts cannot turn disabled External Sync Source displays into
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
    assert.equal(await first.inputValue(), sourceValue);
    assert.equal(await native(0), JSON.stringify(sourceValue));
    assert.equal(await neighbor.inputValue(), 'Text draft');
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
    const firstClear = page.locator('#card-0 button');
    await firstClear.click({ force: true });
    await firstClear.evaluate((node) =>
        node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    await first.evaluate((node) =>
        node.dispatchEvent(
            new CompositionEvent('compositionstart', {
                bubbles: true,
                data: '',
            })
        )
    );
    await injectText(first, 'Injected composition');
    await first.evaluate((node) =>
        node.dispatchEvent(
            new CompositionEvent('compositionend', {
                bubbles: true,
                data: 'Injected composition',
            })
        )
    );
    assert.equal(await first.inputValue(), sourceValue);
    assert.equal(await native(0), JSON.stringify(sourceValue));
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

    // The sole editable Text neighbor must remain reachable with the keyboard;
    // disabled External Sync Source inputs are skipped in the native tab order.
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
    await page.keyboard.type('Fresh draft');
    assert.equal(await neighbor.inputValue(), 'Fresh draft');
    assert.equal(await native(12), JSON.stringify('Fresh draft'));
    await neighbor.press('ArrowLeft');
    await neighbor.press('ArrowLeft');
    await page.keyboard.type('X');
    assert.equal(await neighbor.inputValue(), 'Fresh draXft');
    assert.equal(await neighbor.evaluate((node) => node.selectionStart), 10);
    await neighbor.press('Backspace');
    assert.equal(await neighbor.inputValue(), 'Fresh draft');
    await page
        .getByRole('button', { name: 'Remount controls', exact: true })
        .click();
    assert.equal(await neighbor.inputValue(), 'Fresh draft');
    await neighbor.fill('Base');
    const beforeComposition = await counter('writes');
    await neighbor.evaluate((node) =>
        node.dispatchEvent(
            new CompositionEvent('compositionstart', {
                bubbles: true,
                data: '',
            })
        )
    );
    await injectText(neighbor, 'Base 日本語');
    assert.equal(await neighbor.inputValue(), 'Base 日本語');
    assert.equal(await native(12), JSON.stringify('Base'));
    assert.equal(await counter('writes'), beforeComposition);
    await neighbor.evaluate((node) =>
        node.dispatchEvent(
            new CompositionEvent('compositionend', {
                bubbles: true,
                data: '日本語',
            })
        )
    );
    assert.equal(await native(12), JSON.stringify('Base 日本語'));
    assert.equal(await counter('writes'), beforeComposition + 1);
    await neighbor.focus();
    await page
        .locator('#card-12')
        .screenshot({ path: join(output, 'source-neighbor-focus.png') });
    await page
        .getByRole('button', { name: 'Clear Editable neighbor', exact: true })
        .click();
    assert.equal(await neighbor.inputValue(), '');
    assert.equal(await native(12), 'null');
    assert.equal(
        await neighbor.evaluate((node) => node === document.activeElement),
        true
    );
    await neighbor.fill('Final neighbor');
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
        .getByRole('button', { name: 'Replace source value', exact: true })
        .click();
    assert.equal(await first.inputValue(), 'Replacement source');
    assert.equal(await first.isDisabled(), true);
    assert.equal(await native(0), JSON.stringify('Replacement source'));
    assert.equal(await counter('writes'), finalNeighborWrites);
    await noReadonlyActions();
    await page
        .getByRole('button', { name: 'Remount controls', exact: true })
        .click();
    assert.equal(await first.inputValue(), 'Replacement source');
    assert.equal(await neighbor.inputValue(), 'Final neighbor');
    assert.equal(await counter('writes'), finalNeighborWrites);
    await page
        .getByRole('button', {
            name: 'Toggle source visibility',
            exact: true,
        })
        .click();
    assert.equal(await first.count(), 0);
    assert.equal(await native(0), 'Hidden');
    assert.equal(
        (await page.locator('#card-0').innerText()).includes(
            'Replacement source'
        ),
        false
    );
    await page
        .getByRole('button', {
            name: 'Toggle source visibility',
            exact: true,
        })
        .click();
    assert.equal(await first.inputValue(), 'Replacement source');
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
        path: join(output, 'source-forced-colors.png'),
        fullPage: true,
    });
    // Fresh initial-state page avoids Chromium raster artifacts after mode or
    // viewport changes; it intentionally differs from the edited desktop page.
    const narrow = await context.newPage();
    narrow.on('pageerror', (error) => errors.push(error.message));
    await narrow.setViewportSize({ width: 390, height: 844 });
    await narrow.goto(origin);
    await narrow
        .getByRole('textbox', { name: 'Native source', exact: true })
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
    assert.equal(await narrow.locator('#source-writes').textContent(), '0');
    assert.equal(await narrow.locator('#writes').textContent(), '0');
    assert.equal(await narrow.locator('#saves').textContent(), '0');
    assert.equal(
        await narrow
            .getByRole('textbox', { name: 'Native source', exact: true })
            .inputValue(),
        sourceValue
    );
    await assertMasks(narrow);
    await narrow.screenshot({
        path: join(output, 'source-mobile.png'),
        fullPage: false,
    });
    await narrow.close();

    const lifecycle = page.getByRole('textbox', {
        name: 'Lifecycle source',
        exact: true,
    });
    const detached = await lifecycle.elementHandle();
    const detachedClear = await page.locator('#card-15 button').elementHandle();
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
    await detached.evaluate((node) => {
        node.dispatchEvent(
            new CompositionEvent('compositionstart', { bubbles: true })
        );
        node.dispatchEvent(
            new CompositionEvent('compositionend', {
                bubbles: true,
                data: 'Stale',
            })
        );
    });
    await detachedClear.evaluate((node) =>
        node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    await detachedClear.dispose();
    await detached.dispose();
    await page
        .getByRole('button', { name: 'Remount controls', exact: true })
        .click();
    assert.equal(await lifecycle.count(), 0);
    assert.equal(await native(15), 'Retired');
    assert.equal(await first.inputValue(), 'Replacement source');
    assert.equal(await first.isDisabled(), true);
    assert.equal(await neighbor.inputValue(), 'Final neighbor');
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
                    'real Form owner and accepted Portal grid/list detail owners over local synthetic data; presentation edge fixtures and editable Text neighbor; no network or Save connected',
                sourceSetterCalls: await counter('source-writes'),
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
                    'public source slot and binding use disabled TextControl and text.css',
                    'real Form owner accepts canonical computed source metadata as readonly with no scalar',
                    'real Portal grid/list owners provide accepted readonly detail projections without cell bindings',
                    'choice renaming and removal never map or replace unknown native text',
                    'native whitespace and Unicode remain exact',
                    'HTML-shaped strings and URL strings stay inert without links or execution',
                    'null and missing native values remain blank across remount without writes',
                    'input and shared Clear stay disabled, including custom Clear label',
                    'native focus, pointer and keyboard attempts cannot edit readonly sources',
                    'injected input/change, Clear and composition events cannot write',
                    'pending state, supplied feedback, unique IDs and accessible hidden title remain intact',
                    'display-side and write-side masking hide plain-text readouts',
                    'wrong physical binding reports status without control or private readout',
                    'custom rendering takes precedence over the wrong-kind stock path',
                    'direct wrapper remains disabled for editable noncomputed owner whose real host rejects admission',
                    'native tab order skips disabled source inputs and Clear buttons',
                    'Text neighbor typing, caret editing, remount, synthetic composition and Clear work independently',
                    'neighbor edits never change source strings or call source setters',
                    'external replacement updates readonly display without rendering-generated writes',
                    'hidden and retired owners omit input, Clear and native readouts',
                    'stale detached input, Clear and composition probes leave source setter count unchanged',
                    'visible neighbor focus and forced colors',
                    'fresh narrow layout has no horizontal overflow',
                    'zero Save, runtime fetch, external requests, popup, navigation, fetch and XHR',
                ],
                screenshots: [
                    'source-idle.png',
                    'source-neighbor-focus.png',
                    'source-forced-colors.png',
                    'source-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`External Sync Source browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
