import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// node scripts/check-portal-shell-footer-geometry.mjs [output] [native-400.png]
const output = resolve(process.argv[2] ?? 'dist/portal-shell-footer-geometry');
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nativeDigest =
    '42c742579539986f5f1e85674947e46209ab1b4825d6580d04d4da34b411d844';
const native = process.argv[3] && readFileSync(process.argv[3]);
if (native) assert.equal(sha256(native), nativeDigest, 'Native reference PNG');

const shellCss = read('src/react/portal-shell.css');
const descriptionCss = read('src/react/html/html-description.css');
const font = read('test/fixtures/inter/inter-latin.woff2');
const logo = read('test/fixtures/image-annotation-64x32.png');
const styles = `
    @font-face {
        font-family: Inter;
        src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');
        font-weight: 100 900;
    }
    html { font: 16px Inter, sans-serif; }
    body { margin: 0; }
    ${shellCss}
    ${descriptionCss}
`;
const bundle = await build({
    stdin: {
        resolveDir: root,
        contents: `
            import { createElement as h } from 'react';
            import { createRoot } from 'react-dom/client';
            import { CompletePortalShell } from './src/react/CompletePortalShell.ts';

            createRoot(document.querySelector('#root')).render(
                h(CompletePortalShell, {
                    snapshot: window.fixture,
                    onIntent: intent => window.proof.intents.push(intent.type),
                }, h('h2', null, 'Fixture body'))
            );
        `,
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
});

const plain = {
    layout: 'sidebar',
    title: 'Synthetic Portal',
    showBrandInNavigation: true,
    sidebarToggle: 'icon',
    actionsPlacement: 'layout',
    menuInteraction: 'menu',
    sidebarWidth: 288,
};
const logout = {
    name: 'Synthetic visitor',
    presentation: 'text',
    settingsEnabled: false,
    logoutEnabled: true,
};
const rich = { titleHtml: '<p>Synthetic Portal</p>' };
const cases = [
    { name: 'plain-400', inset: 24 },
    { name: 'plain-375', width: 375, drawerWidth: 318.75, inset: 24 },
    { name: 'rich-400', inset: 24, header: rich, rich: true },
    {
        name: 'rich-375',
        width: 375,
        drawerWidth: 331,
        inset: 24,
        header: rich,
        rich: true,
    },
    { name: 'desktop', width: 1280, drawerWidth: 287, inset: 16 },
    { name: 'mixed', searchAgainEnabled: true },
    { name: 'icon', user: { presentation: 'icon' } },
    {
        name: 'profile',
        user: { settingsEnabled: true, logoutEnabled: false },
    },
    { name: 'account-menu', user: { settingsEnabled: true } },
    {
        name: 'logo-and-plain-title',
        header: { logoUrl: 'data:image/png;base64,' + logo.toString('base64') },
    },
    {
        name: 'html-title-with-description',
        header: { ...rich, descriptionHtml: '<p>About this Portal</p>' },
    },
];

const buttonCrop = { x: 156, y: 626, width: 28, height: 76 };
const browser = await chromium.launch({
    ...(process.env.SDK_NATIVE_CHROMIUM
        ? { executablePath: process.env.SDK_NATIVE_CHROMIUM }
        : { channel: 'chrome' }),
    headless: true,
    chromiumSandbox: true,
});
const report = {
    chrome: browser.version(),
    cssSha256: sha256(shellCss),
    fontSha256: sha256(font),
    nativeComparison: null,
    closedContexts: 0,
    measurements: {},
};

async function measure(scenario) {
    const { name, width = 400 } = scenario;
    const desktop = name === 'desktop';
    const viewport = { width, height: desktop ? 720 : 780 };
    const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        offline: true,
        serviceWorkers: 'block',
        locale: 'en-US',
        colorScheme: 'light',
        reducedMotion: 'reduce',
    });
    try {
        const requests = [];
        await context.route('**/*', (route) => {
            requests.push(route.request().url());
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const errors = [];
        const navigations = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.setContent(
            '<!doctype html><html lang="en"><div id="root"></div></html>'
        );
        page.on('framenavigated', (frame) => navigations.push(frame.url()));
        await page.addStyleTag({ content: styles });
        await page.evaluate(
            (fixture) => {
                window.fixture = fixture;
                const proof = (window.proof = {
                    clicks: [],
                    intents: [],
                    network: [],
                    submits: 0,
                });
                document.addEventListener(
                    'click',
                    (event) => {
                        const button = event.target.closest('button');
                        proof.clicks.push(button?.className ?? '');
                        if (!button?.matches('.mx-sdk-portal-toggle')) {
                            event.preventDefault();
                            event.stopImmediatePropagation();
                        }
                    },
                    true
                );
                document.addEventListener(
                    'submit',
                    (event) => {
                        event.preventDefault();
                        proof.submits++;
                    },
                    true
                );
                const reject = (label) => {
                    proof.network.push(label);
                    throw new Error('Unexpected ' + label);
                };
                window.fetch = () => reject('fetch');
                XMLHttpRequest.prototype.open = () => reject('xhr');
                navigator.sendBeacon = () => reject('beacon');
            },
            {
                scope: 'synthetic-visitor',
                revision: 1,
                items: [],
                selection: null,
                header: { ...plain, ...scenario.header },
                user: { ...logout, ...scenario.user },
                searchAgainEnabled: scenario.searchAgainEnabled ?? false,
            }
        );
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        if (!desktop)
            await page
                .getByRole('button', { name: 'Open navigation', exact: true })
                .click();
        const drawer = page.locator('.mx-sdk-portal-navigation');
        await drawer.waitFor({ state: 'visible' });
        const fontLoaded = await page.evaluate(async () => {
            await document.fonts.load('500 14px Inter');
            await document.fonts.ready;
            return [...document.fonts].some(
                (face) => face.family === 'Inter' && face.status === 'loaded'
            );
        });
        await page.waitForFunction(
            () =>
                !document
                    .getAnimations()
                    .some(
                        (animation) =>
                            animation.pending ||
                            animation.playState === 'running'
                    )
        );
        const bounds = await drawer.evaluate((node) => {
            const brand = node.querySelector(':scope > .mx-sdk-portal-brand');
            const footer = node.querySelector(
                ':scope > .mx-sdk-portal-actions'
            );
            const button = footer.querySelector(
                ':scope > .mx-sdk-portal-user-direct--logout-text'
            );
            const box = (element) => {
                if (!element) return null;
                const { left, top, right, bottom } =
                    element.getBoundingClientRect();
                return [left, top, right, bottom];
            };
            return {
                viewport: [innerWidth, innerHeight],
                dpr: devicePixelRatio,
                rootFont: getComputedStyle(document.documentElement).fontSize,
                drawer: box(node),
                rail: box(node.parentElement),
                footer: box(footer),
                button: box(button),
                icon: box(button?.querySelector('svg')),
                close: box(
                    node.querySelector(
                        ':scope > .mx-sdk-portal-navigation-close'
                    )
                ),
                buttonFocused:
                    button != null && document.activeElement === button,
                dialog: node.getAttribute('role') === 'dialog',
                rich: node.classList.contains(
                    'mx-sdk-portal-navigation--rich-title'
                ),
                title: Boolean(
                    brand?.querySelector(
                        ':scope > div > h1.mx-sdk-portal-title'
                    )
                ),
                htmlTitle: Boolean(
                    brand?.querySelector('.mx-sdk-portal-title-html')
                ),
                logo: Boolean(brand?.querySelector(':scope > img')),
                children: Array.from(
                    footer.children,
                    (child) => child.className
                ),
            };
        });
        const screenshot = await page.screenshot({
            path: join(output, name + '.png'),
            animations: 'disabled',
        });
        if (name === 'plain-400') {
            await page.screenshot({
                path: join(output, 'plain-400-button.png'),
                clip: buttonCrop,
            });
            if (native) {
                const pixels = await page.evaluate(
                    async ({ images, crop }) => {
                        const canvas = document.createElement('canvas');
                        canvas.width = crop.width;
                        canvas.height = crop.height;
                        const context = canvas.getContext('2d');
                        const crops = [];
                        for (const png of images) {
                            const image = new Image();
                            image.src = 'data:image/png;base64,' + png;
                            await image.decode();
                            context.clearRect(0, 0, crop.width, crop.height);
                            context.drawImage(image, -crop.x, -crop.y);
                            const rgba = context.getImageData(
                                0,
                                0,
                                crop.width,
                                crop.height
                            );
                            crops.push(Array.from(rgba.data));
                        }
                        return crops;
                    },
                    {
                        images: [native, screenshot].map((png) =>
                            png.toString('base64')
                        ),
                        crop: buttonCrop,
                    }
                );
                const [nativePixels, sdkPixels] = pixels.map((rgba) =>
                    Buffer.from(rgba)
                );
                let differingPixels = 0;
                for (let index = 0; index < nativePixels.length; index += 4) {
                    if (
                        nativePixels.readUInt32BE(index) !==
                        sdkPixels.readUInt32BE(index)
                    )
                        differingPixels++;
                }
                report.nativeComparison = {
                    nativePngSha256: nativeDigest,
                    crop: buttonCrop,
                    nativeRgbaSha256: sha256(nativePixels),
                    sdkRgbaSha256: sha256(sdkPixels),
                    differingPixels,
                };
            }
        }
        const proof = await page.evaluate(() => window.proof);
        return {
            ...bounds,
            fontLoaded,
            confirmationDialogs: await page
                .locator('.mx-sdk-portal-dialog')
                .count(),
            screenshotSha256: sha256(screenshot),
            proof,
            requests,
            errors,
            navigations,
        };
    } finally {
        await context.close();
        report.closedContexts++;
    }
}

mkdirSync(output, { recursive: true });
try {
    for (const scenario of cases)
        report.measurements[scenario.name] = await measure(scenario);

    for (const scenario of cases) {
        const {
            name,
            width = 400,
            drawerWidth = 340,
            inset = 16,
            rich = false,
        } = scenario;
        const measured = report.measurements[name];
        const desktop = name === 'desktop';
        const height = desktop ? 720 : 780;
        assert.deepEqual(
            measured.proof,
            {
                clicks: desktop ? [] : ['mx-sdk-portal-toggle'],
                intents: [],
                network: [],
                submits: 0,
            },
            name + ' activity'
        );
        for (const key of ['requests', 'errors', 'navigations'])
            assert.deepEqual(measured[key], [], name + ' ' + key);
        assert.deepEqual(measured.viewport, [width, height]);
        assert.equal(measured.dpr, 1);
        assert.equal(measured.rootFont, '16px');
        assert(measured.fontLoaded);
        assert.equal(measured.confirmationDialogs, 0);
        assert.equal(measured.buttonFocused, false);
        assert.equal(measured.dialog, !desktop);
        assert.equal(measured.rich, rich);
        assert.deepEqual(
            measured.drawer,
            [0, desktop ? 60 : 0, drawerWidth, height],
            name + ' drawer edges'
        );
        assert.deepEqual(
            measured.footer,
            [inset, height - 216, drawerWidth - inset, height - 16],
            name + ' footer edges'
        );
        const center = drawerWidth / 2;
        if (!scenario.user && !scenario.searchAgainEnabled) {
            assert.deepEqual(
                measured.button,
                [center - 14, height - 154, center + 14, height - 78],
                name + ' button edges'
            );
            assert.deepEqual(
                measured.icon,
                [center - 14, height - 130, center + 14, height - 102],
                name + ' icon edges'
            );
        }
        assert.deepEqual(
            measured.close,
            rich ? [drawerWidth, 0, drawerWidth + 44, 44] : null
        );
    }
    const measured = report.measurements;
    const textLogout =
        'mx-sdk-portal-user-direct mx-sdk-portal-user-direct--logout-text';
    assert.deepEqual(measured['plain-400'].children, [textLogout]);
    assert(measured['plain-400'].title);
    assert.deepEqual(measured.mixed.children, ['', textLogout]);
    assert.deepEqual(measured.icon.children, ['mx-sdk-portal-user-direct']);
    assert.deepEqual(measured.profile.children, [
        'mx-sdk-portal-user-direct mx-sdk-portal-user-direct--profile-text',
    ]);
    assert.deepEqual(measured['account-menu'].children, ['mx-sdk-portal-user']);
    assert(
        measured['logo-and-plain-title'].logo &&
            measured['logo-and-plain-title'].title
    );
    assert(
        measured['html-title-with-description'].htmlTitle &&
            !measured['html-title-with-description'].title
    );
    assert.equal(
        measured.desktop.rail[2],
        288,
        'Desktop outer rail right edge'
    );
    if (native)
        assert.equal(
            report.nativeComparison.differingPixels,
            0,
            'Native button crop'
        );
    report.outcome = 'passed';
} catch (error) {
    report.outcome = 'failed';
    report.failure = error.message;
    throw error;
} finally {
    await browser.close();
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(report, null, 2) + '\n'
    );
}
console.log(
    'Portal drawer footer geometry passed. ' + join(output, 'result.json')
);
