import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';

const fixture = `
import { createElement as h, StrictMode, version } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { PortalSidePanelNavigation } from '@miniextensions/sdk/react';
import { findAdjacentChildSession } from '@miniextensions/sdk/ui';

const base = {
    type: 'side-panel',
    parentFormExtensionSessionId: 'parent',
    fieldIdOfLinkedRecordField: 'projects',
    linkedTableIdOfLinkedRecordField: 'project-table',
    parentExtensionAccessToken: 'synthetic',
    childExtensionAccessInfo: { childExtensionId: 'child' },
};
const records = {
    sessionA: { ...base, recordId: 'A', previousRecordId: null, nextRecordId: 'B' },
    sessionB: { ...base, recordId: 'B', previousRecordId: 'A', nextRecordId: 'C' },
    sessionC: { ...base, recordId: 'C', previousRecordId: 'B', nextRecordId: null },
};
const labels = { previous: 'Précédent', next: 'Suivant', group: 'Navigation des fiches' };
const root = createRoot(document.getElementById('root'));
const opens = [];
const dismissals = [];
let submissions = 0;
let frame = null;
let icons;
let heldFocus = null;
document.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    submissions++;
});
const isCurrent = (request) =>
    frame !== null &&
    request.ownerToken === frame.ownerToken &&
    request.sourceRecordId === frame.sourceRecordId &&
    request.sourceExtensionSessionId === frame.sourceExtensionSessionId &&
    request.recordId === (request.type === 'next' ? frame.nextRecordId : frame.previousRecordId);
const props = {
    labels, isCurrent,
    confirmDismissal(request) {
        return new Promise(resolve => dismissals.push({request, resolve}));
    },
    openAdjacent(request) {
        if (request.signal.aborted || !isCurrent(request)) throw Error('Stale open');
        const session = findAdjacentChildSession(records, request);
        if (!session) throw Error('Missing synthetic target');
        opens.push({type:request.type, recordId:request.recordId, session});
    },
};
const render = () => flushSync(() => root.render(
    h(StrictMode, null, h(PortalSidePanelNavigation, { ...props, frame, icons }))
));
function offer(presented, neighbors = true) {
    const sourceExtensionSessionId = 'session' + presented;
    const offered = records[sourceExtensionSessionId];
    frame = offered ? {
        ownerToken: {},
        sourceExtensionSessionId,
        sourceRecordId: offered.recordId,
        previousRecordId: neighbors ? offered.previousRecordId : null,
        nextRecordId: neighbors ? offered.nextRecordId : null,
    } : null;
    render();
}
offer('B');
globalThis.adjacentNavigation = {
    offer,
    useIcons: () => {
        icons = {
            previous: h('svg', { viewBox: '0 0 16 16' }, h('path', { d: 'M3 10l5-5 5 5' })),
            next: h('svg', { viewBox: '0 0 16 16' }, h('path', { d: 'M3 6l5 5 5-5' })),
        };
        render();
    },
    retainFocus: () => { heldFocus = document.activeElement; },
    unmount: () => { root.unmount(); },
    async resolve(index, accept) {
        if (!dismissals[index]) throw Error('No dismissal');
        dismissals[index].resolve(accept);
        await Promise.resolve();
    },
    summary: () => ({
        version,
        opens,
        submissions,
        focused: heldFocus !== null && heldFocus === document.activeElement,
        dismissals: dismissals.map(({ request }) => ({
            direction: request.type,
            recordId: request.recordId,
            source: request.sourceRecordId,
            aborted: request.signal.aborted,
        })),
    }),
};
`;

export async function checkPortalSidePanelNavigationBrowser({
    browser,
    consumer,
    evidence,
    expectedReactVersion,
}) {
    const compiled = await build({
        stdin: {
            contents: fixture,
            resolveDir: consumer,
            sourcefile: 'portal-side-panel-navigation-browser.mjs',
        },
        bundle: true,
        format: 'iife',
        platform: 'browser',
        write: false,
    });
    const server = createServer((request, response) => {
        if (request.url === '/fixture.js') {
            response.setHeader('content-type', 'text/javascript');
            response.end(compiled.outputFiles[0].contents);
            return;
        }
        if (request.url !== '/') {
            response.writeHead(404).end();
            return;
        }
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(
            '<!doctype html><form><main id="root"></main></form><script src="/fixture.js"></script>'
        );
    });
    let context;
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const origin = 'http://127.0.0.1:' + server.address().port;
        context = await browser.newContext();
        const blockedRequests = [];
        const writes = [];
        await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (route.request().method() !== 'GET') {
                writes.push({ origin: url.origin, path: url.pathname });
                return route.abort();
            }
            if (url.origin === origin) return route.continue();
            blockedRequests.push({ origin: url.origin });
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.goto(origin);
        const previous = page.getByRole('button', {
            name: 'Précédent',
            exact: true,
        });
        const next = page.getByRole('button', { name: 'Suivant', exact: true });
        const report = () =>
            page.evaluate(() => globalThis.adjacentNavigation.summary());
        const offer = (record, neighbors = true) =>
            page.evaluate(
                ([id, hasNeighbors]) =>
                    globalThis.adjacentNavigation.offer(id, hasNeighbors),
                [record, neighbors]
            );
        const resolve = (index, accept) =>
            page.evaluate(
                ([i, value]) => globalThis.adjacentNavigation.resolve(i, value),
                [index, accept]
            );
        const waitDismissals = (count) =>
            page.waitForFunction(
                (expected) =>
                    globalThis.adjacentNavigation.summary().dismissals
                        .length === expected,
                count
            );
        await next.waitFor();
        assert.equal((await report()).version, expectedReactVersion);
        assert.equal(await previous.getAttribute('type'), 'button');
        assert.equal(await next.getAttribute('type'), 'button');
        assert.equal(await previous.textContent(), 'Précédent');
        assert.equal(await next.textContent(), 'Suivant');
        await next.focus();
        await page.evaluate(() => globalThis.adjacentNavigation.retainFocus());
        await page.evaluate(() => globalThis.adjacentNavigation.useIcons());
        assert.equal((await report()).focused, true);
        assert.equal(await previous.textContent(), '');
        assert.equal(await next.textContent(), '');
        const hiddenIcon = 'span[aria-hidden="true"] > svg path';
        assert.equal(
            await previous.locator(hiddenIcon).getAttribute('d'),
            'M3 10l5-5 5 5'
        );
        assert.equal(
            await next.locator(hiddenIcon).getAttribute('d'),
            'M3 6l5 5 5-5'
        );

        await next.press('Enter');
        await waitDismissals(1);
        assert.deepEqual((await report()).dismissals[0], {
            direction: 'next',
            recordId: 'C',
            source: 'B',
            aborted: false,
        });
        await offer('B');
        assert.equal((await report()).focused, true);
        await resolve(0, true);
        assert.equal((await report()).dismissals[0].aborted, true);
        assert.deepEqual((await report()).opens, []);

        await next.press('Enter');
        await waitDismissals(2);
        await resolve(1, true);
        assert.deepEqual((await report()).opens, [
            { type: 'next', recordId: 'C', session: 'sessionC' },
        ]);

        await previous.click();
        await waitDismissals(3);
        await resolve(2, true);
        await previous.press('Space');
        await waitDismissals(4);
        await resolve(3, true);
        const opened = [
            { type: 'next', recordId: 'C', session: 'sessionC' },
            { type: 'previous', recordId: 'A', session: 'sessionA' },
            { type: 'previous', recordId: 'A', session: 'sessionA' },
        ];
        assert.deepEqual((await report()).opens, opened);

        await next.press('Enter');
        await waitDismissals(5);
        await resolve(4, false);
        assert.deepEqual((await report()).opens, opened);

        await offer('A');
        assert(await previous.isDisabled());
        assert(await next.isEnabled());
        await offer('C');
        assert(await previous.isEnabled());
        assert(await next.isDisabled());
        await offer('B', false);
        assert.equal(await page.getByRole('button').count(), 0);
        await offer(null);
        assert.equal(await page.getByRole('button').count(), 0);

        await offer('B');
        await next.focus();
        await page.keyboard.down('Space');
        await offer('B');
        await page.keyboard.up('Space');
        assert.equal((await report()).dismissals.length, 5);
        await next.press('Enter');
        await waitDismissals(6);
        await page.evaluate(() => globalThis.adjacentNavigation.unmount());
        await resolve(5, true);
        const result = await report();
        assert.deepEqual(result.opens, opened);
        assert.equal(result.dismissals[5].aborted, true);
        assert.equal(result.submissions, 0);
        assert.deepEqual(writes, []);
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(blockedRequests, []);
        Object.assign(evidence, {
            passed: true,
            reactVersion: result.version,
            opens: result.opens,
            dismissals: result.dismissals,
            formSubmits: 0,
            recordMutations: writes.length,
            pageErrors,
            blockedRequests,
        });
    } finally {
        try {
            if (context) {
                await context.close();
                evidence.contextClosed = true;
            }
        } finally {
            if (server.listening) {
                await new Promise((resolve, reject) =>
                    server.close((error) => (error ? reject(error) : resolve()))
                );
                evidence.serverClosed = true;
            }
        }
    }
}
