import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { readonlyPortalListFixture } from './readonly-portal-list-fixture.mjs';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixture = String.raw`
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import * as api from '@miniextensions/sdk/react';import * as ui from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/readonly-portal-list.css';import'@miniextensions/sdk/react/readonly-portal-grid.css';import{createListFixture}from'./fixture.mjs';
const h=React.createElement,f=createListFixture(ui),root=createRoot(document.querySelector('#root'));
const proof={opens:[],submits:0,held:0,retiredRefusals:0,presenterStarts:0,presenterActive:0,preferences:[],nestedActivations:0};window.proof=proof;
const scope={getSnapshot:()=>f.scope.getSnapshot(),subscribe(listener){proof.presenterStarts++;proof.presenterActive++;const stop=f.scope.subscribe(listener);return()=>{proof.presenterActive--;stop();};}};
let layout='list',preview=false,noChild=false,hold=false,pending,child=null,commands;
const namingEntryPoint = new URLSearchParams(location.search).get('list-entry');
let namedRows = false, nullBetaLabel = false;
const rowLabels = {rec_A: 'Account North', rec_B: 'Account South', rec_C: 'Account West'};
const replacement = {id: 'rec_C', fields: {fld_title: 'Gamma', fld_detail: 'C detail'}};
function recordLabel(recordId) {
    return recordId === 'rec_B' && nullBetaLabel ? null : (rowLabels[recordId] ?? null);
}
function replaceAlpha() {
    const records = f.scope.getSnapshot().rows.map(({recordId}) =>
        recordId === 'rec_A' || recordId === 'rec_C'
            ? replacement
            : f.initial.records.find(({id}) => id === recordId)
    );
    change(() => f.replace({...f.initial, records}));
}
let hiddenColumns={},columnWidths={fld_title:211,fld_detail:235};
const renderers = {
    renderSingleLineTextField(field) {
        if (field.capability.type !== 'readonly') throw new Error('Editable Portal cell');
        const value = String(field.value ?? '');
        return h('span', null, value, value === 'B detail' && h('button', {
            type: 'button', 'aria-label': 'Inspect detail',
            onClick(event) { event.stopPropagation(); proof.nestedActivations++; },
        }));
    },
};
function publishCommands(){const snapshot=f.scope.getSnapshot();commands=new Map(snapshot.rows.map(row=>[row.recordId,{revision:snapshot.revision,activate(isCurrent,restore){const invoke=()=>{if(!isCurrent()){proof.retiredRefusals++;return;}void snapshot.actions.openChild(row.recordId);proof.opens.push(row.recordId);child={recordId:row.recordId,isCurrent,restore};render();};if(hold){pending=invoke;proof.held++;}else invoke();}}]));}
function change(update){update();publishCommands();render();}
function navigate(delta){if(!child?.isCurrent())return;const snapshot=f.scope.getSnapshot(),index=snapshot.rows.findIndex(row=>row.recordId===child.recordId),next=snapshot.rows[index+delta];if(!next)return;void snapshot.actions.openChild(next.recordId);proof.opens.push(next.recordId);child={...child,recordId:next.recordId};render();}
function close(){const previous=child;child=null;render();previous?.restore();}
function button(label,action){return h('button',{type:'button',onClick:action},label);}
function render(){
 const actions=preview||noChild?undefined:commands;
 const listProps={scope,renderers,label:'Accepted records',recordLabel:namedRows?recordLabel:undefined};
 flushSync(()=>root.render(h(React.StrictMode,null,h('form',{onSubmit(event){event.preventDefault();proof.submits++;}},
 h('nav',{'aria-label':'Synthetic host controls'},button('List',()=>{layout='list';render();}),button('Grid',()=>{layout='grid';render();}),button('Reverse',()=>change(()=>f.replace({...f.initial,records:[...f.initial.records].reverse()}))),button('Empty',()=>change(()=>f.replace({...f.initial,records:[]}))),button('Reset',()=>change(()=>{preview=false;noChild=false;hold=false;child=null;f.replace();})),button('Preview',()=>{preview=!preview;render();}),button('No child',()=>{noChild=!noChild;render();}),button('Hold Open',()=>{hold=true;}),button('Release Open',()=>{hold=false;const invoke=pending;pending=undefined;invoke?.();}),button('Retire',()=>change(()=>f.replace(null)))),
 namingEntryPoint && h('nav',{'aria-label':'List row naming controls'},
    button('Name rows', () => {namedRows = true; render();}),
    button('Toggle Beta name', () => {nullBetaLabel = !nullBetaLabel; render();}),
    button('Replace Alpha', replaceAlpha)),
 namingEntryPoint === 'ReadonlyPortalList' ? h(api.ReadonlyPortalList,{...listProps,openActions:actions}) : h(api.ReadonlyPortalRecords, {
    ...listProps, layout,
    openActions: actions && { scope, byRecordId: actions },
    grid: {
        ready: true, preferenceScopeKey: 'portal/field/view', primaryFieldId: 'fld_title',
        hiddenColumns, columnWidths, allowHideColumns: true, labels: { caption: 'Accepted grid' },
        onFieldHiddenChange(change) {
            proof.preferences.push(change);
            hiddenColumns = { ...hiddenColumns, [change.fieldId]: change.isHidden };
            queueMicrotask(render);
        },
        onColumnWidthCommit(change) {
            proof.preferences.push(change);
            columnWidths = { ...columnWidths, [change.fieldId]: change.width };
            queueMicrotask(render);
        },
    },
 }),
 child?h('section',{role:'dialog','aria-label':'Synthetic native child'},h('h2',null,'Child '+child.recordId),button('Previous',()=>navigate(-1)),button('Next',()=>navigate(1)),button('Close',close)):null))));}
window.listProofSnapshot=()=>({react:React.version,opens:[...proof.opens],submits:proof.submits,held:proof.held,retiredRefusals:proof.retiredRefusals,subscriptions:f.subscriptions,presenterStarts:proof.presenterStarts,presenterActive:proof.presenterActive,preferences:[...proof.preferences],nestedActivations:proof.nestedActivations,scopeCalls:f.calls.map(call=>({...call})),layout});
publishCommands();render();
`;

async function checkNamedRows(page, origin, entryPoint) {
    await page.goto(`${origin}/?list-entry=${entryPoint}`);
    const control = (name) => page.getByRole('button', { name, exact: true });
    const list = page.getByRole('list', {
        name: 'Accepted records',
        exact: true,
    });
    const items = list.getByRole('listitem');
    const item = (recordId) => list.locator(`li[data-record-id="${recordId}"]`);
    const group = (recordId, name) =>
        item(recordId).getByRole('group', { name, exact: true });
    const open = (recordId, name) =>
        group(recordId, name).getByRole('button', {
            name: `Open record ${name}`,
            exact: true,
        });
    const acceptedOrder = () =>
        items.evaluateAll((rows) => rows.map((row) => row.dataset.recordId));
    const snapshot = () => page.evaluate(() => window.listProofSnapshot());
    await list.waitFor();
    assert.deepEqual(await acceptedOrder(), ['rec_B', 'rec_A']);
    assert.equal(await list.getByRole('group').count(), 0);
    assert.equal(
        await list
            .getByRole('button', { name: 'Open record', exact: true })
            .count(),
        2
    );

    await control('Name rows').click();
    const alpha = group('rec_A', 'Account North');
    const beta = group('rec_B', 'Account South');
    assert.deepEqual(await alpha.locator('[data-field-id]').allTextContents(), [
        'Alpha',
        'A detail',
    ]);
    assert.deepEqual(await beta.locator('[data-field-id]').allTextContents(), [
        'Beta',
        'B detail',
    ]);
    const alphaOpen = open('rec_A', 'Account North');
    const betaOpen = open('rec_B', 'Account South');
    await alphaOpen.focus();
    assert(await alphaOpen.evaluate((node) => document.activeElement === node));
    assert.equal(await alphaOpen.textContent(), 'Open record');

    await control('Reverse').click();
    assert.deepEqual(await acceptedOrder(), ['rec_A', 'rec_B']);
    assert.equal(await alpha.count(), 1);
    assert.equal(await beta.count(), 1);
    await control('Replace Alpha').click();
    assert.deepEqual(await acceptedOrder(), ['rec_C', 'rec_B']);
    assert.equal(
        await list.getByRole('group', { name: 'Account North' }).count(),
        0
    );
    assert.equal(
        await group('rec_C', 'Account West')
            .getByText('Gamma', { exact: true })
            .count(),
        1
    );

    await control('Toggle Beta name').click();
    assert.equal(await beta.count(), 0);
    assert.equal(
        await item('rec_B')
            .getByRole('button', { name: 'Open record', exact: true })
            .count(),
        1
    );
    await control('Toggle Beta name').click();
    for (const mode of ['Preview', 'No child']) {
        await control(mode).click();
        assert.equal(await beta.count(), 1);
        assert.equal(
            await list.getByRole('button', { name: /^Open record/ }).count(),
            0
        );
        await control(mode).click();
    }

    await betaOpen.focus();
    assert(await betaOpen.evaluate((node) => document.activeElement === node));
    assert.equal(await betaOpen.textContent(), 'Open record');
    const before = await snapshot();
    assert.deepEqual(before.opens, []);
    assert.deepEqual(before.scopeCalls, []);
    assert.equal(before.submits, 0);
    await page.keyboard.press('Enter');
    await page
        .getByRole('heading', { name: 'Child rec_B', exact: true })
        .waitFor();
    await control('Close').click();
    assert(await betaOpen.evaluate((node) => document.activeElement === node));
    const after = await snapshot();
    assert.deepEqual(after.opens, ['rec_B']);
    assert.deepEqual(
        after.scopeCalls.map(({ recordId }) => recordId),
        ['rec_B']
    );
    assert.equal(after.submits, 0);
    return {
        entryPoint,
        rowLabels: ['Account North', 'Account South', 'Account West'],
        focusedOpenNames: [
            'Open record Account North',
            'Open record Account South',
        ],
        opens: after.opens,
        submits: after.submits,
    };
}

export async function checkReadonlyPortalListBrowser({
    browser,
    consumer,
    evidence,
    output,
    expectedReactVersion,
}) {
    const temporary = realpathSync(
        mkdtempSync(join(consumer, 'readonly-list-proof-'))
    );
    assert(['18.3.1', '19.2.0'].includes(expectedReactVersion));
    const version = expectedReactVersion;
    let server;
    try {
        writeFileSync(
            join(temporary, 'fixture.mjs'),
            readonlyPortalListFixture
        );
        writeFileSync(join(temporary, 'browser.mjs'), fixture);
        const assets = new Map();
        server = createServer((request, response) => {
            const path = new URL(request.url, 'http://localhost').pathname;
            if (path === '/') {
                response.setHeader('content-type', 'text/html');
                response.end(
                    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><script defer src="/app.js"></script></head><body><main id="root"></main></body></html>'
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
        const port = server.address().port,
            origin = `http://127.0.0.1:${port}`;
        evidence.origin = origin;
        const bundle = await build({
            absWorkingDir: consumer,
            entryPoints: [relative(consumer, join(temporary, 'browser.mjs'))],
            bundle: true,
            platform: 'browser',
            format: 'iife',
            outdir: join(temporary, 'bundle'),
            entryNames: 'app',
            write: false,
            metafile: true,
            define: { 'process.env.NODE_ENV': '"production"' },
        });
        await assertBrowserInputs(bundle.metafile, consumer);
        assets.clear();
        for (const file of bundle.outputFiles)
            assets.set('/' + file.path.split('/').at(-1), file.contents);
        const context = await browser.newContext({
            viewport: { width: 1180, height: 900 },
        });
        context.setDefaultTimeout(5000);
        const page = await context.newPage(),
            errors = [],
            warnings = [],
            external = [],
            transport = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
            if (['warning', 'error'].includes(message.type()))
                warnings.push({ type: message.type(), text: message.text() });
        });
        context.on('request', (request) => {
            if (['xhr', 'fetch'].includes(request.resourceType()))
                transport.push({
                    method: request.method(),
                    url: request.url(),
                });
        });
        await context.route('**/*', (route) => {
            if (new URL(route.request().url()).origin === origin)
                return route.continue();
            external.push(route.request().url());
            return route.abort();
        });
        Object.assign(evidence, {
            react: version,
            errors,
            warnings,
            external,
            transport,
            passed: false,
        });
        const profile = evidence;
        try {
            await page.goto(origin);
            const rows = page.locator('.mx-sdk-readonly-portal-list__row');
            await rows.first().waitFor({ state: 'visible', timeout: 5000 });
            assert.deepEqual(await rows.allTextContents(), [
                'BetaB detailOpen record',
                'AlphaA detailOpen record',
            ]);
            const opens = page.getByRole('button', {
                name: 'Open record',
                exact: true,
            });
            await opens.first().click();
            const dialog = page.getByRole('dialog', {
                name: 'Synthetic native child',
            });
            await dialog
                .getByRole('heading', { name: 'Child rec_B' })
                .waitFor();
            await dialog
                .getByRole('button', { name: 'Next', exact: true })
                .click();
            await dialog
                .getByRole('heading', { name: 'Child rec_A' })
                .waitFor();
            await dialog
                .getByRole('button', { name: 'Previous', exact: true })
                .click();
            await dialog
                .getByRole('heading', { name: 'Child rec_B' })
                .waitFor();
            await dialog
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            assert.equal(
                await opens
                    .first()
                    .evaluate((node) => document.activeElement === node),
                true
            );
            await page.keyboard.press('Enter');
            await dialog.waitFor();
            await dialog
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            await page.keyboard.press('Space');
            await dialog.waitFor();
            await dialog
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            for (const mode of ['Preview', 'No child']) {
                await page
                    .getByRole('button', { name: mode, exact: true })
                    .click();
                assert.equal(await opens.count(), 0);
                await page
                    .getByRole('button', { name: mode, exact: true })
                    .click();
                assert.equal(await opens.count(), 2);
            }
            const beforeSwitch = await page.evaluate(() =>
                window.listProofSnapshot()
            );
            await page
                .getByRole('button', { name: 'Grid', exact: true })
                .click();
            const grid = page.getByRole('table', { name: 'Accepted grid' });
            await grid.waitFor();
            await grid
                .getByRole('button', { name: 'Inspect detail' })
                .press('Enter');
            assert.equal(
                await page.evaluate(
                    () => window.listProofSnapshot().nestedActivations
                ),
                1
            );
            assert.equal(await dialog.count(), 0);
            assert.deepEqual(
                await grid
                    .locator('tbody tr')
                    .evaluateAll((rows) =>
                        rows.map((row) => row.dataset.recordId)
                    ),
                ['rec_B', 'rec_A']
            );
            const column = grid.locator('th[data-field-id="fld_title"]');
            const resize = column.getByRole('separator', {
                name: 'Resize Name label',
            });
            const initialWidth = await column.evaluate(
                (cell) => cell.clientWidth
            );
            await resize.press('Shift+ArrowRight');
            await page.waitForFunction(
                () => window.listProofSnapshot().preferences.length === 1
            );
            const keyboardWidth = await column.evaluate(
                (cell) => cell.clientWidth
            );
            assert(keyboardWidth > initialWidth);
            assert.deepEqual(
                await page.evaluate(
                    () => window.listProofSnapshot().preferences[0]
                ),
                {
                    fieldId: 'fld_title',
                    width: keyboardWidth,
                }
            );
            const handle = await resize.boundingBox();
            assert(handle);
            await page.mouse.move(
                handle.x + handle.width / 2,
                handle.y + handle.height / 2
            );
            await page.mouse.down();
            await page.mouse.move(
                handle.x + handle.width / 2 + 24,
                handle.y + handle.height / 2,
                { steps: 4 }
            );
            await page.mouse.up();
            await page.waitForFunction(
                () => window.listProofSnapshot().preferences.length === 2
            );
            const settledWidth = await column.evaluate(
                (cell) => cell.clientWidth
            );
            assert(settledWidth > keyboardWidth);
            assert.deepEqual(
                await page.evaluate(
                    () => window.listProofSnapshot().preferences[1]
                ),
                {
                    fieldId: 'fld_title',
                    width: settledWidth,
                }
            );
            const hide = page.getByRole('button', {
                name: 'Hide columns',
                exact: true,
            });
            const detailsHeader = grid.locator(
                'th[data-field-id="fld_detail"]'
            );
            const details = page.getByRole('switch', { name: 'Detail label' });
            const closeHide = page
                .getByRole('dialog', { name: 'Hide columns' })
                .getByRole('button', { name: 'Close', exact: true });
            await hide.click();
            await details.click();
            await detailsHeader.waitFor({ state: 'detached' });
            await closeHide.click();
            assert(
                await hide.evaluate((node) => node === document.activeElement)
            );
            await page
                .getByRole('button', { name: 'List', exact: true })
                .click();
            assert.deepEqual(await rows.allTextContents(), [
                'BetaB detailOpen record',
                'AlphaA detailOpen record',
            ]);
            await page
                .getByRole('button', { name: 'Grid', exact: true })
                .click();
            assert.equal(
                await column.evaluate((cell) => cell.clientWidth),
                settledWidth
            );
            assert.equal(await detailsHeader.count(), 0);
            await hide.click();
            await details.click();
            await detailsHeader.waitFor();
            await closeHide.click();
            await page.setViewportSize({ width: 360, height: 760 });
            const viewport = page.locator('.mx-sdk-readonly-grid__viewport');
            assert(
                await viewport.evaluate(
                    (element) => element.scrollWidth > element.clientWidth
                )
            );
            await page
                .getByRole('button', { name: 'List', exact: true })
                .click();
            await rows.first().waitFor({ state: 'visible' });
            await page.setViewportSize({ width: 1180, height: 900 });
            const afterSwitch = await page.evaluate(() =>
                window.listProofSnapshot()
            );
            assert.equal(
                afterSwitch.presenterStarts,
                beforeSwitch.presenterStarts
            );
            assert.equal(afterSwitch.presenterActive, 1);
            assert.deepEqual(afterSwitch.preferences.slice(2), [
                { fieldId: 'fld_detail', isHidden: true },
                { fieldId: 'fld_detail', isHidden: false },
            ]);
            assert.deepEqual(
                await page.evaluate(() => window.listProofSnapshot().opens),
                beforeSwitch.opens
            );
            await page
                .getByRole('button', { name: 'Hold Open', exact: true })
                .click();
            await opens.first().click();
            await page
                .getByRole('button', { name: 'Reverse', exact: true })
                .click();
            await page
                .getByRole('button', { name: 'Release Open', exact: true })
                .click();
            assert.equal(await dialog.count(), 0);
            assert.equal(
                await rows.first().getAttribute('data-record-id'),
                'rec_A'
            );
            await page
                .getByRole('button', { name: 'Empty', exact: true })
                .click();
            assert.deepEqual(
                await page.getByRole('heading').allTextContents(),
                ['Name label', 'Detail label']
            );
            assert.equal(await opens.count(), 0);
            await page
                .getByRole('button', { name: 'Reset', exact: true })
                .click();
            await opens.first().click();
            await page
                .getByRole('button', { name: 'Retire', exact: true })
                .click();
            await dialog
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            assert.equal(await opens.count(), 0);
            profile.proof = await page.evaluate(() =>
                window.listProofSnapshot()
            );
            assert.equal(profile.proof.react, version);
            assert.equal(profile.proof.submits, 0);
            assert.equal(profile.proof.retiredRefusals, 1);
            assert.equal(profile.proof.subscriptions, 1);
            assert.equal(profile.proof.opens.length, 6);
            assert.equal(profile.proof.scopeCalls.length, 6);
            assert.deepEqual(errors, []);
            assert.deepEqual(warnings, []);
            assert.deepEqual(external, []);
            assert.deepEqual(transport, []);
            await page
                .getByRole('button', { name: 'Reset', exact: true })
                .click();
            const screenshot = join(
                output,
                `readonly-list-react-${version}.png`
            );
            await page.screenshot({ path: screenshot, fullPage: true });
            profile.screenshot = {
                path: screenshot,
                sha256: digest(readFileSync(screenshot)),
            };
            profile.namedRows = [];
            for (const entryPoint of [
                'ReadonlyPortalRecords',
                'ReadonlyPortalList',
            ]) {
                profile.namedRows.push(
                    await checkNamedRows(page, origin, entryPoint)
                );
            }
            assert.deepEqual(errors, []);
            assert.deepEqual(warnings, []);
            assert.deepEqual(external, []);
            assert.deepEqual(transport, []);
            profile.passed = true;
        } finally {
            await context.close();
            profile.contextClosed = true;
        }
    } catch (error) {
        evidence.error = error.stack ?? String(error);
        throw error;
    } finally {
        if (server) {
            await new Promise((done, reject) =>
                server.close((error) => (error ? reject(error) : done()))
            );
            evidence.serverClosed = true;
        }
        rmSync(temporary, { recursive: true });
        evidence.scratchRemoved = true;
    }
}
