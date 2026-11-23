import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const route = '/form-header-title-hover';
const paths = [`${route}.html`, `${route}.js`, `${route}.css`];
const titleClass = '.mx-sdk-form-placeholder--title';
const descriptionThemeStyles = `
/* Mirror the native Form host's border token and preflight cascade. */
body.description-border-proof { --border: 214.3 31.8% 91.4%; }
body.description-border-proof.miniextensions-admin { --border: 240 6% 90%; }
:where(body.description-border-proof) :where(*) { border-color: hsl(var(--border)); }
`;

export async function prepareFormHeaderBrowserFixture({
    temporary,
    installed,
    readArchiveMember,
    allowed,
    build,
    assertBrowserInputs,
    regular,
    hash,
}) {
    const fixture = join(temporary, 'form-header-example');
    mkdirSync(fixture);
    const inputs = [];
    const readPacked = (name) => {
        const member = `package/${name}`;
        const bytes = regular(join(installed, name));
        assert.deepEqual(bytes, readArchiveMember(member));
        inputs.push({ member, sha256: hash(bytes) });
        return bytes;
    };

    // Copy the packed recipe into the consumer. The bundle guard continues to
    // admit only SDK dist imports from inside the installed package.
    for (const file of ['main.ts', 'styles.css']) {
        writeFileSync(
            join(fixture, file),
            readPacked(`examples/react-form-header/${file}`)
        );
    }
    const outfile = join(fixture, 'form-header-title-hover.js');
    const bundle = await build({
        absWorkingDir: temporary,
        entryPoints: [join(fixture, 'main.ts')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        outfile,
        write: false,
        metafile: true,
        legalComments: 'none',
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await assertBrowserInputs(bundle.metafile, temporary);
    const bundleInputs = Object.keys(bundle.metafile.inputs).map((input) =>
        resolve(temporary, input)
    );
    for (const name of ['CompleteFormHeader.js', 'form-header.css']) {
        const member = `dist/esm/react/${name}`;
        assert(
            bundleInputs.includes(join(installed, member)),
            `Expected installed Form header input ${member}`
        );
        readPacked(member);
    }
    for (const path of paths) assert(!allowed.has(path));
    const javascript = bundle.outputFiles.find(({ path }) => path === outfile);
    const css = bundle.outputFiles.find(
        ({ path }) => path === outfile.replace(/\.js$/, '.css')
    );
    assert(javascript && css, 'Expected the stock example JS and CSS bundles');
    allowed.set(paths[1], javascript.contents);
    const styledFixture = Buffer.concat([
        Buffer.from(css.contents),
        Buffer.from(descriptionThemeStyles),
    ]);
    allowed.set(paths[2], styledFixture);
    // Supply an enclosing form so an accidental submit button is observable.
    allowed.set(
        paths[0],
        Buffer.from(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Form header consumer</title><link rel="icon" href="data:,"><link rel="stylesheet" href="${paths[2]}">
</head><body><form><div id="app"></div></form><script type="module" src="${paths[1]}"></script></body></html>`)
    );
    return {
        inputs,
        bundleSha256: hash(javascript.contents),
        cssSha256: hash(styledFixture),
    };
}

export async function checkFormHeaderBrowser({
    page,
    origin,
    output,
    evidence,
}) {
    const unexpectedRequests = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.protocol === 'data:' && request.resourceType() === 'image')
            return;
        if (
            request.method() !== 'GET' ||
            url.origin !== origin ||
            !paths.includes(url.pathname)
        )
            unexpectedRequests.push({
                method: request.method(),
                url: url.href,
            });
    });
    await page.addInitScript((selector) => {
        const errors = [];
        const titleClicks = [];
        let submits = 0;
        document.addEventListener(
            'click',
            (event) => {
                if (
                    event.target instanceof Element &&
                    event.target.closest(selector)
                )
                    titleClicks.push(event.isTrusted);
            },
            true
        );
        document.addEventListener('submit', (event) => {
            submits++;
            event.preventDefault();
        });
        document.addEventListener('securitypolicyviolation', (event) => {
            errors.push(event.violatedDirective);
        });
        window.__nativeProbe = {
            snapshot: () => ({
                errors,
                titleClicks,
                submits,
                localWrites: localStorage.length,
                sessionWrites: sessionStorage.length,
            }),
        };
    }, titleClass);

    const commands = page
        .getByRole('region', { name: 'Preview commands' })
        .locator('output');
    const preview = page.getByRole('checkbox', { name: 'Config preview' });
    const source = page.getByRole('combobox', { name: 'Source' });
    const title = page.getByRole('button', { name: 'Form title', exact: true });
    const paint = (button) =>
        button.evaluate((node) => {
            const style = getComputedStyle(node);
            return { color: style.color, background: style.backgroundColor };
        });
    const snapshot = () => page.evaluate(() => window.__nativeProbe.snapshot());
    const verify = async (clicks) => {
        const state = await snapshot();
        assert.deepEqual(state.titleClicks, clicks);
        assert.deepEqual(state.errors, []);
        assert.equal(state.submits, 0);
        assert.equal(state.localWrites, 0);
        assert.equal(state.sessionWrites, 0);
        assert.deepEqual(unexpectedRequests, []);
        return state;
    };

    evidence.activations = [];
    for (const activation of ['click', 'Enter', 'Space']) {
        await page.goto(origin + paths[0]);
        await source.selectOption('none');
        await preview.check();
        await title.waitFor();
        assert.equal(await title.getAttribute('type'), 'button');
        assert.equal(await commands.textContent(), 'No commands');
        await verify([]);
        if (activation === 'click') {
            await page.mouse.move(0, 0);
            evidence.rest = await paint(title);
            assert.deepEqual(evidence.rest, {
                color: 'rgb(156, 163, 175)',
                background: 'rgba(0, 0, 0, 0)',
            });
            await title.screenshot({
                path: join(output, 'form-title-rest.png'),
            });
            await title.hover();
            evidence.hover = await paint(title);
            assert.deepEqual(evidence.hover, {
                color: 'rgb(107, 114, 128)',
                background: 'rgba(0, 0, 0, 0)',
            });
            await title.screenshot({
                path: join(output, 'form-title-hover.png'),
            });
            await title.click();
        } else {
            await page.mouse.move(0, 0);
            await preview.focus();
            for (let tab = 0; tab < 16; tab++) {
                await page.keyboard.press('Tab');
                if (
                    await title.evaluate(
                        (node) => node === document.activeElement
                    )
                )
                    break;
            }
            const focus = await title.evaluate((node) => {
                const style = getComputedStyle(node);
                return {
                    focused:
                        node === document.activeElement &&
                        node.matches(':focus-visible'),
                    radius: style.borderRadius,
                    outline: [
                        style.outlineStyle,
                        style.outlineWidth,
                        style.outlineColor,
                        style.outlineOffset,
                    ],
                };
            });
            assert.deepEqual(focus, {
                focused: true,
                radius: '0px',
                outline: ['solid', '2px', 'rgb(36, 124, 103)', '3px'],
            });
            if (activation === 'Enter') {
                evidence.keyboardFocus = focus;
                const box = await title.boundingBox();
                assert(box);
                const outlineMargin = 6;
                await page.screenshot({
                    path: join(output, 'form-title-keyboard-focus.png'),
                    clip: {
                        x: box.x - outlineMargin,
                        y: box.y - outlineMargin,
                        width: box.width + 2 * outlineMargin,
                        height: box.height + 2 * outlineMargin,
                    },
                });
            }
            await page.keyboard.press(activation);
        }
        await page.waitForFunction(
            () =>
                document.querySelector('[aria-label="Preview commands"] output')
                    ?.textContent === 'title'
        );
        const state = await verify([true]);
        evidence.activations.push({
            activation,
            commands: await commands.textContent(),
            ...state,
        });
    }

    await page.goto(origin + paths[0]);
    await source.selectOption('none');
    assert.equal(await page.locator(titleClass).count(), 0);
    await preview.check();
    await source.selectOption('blank');
    const sourceTitle = page.getByRole('button', {
        name: 'Title from Airtable: Project summary',
        exact: true,
    });
    await sourceTitle.waitFor();
    assert.equal(
        await sourceTitle.evaluate(
            (node) => getComputedStyle(node).borderRadius
        ),
        '6px'
    );
    await page.mouse.move(0, 0);
    evidence.sourceRest = await paint(sourceTitle);
    assert.deepEqual(evidence.sourceRest, {
        color: 'rgb(7, 89, 133)',
        background: 'rgb(240, 249, 255)',
    });
    await sourceTitle.hover();
    evidence.sourceHover = await paint(sourceTitle);
    assert.equal(evidence.sourceHover.background, 'rgb(224, 242, 254)');
    assert.equal(evidence.sourceHover.color, evidence.sourceRest.color);
    await preview.uncheck();
    await sourceTitle.waitFor({ state: 'detached' });
    assert.equal(await page.locator(titleClass).count(), 0);
    await preview.check();
    await source.selectOption('static');
    const staticTitle = page.getByRole('heading', {
        name: 'A new perspective · Record A',
        exact: true,
    });
    await staticTitle.waitFor();
    assert.equal(
        await staticTitle.evaluate((node) => getComputedStyle(node).whiteSpace),
        'pre-line'
    );
    await source.selectOption('none');
    await preview.uncheck();
    await title.waitFor({ state: 'detached' });
    assert.equal(await page.locator(titleClass).count(), 0);
    assert.equal(await commands.textContent(), 'No commands');
    evidence.controls = await verify([]);

    await source.selectOption('formula');
    const formula = page.getByTestId('example-header').getByRole('heading');
    const formulaText = [
        'First',
        'Second',
        'Third',
        'Fourth',
        'Fifth',
        'Last',
    ].join('\n\n');
    await formula.waitFor();
    const formulaPaint = () =>
        formula.evaluate((node) => {
            const style = getComputedStyle(node);
            return {
                text: node.textContent,
                whiteSpace: style.whiteSpace,
                lineHeight: parseFloat(style.lineHeight),
                height: node.getBoundingClientRect().height,
                strongCount: node.querySelectorAll('strong').length,
            };
        });
    const child = page.getByRole('checkbox', { name: 'Child Form' });
    const placeholders = page.getByRole('checkbox', {
        name: 'Show placeholders',
    });
    evidence.formulaTitle = [];
    for (const viewport of [
        { width: 1280, height: 720 },
        { width: 375, height: 780 },
    ]) {
        await page.setViewportSize(viewport);
        const publicRoot = await formulaPaint();
        const collapsedTextHeight = await formula.evaluate(
            (node, text) => {
                // Measure ordinary wrapping with this browser's font and width.
                const reference = node.cloneNode(false);
                reference.classList.remove('mx-sdk-form-title--formula');
                reference.textContent = text;
                node.after(reference);
                const height = reference.getBoundingClientRect().height;
                reference.remove();
                return height;
            },
            formulaText.replaceAll('\n\n', ' ')
        );
        assert.equal(publicRoot.text, formulaText);
        assert.equal(publicRoot.strongCount, 0);
        assert.equal(publicRoot.whiteSpace, 'normal');
        assert.equal(publicRoot.lineHeight, 36);
        assert.equal(publicRoot.height, collapsedTextHeight);
        assert(publicRoot.height < 11 * publicRoot.lineHeight);
        await child.check();
        const childTitle = await formulaPaint();
        await child.uncheck();
        await preview.check();
        const builderWithPlaceholders = await formulaPaint();
        await placeholders.uncheck();
        const builderWithoutPlaceholders = await formulaPaint();
        await placeholders.check();
        await preview.uncheck();
        for (const scoped of [
            childTitle,
            builderWithPlaceholders,
            builderWithoutPlaceholders,
        ]) {
            assert.equal(scoped.text, formulaText);
            assert.equal(scoped.whiteSpace, 'pre-line');
            assert.equal(scoped.height, 11 * scoped.lineHeight);
        }
        await formula.screenshot({
            path: join(output, `form-formula-title-${viewport.width}.png`),
        });
        evidence.formulaTitle.push({
            viewport,
            publicRoot,
            collapsedTextHeight,
            childTitle,
            builderWithPlaceholders,
            builderWithoutPlaceholders,
        });
    }
    await verify([]);

    await page.setViewportSize({ width: 640, height: 640 });
    const header = page.getByTestId('example-header');
    const manual = header.getByRole('button', {
        name: 'Add form description',
        exact: true,
    });
    const sourced = header.getByRole('button', {
        name: /^Description from Airtable/,
    });
    const readBorder = (button) =>
        button.evaluate((node) => {
            const style = getComputedStyle(node);
            return {
                color: style.borderTopColor,
                style: style.borderTopStyle,
                width: style.borderTopWidth,
                radius: style.borderTopLeftRadius,
                padding: style.padding,
                focused: node.matches(':focus-visible'),
            };
        });
    evidence.descriptionBorders = [];
    for (const [theme, admin, expectedColor] of [
        ['public', false, 'rgb(226, 232, 240)'],
        ['admin', true, 'rgb(228, 228, 231)'],
    ]) {
        await page.goto(origin + paths[0]);
        await source.selectOption('none');
        await preview.check();
        await manual.waitFor();
        if (!admin) {
            evidence.descriptionStandalone = await readBorder(manual);
            assert.equal(
                evidence.descriptionStandalone.color,
                'rgb(209, 213, 219)'
            );
        }
        await page.evaluate((admin) => {
            document.body.classList.add('description-border-proof');
            document.body.classList.toggle('miniextensions-admin', admin);
        }, admin);
        await page.mouse.move(0, 0);

        const capture = async (button, state) => {
            const metrics = await readBorder(button);
            await button.screenshot({
                path: join(output, `form-description-${theme}-${state}.png`),
            });
            return metrics;
        };
        const rest = await capture(manual, 'rest');
        await manual.press('Shift+Tab');
        await page.keyboard.press('Tab');
        const focus = await capture(manual, 'tab');
        assert.equal(focus.focused, true);
        await page.keyboard.press('Enter');
        assert.equal(await commands.textContent(), 'description');
        await page.keyboard.press('Shift+Tab');
        await manual.hover();
        const hover = await capture(manual, 'hover');
        const manualTitle = await readBorder(title);
        assert.equal(manualTitle.radius, '0px');
        assert.equal(manualTitle.width, '0px');

        await source.selectOption('blank');
        await sourced.waitFor();
        const sourceBorder = await capture(sourced, 'source');
        assert.equal(sourceBorder.color, 'rgb(125, 211, 252)');
        await preview.uncheck();
        await sourced.waitFor({ state: 'detached' });
        assert.equal(await manual.count(), 0);
        await verify([]);
        evidence.descriptionBorders.push({
            theme,
            expectedColor,
            rest,
            focus,
            hover,
            sourceBorder,
        });
    }
    for (const {
        expectedColor,
        rest,
        focus,
        hover,
    } of evidence.descriptionBorders) {
        const expected = {
            color: expectedColor,
            style: 'dashed',
            width: '1px',
            radius: '6px',
            padding: '8px 12px',
        };
        assert.deepEqual(rest, { ...expected, focused: false });
        assert.deepEqual(focus, { ...expected, focused: true });
        assert.deepEqual(hover, { ...expected, focused: false });
    }
}
