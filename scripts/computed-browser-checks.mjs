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
import { join, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { computedHost } from './computed-consumer-checks.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
async function bounded(cleanup) {
    let timer;
    try {
        await Promise.race([
            Promise.resolve().then(cleanup),
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(Error('Computed cleanup timed out')),
                    5000
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
const browserHost = String.raw`
const main=document.querySelector('main');let root=createRoot(main),last;
const effects={requests:0,opens:0,submits:0};
window.fetch=async()=>{effects.requests++;throw Error('Unexpected computed fetch');};
XMLHttpRequest.prototype.open=function(){effects.requests++;throw Error('Unexpected computed XHR');};
window.open=()=>{effects.opens++;return null;};
if(navigator.sendBeacon)navigator.sendBeacon=()=>{effects.requests++;return false;};
document.addEventListener('submit',event=>{event.preventDefault();effects.submits++;});
const image='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="20" height="20"%3E%3Crect width="20" height="20" fill="red"/%3E%3C/svg%3E';
function show(props){last=props;flushSync(()=>root.render(h(React.StrictMode,null,h('form',null,h('input',{id:'neighbor',defaultValue:'Preserved draft'}),h('button',{type:'button',id:'before'},'Before computed'),h(api.ComputedField,props),h('button',{type:'button',id:'after'},'After computed')))));}
const valid=extra=>({mode:'controlled',language:'en',isValid:true,resultType:'singleLineText',value:'Answer',formattedValue:'Answer',...extra});
window.computedProof={
 initial(){flushSync(()=>root.render(computedElement()));},
 formula(mode){const extra=mode==='select'?{resultType:'singleSelect',value:'Ready',select:{choices:[{id:'ready',name:'Ready',displayName:'Ready label'}]},renderFormulaAsHTML:true,renderFormulaAsAttachment:true,displayAsButton:true}:mode==='html'?{value:'<strong>Painted HTML</strong><a href="https://never.example.invalid/">Forbidden navigation</a><script>bad()</script>',renderFormulaAsHTML:true,renderFormulaAsAttachment:true,displayAsButton:true}:mode==='gallery'?{value:'admitted resources',renderFormulaAsAttachment:true,gallery:{entries:[{id:'one',url:image,type:'image/svg+xml',filename:'First'},{id:'two',url:image,type:'image/svg+xml',filename:'Second'}],disableOpenFiles:true,disableDownloadFiles:true,labels:{attachments:'Computed media'}}}:mode==='masked'?{obscurePassword:true,textSize:'large',value:'PRIVATE'}:mode==='invalid'?{isValid:false}:{};show({...base,kind:'formula',display:valid(extra)});},
 rollup(value){show({...base,kind:'rollup',display:{mode:'controlled',language:'en',isValid:true,value}});},
 retire(notify=true){current=false;if(notify)flushSync(()=>{for(const listener of [...listeners])listener();});},
 echo(){current=true;show(last);},
 snapshot(){return{react:React.version,platform:navigator.platform,text:main.textContent,effects:{...effects},canonical:JSON.stringify(canonical),draft:document.querySelector('#neighbor')?.value,subscriptions:listeners.size};},
 unmount(){flushSync(()=>root.unmount());}
};window.computedProof.initial();
`;

/** Exact packed controls, loopback-only provider-free host, real browser input. */
export async function checkComputedBrowser({
    browser,
    consumer,
    evidence,
    output,
    readArchiveMember,
}) {
    Object.assign(evidence, {
        status: 'running',
        results: [],
        pageErrors: [],
        unexpectedRequests: [],
        cleanup: {},
        archiveInputs: {},
        inputs: {},
    });
    let directory, server, context, page, failure;
    try {
        const root = realpathSync(consumer),
            installed = realpathSync(
                join(root, 'node_modules/@miniextensions/sdk')
            );
        assert.equal(typeof readArchiveMember, 'function');
        directory = mkdtempSync(join(root, '.computed-proof-'));
        const assets = new Map();
        for (const format of ['esm', 'cjs']) {
            const imports =
                format === 'esm'
                    ? "import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import*as api from'@miniextensions/sdk/react';import*as ui from'@miniextensions/sdk/ui';import'@miniextensions/sdk/react/computed.css';"
                    : "const React=require('react');const{createRoot}=require('react-dom/client');const{flushSync}=require('react-dom');const api=require('@miniextensions/sdk/react');const ui=require('@miniextensions/sdk/ui');require('@miniextensions/sdk/react/computed.css');";
            const source = imports + computedHost + browserHost,
                entry = join(directory, `${format}.js`);
            writeFileSync(entry, source);
            const bundle = await build({
                entryPoints: [entry],
                absWorkingDir: root,
                outdir: join(directory, 'out'),
                entryNames: format,
                bundle: true,
                platform: 'browser',
                format: 'esm',
                write: false,
                metafile: true,
                logLevel: 'silent',
            });
            await assertBrowserInputs(bundle.metafile, root);
            const inputs = Object.keys(bundle.metafile.inputs).filter((input) =>
                resolve(root, input).startsWith(installed + '/')
            );
            assert(
                inputs.some((input) =>
                    input.endsWith('/react/ComputedField.js')
                )
            );
            assert(
                inputs.some((input) =>
                    input.endsWith('/ui/computedProjection.js')
                )
            );
            for (const input of inputs) {
                const path = realpathSync(resolve(root, input));
                assert(path.startsWith(installed + '/'));
                const member = relative(installed, path),
                    bytes = readFileSync(path);
                assert(
                    bytes.equals(readArchiveMember('package/' + member)),
                    'Installed computed bytes differ: ' + member
                );
                evidence.archiveInputs[member] = sha(bytes);
            }
            evidence.inputs[format] = inputs;
            evidence[format + 'HostSha256'] = sha(source);
            for (const file of bundle.outputFiles) {
                const name = file.path.split('/').at(-1);
                assert([format + '.js', format + '.css'].includes(name));
                assets.set('/' + name, file.contents);
            }
        }
        server = createServer((request, response) => {
            const url = new URL(request.url, 'http://localhost');
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; media-src 'self' data:; form-action 'none'; frame-src 'none'"
            );
            if (url.pathname === '/') {
                const format = url.searchParams.get('format');
                if (!['esm', 'cjs'].includes(format)) {
                    response.writeHead(400).end();
                    return;
                }
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Owned computed-field proof</title><link rel="stylesheet" href="/' +
                        format +
                        '.css"><style>body{font:16px/1.5 system-ui;margin:1rem}main{max-width:48rem}</style><main></main><script type="module" src="/' +
                        format +
                        '.js"></script>'
                );
            } else if (assets.has(url.pathname)) {
                response.setHeader(
                    'Content-Type',
                    url.pathname.endsWith('.css')
                        ? 'text/css'
                        : 'text/javascript'
                );
                response.end(assets.get(url.pathname));
            } else
                response
                    .writeHead(url.pathname === '/favicon.ico' ? 204 : 404)
                    .end();
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const origin = 'http://127.0.0.1:' + server.address().port;
        evidence.origin = origin;
        for (const format of ['esm', 'cjs']) {
            context = await browser.newContext({
                serviceWorkers: 'block',
                viewport: { width: 390, height: 844 },
            });
            page = await context.newPage();
            page.setDefaultTimeout(5000);
            page.on('pageerror', (error) =>
                evidence.pageErrors.push(error.message)
            );
            page.on('dialog', (dialog) => {
                evidence.pageErrors.push('Unexpected ' + dialog.type());
                void dialog.dismiss();
            });
            await page.route('**/*', (route) => {
                const url = new URL(route.request().url());
                if (
                    (url.origin === origin &&
                        (url.pathname === '/' ||
                            url.pathname === '/favicon.ico' ||
                            assets.has(url.pathname))) ||
                    url.protocol === 'data:'
                )
                    return route.continue();
                evidence.unexpectedRequests.push(url.origin + url.pathname);
                return route.abort();
            });
            const record = (name) =>
                evidence.results.push({ format, name, status: 'passed' });
            await page.goto(origin + '/?format=' + format);
            await page.waitForFunction(() =>
                window.computedProof?.snapshot().text.includes('Computed HTML')
            );
            assert.equal(
                await page.locator('#lookup').textContent(),
                'RepeatedRepeatedfalse0'
            );
            assert.equal(
                await page.locator('#rollup').textContent(),
                '0, false'
            );
            assert.equal(await page.locator('script:not([src])').count(), 0);
            record('ordered native-style value assembly and rich paint');
            await page.evaluate(() => window.computedProof.formula('select'));
            assert.equal(
                await page.locator('.mx-sdk-select-selected').textContent(),
                'Ready label'
            );
            assert.equal(
                await page.locator('.mx-sdk-html,.mx-sdk-url-gallery').count(),
                0
            );
            record('effective Select precedes conflicting rich modes');
            await page.evaluate(() => window.computedProof.formula('invalid'));
            assert.match(
                await page.locator('[role="alert"]').textContent(),
                /invalid value/
            );
            await page.evaluate(() => window.computedProof.rollup(null));
            assert.match(await page.locator('main').textContent(), /No Value/);
            record('invalid metadata and empty Rollup transitions');
            await page.evaluate(() => window.computedProof.formula('gallery'));
            const trigger = page
                .locator('.mx-sdk-url-gallery button[aria-label]')
                .first();
            await trigger.click();
            await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
            await page
                .getByRole('button', { name: 'Next', exact: true })
                .click();
            assert.match(
                await page.locator('[role="dialog"]').textContent(),
                /Second/
            );
            assert.equal(
                await page
                    .getByRole('button', { name: 'Download', exact: true })
                    .count(),
                0
            );
            await page.keyboard.press('Escape');
            await page.locator('[role="dialog"]').waitFor({ state: 'hidden' });
            assert.equal(
                await trigger.evaluate(
                    (node) => node === document.activeElement
                ),
                true
            );
            record(
                'trusted gallery selection Escape close and exact focus return'
            );
            await page.keyboard.press('Enter');
            await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
            await page.evaluate(() =>
                window.computedProof.rollup('Replacement')
            );
            assert.equal(await page.locator('[role="dialog"]').count(), 0);
            assert.match(
                await page.locator('main').textContent(),
                /Replacement/
            );
            record('keyboard reopen then physical-kind resource retirement');
            await page.evaluate(() => window.computedProof.formula('masked'));
            assert.match(await page.locator('main').textContent(), /••••••••/);
            assert.doesNotMatch(await page.locator('main').innerHTML(), /PRIVATE/);
            assert.equal(
                await page
                    .locator('main img,main a,main [role="dialog"]')
                    .count(),
                0
            );
            assert.equal(
                await page.locator('.read-only-text.text-lg').count(),
                1
            );
            record(
                'masked rich configuration suppresses private DOM and retains size'
            );
            await page.evaluate(() => window.computedProof.formula('html'));
            await page.evaluate(() => window.computedProof.retire(false));
            await page
                .getByRole('link', { name: 'Forbidden navigation' })
                .click();
            assert.equal(page.url(), origin + '/?format=' + format);
            await page.evaluate(() => window.computedProof.retire());
            await page.evaluate(() => window.computedProof.echo());
            assert.match(
                await page.locator('main').textContent(),
                /Unavailable/
            );
            assert.equal(await page.locator('main strong,main a').count(), 0);
            record(
                'stale trusted navigation blocked and retirement stays monotonic'
            );
            const snapshot = await page.evaluate(() =>
                window.computedProof.snapshot()
            );
            assert.deepEqual(snapshot.effects, {
                requests: 0,
                opens: 0,
                submits: 0,
            });
            assert.equal(snapshot.draft, 'Preserved draft');
            assert.equal(
                snapshot.canonical,
                JSON.stringify(['Repeated', null, 'Repeated', false, 0])
            );
            evidence[format + 'Snapshot'] = snapshot;
            await page.evaluate(() => window.computedProof.unmount());
            assert.equal(await page.locator('main > *').count(), 0);
            assert.equal(
                (await page.evaluate(() => window.computedProof.snapshot()))
                    .subscriptions,
                0
            );
            record('canonical sibling no-effects and full unmount cleanup');
            await context.close();
            context = null;
            page = null;
        }
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page)
            try {
                evidence.failureState = await page.evaluate(() =>
                    window.computedProof?.snapshot()
                );
                await page.screenshot({
                    path: join(output, 'computed-failure.png'),
                    fullPage: true,
                });
            } catch {}
    } finally {
        for (const [name, cleanup] of [
            ['context', () => context?.close()],
            [
                'server',
                () =>
                    new Promise((resolve, reject) => {
                        if (!server) return resolve();
                        server.closeAllConnections();
                        server.close((error) =>
                            error ? reject(error) : resolve()
                        );
                    }),
            ],
            [
                'fixture',
                () => {
                    if (directory)
                        rmSync(directory, { recursive: true, force: true });
                },
            ],
        ]) {
            try {
                await bounded(cleanup);
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                failure ??= error;
                evidence.status = 'failed';
                evidence.cleanup[name] = { error: error.message };
            }
        }
        writeFileSync(
            join(output, 'computed-browser.json'),
            JSON.stringify(evidence, null, 2) + '\n'
        );
    }
    if (failure) throw failure;
    return evidence;
}
