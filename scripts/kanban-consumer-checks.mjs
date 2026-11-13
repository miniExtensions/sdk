import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

export const kanbanTypedConsumer = String.raw`
import {createElement} from 'react';
import {Kanban,type KanbanProps,type KanbanCard} from '@miniextensions/sdk/react';
import {projectKanbanColumns,createKanbanCategoryOperation,type KanbanProjectionInput} from '@miniextensions/sdk/portals';
import '@miniextensions/sdk/react/kanban.css';
type RecordSnapshot={fields:{status:string|null};sibling:string};
const projection:KanbanProjectionInput={categoryFieldId:'status',fields:[{id:'status',config:{type:'singleSelect',options:{choices:[{id:'open',name:'Open'}]}}}],recordIds:[],readRecord:()=>undefined,uncategorizedLabel:'Uncategorized',hideEmptyColumns:false};
const props:KanbanProps<RecordSnapshot,{id:string}>={label:'Projects',projection,cards:[],readOnly:false,modalOpen:false,captureCategoryInvocation:()=>({originalRecord:{fields:{status:'Open'},sibling:'retained'},columns:projectKanbanColumns(projection),readCategory:record=>record.fields.status,publishOptimistic:value=>{void value;},mutate:async()=>({type:'no-login'}),publishLoggedIn:record=>{void record.id;},restore:record=>{void record.sibling;}})};
createElement(Kanban<RecordSnapshot,{id:string}>,props);
createKanbanCategoryOperation(props.captureCategoryInvocation);
// @ts-expect-error Whole native card rendering cannot replace SDK-owned UI.
createElement(Kanban<RecordSnapshot,{id:string}>,{...props,renderCard:()=>null});
// @ts-expect-error Named host category ports are mandatory.
createElement(Kanban<RecordSnapshot,{id:string}>,{label:'Incomplete',projection,cards:[],readOnly:false,modalOpen:false});
const card:KanbanCard={recordId:'synthetic',accessibleLabel:'Project',projection:{status:'loading',label:'Loading'}};
void card;
`;

const fixtureData = String.raw`
const fields=[{id:'status',config:{type:'singleSelect',options:{choices:[{id:'open',name:'Open'},{id:'closed',name:'Closed'},{id:'empty',name:'Empty'}]}}}];
function richFields(models,url,action){
 const config={type:'number',options:{precision:2}};
 const number={physicalKind:'number',presentation:{type:'physical',config},fieldId:'number',title:'Amount',field:{id:'number',name:'Amount',description:null,isComputed:false,isPrimaryField:false,config},displayConfig:null,value:-12.5,context:'linked-detail',computed:false,dirty:false,pending:false,validation:[],error:null,capability:{type:'readonly'}};
 return [
 {key:'text',title:'Text',leaf:{kind:'text',display:{value:'Literal text',language:'en'}}},
 {key:'html',title:'HTML',leaf:{kind:'html',html:'<p><strong>HTML content</strong><script>unexpected()</script></p>'}},
 {key:'quill',title:'Quill',leaf:{kind:'quill',html:'<p><strong>Quill content</strong></p>'}},
 {key:'markdown',title:'Markdown',leaf:{kind:'markdown',value:'# Markdown content',identity:'synthetic-markdown',emptyLabel:'No text'}},
 {key:'numeric',title:'Number',leaf:{kind:'numeric',display:{...number,capability:{type:'readonly'}},emptyLabel:'No number'}},
 {key:'date',title:'Date',leaf:{kind:'date',display:{airtableDateConfig:{type:'date',options:{dateFormat:{name:'iso',format:'YYYY-MM-DD'}}},value:'2026-11-13',language:'en'}}},
 {key:'datetime',title:'Date time',leaf:{kind:'dateTime',display:{airtableDateConfig:{type:'dateTime',options:{dateFormat:{name:'iso',format:'YYYY-MM-DD'},timeFormat:{name:'24hour',format:'HH:mm'},timeZone:'utc'}},value:'2026-11-13T12:00:00.000Z',language:'en'}}},
 {key:'phone',title:'Phone',leaf:{kind:'phone',display:{value:'+15550000001',emptyLabel:'No phone'}}},
 {key:'duration',title:'Duration',leaf:{kind:'duration',display:{value:3661,format:'h:mm:ss',language:'en'}}},
 {key:'checkbox',title:'Checkbox',leaf:{kind:'checkbox',value:true,checkedLabel:'Checked',uncheckedLabel:'Unchecked'}},
 {key:'barcode',title:'Barcode',leaf:{kind:'barcode',display:{value:{text:'Synthetic barcode',type:'code128'},language:'en'}}},
 {key:'button',title:'Action',leaf:{kind:'button',accepted:{mode:'controlled',value:{label:'Rich action',url:'/synthetic'},config:{openLinkType:'triggerWebhookPOST'},onTriggerWebhook:action}}},
 {key:'people',title:'People',leaf:{kind:'people',items:[{label:'Synthetic person',avatar:{id:'avatar',url:url('/kanban-image-1.svg'),filename:'avatar.svg'}}]}},
 {key:'attachments',title:'Attachments',leaf:{kind:'attachmentImages',images:[{id:'attachment',url:url('/kanban-image-2.svg'),filename:'Attachment.svg'}],empty:'none',emptyLabel:'No images'}},
 {key:'sequence',title:'Sequence',leaf:{kind:'sequence',leaves:[{kind:'pills',items:[{label:'Pill',color:'#111',backgroundColor:'#eee'}]},{kind:'linkedPills',labels:['Linked label']},{kind:'rating',value:2,max:3,icon:'star',color:'#6366f1',label:'Two of three'}]}}
 ];
}
function present(id,models,url,action,rich=false){
 return {status:'present',primary:id==='a'?'Alpha <b>literal</b>':'Project '+id,fields:rich?richFields(models,url,action):[{key:'detail',title:'Detail',leaf:{kind:'literal',text:'Admitted detail '+id}}],language:'en',layout:'kanban',images:id==='a'?[{id:'one',url:url('/kanban-image-1.svg'),filename:'Image one.svg'},{id:'two',url:url('/kanban-image-2.svg'),filename:'Image two.svg'}]:[],imageFit:'cover',imageHeight:100,shouldRenderThumbnail:id==='a',thumbnailLocation:'left',fieldsPerCardRow:1,labels:{previousImage:'Previous image',nextImage:'Next image',noImage:'No image'}};
}
`;

export const kanbanRuntimeConsumer =
    String.raw`
import assert from 'node:assert/strict';import{createRequire}from'node:module';import React,{createElement as h,act}from'react';import{renderToString}from'react-dom/server';
const require=createRequire(import.meta.url),format=process.argv[2];
assert.equal(typeof document,'undefined');
const ui=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
const models=format==='esm'?await import('@miniextensions/sdk/ui'):require('@miniextensions/sdk/ui');
` +
    fixtureData +
    String.raw`
let opens=0,unlinks=0,mutations=0;
const projection={categoryFieldId:'status',fields,recordIds:['a','b'],readRecord:id=>({fields:{status:id==='a'?'Open':'Closed'}}),uncategorizedLabel:'Uncategorized',hideEmptyColumns:false};
let props={label:'Project board',projection,readOnly:false,modalOpen:false,cards:['a','b'].map(id=>({recordId:id,accessibleLabel:'Project '+id,projection:present(id,models,path=>path,()=>{}),open:{label:'Open '+id,activate:()=>{opens++;}},unlink:{label:'Unlink '+id,description:'Unlink',disabled:false,pending:false,activate:()=>{unlinks++;}}})),captureCategoryInvocation:()=>{mutations++;throw Error('Unexpected category operation');}};
const element=()=>h(React.StrictMode,null,h(ui.Kanban,props));
const markup=renderToString(element());assert(markup.includes('Alpha &lt;b&gt;literal&lt;/b&gt;'));assert.equal(typeof document,'undefined');
const{Window}=require(process.argv[3]);const window=new Window({url:'http://localhost/',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableIframePageLoading:true}});
const values={window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,Element:window.Element,Node:window.Node,Document:window.Document,DocumentFragment:window.DocumentFragment,HTMLDivElement:window.HTMLDivElement,HTMLButtonElement:window.HTMLButtonElement,MutationObserver:window.MutationObserver,ResizeObserver:window.ResizeObserver,getComputedStyle:window.getComputedStyle.bind(window),requestAnimationFrame:window.requestAnimationFrame.bind(window),cancelAnimationFrame:window.cancelAnimationFrame.bind(window),IS_REACT_ACT_ENVIRONMENT:true};
const originals=Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);for(const[key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
const errors=[],recoverable=[];const oldError=console.error;console.error=(...args)=>errors.push(args.map(String).join(' '));let root;
try{
 const container=window.document.createElement('div');window.document.body.append(container);container.innerHTML=markup;const{hydrateRoot}=await import('react-dom/client');
 await act(async()=>{root=hydrateRoot(container,element(),{onRecoverableError:error=>recoverable.push(error.name)});});
 await act(async()=>{const deadline=Date.now()+5000;while(!container.querySelector('[data-kanban-ready="true"]')){if(Date.now()>deadline)assert.fail('Real Kanban sensor frame did not become ready');await new Promise(resolve=>setTimeout(resolve,5));}});
 const button=[...container.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')==='Open a');assert(button);assert.equal(button.type,'button');await act(async()=>button.click());assert.equal(opens,1);
 const unlink=[...container.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')==='Unlink a');assert(unlink);await act(async()=>unlink.click());assert.equal(unlinks,1);
 props={...props,cards:props.cards.map(card=>({...card,projection:{status:'unavailable',label:'Current unavailable'}}))};await act(async()=>root.render(element()));assert(container.textContent.includes('Current unavailable'));assert.equal(mutations,0);
 assert.deepEqual(recoverable,[]);assert.deepEqual(errors,[]);
}finally{if(root)await act(async()=>root.unmount());console.error=oldError;for(const[key,value]of originals){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}await window.happyDOM.close();}
console.log(JSON.stringify({format,react:React.version,hydrationErrors:recoverable.length,opens,unlinks,mutations,cleanup:'completed'}));
`;

export function checkKanbanReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-kanban-consumer-'));
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
        writeFileSync(join(directory, 'runtime.mjs'), kanbanRuntimeConsumer);
        run('npm', [
            'install',
            '--ignore-scripts',
            '--strict-peer-deps',
            '--no-audit',
            '--no-fund',
            '--package-lock=false',
        ]);
        for (const name of [
            'react',
            'react-dom',
            '@dnd-kit/core',
            '@dnd-kit/sortable',
            'use-state-with-deps',
        ])
            assert(
                !existsSync(join(directory, 'node_modules', name)),
                `Optional/private dependency installed for headless consumer: ${name}`
            );

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
                writeFileSync(join(directory, file), kanbanTypedConsumer);
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
            const formats = ['esm', 'cjs'].map((format) =>
                JSON.parse(
                    run(
                        process.execPath,
                        ['runtime.mjs', format, happyDomModulePath],
                        {
                            encoding: 'utf8',
                            stdio: ['ignore', 'pipe', 'inherit'],
                        }
                    ).trim()
                )
            );
            run(process.execPath, [
                '--input-type=module',
                '-e',
                "import{createRequire}from'node:module';import assert from'node:assert/strict';const require=createRequire(import.meta.url),{buildSync}=require(process.argv[1]);for(const format of ['esm','cjs']){const source=format==='esm'?\"import{Kanban}from'@miniextensions/sdk/react';console.log(Kanban);\":\"console.log(require('@miniextensions/sdk/react').Kanban);\";const result=buildSync({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,metafile:true,logLevel:'silent'});const inputs=Object.keys(result.metafile.inputs);assert(inputs.some(path=>path.endsWith('/kanban/runtime.js')));assert(inputs.some(path=>path.endsWith('/react/Kanban.js')));for(const output of Object.values(result.metafile.outputs))assert(output.imports.every(item=>!item.external));}",
                esbuildModulePath,
            ]);
            const require = createRequire(join(directory, 'package.json'));
            assert(
                readFileSync(
                    require.resolve('@miniextensions/sdk/react/kanban.css')
                ).length > 0
            );
            assert(
                formats.every(
                    (result) =>
                        result.react === version.react &&
                        result.hydrationErrors === 0 &&
                        result.opens === 1 &&
                        result.unlinks === 1 &&
                        result.mutations === 0 &&
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

function browserEntry(format) {
    const imports =
        format === 'esm'
            ? "import * as ui from '@miniextensions/sdk/react';import * as models from '@miniextensions/sdk/ui';import * as api from '@miniextensions/sdk/portals';"
            : "const ui=require('@miniextensions/sdk/react'),models=require('@miniextensions/sdk/ui'),api=require('@miniextensions/sdk/portals');";
    return (
        "import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import'@miniextensions/sdk/react/kanban.css';" +
        imports +
        fixtureData +
        String.raw`
const calls={events:[],opens:[],unlinks:[],rich:0,errors:[],requests:0,submits:0,keys:[],csp:[]};
document.addEventListener('securitypolicyviolation',event=>calls.csp.push({directive:event.effectiveDirective,blocked:event.blockedURI}));
const oldError=console.error;console.error=(...args)=>{calls.errors.push(args.map(String).join(' '));oldError(...args);};
window.addEventListener('error',event=>calls.errors.push(event.error?.message??event.message));
window.addEventListener('unhandledrejection',event=>calls.errors.push(String(event.reason)));
window.fetch=()=>{calls.requests++;throw Error('Unexpected Kanban fixture request');};
const model={readOnly:false,modalOpen:false,mounted:true,rich:false,pending:false,hideEmpty:false,revision:0,rows:['a','b','c','legacy']};
let records={a:{id:'a',fields:{status:'Open',sibling:'A'}},b:{id:'b',fields:{status:'Open',sibling:'B'}},c:{id:'c',fields:{status:'Closed',sibling:'C'}},legacy:{id:'legacy',fields:{status:'Old choice',sibling:'Legacy'}}};
let pending=[];let source;const makeSource=()=>({categoryFieldId:'status',fields,recordIds:[...model.rows],readRecord:id=>records[id],uncategorizedLabel:'Uncategorized',hideEmptyColumns:model.hideEmpty});
source=makeSource();const root=createRoot(document.querySelector('main'));
const capture=recordId=>{
 const originalRecord=records[recordId],capturedRevision=model.revision;const columns=api.projectKanbanColumns(source);
 return{originalRecord,columns,readCategory:record=>record.fields.status,
 publishOptimistic:value=>{calls.events.push({kind:'optimistic',recordId,value,revision:capturedRevision});records={...records,[recordId]:{...originalRecord,fields:{...originalRecord.fields,status:value}}};source=makeSource();render();},
 mutate:value=>{calls.events.push({kind:'mutate',recordId,value,revision:capturedRevision});return model.pending?new Promise((resolve,reject)=>pending.push({resolve,reject})):Promise.resolve({type:'no-login'});},
 publishLoggedIn:record=>calls.events.push({kind:'logged-in',revision:capturedRevision,identity:record.synthetic}),
 restore:record=>{calls.events.push({kind:'restore',recordId,revision:capturedRevision});records={...records,[recordId]:record};source=makeSource();render();}
 };
};
const url=path=>new URL(path,location.href).href;
function render(){
 const cards=model.rows.map(id=>({recordId:id,accessibleLabel:'Project '+id,projection:present(id,models,url,()=>{calls.rich++;},model.rich&&id==='a'),open:{label:'Open '+id,activate:()=>calls.opens.push(id)},unlink:{label:'Unlink '+id,description:'Remove link',disabled:false,pending:false,activate:()=>calls.unlinks.push(id)},needsReviewLabel:id==='a'?'Needs review':null}));
 flushSync(()=>root.render(React.createElement('form',{onSubmit:event=>{event.preventDefault();calls.submits++;}},
 React.createElement('label',null,'Adjacent draft',React.createElement('textarea',{'aria-label':'Adjacent draft',defaultValue:'Preserve'})),
 React.createElement(ui.ThemeBoundary,{theme:'teal'},model.mounted?React.createElement(ui.Kanban,{label:'Project board',projection:source,cards,captureCategoryInvocation:capture,readOnly:model.readOnly,modalOpen:model.modalOpen}):null))));
}
render();
window.__kanbanProbe={
 snapshot(){return{calls:JSON.parse(JSON.stringify(calls)),records:JSON.parse(JSON.stringify(records)),model:{...model},pending:pending.length,columns:api.projectKanbanColumns(source).map(({id,label})=>({id,label})),react:React.version,platform:navigator.platform,storage:{local:localStorage.length,session:sessionStorage.length}};},
 replace(patch){Object.assign(model,patch);if(patch.rows||patch.hideEmpty!==undefined){source=makeSource();}render();},
 reset(){records={a:{id:'a',fields:{status:'Open',sibling:'A'}},b:{id:'b',fields:{status:'Open',sibling:'B'}},c:{id:'c',fields:{status:'Closed',sibling:'C'}},legacy:{id:'legacy',fields:{status:'Old choice',sibling:'Legacy'}}};Object.assign(model,{readOnly:false,modalOpen:false,mounted:true,rich:false,pending:false,hideEmpty:false,rows:['a','b','c','legacy']});source=makeSource();render();},
 settle(outcome){const target=pending.shift();if(!target)throw Error('No pending mutation');if(outcome==='reject')target.reject(Error('Synthetic mutation failure'));else target.resolve(outcome==='logged-in'?{type:'logged-in',loggedInUserRecord:{synthetic:true}}:{type:'no-login'});},
 unmount(){model.mounted=false;render();}
};
window.__nativeProbe={snapshot(){return{errors:[...calls.errors],requests:calls.requests,submits:calls.submits};}};
`
    );
}

export async function prepareKanbanBrowserFixtures({
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
    report.kanban = { profiles: {}, results: [] };
    for (const format of ['esm', 'cjs']) {
        const nonce = randomBytes(18).toString('base64');
        const entry = join(temporary, 'kanban-' + format + '.mjs');
        writeFileSync(entry, browserEntry(format));
        const bundle = await build({
            absWorkingDir: temporary,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            target: 'es2022',
            outfile: join(temporary, 'kanban-' + format + '.js'),
            write: false,
            metafile: true,
            legalComments: 'none',
            define: {
                'process.env.NODE_ENV': '"production"',
                __webpack_nonce__: JSON.stringify(nonce),
            },
        });
        await assertBrowserInputs(bundle.metafile, temporary);
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
                    'package/' +
                    relative(installed, path).replaceAll('\\', '/');
                assert.deepEqual(bytes, readArchiveMember(member));
                item.archiveMember = member;
            }
            return item;
        });
        assert(inputs.some((item) => item.path.endsWith('/kanban/runtime.js')));
        const runtimeBundle = JSON.parse(
            readArchiveMember(
                'package/dist/' + format + '/react/kanban/runtime.bundle.json'
            )
        );
        assert(runtimeBundle.packages.includes('@dnd-kit/core'));
        assert.equal(
            runtimeBundle.provenance['@dnd-kit/core'].version,
            '6.1.0'
        );
        const runtimeInput = inputs.find((item) =>
            item.path.endsWith('/kanban/runtime.js')
        );
        assert.equal(runtimeInput.sha256, runtimeBundle.outputSha256);

        const outputs = [];
        for (const output of bundle.outputFiles) {
            const name = '/' + output.path.split('/').pop();
            allowed.set(name, output.contents);
            outputs.push({
                path: name,
                bytes: output.contents.length,
                sha256: hash(output.contents),
            });
        }
        report.kanban.profiles[format] = {
            styleNonce: nonce,
            sourceSha256: hash(browserEntry(format)),
            inputs,
            outputs,
        };
        allowed.set(
            '/kanban-' + format + '.html',
            Buffer.from(
                "<!doctype html><html><head><meta charset=utf-8><meta http-equiv=Content-Security-Policy content=\"default-src 'none';script-src 'self';style-src 'self' 'nonce-" +
                    nonce +
                    "';img-src 'self' data:;connect-src 'none';base-uri 'none';form-action 'none'\"><link rel=icon href=data:,><link rel=stylesheet href=/kanban-" +
                    format +
                    '.css><link rel=icon href=data:,><link rel=stylesheet href=/kanban-fixture.css><title>Kanban</title></head><body><main></main><script type=module src=/kanban-' +
                    format +
                    '.js></script></body></html>'
            )
        );
    }
    allowed.set(
        '/kanban-fixture.css',
        Buffer.from(
            'body{margin:20px;font:19px/1.7 Georgia,serif}main{max-width:1500px}textarea{display:block}'
        )
    );
    for (const [index, color] of [
        [1, '#14b8a6'],
        [2, '#6366f1'],
    ])
        allowed.set(
            '/kanban-image-' + index + '.svg',
            Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" fill="' +
                    color +
                    '"/></svg>'
            )
        );
    return { paths: ['/kanban-esm.html', '/kanban-cjs.html'] };
}

export async function checkKanbanBrowser({ page, origin, evidence }) {
    const output = evidence.results ?? (evidence.results = []);
    for (const format of ['esm', 'cjs']) {
        const result = { format, groups: [] };
        output.push(result);
        await page.goto(origin + '/kanban-' + format + '.html');
        await page.waitForFunction(() => Boolean(window.__kanbanProbe));
        await page
            .locator('section [data-kanban-ready="true"]')
            .waitFor({ state: 'attached' });
        const state = () =>
            page.evaluate(() => window.__kanbanProbe.snapshot());
        const replace = async (patch) => {
            const mounted = await page.evaluate((patch) => {
                window.__kanbanProbe.replace(patch);
                return window.__kanbanProbe.snapshot().model.mounted;
            }, patch);
            if (mounted)
                await page
                    .locator('section [data-kanban-ready="true"]')
                    .waitFor({ state: 'attached' });
        };
        const reset = async () => {
            await page.evaluate(() => window.__kanbanProbe.reset());
            await page
                .locator('section [data-kanban-ready="true"]')
                .waitFor({ state: 'attached' });
        };
        const keyboardReady = (id) =>
            page.waitForFunction(
                (id) =>
                    [...document.querySelectorAll('[role="status"]')].some(
                        (node) =>
                            node.textContent?.includes(
                                'was moved over droppable area ' + id
                            )
                    ),
                id
            );
        const moveKey = async (key, target, label) => {
            await page.keyboard.press(key);
            if (label)
                await page.waitForFunction(
                    (label) =>
                        document
                            .querySelector('section [data-kanban-record="a"]')
                            ?.closest('.mx-sdk-kanban-column')
                            ?.querySelector('.mx-sdk-kanban-column-label')
                            ?.textContent === label,
                    label
                );
            else await keyboardReady(target);
        };
        const source = (id) =>
            page.locator(
                'section.mx-sdk-kanban [data-kanban-record="' + id + '"]'
            );
        const overlay = () => page.locator('.mx-sdk-kanban-item-overlay');
        const column = (label) =>
            page.locator('section.mx-sdk-kanban .mx-sdk-kanban-column').filter({
                has: page
                    .locator('.mx-sdk-kanban-column-label')
                    .filter({ hasText: new RegExp('^' + label + '$') }),
            });
        const order = (label) =>
            column(label)
                .locator('[data-kanban-record]')
                .evaluateAll((nodes) =>
                    nodes.map((node) => node.getAttribute('data-kanban-record'))
                );
        const verify = async (name) => {
            const snapshot = await state();
            assert.deepEqual(snapshot.calls.errors, []);
            assert.deepEqual(snapshot.calls.csp, []);
            assert.equal(snapshot.calls.requests, 0);
            assert.equal(snapshot.calls.submits, 0);
            assert.deepEqual(snapshot.storage, { local: 0, session: 0 });
            assert.equal(
                await page
                    .getByRole('textbox', { name: 'Adjacent draft' })
                    .inputValue(),
                'Preserved local draft'
            );
            result.groups.push(name);
        };
        const startMouse = async (id) => {
            await page
                .locator('section [data-kanban-ready="true"]')
                .waitFor({ state: 'attached' });
            await source(id).scrollIntoViewIfNeeded();
            const box = await source(id).boundingBox();
            assert(box);
            await page.mouse.move(box.x + 8, box.y + 12);
            await page.mouse.down();
            await page.mouse.move(box.x + 13, box.y + 17);
        };
        const moveMouse = async (label) => {
            const box = await column(label).boundingBox();
            assert(box);
            await page.mouse.move(box.x + 25, box.y + 80, { steps: 12 });
        };
        const dropMouse = async (id, label) => {
            await startMouse(id);
            await overlay().waitFor();
            await moveMouse(label);
            await page.mouse.up();
        };
        await page
            .getByRole('textbox', { name: 'Adjacent draft' })
            .fill('Preserved local draft');
        assert.deepEqual(
            await page
                .locator('section.mx-sdk-kanban .mx-sdk-kanban-column-label')
                .allTextContents(),
            ['Uncategorized', 'Open', 'Closed', 'Empty', 'Old choice']
        );
        assert(
            await source('a')
                .getByText('Alpha <b>literal</b>', { exact: true })
                .isVisible()
        );
        assert.equal(
            await source('a').locator('.mx-sdk-finder-card-primary b').count(),
            0
        );
        await verify('declared-stale-columns-and-escaped-real-rich-card');

        const arrow = source('a').getByRole('button', {
            name: 'Next image',
            exact: true,
        });
        assert.equal(
            await arrow.evaluate((node) => getComputedStyle(node).position),
            'absolute'
        );
        const arrowBox = await arrow.boundingBox();
        assert(arrowBox);
        assert(
            await arrow.evaluate((node) => {
                const r = node.getBoundingClientRect(),
                    hit = document.elementFromPoint(
                        r.x + r.width / 2,
                        r.y + r.height / 2
                    );
                return hit === node || node.contains(hit);
            })
        );
        await arrow.click();
        await page.waitForFunction(() => {
            const track = document.querySelector(
                'section [data-kanban-record="a"] .mx-sdk-finder-carousel-track'
            );
            return track?.style.transform.includes('-100%');
        });
        assert.equal((await state()).calls.opens.length, 0);
        assert.equal((await state()).calls.events.length, 0);
        const previous = source('a').getByRole('button', {
            name: 'Previous image',
            exact: true,
        });
        await previous.focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(
            () =>
                document
                    .querySelector(
                        'section [data-kanban-record="a"] .mx-sdk-finder-carousel-track'
                    )
                    ?.querySelector('[data-visible="true"]')
                    ?.getAttribute('alt') === 'Image one.svg'
        );
        await arrow.focus();
        await page.keyboard.press('Space');
        await page.waitForFunction(() =>
            document
                .querySelector(
                    'section [data-kanban-record="a"] .mx-sdk-finder-carousel-track'
                )
                ?.style.transform.includes('-100%')
        );
        await source('a')
            .getByRole('button', { name: 'Open a', exact: true })
            .focus();
        await page.keyboard.press('Enter');
        await source('a')
            .getByRole('button', { name: 'Unlink a', exact: true })
            .focus();
        await page.keyboard.press('Space');
        assert.deepEqual((await state()).calls.opens, ['a']);
        assert.deepEqual((await state()).calls.unlinks, ['a']);
        assert.equal((await state()).calls.events.length, 0);
        await verify(
            'absolute-carousel-hit-test-and-trusted-nested-actions-no-drag'
        );

        await replace({ rich: true });
        await source('a')
            .getByText('Markdown content', { exact: true })
            .waitFor();
        for (const text of [
            'Literal text',
            'HTML content',
            'Quill content',
            'Synthetic person',
            'Linked label',
        ])
            assert(
                await source('a').getByText(text, { exact: true }).isVisible()
            );
        assert.equal(await source('a').locator('script').count(), 0);
        const leaf = (title) =>
            source('a')
                .locator('.mx-sdk-finder-card-field')
                .filter({
                    has: page
                        .locator('.mx-sdk-finder-card-field-title')
                        .filter({ hasText: new RegExp('^' + title + '$') }),
                })
                .locator('.mx-sdk-finder-card-field-value');
        assert.match(await leaf('Number').innerText(), /-12[.,]50?/);
        assert.match(await leaf('Date').innerText(), /2026/);
        assert.match(await leaf('Date time').innerText(), /12:00/);
        assert.match(await leaf('Phone').innerText(), /555/);
        assert.match(await leaf('Duration').innerText(), /1:01:01/);
        assert(await leaf('Checkbox').getByRole('checkbox').isChecked());
        assert.match(await leaf('Barcode').innerText(), /Synthetic barcode/);
        assert.equal(
            await leaf('Sequence')
                .getByRole('img', { name: 'Two of three' })
                .locator('svg')
                .count(),
            3
        );
        assert.equal(
            await leaf('Attachments')
                .getByRole('img', { name: 'Attachment.svg' })
                .count(),
            1
        );
        assert.equal(await leaf('People').locator('img').count(), 1);
        assert.equal(
            await leaf('People')
                .locator('.mx-sdk-collaborator-badges')
                .evaluate((node) => getComputedStyle(node).display),
            'flex'
        );
        assert.equal(
            await leaf('People')
                .locator('img')
                .evaluate((node) => getComputedStyle(node).borderRadius),
            '50%'
        );

        const action = source('a').getByRole('button', {
            name: 'Rich action',
            exact: true,
        });
        await action.focus();
        await page.keyboard.press('Enter');
        assert.equal((await state()).calls.rich, 1);
        assert.equal((await state()).calls.events.length, 0);
        assert.equal((await state()).calls.opens.length, 1);
        await verify(
            'actual-rich-leaf-family-and-guarded-button-no-provider-or-category-write'
        );
        await replace({ rich: false });
        await page.evaluate(() => scrollTo(0, 0));

        const before = (await state()).calls.events.length;
        await page.evaluate(() => (document.body.style.cursor = 'crosshair'));
        await startMouse('a');
        await overlay().waitFor();
        const typography = await page.evaluate(() => {
            const original = document.querySelector(
                    'section [data-kanban-record="a"]'
                ),
                ghost = document.querySelector('.mx-sdk-kanban-item-overlay');
            const a = getComputedStyle(original),
                b = getComputedStyle(ghost);
            return {
                source: [
                    a.fontFamily,
                    a.fontSize,
                    a.lineHeight,
                    a.color,
                    a.getPropertyValue('--theme-500'),
                ],
                overlay: [
                    b.fontFamily,
                    b.fontSize,
                    b.lineHeight,
                    b.color,
                    b.getPropertyValue('--theme-500'),
                ],
                cursor: document.body.style.cursor,
            };
        });
        assert.deepEqual(typography.overlay, typography.source);
        assert.equal(typography.cursor, 'grabbing');
        await moveMouse('Closed');
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await overlay().waitFor({ state: 'detached' });
        assert.deepEqual(await order('Open'), ['a', 'b']);
        assert.equal((await state()).calls.events.length, before);
        assert.equal(
            await page.evaluate(() => document.body.style.cursor),
            'crosshair'
        );
        await verify(
            'native-cross-column-preview-escape-cancel-overlay-theme-and-cursor'
        );

        await dropMouse('a', 'Closed');
        await page.waitForFunction(
            () =>
                window.__kanbanProbe.snapshot().records.a.fields.status ===
                'Closed'
        );
        let snapshot = await state();
        assert.deepEqual(
            snapshot.calls.events.slice(-2).map((event) => event.kind),
            ['optimistic', 'mutate']
        );
        assert.equal(snapshot.calls.events.at(-1).value, 'Closed');
        assert.equal(snapshot.records.a.fields.sibling, 'A');
        await verify(
            'trusted-mouse-cross-column-immediate-native-category-operation'
        );

        await reset();
        const eventCount = (await state()).calls.events.length;
        await source('a').focus();
        await page.keyboard.press('Space');
        await overlay().waitFor();
        await keyboardReady('a');
        await moveKey('ArrowDown', 'b');
        await page.keyboard.press('Space');
        await overlay().waitFor({ state: 'detached' });
        assert.deepEqual(await order('Open'), ['b', 'a']);
        assert.equal((await state()).calls.events.length, eventCount);
        await replace({ rows: ['a', 'b', 'c', 'legacy'] });
        assert.deepEqual(await order('Open'), ['a', 'b']);
        await verify(
            'trusted-keyboard-same-category-local-order-no-transport-and-source-reset'
        );

        await source('a').focus();
        await page.keyboard.press('Space');
        await overlay().waitFor();
        await keyboardReady('a');
        await moveKey('ArrowRight', 'c', 'Closed');
        await page.keyboard.press('Space');
        await page.waitForFunction(
            () =>
                window.__kanbanProbe.snapshot().records.a.fields.status ===
                'Closed'
        );
        await verify('trusted-keyboard-populated-column-drop');

        await reset();
        await source('a').focus();
        await page.keyboard.press('Space');
        await overlay().waitFor();
        await keyboardReady('a');
        await moveKey('ArrowRight', 'c', 'Closed');
        await moveKey(
            'ArrowRight',
            (await state()).columns.find((column) => column.label === 'Empty')
                .id,
            'Empty'
        );
        await page.keyboard.press('Space');
        await page.waitForFunction(
            () =>
                window.__kanbanProbe.snapshot().records.a.fields.status ===
                'Empty'
        );
        await verify('trusted-keyboard-empty-column-geometry');

        await reset();
        await source('a').focus();
        await page.keyboard.press('Space');
        await overlay().waitFor();
        await keyboardReady('a');
        await moveKey(
            'ArrowLeft',
            (await state()).columns.find(
                (column) => column.label === 'Uncategorized'
            ).id,
            'Uncategorized'
        );
        await page.keyboard.press('Space');
        await page.waitForFunction(
            () =>
                window.__kanbanProbe.snapshot().records.a.fields.status === null
        );
        assert.equal((await state()).calls.events.at(-1).value, null);
        await verify('trusted-keyboard-uncategorized-id-to-null-value');

        await reset();
        await source('a').focus();
        await page.keyboard.press('Space');
        await overlay().waitFor();
        await keyboardReady('a');
        await moveKey('ArrowRight', 'c', 'Closed');
        await moveKey(
            'ArrowRight',
            (await state()).columns.find((column) => column.label === 'Empty')
                .id,
            'Empty'
        );
        await moveKey('ArrowRight', 'legacy', 'Old choice');
        assert(
            (await page
                .locator('.mx-sdk-kanban-board')
                .evaluate((node) => node.scrollLeft)) > 0
        );
        await page.keyboard.press('Space');
        await page.waitForFunction(
            () =>
                window.__kanbanProbe.snapshot().records.a.fields.status ===
                'Old choice'
        );
        await verify('trusted-keyboard-horizontal-scroll-to-stale-category');

        for (const flag of ['readOnly', 'modalOpen']) {
            await reset();
            await replace({ [flag]: true });
            const count = (await state()).calls.events.length;
            await startMouse('a');
            await moveMouse('Closed');
            await page.mouse.up();
            await source('a').focus();
            await page.keyboard.press('Space');
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('Space');
            assert.equal((await state()).calls.events.length, count);
            assert.equal((await state()).records.a.fields.status, 'Open');
            assert.equal(await overlay().count(), 0);
            await replace({ [flag]: false });
            await dropMouse('a', 'Closed');
            await page.waitForFunction(
                () =>
                    window.__kanbanProbe.snapshot().records.a.fields.status ===
                    'Closed'
            );
            await verify(
                'initial-' +
                    flag +
                    '-mouse-keyboard-no-write-and-independent-enabled-control'
            );
        }

        for (const flag of ['readOnly', 'modalOpen']) {
            await reset();
            const count = (await state()).calls.events.length;
            await startMouse('a');
            await overlay().waitFor();
            await moveMouse('Closed');
            await replace({ [flag]: true });
            await overlay().waitFor({ state: 'detached' });
            await page.mouse.up();
            assert.equal((await state()).calls.events.length, count);
            assert.equal((await state()).records.a.fields.status, 'Open');
            assert.deepEqual(await order('Open'), ['a', 'b']);
            await replace({ [flag]: false });
            await dropMouse('a', 'Closed');
            await page.waitForFunction(
                () =>
                    window.__kanbanProbe.snapshot().records.a.fields.status ===
                    'Closed'
            );
            await verify(
                'mid-drag-' +
                    flag +
                    '-retires-only-unallocated-presentation-and-reenables'
            );
        }
        await reset();
        const refreshCount = (await state()).calls.events.length;
        await startMouse('a');
        await overlay().waitFor();
        await moveMouse('Closed');
        await replace({ rows: ['b', 'a', 'c', 'legacy'] });
        await overlay().waitFor({ state: 'detached' });
        await page.keyboard.press('Escape');
        await page.mouse.up();
        assert.deepEqual(await order('Open'), ['b', 'a']);
        assert.equal((await state()).calls.events.length, refreshCount);
        await verify(
            'source-refresh-escape-cannot-restore-retired-local-clone'
        );

        await reset();
        const touchBefore = await page.evaluate(() => navigator.maxTouchPoints);
        const touch = await page.context().newCDPSession(page);
        let touchActive = false,
            touchError;
        const touchCleanup = {};
        try {
            await touch.send('Emulation.setTouchEmulationEnabled', {
                enabled: true,
                maxTouchPoints: 1,
            });
            await source('a').scrollIntoViewIfNeeded();
            const a = await source('a').boundingBox(),
                b = await column('Closed').boundingBox();
            assert(a && b);
            await page.evaluate(() => {
                window.__kanbanTouchTrusted = [];
                document.addEventListener(
                    'touchstart',
                    (event) =>
                        window.__kanbanTouchTrusted.push(event.isTrusted),
                    { once: true }
                );
            });
            await touch.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [{ x: a.x + 8, y: a.y + 12 }],
            });
            touchActive = true;
            await touch.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [{ x: a.x + 38, y: a.y + 42 }],
            });
            await overlay().waitFor();
            for (let step = 1; step <= 8; step++)
                await touch.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: [
                        {
                            x: a.x + 38 + ((b.x + 25 - a.x - 38) * step) / 8,
                            y: a.y + 42 + ((b.y + 80 - a.y - 42) * step) / 8,
                        },
                    ],
                });
            await touch.send('Input.dispatchTouchEvent', {
                type: 'touchEnd',
                touchPoints: [],
            });
            touchActive = false;
            await page.waitForFunction(
                () =>
                    window.__kanbanProbe.snapshot().records.a.fields.status ===
                    'Closed'
            );
            assert.deepEqual(
                await page.evaluate(() => window.__kanbanTouchTrusted),
                [true]
            );
        } catch (error) {
            touchError = error;
        } finally {
            const failures = [];
            for (const [name, cleanup] of [
                [
                    'input',
                    async () => {
                        if (touchActive)
                            await touch.send('Input.dispatchTouchEvent', {
                                type: 'touchCancel',
                                touchPoints: [],
                            });
                    },
                ],
                [
                    'emulation',
                    () =>
                        touch.send('Emulation.setTouchEmulationEnabled', {
                            enabled: touchBefore > 0,
                            maxTouchPoints: Math.max(1, touchBefore),
                        }),
                ],
                ['session', () => touch.detach()],
            ])
                try {
                    await cleanup();
                    touchCleanup[name] = 'completed';
                } catch (error) {
                    touchCleanup[name] = { error: error.message };
                    failures.push(error);
                }
            result.touchCleanup = touchCleanup;
            if (failures.length)
                throw new AggregateError(
                    [...(touchError ? [touchError] : []), ...failures],
                    'Kanban touch body/cleanup failed'
                );
            if (touchError) throw touchError;
        }
        assert.equal(
            await page.evaluate(() => navigator.maxTouchPoints),
            touchBefore
        );
        await verify(
            'trusted-emulated-touch-drop-and-owned-input-session-cleanup'
        );

        await reset();
        await replace({ pending: true });
        await dropMouse('a', 'Closed');
        await page.waitForFunction(
            () => window.__kanbanProbe.snapshot().pending === 1
        );
        await replace({ mounted: false, revision: 1 });
        await page.evaluate(() => window.__kanbanProbe.settle('reject'));
        await page.waitForFunction(
            () =>
                window.__kanbanProbe.snapshot().calls.events.at(-1)?.kind ===
                'restore'
        );
        snapshot = await state();
        assert.equal(snapshot.records.a.fields.status, 'Open');
        assert.equal(snapshot.calls.events.at(-1).revision, 0);
        assert.equal(await page.locator('section.mx-sdk-kanban').count(), 0);
        await verify(
            'allocated-native-continuation-restores-captured-record-after-unmount'
        );

        await reset();
        const countBeforeRemoval = (await state()).calls.events.length;
        await startMouse('a');
        await overlay().waitFor();
        await replace({ rows: ['b', 'c', 'legacy'] });
        await page.mouse.up();
        assert.equal((await state()).calls.events.length, countBeforeRemoval);
        await verify('accepted-source-removal-during-unallocated-drag');
        await reset();
        await startMouse('a');
        await overlay().waitFor();
        await replace({ mounted: false });
        await page.mouse.up();
        await overlay().waitFor({ state: 'detached' });
        assert.equal(
            await page.evaluate(() => document.body.style.cursor),
            'crosshair'
        );
        await verify('active-drag-unmount-full-owned-cleanup');

        result.react = (await state()).react;
        result.platform = (await state()).platform;
        assert.equal(result.groups.length, 19);
    }
    return evidence;
}
