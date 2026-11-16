import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

export const csvExportTypedConsumer = String.raw`
import {createElement} from 'react';
import {createCSVExportController,projectCSVExport,serializeCSVExportDocument,type CSVExportInput,type CSVExportDocument} from '@miniextensions/sdk/portals';
import {CSVExportButton,type CSVExportLabels} from '@miniextensions/sdk/react';
const input:CSVExportInput={admission:{cohort:'portal-grid',allowed:true,borrowedRecords:false},columns:[{key:'Name',title:'Name'}],rows:[{status:'loaded',viewType:'list',fields:[{field:{id:'name',name:'Name',config:{type:'singleLineText'}},value:'Owned synthetic value'}]}]};
const labels:CSVExportLabels={download:'Download',warning:'Displayed records only',continue:'Continue',cancel:'Cancel',help:'Help',pending:'Preparing',errors:{denied:'Denied',failed:'Failed',loading:'Loading',schema:'Schema',unexpected:'Unexpected'}};
createElement(CSVExportButton,{request:{input,filename:'Exact filename'},labels});
const controller=createCSVExportController({readCurrent:()=>({input,filename:'Exact filename'})});void controller;
const projected=projectCSVExport(input);if(projected.status==='ready'){const document:CSVExportDocument=projected.document;const text:Promise<string>=serializeCSVExportDocument(document);void text;}
// @ts-expect-error synchronous formatting only
const asyncInput:CSVExportInput={...input,formatField:async()=>''};void asyncInput;
// @ts-expect-error admission is explicit, not an SDK client or fetch capability
const implicitInput:CSVExportInput={columns:[],rows:[]};void implicitInput;
// @ts-expect-error a native renderer/whole serializer cannot replace the complete SDK control
createElement(CSVExportButton,{request:{input,filename:'Exact'},labels,serializeNative:async()=>''});
`;

export const csvExportRuntimeConsumer = String.raw`
import assert from 'node:assert/strict';import{createRequire}from'node:module';import React,{createElement as h,act}from'react';import{renderToString}from'react-dom/server';
const require=createRequire(import.meta.url),format=process.argv[2];
assert.equal(typeof globalThis.document,'undefined');
const api=format==='esm'?await import('@miniextensions/sdk/portals'):require('@miniextensions/sdk/portals');
const ui=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
const labels={download:'Download',warning:'Current displayed records',continue:'Continue',cancel:'Cancel',help:'Help',pending:'Preparing',errors:{denied:'Denied',failed:'Failed',loading:'Loading',schema:'Schema',unexpected:'Unexpected'}};
const makeInput=(count,text='Original')=>({admission:{cohort:'portal-grid',allowed:true,borrowedRecords:false},columns:[{key:'__proto__',title:'=Header'}],rows:Array.from({length:count},()=>({status:'loaded',viewType:'list',fields:[{field:{id:'name',name:'__proto__',config:{type:'singleLineText'}},value:text}]}))});
const projected=api.projectCSVExport(makeInput(1,'-42'));assert.equal(projected.status,'ready');assert.equal(await api.serializeCSVExportDocument(projected.document),"'=Header\n'-42\n");
assert.equal(await api.serializeCSVExportDocument({columns:[{key:'number',title:'Number'}],rows:[[{readableValue:'-42',rawWasNumber:true}]]}),'Number\n-42\n');
let resources=0,resolveClick;const clicked=new Promise(resolve=>{resolveClick=resolve;});const texts=[],filenames=[],revoked=[];
const platform={createBlob(text){resources++;texts.push(text);return{};},createObjectURL(){return'blob:synthetic';},revokeObjectURL(url){revoked.push(url);},createAnchor(){let filename;return{setAttribute(key,value){if(key==='download')filename=value;},click(){filenames.push(filename);resolveClick();}};}};
let props={request:{input:makeInput(100),filename:'Old filename',platform},labels};const element=()=>h(React.StrictMode,null,h(ui.CSVExportButton,props));
const markup=renderToString(element());assert(markup.includes('Download'));assert(!markup.includes('<dialog'));assert.equal(resources,0);
const {Window}=require(process.argv[3]);const window=new Window({settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableIframePageLoading:true}});
const globals={window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,HTMLDialogElement:window.HTMLDialogElement,IS_REACT_ACT_ENVIRONMENT:true};const originals=Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);for(const[key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
const errors=[],recoverable=[];const oldError=console.error;console.error=(...args)=>errors.push(args.map(String).join(' '));let root;
try{const container=window.document.createElement('div');window.document.body.append(container);container.innerHTML=markup;const{hydrateRoot}=await import('react-dom/client');await act(async()=>{root=hydrateRoot(container,element(),{onRecoverableError:error=>recoverable.push(error.name)});});const trigger=container.querySelector('button');assert.equal(trigger.type,'button');await act(async()=>trigger.click());const dialog=container.querySelector('dialog');assert(dialog.open);const cancel=[...dialog.querySelectorAll('button')].find(button=>button.textContent==='Cancel');assert.equal(window.document.activeElement,cancel);await act(async()=>cancel.click());assert.equal(resources,0);await act(async()=>trigger.click());props={...props,request:{...props.request,input:makeInput(1,'Current'),filename:'Current filename'}};await act(async()=>root.render(element()));const confirm=[...container.querySelectorAll('dialog button')].find(button=>button.textContent==='Continue');await act(async()=>{confirm.click();await clicked;});assert.deepEqual(texts,["'=Header\nCurrent\n"]);assert.deepEqual(filenames,['Current filename']);assert.deepEqual(revoked,['blob:synthetic']);assert.equal(container.querySelector('dialog'),null);assert.deepEqual(recoverable,[]);assert.deepEqual(errors,[]);}finally{if(root)await act(async()=>root.unmount());console.error=oldError;for(const[key,value]of originals){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}await window.happyDOM.close();}
console.log(JSON.stringify({format,react:React.version,hydrationErrors:recoverable.length,resources,cleanup:'completed'}));
`;

export function assertCSVBrowserInputs(metafile) {
    const inputs = Object.keys(metafile.inputs);
    assert(
        inputs.some((path) =>
            path
                .replaceAll('\\', '/')
                .endsWith('/csv-stringify/dist/esm/index.js')
        ),
        'Explicit asynchronous CSV browser entry was not selected'
    );
    assert(
        !inputs.some((path) =>
            path.replaceAll('\\', '/').endsWith('/csv-stringify/lib/index.js')
        ),
        'Node stream CSV entry entered the browser bundle'
    );
    for (const output of Object.values(metafile.outputs))
        for (const imported of output.imports)
            assert(
                !imported.external,
                'Unresolved external in CSV browser bundle'
            );
}

export function checkCSVExportReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-csv-export-'));
    const run = (command, args, options = {}) =>
        execFileSync(command, args, {
            cwd: directory,
            stdio: 'inherit',
            ...options,
        });
    const versions = [];
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                dependencies: {
                    '@miniextensions/sdk': 'file:' + resolve(archivePath),
                },
            })
        );
        writeFileSync(join(directory, 'runtime.mjs'), csvExportRuntimeConsumer);
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            run('npm', [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
                '--package-lock=false',
                'react@' + version.react,
                'react-dom@' + version.react,
                '@types/react@' + version.types,
                '@types/react-dom@' + version.domTypes,
            ]);
            for (const extension of ['mts', 'cts']) {
                const file = 'consumer.' + extension;
                writeFileSync(join(directory, file), csvExportTypedConsumer);
                run(process.execPath, [
                    typescriptBin,
                    '--noEmit',
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--target',
                    'ES2022',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    file,
                ]);
            }
            const formats = [];
            for (const format of ['esm', 'cjs'])
                formats.push(
                    JSON.parse(
                        run(
                            process.execPath,
                            ['runtime.mjs', format, happyDomModulePath],
                            {
                                encoding: 'utf8',
                                stdio: ['ignore', 'pipe', 'inherit'],
                            }
                        )
                    )
                );
            run(process.execPath, [
                '--input-type=module',
                '-e',
                String.raw`
import{createRequire}from'node:module';import assert from'node:assert/strict';const require=createRequire(import.meta.url),{buildSync}=require(process.argv[1]);
for(const format of ['esm','cjs']){const api=format==='esm'?"import{serializeCSVExportDocument}from'@miniextensions/sdk/portals';import{CSVExportButton}from'@miniextensions/sdk/react';console.log(serializeCSVExportDocument({columns:[],rows:[]}),CSVExportButton);":"const api=require('@miniextensions/sdk/portals');console.log(api.serializeCSVExportDocument({columns:[],rows:[]}),require('@miniextensions/sdk/react').CSVExportButton);";const result=buildSync({stdin:{contents:api,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,metafile:true,logLevel:'silent'});const inputs=Object.keys(result.metafile.inputs);assert(inputs.some(p=>p.endsWith('/csv-stringify/dist/esm/index.js')));assert(!inputs.some(p=>p.endsWith('/csv-stringify/lib/index.js')));for(const out of Object.values(result.metafile.outputs))assert(out.imports.every(p=>!p.external));}
`,
                esbuildModulePath,
            ]);
            const require = createRequire(join(directory, 'package.json'));
            assert(
                readFileSync(
                    require.resolve('@miniextensions/sdk/react/csv-export.css')
                ).length > 0
            );
            assert(
                formats.every(
                    (result) =>
                        result.react === version.react &&
                        result.hydrationErrors === 0 &&
                        result.resources === 1 &&
                        result.cleanup === 'completed'
                )
            );
            versions.push({ react: version.react, formats });
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

export const csvExportBrowserEntry = String.raw`
import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{CSVExportButton}from'@miniextensions/sdk/react';
const labels={download:'Download CSV',warning:'Only currently displayed records are included.',continue:'Continue',cancel:'Cancel',help:'Help',pending:'Preparing',errors:{denied:'Export denied',failed:'Rows failed',loading:'Rows loading',schema:'Schema changed',unexpected:'CSV creation failed'}};
const model={count:100,text:'Original',filename:'Original filename',borrowed:false,reloading:false,mounted:true,unmountAfterClick:false,clickFails:false};
const calls={texts:[],urls:[],revoked:[],filenames:[],errors:[],requests:0,submits:0};const originalCreate=URL.createObjectURL.bind(URL),originalRevoke=URL.revokeObjectURL.bind(URL),createElement=document.createElement.bind(document);
URL.createObjectURL=blob=>{const url=originalCreate(blob);calls.urls.push(url);blob.text().then(text=>calls.texts.push(text));return url;};URL.revokeObjectURL=url=>{calls.revoked.push(url);originalRevoke(url);};
document.createElement=function(name,...rest){const node=createElement(name,...rest);if(name==='a'){const click=node.click.bind(node);node.click=()=>{if(model.clickFails&&node.hasAttribute('download'))throw new TypeError('Synthetic click failure');click();};node.addEventListener('click',event=>{if(node.hasAttribute('download')){event.preventDefault();calls.filenames.push(node.getAttribute('download'));}});}return node;};
window.addEventListener('error',event=>calls.errors.push(event.message));window.addEventListener('unhandledrejection',()=>calls.errors.push('unhandledrejection'));window.fetch=async()=>{calls.requests++;throw new Error('Unexpected CSV fixture network');};XMLHttpRequest.prototype.open=function(){calls.requests++;throw new Error('Unexpected CSV fixture XHR');};
const mount=document.querySelector('main'),root=createRoot(mount);
function input(){return{admission:{cohort:'portal-grid',allowed:true,borrowedRecords:model.borrowed},columns:[{key:'__proto__',title:'=Header'}],rows:Array.from({length:model.count},()=>({status:'loaded',viewType:'list',isReloading:model.reloading,fields:[{field:{id:'name',name:'__proto__',config:{type:'singleLineText'}},value:model.text}]}))};}
function render(){root.render(React.createElement('form',{onSubmit:event=>{event.preventDefault();calls.submits++;},onClick:event=>{if(model.unmountAfterClick&&event.target.closest('.mx-sdk-csv-export__trigger')){model.mounted=false;flushSync(render);}}},React.createElement('label',null,'Adjacent draft',React.createElement('input',{defaultValue:'Keep adjacent draft'})),model.mounted?React.createElement(CSVExportButton,{request:{input:input(),filename:model.filename},labels}):null));}
flushSync(render);
window.__csvExportProbe={react:React.version,replace(patch){Object.assign(model,patch);flushSync(render);},snapshot(){return{model:{...model},calls:JSON.parse(JSON.stringify(calls)),storage:{local:localStorage.length,session:sessionStorage.length}};},unmount(){flushSync(()=>root.unmount());}};
window.__nativeProbe={snapshot(){return{...window.__csvExportProbe.snapshot(),errors:[...calls.errors]};}};
`;

export async function prepareCSVExportBrowserFixtures({
    temporary,
    archive,
    readArchiveMember = (member) =>
        execFileSync('tar', ['-xOf', archive, member]),
    installed,
    allowed,
    report,
    build,
    assertBrowserInputs,
    regular,
    hash,
}) {
    const entry = join(temporary, 'csv-export.mjs');
    writeFileSync(entry, csvExportBrowserEntry);
    const bundle = await build({
        absWorkingDir: temporary,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        outfile: join(temporary, 'csv-export.js'),
        write: false,
        metafile: true,
        legalComments: 'none',
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await assertBrowserInputs(bundle.metafile, temporary);
    assertCSVBrowserInputs(bundle.metafile);
    const inputs = Object.keys(bundle.metafile.inputs).map((name) => {
        const path = realpathSync(resolve(temporary, name)),
            bytes = regular(path),
            item = {
                path: relative(temporary, path),
                bytes: bytes.length,
                sha256: hash(bytes),
            };
        if (path.startsWith(installed + '/')) {
            const member =
                'package/' + relative(installed, path).replaceAll('\\', '/');
            assert.deepEqual(bytes, readArchiveMember(member));
            item.archiveMember = member;
        }
        return item;
    });
    const require = createRequire(join(temporary, 'package.json')),
        cssPath = realpathSync(
            require.resolve('@miniextensions/sdk/react/csv-export.css')
        ),
        css = regular(cssPath),
        member =
            'package/' + relative(installed, cssPath).replaceAll('\\', '/');
    assert(cssPath.startsWith(installed + '/'));
    assert.deepEqual(css, readArchiveMember(member));
    report.csvExport = {
        sourceSha256: hash(csvExportBrowserEntry),
        packagedCss: { member, sha256: hash(css) },
        bundleSha256: hash(bundle.outputFiles[0].contents),
        bundleInputs: inputs,
    };
    allowed.set('/csv-export.js', bundle.outputFiles[0].contents);
    allowed.set('/csv-export.css', css);
    allowed.set(
        '/csv-export-fixture.css',
        Buffer.from(
            'body{margin:2rem;font:16px/1.5 system-ui} main{max-width:50rem;margin:auto}.mx-sdk-csv-export{--theme-100:204 251 241;--theme-500:20 184 166}'
        )
    );
    allowed.set(
        '/csv-export.html',
        Buffer.from(
            `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'self';connect-src 'none';base-uri 'none';form-action 'none'"><link rel="stylesheet" href="/csv-export.css"><link rel="stylesheet" href="/csv-export-fixture.css"><title>CSV export</title></head><body><main></main><script type="module" src="/csv-export.js"></script></body></html>`
        )
    );
    return { path: '/csv-export.html' };
}

export async function checkCSVExportBrowser({ page, evidence }) {
    await page.waitForFunction(() => Boolean(window.__csvExportProbe));
    const state = () => page.evaluate(() => window.__csvExportProbe.snapshot()),
        replace = (patch) =>
            page.evaluate(
                (patch) => window.__csvExportProbe.replace(patch),
                patch
            ),
        groups = [];
    const verify = async (name) => {
        const snapshot = await state();
        assert.deepEqual(snapshot.calls.errors, []);
        assert.equal(snapshot.calls.requests, 0);
        assert.equal(snapshot.calls.submits, 0);
        assert.deepEqual(snapshot.storage, { local: 0, session: 0 });
        assert.deepEqual(snapshot.calls.revoked, snapshot.calls.urls);
        assert.equal(
            await page
                .getByRole('textbox', { name: 'Adjacent draft' })
                .inputValue(),
            'Preserve this local draft'
        );
        groups.push(name);
    };
    const trigger = () =>
        page.getByRole('button', { name: 'Download CSV', exact: true });
    await page
        .getByRole('textbox', { name: 'Adjacent draft' })
        .fill('Preserve this local draft');
    await trigger().focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Download CSV' }).waitFor();
    assert(
        await page
            .getByRole('button', { name: 'Cancel', exact: true })
            .evaluate((node) => node === document.activeElement)
    );
    const help = page.getByRole('link', { name: 'Help', exact: true });
    assert.equal(await help.getAttribute('rel'), 'noopener noreferrer');
    await page.keyboard.press('Tab');
    assert(
        await page
            .getByRole('button', { name: 'Continue', exact: true })
            .evaluate((node) => node === document.activeElement)
    );
    await page.keyboard.press('Shift+Tab');
    assert(
        await page
            .getByRole('button', { name: 'Cancel', exact: true })
            .evaluate((node) => node === document.activeElement)
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert(await trigger().evaluate((node) => node === document.activeElement));
    assert.equal((await state()).calls.urls.length, 0);
    await verify(
        'trusted-keyboard-open-cancel-tab-shift-tab-escape-restored-focus-no-allocation'
    );
    await trigger().click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await state()).calls.urls.length, 0);
    await verify('pointer-cancel-no-allocation');
    await trigger().click();
    await replace({ count: 1, text: 'Current', filename: 'Current filename' });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(
        () => window.__csvExportProbe.snapshot().calls.texts.length === 1
    );
    assert.equal((await state()).calls.texts[0], "'=Header\nCurrent\n");
    assert.deepEqual((await state()).calls.filenames, ['Current filename']);
    await verify(
        'current-confirmation-data-exact-neutralization-and-lazy-url-cleanup'
    );
    await replace({ reloading: true });
    await trigger().click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('alert').textContent(), 'Rows loading');
    assert.equal((await state()).calls.urls.length, 1);
    await verify('reload-preflight-no-url');
    await replace({ reloading: false, count: 0 });
    await trigger().click();
    assert.equal((await state()).calls.urls.length, 1);
    await verify('zero-row-no-op');
    await replace({ count: 99, text: 'Ninety nine' });
    await trigger().click();
    await page.waitForFunction(
        () => window.__csvExportProbe.snapshot().calls.texts.length === 2
    );
    assert.equal((await state()).calls.texts[1].split('\n').length, 101);
    await verify('ninety-nine-row-direct-attempt');
    await replace({ borrowed: true });
    assert.equal(await trigger().count(), 0);
    await verify('borrowed-grid-default-denial');
    await replace({ borrowed: false, count: 1, text: 'Explicit repeat' });
    await trigger().dblclick();
    await page.waitForFunction(
        () => window.__csvExportProbe.snapshot().calls.texts.length === 4
    );
    await verify('separate-explicit-attempts-without-singleflight');
    await replace({
        unmountAfterClick: true,
        text: 'Captured at allocation',
        filename: 'Captured filename',
    });
    await trigger().click();
    await page.waitForFunction(
        () => window.__csvExportProbe.snapshot().calls.texts.length === 5
    );
    assert.equal((await state()).calls.filenames.at(-1), 'Captured filename');
    assert.equal(
        (await state()).calls.texts.at(-1),
        "'=Header\nCaptured at allocation\n"
    );
    assert.equal(await trigger().count(), 0);
    await verify('allocated-attempt-completes-through-unmount');
    await replace({
        mounted: true,
        unmountAfterClick: false,
        clickFails: true,
    });
    await trigger().click();
    await page.getByRole('alert').waitFor();
    assert.equal(
        await page.getByRole('alert').textContent(),
        'CSV creation failed'
    );
    await page.waitForFunction(
        () =>
            window.__csvExportProbe.snapshot().calls.urls.length === 6 &&
            window.__csvExportProbe.snapshot().calls.revoked.length === 6
    );
    await verify('click-failure-exact-url-revocation-no-automatic-retry');
    const viewport = page.viewportSize();
    await replace({ count: 100, clickFails: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await trigger().click();
    const box = await page.getByRole('dialog').boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 390);
    assert(
        await page
            .getByRole('button', { name: 'Cancel', exact: true })
            .evaluate((node) => node === document.activeElement)
    );
    await page.keyboard.press('Escape');
    if (viewport) await page.setViewportSize(viewport);
    await verify('narrow-dialog-geometry-and-focus');
    const before = await state();
    await page.evaluate(() => window.__csvExportProbe.unmount());
    evidence.result = {
        groups,
        react: await page.evaluate(() => window.__csvExportProbe.react),
        urlCount: before.calls.urls.length,
        revokedCount: before.calls.revoked.length,
        networkRequests: before.calls.requests,
        cleanup: 'completed',
    };
    return evidence.result;
}
