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

// Synthetic controlled host, installed public entry points, actual browser input.
// Canonical state and deferred metadata remain host-owned; no provider is called.
export async function checkControlledSelectBrowser({
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
    const bounded = async (operation) => {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(operation),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                Error('Controlled Select cleanup timed out')
                            ),
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
        const installed = realpathSync(
            join(root, 'node_modules/@miniextensions/sdk')
        );
        directory = mkdtempSync(join(root, '.controlled-select-proof-'));
        const css = readFileSync(
            join(installed, 'dist/esm/react/controlled-select.css')
        );
        const assets = new Map([['/select.css', css]]);
        evidence.inputs = {};
        for (const format of ['esm', 'cjs']) {
            const imports =
                format === 'esm'
                    ? "import React from 'react';import {createRoot} from 'react-dom/client';import {SingleSelectField,MultipleSelectsField} from '@miniextensions/sdk/react';"
                    : "const React=require('react');const {createRoot}=require('react-dom/client');const {SingleSelectField,MultipleSelectsField}=require('@miniextensions/sdk/react');";
            const source =
                imports +
                `
const {createElement:h,useState,useRef}=React;
let writes=[],submits=0,activations=0,observed;
const choices=[{id:'a',name:'Alpha',displayName:'First'},{id:'b',name:'Beta',displayName:'Second'},{id:'c',name:'Gamma',displayName:'Third'}];
function App(){
 const [state,setState]=useState({single:null,multi:['Alpha','Beta'],limited:['Alpha'],choices,readonly:false,active:true,token:{}});
 const latest=useRef(state);latest.current=state;observed=state;
 const scope=state.token;
 const owner={token:scope,isCurrent:()=>latest.current.active&&latest.current.token===scope};
 const common={choices:state.choices,availableChoices:state.choices,owner,readOnly:state.readonly,formId:'select-form'};
 const change=(key,value)=>{if(!owner.isCurrent()||latest.current.readonly)return false;writes.push({kind:'value',key,value});setState(old=>({...old,[key]:value}));};
 return h('form',{id:'select-form',onSubmit:event=>{event.preventDefault();submits++;}},
 h('label',{htmlFor:'single'},'Decision'),h('p',{id:'select-help'},'Choice help'),
 h(SingleSelectField,{...common,inputId:'single',ariaLabel:'Decision',describedBy:'select-help',presentation:'dropdown',value:state.single,onValueChange:value=>change('single',value),allowAddingNewOptions:true,publishMetadata:choice=>{if(!owner.isCurrent())return false;writes.push({kind:'metadata',choice});setState(old=>({...old,choices:[...old.choices,choice]}));return true;}}),
 h(MultipleSelectsField,{...common,ariaLabel:'Many',presentation:'list',value:state.multi,maxSelections:2,onValueChange:value=>change('multi',value)}),
 h(MultipleSelectsField,{...common,ariaLabel:'One from many',presentation:'list',value:state.limited,limitToOneSelection:true,onValueChange:value=>change('limited',value)}),
 h('div',{'data-grid-cell':'',onClick:()=>{activations++;}},h(MultipleSelectsField,{...common,presentation:'dropdown',readOnly:true,value:['Missing'],onValueChange:()=>{throw Error('readonly writer');}})),
 h('label',null,'Adjacent sentinel',h('input',{defaultValue:'untouched'})),
 h('button',{type:'button',onClick:()=>setState(old=>({...old,readonly:!old.readonly}))},'Toggle readonly'),
 h('button',{type:'button',onClick:()=>setState(old=>({...old,active:false}))},'Retire owner'),
 h('button',{type:'submit'},'Explicit Save'));
}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,h(App)));
window.selectProof={snapshot:()=>({react:React.version,writes:[...writes],submits,activations,single:observed.single,multi:observed.multi,limited:observed.limited})};
`;
            const entry = join(
                directory,
                `host.${format === 'esm' ? 'mjs' : 'cjs'}`
            );
            writeFileSync(entry, source);
            const bundle = await build({
                absWorkingDir: root,
                entryPoints: [entry],
                bundle: true,
                platform: 'browser',
                format: 'esm',
                write: false,
                metafile: true,
            });
            await assertBrowserInputs(bundle.metafile, root);
            const inputs = Object.keys(bundle.metafile.inputs).filter((path) =>
                path.includes('/sdk/dist/')
            );
            assert(
                inputs.some((path) =>
                    path.endsWith('/react/ControlledSelectField.js')
                )
            );
            for (const input of inputs)
                assert(
                    realpathSync(resolve(root, input)).startsWith(
                        installed + '/'
                    )
                );
            evidence.inputs[format] = inputs;
            evidence[format + 'HostSha256'] = createHash('sha256')
                .update(source)
                .digest('hex');
            assets.set('/' + format + '.js', bundle.outputFiles[0].contents);
        }
        server = createServer((request, response) => {
            const url = new URL(request.url, 'http://localhost');
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'"
            );
            if (url.pathname === '/') {
                const format = url.searchParams.get('format');
                assert(['esm', 'cjs'].includes(format));
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Controlled Select proof</title><link rel="stylesheet" href="/select.css"><main></main><script type="module" src="/' +
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
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await bounded(
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = 'http://127.0.0.1:' + server.address().port;
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
            await page.route('**/*', (route) => {
                const url = new URL(route.request().url());
                if (
                    url.origin === origin &&
                    ['/', '/select.css', '/esm.js', '/cjs.js'].includes(
                        url.pathname
                    )
                )
                    return route.continue();
                evidence.unexpectedRequests.push(url.origin + url.pathname);
                return route.abort();
            });
            evidence.phase = format;
            await page.goto(origin + '/?format=' + format);
            const snapshot = () =>
                page.evaluate(() => window.selectProof.snapshot());
            const single = page.getByRole('combobox', {
                name: 'Decision',
                exact: true,
            });
            await single.fill('Second');
            await single.press('ArrowDown');
            await single.press('Enter');
            assert.equal((await snapshot()).single, 'Beta');
            assert.equal((await snapshot()).submits, 0);
            assert.equal(
                await single.getAttribute('aria-describedby'),
                'select-help'
            );
            await page
                .getByRole('button', { name: 'Remove Second', exact: true })
                .click();
            assert.equal((await snapshot()).single, null);
            await single.fill(' New choice ');
            await page
                .getByRole('option', {
                    name: /^Add new option/,
                    exact: false,
                })
                .click();
            const creation = (await snapshot()).writes.slice(-2);
            assert.deepEqual(creation, [
                {
                    kind: 'metadata',
                    choice: { id: '', name: 'New choice', newOption: true },
                },
                { kind: 'value', key: 'single', value: 'New choice' },
            ]);
            const many = page.getByRole('group', { name: 'Many', exact: true });
            assert.equal(
                await many
                    .getByRole('checkbox', { name: 'Third', exact: true })
                    .isDisabled(),
                true
            );
            await many
                .getByRole('checkbox', { name: 'First', exact: true })
                .uncheck();
            await many
                .getByRole('checkbox', { name: 'Third', exact: true })
                .check();
            assert.deepEqual((await snapshot()).multi, ['Beta', 'Gamma']);
            const one = page.getByRole('group', {
                name: 'One from many',
                exact: true,
            });
            assert.equal(await one.getByRole('checkbox').count(), 0);
            await one
                .getByRole('radio', { name: 'Second', exact: true })
                .click();
            assert.deepEqual((await snapshot()).limited, ['Beta']);
            await one
                .getByRole('radio', { name: 'Second', exact: true })
                .click();
            assert.deepEqual((await snapshot()).limited, []);
            const missing = page.locator(
                '[data-grid-cell] .mx-sdk-select-badge'
            );
            assert.equal(
                await missing.evaluate(
                    (node) => getComputedStyle(node).backgroundColor
                ),
                'rgb(128, 128, 128)'
            );
            await missing.click();
            assert.equal((await snapshot()).activations, 1);
            const before = (await snapshot()).writes.length;
            await page
                .getByRole('button', { name: 'Toggle readonly', exact: true })
                .click();
            assert.equal(await page.getByRole('combobox').count(), 0);
            assert.equal((await snapshot()).writes.length, before);
            assert.equal(
                await page
                    .getByRole('textbox', {
                        name: 'Adjacent sentinel',
                        exact: true,
                    })
                    .inputValue(),
                'untouched'
            );
            await page
                .getByRole('button', { name: 'Explicit Save', exact: true })
                .click();
            assert.equal((await snapshot()).submits, 1);
            await page.screenshot({
                path: join(output, 'controlled-select-' + format + '.png'),
                fullPage: true,
            });
            evidence.results.push({ format, ...(await snapshot()) });
            await context.close();
            context = null;
        }
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.scope =
            'Installed controlled ESM/CJS Select UI; canonical echo, deferred metadata order, caps/radios, readonly grid events, sentinel and explicit submit. No native Form/provider claim.';
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page) {
            try {
                evidence.failureState = await page.evaluate(() =>
                    window.selectProof?.snapshot()
                );
                await page.screenshot({
                    path: join(output, 'controlled-select-failure.png'),
                    fullPage: true,
                });
            } catch {}
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
                await bounded(cleanup);
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                evidence.cleanup[name] = { error: error.message };
                evidence.status = 'failed';
                failure ??= error;
            }
        }
        writeFileSync(
            join(output, 'controlled-select.json'),
            JSON.stringify(evidence, null, 2) + '\n'
        );
    }
    if (failure) throw failure;
}
