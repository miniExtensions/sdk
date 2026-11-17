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
import '@miniextensions/sdk/react/readonly-portal-list.css';import{createListFixture}from'./fixture.mjs';
const h=React.createElement,f=createListFixture(ui),root=createRoot(document.querySelector('#root'));
const proof={opens:[],submits:0,held:0,retiredRefusals:0};window.proof=proof;
let layout='list',preview=false,noChild=false,hold=false,pending,child=null,commands;
const renderers={renderSingleLineTextField(field){if(field.capability.type!=='readonly')throw new Error('Editable List cell');return h('span',null,String(field.value??''));}};
function publishCommands(){const snapshot=f.scope.getSnapshot();commands=new Map(snapshot.rows.map(row=>[row.recordId,{revision:snapshot.revision,activate(isCurrent,restore){const invoke=()=>{if(!isCurrent()){proof.retiredRefusals++;return;}void snapshot.actions.openChild(row.recordId);proof.opens.push(row.recordId);child={recordId:row.recordId,isCurrent,restore};render();};if(hold){pending=invoke;proof.held++;}else invoke();}}]));}
function change(update){update();publishCommands();render();}
function navigate(delta){if(!child?.isCurrent())return;const snapshot=f.scope.getSnapshot(),index=snapshot.rows.findIndex(row=>row.recordId===child.recordId),next=snapshot.rows[index+delta];if(!next)return;void snapshot.actions.openChild(next.recordId);proof.opens.push(next.recordId);child={...child,recordId:next.recordId};render();}
function close(){const previous=child;child=null;render();previous?.restore();}
function button(label,action){return h('button',{type:'button',onClick:action},label);}
function render(){flushSync(()=>root.render(h(React.StrictMode,null,h('form',{onSubmit(event){event.preventDefault();proof.submits++;}},
 h('nav',{'aria-label':'Synthetic host controls'},button('List',()=>{layout='list';render();}),button('Grid',()=>{layout='grid';render();}),button('Reverse',()=>change(()=>f.replace({...f.initial,records:[...f.initial.records].reverse()}))),button('Empty',()=>change(()=>f.replace({...f.initial,records:[]}))),button('Reset',()=>change(()=>{preview=false;noChild=false;hold=false;child=null;f.replace();})),button('Preview',()=>{preview=!preview;render();}),button('No child',()=>{noChild=!noChild;render();}),button('Hold Open',()=>{hold=true;}),button('Release Open',()=>{hold=false;const invoke=pending;pending=undefined;invoke?.();}),button('Retire',()=>change(()=>f.replace(null)))),
 layout==='list'?h(api.ReadonlyPortalList,{scope:f.scope,renderers,label:'Accepted records',openActions:preview||noChild?undefined:commands}):h(api.AirtableGrid,{scope:f.scope,renderers,children(state){return h('table',{'aria-label':'Accepted grid'},h('tbody',null,state.rows.map(row=>h('tr',{key:row.recordId},row.cells.map(cell=>h('td',{key:cell.fieldId},cell.node))))));}}),
 child?h('section',{role:'dialog','aria-label':'Synthetic native child'},h('h2',null,'Child '+child.recordId),button('Previous',()=>navigate(-1)),button('Next',()=>navigate(1)),button('Close',close)):null))));}
window.listProofSnapshot=()=>({react:React.version,opens:[...proof.opens],submits:proof.submits,held:proof.held,retiredRefusals:proof.retiredRefusals,subscriptions:f.subscriptions,scopeCalls:f.calls.map(call=>({...call})),layout});
publishCommands();render();
`;

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
            await page.getByRole('table', { name: 'Accepted grid' }).waitFor();
            await page
                .getByRole('button', { name: 'List', exact: true })
                .click();
            assert.deepEqual(await rows.allTextContents(), [
                'BetaB detailOpen record',
                'AlphaA detailOpen record',
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
