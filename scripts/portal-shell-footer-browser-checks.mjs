import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const readFixture = (path) =>
    readFileSync(new URL('../test/fixtures/' + path, import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Crop the archived 400×780 synthetic native capture at the coordinates below.
const nativeFrameSha256 =
    '42c742579539986f5f1e85674947e46209ab1b4825d6580d04d4da34b411d844';
const nativeCropSha256 =
    '5f9b400c16972bfd7d7a40720e87641e1e8fcc4f232b6fad94cc86a273262485';
const nativeRgbaSha256 =
    'c8db958fd18020d424dac3e5ec0412a1b0a7ffa4d9c28fb6929f90865650a27f';
const buttonCrop = { x: 152, y: 622, width: 36, height: 84 };
const fontSha256 =
    '3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62';
const font = readFixture('inter/inter-latin.woff2');
const logo = readFixture('image-annotation-64x32.png');
const styles = `
    @font-face {
        font-family: Inter;
        src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');
        font-weight: 100 900;
    }
    html { font: 16px Inter, sans-serif; }
    body { margin: 0; }
`;

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

async function measure(browser, assets, output, native, report, scenario) {
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
        forcedColors: 'none',
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
            '<!doctype html><html lang="en"><meta charset="utf-8"><div id="app"></div></html>'
        );
        page.on('framenavigated', (frame) => navigations.push(frame.url()));
        // Inline the ordinary consumer's installed-package bundle in an offline context.
        const css = Buffer.from(assets.get('/main.css'));
        const script = Buffer.from(assets.get('/main.js'));
        await page.addStyleTag({ content: css.toString('utf8') });
        await page.addStyleTag({ content: styles });
        await page.evaluate(() => {
            const proof = (window.footerProof = {
                clicks: [],
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
        });
        await page.addScriptTag({
            type: 'module',
            content: script.toString('utf8'),
        });
        await page.waitForFunction(() => window.fixtureCommittedSnapshot);
        await page.evaluate((patch) => window.configure(patch), {
            scope: 'synthetic-visitor',
            items: [],
            selection: null,
            header: { ...plain, ...scenario.header },
            user: { ...logout, ...scenario.user },
            searchAgainEnabled: scenario.searchAgainEnabled ?? false,
        });
        await page.waitForFunction(
            () => window.fixtureCommittedSnapshot?.scope === 'synthetic-visitor'
        );
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
                fontFamily: getComputedStyle(node).fontFamily,
                light: matchMedia('(prefers-color-scheme: light)').matches,
                forcedColors: matchMedia('(forced-colors: active)').matches,
                reducedMotion: matchMedia('(prefers-reduced-motion: reduce)')
                    .matches,
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
                buttonHovered: Boolean(button?.matches(':hover')),
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
            const capturedCrop = await page.screenshot({
                path: join(output, 'plain-400-button.png'),
                clip: buttonCrop,
                animations: 'disabled',
                scale: 'css',
            });
            const pixels = await page.evaluate(
                async ({ images, size }) => {
                    const canvas = document.createElement('canvas');
                    canvas.width = size.width;
                    canvas.height = size.height;
                    const context = canvas.getContext('2d');
                    const crops = [];
                    for (const png of images) {
                        const image = new Image();
                        image.src = 'data:image/png;base64,' + png;
                        await image.decode();
                        if (
                            image.naturalWidth !== size.width ||
                            image.naturalHeight !== size.height
                        )
                            throw new Error(
                                'Unexpected button crop dimensions'
                            );
                        context.clearRect(0, 0, size.width, size.height);
                        context.drawImage(image, 0, 0);
                        const rgba = context.getImageData(
                            0,
                            0,
                            size.width,
                            size.height
                        );
                        crops.push(Array.from(rgba.data));
                    }
                    return crops;
                },
                {
                    images: [native, capturedCrop].map((png) =>
                        png.toString('base64')
                    ),
                    size: buttonCrop,
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
                nativeFrameSha256,
                nativeCropSha256,
                installedCropSha256: sha256(capturedCrop),
                crop: buttonCrop,
                nativeRgbaSha256: sha256(nativePixels),
                sdkRgbaSha256: sha256(sdkPixels),
                differingPixels,
            };
        }
        const proof = await page.evaluate(() => ({
            ...window.footerProof,
            intents: window.proof.intents,
            reads: window.proof.reads,
            writes: window.proof.storage,
        }));
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

function assertMeasurements(report) {
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
                reads: [],
                writes: [],
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
        assert.equal(measured.fontFamily, 'Inter, sans-serif');
        assert(measured.fontLoaded);
        assert(
            measured.light && !measured.forcedColors && measured.reducedMotion
        );
        assert.equal(measured.confirmationDialogs, 0);
        assert.equal(measured.buttonFocused, false);
        assert.equal(measured.buttonHovered, false);
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
}

export async function checkPortalShellFooterGeometry(
    browser,
    assets,
    output,
    provenance
) {
    const report = {
        ...provenance,
        chrome: browser.version(),
        platform: process.platform,
        fontSha256: sha256(font),
        nativeComparison: null,
        closedContexts: 0,
        measurements: {},
    };
    mkdirSync(output, { recursive: true });
    try {
        const native = readFixture('portal-shell-native-logout-400-crop.png');
        assert.equal(
            sha256(native),
            nativeCropSha256,
            'Native crop PNG digest'
        );
        assert.equal(report.fontSha256, fontSha256, 'Inter font digest');
        for (const scenario of cases)
            report.measurements[scenario.name] = await measure(
                browser,
                assets,
                output,
                native,
                report,
                scenario
            );
        assert.equal(
            report.nativeComparison.nativeRgbaSha256,
            nativeRgbaSha256,
            'Decoded native crop digest'
        );
        assert.equal(
            report.nativeComparison.differingPixels,
            0,
            'Native padded button crop differing pixels'
        );
        assertMeasurements(report);
        report.outcome = 'passed';
    } catch (error) {
        report.outcome = 'failed';
        report.failure = error.message;
        throw error;
    } finally {
        writeFileSync(
            join(output, 'result.json'),
            JSON.stringify(report, null, 2) + '\n'
        );
    }
}
