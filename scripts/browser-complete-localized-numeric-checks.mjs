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

// Installed public UI and trusted keyboard/pointer input. The controlled host
// supplies canonical values and guarded writes; it is not a native Form binding.
export async function checkCompleteLocalizedNumericBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    Object.assign(evidence, {
        status: 'running',
        phase: 'building',
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
        directory = mkdtempSync(join(root, '.localized-numeric-native-'));
        const source = `
import React,{createElement as h,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {NumberField,CompleteLocalizedNumericField} from '@miniextensions/sdk/react';
const mode=new URLSearchParams(location.search).get('mode')||'number';
let writes=[],inputs=[],submits=0;
const defaults={number:1234.5,percent:0.425,currency:-1234.5,deferred:0.25,mobile:12.5};
function App(){
 const [state,setState]=useState({value:defaults[mode],readonly:false,owner:{},mounted:true,display:false});
 const kind=mode==='deferred'?'percent':mode==='mobile'?'number':mode;
 const scope=state.owner;
 const metadata={type:kind,options:{precision:2,...(kind==='currency'?{symbol:'<img src=x> literal '}: {})}};
 const field={physicalKind:kind,presentation:{type:'physical',config:metadata},fieldId:'numeric',title:'Synthetic amount',field:{id:'numeric',name:'Synthetic amount',description:null,isComputed:false,isPrimaryField:false,config:metadata},displayConfig:{numberSeparator:'period-comma',showThousandsSeparator:true,allowNegativeNumbers:true,showAsProgressBar:kind==='percent',readOnly:state.readonly},value:state.value,context:'form',computed:false,dirty:false,pending:false,error:null,validation:[],capability:{type:'editable',setValue(value){if(scope!==state.owner||state.readonly)return{accepted:false,reason:'retired'};writes.push(value);setState(old=>({...old,value}));return{accepted:true};}}};
 return h(React.Fragment,null,
  h('form',{id:'native-form',onSubmit:event=>{event.preventDefault();submits++;}},
   state.mounted?h(kind==='number'?NumberField:CompleteLocalizedNumericField,{...(kind==='number'?{mode:'controlled'}:{}),field,options:{owner:{token:scope,isCurrent:()=>!state.readonly},commit:mode==='deferred'?'deferred':'immediate',presentation:state.display?'display':'editor',input:{id:'native-number',form:'native-form',onInput:event=>inputs.push({trusted:event.nativeEvent.isTrusted,value:event.currentTarget.value})},clearLabel:'Clear synthetic amount'}}):null),
  h('output',{'aria-label':'Canonical value'},JSON.stringify(state.value)),
  h('button',{type:'button',onMouseDown:event=>event.preventDefault(),onClick:()=>setState(old=>({...old,value:0.1}))},'Echo canonical value'),
  h('button',{type:'button',onClick:()=>setState(old=>({...old,value:12.345,display:true}))},'Show large readonly value'),
  h('button',{type:'button',onClick:()=>setState(old=>({...old,readonly:true}))},'Make readonly'),
  h('button',{type:'button',onMouseDown:event=>event.preventDefault(),onClick:()=>setState(old=>({...old,owner:{},value:0.5}))},'Replace owner'),
  h('button',{type:'button',onClick:()=>setState(old=>({...old,mounted:false}))},'Remove input'),
  h('button',{type:'button',onClick:()=>setState(old=>({...old,value:null,display:true}))},'Show empty value'));
}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,h(App)));
window.numericProof={snapshot:()=>({reactVersion:React.version,writes:[...writes],inputs:[...inputs],submits})};
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
            inputs.some((p) =>
                p.endsWith('/react/CompleteLocalizedNumericField.js')
            )
        );
        for (const input of inputs)
            assert(
                realpathSync(resolve(root, input)).startsWith(installed + '/')
            );
        const css = readFileSync(
            join(installed, 'dist/esm/react/localized-numeric.css')
        );
        evidence.sdkInputs = inputs;
        evidence.harnessSha256 = hash(readFileSync(new URL(import.meta.url)));
        evidence.hostSha256 = hash(source);
        evidence.bundleSha256 = hash(bundle.outputFiles[0].contents);
        evidence.cssSha256 = hash(css);
        server = createServer((request, response) => {
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'"
            );
            const path = new URL(request.url, 'http://localhost').pathname;
            if (path === '/proof.js') {
                response.setHeader('Content-Type', 'text/javascript');
                response.end(bundle.outputFiles[0].text);
            } else if (path === '/numeric.css') {
                response.setHeader('Content-Type', 'text/css');
                response.end(css);
            } else if (path === '/') {
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Complete localized numeric proof</title><link rel="stylesheet" href="/numeric.css"><main></main><script type="module" src="/proof.js"></script>'
                );
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await bounded(
            'numeric server start',
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = `http://127.0.0.1:${server.address().port}`;
        const open = async (mode, mobile = false) => {
            if (context) await context.close();
            context = await browser.newContext({
                serviceWorkers: 'block',
                ...(mobile
                    ? {
                          viewport: { width: 390, height: 844 },
                          isMobile: true,
                          hasTouch: true,
                          userAgent:
                              'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
                      }
                    : {}),
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
                    ['/', '/proof.js', '/numeric.css'].includes(url.pathname)
                )
                    return route.continue();
                evidence.unexpectedRequests.push(url.origin + url.pathname);
                return route.abort();
            });
            evidence.phase = mode;
            await page.goto(origin + '?mode=' + mode);
            await page
                .getByRole('textbox', { name: 'Synthetic amount', exact: true })
                .waitFor();
            return page.getByRole('textbox', {
                name: 'Synthetic amount',
                exact: true,
            });
        };
        const snapshot = () =>
            page.evaluate(() => window.numericProof.snapshot());
        const finish = async (name) => {
            const state = await snapshot();
            assert.equal(state.submits, 0);
            assert(state.inputs.every((item) => item.trusted));
            assert.deepEqual(evidence.pageErrors, []);
            assert.deepEqual(evidence.unexpectedRequests, []);
            evidence.reactVersion = state.reactVersion;
            evidence.results.push({
                name,
                state,
                ax: await page.locator('body').ariaSnapshot(),
            });
            await page.screenshot({
                path: join(output, 'numeric-' + name + '.png'),
                fullPage: true,
            });
        };
        let input = await open('number');
        assert.equal(await input.inputValue(), '1.234,50');
        await input.focus();
        assert.equal(await input.inputValue(), '1234,50');
        await page.keyboard.press('Home');
        for (let i = 0; i < 4; i++)
            await page.keyboard.press('Shift+ArrowRight');
        await input.pressSequentially('9');
        assert.equal(await input.inputValue(), '9,50');
        assert.deepEqual((await snapshot()).writes, [9.5]);
        assert.equal(await input.evaluate((node) => node.selectionStart), 1);
        await page
            .getByRole('button', { name: 'Echo canonical value' })
            .click();
        assert.equal(await input.inputValue(), '9,50');
        assert.equal(await input.evaluate((node) => node.selectionStart), 1);
        await page.getByRole('button', { name: 'Make readonly' }).focus();
        assert.equal(await input.inputValue(), '0,10');
        assert.deepEqual((await snapshot()).writes, [9.5]);
        await finish('number-selection-locale');

        input = await open('percent');
        assert.equal(await input.inputValue(), '42,50');
        assert.equal(
            await page
                .locator('.mx-sdk-localized-numeric-fill')
                .evaluate((node) => node.style.width),
            '42.5%'
        );
        await input.focus();
        await page.keyboard.press('ControlOrMeta+A');
        await input.pressSequentially('75,25');
        assert.equal((await snapshot()).writes.at(-1), 0.7525);
        await page
            .getByRole('button', { name: 'Show large readonly value' })
            .click();
        assert.equal(
            await page
                .locator('.mx-sdk-localized-numeric-progress-label')
                .textContent(),
            '1.234,50%'
        );
        assert.equal(
            await page
                .locator('.mx-sdk-localized-numeric-fill')
                .evaluate((node) => node.style.width),
            '100%'
        );
        await finish('percent-canonical-progress');

        input = await open('deferred');
        await input.focus();
        await page.keyboard.press('ControlOrMeta+A');
        await input.pressSequentially('75,25');
        assert.deepEqual((await snapshot()).writes, []);
        await page.keyboard.press('Enter');
        assert.deepEqual((await snapshot()).writes, [0.7525]);
        await page.getByRole('button', { name: 'Remove input' }).click();
        assert.deepEqual((await snapshot()).writes, [0.7525]);
        await finish('deferred-enter-once');

        input = await open('deferred');
        await input.focus();
        await page.keyboard.press('ControlOrMeta+A');
        await input.pressSequentially('55');
        // The host's button preserves focus while replacing its actual owner,
        // so this does not accidentally commit the old draft through blur.
        await page.getByRole('button', { name: 'Replace owner' }).click();
        assert.deepEqual((await snapshot()).writes, []);
        assert.equal(await input.inputValue(), '50,00');
        await page.keyboard.press('ControlOrMeta+A');
        await input.pressSequentially('60');
        await page.keyboard.press('Enter');
        assert.deepEqual((await snapshot()).writes, [0.6]);
        await finish('deferred-host-replacement');

        input = await open('currency');
        assert.equal(
            await page
                .locator('.mx-sdk-localized-numeric-symbol')
                .textContent(),
            '<img src=x> literal '
        );
        assert.equal(await page.locator('img').count(), 0);
        await page.getByRole('button', { name: 'Make readonly' }).click();
        assert.equal(await input.isDisabled(), true);
        await page.getByRole('button', { name: 'Show empty value' }).click();
        assert.equal(
            await page.locator('.mx-sdk-localized-numeric-empty').textContent(),
            'No value'
        );
        assert.equal(
            await page.locator('.mx-sdk-localized-numeric-empty svg').count(),
            1
        );
        await finish('currency-literal-empty-readonly');

        input = await open('mobile', true);
        assert.equal(await page.evaluate(() => window.innerWidth), 390);
        const clear = page.getByRole('button', {
            name: 'Clear synthetic amount',
            exact: true,
        });
        await clear.waitFor();
        assert.equal(await clear.getAttribute('type'), 'button');
        await clear.tap();
        assert.deepEqual((await snapshot()).writes, [null]);
        assert.equal(await input.inputValue(), '');
        await page.emulateMedia({ forcedColors: 'active' });
        await finish('mobile-clear-forced-colors');
        assert.equal(evidence.results.length, 6);
        evidence.scope =
            'Installed complete numeric UI with trusted input; no native Form/backend/clipboard/live-device claim.';
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page) {
            try {
                evidence.failureState = await page.evaluate(() =>
                    window.numericProof?.snapshot()
                );
                await page.screenshot({
                    path: join(output, 'numeric-failure.png'),
                    fullPage: true,
                });
            } catch (capture) {
                evidence.failureCaptureError = capture.message;
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
                await bounded('numeric cleanup ' + name, cleanup);
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                evidence.cleanup[name] = { error: error.message };
                evidence.status = 'failed';
                failure ??= error;
            }
        }
    }
    if (failure) throw failure;
}
