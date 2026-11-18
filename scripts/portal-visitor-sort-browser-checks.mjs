import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const fixture = `
import { createElement as h, StrictMode, version } from 'react';
import { createRoot } from 'react-dom/client';
import { PortalVisitorSort } from '@miniextensions/sdk/react';
let frame = {
    stamp: {
        sessionId: 'session', fieldId: 'portal', viewId: 'view-a',
        configurationRevision: 1, metadataRevision: 1, generation: 1,
    },
    fields: [{id:'title',name:'Title'}, {id:'detail',name:'Detail'}],
    criteria: [],
};
const listeners = new Set();
const commands = [];
const outcomes = [];
let submits = 0;
function publish(next) {
    frame = next;
    for (const listener of listeners) listener();
}
function allocate(command) {
    commands.push(command);
    return 'request-' + commands.length;
}
const port = {
    read: () => frame,
    subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    apply(command) {
        if (command.stamp.generation !== frame.stamp.generation)
            return {type:'stale'};
        const requestId = allocate(command);
        const generation = frame.stamp.generation + 1;
        publish({ ...frame, stamp:{ ...frame.stamp, generation }, criteria:command.criteria });
        return {type:'allocated', requestId, generation};
    },
};
document.querySelector('form').addEventListener('submit', (event) => {
    submits++;
    event.preventDefault();
});
const root = createRoot(document.getElementById('root'));
root.render(h(StrictMode, null, h(PortalVisitorSort, {port, onOutcome: (outcome) => outcomes.push(outcome)})));
globalThis.sortFixture = {
    summary: () => ({ version, commands, outcomes, listeners:listeners.size, submits }),
    cycleViews() {
        const change = (viewId) => publish({
            ...frame,
            stamp: { ...frame.stamp, viewId, generation:frame.stamp.generation + 1 },
        });
        change('view-b');
        change('view-a');
    },
    unmount: () => root.unmount(),
};
`;

const searchFixture = `
import { PortalVisitorSearch } from '@miniextensions/sdk/react';
const searchHost = document.createElement('section');
document.querySelector('form').append(searchHost);
const searchRoot = createRoot(searchHost);
const searchListeners = new Set();
const searchCommands = [];
const searchOutcomes = [];
let scan;
let searchReadFails = false;
let searchFrame = {
    stamp: {...frame.stamp, fieldId: 'search-portal'},
    searchTerm: 'previous',
    publicationRevision: 0,
};
function publishSearch(next) {
    searchFrame = next;
    for (const listener of searchListeners) listener();
}
const searchPort = {
    read() {
        if (searchReadFails) {
            searchReadFails = false;
            throw new Error('temporary search read failure');
        }
        return searchFrame;
    },
    subscribe(listener) {
        searchListeners.add(listener);
        return () => searchListeners.delete(listener);
    },
    apply(command) {
        if (command.stamp.generation !== searchFrame.stamp.generation ||
            command.expectedSearchTerm !== searchFrame.searchTerm ||
            command.expectedPublicationRevision !== searchFrame.publicationRevision)
            return {type:'stale'};
        searchCommands.push(command);
        const unchanged = command.searchTerm === searchFrame.searchTerm;
        const generation = searchFrame.stamp.generation + Number(unchanged);
        const receipt = {type:'allocated', requestId:'search-' + searchCommands.length, generation};
        if (unchanged) {
            publishSearch({...searchFrame, stamp:{...searchFrame.stamp, generation}});
            return receipt;
        }
        const revision = searchFrame.publicationRevision + 1;
        publishSearch({
            ...searchFrame,
            searchTerm: command.searchTerm,
            publicationRevision: revision,
        });
        return {...receipt, committedPublication:{generation, revision}};
    },
};
searchRoot.render(h(StrictMode, null, h(PortalVisitorSearch, {
    port: searchPort,
    onOutcome: (outcome) => searchOutcomes.push(outcome),
    labels: {input: 'Find records', submit: 'Submit search'},
    renderScanner: ({capture, disabled}) => h('button', {
        type: 'button',
        disabled,
        'data-search-generation': searchFrame.stamp.generation,
        'data-search-revision': searchFrame.publicationRevision,
        onClick: () => { scan = capture(); },
    }, 'Open scanner'),
})));
globalThis.searchFixture = {
    summary: () => ({commands:searchCommands, outcomes:searchOutcomes, listeners:searchListeners.size}),
    failNextRead() { searchReadFails = true; },
    hasCurrentInput(value) {
        return searchHost.querySelector('input')?.value === value &&
            Number(searchHost.querySelector('[data-search-generation]')?.dataset.searchGeneration) === searchFrame.stamp.generation &&
            Number(searchHost.querySelector('[data-search-revision]')?.dataset.searchRevision) === searchFrame.publicationRevision;
    },
    rotate() {
        for (const viewId of ['view-b', 'view-a'])
            publishSearch({
                ...searchFrame,
                stamp: {...searchFrame.stamp, viewId, generation:searchFrame.stamp.generation + 1},
                publicationRevision: searchFrame.publicationRevision + 1,
            });
    },
    scan: (value) => scan?.(value),
    unmount: () => searchRoot.unmount(),
};
`;

async function checkSearch(page) {
    const entry = page.getByRole('textbox', { name: 'Find records' });
    const scanner = page.getByRole('button', { name: 'Open scanner' });
    const search = () =>
        page.evaluate(() => globalThis.searchFixture.summary());
    const waitForTerm = (term) =>
        page.waitForFunction(
            (value) => globalThis.searchFixture.hasCurrentInput(value),
            term
        );
    await entry.fill('  café  ');
    assert.deepEqual((await search()).commands, []);
    await entry.press('Enter');
    await waitForTerm('  café  ');
    const submit = page.getByRole('button', { name: 'Submit search' });
    await page.evaluate(() => globalThis.searchFixture.failNextRead());
    await submit.press('Enter');
    assert.equal((await search()).commands.length, 1);
    assert.equal(await submit.isEnabled(), true);
    await submit.press('Enter');
    assert.equal((await search()).commands.length, 2);
    await page.waitForFunction(
        () => globalThis.searchFixture.summary().outcomes.length === 2
    );
    await scanner.press('Enter');
    await page.evaluate(() => {
        globalThis.searchFixture.rotate();
        globalThis.searchFixture.scan('stale camera result');
    });
    assert.equal((await search()).commands.length, 2);
    await waitForTerm('  café  ');
    await scanner.press('Enter');
    await page.evaluate(() => {
        globalThis.searchFixture.scan('  001-α  ');
        globalThis.searchFixture.scan('duplicate camera result');
    });
    await waitForTerm('  001-α  ');
    assert.equal((await search()).commands.length, 3);
    await page.getByRole('button', { name: 'Clear search' }).press('Enter');
    await waitForTerm('');
    assert.equal(await entry.inputValue(), '');
    await page.waitForFunction(
        () => globalThis.searchFixture.summary().outcomes.length === 4
    );
    const { commands, outcomes } = await search();
    assert.deepEqual(
        commands.map(
            ({
                source,
                expectedSearchTerm,
                expectedPublicationRevision,
                searchTerm,
            }) => [
                source,
                expectedSearchTerm,
                expectedPublicationRevision,
                searchTerm,
            ]
        ),
        [
            ['submit', 'previous', 0, '  café  '],
            ['submit', '  café  ', 1, '  café  '],
            ['scan', '  café  ', 3, '  001-α  '],
            ['clear', '  001-α  ', 4, ''],
        ]
    );
    assert.deepEqual(
        outcomes.map((outcome) => [
            outcome.type,
            outcome.committedPublication?.revision,
        ]),
        [
            ['allocated', 1],
            ['allocated', undefined],
            ['allocated', 4],
            ['allocated', 5],
        ]
    );
    assert.equal(outcomes[1].generation, outcomes[0].generation + 1);
    await page.evaluate(() => globalThis.searchFixture.unmount());
    assert.equal((await search()).listeners, 0);
    return {
        commands: commands.length,
        staleScanRejected: true,
        transientReadRecovered: true,
        sameTermGenerationReported: true,
        cleanup: 'completed',
    };
}

/** Exercise trusted keyboard events on an installed, synthetic host fixture. */
export async function checkPortalVisitorSortBrowser({
    browser,
    consumer,
    evidence,
    expectedReactVersion,
    includeSearch = false,
}) {
    const scratch = mkdtempSync(join(consumer, 'visitor-sort-browser-'));
    let context;
    let server;
    const external = [];
    const requests = [];
    const errors = [];
    const cleanup = {};
    Object.assign(evidence, {
        external,
        requests,
        errors,
        cleanup,
        passed: false,
    });
    try {
        const entry = join(scratch, 'fixture.mjs');
        writeFileSync(entry, includeSearch ? fixture + searchFixture : fixture);
        const bundle = await build({
            absWorkingDir: consumer,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'iife',
            outfile: join(scratch, 'app.js'),
            metafile: true,
            write: false,
            define: { 'process.env.NODE_ENV': '"production"' },
        });
        await assertBrowserInputs(bundle.metafile, consumer);
        const app = bundle.outputFiles[0].contents;
        server = createServer((request, response) => {
            if (request.url === '/') {
                response.setHeader('content-type', 'text/html; charset=utf-8');
                response.end(
                    '<!doctype html><html><head><title>Portal visitor sort fixture</title><link rel="icon" href="data:,"><script defer src="/app.js"></script></head><body><form><main id="root"></main></form></body></html>'
                );
            } else if (request.url === '/app.js') {
                response.setHeader(
                    'content-type',
                    'text/javascript; charset=utf-8'
                );
                response.end(app);
            } else {
                response.writeHead(404).end();
            }
        });
        await new Promise((done, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', done);
        });
        const origin = 'http://127.0.0.1:' + server.address().port;
        evidence.origin = origin;
        context = await browser.newContext({ serviceWorkers: 'block' });
        context.setDefaultTimeout(5000);
        await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (
                url.origin === origin &&
                ['/', '/app.js'].includes(url.pathname)
            )
                return route.continue();
            external.push(url.href);
            return route.abort();
        });
        context.on('request', (request) => {
            if (['xhr', 'fetch'].includes(request.resourceType()))
                requests.push(request.url());
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
            if (['warning', 'error'].includes(message.type()))
                errors.push(message.text());
        });
        await page.goto(origin);
        const summary = () =>
            page.evaluate(() => globalThis.sortFixture.summary());
        const trigger = page.getByRole('button', { name: 'Sort', exact: true });
        const dialog = page.getByRole('dialog');
        const add = dialog.getByRole('button', { name: 'Add sort condition' });
        const done = dialog.getByRole('button', { name: 'Done' });
        const open = async () => {
            await trigger.press('Enter');
            await dialog.waitFor({ state: 'visible' });
            assert.equal(
                await page.evaluate(() => document.activeElement.textContent),
                'Sort records'
            );
        };
        await open();
        await dialog
            .getByRole('button', { name: 'Close', exact: true })
            .press('Shift+Tab');
        assert.equal(
            await page.evaluate(() => document.activeElement.textContent),
            'Done'
        );
        await page.keyboard.press('Tab');
        assert.equal(
            await page.evaluate(() => document.activeElement.textContent),
            'Close'
        );
        await add.press('Enter');
        await add.press('Enter');
        assert.equal(
            await page.evaluate(() =>
                document.activeElement.getAttribute('aria-label')
            ),
            'Field 2'
        );
        await dialog
            .getByRole('combobox', { name: 'Direction 2' })
            .selectOption('desc');
        assert.deepEqual(
            await dialog
                .locator('select[aria-label^="Field"]')
                .evaluateAll((selects) =>
                    selects.map((select) => select.value)
                ),
            ['title', 'detail']
        );
        assert.deepEqual((await summary()).commands, []);
        await done.press('Enter');
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(
            () => document.activeElement.textContent === 'Sort'
        );
        assert.deepEqual(
            (await summary()).commands[0].criteria.map(
                (rule) => rule.idOrName.id
            ),
            ['title', 'detail']
        );
        assert.deepEqual(
            (await summary()).commands[0].criteria.map((rule) => rule.type),
            ['asc', 'desc']
        );
        assert.deepEqual((await summary()).outcomes, [
            { type: 'allocated', requestId: 'request-1', generation: 2 },
        ]);

        await open();
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        assert.equal((await summary()).commands.length, 1);
        assert.equal((await summary()).outcomes.at(-1).type, 'unchanged');

        await open();
        await dialog
            .getByRole('button', { name: 'Delete sort condition 1' })
            .press('Enter');
        await page.evaluate(() => globalThis.sortFixture.cycleViews());
        await dialog.getByRole('status').waitFor({ state: 'visible' });
        await done.press('Enter');
        await dialog.waitFor({ state: 'hidden' });
        assert.equal((await summary()).commands.length, 1);
        assert.equal((await summary()).outcomes.at(-1).type, 'stale');

        await open();
        await dialog
            .getByRole('button', { name: 'Delete sort condition 1' })
            .press('Enter');
        await dialog
            .getByRole('button', { name: 'Close', exact: true })
            .press('Enter');
        await dialog.waitFor({ state: 'hidden' });
        if (includeSearch) {
            try {
                evidence.search = await checkSearch(page);
            } catch (error) {
                evidence.search = await page.evaluate(() =>
                    globalThis.searchFixture.summary()
                );
                throw error;
            }
        }
        const end = await summary();
        assert.equal(end.version, expectedReactVersion);
        assert.deepEqual(
            end.commands.map((command) =>
                command.criteria.map((rule) => rule.idOrName.id)
            ),
            [['title', 'detail'], ['detail']]
        );
        assert.equal(end.commands[1].criteria[0].type, 'desc');
        assert.equal(end.listeners, 0);
        assert.equal(end.submits, 0);
        assert.deepEqual(external, []);
        assert.deepEqual(requests, []);
        assert.deepEqual(errors, []);
        await page.evaluate(() => globalThis.sortFixture.unmount());
        Object.assign(evidence, {
            react: end.version,
            outcomes: end.outcomes,
            passed: true,
        });
    } finally {
        try {
            if (context) {
                await context.close();
                cleanup.context = 'completed';
            }
        } finally {
            try {
                if (server?.listening) {
                    server.closeAllConnections();
                    await new Promise((done, reject) =>
                        server.close((error) =>
                            error ? reject(error) : done()
                        )
                    );
                    cleanup.server = 'completed';
                }
            } finally {
                rmSync(scratch, { recursive: true });
                cleanup.scratch = 'completed';
            }
        }
    }
}
