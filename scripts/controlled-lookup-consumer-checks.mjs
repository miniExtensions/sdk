import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const controlledLookupTypedConsumer = String.raw`
import {createElement} from 'react';
import {LookupField,type ControlledLookupFieldProps,type LookupResultPresentation,type LookupReadonlyLinkedCollection} from '@miniextensions/sdk/react';
import {projectLookupValues,type LookupValueProjection} from '@miniextensions/sdk/ui';
const owner={token:{},isCurrent:()=>true};
const result:LookupResultPresentation={kind:'sequence',leaves:[{key:'zero',result:{kind:'literal',text:'0'}},{key:'rich',result:{kind:'richText',display:{value:'**Readonly**',emptyLabel:'Empty',language:'en'}}}]};
const props:ControlledLookupFieldProps={mode:'controlled',owner,identity:owner.token,state:{status:'ready',result}};
createElement(LookupField,props);
const grid:LookupReadonlyLinkedCollection={layout:'table',phase:'ready',columns:[{key:'value',title:'Value'}],rows:[{key:'row',cells:[{key:'value',result}],open:{label:'Open',run(trigger){const actual:HTMLElement=trigger;void actual;}}}],labels:{empty:'Empty',loading:'Loading',unavailable:'Unavailable'}};
createElement(LookupField,{...props,state:{status:'ready',result:{kind:'linkedCollection',display:grid}}});
const projection:LookupValueProjection=projectLookupValues({field:null,value:[]});void projection;
// @ts-expect-error Lookup accepts no host writer
createElement(LookupField,{...props,onValueChange(){}});
// @ts-expect-error No native renderer slot or child-controller clone
createElement(LookupField,{...props,render(){return null;}});
// @ts-expect-error A controlled projection cannot fabricate a field binding
createElement(LookupField,{...props,binding:{}});
// @ts-expect-error Readonly Select facts have no mutation port
const writable:LookupResultPresentation={kind:'singleSelect',display:{value:'A',choices:[],availableChoices:[],presentation:'dropdown',onValueChange(){}}};void writable;
// @ts-expect-error Complete readonly Rich Text exposes no editor handle/ref
const editor:LookupResultPresentation={kind:'richText',display:{value:'A',emptyLabel:'Empty',language:'en',ref(){}}};void editor;
// @ts-expect-error Readonly Checkbox facts expose no mutation callback
const checkbox:LookupResultPresentation={kind:'checkboxField',display:{value:true,isInGrid:true,onChange(){}}};void checkbox;
`;

/** One synthetic host reused by installed runtime and actual-browser checks. */
export const controlledLookupAssembly = String.raw`
const h=React.createElement;
let root,active={},owner={token:active,isCurrent(){return active===this.token;}},identity=0;
const effects={transport:0,rows:0,submits:0,opens:0,triggerId:null};
const dataImage='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="12" height="12"%3E%3Crect width="12" height="12" fill="red"/%3E%3C/svg%3E';
const metadata=config=>({id:'lookup',name:'Lookup',description:null,isComputed:true,isPrimaryField:false,config});
const numericBase={fieldId:'lookup',title:'Lookup',context:'form',computed:true,dirty:false,pending:false,validation:[],error:null,capability:{type:'readonly'}};
const numberConfig={type:'number',options:{precision:2}},currencyConfig={type:'currency',options:{precision:2,symbol:'€'}},percentConfig={type:'percent',options:{precision:0}};
const cohorts=[
 ['text',{kind:'text',display:{value:'Literal <b>text</b>',language:'en'}}],
 ['html',{kind:'html',html:'<strong>Rich HTML</strong><script>unexpected()</script><a href="https://never.example.invalid/">Link</a>'}],
 ['quill',{kind:'quill',html:'<p><em>Quill content</em></p>'}],
 ['checkbox',{kind:'checkbox',value:true,checkedLabel:'Checked',uncheckedLabel:'Unchecked'}],
 ['nativeCheckboxGrid',{kind:'checkboxField',display:{value:true,isInGrid:true}}],
 ['nativeCheckboxForm',{kind:'checkboxField',display:{value:true,isInGrid:false}}],
 ['rating',{kind:'rating',value:3,max:5,icon:'heart',color:'#e11d48',label:'3 of 5'}],
 ['nativeRating',{kind:'ratingField',display:{mode:'controlled',value:8,max:3,icon:'heart',color:'redBright',grid:false,title:'Rating'}}],
 ['phone',{kind:'phone',display:{value:'+1 202 555 0123',emptyLabel:'No phone'}}],
 ['duration',{kind:'duration',display:{value:3661,format:'h:mm:ss',language:'en'}}],
 ['barcode',{kind:'barcode',display:{value:{text:'ABC-123',type:'qr'},language:'en'}}],
 ['singleLine',{kind:'singleLine',display:{mode:'readOnly',value:'https://never.example.invalid/resource',language:'en',displayAsButton:true,validButtonLabel:'Open URL'}}],
 ['select',{kind:'multipleSelects',display:{value:['Urgent','Urgent'],choices:[{id:'urgent',name:'Urgent',color:'red'}],availableChoices:[{id:'urgent',name:'Urgent',color:'red'}],presentation:'dropdown'}}],
 ['people',{kind:'multipleCollaborators',display:{value:[{id:'ada',name:'Ada',email:'private@example.invalid'}],choices:[],avatarPolicy:{type:'none'}}}],
 ['formula',{kind:'formula',display:{mode:'controlled',language:'en',isValid:true,resultType:'singleLineText',value:'<b>Formula HTML</b>',formattedValue:'Formula HTML',renderFormulaAsHTML:true}}],
 ['rollup',{kind:'rollup',display:{mode:'controlled',language:'en',isValid:true,value:'Rollup result'}}],
 ['attachments',{kind:'attachmentCollection',display:{rows:[{key:'file',label:'Supplied attachment',openLabel:'Open attachment',imageSources:[dataImage],icon:'document'}],layout:'thumbnail',columns:2,fit:'contain',showNames:true,owner:{isCurrent:()=>owner.isCurrent()},labels:{attachments:'Attachments',retry:'Retry',imageUnavailable:'Unavailable'}}}],
 ['gallery',{kind:'urlGallery',display:{entries:[{id:'image',url:dataImage,type:'image/svg+xml',filename:'Supplied image'}],disableDownloadFiles:true}}],
 ['linkedTable',{kind:'linkedCollection',display:{layout:'table',phase:'ready',columns:[{key:'name',title:'Name'}],rows:[{key:'r0',cells:[{key:'name',result:{kind:'literal',text:'Linked row'}}],open:{label:'Open linked row',run(trigger){effects.opens++;effects.triggerId=trigger.id;}}}],labels:{empty:'Empty',loading:'Loading',unavailable:'Unavailable'}}}],
 ['linkedCard',{kind:'linkedCollection',display:{layout:'gallery',phase:'ready',rows:[{key:'card0',card:{status:'present',primary:'Rich card',fields:[{key:'detail',title:'Detail',leaf:{kind:'literal',text:'Card detail'}}],language:'en',layout:'gallery',images:[{id:'first',url:dataImage,filename:'First'},{id:'second',url:dataImage,filename:'Second'}],imageFit:'contain',imageHeight:80,shouldRenderThumbnail:true,thumbnailLocation:'left',fieldsPerCardRow:1,labels:{previousImage:'Previous image',nextImage:'Next image',noImage:'No image'}}}],labels:{empty:'Empty',loading:'Loading',unavailable:'Unavailable'}}}],
];
cohorts.push(
 ['number',{kind:'numeric',emptyLabel:'Empty',display:{...numericBase,physicalKind:'number',field:metadata(numberConfig),presentation:{type:'physical',config:numberConfig},value:1234.5,displayConfig:{showThousandsSeparator:true,numberSeparator:'space-comma'}}}],
 ['currency',{kind:'numeric',emptyLabel:'Empty',display:{...numericBase,physicalKind:'currency',field:metadata(currencyConfig),presentation:{type:'physical',config:currencyConfig},value:0,displayConfig:{numberSeparator:'comma-period'}}}],
 ['percent',{kind:'numeric',emptyLabel:'Empty',display:{...numericBase,physicalKind:'percent',field:metadata(percentConfig),presentation:{type:'physical',config:percentConfig},value:0.25,displayConfig:{showAsProgressBar:true}}}],
 ['date',{kind:'date',display:{value:'2026-11-16',language:'en',airtableDateConfig:{type:'date',options:{dateFormat:{name:'iso',format:'YYYY-MM-DD'}}}}}],
 ['dateTime',{kind:'dateTime',display:{value:'2026-11-16T12:30:00.000Z',language:'en',airtableDateConfig:{type:'dateTime',options:{dateFormat:{name:'iso',format:'YYYY-MM-DD'},timeFormat:{name:'24hour',format:'HH:mm'},timeZone:'utc'}}}}],
 ['singleSelect',{kind:'singleSelect',display:{value:'Single choice',choices:[{id:'single',name:'Single choice'}],availableChoices:[{id:'single',name:'Single choice'}],presentation:'dropdown'}}],
 ['singlePerson',{kind:'singleCollaborator',display:{value:{id:'grace',name:'Grace',email:'hidden@example.invalid'},choices:[],avatarPolicy:{type:'none'}}}],
 ['button',{kind:'button',accepted:{mode:'controlled',value:{label:'Captured button',url:'https://never.example.invalid/button'},owner:{isCurrent:()=>owner.isCurrent()}}}],
 ['urlButton',{kind:'urlButton',display:{href:'https://never.example.invalid/borrowed',buttonLabel:'Borrowed URL'}}],
 ['attachmentImages',{kind:'attachmentImages',images:[{id:'admitted',url:dataImage,filename:'Admitted image'}],empty:'no-values',emptyLabel:'Empty images'}],
 ['pills',{kind:'pills',items:[{label:'Pill A',backgroundColor:'#dbeafe'}]}],
 ['linkedPills',{kind:'linkedPills',labels:['Supplied linked label']}],
 ['suppliedPeople',{kind:'people',items:[{label:'Supplied Person',avatarSource:{src:dataImage,loading:'lazy'}}]}],
);
const galleryCard=cohorts.find(([name])=>name==='linkedCard')[1].display.rows[0].card;
cohorts.push(['linkedList',{kind:'linkedCollection',display:{layout:'list',phase:'ready',rows:[{key:'list0',card:{...galleryCard,primary:'List row',layout:'list'}}],labels:{empty:'Empty',loading:'Loading',unavailable:'Unavailable'}}}]);
function freezeFacts(value,seen=new Set()){if(value===null||typeof value!=='object'||seen.has(value))return;seen.add(value);for(const child of Object.values(value))freezeFacts(child,seen);Object.freeze(value);}
freezeFacts(cohorts);
const suppliedBytes=JSON.stringify(cohorts);
let state={status:'ready',result:{kind:'sequence',leaves:cohorts.map(([key,result])=>({key,result}))}};
function element(){return h(React.StrictMode,null,h('form',{id:'lookup-form',onSubmit(event){event.preventDefault();effects.submits++;}},h('button',{type:'button',id:'before'},'Before Lookup'),h('div',{onClick(){effects.rows++;},onKeyDown(){effects.rows++;}},h(api.LookupField,{mode:'controlled',owner,identity,state,title:'Computed Lookup',showTitle:true,inputId:'lookup',language:'en'})),h('button',{type:'button',id:'after'},'After Lookup')));}
function rerender(){root.render(element());}
function renew(next=state){active={};owner={token:active,isCurrent(){return active===this.token;}};identity++;state=next;rerender();}
function snapshot(){return {effects:{...effects},ownerCurrent:owner.isCurrent(),text:document.querySelector('#lookup')?.textContent??'',cohorts:cohorts.map(([name])=>name),suppliedUnchanged:JSON.stringify(cohorts)===suppliedBytes,react:React.version,platform:navigator.platform};}
function createExternalCaptureScenario(){
 const retiredListeners=new Set(),hostListeners=new Set();let current=true;
 const unavailableOwner={token:{},isCurrent:()=>false},admittedOwner={token:{},isCurrent:()=>current,subscribe(listener){retiredListeners.add(listener);return()=>retiredListeners.delete(listener);}};
 let externalOwner=unavailableOwner;
 const subscribeHost=listener=>{hostListeners.add(listener);return()=>hostListeners.delete(listener);};
 function ExternalHost(){const captured=React.useSyncExternalStore(subscribeHost,()=>externalOwner);return h(api.LookupField,{mode:'controlled',owner:captured,identity:captured.token,state:{status:'ready',result:{kind:'literal',text:'Subscribed installed capture'}}});}
 return {start(){root.render(h(React.StrictMode,null,h(ExternalHost)));},admit(){externalOwner=admittedOwner;for(const listener of [...hostListeners])listener();},retire(){current=false;externalOwner=unavailableOwner;for(const listener of [...retiredListeners])listener();for(const listener of [...hostListeners])listener();},recover(){externalOwner={token:{},isCurrent:()=>true};for(const listener of [...hostListeners])listener();},snapshot(){return {text:document.querySelector('main')?.textContent??'',retiredSubscriptions:retiredListeners.size,hostSubscriptions:hostListeners.size,oldCurrent:admittedOwner.isCurrent()};}};
}
`;

export const controlledLookupRuntimeConsumer =
    String.raw`
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {fileURLToPath,pathToFileURL} from 'node:url';import React from 'react';
const require=createRequire(import.meta.url),format=process.argv[2];
let api;
async function load(){api=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');}
` +
    controlledLookupAssembly +
    String.raw`
if(process.argv[4]==='--ssr'){
 assert.equal(typeof globalThis.window,'undefined');await load();const {renderToString}=await import('react-dom/server');const warnings=[],old=console.error;let html;
 try{console.error=(...args)=>warnings.push(args.map(String).join(' '));html=renderToString(element());}finally{console.error=old;}
 assert.match(html,/Rich HTML/);assert.match(html,/Literal &lt;b&gt;text&lt;\/b&gt;/);assert(!html.includes('<script'));assert.deepEqual(warnings,[]);console.log(JSON.stringify({html,react:React.version}));process.exit(0);
}
const ssr=JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),format,process.argv[3],'--ssr'],{encoding:'utf8',stdio:['ignore','pipe','inherit']}));
const {Window}=await import(pathToFileURL(process.argv[3]));let requests=0;
const window=new Window({url:'https://lookup.invalid/',settings:{fetch:{interceptor:{beforeAsyncRequest(){requests++;throw Error('Unexpected Lookup request');},beforeSyncRequest(){requests++;throw Error('Unexpected Lookup request');}}}}});
const keys=['window','document','navigator','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','MutationObserver','ResizeObserver','getComputedStyle','fetch','IS_REACT_ACT_ENVIRONMENT'];const saved=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
for(const key of keys){let value=key==='IS_REACT_ACT_ENVIRONMENT'?true:key==='fetch'?async()=>{requests++;effects.transport++;throw Error('Unexpected Lookup transport');}:window[key];if(key==='getComputedStyle')value=value.bind(window);Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});}
const host=document.createElement('main');document.body.append(host);host.innerHTML=ssr.html;const first=host.firstElementChild,errors=[],warnings=[],old=console.error;
try{
 console.error=(...args)=>warnings.push(args.map(String).join(' '));await load();const {hydrateRoot}=await import('react-dom/client');
 await React.act(async()=>{root=hydrateRoot(host,element(),{onRecoverableError:error=>errors.push(String(error))});});
 assert.equal(React.version,ssr.react);assert.equal(host.firstElementChild,first);assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);
 assert.equal(host.querySelectorAll('.mx-sdk-lookup-occurrence').length,cohorts.length);assert(host.querySelector('.mx-sdk-html strong'));assert(host.querySelector('.mx-sdk-quill em'));assert.equal(host.querySelector('script'),null);assert.equal(host.querySelector('input[type=checkbox]').disabled,true);assert.equal(host.querySelectorAll('.mx-sdk-select-badge').length,3);assert(!host.textContent.includes('private@example.invalid'));for(const text of ['1 234,50','€0.00','25%','2026-11-16','12:30','Single choice','Grace','Captured button','Borrowed URL','Pill A','Supplied linked label','Supplied Person','List row'])assert(host.textContent.includes(text),'Missing installed cohort: '+text);
 const open=Array.from(host.querySelectorAll('button')).find(node=>node.textContent==='Open linked row');assert(open);open.id='actual-open-trigger';await React.act(async()=>open.click());assert.equal(effects.opens,1);assert.equal(effects.triggerId,open.id);
 active=null;const anchor=host.querySelector('.mx-sdk-html a');for(const type of ['click','auxclick']){const event=new window.MouseEvent(type,{bubbles:true,cancelable:true});await React.act(async()=>anchor.dispatchEvent(event));assert.equal(event.defaultPrevented,true);}await React.act(async()=>open.click());assert.equal(effects.opens,1);
 await React.act(async()=>renew({status:'masked'}));assert.match(snapshot().text,/••••••••/);assert.equal(host.querySelector('img,audio,video,iframe'),null);
 await React.act(async()=>renew({status:'ready',result:{kind:'literal',text:'Successor'}}));assert.equal(snapshot().text,'Computed LookupSuccessor');
 await React.act(async()=>renew({status:'ready',result:{kind:'sequence',leaves:[{key:'same',result:{kind:'literal',text:'Private'}},{key:'same',result:{kind:'literal',text:'Private'}}]}}));assert.match(snapshot().text,/Unavailable/);assert(!snapshot().text.includes('Private'));
 const external=createExternalCaptureScenario();await React.act(async()=>external.start());
 await React.act(async()=>external.admit());assert.match(host.textContent,/Subscribed installed capture/);
 await React.act(async()=>external.retire());assert.match(host.textContent,/Unavailable/);assert(!host.textContent.includes('Subscribed installed capture'));assert.equal(external.snapshot().retiredSubscriptions,0);
 await React.act(async()=>external.recover());assert.match(host.textContent,/Subscribed installed capture/);assert.equal(external.snapshot().oldCurrent,false);
 assert.equal(snapshot().suppliedUnchanged,true);assert.equal(effects.transport,0);assert.equal(effects.rows,0);assert.equal(effects.submits,0);assert.equal(requests,0);assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);
 await React.act(async()=>root.unmount());root=undefined;assert.equal(host.childElementCount,0);assert.equal(external.snapshot().hostSubscriptions,0);console.log(JSON.stringify({format,react:React.version,cohorts:cohorts.length,externalStoreRetirement:true,ssr:true,hydration:true,errors:0,warnings:0,requests,effects,suppliedUnchanged:snapshot().suppliedUnchanged,cleanup:'completed'}));
}finally{try{if(root)await React.act(async()=>root.unmount());}finally{console.error=old;keys.forEach((key,index)=>saved[index]?Object.defineProperty(globalThis,key,saved[index]):Reflect.deleteProperty(globalThis,key));await window.happyDOM.close();}}
`;

export function checkControlledLookupReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    const archive = resolve(archivePath),
        archiveSha256 = sha(readFileSync(archive));
    const profiles = [];
    for (const version of ['18.3.1', '19.2.0']) {
        const directory = mkdtempSync(join(tmpdir(), 'sdk-controlled-lookup-'));
        const run = (command, args, options = {}) =>
            execFileSync(command, args, {
                cwd: directory,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'inherit'],
                timeout: 120000,
                ...options,
            });
        try {
            writeFileSync(
                join(directory, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    packageManager: 'pnpm@10.28.2',
                    dependencies: {
                        '@miniextensions/sdk': `file:${archive}`,
                        react: version,
                        'react-dom': version,
                        '@types/react':
                            version === '18.3.1' ? '18.3.12' : '19.2.2',
                        '@types/react-dom':
                            version === '18.3.1' ? '18.3.1' : '19.2.2',
                        '@types/node': '22.20.5',
                    },
                })
            );
            const policy = {
                nodeLinker: 'hoisted',
                minimumReleaseAge: 2880,
                minimumReleaseAgeExclude: [],
                blockExoticSubdeps: true,
                strictPeerDependencies: true,
                ignoreScripts: true,
            };
            const policyText =
                Object.entries(policy)
                    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
                    .join('\n') + '\n';
            writeFileSync(join(directory, 'pnpm-workspace.yaml'), policyText);
            const pnpm = (args) => run('corepack', ['pnpm', ...args]);
            assert.equal(pnpm(['--version']).trim(), '10.28.2');
            for (const [key, value] of Object.entries(policy))
                assert.deepEqual(
                    JSON.parse(pnpm(['config', 'get', key, '--json'])),
                    value
                );
            pnpm(['install', '--ignore-scripts', '--strict-peer-dependencies']);
            assert.equal(
                readFileSync(join(directory, 'pnpm-workspace.yaml'), 'utf8'),
                policyText
            );
            writeFileSync(
                join(directory, 'runtime.mjs'),
                controlledLookupRuntimeConsumer
            );
            for (const extension of ['mts', 'cts']) {
                const file = `lookup.${extension}`;
                writeFileSync(
                    join(directory, file),
                    controlledLookupTypedConsumer
                );
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
            writeFileSync(
                join(directory, 'lookup-bundler.ts'),
                controlledLookupTypedConsumer
            );
            run(process.execPath, [
                typescriptBin,
                '--noEmit',
                '--strict',
                '--skipLibCheck',
                'false',
                '--target',
                'ES2022',
                '--module',
                'ESNext',
                '--moduleResolution',
                'Bundler',
                'lookup-bundler.ts',
            ]);
            const require = createRequire(join(directory, 'package.json'));
            const css = readFileSync(
                require.resolve('@miniextensions/sdk/react/lookup.css')
            );
            assert.match(css.toString(), /\.mx-sdk-controlled-lookup/);
            assert(
                css.equals(
                    readFileSync(
                        join(
                            directory,
                            'node_modules/@miniextensions/sdk/dist/cjs/react/lookup.css'
                        )
                    )
                )
            );
            for (const format of ['esm', 'cjs']) {
                const result = JSON.parse(
                    run(process.execPath, [
                        'runtime.mjs',
                        format,
                        happyDomModulePath,
                    ])
                );
                assert.equal(result.react, version);
                assert.equal(result.cleanup, 'completed');
                assert.equal(result.errors, 0);
                assert.equal(result.suppliedUnchanged, true);
                const entry =
                    format === 'esm'
                        ? "import {LookupField} from '@miniextensions/sdk/react';import {projectLookupValues} from '@miniextensions/sdk/ui';import '@miniextensions/sdk/react/lookup.css';console.log(LookupField,projectLookupValues);"
                        : "const {LookupField}=require('@miniextensions/sdk/react');const {projectLookupValues}=require('@miniextensions/sdk/ui');require('@miniextensions/sdk/react/lookup.css');console.log(LookupField,projectLookupValues);";
                writeFileSync(join(directory, `browser-${format}.js`), entry);
                run(process.execPath, [
                    '--input-type=module',
                    '-e',
                    "import{createRequire}from'node:module';const require=createRequire(import.meta.url);const{buildSync}=require(process.argv[1]);const result=buildSync({entryPoints:[process.argv[2]],bundle:true,platform:'browser',format:'iife',outdir:'out',write:false,metafile:true,logLevel:'silent'});if(!result.outputFiles.some(file=>file.path.endsWith('.css')))throw Error('Missing Lookup stylesheet');",
                    esbuildModulePath,
                    `browser-${format}.js`,
                ]);
                profiles.push({
                    ...result,
                    archiveSha256,
                    cssSha256: sha(css),
                    types: ['NodeNext ESM', 'NodeNext CJS', 'Bundler'],
                    policy,
                });
            }
            assert.equal(sha(readFileSync(archive)), archiveSha256);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }
    return { profiles, cleanup: 'completed' };
}
