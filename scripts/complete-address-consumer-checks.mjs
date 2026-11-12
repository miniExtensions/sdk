import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const typed = String.raw`
import { createElement, createRef } from 'react';
import { AddressField, type AddressFieldProps, CompleteAddressAutocomplete, useAddressAutocomplete, type CompleteAddressAutocompleteProps, type AddressAutocompleteIdentity, type AddressAutocompleteLabels } from '@miniextensions/sdk/react';
const identity: AddressAutocompleteIdentity = {session:'s',field:'f',readScope:'authorized-read-owner'};
const labels: AddressAutocompleteLabels = {clear:'Clear',loadingPredictions:'Loading suggestions',loadingDetails:'Loading selected address',failed:'Unable to load',retry:'Try again'};
const props: CompleteAddressAutocompleteProps = {identity,value:null,onChange(value){const scalar:string=value;void scalar;},reads:{async listPredictions(query,{signal}){const raw:string=query;const abort:AbortSignal=signal;void raw;void abort;return [{placeId:'p',description:'Literal address'}];},async getFormattedAddress(placeId,{signal}){void placeId;void signal;return 'Canonical';}},labels,initialMobile:false,id:'address',form:'existing-form',maxLength:60,'aria-describedby':'help','aria-invalid':false,theme:{activeBackground:'#dbeafe',activeText:'#1e3a8a'}};
createElement(CompleteAddressAutocomplete,{...props,ref:createRef<HTMLInputElement>()});
createElement(AddressField,{...props,ref:createRef<HTMLInputElement>()});
createElement(AddressField,{mode:'manual',value:null,onChange(){},labels:{clear:'Clear'},explanation:'Standalone form only',initialMobile:false});
createElement(AddressField,{mode:'readonly',value:'Accepted address',language:'ja'});
// @ts-expect-error manual admission cannot borrow read authority
const manualReads:AddressFieldProps={mode:'manual',value:'',onChange(){},labels:{clear:'Clear'},reads:props.reads};
// @ts-expect-error readonly presentation has no writer
const readonlyWriter:AddressFieldProps={mode:'readonly',value:'',language:'en',onChange(){}};
void manualReads;void readonlyWriter;

function Owner(){const lifecycle=useAddressAutocomplete(props);lifecycle.change('raw');lifecycle.select(lifecycle.state.predictions[0]??null);lifecycle.retry();return null;}
// @ts-expect-error reads are explicit, no singleton credential/client
const missing:CompleteAddressAutocompleteProps={identity,value:'',onChange(){},labels};
// @ts-expect-error canonical data cannot be a selected prediction
const selected:CompleteAddressAutocompleteProps={...props,value:{placeId:'p',description:'wrong'}};
// @ts-expect-error no second uncontrolled value store
const draft:CompleteAddressAutocompleteProps={...props,defaultValue:'other'};
// @ts-expect-error complete presentation requires no native renderer slot
const slot:CompleteAddressAutocompleteProps={...props,renderInput(){return null;}};
// @ts-expect-error core remains React-free
import {CompleteAddressAutocomplete as CoreAddress} from '@miniextensions/sdk';
void Owner;void missing;void selected;void draft;void slot;void CoreAddress;
`;

const runtime = String.raw`
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToString} from 'react-dom/server';
import * as esm from '@miniextensions/sdk/react';
import {mock} from 'node:test';
const require=createRequire(import.meta.url),cjs=require('@miniextensions/sdk/react');
const {Window}=await import(pathToFileURL(process.argv[2]).href);
const css=readFileSync(require.resolve('@miniextensions/sdk/react/complete-address.css'),'utf8');
assert(css.includes('.mx-sdk-address-options'));assert(!css.includes('@tailwind'));assert(!css.includes('@apply'));
assert.equal('CompleteAddressAutocomplete' in require('@miniextensions/sdk'),false);
assert.equal('AddressField' in require('@miniextensions/sdk'),false);
const naturalCss=readFileSync(require.resolve('@miniextensions/sdk/react/address-field.css'),'utf8');assert(naturalCss.includes('complete-address.css'));assert(naturalCss.includes('complete-readonly-text.css'));
const labels={clear:'Borrar',loadingPredictions:'Cargando sugerencias',loadingDetails:'Cargando la dirección seleccionada',failed:'No se pudieron cargar las sugerencias.',retry:'Intentar de nuevo'};
let groups=0;
for(const api of [esm,cjs]){
 let writes=[],queries=[],details=[],network=0,submits=0,resolveDetail,root;
 const ref=React.createRef();let model={value:'',identity:{session:'s',field:'f',readScope:'A'},mounted:true};
 const props=()=>({identity:model.identity,value:model.value,onChange(value){writes.push(value);model.value=value;root.render(view());},reads:{async listPredictions(query,{signal}){queries.push({query,signal});return [{placeId:'p',description:'Selected address'},{placeId:'p2',description:'Second address'}];},getFormattedAddress(placeId,{signal}){details.push({placeId,signal,prior:[...writes]});return new Promise(resolve=>resolveDetail=resolve);}},labels,initialMobile:true,id:'address',form:'address-form','aria-label':'Address','aria-describedby':'hint',maxLength:60,ref});
 const view=()=>React.createElement(React.StrictMode,null,model.mounted?React.createElement(api.CompleteAddressAutocomplete,props()):null);
 const readonly=renderToString(React.createElement(api.AddressField,{mode:'readonly',value:'https://example.invalid',language:'ja'}));assert(readonly.includes('href="https://example.invalid"'));assert(!readonly.includes('combobox'));assert(!readonly.includes('<input'));
 const manual=renderToString(React.createElement(api.AddressField,{mode:'manual',value:null,onChange(){throw Error('SSR must not write');},labels:{clear:'Clear'},initialMobile:false,explanation:'Standalone only'}));assert(manual.includes('Standalone only'));assert(!manual.includes('combobox'));
 assert.equal(typeof document,'undefined');const html=renderToString(view());assert(html.includes('value=""'));assert.equal(queries.length,0);
 const window=new Window({url:'https://address.example.test'});
 const names=['window','document','navigator','HTMLElement','HTMLInputElement','HTMLButtonElement','HTMLFieldSetElement','HTMLLegendElement','Node','NodeFilter','Element','requestAnimationFrame','cancelAnimationFrame','getComputedStyle','IS_REACT_ACT_ENVIRONMENT','fetch'];
 const originals=names.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
 for(const key of names)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:key==='fetch'?async()=>{network++;throw Error('Unexpected network');}:['requestAnimationFrame','cancelAnimationFrame','getComputedStyle'].includes(key)?window[key].bind(window):window[key]});
 Object.defineProperty(window,'fetch',{value:globalThis.fetch});
 const form=window.document.createElement('form');form.id='address-form';const container=window.document.createElement('div');container.innerHTML=html;form.append(container);window.document.body.append(form);form.addEventListener('submit',e=>{submits++;e.preventDefault();});const serverInput=container.querySelector('input');
 try{
  const {hydrateRoot}=await import('react-dom/client');const errors=[];
  await React.act(async()=>{root=hydrateRoot(container,view(),{onRecoverableError:error=>errors.push(error.message)});});
  assert.deepEqual(errors,[]);assert.equal(ref.current,serverInput);assert.equal(ref.current,container.querySelector('input'));assert.equal(ref.current.form,form);assert.equal(ref.current.id,'address');assert.equal(ref.current.getAttribute('form'),'address-form');assert.equal(ref.current.getAttribute('aria-describedby'),'hint');assert.equal(ref.current.autocomplete,'off');
  mock.timers.enable({apis:['setTimeout']});
  await React.act(async()=>{const input=ref.current;input.focus();Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'  Raw query  ');input.dispatchEvent(new window.Event('input',{bubbles:true}));});
  assert.deepEqual(writes,['  Raw query  ']);assert.equal(queries.length,0);
  await React.act(async()=>mock.timers.tick(800));assert.equal(queries[0].query,'  Raw query  ');
  const activeText=()=>document.getElementById(ref.current.getAttribute('aria-activedescendant'))?.textContent;
  assert.equal(activeText(),'Selected address');
  await React.act(async()=>ref.current.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
  assert.equal(activeText(),'Second address');
  await React.act(async()=>ref.current.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})));
  assert.equal(activeText(),'Selected address');
  assert(container.querySelector('[role=option]'));assert(container.querySelector('img').src.startsWith('data:image/png;base64,'));
  await React.act(async()=>ref.current.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
  assert.equal(model.value,'Selected address');assert.deepEqual(details[0].prior,['  Raw query  ','Selected address']);assert.equal(container.querySelector('[role=status]').textContent,labels.loadingDetails);
  await React.act(async()=>{model.identity={...model.identity,readScope:'B'};model.value='External replacement';root.render(view());});
  assert.equal(details[0].signal.aborted,true);await React.act(async()=>resolveDetail('Late detail'));assert.equal(ref.current.value,'External replacement');assert.equal(writes.length,2);
  const clear=container.querySelector('button');assert.equal(clear.type,'button');assert.equal(clear.getAttribute('aria-label'),labels.clear);
  await React.act(async()=>clear.click());assert.equal(ref.current.value,'');assert.equal(window.document.activeElement,ref.current);assert.equal(submits,0);assert.equal(network,0);
  await React.act(async()=>root.render(React.createElement(api.AddressField,{mode:'readonly',value:'Native accepted address',language:'es'})));assert.equal(ref.current,null);assert(container.textContent.includes('Native accepted address'));assert.equal(container.querySelector('input'),null);
  let manualValue='';const manualView=()=>React.createElement(api.AddressField,{mode:'manual',value:manualValue,onChange(value){manualValue=value;root.render(manualView());},labels:{clear:'Clear'},initialMobile:true,ref});await React.act(async()=>root.render(manualView()));await React.act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(ref.current,'Manual');ref.current.dispatchEvent(new window.Event('input',{bubbles:true}));});assert.equal(manualValue,'Manual');assert.equal(queries.length,1);await React.act(async()=>container.querySelector('button').click());assert.equal(manualValue,'');assert.equal(submits,0);assert.equal(network,0);
  await React.act(async()=>root.unmount());root=undefined;assert.equal(ref.current,null);groups++;
 }finally{if(root)await React.act(async()=>root.unmount());mock.timers.reset();names.forEach((key,i)=>{if(originals[i])Object.defineProperty(globalThis,key,originals[i]);else Reflect.deleteProperty(globalThis,key);});await window.happyDOM.close();}
}
console.log(JSON.stringify({react:React.version,groups,cleanup:'completed'}));
`;

export function checkCompleteAddressReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-complete-address-'));
    const versions = [];
    const run = (command, args) =>
        execFileSync(command, args, { cwd: directory, stdio: 'inherit' });
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
        writeFileSync(join(directory, 'runtime.mjs'), runtime);
        for (const version of [
            { react: '18.3.1', types: '18.3.12', dom: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', dom: '19.2.2' },
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
                '@types/react-dom@' + version.dom,
            ]);
            for (const extension of ['mts', 'cts']) {
                const name = 'consumer.' + extension;
                writeFileSync(join(directory, name), typed);
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
                    name,
                ]);
            }
            const result = JSON.parse(
                execFileSync(
                    process.execPath,
                    [join(directory, 'runtime.mjs'), happyDomModulePath],
                    { cwd: directory, encoding: 'utf8' }
                )
            );
            assert.equal(result.react, version.react);
            assert.equal(result.groups, 2);
            assert.equal(result.cleanup, 'completed');
            versions.push(result);
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
