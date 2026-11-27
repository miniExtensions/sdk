import assert from 'node:assert/strict';
import { join } from 'node:path';

const profiles = [
    { language: 'en', width: 1280, label: 'Load more' },
    { language: 'fr', width: 375, label: 'Charger plus' },
];

export const portalGalleryPagingAppearanceEntry = String.raw`
import { createElement as h, StrictMode } from 'react';
import { PortalGallery } from '@miniextensions/sdk/react';

function textRow(title, language, calls) {
    return {
        key: title,
        recordId: title,
        accessibleLabel: title,
        projection: {
            status: 'present', layout: 'gallery', primary: title, primaryIsEmpty: false,
            fields: [], language, images: [], shouldRenderThumbnail: false,
            imageHeight: 112, imageFit: 'cover', thumbnailLocation: 'left', fieldsPerCardRow: 1,
            labels: { previousImage: 'Previous', nextImage: 'Next', viewImage: 'View image {index}', noImage: 'No image' },
        },
        open: { label: 'Open ' + title, activate() { calls.opens++; } },
        requestUnlink: title === 'Alpha' || title === 'A' ? {
            label: 'Unlink ' + title, description: 'Unlink this record', activate() { calls.unlinks++; },
        } : null,
    };
}

function mountKeyboardPagingFocus(root, secondPageIds) {
    const calls = { requested: [], accepted: [], opens: 0, unlinks: 0, submits: 0, trustedPagingClicks: 0 };
    const rows = ['A', 'B', 'C'].map((title) => textRow(title, 'en', calls));
    let content = { status: 'rows', rows: rows.slice(0, 2), emptyLabel: null };
    let nextPage = 'page_2';
    let pending = null;
    let current = true;

    function render() {
        root.render(h(StrictMode, null, h('form', {
            id: 'gallery-empty-paging',
            onSubmit(event) { event.preventDefault(); calls.submits++; },
            onClickCapture(event) {
                if (event.target instanceof HTMLButtonElement &&
                    event.target.matches('.mx-sdk-portal-gallery-load-more') &&
                    event.nativeEvent.isTrusted && event.detail === 0)
                    calls.trustedPagingClicks++;
            },
        }, h(PortalGallery, {
            label: 'Paging Gallery',
            content,
            columns: 3,
            width: 'full',
            paging: {
                canRequestMore: nextPage !== null && pending === null,
                showSpinner: pending !== null,
                requestLabel: 'Load more',
                loadingLabel: 'Loading records',
                requestMore() { throw new Error('Expected keyboard continuation'); },
                requestMoreWithFocus() {
                    if (nextPage === null || pending !== null)
                        throw new Error('Unexpected continuation request');
                    calls.requested.push(nextPage);
                    return new Promise((resolve) => {
                        pending = { page: nextPage, resolve, accepted: false };
                        render();
                    });
                },
            },
        }))));
    }

    window.galleryEmptyPaging = {
        accept() {
            if (pending === null || pending.accepted)
                throw new Error('Expected one pending continuation');
            pending.accepted = true;
            const recordIds = pending.page === 'page_2' ? secondPageIds : ['C'];
            calls.accepted.push({ page: pending.page, recordIds });
            pending.resolve({ recordIds, isCurrent: () => current });
        },
        publish() {
            if (!pending?.accepted) throw new Error('Expected an accepted continuation');
            if (pending.page === 'page_2') nextPage = 'page_3';
            else {
                nextPage = null;
                content = { ...content, rows };
            }
            pending = null;
            render();
        },
        snapshot() {
            const active = document.activeElement;
            const focus = active === document.body
                ? 'body'
                : active?.getAttribute('aria-label') || active?.textContent;
            return { ...calls, rows: content.rows.map((row) => row.recordId), focus };
        },
        unmount() { current = false; root.unmount(); },
    };
    render();
}

export function mountPagingAppearance(root, language) {
    if (language === 'empty-keyboard' || language === 'duplicate-keyboard') {
        mountKeyboardPagingFocus(root, language === 'duplicate-keyboard' ? ['B', 'B'] : []);
        return;
    }
    const vocabulary = ${JSON.stringify(Object.fromEntries(profiles.map(({ language, label }) => [language, label])))};
    const calls = { pages: 0, opens: 0, unlinks: 0, submits: 0, trustedPagingClicks: 0 };
    const rows = ['Alpha', 'Beta'].map((title) => textRow(title, language, calls));
    root.render(h(StrictMode, null, h('form', {
        id: 'gallery-appearance',
        onSubmit(event) { event.preventDefault(); calls.submits++; },
        onClickCapture(event) {
            if (event.target instanceof HTMLButtonElement &&
                event.target.textContent === vocabulary[language] && event.nativeEvent.isTrusted)
                calls.trustedPagingClicks++;
        },
    }, h(PortalGallery, {
        label: 'Paging Gallery',
        content: { status: 'rows', rows, emptyLabel: null },
        columns: 5,
        width: 'full',
        paging: {
            canRequestMore: true, showSpinner: false, requestLabel: vocabulary[language],
            loadingLabel: 'Loading records', requestMore() { calls.pages++; },
        },
    }))));
    window.galleryPagingAppearance = {
        snapshot: () => ({ ...calls }),
        unmount() { root.unmount(); },
    };
}
`;

export async function checkPortalGalleryPagingAppearance({
    browser,
    origin,
    evidence,
    output,
}) {
    evidence.pagingAppearance = [];
    for (const profile of profiles) {
        const { language, label, width } = profile;
        const context = await browser.newContext({
            viewport: { width, height: 800 },
            serviceWorkers: 'block',
        });
        const fixture = `/portal-gallery-layout.html?paging=${language}`;
        const allowed = new Set([
            fixture,
            '/portal-gallery-layout.css',
            '/portal-gallery-layout.js',
        ]);
        const item = {
            ...profile,
            unexpectedRequests: [],
            pageErrors: [],
            cleanup: false,
        };
        evidence.pagingAppearance.push(item);
        try {
            await context.route('**/*', (route) => {
                const request = route.request();
                const url = new URL(request.url());
                if (
                    request.method() === 'GET' &&
                    url.origin === origin &&
                    allowed.has(url.pathname + url.search)
                )
                    return route.continue();
                item.unexpectedRequests.push(url.pathname);
                return route.abort();
            });
            const page = await context.newPage();
            page.setDefaultTimeout(5000);
            page.on('pageerror', (error) => item.pageErrors.push(error.name));
            await page.goto(origin + fixture);
            const button = page.getByRole('button', {
                name: label,
                exact: true,
            });
            await button.waitFor();
            assert.equal(await button.getAttribute('type'), 'button');
            const measure = () =>
                button.evaluate(async (node) => {
                    await document.fonts.ready;
                    const box = node.getBoundingClientRect();
                    const pager = node.parentElement.getBoundingClientRect();
                    const style = getComputedStyle(node);
                    return {
                        box: {
                            x: box.x,
                            y: box.y,
                            width: box.width,
                            height: box.height,
                        },
                        inPager: { x: box.x - pager.x, y: box.y - pager.y },
                        pagerHeight: pager.height,
                        font: {
                            family: style.fontFamily,
                            size: style.fontSize,
                            weight: style.fontWeight,
                            lineHeight: style.lineHeight,
                        },
                        color: style.color,
                        opacity: style.opacity,
                        decoration: style.textDecorationLine,
                        focus: {
                            visible: node.matches(':focus-visible'),
                            style: style.outlineStyle,
                            offset: style.outlineOffset,
                        },
                    };
                });
            const save = async (phase, bounds) => {
                if (!output) return;
                const x = Math.max(0, Math.floor(bounds.x) - 5);
                const y = Math.max(0, Math.floor(bounds.y) - 5);
                await page.screenshot({
                    clip: {
                        x,
                        y,
                        width: Math.min(
                            width - x,
                            Math.ceil(bounds.x + bounds.width) - x + 5
                        ),
                        height: Math.ceil(bounds.y + bounds.height) - y + 5,
                    },
                    path: join(
                        output,
                        `gallery-load-more-${language}-${phase}.png`
                    ),
                });
            };
            const rest = await measure();
            item.rest = rest;
            assert.equal(rest.font.size, '14px');
            assert.equal(rest.font.lineHeight, '21px');
            assert.equal(rest.font.weight, '600');
            assert.equal(rest.color, 'rgb(37, 99, 235)');
            assert.equal(rest.opacity, '1');
            assert.equal(rest.decoration, 'none');
            assert.deepEqual(rest.inPager, { x: 0, y: 16 });
            assert.equal(rest.box.height, Math.max(21, rest.pagerHeight - 32));
            await save('rest', rest.box);

            await button.hover();
            const hover = await measure();
            item.hover = hover;
            assert.deepEqual(hover.box, rest.box);
            assert.equal(hover.opacity, '0.7');
            assert.equal(hover.color, rest.color);
            assert.equal(hover.decoration, 'none');
            await save('hover', hover.box);

            await page.mouse.move(0, 0);
            await page
                .getByRole('button', { name: 'Open Beta', exact: true })
                .focus();
            await page.keyboard.press('Tab');
            const focus = await measure();
            item.focus = focus;
            assert.deepEqual(focus.box, rest.box);
            assert.equal(focus.focus.visible, true);
            assert.notEqual(focus.focus.style, 'none');
            assert.equal(focus.focus.offset, '0px');
            await save('focus', focus.box);

            await page.keyboard.press('Enter');
            item.actions = await page.evaluate(() =>
                window.galleryPagingAppearance.snapshot()
            );
            assert.deepEqual(item.actions, {
                pages: 1,
                opens: 0,
                unlinks: 0,
                submits: 0,
                trustedPagingClicks: 1,
            });
            assert.deepEqual(item.unexpectedRequests, []);
            assert.deepEqual(item.pageErrors, []);
            await page.evaluate(() => window.galleryPagingAppearance.unmount());
            assert.equal(await page.locator('#gallery-appearance').count(), 0);
            item.passed = true;
        } finally {
            await context.close();
            item.cleanup = true;
        }
    }
    await checkPortalGalleryPagingFocus({ browser, origin, evidence });
    await checkPortalGalleryPagingFocus({
        browser,
        origin,
        evidence,
        duplicateOnly: true,
    });
}

export async function checkPortalGalleryPagingFocus({
    browser,
    origin,
    evidence,
    duplicateOnly = false,
}) {
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        serviceWorkers: 'block',
    });
    const mode = duplicateOnly ? 'duplicate-keyboard' : 'empty-keyboard';
    const secondPageIds = duplicateOnly ? ['B', 'B'] : [];
    const fixture = '/portal-gallery-layout.html?paging=' + mode;
    const allowed = new Set([
        fixture,
        '/portal-gallery-layout.css',
        '/portal-gallery-layout.js',
    ]);
    const item = { unexpectedRequests: [], pageErrors: [], cleanup: false };
    evidence[duplicateOnly ? 'duplicatePagingFocus' : 'emptyPagingFocus'] =
        item;
    try {
        await context.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                request.method() === 'GET' &&
                url.origin === origin &&
                allowed.has(url.pathname + url.search)
            )
                return route.continue();
            item.unexpectedRequests.push(url.pathname);
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on('pageerror', (error) => item.pageErrors.push(error.message));
        await page.goto(origin + fixture);
        const snapshot = () =>
            page.evaluate(() => window.galleryEmptyPaging.snapshot());
        const settle = () =>
            page.evaluate(async () => {
                window.galleryEmptyPaging.accept();
                await new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve))
                );
            });
        const more = page.getByRole('button', {
            name: 'Load more',
            exact: true,
        });
        const spinner = page.getByRole('status', {
            name: 'Loading records',
            exact: true,
        });
        await page.getByRole('button', { name: 'Open B', exact: true }).focus();
        await page.keyboard.press('Tab');
        assert.equal((await snapshot()).focus, 'Load more');
        const original = await more.elementHandle();
        await page.keyboard.press('Enter');
        await spinner.waitFor();
        assert.equal(await more.count(), 0);
        assert.equal(
            await original.evaluate((node) => node.isConnected),
            false
        );
        assert.deepEqual((await snapshot()).requested, ['page_2']);

        await settle();
        const pending = await snapshot();
        item[duplicateOnly ? 'duplicatePending' : 'emptyPending'] = pending;
        assert.deepEqual(pending.accepted, [
            { page: 'page_2', recordIds: secondPageIds },
        ]);
        assert.equal(await spinner.isVisible(), true);
        assert.deepEqual(pending.rows, ['A', 'B']);
        assert.equal(pending.trustedPagingClicks, 1);
        await page.evaluate(() => window.galleryEmptyPaging.publish());
        await more.waitFor();
        assert.equal(await more.isEnabled(), true);
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve))
                )
        );
        item.restored = await snapshot();
        assert.equal(item.restored.focus, 'Load more');
        assert.deepEqual(item.restored.requested, ['page_2']);

        await page.keyboard.press('Enter');
        await spinner.waitFor();
        assert.deepEqual((await snapshot()).requested, ['page_2', 'page_3']);
        await settle();
        await page.evaluate(() => window.galleryEmptyPaging.publish());
        await page.waitForFunction(
            () =>
                document.activeElement?.getAttribute('aria-label') === 'Open C'
        );
        item.finished = await snapshot();
        assert.deepEqual(item.finished, {
            requested: ['page_2', 'page_3'],
            accepted: [
                { page: 'page_2', recordIds: secondPageIds },
                { page: 'page_3', recordIds: ['C'] },
            ],
            opens: 0,
            unlinks: 0,
            submits: 0,
            trustedPagingClicks: 2,
            rows: ['A', 'B', 'C'],
            focus: 'Open C',
        });
        assert.equal(await more.count(), 0);
        assert.equal(await spinner.count(), 0);
        assert.deepEqual(item.unexpectedRequests, []);
        assert.deepEqual(item.pageErrors, []);
        await page.evaluate(() => window.galleryEmptyPaging.unmount());
        assert.equal(await page.locator('#gallery-empty-paging').count(), 0);
        item.passed = true;
    } finally {
        await context.close();
        item.cleanup = true;
    }
}
