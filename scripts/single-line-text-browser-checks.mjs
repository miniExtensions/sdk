import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

/** Installed public field with synthetic host authority and Address reads only. */
export async function checkSingleLineTextBrowser({
    browser,
    consumer,
    evidence,
    output,
    format = 'esm',
}) {
    const directory = mkdtempSync(join(consumer, '.single-line-text-browser-'));
    let server, context;
    Object.assign(evidence, {
        format,
        status: 'running',
        cases: [],
        errors: [],
        unexpectedRequests: [],
        cleanup: {},
    });
    try {
        const imports =
            format === 'cjs'
                ? "const React=require('react'),{createElement:h,useState}=React;const {createRoot}=require('react-dom/client');const {flushSync}=require('react-dom');const {SingleLineTextField}=require('@miniextensions/sdk/react');"
                : "import React,{createElement as h,useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {SingleLineTextField} from '@miniextensions/sdk/react';";
        const source =
            imports +
            String.raw`
import '@miniextensions/sdk/react/single-line-text.css';
const stats={writes:[],queries:[],details:[],submits:0,fetches:0};let patch,current='A',release;
globalThis.fetch=async()=>{stats.fetches++;throw Error('No live requests');};
const labels={clear:'Clear',loadingPredictions:'Loading suggestions',loadingDetails:'Loading selected address',failed:'Unable to load',retry:'Try again'};
function App(){const [state,setState]=useState({main:'seed',deferred:'seed',address:'',source:'A',disabled:false});
patch=next=>{if(next.source)current=next.source;flushSync(()=>setState(old=>({...old,...next})));};
const owner={token:state.source,isCurrent:()=>current===state.source};
const change=key=>value=>{stats.writes.push([key,value]);setState(old=>({...old,[key]:value}));};
const address={mode:'autocomplete',identity:{session:'synthetic',field:'address',readScope:state.source},labels,reads:{async listPredictions(query){stats.queries.push(query);return [{placeId:'p',description:'A😀abcdef'}];},getFormattedAddress(id){stats.details.push(id);return new Promise(resolve=>release=resolve);}}};
return h('main',null,h('h1',null,'Single-line public consumer'),h('p',null,'Synthetic values and read ports. Save remains with the host.'),
h('form',{id:'proof-form',onSubmit:e=>{e.preventDefault();stats.submits++;}},
h('p',{id:'main-help'},'Keep literal whitespace. Five UTF-16 units.'),
h(SingleLineTextField,{mode:'controlled',id:'main',title:'Immediate text',form:'proof-form',value:state.main,onChange:change('main'),language:'en',characterLimit:5,initialMobile:true,describedBy:'main-help',owner,disabled:state.disabled}),
h(SingleLineTextField,{mode:'controlled',id:'deferred',title:'Deferred text',form:'proof-form',value:state.deferred,onChange:change('deferred'),language:'en',characterLimit:4,initialMobile:true,enableInlineEdit:true,owner,disabled:state.disabled}),
h(SingleLineTextField,{mode:'controlled',id:'address',title:'Address text',form:'proof-form',value:state.address,onChange:change('address'),language:'en',characterLimit:5,initialMobile:true,owner,address}),
h(SingleLineTextField,{mode:'controlled',id:'preview',title:'Preview text',value:'manual',onChange:change('preview'),language:'en',initialMobile:true,address:{mode:'preview',explanation:'Suggestions require the standalone form'}}),
h(SingleLineTextField,{mode:'controlled',id:'password',title:'Password text',value:'secret',onChange:change('password'),language:'en',initialMobile:true,obscurePassword:true,address}),
h('section',{'aria-label':'Masked display'},h(SingleLineTextField,{mode:'readOnly',value:'https://example.test/private.pdf',language:'en',obscurePassword:true,displayAsAttachments:true,displayAsButton:true})),
h('input',{'aria-label':'Sibling draft',defaultValue:'keep sibling'}),
h('button',{type:'button',onClick:()=>patch({source:state.source==='A'?'B':'A'})},'Replace owner'),
h('output',{id:'proof-stats'},JSON.stringify(stats))));}
createRoot(document.getElementById('app')).render(h(React.StrictMode,null,h(App)));
window.singleLineProof={patch,stats,replace(next){patch(next);},release(value){release?.(value);},snapshot(){return JSON.parse(JSON.stringify(stats));}};
`;
        const entry = join(directory, 'entry.js');
        writeFileSync(entry, source);
        const bundle = await build({
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            target: 'es2022',
            outdir: directory,
            write: false,
        });
        const assets = new Map(
            bundle.outputFiles.map((file) => [
                '/' + file.path.split('/').at(-1),
                file.contents,
            ])
        );
        server = createServer((request, response) => {
            const path = new URL(request.url, 'http://localhost').pathname;
            if (path === '/') {
                response.setHeader('content-type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/entry.css"><style>body{font:16px system-ui;margin:24px}main{max-width:680px;margin:auto}form{display:grid;gap:16px}label{display:block;font-weight:600}output{white-space:pre-wrap;overflow-wrap:anywhere}</style><div id="app"></div><script type="module" src="/entry.js"></script>'
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
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({
            viewport: { width: 1100, height: 1000 },
            reducedMotion: 'reduce',
        });
        await context.route('**/*', (route) => {
            const url = route.request().url();
            if (url.startsWith('data:') || new URL(url).origin === origin)
                return route.continue();
            evidence.unexpectedRequests.push(url);
            return route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => evidence.errors.push(error.message));
        await page.goto(origin);
        await page
            .getByRole('heading', { name: 'Single-line public consumer' })
            .waitFor();
        const main = page.getByRole('textbox', {
                name: 'Immediate text',
                exact: true,
            }),
            deferred = page.getByRole('textbox', {
                name: 'Deferred text',
                exact: true,
            });
        const snapshot = () =>
            page.evaluate(() => window.singleLineProof.snapshot());
        assert.equal(await main.getAttribute('aria-describedby'), 'main-help');
        assert.equal(await main.getAttribute('form'), 'proof-form');
        await main.fill('abc  ');
        assert.equal(await main.inputValue(), 'abc  ');
        assert.deepEqual((await snapshot()).writes.at(-1), ['main', 'abc  ']);
        await page
            .locator('.mx-sdk-single-line-field')
            .filter({ has: main })
            .getByRole('button', { name: 'Clear', exact: true })
            .click();
        assert.equal(await main.inputValue(), '');
        evidence.cases.push(
            'literal whitespace, accessible association and non-submit mobile Clear'
        );
        await deferred.fill('work');
        const before = (await snapshot()).writes.length;
        await deferred.press('Enter');
        assert.equal((await snapshot()).writes.length, before + 1);
        assert.deepEqual((await snapshot()).writes.at(-1), [
            'deferred',
            'work',
        ]);
        evidence.cases.push(
            'native deferred Enter commits once without Submit'
        );
        await deferred.fill('old');
        const old = (await snapshot()).writes.length;
        await page.evaluate(() =>
            window.singleLineProof.replace({ source: 'B' })
        );
        await page.evaluate(() =>
            window.singleLineProof.replace({ source: 'A' })
        );
        assert.equal((await snapshot()).writes.length, old);
        assert.equal(await deferred.inputValue(), 'work');
        evidence.cases.push('host owner A-B-A retires old dirty writer');
        await deferred.fill('gone');
        await page.evaluate(() =>
            window.singleLineProof.replace({ disabled: true })
        );
        await page.evaluate(() =>
            window.singleLineProof.replace({ disabled: false })
        );
        assert.equal((await snapshot()).writes.length, old);
        evidence.cases.push('disable/re-enable never settles retired draft');
        const address = page.getByRole('combobox', { name: 'Address text' });
        await address.fill('q');
        await page.getByRole('option').waitFor();
        await address.press('Enter');
        assert.equal(await address.inputValue(), 'A😀ab');
        assert.deepEqual((await snapshot()).details, ['p']);
        await page.evaluate(() =>
            window.singleLineProof.replace({
                source: 'B',
                address: 'replacement',
            })
        );
        await page.evaluate(() =>
            window.singleLineProof.release('late detail')
        );
        assert.equal(await address.inputValue(), 'replacement');
        evidence.cases.push(
            'real combobox selection is bounded and late details retire'
        );
        assert.match(
            await page.locator('#preview').getAttribute('aria-describedby'),
            /address-preview/
        );
        assert.equal(
            await page.locator('#password').getAttribute('type'),
            'password'
        );
        const mask = page.locator('[aria-label="Masked display"]');
        assert.match(await mask.textContent(), /••••••••/);
        assert.equal(await mask.locator('a,img,button,iframe').count(), 0);
        assert.equal(
            await page
                .getByRole('textbox', { name: 'Sibling draft' })
                .inputValue(),
            'keep sibling'
        );
        const stats = await snapshot();
        assert.equal(stats.submits, 0);
        assert.equal(stats.fetches, 0);
        assert.equal(stats.queries.length, 1);
        evidence.cases.push(
            'provider-free preview/password/masking, sibling isolation and zero implicit Submit/fetch'
        );
        await page.setViewportSize({ width: 360, height: 900 });
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth
            ),
            true
        );
        const inputStyle = await main.evaluate((node) => ({
            border: getComputedStyle(node).borderTopStyle,
            padding: getComputedStyle(node).paddingLeft,
        }));
        assert.equal(inputStyle.border, 'solid');
        assert.notEqual(inputStyle.padding, '0px');
        evidence.cases.push(
            'standalone CSS and narrow viewport without overflow'
        );
        assert.deepEqual(evidence.errors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        await page.screenshot({
            path: join(output, `single-line-text-${format}.png`),
            fullPage: true,
        });
        evidence.status = 'passed';
        evidence.stats = stats;
    } catch (error) {
        evidence.status = 'failed';
        evidence.error = error.message;
        throw error;
    } finally {
        if (context) await context.close();
        evidence.cleanup.contextClosed = true;
        if (server) await new Promise((resolve) => server.close(resolve));
        evidence.cleanup.serverClosed = true;
        rmSync(directory, { recursive: true, force: true });
        evidence.cleanup.directoryRemoved = true;
    }
}
