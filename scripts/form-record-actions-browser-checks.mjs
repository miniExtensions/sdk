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

const counts = { requests: [], writes: [], allocations: [], comments: [] };
window.recordActionsProof = counts;
const labels = {
    deleteRecord: 'Supprimer', comments: 'Commentaires', openMenu: 'Options',
    confirmationTitle: 'Supprimer cet élément ?',
    irreversibleWarning: 'Cette action est irréversible.',
    confirmDelete: 'Supprimer', cancel: 'Annuler',
};
function row(id) {
    const scope = Object.freeze({ id });
    const controller = createFormRecordActionsController({
        read: () => ({ scope, delete: { visible: true, disabled: false, pending: false }, comments: { visible: true, disabled: false } }),
        subscribe: () => () => {},
        requestCurrentDelete() {
            const operationId = {};
            counts.requests.push(id);
            counts.writes.push(id);
            counts.allocations.push(id);
            return { status: 'allocated', operation: { id: operationId, settled: Promise.resolve({ status: 'acknowledged', operationId, localSettlement: 'applied' }) } };
        },
        openCurrentComments() { counts.comments.push(id); return 'handed-off'; },
    });
    return h('div', { id }, id, h(FormRecordActionsMenu, { controller, labels }));
}
createRoot(document.getElementById('panel')).render(h(React.StrictMode, null, row('decoy'), row('target')));
`;

const html = `<!doctype html><html lang="fr"><meta charset="utf-8">
<link rel="stylesheet" href="/actions.css"><style>
body {font:16px system-ui;margin:0}
#panel {position:absolute;top:30px;left:30px;width:284px;height:120px;border:2px solid #64748b;overflow:hidden;background:#f8fafc}
#decoy,#target {display:flex;align-items:center;gap:12px;position:absolute;left:12px}
#decoy {top:8px} #target {bottom:4px}
</style><main id="panel" aria-label="Panneau latéral"></main><script type="module" src="/proof.js"></script></html>`;

/** Baseline for the clipped disclosure, driven only by a synthetic host port. */
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
        await opener.press('Enter');
        await page
            .getByRole('group', { name: 'Options', exact: true })
            .waitFor({ state: 'attached' });
        const points = await opener.evaluate((button) => {
            const doc = button.ownerDocument;
            const popupId = button.getAttribute('aria-controls');
            const popup = doc.getElementById(popupId);
            const action = [...popup.querySelectorAll('button')].find(
                (item) => item.textContent === 'Supprimer'
            );
            const area = action.getBoundingClientRect();
            const panel = doc.getElementById('panel').getBoundingClientRect();
            const x = area.left + area.width / 2;
            const y = area.top + area.height / 2;
            return {
                popupId,
                x,
                y,
                panelBottom: panel.bottom,
                hit: doc.elementFromPoint(x, y)?.closest('button') === action,
            };
        });
        assert(
            points.y > points.panelBottom,
            'Fixture must put Supprimer outside the panel edge'
        );
        assert.equal(
            points.hit,
            false,
            'The main baseline clips the intended delete action'
        );
        const clipped = 'record-actions-clipped-baseline.png';
        await page.screenshot({ path: join(output, clipped) });
        await page.locator('#panel').evaluate((node) => {
            node.style.overflow = 'visible';
        });
        const control = await opener.evaluate((button, point) => {
            const doc = button.ownerDocument;
            const popup = doc.getElementById(point.popupId);
            const hit = doc
                .elementFromPoint(point.x, point.y)
                ?.closest('button');
            return hit?.textContent === 'Supprimer' && popup.contains(hit);
        }, points);
        assert.equal(
            control,
            true,
            'Same coordinates must hit target Supprimer when unclipped'
        );
        const unclipped = 'record-actions-unclipped-baseline.png';
        await page.screenshot({ path: join(output, unclipped) });
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        assert.equal(
            await page.evaluate(() => document.activeElement.textContent),
            'Supprimer'
        );
        await page.keyboard.press('Enter');
        const confirm = page.getByRole('alertdialog', {
            name: 'Supprimer cet élément ?',
        });
        await confirm.waitFor();
        assert.equal(
            await page.evaluate(() => document.activeElement.textContent),
            'Annuler'
        );
        await page.keyboard.press('Enter');
        await confirm.waitFor({ state: 'hidden' });
        assert.equal(
            await opener.evaluate(
                (button) => button.ownerDocument.activeElement === button
            ),
            true
        );
        assert.deepEqual(await page.evaluate(() => window.recordActionsProof), {
            requests: [],
            writes: [],
            allocations: [],
            comments: [],
        });
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(unexpectedRequests, []);
        Object.assign(evidence, {
            status: 'passed',
            baselineClipped: points,
            unclippedHit: control,
            cancelRestoredFocus: true,
            writes: 0,
            allocations: 0,
            screenshots: [clipped, unclipped],
        });
        console.log(
            'Installed Form record actions baseline reproduced clipping; unclipped control and keyboard Cancel passed.'
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
