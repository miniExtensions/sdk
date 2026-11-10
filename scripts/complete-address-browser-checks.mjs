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
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

/** Installed control, synthetic authorized reads, trusted keyboard and real CSS. */
export async function checkCompleteAddressBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    Object.assign(evidence, {
        status: 'running',
        results: [],
        pageErrors: [],
        unexpectedRequests: [],
        cleanup: {},
    });
    let directory, server, context, page, failure;
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const bounded = async (label, operation) => {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(operation),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () => reject(Error(label + ' timed out')),
                        5000
                    );
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    };
    try {
        const root = realpathSync(consumer);
        directory = mkdtempSync(join(root, '.complete-address-browser-'));
        const source = String.raw`
import React,{createElement as h,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {CompleteAddressAutocomplete} from '@miniextensions/sdk/react';
const mode=new URLSearchParams(location.search).get('mode')||'normal';
const en={clear:'Clear',loadingPredictions:'Loading address suggestions',loadingDetails:'Loading selected address',failed:'Address suggestions could not be loaded. Keep typing or retry.',retry:'Try again'};
const es={clear:'Borrar',loadingPredictions:'Cargando sugerencias de direcciones',loadingDetails:'Cargando la dirección seleccionada',failed:'No se pudieron cargar las sugerencias de direcciones.',retry:'Intentar de nuevo'};
const ja={clear:'クリア',loadingPredictions:'住所の候補を読み込み中',loadingDetails:'選択した住所を読み込み中',failed:'住所の候補を読み込めませんでした。',retry:'もう一度試す'};
const labels=mode==='es'?es:mode==='ja'?ja:en;
const stats={queries:[],details:[],writes:[],submits:0,signals:[],trusted:[]};let patch,heldPrediction,heldDetail,lastRef,refStable=true;
function App(){const [state,setState]=useState({value:'',readScope:'A',mounted:true});patch=next=>flushSync(()=>setState(old=>({...old,...next})));
return h('form',{id:'proof-form',onSubmit:e=>{e.preventDefault();stats.submits++;},onInputCapture:e=>stats.trusted.push(e.nativeEvent.isTrusted)},
h('label',{htmlFor:'proof-address'},'Synthetic Address'),h('p',{id:'proof-help'},'Synthetic address help'),
state.mounted?h(CompleteAddressAutocomplete,{identity:{session:'s',field:'f',readScope:state.readScope},value:state.value,onChange(value){stats.writes.push(value);setState(old=>({...old,value}));},reads:{async listPredictions(query,{signal}){stats.queries.push(query);stats.signals.push(signal);if(mode==='predictions'&&stats.queries.length===1)throw Error('Private provider failure');if(mode==='loading')await new Promise(resolve=>heldPrediction=resolve);return [{placeId:'p',description:'Selected address'},{placeId:'p2',description:'Second address'}];},async getFormattedAddress(placeId,{signal}){stats.details.push({placeId,prior:[...stats.writes]});stats.signals.push(signal);if(mode==='retry'||mode==='es'||mode==='ja'){if(stats.details.length===1)throw Error('Private detail failure');return 'Canonical address';}return new Promise(resolve=>heldDetail=resolve);}},labels,initialMobile:true,id:'proof-address',form:'proof-form','aria-describedby':'proof-help','aria-label':'Synthetic Address',maxLength:60,ref:node=>{if(node){if(lastRef&&lastRef!==node)refStable=false;lastRef=node;}},theme:{activeBackground:'#dbeafe',activeText:'#1e3a8a'}}):null,
h('input',{'aria-label':'Adjacent draft',defaultValue:'Unchanged adjacent draft'}));}
const root=createRoot(document.querySelector('main'));root.render(h(React.StrictMode,null,h(App)));
window.addressProof={snapshot:()=>({react:React.version,queries:[...stats.queries],details:[...stats.details],writes:[...stats.writes],submits:stats.submits,aborted:stats.signals.map(s=>s.aborted),trusted:[...stats.trusted],refStable}),patch,update:next=>patch(next),resolveDetail:value=>heldDetail(value),resolvePredictions:()=>heldPrediction(),destroy:()=>root.unmount()};
`;
        writeFileSync(join(directory, 'host.mjs'), source);
        const bundle = await build({
            absWorkingDir: root,
            entryPoints: [join(directory, 'host.mjs')],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(bundle.metafile, root);
        const installed = realpathSync(
            join(root, 'node_modules/@miniextensions/sdk')
        );
        const inputs = Object.keys(bundle.metafile.inputs).filter((path) =>
            path.includes('/sdk/dist/')
        );
        assert(
            inputs.some((path) =>
                path.endsWith('/react/CompleteAddressAutocomplete.js')
            )
        );
        for (const input of inputs)
            assert(
                realpathSync(resolve(root, input)).startsWith(installed + '/')
            );
        const css = readFileSync(
            join(installed, 'dist/esm/react/complete-address.css')
        );
        Object.assign(evidence, {
            sdkInputs: inputs,
            hostSha256: hash(source),
            bundleSha256: hash(bundle.outputFiles[0].contents),
            cssSha256: hash(css),
        });
        server = createServer((request, response) => {
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src data:; form-action 'none'; base-uri 'none'"
            );
            const path = new URL(request.url, 'http://localhost').pathname;
            if (path === '/proof.js') {
                response.setHeader('Content-Type', 'text/javascript');
                response.end(bundle.outputFiles[0].text);
            } else if (path === '/address.css') {
                response.setHeader('Content-Type', 'text/css');
                response.end(css);
            } else if (path === '/') {
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic Address</title><link rel="stylesheet" href="/address.css"><main style="margin:20px;max-width:520px"></main><script type="module" src="/proof.js"></script>'
                );
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await bounded(
            'address server start',
            () =>
                new Promise((yes, no) => {
                    server.once('error', no);
                    server.listen(0, '127.0.0.1', yes);
                })
        );
        const origin = `http://127.0.0.1:${server.address().port}`;
        const snapshot = () =>
            page.evaluate(() => window.addressProof.snapshot());
        const open = async (mode, narrow = false) => {
            if (context) await context.close();
            context = await browser.newContext({
                serviceWorkers: 'block',
                viewport: narrow
                    ? { width: 390, height: 844 }
                    : { width: 1024, height: 768 },
            });
            page = await context.newPage();
            page.setDefaultTimeout(5000);
            page.on('pageerror', (error) =>
                evidence.pageErrors.push(error.message)
            );
            await page.route('**/*', (route) => {
                const url = new URL(route.request().url());
                if (
                    url.origin === origin &&
                    ['/', '/proof.js', '/address.css'].includes(url.pathname)
                )
                    return route.continue();
                evidence.unexpectedRequests.push(url.origin + url.pathname);
                return route.abort();
            });
            await page.goto(origin + '?mode=' + mode);
            await page.getByRole('combobox').waitFor();
            return page.getByRole('combobox');
        };
        const finish = async (name) => {
            const state = await snapshot();
            assert.equal(state.submits, 0);
            assert.equal(state.refStable, true);
            assert(state.trusted.length > 0 && state.trusted.every(Boolean));
            assert.equal(
                await page
                    .getByRole('textbox', { name: 'Adjacent draft' })
                    .inputValue(),
                'Unchanged adjacent draft'
            );
            assert.deepEqual(evidence.pageErrors, []);
            assert.deepEqual(evidence.unexpectedRequests, []);
            evidence.results.push({ name, ...state });
            await page.evaluate(() => window.addressProof.destroy());
        };
        let input = await open('normal');
        await input.fill('Raw query');
        await page.getByRole('option').first().waitFor();
        const geometry = await page.evaluate(() => {
            const input = document.querySelector('#proof-address'),
                options = document.querySelector('[role=listbox]'),
                logo = options.querySelector('img');
            const a = input.getBoundingClientRect(),
                b = options.getBoundingClientRect(),
                c = logo.getBoundingClientRect();
            return {
                input: [a.x, a.y, a.width, a.height],
                options: [b.x, b.y, b.width, b.height],
                logo: [c.width, c.height],
                position: getComputedStyle(options).position,
            };
        });
        assert.equal(geometry.position, 'absolute');
        assert.equal(geometry.logo[0], 98);
        assert.equal(geometry.logo[1], 18);
        assert(Math.abs(geometry.input[0] - geometry.options[0]) < 1);
        assert(Math.abs(geometry.input[2] - geometry.options[2]) < 1);
        assert(geometry.options[1] >= geometry.input[1] + geometry.input[3]);
        await input.press('ArrowDown');
        await input.press('Enter');
        await page.getByRole('status').waitFor();
        assert.equal(await input.inputValue(), 'Selected address');
        assert.deepEqual((await snapshot()).details[0].prior, [
            'Raw query',
            'Selected address',
        ]);
        await page.evaluate(() =>
            window.addressProof.resolveDetail('Canonical address')
        );
        await page.waitForFunction(
            () =>
                document.querySelector('#proof-address').value ===
                'Canonical address'
        );
        await input.press('Tab');
        assert.equal(
            await page
                .getByRole('button', { name: 'Clear' })
                .evaluate((node) => node === document.activeElement),
            true
        );
        await page.getByRole('button', { name: 'Clear' }).press('Enter');
        assert.equal(await input.inputValue(), '');
        assert.equal(
            await input.evaluate((node) => node === document.activeElement),
            true
        );
        evidence.geometry = geometry;
        await finish(
            'keyboard selection, description/detail order, attribution, layout and non-submit Clear'
        );
        input = await open('normal', true);
        await input.fill('First');
        await page.getByRole('option').first().waitFor();
        await input.press('ArrowDown');
        await input.press('Enter');
        await page.getByRole('status').waitFor();
        await input.fill('Manual correction');
        await page.evaluate(() =>
            window.addressProof.resolveDetail('Late old detail')
        );
        assert.equal(await input.inputValue(), 'Manual correction');
        assert((await snapshot()).aborted.some(Boolean));
        await page.screenshot({
            path: join(output, 'complete-address-mobile.png'),
        });
        await finish('narrow mobile manual edit retires pending detail');
        input = await open('normal');
        await input.fill('Query');
        await page.getByRole('option').first().waitFor();
        await input.press('ArrowDown');
        await input.press('Enter');
        await page.evaluate(() =>
            window.addressProof.update({
                readScope: 'B',
                value: 'External replacement',
            })
        );
        await page.evaluate(() =>
            window.addressProof.update({ readScope: 'A' })
        );
        await page.evaluate(() =>
            window.addressProof.resolveDetail('Old A detail')
        );
        assert.equal(await input.inputValue(), 'External replacement');
        assert((await snapshot()).aborted.some(Boolean));
        await finish('external owner/value replacement A-B-A');
        input = await open('predictions');
        await input.fill('Query');
        await page.getByRole('alert').waitFor();
        await page.getByRole('button', { name: 'Try again' }).click();
        await page.getByRole('option').first().waitFor();
        assert.deepEqual((await snapshot()).queries, ['Query', 'Query']);
        await finish('explicit prediction retry with editable canonical input');
        for (const [mode, retry] of [
            ['retry', 'Try again'],
            ['es', 'Intentar de nuevo'],
            ['ja', 'もう一度試す'],
        ]) {
            input = await open(mode, mode === 'ja');
            await input.fill('Query');
            await page.getByRole('option').first().waitFor();
            await input.press('ArrowDown');
            await input.press('Enter');
            await page.getByRole('alert').waitFor();
            assert(
                !(await page
                    .locator('body')
                    .textContent()
                    .then((text) => text.includes('Private detail failure')))
            );
            await page.getByRole('button', { name: retry }).click();
            await page.waitForFunction(
                () =>
                    document.querySelector('#proof-address').value ===
                    'Canonical address'
            );
            assert.equal((await snapshot()).queries.length, 1);
            assert.equal((await snapshot()).details.length, 2);
            await finish('localized explicit detail retry ' + mode);
        }
        input = await open('loading');
        await input.fill('Query');
        await page.getByRole('status').waitFor();
        assert.equal(
            await page.getByRole('status').textContent(),
            'Loading address suggestions'
        );
        await page.evaluate(() => window.addressProof.resolvePredictions());
        await page.getByRole('option').first().waitFor();
        await finish('localized prediction loading with synthetic read');
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        if (page)
            try {
                await page.screenshot({
                    path: join(output, 'complete-address-failure.png'),
                });
            } catch {}
    } finally {
        const errors = [];
        if (context)
            try {
                await bounded('address context cleanup', () => context.close());
                evidence.cleanup.context = 'completed';
            } catch (error) {
                errors.push(error);
            }
        if (server)
            try {
                await bounded(
                    'address server cleanup',
                    () =>
                        new Promise((yes, no) => {
                            server.close((error) =>
                                error ? no(error) : yes()
                            );
                            server.closeAllConnections();
                        })
                );
                evidence.cleanup.server = 'completed';
            } catch (error) {
                errors.push(error);
            }
        if (directory) {
            rmSync(directory, { recursive: true, force: true });
            evidence.cleanup.directory = 'completed';
        }
        if (errors.length)
            throw new AggregateError(
                [...(failure ? [failure] : []), ...errors],
                'Address browser cleanup failed'
            );
    }
    if (failure) throw failure;
}
