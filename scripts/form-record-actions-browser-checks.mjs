import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const host = String.raw`
import React, { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { createFormRecordActionsController } from '@miniextensions/sdk/forms';
import { FormRecordActionsMenu } from '@miniextensions/sdk/react';

const counts = { requests: [], writes: [], allocations: [], comments: [], settlements: [] };
const labels = {
    deleteRecord: 'Supprimer', comments: 'Commentaires', openMenu: 'Options',
    confirmationTitle: 'Supprimer cet élément ?',
    irreversibleWarning: 'Cette action est irréversible.',
    confirmDelete: 'Supprimer', cancel: 'Annuler',
};
function makeRow(id) {
    const makeFrame = (record) => ({
        scope: Object.freeze({ id: record }),
        delete: { visible: true, disabled: false, pending: false },
        comments: { visible: true, disabled: false },
    });
    let frame = makeFrame(id);
    let settle;
    const listeners = new Set();
    const controller = createFormRecordActionsController({
        read: () => frame && { ...frame },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        requestCurrentDelete() {
            counts.requests.push(frame?.scope.id ?? null);
            const record = frame.scope.id;
            const operationId = {};
            counts.writes.push(record);
            counts.allocations.push(record);
            const settled = new Promise((resolve) => {
                settle = () => {
                    counts.settlements.push(record);
                    resolve({ status: 'acknowledged', operationId, localSettlement: 'applied' });
                };
            });
            return { status: 'allocated', operation: { id: operationId, settled } };
        },
        openCurrentComments() { counts.comments.push(frame.scope.id); return 'handed-off'; },
    });
    return {
        controller,
        changeRecord(record) { frame = record && makeFrame(record); },
        setComments(disabled, visible, publish = true) {
            frame = { ...frame, comments: { disabled, visible } };
            if (publish) for (const changed of listeners) changed();
        },
        settle() { settle(); },
    };
}
const root = createRoot(document.getElementById('panel'));
const decoy = makeRow('decoy');
let target = makeRow('target');
const row = (id, host) => h('div', { id }, id, h(FormRecordActionsMenu, { controller: host.controller, labels }));
const render = () => root.render(h(React.StrictMode, null, row('decoy', decoy), row('target', target)));
window.recordActionsProof = {
    counts,
    changeRecord: (record) => target.changeRecord(record),
    setComments: (disabled, visible, publish) => target.setComments(disabled, visible, publish),
    settle: () => target.settle(),
    replace() {
        target = makeRow('replacement');
        render();
    },
};
render();
`;

const html = `<!doctype html><html lang="fr"><meta charset="utf-8">
<link rel="stylesheet" href="/actions.css"><style>
body {font:16px system-ui;margin:0}
#panel {position:absolute;top:30px;left:30px;width:284px;height:120px;border:2px solid #64748b;overflow:hidden;background:#f8fafc}
#decoy,#target {display:flex;align-items:center;gap:12px;position:absolute;left:12px}
#decoy {top:8px} #target {bottom:4px}
</style><main id="panel" aria-label="Panneau latéral"></main>
<button id="after" type="button">Après</button><script type="module" src="/proof.js"></script></html>`;

/** Prove the packed disclosure inside the clipped panel with synthetic actions. */
export async function checkFormRecordActionsBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    let directory, server, context;
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const pageErrors = [],
        unexpectedRequests = [];
    Object.assign(evidence, {
        status: 'running',
        pageErrors,
        unexpectedRequests,
    });
    try {
        const root = realpathSync(consumer);
        directory = mkdtempSync(join(root, '.form-record-actions-browser-'));
        const entry = join(directory, 'proof.mjs');
        writeFileSync(entry, host);
        const result = await build({
            entryPoints: [entry],
            absWorkingDir: root,
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(result.metafile, root);
        const sdk = realpathSync(
            join(root, 'node_modules/@miniextensions/sdk')
        );
        const sdkInputs = Object.keys(result.metafile.inputs).filter((file) =>
            file.includes('@miniextensions/sdk')
        );
        assert(
            sdkInputs.some((file) =>
                file.endsWith('/react/FormRecordActions.js')
            )
        );
        const css = readFileSync(
            join(sdk, 'dist/esm/react/form-record-actions.css')
        );
        const bundle = result.outputFiles[0];
        Object.assign(evidence, {
            sdkInputs,
            harnessSha256: hash(readFileSync(new URL(import.meta.url))),
            hostSha256: hash(host),
            htmlSha256: hash(html),
            bundleSha256: hash(bundle.contents),
            cssSha256: hash(css),
        });
        const routes = new Map([
            ['/', ['text/html; charset=utf-8', html]],
            ['/proof.js', ['text/javascript', bundle.contents]],
            ['/actions.css', ['text/css', css]],
        ]);
        server = createServer((request, response) => {
            const route = request.method === 'GET' && routes.get(request.url);
            if (!route) return response.writeHead(404).end();
            response.setHeader('Content-Type', route[0]);
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'"
            );
            response.end(route[1]);
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const origin = 'http://127.0.0.1:' + server.address().port;
        context = await browser.newContext({
            serviceWorkers: 'block',
            viewport: { width: 640, height: 480 },
        });
        await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (
                url.origin === origin &&
                routes.has(url.pathname) &&
                !url.search &&
                route.request().method() === 'GET'
            )
                return route.continue();
            unexpectedRequests.push(url.origin + url.pathname);
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.goto(origin);
        const opener = page
            .locator('#target')
            .getByRole('button', { name: 'Options', exact: true });
        const originalOpener = await opener.elementHandle();
        await opener.press('Enter');
        await page
            .locator('.mx-sdk-form-record-actions__panel:popover-open')
            .waitFor({ state: 'visible' });
        const readPoint = () =>
            opener.evaluate((button) => {
                const doc = button.ownerDocument;
                const popupId = button.getAttribute('aria-controls');
                const popup = doc.getElementById(popupId);
                const action = [...popup.querySelectorAll('button')].find(
                    (item) => item.textContent === 'Supprimer'
                );
                const area = action.getBoundingClientRect();
                const panel = doc
                    .getElementById('panel')
                    .getBoundingClientRect();
                const x = area.left + area.width / 2;
                const y = area.top + area.height / 2;
                return {
                    popupId,
                    x,
                    y,
                    panelBottom: panel.bottom,
                    openerBounds: button.getBoundingClientRect().toJSON(),
                    actionBounds: area.toJSON(),
                    hit:
                        doc.elementFromPoint(x, y)?.closest('button') ===
                        action,
                };
            });
        const points = await readPoint();
        assert(
            points.y > points.panelBottom,
            'Fixture must put Supprimer outside the panel edge'
        );
        assert.equal(
            points.hit,
            true,
            'Hit testing must reach the intended action beyond the panel edge'
        );
        const clipped = 'record-actions-clipped.png';
        await page.screenshot({ path: join(output, clipped) });
        await page.locator('#panel').evaluate((node) => {
            node.style.overflow = 'visible';
        });
        const control = await readPoint();
        assert.deepEqual(
            control,
            points,
            'Changing only overflow must preserve geometry and the exact hit target'
        );
        const unclipped = 'record-actions-unclipped.png';
        await page.screenshot({ path: join(output, unclipped) });
        await page.locator('#panel').evaluate((node) => {
            node.style.overflow = 'hidden';
        });

        const popup = page.getByRole('group', { name: 'Options', exact: true });
        const confirm = page.getByRole('alertdialog', {
            name: 'Supprimer cet élément ?',
        });
        const focusText = () =>
            page.evaluate(() => document.activeElement.textContent);
        const focused = (locator) =>
            locator.evaluate(
                (button) => button.ownerDocument.activeElement === button
            );
        const counts = () =>
            page.evaluate(() => window.recordActionsProof.counts);
        const noop = {
            requests: [],
            writes: [],
            allocations: [],
            comments: [],
            settlements: [],
        };
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        assert.equal(await focusText(), 'Supprimer');
        await page.keyboard.press('Enter');
        await confirm.waitFor();
        assert.equal(await focusText(), 'Annuler');
        await page.keyboard.press('Enter');
        await confirm.waitFor({ state: 'hidden' });
        assert.equal(await focused(originalOpener), true);
        assert.deepEqual(await counts(), noop);

        await opener.press('Enter');
        await popup.waitFor();
        await page.mouse.click(points.x, points.y);
        await confirm.waitFor();
        await confirm.getByRole('button', { name: 'Annuler' }).click();
        await confirm.waitFor({ state: 'hidden' });
        assert.equal(await focused(originalOpener), true);

        await opener.press('Enter');
        await popup.waitFor();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Escape');
        await popup.waitFor({ state: 'hidden' });
        assert.equal(await focused(originalOpener), true);
        await opener.press('Enter');
        await page.locator('#after').click();
        await popup.waitFor({ state: 'hidden' });
        assert.equal(await focusText(), 'Après');
        assert.deepEqual(await counts(), noop);

        await opener.press('Enter');
        await popup.waitFor();
        await page.keyboard.press('Tab');
        const commentsAction = popup.getByRole('button', {
            name: 'Commentaires',
        });
        assert.equal(await focused(commentsAction), true);
        await page.evaluate(() =>
            window.recordActionsProof.setComments(true, true, false)
        );
        assert.equal(await commentsAction.isEnabled(), true);
        await page.keyboard.press('Enter');
        await popup.waitFor({ state: 'hidden' });
        assert.equal(await focused(originalOpener), true);
        assert.deepEqual(await counts(), noop);

        await page.evaluate(() =>
            window.recordActionsProof.setComments(true, true)
        );
        await opener.press('Enter');
        assert.equal(
            await popup
                .getByRole('button', { name: 'Commentaires' })
                .isDisabled(),
            true
        );
        await page.keyboard.press('Tab');
        const deleteAction = popup.getByRole('button', { name: 'Supprimer' });
        assert.equal(await focused(deleteAction), true);
        await page.keyboard.press('Enter');
        await confirm.waitFor();
        await page.keyboard.press('Tab');
        const confirmAction = confirm.getByRole('button', {
            name: 'Supprimer',
        });
        assert.equal(await focused(confirmAction), true);
        await page.evaluate(() =>
            window.recordActionsProof.changeRecord('fresh')
        );
        await page.keyboard.press('Enter');
        await confirm.waitFor({ state: 'hidden' });
        const fresh = {
            ...noop,
            requests: ['fresh'],
            writes: ['fresh'],
            allocations: ['fresh'],
        };
        assert.deepEqual(await counts(), fresh);
        await opener.press('Enter');
        assert.equal(await deleteAction.isDisabled(), true);
        await page.evaluate(() => window.recordActionsProof.settle());
        await page.waitForFunction(
            () => window.recordActionsProof.counts.settlements.length === 1
        );
        await deleteAction.and(page.locator('button:enabled')).waitFor();

        await page.evaluate(() =>
            window.recordActionsProof.setComments(false, false)
        );
        await popup
            .getByRole('button', { name: 'Commentaires' })
            .waitFor({ state: 'detached' });
        await page.keyboard.press('Tab');
        assert.equal(await focusText(), 'Supprimer');
        await page.keyboard.press('Enter');
        await confirm.waitFor();
        await page.keyboard.press('Tab');
        assert.equal(await focused(confirmAction), true);
        await page.evaluate(() => window.recordActionsProof.changeRecord(null));
        assert.equal(await focused(confirmAction), true);
        await page.keyboard.press('Enter');
        await confirm.waitFor({ state: 'hidden' });
        const settled = { ...fresh, settlements: ['fresh'] };
        assert.deepEqual(await counts(), settled);

        await page.evaluate(() => {
            window.recordActionsProof.changeRecord('fresh');
            window.recordActionsProof.setComments(false, false);
        });
        await opener.press('Enter');
        await popup.waitFor();
        await page.keyboard.press('Tab');
        assert.equal(await focused(deleteAction), true);
        await page.keyboard.press('Enter');
        await confirm.waitFor();
        const oldOpener = await opener.elementHandle();
        assert.equal(
            await oldOpener.evaluate((button) => button.isConnected),
            true
        );
        await page.evaluate(() => window.recordActionsProof.replace());
        await confirm.waitFor({ state: 'hidden' });
        assert.equal(
            await oldOpener.evaluate((button) => button.isConnected),
            false
        );
        assert.equal(await focused(opener), false);
        await page.keyboard.press('Enter');
        assert.deepEqual(await counts(), settled);

        await page.evaluate(() =>
            window.recordActionsProof.setComments(false, true)
        );
        await opener.press('Enter');
        await popup.waitFor();
        await page.keyboard.press('Tab');
        assert.equal(await focusText(), 'Commentaires');
        await page.evaluate(() =>
            window.recordActionsProof.changeRecord('current')
        );
        await page.keyboard.press('Enter');
        await popup.waitFor({ state: 'hidden' });
        assert.deepEqual(await counts(), { ...settled, comments: ['current'] });

        // A host modal makes nodes outside it inert. Keep the action inside
        // its original document subtree and force both collision corrections.
        await page.locator('#panel').evaluate((panel) => {
            const hostDialog = panel.ownerDocument.createElement('dialog');
            hostDialog.style.cssText =
                'position:fixed;inset:0;margin:0;border:0;padding:0;max-width:none;max-height:none;width:100%;height:100%';
            panel.ownerDocument.body.append(hostDialog);
            hostDialog.append(panel);
            Object.assign(panel.style, {
                left: 'auto',
                top: 'auto',
                right: '4px',
                bottom: '4px',
            });
            const target = panel.querySelector('#target');
            target.style.left = 'auto';
            target.style.right = '4px';
            hostDialog.showModal();
        });
        await opener.press('Enter');
        await popup.waitFor();
        const collision = await opener.evaluate((button) => {
            const doc = button.ownerDocument;
            const panel = doc.getElementById(
                button.getAttribute('aria-controls')
            );
            const anchor = button.getBoundingClientRect();
            const area = panel.getBoundingClientRect();
            const action = [...panel.querySelectorAll('button')].find(
                (item) => item.textContent === 'Supprimer'
            );
            const bounds = action.getBoundingClientRect();
            return {
                flipped: area.bottom <= anchor.top - 3.5,
                shifted:
                    area.left < anchor.left &&
                    area.right <= doc.documentElement.clientWidth - 3.5,
                hittable:
                    doc
                        .elementFromPoint(
                            bounds.left + bounds.width / 2,
                            bounds.top + bounds.height / 2
                        )
                        ?.closest('button') === action,
            };
        });
        assert.deepEqual(collision, {
            flipped: true,
            shifted: true,
            hittable: true,
        });
        // Move the opener without a resize, scroll, or button size change.
        await page.locator('#target').evaluate((row) => {
            row.style.transform = 'translateX(-120px)';
        });
        await page.waitForFunction(() => {
            const target = document.querySelector('#target');
            const button = target.querySelector('button');
            const panel = document.getElementById(
                button.getAttribute('aria-controls')
            );
            return (
                Math.abs(
                    panel.getBoundingClientRect().left -
                        button.getBoundingClientRect().left
                ) < 1
            );
        });
        await popup.getByRole('button', { name: 'Supprimer' }).click();
        await confirm.waitFor();
        await page.keyboard.press('Enter');
        await confirm.waitFor({ state: 'hidden' });
        assert.equal(await focused(opener), true);
        assert.deepEqual(await counts(), { ...settled, comments: ['current'] });
        const finalActions = await counts();

        // The normal inline consumer remains operative when top layer support
        // is absent. Model the missing API before the package mounts.
        await page.addInitScript(() => {
            Object.defineProperty(HTMLElement.prototype, 'showPopover', {
                configurable: true,
                value: undefined,
            });
        });
        await page.reload();
        await page.locator('#panel').evaluate((node) => {
            node.style.overflow = 'visible';
        });
        const fallbackOpener = await opener.elementHandle();
        await opener.press('Enter');
        await popup.waitFor();
        const fallback = await popup.evaluate((node) => ({
            inline: !node.hasAttribute('popover'),
            positioned: getComputedStyle(node).position === 'absolute',
        }));
        assert.deepEqual(fallback, { inline: true, positioned: true });
        assert.equal((await readPoint()).hit, true);
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        assert.equal(await focused(deleteAction), true);
        await page.keyboard.press('Enter');
        await confirm.waitFor();
        await page.keyboard.press('Enter');
        await confirm.waitFor({ state: 'hidden' });
        assert.equal(await focused(fallbackOpener), true);
        assert.deepEqual(await counts(), noop);

        assert.deepEqual(pageErrors, []);
        assert.deepEqual(unexpectedRequests, []);
        Object.assign(evidence, {
            status: 'passed',
            clipped: points,
            unclipped: control,
            cancelRestoredFocus: true,
            pointerCancelCounts: noop,
            finalActions,
            staleReplacementFocus: false,
            staleConfirmationRequests: 0,
            staleCommentsHandoffs: 0,
            fallback: { ...fallback, cancelRestoredFocus: true, actions: noop },
            hostModalCollision: { ...collision, trackedMovedOpener: true },
            screenshots: [
                {
                    file: clipped,
                    sha256: hash(readFileSync(join(output, clipped))),
                },
                {
                    file: unclipped,
                    sha256: hash(readFileSync(join(output, unclipped))),
                },
            ],
        });
        console.log(
            'Installed Form record actions passed clipped pointer and keyboard, current and retired owners, and one settled allocation.'
        );
    } catch (error) {
        Object.assign(evidence, { status: 'failed', error: String(error) });
        throw error;
    } finally {
        try {
            try {
                await context?.close();
            } finally {
                try {
                    if (server?.listening)
                        await new Promise((resolve, reject) =>
                            server.close((error) =>
                                error ? reject(error) : resolve()
                            )
                        );
                } finally {
                    if (directory)
                        rmSync(directory, { recursive: true, force: true });
                }
            }
            evidence.cleanup = 'completed';
        } catch (error) {
            Object.assign(evidence, {
                status: 'failed',
                cleanupError: String(error),
            });
            throw error;
        }
    }
}
