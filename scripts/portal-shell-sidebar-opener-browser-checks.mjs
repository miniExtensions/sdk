import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const title = 'Projects Portal';
const wrappedTitle = 'Read-only Portal Chart voYrEfA8SQ_G 0 0';
const nativeTitleFont = ['18px', '700', '28px'];
const titleWidths = [375, 1023, 1024, 1280];
const open = 'Open navigation menu';
const legacyIcon =
    'M3 6.75A.75.75 0 0 1 3.75 6h16.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 6.75ZM3 12a.75.75 0 0 1 .75-.75h16.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 12Zm0 5.25a.75.75 0 0 1 .75-.75h16.5a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1-.75-.75Z';

async function mountLegacyHeader(page) {
    await page.evaluate(
        ({ title, legacyIcon }) => {
            // PortalHeader.tsx at 66e03254: p-2 shadow, leading 24 px solid
            // Bars3Icon in p-2.5 mr-2 gray-700, then the text-lg bold title.
            const header = document.createElement('div');
            header.id = 'legacy-sidebar-header';
            header.style.cssText =
                'position:fixed;z-index:100;inset:0 0 auto;display:flex;align-items:center;padding:8px;background:white;color:#111827;box-shadow:0 1px 3px #0000001a,0 1px 2px -1px #0000001a';
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('aria-label', 'Open sidebar');
            button.style.cssText =
                'display:flex;flex:none;border:0;padding:10px;margin-right:8px;background:transparent;color:#374151';
            button.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="${legacyIcon}"/></svg>`;
            const heading = document.createElement('h1');
            heading.textContent = title;
            heading.style.cssText = 'margin:0;font:700 18px/28px system-ui';
            header.append(button, heading);
            document.body.append(header);
        },
        { title, legacyIcon }
    );
}

async function measure(header) {
    return header.evaluate((node) => {
        const button = node.querySelector('button');
        const heading = node.querySelector('h1');
        const icon = button?.querySelector('svg');
        const bounds = (element) => {
            if (!element || !element.getClientRects().length) return null;
            const { x, y, width, height } = element.getBoundingClientRect();
            return [x, y, width, height];
        };
        const computed = (element, property) =>
            element ? getComputedStyle(element)[property] : null;
        return {
            header: bounds(node),
            button: bounds(button),
            heading: bounds(heading),
            icon: bounds(icon),
            visibleText: button?.innerText.trim() ?? '',
            leadingInDom: Boolean(
                button &&
                    heading &&
                    button.compareDocumentPosition(heading) &
                        Node.DOCUMENT_POSITION_FOLLOWING
            ),
            iconPaint: computed(icon, 'fill'),
            iconPath: icon?.querySelector('path')?.getAttribute('d') ?? null,
            iconHidden: icon?.getAttribute('aria-hidden') ?? null,
            titleFont: [
                computed(heading, 'fontSize'),
                computed(heading, 'fontWeight'),
                computed(heading, 'lineHeight'),
            ],
        };
    });
}

async function checkSidebarLogos(page, header, output, label) {
    const logoBytes = readFileSync(
        new URL('../test/fixtures/image-annotation-64x32.png', import.meta.url)
    );
    const logoUrl = 'data:image/png;base64,' + logoBytes.toString('base64');
    const wideLogoUrl = await page.evaluate(async (source) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const wide = document.createElement('canvas');
        wide.width = 512;
        wide.height = 64;
        wide.getContext('2d').drawImage(image, 0, 0, wide.width, wide.height);
        return wide.toDataURL('image/png');
    }, logoUrl);
    const logo = header.locator('.mx-sdk-portal-logo');
    const cases = [];
    const drawerCases = [];
    for (const width of titleWidths) {
        await page.setViewportSize({
            width,
            height: width === 375 ? 780 : 720,
        });
        for (const mode of [
            'standalone',
            'with-title',
            'native',
            'native-wide',
        ]) {
            const wide = mode === 'native-wide';
            const source = wide ? wideLogoUrl : logoUrl;
            const titleText = mode === 'with-title' ? title : '';
            await page.evaluate(
                ({ mode, source, titleText }) => {
                    window.configure({
                        header: {
                            layout: 'sidebar',
                            sidebarWidth: 288,
                            showBrandInNavigation: true,
                            title: titleText,
                            titleHtml: titleText === '' ? '' : undefined,
                            logoUrl: source,
                            ...(mode === 'standalone'
                                ? {}
                                : {
                                      sidebarToggle: 'icon',
                                      actionsPlacement: 'layout',
                                      menuInteraction: 'menu',
                                  }),
                        },
                    });
                },
                { mode, source, titleText }
            );
            await page.waitForFunction(
                ({ mode, source, titleText }) => {
                    const configured = window.fixtureCommittedSnapshot?.header;
                    return (
                        configured?.logoUrl === source &&
                        configured.title === titleText &&
                        (configured.sidebarToggle === 'icon') ===
                            (mode !== 'standalone')
                    );
                },
                { mode, source, titleText }
            );
            const geometry = await logo.evaluate(async (node) => {
                await node.decode();
                const image = node.getBoundingClientRect();
                const header = node.closest('header').getBoundingClientRect();
                return {
                    box: [
                        image.x - header.x,
                        image.y - header.y,
                        image.width,
                        image.height,
                    ],
                    intrinsic: [node.naturalWidth, node.naturalHeight],
                    objectFit: getComputedStyle(node).objectFit,
                };
            });
            assert.deepEqual(geometry.intrinsic, wide ? [512, 64] : [64, 32]);
            if (mode === 'standalone' || mode === 'with-title') {
                assert.deepEqual(geometry.box.slice(2), [64, 32]);
                assert.equal(geometry.objectFit, 'contain');
            } else {
                // The native h-14 w-auto image uses the available width after sidebar padding.
                const desktop = width >= 1024;
                const nativeWidth = wide
                    ? desktop
                        ? 239
                        : Math.min(448, width - 68)
                    : 112;
                assert.deepEqual(
                    geometry.box,
                    desktop
                        ? [24, 16, nativeWidth, 56]
                        : [60, 8, nativeWidth, 56]
                );
                assert.equal(geometry.objectFit, 'fill');
                await header.screenshot({
                    path: join(
                        output,
                        `${label}-sidebar-logo-${mode}-${width}.png`
                    ),
                });
            }
            cases.push({ width, mode, ...geometry });
            if (mode === 'native' && width < 1024) {
                const opener = header.getByRole('button', {
                    name: open,
                    exact: true,
                });
                await opener.press('Enter');
                const drawer = page.getByRole('dialog', {
                    name: 'Portal navigation',
                    exact: true,
                });
                await drawer.waitFor();
                await page.waitForFunction(() =>
                    document.activeElement?.closest(
                        '.mx-sdk-portal-navigation[role="dialog"]'
                    )
                );
                const bounds = await drawer
                    .locator('.mx-sdk-portal-logo')
                    .evaluate(async (image) => {
                        await image.decode();
                        const logoBox = image.getBoundingClientRect();
                        const panel = image
                            .closest('[role="dialog"]')
                            .getBoundingClientRect();
                        return [
                            logoBox.x - panel.x,
                            logoBox.y - panel.y,
                            logoBox.width,
                            logoBox.height,
                        ];
                    });
                assert.deepEqual(bounds.slice(2), [112, 56]);
                assert(bounds[0] >= 0 && bounds[1] >= 0);
                await drawer.screenshot({
                    path: join(
                        output,
                        `${label}-sidebar-logo-drawer-${width}.png`
                    ),
                });
                await page.keyboard.press('Escape');
                await drawer.waitFor({ state: 'hidden' });
                await page.waitForFunction(
                    () =>
                        document.activeElement ===
                        document.querySelector(
                            '.mx-sdk-portal-header > .mx-sdk-portal-toggle'
                        )
                );
                assert.equal(
                    await opener.getAttribute('aria-expanded'),
                    'false'
                );
                drawerCases.push({ width, bounds, focusReturned: true });
            }
        }
    }
    return { cases, drawerCases };
}

export async function checkNativeSidebarOpener(browser, origin, output, label) {
    const context = await browser.newContext({
        viewport: { width: 390, height: 720 },
        serviceWorkers: 'block',
    });
    const errors = [];
    const refused = [];
    try {
        await context.addInitScript((label) => {
            window.sidebarOpenerLabels = { openNavigation: label };
        }, open);
        await context.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                url.origin === origin &&
                !url.search &&
                request.method() === 'GET' &&
                ['/', '/main.js', '/main.css', '/favicon.ico'].includes(
                    url.pathname
                )
            )
                return route.continue();
            refused.push(request.url());
            return route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin);
        await page
            .getByRole('heading', { name: '<Customer Portal>' })
            .waitFor();
        const configure = (useIcon, headingTitle = title) =>
            page
                .evaluate(
                    ({ useIcon, title }) => {
                        window.configure({
                            selectionPolicy: 'host',
                            header: {
                                layout: 'sidebar',
                                title,
                                sidebarWidth: 288,
                                showBrandInNavigation: true,
                                actionsPlacement: 'layout',
                                menuInteraction: 'menu',
                                ...(useIcon ? { sidebarToggle: 'icon' } : {}),
                            },
                        });
                    },
                    { useIcon, title: headingTitle }
                )
                .then(() =>
                    page.waitForFunction(
                        (useIcon) =>
                            (window.fixtureCommittedSnapshot?.header
                                .sidebarToggle ===
                                'icon') ===
                            useIcon,
                        useIcon
                    )
                );
        const header = page.locator('.mx-sdk-portal-header');
        const button = header.getByRole('button', { name: open, exact: true });
        const cases = [];
        for (const width of [390, 900, 1024]) {
            await page.setViewportSize({ width, height: 720 });
            await configure(false);
            await header.getByRole('heading', { name: title }).waitFor();
            if (width < 1024) await button.waitFor();
            else await button.waitFor({ state: 'hidden' });
            const before = await measure(header);
            await header.screenshot({
                path: join(output, `${label}-sidebar-${width}-before.png`),
            });
            await configure(true);
            if (width === 1024) await button.waitFor({ state: 'hidden' });
            else await button.waitFor();
            const after = await measure(header);
            await header.screenshot({
                path: join(output, `${label}-sidebar-${width}-after.png`),
            });
            if (width === 1024) {
                assert.equal(after.button, null);
                assert.equal(after.icon, null);
                assert.deepEqual(
                    after.header.slice(0, 3),
                    before.header.slice(0, 3)
                );
                assert.equal(after.heading[0] - before.heading[0], 8);
                assert.equal(after.heading[1], before.heading[1]);
                assert.deepEqual(before.titleFont, ['20px', '700', 'normal']);
                assert.deepEqual(after.titleFont, nativeTitleFont);
                const nav = page.getByRole('navigation', {
                    name: 'Portal navigation',
                });
                assert.equal(await nav.isVisible(), true);
                cases.push({ width, before, after });
                continue;
            }
            assert.equal(before.visibleText, open);
            assert.equal(before.icon, null);
            assert.equal(before.leadingInDom, false);
            await mountLegacyHeader(page);
            const reference = page.locator('#legacy-sidebar-header');
            const legacy = await measure(reference);
            await reference.screenshot({
                path: join(output, `${label}-sidebar-${width}-legacy.png`),
            });
            assert.equal(
                await reference
                    .getByRole('button', { name: 'Open sidebar', exact: true })
                    .count(),
                1
            );
            await reference.evaluate((node) => node.remove());
            assert.deepEqual(after, legacy);
            assert.deepEqual(after.icon, [18, 18, 24, 24]);
            assert.deepEqual(after.button, [8, 8, 44, 44]);
            assert.equal(after.heading[0], 60);
            assert.equal(await button.getAttribute('aria-expanded'), 'false');
            assert.equal(await button.getAttribute('aria-label'), open);
            await button.evaluate((element) => {
                window.sidebarOpenerClicks = [];
                element.addEventListener('click', (event) => {
                    window.sidebarOpenerClicks.push({
                        trusted: event.isTrusted,
                        detail: event.detail,
                    });
                });
            });
            await button.click();
            const drawer = page.getByRole('dialog', {
                name: 'Portal navigation',
                exact: true,
            });
            await drawer.waitFor();
            assert.equal(await drawer.count(), 1);
            assert.equal(
                await header
                    .getByRole('button', {
                        name: 'Close navigation',
                        exact: true,
                    })
                    .getAttribute('aria-expanded'),
                'true'
            );
            await page.keyboard.press('Escape');
            await drawer.waitFor({ state: 'hidden' });
            assert.equal(
                await button.evaluate(
                    (element) => document.activeElement === element
                ),
                true
            );
            assert.equal(await button.getAttribute('aria-expanded'), 'false');
            const clicks = await page.evaluate(
                () => window.sidebarOpenerClicks
            );
            assert.deepEqual(clicks, [{ trusted: true, detail: 1 }]);
            assert.equal(page.url(), origin + '/');
            assert.deepEqual(
                await page.evaluate(() => [
                    window.proof.intents,
                    window.proof.activations,
                    window.proof.reads,
                ]),
                [[], [], []]
            );
            cases.push({
                width,
                before,
                after,
                legacy,
                accessibleName: open,
                legacyAccessibleName: 'Open sidebar',
                clicks,
                escapeReturnedFocus: true,
            });
        }
        const inter = readFileSync(
            new URL('../test/fixtures/inter/inter-latin.woff2', import.meta.url)
        ).toString('base64');
        await page.addStyleTag({
            content: `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${inter}) format('woff2');font-weight:100 900}body{font-family:Inter,sans-serif}`,
        });
        const loadedFaces = await page.evaluate(async () => {
            const faces = await document.fonts.load('700 18px Inter');
            return faces.map((face) => face.family);
        });
        assert.deepEqual(loadedFaces, ['Inter']);
        const wrappedTitleCases = [];
        for (const width of titleWidths) {
            await page.setViewportSize({
                width,
                height: width === 375 ? 780 : 720,
            });
            await configure(true, wrappedTitle);
            const heading = header.getByRole('heading', { name: wrappedTitle });
            await heading.waitFor();
            const measured = await measure(header);
            assert.deepEqual(measured.titleFont, nativeTitleFont);
            if (width >= 1024) {
                // Native PortalHeader.tsx at 66e03254 uses a 24px
                // inline inset inside the desktop sidebar divider.
                assert.deepEqual(measured.heading, [24, 16, 239, 56]);
            } else {
                assert.deepEqual(measured.heading.slice(0, 2), [
                    60,
                    width === 375 ? 8 : 16,
                ]);
            }
            const titleLayout = await heading.evaluate((node) => {
                const range = document.createRange();
                range.selectNodeContents(node);
                const lines = [...range.getClientRects()].map(
                    ({ x, y, width, height }) => [x, y, width, height]
                );
                const style = getComputedStyle(node.closest('header'));
                return {
                    lines,
                    headerPadding: [
                        style.paddingTop,
                        style.paddingInlineStart,
                        style.paddingInlineEnd,
                    ],
                };
            });
            assert.equal(titleLayout.lines.length, width === 1023 ? 1 : 2);
            await header.screenshot({
                path: join(output, `${label}-sidebar-title-${width}.png`),
            });
            wrappedTitleCases.push({
                width,
                heading: measured.heading,
                titleFont: measured.titleFont,
                ...titleLayout,
            });
        }
        const { cases: logoCases, drawerCases: logoDrawerCases } =
            await checkSidebarLogos(page, header, output, label);
        assert.deepEqual(errors, []);
        assert.deepEqual(refused, []);
        return {
            cases,
            wrappedTitleCases,
            logoCases,
            logoDrawerCases,
            errors,
            refused,
        };
    } finally {
        await context.close();
    }
}
