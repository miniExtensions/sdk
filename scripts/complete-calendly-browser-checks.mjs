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

// No provider is contacted: the only Calendly-origin responses below are fixed
// in-memory transport doubles. The installed SDK supplies the real iframe,
// contentWindow, ref/key and message admission; the fixture supplies no hook.
const fixturePaths = new Set([
    '/__sdk_fixture_only__/one',
    '/__sdk_fixture_only__/two',
    '/__sdk_fixture_only__/replacement',
]);
const frameHtml = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic booking frame</title>
<style>body{margin:12px;font:16px sans-serif}button{display:block;margin:8px;padding:12px}</style>
<button id="first" type="button">First frame control</button>
<button id="schedule" type="button">Schedule synthetic booking</button>
<button id="duplicate" type="button">Schedule twice</button>
<button id="invalid" type="button">Send null event</button>
<button id="last" type="button">Last frame control</button>
<script>
window.__calendlyEscapeTrace={keys:[]};
window.addEventListener('keydown',event=>{if(event.key==='Escape')window.__calendlyEscapeTrace.keys.push({observedAt:'child-window-bubble',trusted:event.isTrusted,defaultPrevented:event.defaultPrevented,activeId:document.activeElement?.id??null});},{passive:true});
const send=data=>parent.postMessage(data,'*');
document.querySelector('#schedule').onclick=()=>send({event:'calendly.event_scheduled'});
document.querySelector('#duplicate').onclick=()=>{send({event:'calendly.event_scheduled'});send({event:'calendly.event_scheduled'});};
document.querySelector('#invalid').onclick=()=>send(null);
</script>`;

export async function checkCompleteCalendlyBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    Object.assign(evidence, {
        status: 'running',
        phase: 'build',
        results: [],
        focusChecks: [],
        escapeChecks: [],
        pageErrors: [],
        unexpectedRequests: [],
        transport: {
            interceptedCalendlyRequests: 0,
            memoryFulfilledFixtureRequests: 0,
            localNetworkContinuations: 0,
            externalNetworkContinuations: 0,
            externalAborts: 0,
        },
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
                        () => reject(new Error(`${label} timed out`)),
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
        directory = mkdtempSync(join(root, '.complete-calendly-browser-'));
        const source = `
import React,{createElement as h,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CompleteCalendlyWidget} from '@miniextensions/sdk/react';
const mode=new URLSearchParams(location.search).get('mode')||'normal';
const owners={A:{},B:{}};
const invalidUrls={http:'http://calendly.com/__sdk_fixture_only__/one',foreign:'https://attacker.invalid/calendly',malformed:'not a URL'};
let writes=[],submits=0,messages=0,ports=0,capturedNode,capturedWindow,change;
const escapeTrace={keys:[],cancels:[],closes:[]};
window.addEventListener('keydown',event=>{if(event.key==='Escape')escapeTrace.keys.push({observedAt:'parent-window-capture',trusted:event.isTrusted,defaultPrevented:event.defaultPrevented,targetTag:event.target?.tagName??null});},{capture:true,passive:true});
for(const [name,key] of [['cancel','cancels'],['close','closes']])document.addEventListener(name,event=>{if(event.target?.classList?.contains('mx-sdk-calendly-dialog'))escapeTrace[key].push({observedAt:'parent-document-capture',trusted:event.isTrusted,defaultPrevented:event.defaultPrevented,open:event.target.open,activeTag:document.activeElement?.tagName??null});},{capture:true,passive:true});
const initial={mounted:true,owner:'A',url:invalidUrls[mode]||'https://calendly.com/__sdk_fixture_only__/one?keep=yes',email:'synthetic+booking@example.test',name:'Synthetic & 東京',enabled:true,booked:false,writer:'initial',title:mode==='french'?null:'Book synthetic',reenter:false,second:true,accent:'#0f766e',hover:'#0d9488',focus:'#14b8a6',reserved:'240px'};
let observed=initial;
window.addEventListener('message',()=>messages++);
function App(){
 const [state,setState]=useState(initial),latest=useRef(state);latest.current=state;observed=state;
 change=patch=>setState(old=>({...old,...patch}));
 const options={configuredUrl:state.url,email:state.email,name:state.name,embedDomain:location.origin,ownerKey:owners[state.owner],enabled:state.enabled,booked:state.booked,schedulingTitle:state.title,labels:mode==='french'?{schedule:'Programme'}:undefined,accentColor:state.accent,hoverColor:state.hover,focusColor:state.focus,reservedInlineEndWidth:state.reserved};
 return h(React.Fragment,null,
  h('form',{onSubmit:event=>{event.preventDefault();submits++;}},
   h('div',{'data-fixture-widget':'first'},state.mounted?h(CompleteCalendlyWidget,{...options,onScheduled(){writes.push({widget:'first',writer:state.writer,value:true});if(latest.current.reenter)document.querySelector('[data-fixture-widget="first"] .mx-sdk-calendly-trigger')?.click();}}):null),
   h('div',{'data-fixture-widget':'second'},state.second?h(CompleteCalendlyWidget,{configuredUrl:'https://calendly.com/__sdk_fixture_only__/two',email:null,name:null,embedDomain:location.origin,ownerKey:owners.B,schedulingTitle:'Book second',onScheduled(){writes.push({widget:'second',value:true});}}):null)),
  h('button',{type:'button'},'Outside control'),
  h('iframe',{src:'/wrong-source',title:'Synthetic wrong message source',tabIndex:-1,hidden:true}));
}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,h(App)));
window.completeCalendlyProof={
 snapshot:()=>({react:React.version,writes:[...writes],submits,messages,ports,mounted:observed.mounted,owner:observed.owner,enabled:observed.enabled,booked:observed.booked,writer:observed.writer,title:observed.title,reenter:observed.reenter,escape:{keys:[...escapeTrace.keys],cancels:[...escapeTrace.cancels],closes:[...escapeTrace.closes]}}),
 change:patch=>change(patch),
 capture(){capturedNode=document.querySelector('[data-fixture-widget="first"] iframe');capturedWindow=capturedNode?.contentWindow;},
 sameFrame:()=>capturedNode===document.querySelector('[data-fixture-widget="first"] iframe'),
 stale(){window.dispatchEvent(new MessageEvent('message',{origin:'https://calendly.com',source:capturedWindow,data:{event:'calendly.event_scheduled'}}));},
 port(){return new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=event=>{ports++;window.dispatchEvent(new MessageEvent('message',{data:event.data,origin:event.origin,source:event.source,ports:event.ports}));channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage({event:'calendly.event_scheduled'});});}
};
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
        const inputs = Object.keys(bundle.metafile.inputs).filter((p) =>
            p.includes('/sdk/dist/')
        );
        assert(
            inputs.some((p) => p.endsWith('/react/CompleteCalendlyWidget.js'))
        );
        assert(inputs.some((p) => p.endsWith('/react/CalendlyBooking.js')));
        for (const input of inputs)
            assert(
                realpathSync(resolve(root, input)).startsWith(installed + '/')
            );
        const css = readFileSync(
            join(installed, 'dist/esm/react/complete-calendly.css')
        );
        Object.assign(evidence, {
            sdkInputs: inputs,
            harnessSha256: hash(readFileSync(new URL(import.meta.url))),
            hostSha256: hash(source),
            bundleSha256: hash(bundle.outputFiles[0].contents),
            cssSha256: hash(css),
            frameSha256: hash(frameHtml),
        });
        server = createServer((request, response) => {
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-src 'self' https://calendly.com; form-action 'none'"
            );
            const path = new URL(request.url, 'http://localhost').pathname;
            if (path === '/proof.js') {
                response.setHeader('Content-Type', 'text/javascript');
                response.end(bundle.outputFiles[0].text);
            } else if (path === '/calendly.css') {
                response.setHeader('Content-Type', 'text/css');
                response.end(css);
            } else if (path === '/wrong-source') {
                response.setHeader('Content-Type', 'text/html');
                response.setHeader(
                    'Content-Security-Policy',
                    "default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'"
                );
                response.end(
                    '<!doctype html><script>window.sendWrong=()=>parent.postMessage({event:"calendly.event_scheduled"},"*");</script>'
                );
            } else if (path === '/') {
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Complete Calendly synthetic proof</title><link rel="stylesheet" href="/calendly.css"><main></main><script type="module" src="/proof.js"></script>'
                );
            } else {
                response.statusCode = path === '/favicon.ico' ? 204 : 404;
                response.end();
            }
        });
        await bounded(
            'complete Calendly server start',
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = `http://127.0.0.1:${server.address().port}`;
        for (const mobile of [false, true]) {
            context = await browser.newContext({
                serviceWorkers: 'block',
                viewport: mobile
                    ? { width: 390, height: 844 }
                    : { width: 1280, height: 800 },
            });
            await context.route('**/*', async (route) => {
                const request = route.request();
                const url = new URL(request.url());
                if (url.origin === origin) {
                    evidence.transport.localNetworkContinuations++;
                    return route.continue();
                }
                if (url.origin === 'https://calendly.com')
                    evidence.transport.interceptedCalendlyRequests++;
                if (
                    request.method() === 'GET' &&
                    url.origin === 'https://calendly.com' &&
                    fixturePaths.has(url.pathname)
                ) {
                    evidence.transport.memoryFulfilledFixtureRequests++;
                    return route.fulfill({
                        status: 200,
                        contentType: 'text/html',
                        headers: {
                            'Cache-Control': 'no-store',
                            'Content-Security-Policy':
                                "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'; base-uri 'none'",
                        },
                        body: frameHtml,
                    });
                }
                evidence.transport.externalAborts++;
                evidence.unexpectedRequests.push('non-fixture request aborted');
                await route.abort();
            });
            page = await context.newPage();
            page.setDefaultTimeout(5000);
            page.on('pageerror', (error) =>
                evidence.pageErrors.push(error.message)
            );
            const snapshot = () =>
                page.evaluate(() => window.completeCalendlyProof.snapshot());
            const change = (patch) =>
                page.evaluate(
                    (value) => window.completeCalendlyProof.change(value),
                    patch
                );
            const first = () => page.locator('[data-fixture-widget="first"]');
            const dialog = (name = 'Book synthetic') =>
                page.getByRole('dialog', { name, exact: true });
            const trigger = (name = 'Book synthetic') =>
                first().getByRole('button', { name, exact: true });
            const open = async (name = 'Book synthetic') => {
                await trigger(name).click();
                const current = dialog(name);
                await current.waitFor({ state: 'visible' });
                await current
                    .frameLocator('iframe')
                    .getByRole('button', {
                        name: 'First frame control',
                        exact: true,
                    })
                    .waitFor({ state: 'visible' });
                return current;
            };
            const reset = async (mode = 'normal') => {
                await page.goto(`${origin}/?mode=${mode}`);
                await first().waitFor({ state: 'visible' });
                await page.waitForFunction(
                    () => window.completeCalendlyProof != null
                );
            };
            const focusInside = async (current, phase) => {
                const fact = await current.evaluate((node) => {
                    const active = node.ownerDocument.activeElement;
                    return {
                        inside: node.contains(active),
                        activeIsIframe: active?.tagName === 'IFRAME',
                        openDialogs:
                            node.ownerDocument.querySelectorAll('dialog[open]')
                                .length,
                    };
                });
                // Only this fixed, fulfilled fixture is inspected. Never read
                // arbitrary provider content or supplied personal information.
                const childControl = fact.activeIsIframe
                    ? await current
                          .frameLocator('iframe')
                          .locator('body')
                          .evaluate(
                              (node) =>
                                  node.ownerDocument.activeElement?.id ?? ''
                          )
                    : null;
                evidence.focusChecks.push({
                    mobile,
                    phase,
                    childControl,
                    ...fact,
                });
                assert.equal(fact.inside, true, phase);
            };
            const focusRestored = async (name = 'Book synthetic') => {
                await page.waitForFunction((title) => {
                    const button = document.querySelector(
                        '[data-fixture-widget="first"] .mx-sdk-calendly-trigger'
                    );
                    return (
                        button?.textContent === title &&
                        document.activeElement === button
                    );
                }, name);
            };
            const close = async (name = 'Book synthetic') => {
                await dialog(name)
                    .getByRole('button', { name: 'Close', exact: true })
                    .click();
                await dialog(name).waitFor({ state: 'hidden' });
                await focusRestored(name);
            };
            const capture = () =>
                page.evaluate(() => window.completeCalendlyProof.capture());
            const stale = () =>
                page.evaluate(() => window.completeCalendlyProof.stale());

            evidence.phase = 'styled-focus-and-dismissal';
            await reset();
            await trigger().focus();
            await page.keyboard.press('Tab');
            await page.keyboard.press('Shift+Tab');
            const themedTrigger = await trigger().evaluate((node) => ({
                focused: node.ownerDocument.activeElement === node,
                focusVisible: node.matches(':focus-visible'),
                background: getComputedStyle(node).backgroundColor,
                outline: getComputedStyle(node).outlineColor,
            }));
            assert.equal(themedTrigger.focused, true);
            assert.equal(themedTrigger.focusVisible, true);
            assert.equal(themedTrigger.background, 'rgb(15, 118, 110)');
            assert.equal(themedTrigger.outline, 'rgb(20, 184, 166)');
            await trigger().hover();
            assert.equal(
                await trigger().evaluate(
                    (node) => getComputedStyle(node).backgroundColor
                ),
                'rgb(13, 148, 136)'
            );
            await page.mouse.move(0, 0);
            let current = await open();
            assert.equal(await trigger().getAttribute('type'), 'button');
            assert.equal((await snapshot()).submits, 0);
            assert.equal(
                await current.locator('iframe').getAttribute('title'),
                'Schedule with Calendly'
            );
            assert.equal(
                await current.locator('iframe').getAttribute('sandbox'),
                'allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts'
            );
            assert.equal(
                await current.locator('iframe').getAttribute('referrerpolicy'),
                'strict-origin-when-cross-origin'
            );
            const destination = new URL(
                await current.locator('iframe').getAttribute('src')
            );
            assert.equal(destination.searchParams.get('keep'), 'yes');
            assert.equal(
                destination.searchParams.get('email'),
                'synthetic+booking@example.test'
            );
            assert.equal(
                destination.searchParams.get('name'),
                'Synthetic & 東京'
            );
            assert.equal(destination.searchParams.get('embed_domain'), origin);
            assert.equal(
                destination.searchParams.get('embed_type'),
                'PopupText'
            );
            await page.waitForFunction(
                () =>
                    document.activeElement?.tagName === 'IFRAME' &&
                    document.activeElement.closest('dialog') != null
            );
            const panel = current.locator('.mx-sdk-calendly-panel');
            const geometry = await panel.boundingBox();
            assert(geometry != null);
            const viewport = page.viewportSize();
            assert.equal(
                await current.evaluate(
                    (node) => getComputedStyle(node).paddingInlineEnd
                ),
                mobile ? '16px' : '240px'
            );
            assert(
                geometry.height > 150 &&
                    geometry.height <= viewport.height * 0.8 + 2
            );
            assert(
                geometry.width > 150 &&
                    geometry.width <= Math.min(514, viewport.width)
            );
            assert(
                geometry.x >= 0 &&
                    geometry.x + geometry.width <= viewport.width + 1
            );
            for (const direction of ['Tab', 'Shift+Tab']) {
                for (let step = 0; step < 10; step++) {
                    await page.keyboard.press(direction);
                    await focusInside(current, `${direction}-${step}`);
                }
            }
            const reachedControls = new Set(
                evidence.focusChecks
                    .filter((fact) => fact.mobile === mobile)
                    .map((fact) => fact.childControl)
            );
            for (const id of [
                'first',
                'schedule',
                'duplicate',
                'invalid',
                'last',
            ])
                assert(
                    reachedControls.has(id),
                    `keyboard reaches synthetic frame control ${id}`
                );
            // A pointer that starts within the panel and ends outside is not a
            // backdrop dismissal. The actual overlay click below still closes.
            await page.mouse.move(geometry.x + 12, geometry.y + 12);
            await page.mouse.down();
            await page.mouse.move(4, 4);
            await page.mouse.up();
            assert.equal(await current.isVisible(), true);
            await page.screenshot({
                path: join(
                    output,
                    `complete-calendly-${mobile ? 'narrow' : 'wide'}.png`
                ),
            });
            await page.mouse.click(4, 4);
            await current.waitFor({ state: 'hidden' });
            await focusRestored();
            assert.deepEqual((await snapshot()).writes, []);
            evidence.phase = 'parent-focused-escape';
            current = await open();
            const closeControl = current.getByRole('button', {
                name: 'Close',
                exact: true,
            });
            await closeControl.focus();
            assert.equal(
                await closeControl.evaluate(
                    (node) => node.ownerDocument.activeElement === node
                ),
                true
            );
            const parentBefore = (await snapshot()).escape;
            await page.keyboard.press('Escape');
            await current.waitFor({ state: 'hidden' });
            await focusRestored();
            const parentAfter = (await snapshot()).escape;
            evidence.escapeChecks.push({
                mobile,
                context: 'parent-close-control',
                before: parentBefore,
                after: parentAfter,
                dismissed: true,
            });
            assert.equal(parentAfter.keys.length, parentBefore.keys.length + 1);
            assert.equal(parentAfter.keys.at(-1).trusted, true);
            assert.equal(
                parentAfter.cancels.length,
                parentBefore.cancels.length + 1
            );
            assert.deepEqual((await snapshot()).writes, []);
            evidence.phase = 'child-focused-escape';
            current = await open();
            await current
                .frameLocator('iframe')
                .getByRole('button', {
                    name: 'First frame control',
                    exact: true,
                })
                .focus();
            const childBody = await current
                .frameLocator('iframe')
                .locator('body')
                .elementHandle();
            const dialogNode = await current.elementHandle();
            assert(childBody && dialogNode);
            const childState = async () => {
                try {
                    return await childBody.evaluate((node) => ({
                        activeId: node.ownerDocument.activeElement?.id ?? null,
                        hasFocus: node.ownerDocument.hasFocus(),
                        traceReady: window.__calendlyEscapeTrace != null,
                        keys: [...(window.__calendlyEscapeTrace?.keys ?? [])],
                    }));
                } catch {
                    return { unavailable: 'child-context' };
                }
            };
            const childBefore = await childState();
            assert.equal(childBefore.activeId, 'first');
            const childParentBefore = (await snapshot()).escape;
            await page.keyboard.press('Escape');
            let dialogAfter;
            try {
                dialogAfter = await dialogNode.evaluate((node) => ({
                    open: node.open,
                    connected: node.isConnected,
                    parentActiveIsFrame:
                        node.ownerDocument.activeElement ===
                        node.querySelector('iframe'),
                }));
            } catch {
                dialogAfter = { unavailable: 'dialog-context' };
            }
            const childAfter = await childState();
            const childParentAfter = (await snapshot()).escape;
            evidence.escapeChecks.push({
                mobile,
                context: 'cross-origin-child',
                childBefore,
                childAfter,
                parentBefore: childParentBefore,
                parentAfter: childParentAfter,
                dialog: dialogAfter,
            });
            // The embedded document owns this key: native Headless UI listens
            // on its owner window, and no provider Escape bridge is supplied.
            // Preserve that observed boundary rather than invent cooperation.
            assert.equal(childBefore.hasFocus, true);
            assert.equal(childBefore.traceReady, true);
            assert.equal(childAfter.activeId, 'first');
            assert.equal(childAfter.hasFocus, true);
            assert.equal(childAfter.keys.length, childBefore.keys.length + 1);
            assert.equal(childAfter.keys.at(-1).trusted, true);
            assert.equal(childAfter.keys.at(-1).activeId, 'first');
            assert.deepEqual(childParentAfter.keys, childParentBefore.keys);
            assert.deepEqual(
                childParentAfter.cancels,
                childParentBefore.cancels
            );
            assert.deepEqual(dialogAfter, {
                open: true,
                connected: true,
                parentActiveIsFrame: true,
            });
            assert.equal(await current.isVisible(), true);
            assert.deepEqual((await snapshot()).writes, []);

            // A real keyboard path must still reach the parent Close control.
            // Escape there must dismiss, restore the trigger and never write.
            evidence.phase = 'child-to-parent-keyboard-dismissal';
            await page.keyboard.press('Shift+Tab');
            await page.waitForFunction(() =>
                document.activeElement?.matches('.mx-sdk-calendly-close')
            );
            assert.equal(
                await current
                    .getByRole('button', { name: 'Close', exact: true })
                    .evaluate(
                        (node) => node.ownerDocument.activeElement === node
                    ),
                true
            );
            const returnedParentBefore = (await snapshot()).escape;
            await page.keyboard.press('Escape');
            await current.waitFor({ state: 'hidden' });
            await focusRestored();
            const returnedParentAfter = (await snapshot()).escape;
            assert.equal(
                returnedParentAfter.keys.length,
                returnedParentBefore.keys.length + 1
            );
            assert.equal(returnedParentAfter.keys.at(-1).trusted, true);
            assert.equal(
                returnedParentAfter.cancels.length,
                returnedParentBefore.cancels.length + 1
            );
            evidence.escapeChecks.push({
                mobile,
                context: 'child-to-parent-keyboard-dismissal',
                before: returnedParentBefore,
                after: returnedParentAfter,
                dismissed: true,
            });
            assert.deepEqual((await snapshot()).writes, []);
            assert.equal((await snapshot()).submits, 0);
            await open();
            await close();
            evidence.results.push({
                mobile,
                case: 'styled-geometry-keyboard-backdrop-parent-escape-frame-boundary-close',
                geometry,
                themedTrigger,
                paddingInlineEnd: mobile ? 16 : 240,
            });

            evidence.phase = 'message-admission';
            await reset();
            current = await open();
            await capture();
            await close();
            await stale();
            assert.deepEqual((await snapshot()).writes, []);
            current = await open();
            await stale();
            assert.deepEqual((await snapshot()).writes, []);
            const frame = current.frameLocator('iframe');
            const beforeNull = (await snapshot()).messages;
            await frame
                .getByRole('button', { name: 'Send null event', exact: true })
                .click();
            await page.waitForFunction(
                (before) =>
                    window.completeCalendlyProof.snapshot().messages > before,
                beforeNull
            );
            assert.deepEqual((await snapshot()).writes, []);
            const wrong = page.frameLocator(
                'iframe[title="Synthetic wrong message source"]'
            );
            const beforeWrong = (await snapshot()).messages;
            await wrong.locator('body').evaluate(() => window.sendWrong());
            await page.waitForFunction(
                (before) =>
                    window.completeCalendlyProof.snapshot().messages > before,
                beforeWrong
            );
            await page.evaluate(() => window.completeCalendlyProof.port());
            assert.equal((await snapshot()).ports, 1);
            assert.deepEqual((await snapshot()).writes, []);
            await capture();
            await frame
                .getByRole('button', { name: 'Schedule twice', exact: true })
                .click();
            await page.waitForFunction(
                () =>
                    window.completeCalendlyProof.snapshot().writes.length === 1
            );
            await current.waitFor({ state: 'hidden' });
            assert.deepEqual((await snapshot()).writes, [
                { widget: 'first', writer: 'initial', value: true },
            ]);
            await stale();
            assert.equal((await snapshot()).writes.length, 1);
            current = await open();
            await stale();
            assert.equal((await snapshot()).writes.length, 1);
            await current
                .frameLocator('iframe')
                .getByRole('button', {
                    name: 'Schedule synthetic booking',
                    exact: true,
                })
                .click();
            await page.waitForFunction(
                () =>
                    window.completeCalendlyProof.snapshot().writes.length === 2
            );
            await current.waitFor({ state: 'hidden' });
            evidence.results.push({
                mobile,
                case: 'real-cross-origin-messages-plus-stale-window-null-local-source-port-negatives',
                writes: 2,
            });

            evidence.phase = 'current-writer-and-retirement';
            await reset();
            current = await open();
            await capture();
            await change({
                writer: 'current',
                title: 'Renamed synthetic',
                accent: '#7c3aed',
                hover: '#9333ea',
                focus: '#a855f7',
                reserved: '260px',
            });
            await dialog('Renamed synthetic').waitFor({ state: 'visible' });
            assert.equal(
                await page.evaluate(() =>
                    window.completeCalendlyProof.sameFrame()
                ),
                true
            );
            assert.equal(
                await trigger('Renamed synthetic').evaluate(
                    (node) => getComputedStyle(node).backgroundColor
                ),
                'rgb(124, 58, 237)'
            );
            assert.equal(
                await dialog('Renamed synthetic').evaluate(
                    (node) => getComputedStyle(node).paddingInlineEnd
                ),
                mobile ? '16px' : '260px'
            );
            await dialog('Renamed synthetic')
                .frameLocator('iframe')
                .getByRole('button', { name: 'Schedule twice', exact: true })
                .click();
            await page.waitForFunction(
                () =>
                    window.completeCalendlyProof.snapshot().writes.length === 1
            );
            assert.deepEqual((await snapshot()).writes, [
                { widget: 'first', writer: 'current', value: true },
            ]);
            for (const [kind, patch, restore] of [
                ['owner', { owner: 'B' }, { owner: 'A' }],
                [
                    'URL',
                    {
                        url: 'https://calendly.com/__sdk_fixture_only__/replacement',
                    },
                    {
                        url: 'https://calendly.com/__sdk_fixture_only__/one?keep=yes',
                    },
                ],
                [
                    'prefill',
                    { name: 'Replacement synthetic' },
                    { name: 'Synthetic & 東京' },
                ],
                ['readonly', { enabled: false }, { enabled: true }],
                ['booked', { booked: true }, { booked: false }],
            ]) {
                current = await open('Renamed synthetic');
                await capture();
                const before = (await snapshot()).writes.length;
                await change(patch);
                await current.waitFor({ state: 'hidden' });
                if (kind === 'readonly')
                    assert.equal(
                        await trigger('Renamed synthetic').isDisabled(),
                        true
                    );
                if (kind === 'booked')
                    assert.equal(
                        await first()
                            .getByText('✅ Booked', { exact: true })
                            .isVisible(),
                        true
                    );
                await stale();
                assert.equal((await snapshot()).writes.length, before);
                await change(restore);
                await trigger('Renamed synthetic').waitFor({
                    state: 'visible',
                });
                current = await open('Renamed synthetic');
                await stale();
                assert.equal((await snapshot()).writes.length, before);
                await close('Renamed synthetic');
                evidence.results.push({
                    mobile,
                    case: `${kind}-retirement-and-ABA-stale-rejection`,
                });
            }
            current = await open('Renamed synthetic');
            await capture();
            await change({ mounted: false });
            await current.waitFor({ state: 'hidden' });
            await stale();
            assert.equal((await snapshot()).writes.length, 1);
            evidence.results.push({
                mobile,
                case: 'unmount-rejects-late-source',
            });

            evidence.phase = 'reentrant-and-multiple-lifetimes';
            await reset();
            await change({ reenter: true });
            await page.waitForFunction(
                () => window.completeCalendlyProof.snapshot().reenter
            );
            current = await open();
            await capture();
            await current
                .frameLocator('iframe')
                .getByRole('button', {
                    name: 'Schedule synthetic booking',
                    exact: true,
                })
                .click();
            await page.waitForFunction(
                () =>
                    window.completeCalendlyProof.snapshot().writes.length ===
                        1 && !window.completeCalendlyProof.sameFrame()
            );
            await current
                .frameLocator('iframe')
                .getByRole('button', {
                    name: 'First frame control',
                    exact: true,
                })
                .waitFor({ state: 'visible' });
            await stale();
            assert.equal((await snapshot()).writes.length, 1);
            await change({ reenter: false });
            await close();
            current = await open();
            // The controlled host invokes the second widget's real public
            // trigger; no second hook/controller or private admission is used.
            await page.evaluate(() =>
                document
                    .querySelector(
                        '[data-fixture-widget="second"] .mx-sdk-calendly-trigger'
                    )
                    .click()
            );
            const second = dialog('Book second');
            await second
                .frameLocator('iframe')
                .getByRole('button', {
                    name: 'First frame control',
                    exact: true,
                })
                .waitFor({ state: 'visible' });
            await focusInside(second, 'second-widget-open');
            await second
                .frameLocator('iframe')
                .getByRole('button', {
                    name: 'Schedule synthetic booking',
                    exact: true,
                })
                .click();
            await second.waitFor({ state: 'hidden' });
            assert.deepEqual((await snapshot()).writes, [
                { widget: 'first', writer: 'initial', value: true },
                { widget: 'second', value: true },
            ]);
            assert.equal(await current.isVisible(), true);
            await page.evaluate(() =>
                document
                    .querySelector(
                        '[data-fixture-widget="second"] .mx-sdk-calendly-trigger'
                    )
                    .click()
            );
            await second
                .frameLocator('iframe')
                .getByRole('button', {
                    name: 'First frame control',
                    exact: true,
                })
                .waitFor({ state: 'visible' });
            await change({ mounted: false });
            await current.waitFor({ state: 'hidden' });
            await focusInside(second, 'first-retired-keeps-second-focus');
            await second
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            await second.waitFor({ state: 'hidden' });
            evidence.results.push({
                mobile,
                case: 'reentrant-public-trigger-and-independent-nested-widget',
            });

            evidence.phase = 'localization-and-refusals';
            await reset('french');
            await open('Programme');
            await close('Programme');
            for (const mode of ['http', 'foreign', 'malformed']) {
                await reset(mode);
                const error = first().getByRole('alert');
                await error.waitFor({ state: 'visible' });
                assert.equal(
                    await error.textContent(),
                    'Calendly requires a valid HTTPS calendly.com scheduling URL.'
                );
                assert.equal(await first().getByRole('button').count(), 0);
                assert.equal(await first().locator('iframe').count(), 0);
                assert.deepEqual((await snapshot()).writes, []);
            }
            await reset();
            await change({ email: null, name: null });
            current = await open();
            const withoutPrefill = new URL(
                await current.locator('iframe').getAttribute('src')
            );
            assert.equal(withoutPrefill.searchParams.has('email'), false);
            assert.equal(withoutPrefill.searchParams.has('name'), false);
            await close();
            evidence.results.push({
                mobile,
                case: 'French-default-title-three-invalid-URLs-and-resolved-null-prefills',
            });
            assert.equal((await snapshot()).submits, 0);
            await context.close();
            context = undefined;
            page = undefined;
        }
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        assert(evidence.transport.memoryFulfilledFixtureRequests > 0);
        assert.equal(
            evidence.transport.interceptedCalendlyRequests,
            evidence.transport.memoryFulfilledFixtureRequests
        );
        assert.equal(evidence.transport.externalNetworkContinuations, 0);
        assert.equal(evidence.transport.externalAborts, 0);
        evidence.scope =
            'Installed complete Calendly UI with synthetic resolved prefills and memory-fulfilled cross-origin iframe transport. Calendly-origin browser Request objects are intercepted, never continued to an external network; only exact fixed fixture paths are fulfilled from memory and every other external request is aborted. No real booking, native schema projection, persistence or hosted acceptance. Stale-window and port controls are explicitly synthetic message negatives.';
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.failure = error.message;
        if (page) {
            try {
                evidence.failureState = await page.evaluate(() =>
                    window.completeCalendlyProof?.snapshot()
                );
                await page.screenshot({
                    path: join(output, 'complete-calendly-failure.png'),
                    fullPage: true,
                });
            } catch (captureError) {
                evidence.failureCaptureError = captureError.message;
            }
        }
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
                await bounded(`complete Calendly cleanup ${name}`, cleanup);
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                evidence.status = 'failed';
                evidence.cleanup[name] = { error: error.message };
                failure ??= error;
            }
        }
        if (failure) {
            evidence.status = 'failed';
            evidence.failure = failure.message;
        }
        writeFileSync(
            join(output, 'complete-calendly.json'),
            JSON.stringify(evidence, null, 2)
        );
    }
    if (failure) throw failure;
}
