import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const completeLinkedFinderTypedConsumer = String.raw`
import {createElement} from 'react';
import {CompleteLinkedFinderView, LinkedFinderAttachmentCollection, NativeLinkedFinderCascade, NativeLinkedFinderCascadeDriverView, type CompleteLinkedFinderViewProps, type LinkedFinderAttachmentCollectionProps, type NativeLinkedFinderCascadeProps} from '@miniextensions/sdk/react';
import {createCompleteLinkedFinderCoordinator, type CompleteLinkedFinderHost, type NativeLinkedFinderCascadeHost} from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/complete-linked-finder.css';
const owner={};
const host:CompleteLinkedFinderHost<{id:string},string,object>={captureOwner:()=>owner,isOwnerCurrent:value=>value===owner,subscribe:()=>()=>{},captureRead:()=>({mode:'public',isCurrent:()=>true,query:async()=>({records:[],offset:null}),publish:()=>({status:'admitted'}),didAccept:page=>{const exact:readonly {id:string}[]=page.records;void exact;}}),selection:()=>({ids:['hidden','A','A'],enabled:true,autoSelectScannedRecord:true}),recordId:row=>row.id,isOptionEnabled:()=>true,toggle:()=>({status:'admitted'}),close:()=>({status:'admitted'}),errorMessage:()=>''};
const coordinator=createCompleteLinkedFinderCoordinator(host,{testing:true});
const scheduled:void=coordinator.scheduleSearch({filter:'raw',resetOffset:false});
const receipt=coordinator.admitScheduledSearch(owner,{filter:'raw',resetOffset:false});
if(receipt.status==='admitted'){const nonce:object=receipt.nonce;const current:boolean=receipt.isCurrent();void nonce;void current;}
const identity:object|null=coordinator.getSnapshot().readIdentity;
// @ts-expect-error read identity is observed, not assigned by the consumer
coordinator.getSnapshot().readIdentity={};
void coordinator.toggle(owner,'A');
void coordinator.toggle(owner,'B',{closeAfterAddition:true});
const props:CompleteLinkedFinderViewProps<{id:string},string,object>={host,coordinator,queryOnMount:false,filter:'',queryKey:owner,searchTerm:'',onSearchTermChange(){},filterForSearch:value=>value,candidates:()=>[],optionTestId:'host-record-option',labels:{search:'Buscar',loading:'Cargando',noMatches:'Ninguno',unavailable:'No disponible',loadMore:'Más'}};
createElement(CompleteLinkedFinderView<{id:string},string,object>,props);
const collection:LinkedFinderAttachmentCollectionProps={rows:[{key:'occurrence',label:'A',openLabel:'Abrir',imageSources:[],icon:'document'}],layout:'grid',columns:2,fit:'contain',showNames:false,owner:{isCurrent:()=>true},labels:{attachments:'Adjuntos',retry:'Reintentar',imageUnavailable:'No disponible'},onOpen:()=>({status:'admitted'})};
createElement(LinkedFinderAttachmentCollection,collection);
const rawUrl=['raw',''] as const;
const cascadeHost:NativeLinkedFinderCascadeHost<object>={isCurrent:expected=>expected===owner,captureRead:expected=>({isCurrent:()=>expected===owner,query:async()=>({primaryValues:[{recordId:'A',stringValue:'Same label'},{recordId:'B',stringValue:'Same label'}],prefillValue:null})}),publish:()=>({status:'admitted'}),clear:()=>({status:'admitted'}),setPrefillLoading(){},reportOrdinaryError(){},errorMessage:()=>''};
const cascade:NativeLinkedFinderCascadeProps<object>={owner,host:cascadeHost,drivers:[{fieldId:'country',fieldName:'Country',title:null,urlSearchValue:rawUrl,hidden:false}],values:{country:{recordId:'B',stringValue:'Same label'}},formReadOnly:false,labels:{loading:'Cargando',noMatches:'Ninguno'}};
createElement(NativeLinkedFinderCascade<object>,cascade);
createElement(NativeLinkedFinderCascadeDriverView<object>,{owner,host:cascadeHost,driver:{fieldId:'state',fieldName:'State',title:null,urlSearchValue:rawUrl,hidden:true},previousFieldId:'omitted-driver',values:{'omitted-driver':{recordId:'B',stringValue:'Same label'}},labels:cascade.labels,formReadOnly:false});
// @ts-expect-error router values retain strings/arrays, never numeric normalization
createElement(NativeLinkedFinderCascade<object>,{...cascade,drivers:[{...cascade.drivers[0],urlSearchValue:1}]});
// @ts-expect-error no host-native selector renderer slot
createElement(NativeLinkedFinderCascade<object>,{...cascade,renderSelector:()=>null});
// @ts-expect-error no native rich-card renderer slot
createElement(CompleteLinkedFinderView<{id:string},string,object>,{...props,renderCard:()=>null});
// @ts-expect-error canonical IDs belong to the host, not the candidate model
coordinator.model.setValue(['B']);
// @ts-expect-error scheduling is void, not a query receipt
const page:Promise<unknown>=coordinator.scheduleSearch({filter:'',resetOffset:true});
void scheduled;void identity;void page;
coordinator.destroy();
`;

export const completeLinkedFinderRuntimeConsumer = String.raw`
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import React from 'react';
const require=createRequire(import.meta.url),format=process.argv[2];
assert.equal(typeof document,'undefined');
const ui=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
const models=format==='esm'?await import('@miniextensions/sdk/ui'):require('@miniextensions/sdk/ui');
const {renderToString}=await import('react-dom/server');
const css=readFileSync(require.resolve('@miniextensions/sdk/react/complete-linked-finder.css'),'utf8');
assert(css.includes('.mx-sdk-finder-attachment-collection'));assert(css.includes('.mx-sdk-finder-scroll'));
const {Window}=await import(pathToFileURL(process.argv[3]).href);
const profiles=[];
for(const strict of [false,true]){
 let owner={},search='',allocations=0,closes=0,opens=0,root;
 const canonical=['hidden','A','A'],listeners=new Set(),page={records:[{id:'A'},{id:'B'},{id:'A'}],offset:'next'};
 const notify=()=>{for(const listener of listeners)listener();};
 const host={captureOwner:()=>owner,isOwnerCurrent:expected=>expected===owner,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},captureRead:expected=>({mode:'public',isCurrent:()=>expected===owner,query:async()=>{allocations++;return page;},publish:()=>({status:'admitted'})}),selection:()=>({ids:canonical,enabled:true,autoSelectScannedRecord:true}),recordId:row=>row.id,isOptionEnabled:()=>true,toggle(expected,id){if(expected!==owner)return{status:'refused'};const next=canonical.includes(id)?canonical.filter(value=>value!==id):[...canonical,id];canonical.splice(0,canonical.length,...next);notify();return{status:'admitted'};},close:()=>{closes++;return{status:'admitted'};},errorMessage:()=>''};
 const coordinator=models.createCompleteLinkedFinderCoordinator(host,{testing:true});
 const result=await coordinator.queryNow({filter:'initial',resetOffset:true});assert.equal(result.page,page);assert.equal(result.status,'accepted');
 assert.equal(coordinator.getSnapshot().rawRecords,page.records);assert.equal(coordinator.model.getState().options.length,2);assert.deepEqual(canonical,['hidden','A','A']);
 const identity=coordinator.getSnapshot().readIdentity;assert(identity);assert(Object.isFrozen(identity));assert.deepEqual(Object.keys(identity),[]);
 const labels={search:'Buscar',loading:'Cargando',noMatches:'Ninguno',unavailable:'No disponible',loadMore:'Más'};
 const projection=id=>({status:'present',primary:id==='A'?'A <b>literal</b>':'B',fields:[],images:[],language:'en',layout:'list',imageFit:'cover',imageHeight:80,shouldRenderThumbnail:false,thumbnailLocation:'right',fieldsPerCardRow:1,labels:{previousImage:'Previous',nextImage:'Next',noImage:'None'}});
 const collectionOwner=owner;
 const collection={rows:[{key:'first',label:'A',openLabel:'Abrir primero',imageSources:[],icon:'document'},{key:'second',label:'A',openLabel:'Abrir segundo',imageSources:[],icon:'document'}],layout:'icon',columns:2,fit:'contain',showNames:true,owner:{isCurrent:()=>coordinator.getSnapshot().owner===collectionOwner},labels:{attachments:'Adjuntos',retry:'Reintentar',imageUnavailable:'No disponible'},onOpen:index=>{opens+=index+1;return{status:'admitted'};}};
 const element=()=>React.createElement(strict?React.StrictMode:React.Fragment,null,React.createElement(ui.CompleteLinkedFinderView,{host,coordinator,queryOnMount:false,queryKey:coordinator,filter:search,searchTerm:search,onSearchTermChange(value){search=value;root.render(element());},filterForSearch:value=>value,candidates:(_owner,ids)=>ids.map(id=>({id,projection:projection(id)})),optionTestId:'host-record-option',labels,closeAfterToggle:true}),React.createElement(ui.LinkedFinderAttachmentCollection,collection));
 const html=renderToString(element());assert(html.includes('A &lt;b&gt;literal&lt;/b&gt;'));assert(html.includes('aria-label="Buscar"'));assert.equal(allocations,1);
 let network=0;
 const window=new Window({url:'http://localhost/',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableIframePageLoading:true,fetch:{interceptor:{beforeAsyncRequest(){network++;throw Error('Unexpected network');},beforeSyncRequest(){network++;throw Error('Unexpected network');}}}}});
 const names=['window','document','navigator','Window','Document','DocumentFragment','EventTarget','Node','NodeFilter','Element','HTMLElement','SVGElement','ShadowRoot','Event','CustomEvent','MouseEvent','PointerEvent','KeyboardEvent','FocusEvent','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLAnchorElement','HTMLIFrameElement','HTMLButtonElement','HTMLFieldSetElement','HTMLLegendElement','HTMLFormElement','HTMLVideoElement','HTMLImageElement','MutationObserver','ResizeObserver','requestAnimationFrame','cancelAnimationFrame','getComputedStyle','IS_REACT_ACT_ENVIRONMENT','IntersectionObserver','fetch'];
 const observers=[];
 class Observer{constructor(callback,options){this.callback=callback;this.options=options;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}
 const originals=names.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of names)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:key==='Window'?Window:key==='IntersectionObserver'?Observer:key==='fetch'?async()=>{network++;throw Error('Unexpected network');}:['requestAnimationFrame','cancelAnimationFrame','getComputedStyle'].includes(key)?window[key].bind(window):window[key]});
 const container=window.document.createElement('main');container.innerHTML=html;window.document.body.append(container);
 const errors=[],recoverable=[],oldError=console.error;console.error=(...values)=>errors.push(values.map(String).join(' '));
 try{
  const {hydrateRoot}=await import('react-dom/client');
  await React.act(async()=>{root=hydrateRoot(container,element(),{onRecoverableError:error=>recoverable.push(error.message)});});
  assert.equal(container.querySelectorAll('[role="option"]').length,2);assert.equal(container.querySelectorAll('[data-testid="host-record-option"]').length,2);assert.equal(allocations,1);
  await React.act(async()=>container.querySelectorAll('[data-testid="host-record-option"]')[1].click());assert.deepEqual(canonical,['hidden','A','A','B']);assert.equal(closes,1);
  await React.act(async()=>container.querySelectorAll('[role="option"]')[0].click());assert.deepEqual(canonical,['hidden','B']);assert.equal(closes,1);
  await React.act(async()=>{const input=container.querySelector('input[type="search"]');Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'typed');input.dispatchEvent(new window.Event('input',{bubbles:true}));});assert.equal(search,'typed');
  await React.act(async()=>new Promise(resolve=>setTimeout(resolve,20)));assert.equal(allocations,2);
  const old=observers.at(-1);assert.equal(old.options.rootMargin,'400px');
  await React.act(async()=>{const pending=coordinator.queryNow({filter:'newer',resetOffset:true});old.callback([{isIntersecting:true}],{});await pending;});assert.equal(allocations,3);
  await React.act(async()=>container.querySelector('[aria-label="Abrir segundo"]').click());assert.equal(opens,2);assert.equal(closes,1);assert.deepEqual(canonical,['hidden','B']);
  const collectionButton=container.querySelector('[aria-label="Abrir segundo"]');
  const oldOwner=owner;await React.act(async()=>{owner={};notify();});assert.deepEqual(await coordinator.toggle(oldOwner,'B',{closeAfterAddition:true}),{status:'refused'});
  await React.act(async()=>collectionButton.click());assert.equal(opens,2);
  const rawUrl=['raw',''],cascadeQueries=[],driverValues={country:{recordId:'country-A',stringValue:'Same label'},state:null};
  const cascadeHost={isCurrent:expected=>expected===owner,captureRead(expected,query){return{isCurrent:()=>expected===owner,query:async()=>{cascadeQueries.push(query);return{primaryValues:[{recordId:'country-A',stringValue:'Same label'},{recordId:'country-B',stringValue:'Same label'}],prefillValue:{recordId:'country-A',stringValue:'Same label'}};}};},publish(expected,field,value){if(expected!==owner)return{status:'refused'};driverValues[field]=value;root.render(cascade());return{status:'admitted'};},clear(expected,field){if(expected!==owner)return{status:'refused'};driverValues[field]=null;root.render(cascade());return{status:'admitted'};},setPrefillLoading(){},reportOrdinaryError(error){throw error;},errorMessage:()=>''};
  let formReadOnly=false;
  const cascade=()=>React.createElement(strict?React.StrictMode:React.Fragment,null,React.createElement(ui.NativeLinkedFinderCascade,{owner,host:cascadeHost,drivers:[{fieldId:'country',fieldName:'Country',title:'Country',urlSearchValue:rawUrl,hidden:false},{fieldId:'state',fieldName:'State',title:'State',urlSearchValue:undefined,hidden:true}],values:driverValues,formReadOnly,labels:{loading:'Cargando',noMatches:'Ninguno'},testing:true}));
  await React.act(async()=>root.render(cascade()));await React.act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
  assert(cascadeQueries.some(query=>query.fieldId==='country'&&query.urlSearchValue===rawUrl));
  const countryInput=container.querySelector('[data-field-id="country"] input');assert(countryInput&&!countryInput.disabled);
  await React.act(async()=>countryInput.focus());await React.act(async()=>new Promise(resolve=>setTimeout(resolve,20)));assert.equal(countryInput.getAttribute('aria-expanded'),'true');
  const hiddenReads=cascadeQueries.filter(query=>query.fieldId==='state').length;assert(hiddenReads>0);
  const choices=container.querySelectorAll('[data-field-id="country"] [role="option"]');assert.equal(choices.length,2);
  await React.act(async()=>choices[1].click());await React.act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
  assert.deepEqual(driverValues.country,{recordId:'country-B',stringValue:'Same label'});assert.equal(cascadeQueries.filter(query=>query.fieldId==='state').length,hiddenReads);
  const cascadeReads=cascadeQueries.length;formReadOnly=true;await React.act(async()=>root.render(cascade()));await React.act(async()=>new Promise(resolve=>setTimeout(resolve,20)));assert.equal(container.querySelector('input'),null);assert.equal(cascadeQueries.length,cascadeReads);
  assert.deepEqual(recoverable,[]);assert.deepEqual(errors,[]);assert.equal(network,0);
  profiles.push({strict,hydrationErrors:recoverable.length,allocations,closes,cascadeReads,hiddenReads,network});
 }finally{if(root)await React.act(async()=>root.unmount());coordinator.destroy();console.error=oldError;names.forEach((key,index)=>{if(originals[index])Object.defineProperty(globalThis,key,originals[index]);else Reflect.deleteProperty(globalThis,key);});await window.happyDOM.close();}
}
console.log(JSON.stringify({format,react:React.version,profiles,cleanup:'completed'}));
`;

export function checkCompleteLinkedFinderReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    archivePath = resolve(archivePath);
    const parent = mkdtempSync(join(tmpdir(), 'sdk-complete-linked-finder-'));
    const profiles = [];
    try {
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            const root = mkdtempSync(join(parent, version.react + '-'));
            const run = (command, args) =>
                execFileSync(command, args, {
                    cwd: root,
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'pipe'],
                    timeout: 120000,
                });
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': `file:${archivePath}`,
                        react: version.react,
                        'react-dom': version.react,
                        '@types/react': version.types,
                        '@types/react-dom': version.domTypes,
                        '@types/node': '22.20.5',
                    },
                })
            );
            run('npm', [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
            ]);
            writeFileSync(
                join(root, 'runtime.mjs'),
                completeLinkedFinderRuntimeConsumer
            );
            for (const format of ['esm', 'cjs']) {
                const file = 'consumer.' + (format === 'esm' ? 'mts' : 'cts');
                writeFileSync(
                    join(root, file),
                    completeLinkedFinderTypedConsumer
                );
                run(process.execPath, [
                    typescriptBin,
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--noEmit',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    '--target',
                    'ES2022',
                    file,
                ]);
                const result = JSON.parse(
                    run(process.execPath, [
                        ...(format === 'cjs'
                            ? ['--no-experimental-require-module']
                            : []),
                        'runtime.mjs',
                        format,
                        happyDomModulePath,
                    ]).trim()
                );
                assert.equal(result.react, version.react);
                assert.equal(result.profiles.length, 2);
                const hashes = {};
                for (const file of [
                    'react/CompleteLinkedFinder.js',
                    'react/LinkedFinderCard.js',
                    'react/LinkedFinderAttachmentCollection.js',
                    'react/complete-linked-finder.css',
                    'ui/completeLinkedFinder.js',
                ]) {
                    const path = `dist/${format}/${file}`;
                    const installed = readFileSync(
                        join(root, 'node_modules/@miniextensions/sdk', path)
                    );
                    assert(
                        installed.equals(
                            execFileSync('tar', [
                                '-xOf',
                                archivePath,
                                'package/' + path,
                            ])
                        )
                    );
                    hashes[file] = createHash('sha256')
                        .update(installed)
                        .digest('hex');
                }
                profiles.push({ ...result, strictTypes: true, hashes });
            }
        }
        return { profiles, cleanup: 'completed' };
    } finally {
        rmSync(parent, { recursive: true, force: true });
    }
}
