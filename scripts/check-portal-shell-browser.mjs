import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { execPackageFileSync } from './package-manager-launch.mjs';
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
import { basename, join, resolve } from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { chromium } from 'playwright';
import { assertBrowserInputs } from './package-checks.mjs';
import { checkNativeTopbar } from './portal-shell-topbar-browser-checks.mjs';
import { checkNativeSidebarOpener } from './portal-shell-sidebar-opener-browser-checks.mjs';

const output = resolve(process.argv[2] ?? 'dist/portal-shell-browser');
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'sdk-portal-shell-browser-'));
const run = (args, cwd = temporary) =>
    execPackageFileSync('npm', args, {
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
async function checkAccountMenuBorders(panel, expectedRowBorder) {
    const { popup, rows } = await panel.evaluate((node) => {
        const borders = (element) => {
            const style = getComputedStyle(element);
            return [
                style.borderTopWidth,
                style.borderRightWidth,
                style.borderBottomWidth,
                style.borderLeftWidth,
            ];
        };
        return {
            popup: borders(node),
            rows: Array.from(node.querySelectorAll(':scope > button'), borders),
        };
    });
    assert.deepEqual(popup, Array(4).fill('1px'));
    assert.deepEqual(rows, [
        Array(4).fill(expectedRowBorder),
        Array(4).fill(expectedRowBorder),
    ]);
}
async function checkDesktopAccountMenuInScrollingHost(
    page,
    trigger,
    panel,
    label
) {
    const host = await page.evaluateHandle(() => {
        const app = document.querySelector('#app');
        const host = document.createElement('div');
        host.dataset.accountScrollHost = 'true';
        host.style.cssText =
            'height:750px; overflow-y:auto; overflow-anchor:none';
        const spacer = document.createElement('div');
        spacer.style.height = '300px';
        app.before(host);
        host.append(app, spacer);
        app.querySelector(
            '.mx-sdk-portal-navigation > .mx-sdk-portal-actions'
        ).style.marginBlockEnd = '90px';
        host.scrollTop = 145;
        return host;
    });
    try {
        const measure = () =>
            panel.evaluate((element) => {
                const bounds = (node) => {
                    const { top, bottom, height } =
                        node.getBoundingClientRect();
                    return { top, bottom, height };
                };
                const host = element.closest('[data-account-scroll-host]');
                return {
                    scrollTop: host.scrollTop,
                    viewportHeight: window.innerHeight,
                    visibleBottom:
                        host.getBoundingClientRect().top + host.clientHeight,
                    trigger: bounds(element.previousElementSibling),
                    panel: bounds(element),
                    rows: Array.from(
                        element.querySelectorAll(':scope > button'),
                        bounds
                    ),
                    focused: document.activeElement.textContent,
                };
            });
        await trigger.press('ArrowDown');
        const before = await measure();
        assert.equal(before.scrollTop, 145);
        assert.ok(before.panel.top >= before.trigger.bottom);
        assert.ok(before.panel.bottom <= before.visibleBottom);
        await host.evaluate((node) => {
            node.scrollTop = 45;
        });
        try {
            await page.waitForFunction(
                () => {
                    const host = document.querySelector(
                        '[data-account-scroll-host]'
                    );
                    const panel = host?.querySelector(
                        '.mx-sdk-portal-user[open] > div'
                    );
                    return (
                        panel?.getBoundingClientRect().bottom <=
                        panel?.previousElementSibling.getBoundingClientRect()
                            .top
                    );
                },
                undefined,
                { timeout: 2500 }
            );
        } catch (error) {
            if (error.name !== 'TimeoutError') throw error;
        }
        const after = await measure();
        await page.screenshot({
            path: join(output, `account-menu-scroll-host-${label}-1280.png`),
        });
        assert.equal(after.scrollTop, 45);
        assert.equal(after.focused, 'User settings');
        assert.ok(after.trigger.bottom > before.trigger.bottom);
        assert.equal(after.rows.length, 2);
        assert.ok(
            after.trigger.bottom + after.panel.height > after.visibleBottom &&
                after.trigger.bottom + after.panel.height <
                    after.viewportHeight,
            'The outer scroller has a clipping edge inside the viewport'
        );
        assert.ok(
            after.panel.bottom <= after.trigger.top &&
                after.rows.every(
                    ({ top, bottom }) =>
                        top >= after.panel.top && bottom <= after.visibleBottom
                ),
            `Outer host scroll clips the open desktop account menu: ${JSON.stringify({ before, after })}`
        );
        await page.keyboard.press('Escape');
        assert.equal(await panel.isVisible(), false);
        assert.equal(
            await trigger.evaluate((node) => node === document.activeElement),
            true
        );
        return { before, after };
    } finally {
        await host.evaluate((node) => {
            const app = node.querySelector('#app');
            app.querySelector(
                '.mx-sdk-portal-navigation > .mx-sdk-portal-actions'
            ).style.removeProperty('margin-block-end');
            node.before(app);
            node.remove();
        });
        await host.dispose();
    }
}
async function checkFixedDesktopSidebarAccountMenu(
    page,
    trigger,
    panel,
    label
) {
    const style = await page.addStyleTag({
        content:
            '#app { height: 900px; font: 1rem/1.5 system-ui; } #app > .mx-sdk-portal-shell { height: 100%; min-height: 0; }',
    });
    try {
        await trigger.press('ArrowDown');
        const placement = await panel.evaluate((element) => {
            const bounds = (node) => {
                const { top, bottom, height } = node.getBoundingClientRect();
                return { top, bottom, height };
            };
            const navigation = element.closest('.mx-sdk-portal-navigation');
            const navigationTop =
                navigation.getBoundingClientRect().top + navigation.clientTop;
            const rows = Array.from(
                element.querySelectorAll(':scope > button')
            );
            return {
                viewportHeight: window.innerHeight,
                navigation: {
                    top: Math.max(0, navigationTop),
                    bottom: Math.min(
                        window.innerHeight,
                        navigationTop + navigation.clientHeight
                    ),
                },
                trigger: bounds(element.previousElementSibling),
                panel: bounds(element),
                rows: rows.map(bounds),
                focused: document.activeElement.textContent,
                pageScroll: window.scrollY,
            };
        });
        await page.screenshot({
            path: join(output, `account-menu-sidebar-${label}-1280.png`),
        });
        assert.equal(placement.viewportHeight, 900);
        assert.equal(placement.rows.length, 2);
        assert.ok(
            placement.panel.height >
                placement.navigation.bottom - placement.trigger.bottom,
            'The desktop sidebar fixture must leave too little room below the trigger'
        );
        assert.ok(
            placement.panel.bottom <= placement.trigger.top &&
                placement.panel.top >= placement.navigation.top &&
                placement.rows.every(
                    ({ top, bottom }) =>
                        top >= placement.panel.top &&
                        bottom <= placement.panel.bottom &&
                        bottom <= placement.navigation.bottom
                ),
            `First ArrowDown clips the desktop sidebar account menu: ${JSON.stringify(placement)}`
        );
        assert.equal(placement.focused, 'User settings');
        await page.keyboard.press('ArrowDown');
        assert.equal(
            await panel
                .getByRole('button', { name: 'Log out' })
                .evaluate((node) => node === document.activeElement),
            true
        );
        assert.equal(
            await page.evaluate(() => window.scrollY),
            placement.pageScroll
        );
        await page.keyboard.press('Escape');
        assert.equal(await panel.isVisible(), false);
        assert.equal(
            await trigger.evaluate((node) => node === document.activeElement),
            true
        );
        const outerScroll = await checkDesktopAccountMenuInScrollingHost(
            page,
            trigger,
            panel,
            label
        );
        return { ...placement, outerScroll };
    } finally {
        await style.evaluate((node) => node.remove());
    }
}
async function navigationCompatibility(browser, origin, label) {
    const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
    });
    const errors = [],
        external = [];
    const capturedUrl = 'https://example.test/__sdk_portal_captured__';
    let capturedRequests = 0;
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === origin)
            return route.continue();
        if (route.request().url() === capturedUrl) {
            capturedRequests++;
            return route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: '<!doctype html><title>Captured native iframe</title><p>Captured native content</p>',
            });
        }
        external.push(route.request().url());
        return route.abort();
    });
    try {
        await page.goto(origin);
        await page
            .getByRole('heading', { name: '<Customer Portal>' })
            .waitFor();
        await page.evaluate(() => {
            window.enableSelectionActivation(true);
            window.configure({
                selectionPolicy: 'host',
                header: {
                    layout: 'topbar',
                    actionsPlacement: 'layout',
                    title: 'Native menu proof',
                    menuInteraction: 'menu',
                },
                items: window.fixtureItems.map((item) =>
                    item.type === 'table' && item.views
                        ? {
                              ...item,
                              sidebarInitiallyExpanded: true,
                              views: item.views.map((view, index) => ({
                                  ...view,
                                  layout: index ? null : 'calendar',
                                  badge: index === 0,
                              })),
                          }
                        : item
                ),
                settings: {
                    items: [
                        {
                            itemId: 'orders',
                            label: 'Edit Orders settings',
                            includeViews: false,
                            visibleIn: 'sidebar',
                        },
                    ],
                },
            });
        });
        await page.waitForFunction(
            () =>
                window.fixtureCommittedSnapshot?.header.menuInteraction ===
                'menu'
        );
        const summary = page.locator('summary').filter({ hasText: /^Orders$/ });
        await summary.focus();
        await page.keyboard.press('ArrowDown');
        const openView = page.getByRole('button', {
            name: 'Open orders',
            exact: true,
        });
        assert.equal(
            await openView.evaluate((node) => node === document.activeElement),
            true
        );
        assert.equal(await page.evaluate(() => window.proof.hovers.length), 0);
        await page.keyboard.press('Tab');
        assert.equal(await openView.isVisible(), false);
        assert.equal(
            await page
                .getByRole('button', { name: 'People', exact: true })
                .evaluate((node) => node === document.activeElement),
            true
        );
        await summary.focus();
        await page.keyboard.press('ArrowUp');
        assert.equal(
            await page
                .getByRole('button', { name: 'Done orders', exact: true })
                .evaluate((node) => node === document.activeElement),
            true
        );
        await page.keyboard.press('Shift+Tab');
        assert.equal(await openView.isVisible(), false);
        assert.equal(
            await page
                .locator('.mx-sdk-portal-user > summary')
                .evaluate((node) => node === document.activeElement),
            true
        );
        assert.deepEqual(
            await page.evaluate(() => [
                window.proof.activations.length,
                window.proof.hovers.length,
                window.proof.intents.length,
            ]),
            [0, 0, 0]
        );
        await summary.focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.proof.activations.length === 1);
        await summary.press('Enter');
        await openView.waitFor();
        await openView.click();
        await page.waitForFunction(() => window.proof.activations.length === 3);
        assert.deepEqual(
            await page.evaluate(() =>
                window.proof.activations.map(
                    (request) => request.selection.viewId
                )
            ),
            ['open', null, 'open']
        );
        assert.deepEqual(
            await page.evaluate(() => ({
                intents: window.proof.intents.length,
                storage: window.proof.storage.length,
                reads: window.proof.reads.length,
            })),
            { intents: 3, storage: 3, reads: 0 }
        );
        await page.getByRole('heading', { name: 'Host collection' }).hover();
        const beforeHover = await page.evaluate(
            () => window.proof.hovers.length
        );
        await summary.hover();
        await openView.waitFor();
        await page.waitForFunction(
            (before) => window.proof.hovers.length > before,
            beforeHover
        );
        assert.deepEqual(
            await page.evaluate(() => {
                const r = window.proof.hovers.at(-1);
                return [r.itemId, r.viewId];
            }),
            ['orders', null]
        );
        await page.getByRole('heading', { name: 'Host collection' }).hover();
        assert.equal(await openView.isVisible(), false);
        assert.equal(
            await page
                .getByRole('button', { name: 'Edit Orders settings' })
                .count(),
            0
        );
        const user = page.locator('.mx-sdk-portal-user');
        const accountTrigger = user.locator('summary');
        const accountPanel = user.locator(':scope > div');
        const accountSettings = user.getByRole('button', {
            name: 'User settings',
            exact: true,
        });
        const accountLogout = user.getByRole('button', {
            name: 'Log out',
            exact: true,
        });
        await accountTrigger.click();
        await accountLogout.hover();
        assert.equal(
            await accountLogout.evaluate(
                (node) => getComputedStyle(node).backgroundColor
            ),
            'rgb(243, 244, 246)'
        );
        await accountTrigger.press('ArrowDown');
        await checkAccountMenuBorders(accountPanel, '0px');
        assert.deepEqual(
            await accountSettings.evaluate((node) => {
                const style = getComputedStyle(node);
                return [
                    node === document.activeElement,
                    style.outlineWidth,
                    style.outlineStyle,
                    style.backgroundColor,
                ];
            }),
            [true, '3px', 'solid', 'rgb(243, 244, 246)']
        );
        await page.keyboard.press('ArrowDown');
        assert.equal(
            await accountLogout.evaluate(
                (node) => node === document.activeElement
            ),
            true
        );
        await accountPanel.screenshot({
            path: join(output, `account-menu-${label}-1280.png`),
        });
        await page.keyboard.press('Escape');
        assert.equal(await accountPanel.isVisible(), false);
        assert.equal(
            await accountTrigger.evaluate(
                (node) => node === document.activeElement
            ),
            true
        );
        await page.setViewportSize({ width: 639, height: 800 });
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await openView.waitFor();
        assert.equal(
            await page.locator('.mx-sdk-portal-view-icon:visible').count(),
            2
        );
        assert.equal(
            await page.locator('.mx-sdk-portal-view-badge').count(),
            1
        );
        const gear = page.getByRole('button', {
            name: 'Edit Orders settings',
            exact: true,
        });
        assert.equal(await gear.count(), 1);
        await gear.focus();
        await page.keyboard.press('Enter');
        assert.equal(
            await page.evaluate(() => window.proof.settings.length),
            1
        );
        assert.equal(await page.evaluate(() => window.proof.storage.length), 3);
        await summary.click();
        assert.equal(await openView.isVisible(), false);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await openView.waitFor();
        await user.locator('summary').focus();
        await page.keyboard.press('ArrowDown');
        assert.equal(
            await user
                .getByRole('button', { name: 'User settings', exact: true })
                .evaluate((node) => node === document.activeElement),
            true
        );
        await page.keyboard.press('Tab');
        assert.equal(await user.evaluate((node) => node.open), false);
        assert.equal(await page.getByRole('dialog').count(), 1);
        assert.equal(
            await page
                .getByRole('dialog')
                .evaluate((node) => node.contains(document.activeElement)),
            true,
            'Account-menu Tab stays within the mobile drawer'
        );
        assert.equal(await page.evaluate(() => window.proof.intents.length), 3);
        await user.locator('summary').focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Escape');
        assert.equal(await user.evaluate((node) => node.open), false);
        assert.equal(
            await page.getByRole('dialog').count(),
            1,
            'Account-menu Escape preserves the mobile navigation dialog'
        );

        await page.setViewportSize({ width: 375, height: 900 });
        const accountActions = page.locator(
            '.mx-sdk-portal-navigation > .mx-sdk-portal-actions'
        );
        await accountActions.evaluate((node) => {
            node.style.marginBlockEnd = '128px';
        });
        await accountTrigger.press('ArrowDown');
        assert.equal(
            await accountPanel.evaluate(
                (node) =>
                    node.getBoundingClientRect().top >=
                    node.previousElementSibling.getBoundingClientRect().bottom
            ),
            true,
            'The account menu opens below when there is room'
        );
        await page.keyboard.press('Escape');
        await accountActions.evaluate((node) =>
            node.style.removeProperty('margin-block-end')
        );
        await accountTrigger.press('ArrowDown');
        const accountPlacement = await accountPanel.evaluate((panel) => {
            const bounds = (node) => {
                const { top, bottom } = node.getBoundingClientRect();
                return { top, bottom };
            };
            const navigation = panel.closest('.mx-sdk-portal-navigation');
            const top =
                navigation.getBoundingClientRect().top + navigation.clientTop;
            return {
                drawer: { top, bottom: top + navigation.clientHeight },
                panel: bounds(panel),
                logout: bounds(panel.querySelector('button:last-child')),
                focused: document.activeElement.textContent,
            };
        });
        const {
            drawer: drawerBounds,
            panel,
            logout,
            focused,
        } = accountPlacement;
        assert.ok(
            [panel, logout].every(
                ({ top, bottom }) =>
                    top >= drawerBounds.top && bottom <= drawerBounds.bottom
            ),
            `First ArrowDown clips the account menu: ${JSON.stringify(accountPlacement)}`
        );
        assert.equal(focused, 'User settings');
        await checkAccountMenuBorders(accountPanel, '0px');
        await page.screenshot({
            path: join(output, `account-menu-${label}-375.png`),
        });
        await page.keyboard.press('Escape');
        assert.equal(
            await accountTrigger.evaluate(
                (node) => node === document.activeElement
            ),
            true
        );
        await accountTrigger.click();
        await page.waitForFunction(() => {
            const panel = document.querySelector(
                '.mx-sdk-portal-user[open] > div'
            );
            const trigger = panel?.previousElementSibling;
            return (
                !!panel &&
                panel.getBoundingClientRect().bottom <=
                    trigger.getBoundingClientRect().top
            );
        });
        await page.keyboard.press('Escape');
        await openView.focus();
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('dialog').count(), 0);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.evaluate(() => {
            window.enableHostEditor(true);
            window.configure({
                header: { ...window.fixtureSnapshot.header, layout: 'sidebar' },
                searchAgainEnabled: false,
            });
        });
        const editor = page.getByRole('textbox', {
            name: 'Native record editor',
        });
        await editor.waitFor();
        const desktopSidebarAccountPlacement =
            await checkFixedDesktopSidebarAccountMenu(
                page,
                accountTrigger,
                accountPanel,
                label
            );
        await page.evaluate(() =>
            window.configure({ searchAgainEnabled: true })
        );
        await user.locator('summary').focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Tab');
        assert.equal(await user.evaluate((node) => node.open), false);
        assert.equal(
            await editor.evaluate((node) => node === document.activeElement),
            true
        );
        assert.equal(await page.evaluate(() => window.proof.intents.length), 3);
        // Native body controls keep their own single-class styles even when
        // the SDK stylesheet is loaded. Compare the real host child with an
        // identical control outside the shell, including keyboard focus.
        const hostStyle = await page.addStyleTag({
            content: `.fixture-native-action{box-sizing:border-box;font:14px monospace;color:rgb(255,255,255);background:rgb(20,70,130);border:2px solid rgb(9,40,80);border-radius:9px;padding:3px 5px;text-align:center}.fixture-native-action:focus-visible{outline:7px dotted rgb(180,30,90);outline-offset:1px}`,
        });
        await page.evaluate(() => {
            const original = document.querySelector('.fixture-native-action');
            const sibling = original.cloneNode(true);
            sibling.dataset.nativeStyleSibling = 'true';
            document.body.append(sibling);
        });
        const nativeAction = page.locator(
            '.mx-sdk-portal-content .fixture-native-action'
        );
        const siblingAction = page.locator('[data-native-style-sibling]');
        const hostAppearance = (node) => {
            const style = getComputedStyle(node);
            const bounds = node.getBoundingClientRect();
            return {
                color: style.color,
                background: style.backgroundColor,
                font: style.font,
                padding: style.padding,
                border: style.border,
                radius: style.borderRadius,
                align: style.textAlign,
                width: bounds.width,
                height: bounds.height,
            };
        };
        assert.deepEqual(
            await nativeAction.evaluate(hostAppearance),
            await siblingAction.evaluate(hostAppearance)
        );
        await nativeAction.focus();
        await page.keyboard.press('Tab');
        assert.equal(
            await siblingAction.evaluate(
                (node) => node === document.activeElement
            ),
            true
        );
        const hostFocus = (node) => {
            const style = getComputedStyle(node);
            return [style.outline, style.outlineOffset];
        };
        const siblingFocus = await siblingAction.evaluate(hostFocus);
        assert.match(siblingFocus[0], /7px/);
        await page.keyboard.press('Shift+Tab');
        assert.equal(
            await nativeAction.evaluate(
                (node) => node === document.activeElement
            ),
            true
        );
        assert.deepEqual(await nativeAction.evaluate(hostFocus), siblingFocus);
        await siblingAction.evaluate((node) => node.remove());
        await hostStyle.evaluate((node) => node.remove());
        const configureCommitted = async (patch) => {
            const previousRevision = await page.evaluate((patch) => {
                const previous = window.fixtureSnapshot.revision;
                window.configure(patch);
                return previous;
            }, patch);
            await page.waitForFunction(
                ({ previousRevision, patch }) => {
                    const current = window.fixtureCommittedSnapshot;
                    return (
                        current != null &&
                        current === window.fixtureSnapshot &&
                        current.revision > previousRevision &&
                        Object.entries(patch).every(
                            ([key, value]) =>
                                JSON.stringify(current[key]) ===
                                JSON.stringify(value)
                        )
                    );
                },
                { previousRevision, patch }
            );
        };
        await configureCommitted({
            selectionPolicy: 'host',
            embed: {
                preserveElement: true,
                referrerPolicy: 'browser-default',
                fullscreen: false,
            },
            selection: { type: 'embedded', itemId: 'guide', url: capturedUrl },
        });
        await page
            .frameLocator('iframe')
            .getByText('Captured native content', { exact: true })
            .waitFor();
        await page.evaluate(() => {
            window.capturedNativeFrame = document.querySelector('iframe');
        });
        for (const items of [
            [
                {
                    type: 'external',
                    id: 'guide',
                    label: 'Current external',
                    url: 'https://example.test/current-external',
                },
            ],
            [],
        ]) {
            await configureCommitted({ items });
            if (items.length)
                assert.equal(
                    await page
                        .getByRole('link', {
                            name: 'Current external (opens in a new tab)',
                            exact: true,
                        })
                        .getAttribute('href'),
                    'https://example.test/current-external'
                );
            else
                assert.equal(
                    await page
                        .locator('.mx-sdk-portal-menu :is(button,a,summary)')
                        .count(),
                    0
                );
            assert.equal(
                await page.locator('iframe').getAttribute('src'),
                capturedUrl
            );
            assert.equal(
                await page.evaluate(
                    () =>
                        document.querySelector('iframe') ===
                        window.capturedNativeFrame
                ),
                true
            );
        }
        assert.equal(
            capturedRequests,
            1,
            'Menu changes never reload the captured native iframe'
        );
        await configureCommitted({
            selection: {
                type: 'embedded',
                itemId: 'guide',
                url: 'http://example.test/unsafe',
            },
        });
        assert.equal(await page.locator('iframe').count(), 0);
        await configureCommitted({
            items: [],
            selection: {
                type: 'table',
                itemId: 'retiring-native-table',
                viewId: 'pending-native',
            },
        });
        await editor.waitFor();
        assert.deepEqual(
            await page.evaluate(() => ({
                activations: window.proof.activations.length,
                storage: window.proof.storage.length,
                reads: window.proof.reads.length,
            })),
            { activations: 3, storage: 3, reads: 0 }
        );
        const brandOriginal = await page.evaluate(() => ({
            header: window.fixtureSnapshot.header,
            items: window.fixtureSnapshot.items,
        }));
        const brandViewport = page.viewportSize();
        const brandBefore = await page.evaluate(() => [
            window.proof.activations.length,
            window.proof.intents.length,
            window.proof.hovers.length,
            window.proof.reads.length,
        ]);
        await page.setViewportSize({ width: 375, height: 812 });
        await configureCommitted({
            header: {
                ...brandOriginal.header,
                layout: 'topbar',
                hidden: false,
                showBrandInNavigation: false,
                title: 'Member Portal <literal>',
                titleHtml: undefined,
                logoUrl: undefined,
                descriptionHtml: '<p>Outer header help</p>',
                descriptionOptions: { placement: 'header' },
            },
            items: [{ type: 'table', id: 'people', label: 'People' }],
        });
        const brandToggle = page.getByRole('button', {
            name: 'Open navigation',
            exact: true,
        });
        await brandToggle.click();
        const brandDrawer = page.getByRole('dialog', {
            name: 'Portal navigation',
            exact: true,
        });
        await brandDrawer.waitFor();
        assert.equal(
            await brandDrawer.locator('.mx-sdk-portal-brand').count(),
            0,
            'Default stays header-only'
        );
        const brandHeader = await page.evaluate(
            () => window.fixtureSnapshot.header
        );
        await configureCommitted({
            header: { ...brandHeader, showBrandInNavigation: true },
        });
        await brandDrawer
            .getByRole('heading', {
                name: 'Member Portal <literal>',
                exact: true,
            })
            .waitFor();
        assert.equal(await brandDrawer.locator('literal').count(), 0);
        assert.equal(
            await brandDrawer
                .getByText('Outer header help', { exact: true })
                .count(),
            0,
            'Header description is not repeated'
        );
        await configureCommitted({
            header: {
                ...brandHeader,
                showBrandInNavigation: true,
                titleHtml:
                    '<strong>Configured member</strong><script>throw Error("unsafe")</script>',
            },
        });
        assert.equal(
            await brandDrawer
                .locator('.mx-sdk-portal-title-html strong')
                .textContent(),
            'Configured member'
        );
        assert.equal(await brandDrawer.locator('script').count(), 0);
        const brandLogo =
            'data:image/svg+xml,' +
            encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#183c5a"/></svg>'
            );
        await configureCommitted({
            header: {
                ...brandHeader,
                showBrandInNavigation: true,
                titleHtml: '',
                logoUrl: brandLogo,
            },
        });
        const logo = brandDrawer.locator('.mx-sdk-portal-logo');
        await logo.waitFor();
        assert.equal(await logo.getAttribute('src'), brandLogo);
        assert.equal(await brandDrawer.getByRole('heading').count(), 0);
        const logoBounds = await logo.boundingBox();
        assert(
            logoBounds &&
                logoBounds.width > 0 &&
                logoBounds.width <= 80 &&
                logoBounds.height > 0 &&
                logoBounds.height <= 64
        );
        await configureCommitted({
            header: {
                ...brandHeader,
                showBrandInNavigation: true,
                hidden: true,
            },
        });
        await brandDrawer.waitFor({ state: 'detached' });
        await brandToggle.click();
        await brandDrawer.waitFor();
        assert.equal(
            await brandDrawer.locator('.mx-sdk-portal-brand').count(),
            0,
            'Hidden header remains unbranded'
        );
        assert.equal(
            await page
                .locator('.mx-sdk-portal-header .mx-sdk-portal-brand')
                .count(),
            0
        );
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 1280, height: 900 });
        await configureCommitted({
            header: {
                ...brandHeader,
                showBrandInNavigation: true,
                hidden: false,
            },
        });
        await page
            .getByRole('navigation', { name: 'Portal navigation', exact: true })
            .waitFor();
        assert.equal(
            await page
                .locator('.mx-sdk-portal-navigation .mx-sdk-portal-brand')
                .count(),
            0,
            'Inline desktop navigation stays unbranded'
        );
        await configureCommitted(brandOriginal);
        await page.setViewportSize(brandViewport);
        assert.deepEqual(
            await page.evaluate(() => [
                window.proof.activations.length,
                window.proof.intents.length,
                window.proof.hovers.length,
                window.proof.reads.length,
            ]),
            brandBefore,
            'Brand presentation creates no host work'
        );
        const keyboardBefore = await page.evaluate(() => [
            window.proof.activations.length,
            window.proof.intents.length,
            window.proof.hovers.length,
            window.proof.reads.length,
        ]);
        for (const { width, hidden } of [
            { width: 639, hidden: false },
            { width: 640, hidden: true },
            { width: 1280, hidden: true },
        ]) {
            await page.setViewportSize({ width, height: 900 });
            const header = await page.evaluate(
                () => window.fixtureSnapshot.header
            );
            await configureCommitted({
                header: {
                    ...header,
                    layout: 'topbar',
                    hidden,
                    menuInteraction: 'menu',
                },
                items: [
                    { type: 'table', id: 'people', label: 'People' },
                    {
                        type: 'embedded',
                        id: 'guide',
                        label: 'Guide',
                        url: 'https://example.test/guide',
                    },
                    {
                        type: 'external',
                        id: 'docs',
                        label: 'Docs',
                        url: 'https://example.test/docs',
                    },
                ],
            });
            const toggle = page.getByRole('button', {
                name: 'Open navigation',
                exact: true,
            });
            const people = page.getByRole('button', {
                name: 'People',
                exact: true,
            });
            const guide = page.getByRole('button', {
                name: 'Guide',
                exact: true,
            });
            const docs = page.getByRole('link', {
                name: 'Docs (opens in a new tab)',
                exact: true,
            });
            const focused = (locator) =>
                locator.evaluate((node) => node === document.activeElement);
            await toggle.focus();
            await page.keyboard.press('ArrowDown');
            await page
                .getByRole('dialog', { name: 'Portal navigation' })
                .waitFor();
            assert.equal(await focused(people), true);
            await page.keyboard.press('ArrowDown');
            assert.equal(await focused(guide), true);
            const currentDocsURL = 'https://example.test/current-docs-' + width;
            await configureCommitted({
                items: [
                    { type: 'table', id: 'people', label: 'People' },
                    {
                        type: 'embedded',
                        id: 'guide',
                        label: 'Guide',
                        url: 'https://example.test/guide',
                    },
                    {
                        type: 'external',
                        id: 'docs',
                        label: 'Docs',
                        url: currentDocsURL,
                    },
                ],
                settings: {
                    items: [
                        {
                            itemId: 'docs',
                            label: 'Edit Docs settings',
                            includeViews: false,
                        },
                    ],
                },
            });
            assert.equal(
                await page
                    .getByRole('dialog', { name: 'Portal navigation' })
                    .count(),
                1,
                'Same-scope refresh keeps current navigation open'
            );
            assert.equal(
                await focused(guide),
                true,
                'A surviving destination keeps focus across refresh'
            );
            assert.equal(await docs.getAttribute('href'), currentDocsURL);
            await page.keyboard.press('End');
            assert.equal(await focused(docs), true);
            const editorGear = page.getByRole('button', {
                name: 'Edit Docs settings',
                exact: true,
            });
            await page.keyboard.press('Tab');
            assert.equal(
                await focused(editorGear),
                true,
                'Editor remains in actual Tab order'
            );
            await page.keyboard.press('Shift+Tab');
            assert.equal(await focused(docs), true);
            await page.keyboard.press('Home');
            assert.equal(await focused(people), true);
            await page.keyboard.press('Escape');
            assert.equal(await focused(toggle), true);
            assert.equal(
                await page
                    .getByRole('dialog', { name: 'Portal navigation' })
                    .count(),
                0
            );
            await page.keyboard.press('ArrowUp');
            assert.equal(await focused(docs), true);
            await page.keyboard.press('Escape');
            await toggle.click();
            assert.equal(await focused(people), true);
            await page.keyboard.press('Tab');
            assert.equal(await focused(guide), true);
            await page.keyboard.press('Escape');
            assert.equal(await focused(toggle), true);
        }
        const recoveryToggle = page.getByRole('button', {
            name: 'Open navigation',
            exact: true,
        });
        await recoveryToggle.focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('End');
        const recoveryPeople = page.getByRole('button', {
            name: 'People',
            exact: true,
        });
        const withoutDocs = await page.evaluate(() =>
            window.fixtureSnapshot.items.filter((item) => item.id !== 'docs')
        );
        await configureCommitted({ items: withoutDocs });
        assert.equal(
            await recoveryPeople.evaluate(
                (node) => node === document.activeElement
            ),
            true,
            'Focused destination removal recovers inside the drawer'
        );
        await editor.focus();
        const onlyGuide = await page.evaluate(() =>
            window.fixtureSnapshot.items.filter((item) => item.id !== 'people')
        );
        await configureCommitted({ items: onlyGuide });
        assert.equal(
            await editor.evaluate((node) => node === document.activeElement),
            true,
            'Native editor retains outside focus'
        );
        await editor.evaluate((node) => node.blur());
        await configureCommitted({ items: [...onlyGuide] });
        assert.equal(
            await page.evaluate(() => document.activeElement === document.body),
            true,
            'Relinquished drawer ownership stays retired'
        );
        await page
            .getByRole('dialog', { name: 'Portal navigation' })
            .getByRole('button', { name: 'Close navigation', exact: true })
            .click();
        await page.setViewportSize({ width: 639, height: 900 });
        const actionHeader = await page.evaluate(
            () => window.fixtureSnapshot.header
        );
        await configureCommitted({
            header: { ...actionHeader, hidden: false },
            items: [],
            hideMenuItems: true,
            searchAgainEnabled: true,
            user: {
                name: 'Action owner',
                settingsEnabled: true,
                logoutEnabled: false,
                presentation: 'icon',
            },
        });
        const actionToggle = page.getByRole('button', {
            name: 'Open navigation',
            exact: true,
        });
        const actionNavigationId =
            await actionToggle.getAttribute('aria-controls');
        assert.ok(actionNavigationId);
        // The fixture commit does not wait for the shell's media query listener.
        await page.waitForFunction(
            (id) => document.getElementById(id)?.hidden === true,
            actionNavigationId
        );
        assert.equal(await actionToggle.getAttribute('aria-expanded'), 'false');
        await actionToggle.focus();
        await page.keyboard.press('ArrowDown');
        const actionDrawer = page.getByRole('dialog', {
            name: 'Portal navigation',
        });
        await actionDrawer.waitFor();
        assert.equal(
            await actionDrawer.evaluate((node) =>
                node.contains(document.activeElement)
            ),
            true
        );
        const directProfile = page.getByRole('button', {
            name: 'User settings',
            exact: true,
        });
        await page.keyboard.press('End');
        assert.equal(
            await directProfile.evaluate(
                (node) => node === document.activeElement
            ),
            true
        );
        await page.keyboard.press('Home');
        assert.equal(
            await actionDrawer
                .locator(':scope > button')
                .evaluate((node) => node === document.activeElement),
            true
        );
        await page.keyboard.press('Escape');
        await page.keyboard.press('ArrowUp');
        assert.equal(
            await directProfile.evaluate(
                (node) => node === document.activeElement
            ),
            true
        );
        await page.keyboard.press('Escape');
        await actionToggle.click();
        assert.equal(
            await actionDrawer.evaluate((node) =>
                node.contains(document.activeElement)
            ),
            true
        );
        await page.keyboard.press('Escape');
        assert.equal(
            await actionToggle.evaluate(
                (node) => node === document.activeElement
            ),
            true
        );
        assert.deepEqual(
            await page.evaluate(() => [
                window.proof.activations.length,
                window.proof.intents.length,
                window.proof.hovers.length,
                window.proof.reads.length,
            ]),
            keyboardBefore,
            'Keyboard opening/traversal/closure creates no host or hover work'
        );
        await configureCommitted({
            items: [{ type: 'table', id: 'people', label: 'People' }],
            hideMenuItems: false,
            searchAgainEnabled: false,
            user: undefined,
        });
        const activateToggle = page.getByRole('button', {
            name: 'Open navigation',
            exact: true,
        });
        await activateToggle.focus();
        await page.keyboard.press('ArrowDown');
        const keyboardDestination = page.getByRole('button', {
            name: 'People',
            exact: true,
        });
        assert.equal(
            await keyboardDestination.evaluate(
                (node) => node === document.activeElement
            ),
            true
        );
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => window.proof.activations.length === 4);
        assert.deepEqual(
            await page.evaluate(() => ({
                activations: window.proof.activations.length,
                storage: window.proof.storage.length,
                reads: window.proof.reads.length,
            })),
            { activations: 4, storage: 4, reads: 1 }
        );
        assert.equal(
            await page
                .getByRole('dialog', { name: 'Portal navigation' })
                .count(),
            0
        );
        assert.equal(
            await activateToggle.evaluate(
                (node) => node === document.activeElement
            ),
            true
        );
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        return {
            explicitActivations: 4,
            recordedHostStorageEffects: 4,
            recordedHostViewReads: 1,
            pointerOnlyNotification: 'passed',
            mobileDisclosureResetAndEscape: 'passed',
            configuredIconsBadgesAndSettings: 'passed',
            desktopSidebarAccountPlacement,
            desktopAndMobileMenuTabFocus: 'passed',
            mobileAccountPlacement: accountPlacement,
            nativeHostEditorTabDestination: 'passed',
            nativeHostControlStylesAndFocus: 'passed',
            hostSelectionAcrossMenuDrift: 'passed',
            closedNavigationKeyboard: 'passed',
            liveNavigationRevision: 'passed',
            editorDirectionalAndTabFocus: 'passed',
            focusedRemovalAndOutsideOwnership: 'passed',
            keyboardActivationAndReturnFocus: 'passed',
            mobileNavigationBrand: 'passed',
            cleanup: 'completed',
        };
    } catch (error) {
        await page
            .screenshot({
                path: join(output, `navigation-${label}.png`),
                fullPage: true,
            })
            .catch(() => {});
        throw error;
    } finally {
        await page.close();
    }
}
async function checkDirectNativeLogout(browser, origin) {
    const profiles = [];
    for (const [width, height] of [
        [375, 780],
        [1280, 720],
    ]) {
        const page = await browser.newPage({ viewport: { width, height } });
        const violations = [];
        page.on('pageerror', (error) => violations.push(String(error)));
        await page.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                request.method() === 'GET' &&
                url.origin === origin &&
                ['/', '/main.css', '/main.js'].includes(url.pathname)
            )
                return route.continue();
            violations.push(request.url());
            return route.abort();
        });
        try {
            await page.goto(origin);
            await page
                .getByRole('heading', { name: '<Customer Portal>' })
                .waitFor();
            await page.evaluate(() =>
                window.configure({
                    header: {
                        layout: 'sidebar',
                        title: 'Direct logout fixture',
                        actionsPlacement: 'layout',
                    },
                    user: {
                        name: 'Configured member',
                        presentation: 'text',
                        settingsEnabled: false,
                        logoutEnabled: true,
                    },
                })
            );
            await page.waitForFunction(
                () =>
                    window.fixtureCommittedSnapshot?.header.title ===
                    'Direct logout fixture'
            );
            const drawer = page.getByRole('dialog', {
                name: 'Portal navigation',
                exact: true,
            });
            if (width === 375) {
                await page
                    .getByRole('button', {
                        name: 'Open navigation',
                        exact: true,
                    })
                    .press('Enter');
                await drawer.waitFor();
            }
            const opener = page.getByRole('button', {
                name: 'Log out',
                exact: true,
            });
            assert.equal(await opener.count(), 1);
            const original = await opener.elementHandle();
            const dialog = page.getByRole('dialog', {
                name: 'Are you sure you want to log out?',
                exact: true,
            });
            const cancel = dialog.getByRole('button', {
                name: 'Cancel',
                exact: true,
            });
            const confirm = dialog.getByRole('button', {
                name: 'Log out',
                exact: true,
            });
            const open = async () => {
                await opener.press('Enter');
                await page.waitForFunction(
                    (node) => node === document.activeElement,
                    await cancel.elementHandle()
                );
            };
            await open();
            const style = await confirm.evaluate((node) => {
                const css = getComputedStyle(node);
                return [css.backgroundColor, css.color, css.textAlign];
            });
            assert.deepEqual(
                style,
                ['rgb(220, 38, 38)', 'rgb(255, 255, 255)', 'center'],
                `Native direct Log out danger action at ${width}px`
            );
            assert.equal(
                await cancel.evaluate(
                    (node) => getComputedStyle(node).textAlign
                ),
                'center'
            );
            const typography = await dialog
                .getByRole('button')
                .evaluateAll((buttons) =>
                    buttons.map((button) => {
                        const { fontSize, lineHeight, fontWeight } =
                            getComputedStyle(button);
                        return [
                            button.textContent,
                            fontSize,
                            lineHeight,
                            fontWeight,
                        ];
                    })
                );
            assert.deepEqual(
                typography,
                [
                    ['Log out', '14px', '20px', '600'],
                    ['Cancel', '14px', '20px', '600'],
                ],
                `Native direct Log out action typography at ${width}px`
            );
            const dangerBounds = await confirm.boundingBox();
            const cancelBounds = await cancel.boundingBox();
            assert.ok(dangerBounds && cancelBounds);
            assert.deepEqual(
                [dangerBounds.height, cancelBounds.height],
                [36, 36],
                `Native direct Log out action heights at ${width}px`
            );
            if (width === 375) {
                assert.equal(dangerBounds.width, cancelBounds.width);
                assert.equal(
                    cancelBounds.y - dangerBounds.y - dangerBounds.height,
                    8
                );
            } else {
                assert.equal(dangerBounds.y, cancelBounds.y);
                assert.equal(
                    dangerBounds.x - cancelBounds.x - cancelBounds.width,
                    8
                );
            }
            const close = async (key) => {
                await page.keyboard.press(key);
                await dialog.waitFor({ state: 'hidden' });
                assert.equal(
                    await original.evaluate(
                        (node) =>
                            node.isConnected && node === document.activeElement
                    ),
                    true
                );
            };
            await close('Escape');
            await open();
            await close('Enter');
            await original.dispose();
            if (width === 375) assert(await drawer.isVisible());
            const intents = await page.evaluate(() => window.proof.intents);
            assert.deepEqual(intents, []);
            assert.deepEqual(violations, []);
            profiles.push({
                width,
                height,
                style,
                typography,
                dangerBounds,
                cancelBounds,
            });
        } finally {
            await page.close();
        }
    }
    return profiles;
}

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
        const logoutDialog = page.getByRole('dialog', {
            name: 'Are you sure you want to log out?',
            exact: true,
        });
        await logoutDialog.waitFor();
        assert.equal(
            await logoutDialog.locator('[data-native-direct-logout]').count(),
            0
        );
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
        await checkAccountMenuBorders(menu.locator(':scope > div'), '1px');
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
        const ordersGears = page.getByRole('button', {
            name: 'Edit orders',
            exact: true,
        });
        const readSettingsPaint = (button) =>
            button.evaluate((node) => {
                const paint = getComputedStyle(node);
                return {
                    borders: [
                        paint.borderTopWidth,
                        paint.borderRightWidth,
                        paint.borderBottomWidth,
                        paint.borderLeftWidth,
                    ],
                    focusVisible: node.matches(':focus-visible'),
                    outline: paint.outlineStyle,
                    outlineWidth: paint.outlineWidth,
                    outlineOffset: paint.outlineOffset,
                };
            });
        const borderless = ['0px', '0px', '0px', '0px'];
        const focusedSettingsPaint = {
            borders: borderless,
            focusVisible: true,
            outline: 'solid',
            outlineWidth: '3px',
            outlineOffset: '3px',
        };
        await page.setViewportSize({ width: 375, height: 900 });
        await titleGear.waitFor();
        assert.deepEqual(
            (await readSettingsPaint(titleGear)).borders,
            borderless
        );
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await ordersGears.last().waitFor();
        assert.deepEqual(
            (await readSettingsPaint(ordersGears.last())).borders,
            borderless
        );
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 1280, height: 900 });
        for (const gear of [titleGear, ordersGears.last()]) {
            await gear.waitFor();
            const paint = await readSettingsPaint(gear);
            assert.deepEqual(paint.borders, borderless);
            assert.equal(paint.outline, 'none');
        }
        await page.keyboard.press('Tab');
        await titleGear.focus();
        assert.deepEqual(
            await readSettingsPaint(titleGear),
            focusedSettingsPaint
        );
        await page.keyboard.press('Enter');
        const box = await titleGear.boundingBox();
        assert(box && box.width <= 32 && box.height <= 32);
        for (const name of ['Edit description', 'Edit profile'])
            await page.getByRole('button', { name, exact: true }).click();
        await page.keyboard.press('Shift+Tab');
        await ordersGears.last().focus();
        assert.deepEqual(
            await readSettingsPaint(ordersGears.last()),
            focusedSettingsPaint
        );
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
        await page.waitForFunction(() => {
            const committed = window.fixtureCommittedSnapshot;
            return (
                committed != null &&
                committed === window.fixtureSnapshot &&
                committed.settings === undefined
            );
        });
        assert.equal(await page.locator('.mx-sdk-portal-settings').count(), 0);
        await configure({
            searchAgainEnabled: false,
            user: {
                name: 'Configured member',
                presentation: 'text',
                settingsEnabled: false,
                logoutEnabled: true,
            },
        });
        const sidebarLogout = footer.getByRole('button', {
            name: 'Log out',
            exact: true,
        });
        for (const viewport of [
            { width: 375, height: 780 },
            { width: 1280, height: 720 },
        ]) {
            await page.setViewportSize(viewport);
            if (viewport.width === 375)
                await page
                    .getByRole('button', { name: 'Open navigation' })
                    .click();
            await sidebarLogout.waitFor();
            assert.equal(await footer.getByRole('button').count(), 1);
            await page.mouse.move(0, 0);
            if (
                await sidebarLogout.evaluate(
                    (node) => node === document.activeElement
                )
            )
                await page.keyboard.press('Shift+Tab');
            const geometry = await sidebarLogout.evaluate((button) => {
                const icon = button.querySelector('svg');
                const footer = button.parentElement;
                const buttonBox = button.getBoundingClientRect();
                const iconBox = icon.getBoundingClientRect();
                const footerBox = footer.getBoundingClientRect();
                const center = (box) => box.x + box.width / 2;
                return {
                    size: [buttonBox.width, buttonBox.height],
                    icon: [iconBox.width, iconBox.height],
                    footerOffset: center(buttonBox) - center(footerBox),
                    iconOffset: [
                        center(iconBox) - center(buttonBox),
                        iconBox.y +
                            iconBox.height / 2 -
                            (buttonBox.y + buttonBox.height / 2),
                    ],
                    color: getComputedStyle(icon).color,
                    background: getComputedStyle(button).backgroundColor,
                };
            });
            assert.deepEqual(geometry.size, [28, 76]);
            assert.deepEqual(geometry.icon, [28, 28]);
            assert(Math.abs(geometry.footerOffset) <= 0.5);
            assert.deepEqual(geometry.iconOffset, [0, 0]);
            assert.equal(geometry.color, 'rgb(107, 114, 128)');
            assert.equal(geometry.background, 'rgba(0, 0, 0, 0)');
            const rest = await readSettingsPaint(sidebarLogout);
            assert.deepEqual(rest.borders, borderless);
            assert.equal(rest.focusVisible, false);
            assert.equal(rest.outline, 'none');

            await sidebarLogout.focus();
            await page.keyboard.press('Shift+Tab');
            assert.equal(
                await sidebarLogout.evaluate(
                    (node) => node === document.activeElement
                ),
                false
            );
            await page.keyboard.press('Tab');
            assert.equal(
                await sidebarLogout.evaluate(
                    (node) => node === document.activeElement
                ),
                true
            );
            assert.deepEqual(await readSettingsPaint(sidebarLogout), {
                borders: borderless,
                focusVisible: true,
                outline: 'auto',
                outlineWidth: '1px',
                outlineOffset: '0px',
            });
            assert.equal(
                await page.locator('.mx-sdk-portal-dialog').count(),
                0
            );
            if (viewport.width === 375) await page.keyboard.press('Escape');
        }
        assert.equal(await page.evaluate(() => window.proof.intents.length), 2);
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        return {
            sidebar1023And1024: 'passed',
            topbar639And640: 'passed',
            emptyAndHiddenMenus: 'passed',
            descriptionExpansion: 'passed',
            directActions: 'passed',
            directLogoutSidebarPaint: 'passed',
            committedLogoutRetirement: 'passed',
            authoringSettingsBordersAndFocus: 'passed',
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
                        basename(file.path).replace(
                            /main\.(cjs|mjs)\./,
                            'main.'
                        ),
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
                await separator.focus();
                const beforeHistoryArrows = await counts();
                const historyKeys = ['altKey', 'metaKey'].flatMap((modifier) =>
                    ['ArrowLeft', 'ArrowRight'].map((key) => ({
                        key,
                        modifier,
                    }))
                );
                const historyArrows = await separator.evaluate((node, keys) => {
                    window.resizeHandle = node;
                    let currentEvent;
                    let hostReceipts = 0;
                    function observe(event) {
                        if (event === currentEvent) hostReceipts++;
                    }
                    document.addEventListener('keydown', observe);
                    try {
                        return keys.flatMap(({ key, modifier }) => {
                            const dispatch = (repeat) => {
                                currentEvent = new KeyboardEvent('keydown', {
                                    key,
                                    code: key,
                                    [modifier]: !repeat,
                                    repeat,
                                    bubbles: true,
                                    cancelable: true,
                                });
                                hostReceipts = 0;
                                const dispatched =
                                    node.dispatchEvent(currentEvent);
                                return {
                                    key,
                                    modifier,
                                    repeat,
                                    dispatched,
                                    defaultPrevented:
                                        currentEvent.defaultPrevented,
                                    hostReceipts,
                                };
                            };
                            try {
                                return [dispatch(false), dispatch(true)];
                            } finally {
                                node.dispatchEvent(
                                    new KeyboardEvent('keyup', {
                                        key,
                                        code: key,
                                        bubbles: true,
                                    })
                                );
                            }
                        });
                    } finally {
                        document.removeEventListener('keydown', observe);
                    }
                }, historyKeys);
                assert.deepEqual(
                    {
                        events: historyArrows,
                        width: await measuredSidebar(),
                        commits: await page.evaluate(
                            () => window.proof.sidebarWidths
                        ),
                    },
                    {
                        events: historyKeys.flatMap((key) =>
                            [false, true].map((repeat) => ({
                                ...key,
                                repeat,
                                dispatched: true,
                                defaultPrevented: false,
                                hostReceipts: 1,
                            }))
                        ),
                        width: 384,
                        commits: [],
                    },
                    'History arrows and their modifier-free repeats must bubble without resizing'
                );
                assert.deepEqual(await counts(), beforeHistoryArrows);
                let commitCount = 0;
                for (const [key, freshWidth, repeatWidth] of [
                    ['ArrowLeft', 374, 364],
                    ['ArrowRight', 374, 384],
                ]) {
                    const readOwner = () =>
                        page.evaluate(() => {
                            const { scope, revision } =
                                window.fixtureCommittedSnapshot;
                            return { scope, revision };
                        });
                    const freshOwner = await readOwner();
                    await page.keyboard.down(key);
                    let repeatOwner;
                    try {
                        assert.equal(await measuredSidebar(), freshWidth);
                        repeatOwner = await readOwner();
                        await page.keyboard.down(key);
                        assert.equal(await measuredSidebar(), repeatWidth);
                    } finally {
                        await page.keyboard.up(key);
                    }
                    assert.deepEqual(
                        await page.evaluate(
                            (from) => ({
                                commits: window.proof.sidebarWidths.slice(from),
                                focused:
                                    document.activeElement ===
                                    window.resizeHandle,
                                sameBody:
                                    document.querySelector('main article') ===
                                    window.resizeBody,
                            }),
                            commitCount
                        ),
                        {
                            commits: [
                                { ...freshOwner, width: freshWidth },
                                { ...repeatOwner, width: repeatWidth },
                            ],
                            focused: true,
                            sameBody: true,
                        }
                    );
                    commitCount += 2;
                }
                assert.deepEqual(await counts(), beforeHistoryArrows);
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
                        4
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
                    10
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
                    10,
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
                    10
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
                const ordersSummary = summary('Orders');
                const fill = (control) =>
                    control.evaluate(
                        (node) => getComputedStyle(node).backgroundColor
                    );
                const selectedFill = 'rgb(224, 231, 255)';
                await page.mouse.move(1, 1);
                assert.equal(await fill(ordersSummary), selectedFill);
                await ordersSummary.hover();
                const hoverFill = await fill(ordersSummary);
                assert.notEqual(hoverFill, selectedFill);
                assert.notEqual(hoverFill, 'rgba(0, 0, 0, 0)');
                await ordersSummary.click();
                await page.mouse.move(1, 1);
                assert.equal(
                    await ordersSummary.getAttribute('data-active'),
                    'true'
                );
                assert.equal(await fill(ordersSummary), 'rgba(0, 0, 0, 0)');
                assert.equal(await fill(button('Open orders')), selectedFill);
                await ordersSummary.hover();
                assert.equal(await fill(ordersSummary), hoverFill);
                await button('Done orders').hover();
                await button('Done orders').focus();
                assert.deepEqual(await counts(), {
                    intents: 0,
                    storage: 0,
                    reads: 0,
                });
                await button('Done orders').click();
                await page.getByText('Selected: orders/done').waitFor();
                assert.equal(await fill(ordersSummary), 'rgba(0, 0, 0, 0)');
                assert.equal(
                    await button('Done orders').getAttribute('aria-current'),
                    'page'
                );
                await page.mouse.move(1, 1);
                assert.equal(await fill(button('Done orders')), selectedFill);
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
                assert.equal(await fill(ordersSummary), selectedFill);
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
                await page.mouse.move(1, 1);
                assert.equal(
                    await ordersSummary.evaluate(
                        (node) => node.parentElement.open
                    ),
                    true
                );
                assert.equal(await fill(ordersSummary), selectedFill);
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
                    navigationCompatibility: await navigationCompatibility(
                        browser,
                        origin,
                        `${react}-${format}`
                    ),
                    nativeDirectLogout: await checkDirectNativeLogout(
                        browser,
                        origin
                    ),
                    configuredPresentation: await configuredPresentation(
                        browser,
                        origin,
                        `${react}-${format}`
                    ),
                    nativeTopbar: await checkNativeTopbar(browser, origin),
                    nativeSidebarOpener: await checkNativeSidebarOpener(
                        browser,
                        origin,
                        output,
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
