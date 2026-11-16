import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    mkdtempSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
    rmSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { chromium } from 'playwright';
import { assertBrowserInputs } from './package-checks.mjs';

const output = resolve(process.argv[2] ?? 'dist/portal-shell-browser');
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'sdk-portal-shell-browser-'));
const run = (args, cwd = temporary) =>
    execFileSync('npm', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
    });
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = {
    scope: 'Installed public SDK with synthetic host; not native/deployment acceptance',
    host: hostname(),
    head: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
    }).trim(),
    profiles: [],
};
let browser, server;
async function configuredPresentation(browser, origin, label) {
    const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
    });
    const errors = [],
        external = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === origin)
            return route.continue();
        external.push(route.request().url());
        return route.abort();
    });
    const configure = (patch) =>
        page.evaluate((patch) => window.configure(patch), patch);
    try {
        await page.goto(origin);
        await page
            .getByRole('heading', { name: '<Customer Portal>' })
            .waitFor();
        await configure({
            header: {
                layout: 'sidebar',
                title: 'Configured Portal',
                actionsPlacement: 'layout',
                descriptionHtml: Array.from(
                    { length: 10 },
                    (_, i) => `<p>Owned description line ${i}</p>`
                ).join(''),
                descriptionOptions: {
                    placement: 'navigation',
                    truncate: true,
                    resetKey: 'portal',
                },
            },
            user: {
                name: 'Configured member',
                settingsEnabled: true,
                logoutEnabled: true,
                presentation: 'text',
            },
        });
        const footer = page.locator(
            '.mx-sdk-portal-navigation > .mx-sdk-portal-actions'
        );
        await footer.getByRole('button', { name: 'Search again' }).waitFor();
        assert.equal(await page.locator('.mx-sdk-portal-actions').count(), 1);
        await page.evaluate(() => {
            window.configuredBody = document.querySelector('article');
        });
        await page.getByRole('button', { name: 'Read more' }).click();
        await page.getByRole('button', { name: 'Show less' }).waitFor();
        await page.setViewportSize({ width: 1023, height: 800 });
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await footer.getByRole('button', { name: 'Search again' }).waitFor();
        await page.getByRole('button', { name: 'Show less' }).waitFor();
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 1024, height: 800 });
        await page.getByRole('button', { name: 'Show less' }).waitFor();
        assert.equal(
            await page
                .getByRole('button', { name: 'Open navigation' })
                .isVisible(),
            false
        );
        assert.equal(
            await page.evaluate(
                () =>
                    window.configuredBody === document.querySelector('article')
            ),
            true
        );
        await configure({ hideMenuItems: true });
        await footer.getByRole('button', { name: 'Search again' }).waitFor();
        assert.equal(
            await page.locator('.mx-sdk-portal-menu button').count(),
            0
        );
        await configure({ items: [], hideMenuItems: false });
        await footer.getByRole('button', { name: 'Search again' }).waitFor();
        await page.getByRole('button', { name: 'Show less' }).waitFor();
        await page.evaluate(() =>
            window.configure({
                items: window.fixtureItems,
                header: {
                    layout: 'topbar',
                    title: 'Configured Portal',
                    actionsPlacement: 'layout',
                },
            })
        );
        await page.setViewportSize({ width: 640, height: 800 });
        await page
            .locator('.mx-sdk-portal-header > .mx-sdk-portal-actions')
            .getByRole('button', { name: 'Search again' })
            .waitFor();
        assert.equal(
            await page
                .getByRole('button', { name: 'Open navigation' })
                .isVisible(),
            false
        );
        assert.equal(
            await page
                .locator('.mx-sdk-portal-navigation-wrap')
                .evaluate((node) => getComputedStyle(node).position),
            'static'
        );
        await page.setViewportSize({ width: 639, height: 800 });
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await footer.getByRole('button', { name: 'Search again' }).waitFor();
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 1280, height: 900 });
        await configure({
            user: {
                name: 'Configured member',
                presentation: 'text',
                settingsEnabled: true,
                logoutEnabled: false,
            },
        });
        const direct = page.locator('.mx-sdk-portal-user-direct');
        await direct.waitFor();
        assert.equal(await direct.textContent(), 'Configured member');
        await direct.click();
        await configure({
            user: {
                name: 'Configured member',
                presentation: 'text',
                settingsEnabled: false,
                logoutEnabled: true,
            },
        });
        const directLogout = page.getByRole('button', {
            name: 'Log out',
            exact: true,
        });
        await directLogout.locator('svg').waitFor();
        await directLogout.click();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(
            await page.evaluate(
                () =>
                    window.proof.intents.filter((i) => i.type === 'logout')
                        .length
            ),
            0
        );
        await configure({
            user: {
                name: 'Configured member',
                presentation: 'icon',
                settingsEnabled: true,
                logoutEnabled: true,
            },
        });
        const menu = page.locator('.mx-sdk-portal-user');
        await menu.locator('summary').click();
        await menu
            .getByRole('button', { name: 'Log out', exact: true })
            .click();
        await page.getByRole('dialog').waitFor();
        await page.evaluate(() => {
            window.ownerA = window.fixtureSnapshot;
            window.publishSnapshot({
                ...window.ownerA,
                user: { ...window.ownerA.user, logoutEnabled: false },
            });
        });
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        await page.waitForFunction(
            () => window.fixtureCommittedSnapshot !== window.ownerA
        );
        await page.evaluate(() => window.publishSnapshot(window.ownerA));
        await page.waitForFunction(
            () => window.fixtureCommittedSnapshot === window.ownerA
        );
        assert.equal(
            await page.getByRole('dialog').count(),
            0,
            'Committed A-B-A cannot revive a confirmation'
        );
        await menu.locator('summary').click();
        await menu
            .getByRole('button', { name: 'Log out', exact: true })
            .click();
        await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Log out', exact: true })
            .click();
        assert.equal(
            await page.evaluate(
                () =>
                    window.proof.intents.filter((i) => i.type === 'logout')
                        .length
            ),
            1
        );
        assert.equal(
            await page.evaluate(
                () =>
                    window.proof.intents.filter(
                        (i) => i.type === 'user-settings'
                    ).length
            ),
            1
        );
        await configure({
            header: {
                layout: 'sidebar',
                title: '',
                actionsPlacement: 'layout',
                descriptionHtml: '<p>Authoring description</p>',
                descriptionOptions: { placement: 'navigation' },
            },
            settings: {
                title: 'Edit title',
                description: 'Edit description',
                profile: 'Edit profile',
                items: [
                    { itemId: 'orders', label: 'Edit orders' },
                    { itemId: 'docs', label: 'Edit docs' },
                    { itemId: 'guide', label: 'Edit guide' },
                    { itemId: 'missing', label: 'Edit missing' },
                ],
            },
        });
        const titleGear = page.getByRole('button', {
            name: 'Edit title',
            exact: true,
        });
        await titleGear.focus();
        await page.keyboard.press('Enter');
        const box = await titleGear.boundingBox();
        assert(box && box.width <= 32 && box.height <= 32);
        for (const name of ['Edit description', 'Edit profile'])
            await page.getByRole('button', { name, exact: true }).click();
        const ordersGears = page.getByRole('button', {
            name: 'Edit orders',
            exact: true,
        });
        await ordersGears.last().click();
        const orderSummary = page
            .locator('summary')
            .filter({ hasText: /^Orders$/ });
        assert.equal(
            await orderSummary.evaluate((node) => node.parentElement.open),
            false
        );
        await orderSummary.click();
        await ordersGears.first().click();
        assert.equal(
            await orderSummary.evaluate((node) => node.parentElement.open),
            true
        );
        const resources = page
            .locator('summary')
            .filter({ hasText: /^Resources$/ });
        await resources.click();
        await page
            .getByRole('button', { name: 'Edit docs', exact: true })
            .click();
        await page
            .getByRole('button', { name: 'Edit guide', exact: true })
            .click();
        assert.equal(
            await resources.evaluate((node) => node.parentElement.open),
            true
        );
        assert.equal(
            await page.getByRole('button', { name: 'Edit missing' }).count(),
            0
        );
        assert.deepEqual(
            await page.evaluate(() =>
                window.proof.settings.map((request) => request.target)
            ),
            [
                { type: 'title' },
                { type: 'description' },
                { type: 'profile' },
                { type: 'item', itemId: 'orders' },
                { type: 'item', itemId: 'orders' },
                { type: 'item', itemId: 'docs' },
                { type: 'item', itemId: 'guide' },
            ]
        );
        assert.equal(await page.evaluate(() => window.proof.intents.length), 2);
        await configure({ settings: undefined });
        assert.equal(await page.locator('.mx-sdk-portal-settings').count(), 0);
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        return {
            sidebar1023And1024: 'passed',
            topbar639And640: 'passed',
            emptyAndHiddenMenus: 'passed',
            descriptionExpansion: 'passed',
            directActions: 'passed',
            committedLogoutRetirement: 'passed',
            authoringMouseKeyboardTargetsAndZeroNavigation: 'passed',
            cleanup: 'completed',
        };
    } catch (error) {
        await page
            .screenshot({
                path: join(output, `configured-${label}.png`),
                fullPage: true,
            })
            .catch(() => {});
        throw error;
    } finally {
        await page.close();
    }
}
try {
    let archive;
    if (process.env.SDK_NATIVE_PACKAGE_DIR) {
        const root = resolve(process.env.SDK_NATIVE_PACKAGE_DIR),
            names = readdirSync(root).filter((name) => name.endsWith('.tgz'));
        assert.equal(names.length, 1);
        archive = join(root, names[0]);
        assert.equal(
            digest(readFileSync(archive)),
            JSON.parse(readFileSync(join(root, 'artifact-receipt.json')))
                .package.sha256
        );
    } else {
        const packed = JSON.parse(
            run(
                [
                    'pack',
                    '--ignore-scripts',
                    '--json',
                    '--pack-destination',
                    temporary,
                ],
                process.cwd()
            )
        )[0];
        archive = join(temporary, packed.filename);
    }
    report.packageSha256 = digest(readFileSync(archive));
    const assets = new Map();
    server = createServer((request, response) => {
        const path = new URL(request.url, 'http://localhost').pathname;
        if (path === '/') {
            response.setHeader('content-type', 'text/html');
            response.end(
                '<!doctype html><html lang="en"><meta charset="utf-8"><title>Portal shell synthetic consumer</title><link rel="stylesheet" href="/main.css"><style>body{margin:0;font:16px system-ui}</style><div id="app"></div><script type="module" src="/main.js"></script></html>'
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
    report.localhostURL = origin;
    browser = await chromium.launch({
        ...(process.env.SDK_NATIVE_CHROMIUM
            ? { executablePath: process.env.SDK_NATIVE_CHROMIUM }
            : { channel: 'chrome' }),
        headless: true,
        chromiumSandbox: true,
    });
    report.chrome = browser.version();
    for (const react of ['18.3.1', '19.2.0']) {
        const directory = join(temporary, react);
        mkdirSync(directory);
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({ private: true, type: 'module' })
        );
        run(
            [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
                archive,
                `react@${react}`,
                `react-dom@${react}`,
            ],
            directory
        );
        for (const format of ['esm', 'cjs']) {
            let fixture = readFileSync(
                new URL('./portal-shell-browser-fixture.mjs', import.meta.url),
                'utf8'
            );
            if (format === 'cjs')
                fixture = ts.transpileModule(fixture, {
                    compilerOptions: {
                        target: ts.ScriptTarget.ES2022,
                        module: ts.ModuleKind.CommonJS,
                        esModuleInterop: true,
                    },
                }).outputText;
            const entry = format === 'cjs' ? 'main.cjs' : 'main.mjs';
            writeFileSync(join(directory, entry), fixture);
            const bundled = await build({
                absWorkingDir: directory,
                entryPoints: [entry],
                bundle: true,
                platform: 'browser',
                format: 'esm',
                target: 'es2022',
                outdir: join(directory, 'bundle'),
                write: false,
                metafile: true,
                minify: true,
                define: { 'process.env.NODE_ENV': '"production"' },
            });
            await assertBrowserInputs(bundled.metafile, directory);
            assert(
                Object.keys(bundled.metafile.inputs).some((name) =>
                    name.includes(
                        `/sdk/dist/${format}/react/CompletePortalShell.js`
                    )
                ),
                'Must execute the installed selected module format'
            );
            for (const file of bundled.outputFiles)
                assets.set(
                    '/' +
                        file.path
                            .split('/')
                            .at(-1)
                            .replace(/main\.(cjs|mjs)\./, 'main.'),
                    file.contents
                );
            const context = await browser.newContext({
                viewport: { width: 1440, height: 1000 },
            });
            const errors = [],
                external = [];
            const page = await context.newPage();
            page.on('pageerror', (error) => errors.push(error.message));
            await context.route('https://example.test/**', async (route) => {
                external.push(route.request().url());
                await route.fulfill({
                    contentType: 'text/html',
                    body: '<h1>Synthetic external destination</h1>',
                });
            });
            const button = (text) =>
                page.getByRole('button', { name: text, exact: true });
            const summary = (text) =>
                page.locator('summary').filter({ hasText: text });
            const counts = () =>
                page.evaluate(() => ({
                    intents: window.proof.intents.length,
                    storage: window.proof.storage.length,
                    reads: window.proof.reads.length,
                }));
            const configure = async (patch) => {
                await page.evaluate((patch) => window.configure(patch), patch);
                await page.waitForTimeout(50);
            };
            try {
                await page.goto(origin);
                await page
                    .getByRole('heading', { name: '<Customer Portal>' })
                    .waitFor();
                assert.deepEqual(await counts(), {
                    intents: 0,
                    storage: 0,
                    reads: 0,
                });
                assert.equal(
                    await page.evaluate(() => window.unsafe),
                    undefined
                );
                const beforeHeader = await counts();
                await configure({
                    header: {
                        layout: 'sidebar',
                        title: 'Plain header fallback',
                        titleHtml:
                            '<h1>Owned HTML heading</h1><script>window.unsafe=true</script>',
                    },
                });
                const richHeading = page.getByRole('heading', {
                    name: 'Owned HTML heading',
                });
                await richHeading.waitFor();
                assert.equal(
                    await richHeading.evaluate(
                        (node) => getComputedStyle(node).fontSize
                    ),
                    '24px'
                );
                assert.equal(
                    await page.locator('.mx-sdk-portal-title').count(),
                    0
                );
                assert.equal(
                    await page.getByText('Plain header fallback').count(),
                    0
                );
                assert.equal(
                    await page.evaluate(() => window.unsafe),
                    undefined
                );
                for (const titleHtml of [
                    '',
                    '<script>window.unsafe=true</script>',
                ]) {
                    await configure({
                        header: {
                            layout: 'sidebar',
                            title: 'Plain header fallback',
                            titleHtml,
                        },
                    });
                    assert.equal(
                        await page
                            .locator('.mx-sdk-portal-brand')
                            .textContent(),
                        ''
                    );
                }
                await configure({
                    header: {
                        layout: 'sidebar',
                        title: '<Customer Portal>',
                        descriptionHtml: '<p>Owned SDK shell</p>',
                    },
                });
                assert.equal(
                    await page
                        .locator('.mx-sdk-portal-title')
                        .evaluate((node) => getComputedStyle(node).fontSize),
                    '20px'
                );
                assert.deepEqual(await counts(), beforeHeader);
                await page.evaluate(() => window.enableSidebarResize(true));
                await configure({
                    header: {
                        layout: 'sidebar',
                        title: '<Customer Portal>',
                        sidebarWidth: 384,
                    },
                });
                const separator = page.getByRole('separator', {
                    name: 'Resize sidebar',
                });
                await separator.waitFor();
                const measuredSidebar = () =>
                    page
                        .locator('main')
                        .evaluate((node) => node.getBoundingClientRect().left);
                assert.equal(await measuredSidebar(), 384);
                await page.evaluate(() => {
                    window.resizeBody = document.querySelector('main article');
                });
                const drag = async (target, beforeRelease) => {
                    const bounds = await separator.boundingBox();
                    assert(bounds);
                    await page.mouse.move(
                        bounds.x + bounds.width / 2,
                        bounds.y + 30
                    );
                    await page.mouse.down();
                    await page.mouse.move(target, bounds.y + 30, { steps: 4 });
                    if (beforeRelease) await beforeRelease();
                    await page.mouse.up();
                    await page.waitForTimeout(50);
                };
                await drag(484, async () => {
                    assert.equal(await measuredSidebar(), 484);
                    assert.equal(
                        await page.evaluate(
                            () => window.proof.sidebarWidths.length
                        ),
                        0
                    );
                });
                assert.equal(await measuredSidebar(), 484);
                await drag(1300);
                assert.equal(await measuredSidebar(), 600);
                await drag(0);
                assert.equal(await measuredSidebar(), 120);
                await separator.focus();
                await page.keyboard.press('Home');
                await page.keyboard.press('End');
                await page.keyboard.press('ArrowLeft');
                assert.equal(await measuredSidebar(), 590);
                assert.equal(
                    await page.evaluate(
                        () => window.proof.sidebarWidths.length
                    ),
                    6
                );
                assert.equal(
                    await page.evaluate(
                        () =>
                            window.resizeBody ===
                            document.querySelector('main article')
                    ),
                    true
                );
                await drag(500, async () => {
                    await configure({
                        header: {
                            layout: 'sidebar',
                            title: '<Customer Portal>',
                            sidebarWidth: 300,
                        },
                    });
                });
                assert.equal(await measuredSidebar(), 300);
                assert.equal(
                    await page.evaluate(
                        () => window.proof.sidebarWidths.length
                    ),
                    6,
                    'New revision retires an allocated drag'
                );
                await drag(400, async () => {
                    await page.evaluate(() =>
                        window.enableSidebarResize(false)
                    );
                    await page.waitForTimeout(50);
                    assert.equal(await measuredSidebar(), 300);
                });
                assert.equal(
                    await page.evaluate(
                        () => window.proof.sidebarWidths.length
                    ),
                    6
                );
                await page.setViewportSize({ width: 390, height: 844 });
                await page.evaluate(() => window.enableSidebarResize(true));
                await page.waitForTimeout(50);
                assert.equal(await separator.count(), 0);
                await page.setViewportSize({ width: 1440, height: 1000 });
                await page.evaluate(() => window.enableSidebarResize(false));
                await configure({
                    header: {
                        layout: 'sidebar',
                        title: '<Customer Portal>',
                        descriptionHtml: '<p>Owned SDK shell</p>',
                    },
                });
                assert.deepEqual(await counts(), beforeHeader);
                await summary('Orders').click();
                await button('Done orders').hover();
                await button('Done orders').focus();
                assert.deepEqual(await counts(), {
                    intents: 0,
                    storage: 0,
                    reads: 0,
                });
                await button('Done orders').click();
                await page.getByText('Selected: orders/done').waitFor();
                assert.deepEqual(await counts(), {
                    intents: 1,
                    storage: 1,
                    reads: 1,
                });
                await button('Done orders').click();
                assert.deepEqual(await counts(), {
                    intents: 1,
                    storage: 1,
                    reads: 1,
                });
                await page.evaluate(() => window.remount());
                await page.getByText('Selected: orders/done').waitFor();
                await summary('Resources').click();
                await button('Guide').click();
                await page.locator('iframe').waitFor();
                assert.equal(
                    await page.locator('iframe').getAttribute('src'),
                    'https://example.test/guide'
                );
                assert.deepEqual(await counts(), {
                    intents: 2,
                    storage: 2,
                    reads: 1,
                });
                await button('People').click();
                await page.getByText('Selected: people/').waitFor();
                assert.equal(await page.locator('iframe').count(), 0);
                const popupPromise = context.waitForEvent('page');
                await page.getByRole('link', { name: 'Documentation' }).click();
                const popup = await popupPromise;
                await popup.waitForLoadState();
                assert.equal(await popup.evaluate(() => window.opener), null);
                await popup.close();
                assert.deepEqual(await counts(), {
                    intents: 3,
                    storage: 3,
                    reads: 1,
                });
                await page.screenshot({
                    path: join(output, `${react}-${format}-sidebar.png`),
                    fullPage: true,
                });
                await configure({
                    header: { layout: 'topbar', title: 'Portal' },
                });
                await page.locator('.mx-sdk-portal-shell--topbar').waitFor();
                await summary('Orders').click();
                await button('Open orders').click();
                await page.getByText('Selected: orders/open').waitFor();
                assert.equal(
                    await summary('Orders').evaluate(
                        (node) => node.parentElement.open
                    ),
                    false
                );
                assert.equal(
                    await page.evaluate(
                        () => document.activeElement.textContent
                    ),
                    'Orders'
                );
                await summary('Orders').click();
                await page
                    .getByRole('heading', { name: 'Host collection' })
                    .click();
                assert.equal(
                    await summary('Orders').evaluate(
                        (node) => node.parentElement.open
                    ),
                    false
                );
                await page.setViewportSize({ width: 390, height: 844 });
                await button('Open navigation').waitFor();
                await button('Open navigation').click();
                await page
                    .getByRole('dialog', { name: 'Portal navigation' })
                    .waitFor();
                assert.equal(
                    await page.evaluate(
                        () => document.activeElement.textContent
                    ),
                    'Close navigation'
                );
                await summary('Orders').click();
                await button('Done orders').click();
                await page.getByText('Selected: orders/done').waitFor();
                assert.equal(await page.getByRole('dialog').count(), 0);
                assert.equal(
                    await page.evaluate(
                        () => document.activeElement.textContent
                    ),
                    'Open navigation'
                );
                await button('Open navigation').click();
                await page.keyboard.press('End');
                assert.match(
                    await page.evaluate(
                        () => document.activeElement.textContent
                    ),
                    /Resources/
                );
                await page.keyboard.press('Escape');
                await button('Open navigation').waitFor();
                await configure({
                    header: {
                        layout: 'sidebar',
                        title: 'Hidden title',
                        hidden: true,
                    },
                });
                await button('Open navigation').click();
                assert.equal(
                    await page
                        .getByRole('heading', { name: 'Hidden title' })
                        .count(),
                    0
                );
                assert.equal(await summary('Resources').count(), 0);
                await button('Guide').waitFor();
                await page.screenshot({
                    path: join(output, `${react}-${format}-mobile-hidden.png`),
                    fullPage: true,
                });
                await page.keyboard.press('Escape');
                await configure({
                    welcome: {
                        id: 'welcome',
                        title: 'Welcome',
                        messageHtml: '<p>Hello, synthetic user</p>',
                        dismissed: false,
                    },
                });
                await page.getByRole('dialog', { name: 'Welcome' }).waitFor();
                await button('Continue').click();
                await page.getByRole('dialog').waitFor({ state: 'hidden' });
                assert.deepEqual(
                    await page.evaluate(() => window.proof.dismissals),
                    ['welcome']
                );
                await page.evaluate(() => window.remount());
                await page.waitForTimeout(50);
                assert.equal(await page.getByRole('dialog').count(), 0);
                await summary('Synthetic user').click();
                await button('User settings').click();
                assert.equal(
                    await page.evaluate(
                        () => document.activeElement.textContent
                    ),
                    'Synthetic user'
                );
                await summary('Synthetic user').click();
                await button('User settings').click();
                assert.equal(
                    await page.evaluate(
                        () =>
                            window.proof.intents.filter(
                                (intent) => intent.type === 'user-settings'
                            ).length
                    ),
                    2
                );
                await summary('Synthetic user').click();
                await button('Log out').click();
                await button('Cancel').click();
                assert.equal(
                    await page.evaluate(
                        () => document.activeElement.textContent
                    ),
                    'Synthetic user'
                );
                assert.equal(
                    await page.evaluate(
                        () =>
                            window.proof.intents.filter(
                                (intent) => intent.type === 'logout'
                            ).length
                    ),
                    0
                );
                await summary('Synthetic user').click();
                await button('Log out').click();
                await page
                    .getByRole('dialog')
                    .getByRole('button', { name: 'Log out', exact: true })
                    .click();
                assert.equal(
                    await page.evaluate(
                        () =>
                            window.proof.intents.filter(
                                (intent) => intent.type === 'logout'
                            ).length
                    ),
                    1
                );
                await page.emulateMedia({ forcedColors: 'active' });
                await button('Open navigation').focus();
                await page.keyboard.press('Tab');
                await page.keyboard.press('Shift+Tab');
                assert.equal(
                    await button('Open navigation').evaluate(
                        (node) => getComputedStyle(node).outlineStyle
                    ),
                    'solid'
                );
                assert.equal(await button('Open navigation').isVisible(), true);
                await page.screenshot({
                    path: join(output, `${react}-${format}-forced-colors.png`),
                    fullPage: true,
                });
                assert.deepEqual(errors, []);
                assert.equal(
                    await page.evaluate(
                        () => localStorage.length + sessionStorage.length
                    ),
                    0
                );
                assert(
                    await page
                        .locator('.mx-sdk-portal-content')
                        .evaluate(
                            (node) => node.getBoundingClientRect().width > 0
                        )
                );
                const lateMenu = await context.newPage();
                try {
                    await lateMenu.setViewportSize({ width: 390, height: 844 });
                    await lateMenu.addInitScript(() => {
                        window.startEmpty = true;
                    });
                    await lateMenu.goto(origin);
                    await lateMenu.getByRole('status').waitFor();
                    await lateMenu.evaluate(() =>
                        window.configure({
                            items: [
                                ...window.fixtureItems,
                                {
                                    type: 'group',
                                    id: 'outer',
                                    label: 'Outer',
                                    items: [
                                        {
                                            type: 'group',
                                            id: 'inner',
                                            label: 'Inner',
                                            items: [
                                                {
                                                    type: 'table',
                                                    id: 'deep',
                                                    label: 'Deep',
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        })
                    );
                    await lateMenu
                        .getByRole('button', {
                            name: 'Open navigation',
                            exact: true,
                        })
                        .click();
                    await lateMenu
                        .getByRole('dialog', { name: 'Portal navigation' })
                        .waitFor();
                    await lateMenu.keyboard.press('End');
                    assert.equal(
                        await lateMenu.evaluate(
                            () => document.activeElement.textContent
                        ),
                        'Outer'
                    );
                    await lateMenu.keyboard.press('Tab');
                    assert.equal(
                        await lateMenu.evaluate(
                            () => document.activeElement.textContent
                        ),
                        'Close navigation'
                    );
                    await lateMenu.keyboard.press('Escape');
                    assert.equal(await lateMenu.getByRole('dialog').count(), 0);
                } finally {
                    await lateMenu.close();
                }
                report.profiles.push({
                    react,
                    format,
                    ...(await counts()),
                    welcomeDismissals: 1,
                    logoutIntents: 1,
                    errors,
                    externalDestinations: external.length,
                    desktopMobileKeyboardAndForcedColors: 'passed',
                    sidebarEndOnlyBoundsRetirementAndBodyIdentity: 'passed',
                    configuredPresentation: await configuredPresentation(
                        browser,
                        origin,
                        `${react}-${format}`
                    ),
                });
            } catch (error) {
                await page.screenshot({
                    path: join(output, `${react}-${format}-failure.png`),
                    fullPage: true,
                });
                throw error;
            } finally {
                await context.close();
            }
        }
    }
    report.outcome = 'passed';
} finally {
    await browser?.close();
    if (server) await new Promise((done) => server.close(done));
    rmSync(temporary, { recursive: true, force: true });
    report.cleanup = 'completed';
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(report, null, 2) + '\n'
    );
}
console.log(JSON.stringify(report, null, 2));
