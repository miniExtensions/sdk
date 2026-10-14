// Local synthetic UI proof; no backend, fixture mutation, credentials or deployment.
// Run after build: node scripts/check-created-by-browser.mjs [evidence-directory]
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const output = resolve(process.argv[2] ?? 'dist/created-by-browser');
mkdirSync(output, { recursive: true });
const bundle = await build({
    entryPoints: ['examples/react-created-by/main.ts'],
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
        response.end(readFileSync('examples/react-created-by/index.html'));
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
            process.env.SDK_CREATED_BY_CHROMIUM ?? '/usr/bin/chromium',
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
    const native = async (index = 0) =>
        page.locator(`#native-${index}`).textContent();
    const read = async (index) =>
        page.evaluate((id) => window.__createdByProof.read(id), index);
    const readAll = async () =>
        page.evaluate(() => window.__createdByProof.readAll());
    const creatorName = '  Ada 日本語 👩🏽‍💻  ';
    const expectedValues = [
        { index: 0, label: 'Native creator', input: creatorName },
        { index: 1, label: 'Bound creator', input: 'Form creator' },
        {
            index: 2,
            label: 'Literal markup',
            input: '<script>window.creatorInjection = true</script>',
        },
        {
            index: 3,
            label: 'Grid creator',
            input: 'https://example.invalid/creator?x=1',
        },
        { index: 4, label: 'Empty creator', input: '', empty: true },
        { index: 5, label: 'Missing creator', input: '', missing: true },
        { index: 8, label: 'Pending creator', input: 'Pending native' },
        { index: 9, label: 'Feedback creator', input: 'Reviewed native' },
        { index: 10, label: 'Hidden title', input: 'Accessible native' },
        { index: 11, label: 'Fallback creator', input: 'List creator' },
        { index: 15, label: 'Lifecycle creator', input: 'Retirable creator' },
        {
            index: 16,
            label: 'Noncomputed creator',
            input: 'Noncomputed creator',
        },
        { index: 17, label: 'Blank name', input: '' },
        { index: 18, label: 'Malformed value', input: '', malformed: true },
        { index: 19, label: 'No creator name', input: '', malformed: true },
    ];
    const masks = [
        { index: 6, label: 'Display mask', value: 'DISPLAY_PRIVATE_CREATOR' },
        { index: 7, label: 'Write mask', value: 'WRITE_PRIVATE_CREATOR' },
    ];
    const first = page.getByRole('textbox', {
        name: 'Native creator',
        exact: true,
    });
    const neighbor = page.getByRole('textbox', {
        name: 'Editable neighbor',
        exact: true,
    });
    await first.waitFor();
    const originals = await readAll();
    assert.equal(originals.length, 20);

    const noReadonlyActions = async () => {
        assert.equal(await counter('creator-writes'), 0);
        assert.equal(await counter('saves'), 0);
        assert.equal(await counter('row-events'), 0);
        assert.equal(await counter('requests'), 0);
        assert.equal(await counter('portal-reads'), 2);
    };
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
        assert.equal(
            await page.evaluate(() => window.creatorInjection),
            undefined
        );
    };
    const preserve = async (before, except = []) => {
        const after = await readAll();
        assert.equal(after.length, before.length);
        for (let index = 0; index < before.length; index++) {
            if (!except.includes(index))
                assert.deepEqual(after[index], before[index], `card ${index}`);
        }
    };
    // Compare actual native objects, including nested opaque metadata. The
    // visible readout deliberately never serializes their private properties.
    const privateStrings = new Set();
    const rememberPrivate = (value, root = true) => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            if (root && key === 'name') continue;
            if (typeof child === 'string' && child.length)
                privateStrings.add(child);
            else rememberPrivate(child, false);
        }
    };
    originals.forEach((value) => rememberPrivate(value));
    const assertPrivate = async (surface = page) => {
        const exposed = await surface.evaluate(() => [
            document.documentElement.outerHTML,
            document.body.innerText,
            ...Array.from(document.querySelectorAll('input')).map(
                (input) => input.value
            ),
        ]);
        for (const content of exposed)
            assert.doesNotMatch(content, /PRIVATE_CREATOR_/);
        for (const value of privateStrings)
            for (const content of exposed)
                assert.equal(
                    content.includes(value),
                    false,
                    'private metadata'
                );
    };
    const assertMasks = async (surface = page) => {
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
    const composition = async (input, type, data = '') =>
        input.evaluate(
            (node, event) =>
                node.dispatchEvent(
                    new CompositionEvent(event.type, {
                        bubbles: true,
                        data: event.data,
                    })
                ),
            { type, data }
        );
    const remount = async () =>
        page
            .getByRole('button', { name: 'Remount controls', exact: true })
            .click();
    let formRetired = false;
    const assertInputs = async () => {
        for (const item of expectedValues) {
            if (item.index === 16 && formRetired) continue;
            const input = page.getByRole('textbox', {
                name: item.label,
                exact: true,
            });
            assert.equal(await input.inputValue(), item.input);
            assert.equal(await input.isDisabled(), true);
            assert.equal(await input.getAttribute('type'), 'text');
            for (const attribute of ['inputmode', 'min', 'max', 'step'])
                assert.equal(await input.getAttribute(attribute), null);
            assert.equal(
                await page.locator(`#card-${item.index} button`).isDisabled(),
                true
            );
        }
        await assertMasks();
    };
    assert.equal(await page.locator('[id^="card-"]').count(), 20);
    assert.equal(await page.locator('[id^="card-"] input').count(), 18);
    assert.equal(await page.locator('[id^="card-"] button').count(), 18);
    assert.equal(await page.locator('#card-0 .custom-creator').count(), 1);
    assert.equal(await counter('writes'), 0);
    await assertInputs();
    for (const item of expectedValues) {
        if (item.empty) {
            assert.equal(originals[item.index], null);
            assert.equal(await native(item.index), 'null');
        } else if (item.missing) {
            assert.equal(originals[item.index], undefined);
            assert.equal(await native(item.index), 'Missing');
        } else if (!item.malformed) {
            const value = originals[item.index];
            assert.equal(value.name, item.input);
            assert.equal(typeof value.id, 'string');
            assert.equal(typeof value.email, 'string');
            assert.equal(typeof value.profilePicUrl, 'string');
            assert.equal(await native(item.index), 'Object preserved');
        }
    }
    assert.equal(originals[18], 'not a collaborator');
    assert.equal(await native(18), 'Invalid shape preserved');
    assert.equal(Object.hasOwn(originals[19], 'name'), false);
    assert.equal(await native(19), 'Object preserved');
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Hidden title', exact: true })
            .getAttribute('aria-label'),
        'Hidden title'
    );
    assert.equal(await page.locator('#card-10 label').count(), 0);
    assert.equal(
        await page
            .getByRole('textbox', { name: 'Pending creator', exact: true })
            .getAttribute('aria-busy'),
        'true'
    );
    const feedback = page.getByRole('textbox', {
        name: 'Feedback creator',
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
    assert.equal(await page.locator('#card-13 input').count(), 0);
    assert.equal(
        await page.locator('#card-13').getByRole('status').textContent(),
        'This control supports Created By fields.'
    );
    assert.equal(await native(13), 'Unavailable');
    assert.equal(await page.locator('#card-14 input').count(), 0);
    assert.equal(
        (await page.locator('#card-14').innerText()).includes(
            'Application-owned read-only presentation.'
        ),
        true
    );
    assert.equal(await native(14), 'Unavailable');
    assert.equal(await neighbor.isEnabled(), true);
    assert.equal(await neighbor.inputValue(), 'Text draft');
    const ids = await page
        .locator('[id]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));
    assert.equal(new Set(ids).size, ids.length);
    for (const index of [1, 16]) {
        assert.equal(
            await page
                .locator(`#card-${index}`)
                .getAttribute('data-owner-can-edit'),
            'false'
        );
        assert.equal(
            await page
                .locator(`#card-${index}`)
                .getAttribute('data-owner-admission'),
            'ready'
        );
    }
    assert.equal(
        await page
            .locator('#card-0')
            .getByRole('button', {
                name: 'Clear read-only creator',
                exact: true,
            })
            .isDisabled(),
        true
    );
    await preserve(originals);
    await assertPrivate();
    await noReadonlyActions();
    await inert();
    await page.screenshot({
        path: join(output, 'creator-idle.png'),
        fullPage: true,
    });

    // Disabled controls cannot take native focus or turn keyboard input into edits.
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
    await assertInputs();
    assert.equal(await neighbor.inputValue(), 'Text draft');
    assert.equal(await counter('writes'), 0);
    await preserve(originals);
    await noReadonlyActions();

    // These injected events probe disabled handlers, not native user editing
    // or an OS input method. Full objects must survive every attempted action.
    for (const item of expectedValues) {
        const input = page.getByRole('textbox', {
            name: item.label,
            exact: true,
        });
        await injectText(input, 'Injected creator');
        assert.equal(await input.inputValue(), item.input);
        assert.deepEqual(await read(item.index), originals[item.index]);
    }
    for (const mask of masks)
        await injectText(
            page.getByLabel(mask.label, { exact: true }),
            'Injected'
        );
    const firstClear = page.locator('#card-0 button');
    await firstClear.click({ force: true });
    await firstClear.evaluate((node) =>
        node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    await composition(first, 'compositionstart');
    await injectText(first, 'Injected composition');
    await composition(first, 'compositionend', 'Injected composition');
    await assertInputs();
    await preserve(originals);
    await noReadonlyActions();
    assert.equal(await counter('writes'), 0);
    await remount();
    await assertInputs();
    await preserve(originals);
    await assertPrivate();
    await noReadonlyActions();

    // Each malformed snapshot remains an owner value; no fallback identity,
    // coercion, selection, or replacement is written by the presentation.
    const malformed = page.getByRole('textbox', {
        name: 'Malformed value',
        exact: true,
    });
    const malformedSnapshots = [];
    const malformedShapes = [
        (value) => assert.equal(value, 'PRIVATE_CREATOR_RAW_STRING'),
        (value) => assert.equal(Object.hasOwn(value, 'name'), false),
        (value) => assert.equal(typeof value.id, 'number'),
        (value) => assert.equal(value.email, null),
        (value) => assert.equal(typeof value.name, 'number'),
        (value) => assert.equal(value.profilePicUrl, null),
        (value) => {
            assert.equal(Array.isArray(value), true);
            assert.equal(value[0].name, 'Do not display array');
        },
    ];
    for (let index = 0; index < 7; index++) {
        await page
            .getByRole('button', { name: 'Cycle malformed value', exact: true })
            .click();
        const value = await read(18);
        malformedShapes[index](value);
        malformedSnapshots.push(value);
        if (typeof value === 'string') privateStrings.add(value);
        else rememberPrivate(value, false);
        assert.equal(
            await native(18),
            typeof value === 'object'
                ? 'Object preserved'
                : 'Invalid shape preserved'
        );
        assert.equal(await malformed.inputValue(), '');
        assert.equal(await malformed.isDisabled(), true);
        await injectText(malformed, 'Do not repair');
        await composition(malformed, 'compositionstart');
        await composition(malformed, 'compositionend', 'Do not repair');
        await page
            .locator('#card-18 button')
            .evaluate((node) =>
                node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
            );
        assert.deepEqual(await read(18), value);
        await remount();
        assert.equal(await malformed.inputValue(), '');
        assert.deepEqual(await read(18), value);
        await preserve(originals, [18]);
        await assertPrivate();
        await noReadonlyActions();
        assert.equal(await counter('writes'), 0);
    }
    assert.equal(
        new Set(malformedSnapshots.map((value) => JSON.stringify(value))).size,
        7
    );
    const stable = await readAll();
    await assertInputs();
    await preserve(originals, [18]);

    // Noncomputed metadata does not grant editing for Created By. Its real
    // Form host permanently retires when its owner is no longer current.
    const noncomputed = page.getByRole('textbox', {
        name: 'Noncomputed creator',
        exact: true,
    });
    const staleFormInput = await noncomputed.elementHandle();
    const staleFormClear = await page
        .locator('#card-16 button')
        .elementHandle();
    await page
        .getByRole('button', { name: 'Retire Form host', exact: true })
        .click();
    formRetired = true;
    assert.equal(await noncomputed.count(), 0);
    assert.equal(await page.locator('#card-16 button').count(), 0);
    assert.equal(await native(16), 'Stale');
    assert.notEqual(
        await page.locator('#card-16').getAttribute('data-owner-admission'),
        'ready'
    );
    await injectText(staleFormInput, 'Stale form input');
    await composition(staleFormInput, 'compositionstart');
    await composition(staleFormInput, 'compositionend', 'Stale form creator');
    await staleFormClear.evaluate((node) =>
        node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    await staleFormInput.dispose();
    await staleFormClear.dispose();
    await preserve(stable);
    await noReadonlyActions();
    await remount();
    assert.equal(await noncomputed.count(), 0);
    assert.equal(await page.locator('#card-16 button').count(), 0);
    assert.equal(await native(16), 'Stale');
    assert.notEqual(
        await page.locator('#card-16').getAttribute('data-owner-admission'),
        'ready'
    );
    await assertInputs();
    await preserve(stable);
    await noReadonlyActions();

    // Native tab order must skip disabled creator inputs and their Clear buttons.
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
    assert.equal(await read(12), null);
    await page.keyboard.type('Fresh draft');
    assert.equal(await neighbor.inputValue(), 'Fresh draft');
    assert.equal(await read(12), 'Fresh draft');
    await neighbor.press('ArrowLeft');
    await neighbor.press('ArrowLeft');
    await page.keyboard.type('X');
    assert.equal(await neighbor.inputValue(), 'Fresh draXft');
    assert.equal(await neighbor.evaluate((node) => node.selectionStart), 10);
    await neighbor.press('Backspace');
    assert.equal(await neighbor.inputValue(), 'Fresh draft');
    await remount();
    assert.equal(await neighbor.inputValue(), 'Fresh draft');
    await neighbor.fill('Base');
    const beforeComposition = await counter('writes');
    await composition(neighbor, 'compositionstart');
    await injectText(neighbor, 'Base 日本語');
    assert.equal(await neighbor.inputValue(), 'Base 日本語');
    assert.equal(await read(12), 'Base');
    assert.equal(await counter('writes'), beforeComposition);
    await composition(neighbor, 'compositionend', '日本語');
    assert.equal(await read(12), 'Base 日本語');
    assert.equal(await counter('writes'), beforeComposition + 1);
    await neighbor.focus();
    await page.locator('#card-12').screenshot({
        path: join(output, 'creator-neighbor-focus.png'),
    });
    await page
        .getByRole('button', { name: 'Clear Editable neighbor', exact: true })
        .click();
    assert.equal(await neighbor.inputValue(), '');
    assert.equal(await read(12), null);
    assert.equal(
        await neighbor.evaluate((node) => node === document.activeElement),
        true
    );
    await neighbor.fill('Final neighbor');
    const finalNeighborWrites = await counter('writes');
    await assertInputs();
    await preserve(stable, [12]);
    await noReadonlyActions();

    await page
        .getByRole('button', { name: 'Replace creator value', exact: true })
        .click();
    const replacement = await read(0);
    assert.equal(replacement.name, 'Replacement creator');
    assert.notDeepEqual(replacement, originals[0]);
    rememberPrivate(replacement);
    assert.equal(await first.inputValue(), 'Replacement creator');
    assert.equal(await first.isDisabled(), true);
    assert.equal(await native(0), 'Object preserved');
    assert.equal(await counter('writes'), finalNeighborWrites);
    await preserve(stable, [0, 12]);
    await noReadonlyActions();
    await remount();
    assert.deepEqual(await read(0), replacement);
    assert.equal(await first.inputValue(), 'Replacement creator');
    assert.equal(await neighbor.inputValue(), 'Final neighbor');
    await page
        .getByRole('button', { name: 'Toggle creator visibility', exact: true })
        .click();
    assert.equal(await first.count(), 0);
    assert.equal(await page.locator('#card-0 button').count(), 0);
    assert.equal(await native(0), 'Hidden');
    assert.equal(
        (await page.locator('#card-0').innerText()).includes(
            'Replacement creator'
        ),
        false
    );
    assert.deepEqual(await read(0), replacement);
    await page
        .getByRole('button', { name: 'Toggle creator visibility', exact: true })
        .click();
    assert.equal(await first.inputValue(), 'Replacement creator');
    assert.equal(await first.isDisabled(), true);
    assert.deepEqual(await read(0), replacement);
    assert.equal(await counter('writes'), finalNeighborWrites);
    await noReadonlyActions();
    await assertPrivate();
    await assertMasks();
    await inert();

    await page.emulateMedia({ forcedColors: 'active' });
    await neighbor.focus();
    assert.equal(
        await neighbor.evaluate((node) => getComputedStyle(node).outlineStyle),
        'solid'
    );
    await page.screenshot({
        path: join(output, 'creator-forced-colors.png'),
        fullPage: true,
    });
    // Use a fresh initial-state page to avoid raster artifacts after changing
    // viewport or color mode on the edited desktop page.
    const narrow = await context.newPage();
    narrow.on('pageerror', (error) => errors.push(error.message));
    await narrow.setViewportSize({ width: 390, height: 844 });
    await narrow.goto(origin);
    await narrow
        .getByRole('textbox', { name: 'Native creator', exact: true })
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
    for (const id of [
        'creator-writes',
        'writes',
        'saves',
        'row-events',
        'requests',
    ])
        assert.equal(await narrow.locator(`#${id}`).textContent(), '0');
    assert.equal(await narrow.locator('#portal-reads').textContent(), '2');
    assert.equal(
        await narrow
            .getByRole('textbox', { name: 'Native creator', exact: true })
            .inputValue(),
        creatorName
    );
    assert.deepEqual(
        await narrow.evaluate(() => window.__createdByProof.readAll()),
        originals
    );
    await assertMasks(narrow);
    await assertPrivate(narrow);
    await narrow.screenshot({
        path: join(output, 'creator-mobile.png'),
        fullPage: false,
    });
    await narrow.close();

    const lifecycle = page.getByRole('textbox', {
        name: 'Lifecycle creator',
        exact: true,
    });
    const detached = await lifecycle.elementHandle();
    const detachedClear = await page.locator('#card-15 button').elementHandle();
    await page
        .getByRole('button', { name: 'Retire lifecycle binding', exact: true })
        .click();
    assert.equal(await lifecycle.count(), 0);
    assert.equal(await page.locator('#card-15 button').count(), 0);
    assert.equal(await native(15), 'Retired');
    await injectText(detached, 'Stale creator');
    await composition(detached, 'compositionstart');
    await composition(detached, 'compositionend', 'Stale creator');
    await detachedClear.evaluate((node) =>
        node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    await detachedClear.dispose();
    await detached.dispose();
    await remount();
    assert.equal(await lifecycle.count(), 0);
    assert.equal(await native(15), 'Retired');
    assert.deepEqual(await read(0), replacement);
    await preserve(stable, [0, 12]);
    assert.equal(await first.inputValue(), 'Replacement creator');
    assert.equal(await first.isDisabled(), true);
    assert.equal(await neighbor.inputValue(), 'Final neighbor');
    assert.equal(await read(12), 'Final neighbor');
    assert.equal(await counter('writes'), finalNeighborWrites);
    await noReadonlyActions();
    await assertPrivate();
    await assertMasks();
    await inert();
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(
            {
                browser: browser.version(),
                transport:
                    'real Form owners and accepted Portal grid/list detail owners over local synthetic data; presentation edge fixtures and editable Text neighbor; no network or Save connected',
                creatorSetterCalls: await counter('creator-writes'),
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
                malformedCases: malformedSnapshots.length,
                checks: [
                    'public creator slot and binding use disabled TextControl and text.css',
                    'real Form owner accepts computed creator metadata as readonly with no scalar',
                    'real Portal grid/list owners provide accepted readonly detail projections without cell bindings',
                    'only native collaborator name appears, preserving whitespace and Unicode exactly',
                    'opaque IDs, email, avatar and nested private properties never appear in DOM or controls',
                    'HTML-shaped names and URL names remain inert without links, images or execution',
                    'full native objects remain deeply equal through no-op events and remounts',
                    'null, missing and empty names remain blank without fallback identities',
                    'seven malformed shapes remain blank and unmodified without coercion or repair',
                    'input and shared Clear stay disabled, including custom Clear label',
                    'native focus, pointer and keyboard attempts cannot edit readonly creators',
                    'injected input/change, Clear and composition events cannot write',
                    'pending state, supplied feedback, unique IDs and accessible hidden title remain intact',
                    'display-side and write-side masking hide plain-text names and readouts',
                    'wrong physical binding reports status without control or private readout',
                    'custom rendering takes precedence over the wrong-kind stock path',
                    'noncomputed Created By Form owner remains readonly and its real host accepts admission',
                    'real Form currentness permanently retires its host while preserving the readonly native object',
                    'stale detached Form input, Clear and composition events cannot write',
                    'native tab order skips disabled creator inputs and Clear buttons',
                    'Text neighbor typing, caret editing, remount, synthetic composition and Clear work independently',
                    'neighbor edits never change creator objects or call creator setters',
                    'external replacement updates only the displayed native name without rendering-generated writes',
                    'hidden and retired owners omit input, Clear and private readouts',
                    'stale detached retired input, Clear and composition events preserve the original object',
                    'visible neighbor focus and forced colors; fresh narrow layout has no horizontal overflow',
                    'zero Save, runtime fetch, external requests, popup, navigation, fetch and XHR',
                ],
                screenshots: [
                    'creator-idle.png',
                    'creator-neighbor-focus.png',
                    'creator-forced-colors.png',
                    'creator-mobile.png',
                ],
            },
            null,
            2
        ) + '\n'
    );
    console.log(`Created By browser checks passed: ${output}`);
} finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
}
