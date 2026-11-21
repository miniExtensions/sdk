import assert from 'node:assert/strict';
import { join } from 'node:path';

const name = 'Eliminar registro vinculado';
const description = 'Desvincular registro';
const minus =
    'M4.25 12a.75.75 0 0 1 .75-.75h14a.75.75 0 0 1 0 1.5H5a.75.75 0 0 1-.75-.75Z';
const spinner =
    'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z';

// e6bdbec0 Native Gallery controls on the same synthetic card and document.
async function mountNativeReference(page) {
    await page.evaluate(
        ({ name, description, minus, spinner }) => {
            const source = document.querySelector(
                '.mx-sdk-portal-gallery-grid'
            );
            const bounds = source.getBoundingClientRect();
            const reference = document.createElement('section');
            reference.id = 'gallery-native-unlink-reference';
            reference.style.cssText = `position:fixed;z-index:40;left:${bounds.x}px;top:${bounds.y}px;width:${bounds.width}px;background:white`;
            const grid = source.cloneNode(true);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'native-gallery-unlink';
            button.setAttribute('aria-label', name);
            button.setAttribute('aria-busy', 'false');
            const icon = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${minus}"/></svg>`;
            button.innerHTML = icon;
            grid.querySelector('.mx-sdk-portal-gallery-unlink').replaceWith(
                button
            );
            const tooltip = document.createElement('div');
            tooltip.id = 'gallery-native-unlink-tooltip';
            tooltip.setAttribute('role', 'tooltip');
            tooltip.textContent = description;
            tooltip.hidden = true;
            const hide = () => {
                tooltip.hidden = true;
                button.removeAttribute('aria-describedby');
            };
            const show = () => {
                if (button.disabled) return;
                const bounds = button.getBoundingClientRect();
                tooltip.style.top = bounds.bottom + 8 + 'px';
                tooltip.style.left = bounds.left + bounds.width / 2 + 'px';
                tooltip.hidden = false;
                button.setAttribute('aria-describedby', tooltip.id);
            };
            button.onmouseenter = show;
            button.onfocus = show;
            button.onmouseleave = hide;
            button.onblur = hide;
            const style = document.createElement('style');
            style.textContent = `
            .native-gallery-unlink { position:absolute; top:-8px; right:-8px; z-index:3; padding:2px; border:0; border-radius:50%; background:#6b7280; color:white; cursor:pointer; opacity:0 }
            .native-gallery-unlink > svg { display:block;width:16px;height:16px }
            .mx-sdk-portal-gallery-row:hover > .native-gallery-unlink, .native-gallery-unlink:focus, .native-gallery-unlink[aria-busy="true"] { opacity:1 }
            .native-gallery-unlink:hover:not(:disabled) { background:#4b5563 }
            #gallery-native-unlink-tooltip { position:fixed; z-index:50; transform:translateX(-50%); width:max-content; max-width:240px; padding:4px 8px; border-radius:6px; background:#111827; color:white; font:14px/20px system-ui; box-shadow:0 1px 3px #0000001a,0 1px 2px -1px #0000001a }
        `;
            reference.append(style, grid, tooltip);
            document.body.append(reference);
            document.querySelector('#root').style.visibility = 'hidden';
            window.galleryNativePending = () => {
                hide();
                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity="0.25"/><path fill="currentColor" opacity="0.75" d="${spinner}"/></svg>`;
            };
        },
        { name, description, minus, spinner }
    );
}

const buttonPaint = (button) =>
    button.evaluate((node) => {
        const svg = node.querySelector('svg');
        const bounds = node.getBoundingClientRect();
        const card = node.closest('li').getBoundingClientRect();
        const region = svg?.getBoundingClientRect();
        const styles = getComputedStyle(node);
        return {
            color: styles.color,
            background: styles.backgroundColor,
            opacity: styles.opacity,
            button: [
                bounds.left - card.right,
                bounds.top - card.top,
                bounds.width,
                bounds.height,
            ],
            icon: region
                ? [
                      region.left - bounds.left,
                      region.top - bounds.top,
                      region.width,
                      region.height,
                  ]
                : null,
            path: svg?.querySelector('path')?.getAttribute('d') ?? null,
            ring: svg?.querySelector('circle')?.getAttribute('opacity') ?? null,
            stroke:
                svg?.querySelector('circle')?.getAttribute('stroke-width') ??
                null,
            accent: svg?.querySelector('path')?.getAttribute('opacity') ?? null,
        };
    });
const tooltipPaint = (tooltip) =>
    tooltip.evaluate((node) => {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return {
            description: node.textContent,
            background: style.backgroundColor,
            color: style.color,
            padding: style.padding,
            width: box.width,
            height: box.height,
        };
    });

export async function checkGalleryUnlinkPresentation({
    page,
    patch,
    snapshot,
    output,
    react,
}) {
    await page.setViewportSize({ width: 980, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await patch({
        status: 'rows',
        empty: false,
        pending: null,
        unlinkParity: true,
        columns: 2,
    });
    await page.mouse.move(0, 0);
    const grid = page.getByRole('list', {
        name: 'Synthetic Gallery',
        exact: true,
    });
    const first = grid.locator('li[data-record-id="row-0"]');
    const neighbor = grid.locator('li[data-record-id="row-1"]');
    assert.equal(await grid.locator('li[data-record-id]').count(), 2);
    assert.equal(
        await neighbor.getByRole('button', { name, exact: true }).count(),
        0
    );
    const button = first.getByRole('button', { name, exact: true });
    const tooltip = page.getByRole('tooltip').filter({ hasText: description });
    const before = await snapshot();
    const requests = [];
    const onRequest = (request) => requests.push(request.url());
    page.on('request', onRequest);
    const save = (mode, state) =>
        page.screenshot({
            path: join(output, `gallery-unlink-${react}-${mode}-${state}.png`),
            animations: 'disabled',
        });
    try {
        const candidate = { resting: await buttonPaint(button) };
        await save('sdk', 'resting');
        assert.equal(await tooltip.count(), 0);
        await first.hover({ position: { x: 20, y: 20 } });
        candidate.cardHover = await buttonPaint(button);
        await save('sdk', 'card-hover');
        assert.equal(await tooltip.count(), 0);
        await button.hover();
        candidate.buttonHover = await buttonPaint(button);
        await save('sdk', 'button-hover');
        assert.equal(candidate.buttonHover.background, 'rgb(75, 85, 99)');
        assert.deepEqual(candidate.buttonHover.icon, [2, 2, 16, 16]);
        await tooltip.waitFor();
        candidate.tooltip = await tooltipPaint(tooltip);
        await save('sdk', 'button-hover');
        assert.equal(
            await button.getAttribute('aria-describedby'),
            await tooltip.getAttribute('id')
        );
        const tooltipBox = await tooltip.boundingBox();
        const buttonBox = await button.boundingBox();
        assert(
            Math.abs(tooltipBox.y - (buttonBox.y + buttonBox.height) - 8) <= 1
        );
        await page.mouse.move(0, 0);
        await tooltip.waitFor({ state: 'hidden' });
        await first
            .getByRole('button', { name: 'Open 0', exact: true })
            .focus();
        await page.keyboard.press('Tab');
        assert.equal(
            await button.evaluate((n) => n === document.activeElement),
            true
        );
        await tooltip.waitFor();
        candidate.focus = await buttonPaint(button);
        await save('sdk', 'focus');
        await page.keyboard.press('Escape');
        await tooltip.waitFor({ state: 'hidden' });
        assert.equal(
            await button.evaluate((n) => n === document.activeElement),
            true
        );
        const afterHover = await snapshot();
        assert.equal(afterHover.opens, before.opens);
        assert.equal(afterHover.unlinks, before.unlinks);
        await button.evaluate((node) => {
            window.galleryUnlinkClicks = [];
            node.addEventListener('click', (event) =>
                window.galleryUnlinkClicks.push({
                    trusted: event.isTrusted,
                    detail: event.detail,
                })
            );
        });
        await page.keyboard.press('Space');
        await patch({ pending: 'row-0' });
        assert.equal(await button.isDisabled(), true);
        assert.equal(await button.getAttribute('aria-busy'), 'true');
        candidate.pending = await buttonPaint(button);
        await save('sdk', 'pending');
        const after = await snapshot();
        assert.equal(after.opens, before.opens);
        assert.equal(after.submits, before.submits);
        assert.equal(after.pages, before.pages);
        assert.equal(after.unlinks, before.unlinks + 1);
        assert.deepEqual(after.errors, []);
        assert.deepEqual(
            await page.evaluate(() => window.galleryUnlinkClicks),
            [{ trusted: true, detail: 0 }]
        );

        await patch({ pending: null });
        await mountNativeReference(page);
        const reference = page.locator('#gallery-native-unlink-reference');
        const referenceRow = reference.locator('li[data-record-id="row-0"]');
        const nativeButton = referenceRow.getByRole('button', {
            name,
            exact: true,
        });
        assert.equal(
            await reference
                .locator('li[data-record-id="row-1"]')
                .getByRole('button', { name, exact: true })
                .count(),
            0
        );
        const native = { resting: await buttonPaint(nativeButton) };
        await save('native-reference', 'resting');
        await referenceRow.hover({ position: { x: 20, y: 20 } });
        native.cardHover = await buttonPaint(nativeButton);
        await save('native-reference', 'card-hover');
        await nativeButton.hover();
        native.buttonHover = await buttonPaint(nativeButton);
        native.tooltip = await tooltipPaint(tooltip);
        await save('native-reference', 'button-hover');
        await page.mouse.move(0, 0);
        await nativeButton.focus();
        native.focus = await buttonPaint(nativeButton);
        await save('native-reference', 'focus');
        await page.evaluate(() => window.galleryNativePending());
        native.pending = await buttonPaint(nativeButton);
        await save('native-reference', 'pending');
        assert.deepEqual(candidate, native);
        assert.deepEqual(requests, []);
        return {
            candidate,
            native,
            netUnlinks: 1,
            netOpens: 0,
            netSubmits: 0,
            requests,
        };
    } finally {
        page.off('request', onRequest);
        await page.evaluate(() => {
            document
                .querySelector('#gallery-native-unlink-reference')
                ?.remove();
            document.querySelector('#root').style.visibility = '';
            delete window.galleryNativePending;
        });
    }
}
