import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';

export const fieldPresentationTypedConsumer = String.raw`
import {createElement} from 'react';
import {
    CompleteFormFieldPresentation,
    CompleteMultilineTextField,
    CompleteCheckboxField,
    type CompleteFormFieldPresentationProps,
    type FieldPresentationComposition,
} from '@miniextensions/sdk/react';
const props:CompleteFormFieldPresentationProps={
    title:'Literal <b>title</b>',fieldName:'Notes',required:true,
    associationKind:'input',formId:'external-form',
    description:'<p>Accessible <strong>help</strong></p>',error:'Required',
    descriptionPlacement:'tooltip',sameRow:true,
    children(presentation:FieldPresentationComposition) {
        return createElement(CompleteMultilineTextField,{
            id:'standalone-id',value:null,onChange(value){const scalar:string=value;void scalar;},
            presentation,
        });
    },
};
createElement(CompleteFormFieldPresentation,props);
createElement(CompleteFormFieldPresentation,{
    ...props,associationKind:'non-labelable',
    children(presentation:FieldPresentationComposition) {
        return createElement(CompleteCheckboxField,{
            value:false,onChange(checked){const scalar:boolean=checked;void scalar;},
            presentation,checkboxStyle:'button',
        });
    },
});
// @ts-expect-error no native whole-field renderer callback is accepted
createElement(CompleteFormFieldPresentation,{...props,renderNative(){return null;}});
// @ts-expect-error instance association is a discriminated DOM contract
const invalid:FieldPresentationComposition={chromeOwner:'shell',association:{kind:'writer',controlId:'id',labelId:'label'}};
// @ts-expect-error shell ownership cannot be an invented native writer
const owner:FieldPresentationComposition={chromeOwner:'host',association:{kind:'input',controlId:'id',labelId:'label'}};
void invalid;void owner;
`;

// The exact same actual SDK assemblies run installed in Node and the browser.
// Fixture state is an ordinary caller-owned scalar model, never a Form writer.
const assembly = String.raw`
const makeModels=()=>({
    'notes-a':{kind:'multiline',value:'  Literal <b>value</b>\n🙂',title:'Notes <b>literal</b>',sameRow:true},
    'notes-b':{kind:'multiline',value:'Keep adjacent notes',title:'Notes <b>literal</b>',sameRow:true},
    'checkbox-a':{kind:'checkbox',value:false,title:'Approved',style:'checkbox'},
    'checkbox-b':{kind:'checkbox',value:false,title:'Approved',style:'toggle'},
    'button':{kind:'checkbox',value:false,title:'Action field',style:'button'},
    'calendly':{kind:'checkbox',value:false,title:'Scheduling field',calendly:true},
});
function rows(React,api,models,write,actions) {
    return Object.entries(models).map(([key,model])=>{
        const kind=model.loading?'group':
            model.calendly||(model.style==='button'&&!model.readOnly)||(model.readOnly&&model.grid)?
                'non-labelable':'input';
        const description='description' in model?model.description:'<p>Help <strong>'+key+'</strong></p>';
        const error='error' in model?model.error:'Error '+key;
        return React.createElement('section',{
            key,id:'row-'+key,className:'fixture-row','data-field-id':model.kind==='multiline'?'fld_same_notes':'fld_same_checkbox',
        },React.createElement(api.CompleteFormFieldPresentation,{
            key:model.key??'mounted',title:model.title,fieldName:'Airtable fallback',
            semanticTitle:model.title,showTitle:model.showTitle,required:true,
            associationKind:kind,formId:'external-form',description,error,
            descriptionPlacement:model.placement??'top',descriptionImageUrl:model.image,
            preview:model.preview,visible:model.visible,sameRow:model.sameRow,
            enableSideBySideOnMobile:model.mobile,truncateDescription:model.truncate,
            loading:model.loading?React.createElement('span',null,'Loading local field'):undefined,
            children(presentation) {
                if(model.kind==='multiline')return React.createElement(api.CompleteMultilineTextField,{
                    id:'fld_same_notes',value:model.value,onChange:value=>write(key,value),presentation,
                    readOnly:model.readOnly,characterLimit:100,hasDescription:true,hasErrorMessage:true,
                });
                return React.createElement(api.CompleteCheckboxField,{
                    id:'fld_same_checkbox',value:model.value,onChange:value=>write(key,value),presentation,
                    readOnly:model.readOnly,isInGrid:model.grid,checkboxStyle:model.style,
                    checkedStateLabel:'Checked',uncheckedStateLabel:'Unchecked',
                    title:'Duplicate leaf title',feedback:'Duplicate leaf feedback',
                    calendlyPresenter:model.calendly?React.createElement('button',{
                        type:'button','data-local-schedule':'true',onClick:()=>actions.schedule++,
                    },'Schedule locally'):undefined,
                });
            },
        }));
    });
}
`;

const runtime =
    String.raw`
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import React from 'react';
const require=createRequire(import.meta.url),format=process.argv[2];
assert.equal(typeof globalThis.window,'undefined');assert.equal(typeof globalThis.document,'undefined');
const loadApi=()=>format==='esm'?import('@miniextensions/sdk/react'):Promise.resolve(require('@miniextensions/sdk/react'));
let api;
const {renderToString}=await import('react-dom/server');
` +
    assembly +
    String.raw`
const models=makeModels(),writes=[],actions={schedule:0,submits:0};
let root;
const element=()=>React.createElement(React.StrictMode,null,
    React.createElement('form',{id:'external-form',onSubmit(event){event.preventDefault();actions.submits++;}}),
    ...rows(React,api,models,(key,value)=>{writes.push({key,value});models[key].value=value;root.render(element());},actions),
    React.createElement(api.CompleteCheckboxField,{title:'Standalone title',feedback:'Standalone feedback',value:false,onChange(){throw Error('Unexpected standalone activation');}}));
// Run genuine no-DOM SSR in a child, then load the popup runtime after the
// DOM exists here. Radix's module-time browser detection follows real clients.
if(process.argv[4]==='--ssr') {
    api=await loadApi();
    console.log(JSON.stringify({html:renderToString(element()),react:React.version}));
    process.exit(0);
}
const ssr=JSON.parse(execFileSync(process.execPath,[
    fileURLToPath(import.meta.url),format,process.argv[3],'--ssr',
],{encoding:'utf8'}));
assert.equal(ssr.react,React.version);
const html=ssr.html;
assert(html.includes('Notes &lt;b&gt;literal&lt;/b&gt;'));assert(!html.includes('Duplicate leaf'));
assert(html.includes('Literal &lt;b&gt;value&lt;/b&gt;'));assert.deepEqual(writes,[]);
const {Window}=await import(pathToFileURL(process.argv[3]).href);
let networks=0;
const window=new Window({url:'https://field-consumer.invalid/local',settings:{fetch:{interceptor:{
    beforeAsyncRequest(){networks++;throw Error('Unexpected network');},
    beforeSyncRequest(){networks++;throw Error('Unexpected network');},
}}}});
const keys=['window','document','navigator','Node','NodeFilter','Element','HTMLElement','HTMLInputElement','HTMLButtonElement','HTMLTextAreaElement','HTMLFormElement','SVGElement','Document','DocumentFragment','ShadowRoot','MutationObserver','ResizeObserver','Event','CustomEvent','MouseEvent','PointerEvent','KeyboardEvent','FocusEvent','requestAnimationFrame','cancelAnimationFrame','getComputedStyle','IS_REACT_ACT_ENVIRONMENT'];
const previous=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
for(const key of keys) {
    let value=key==='IS_REACT_ACT_ENVIRONMENT'?true:window[key];
    if(['requestAnimationFrame','cancelAnimationFrame','getComputedStyle'].includes(key)&&typeof value==='function')value=value.bind(window);
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
}
const container=window.document.createElement('main');window.document.body.append(container);container.innerHTML=html;
const first=container.querySelector('textarea'),initialId=first.id,errors=[];
const row=key=>container.querySelector('#row-'+key);
const control=key=>row(key).querySelector('textarea,input,button[aria-pressed]');
const render=()=>React.act(async()=>root.render(element()));
function assertAssociations() {
    const ids=Array.from(window.document.querySelectorAll('[id]'),element=>element.id);
    assert.equal(new Set(ids).size,ids.length,'Every emitted DOM identity must be unique');
    for(const key of Object.keys(models)) {
        const section=row(key);if(!section.querySelector('.mx-sdk-form-field'))continue;
        const label=section.querySelector('.mx-sdk-field-title');
        if(label.tagName==='LABEL') {
            assert(label.control,'Input title must reference a mounted local control');
            assert(section.contains(label.control),'Input title must not activate another instance');
            assert.equal(label.control.getAttribute('form'),'external-form');
            assert(window.document.getElementById('external-form')); // actual .form is checked in Chromium
        } else assert.equal(label.getAttribute('for'),null,'Non-labelable title cannot carry htmlFor');
        for(const element of section.querySelectorAll('[aria-describedby]'))
            for(const id of element.getAttribute('aria-describedby').split(/\s+/)) {
                const target=window.document.getElementById(id);
                if(element.classList.contains('mx-sdk-field-tooltip-trigger')) {
                    assert(target&&target.getAttribute('role')==='tooltip','Tooltip trigger must reference its actual portaled popup');
                } else {
                    assert(target&&section.contains(target),'Control help/error must resolve inside the same field');
                }
            }
    }
    assert(!container.textContent.includes('Duplicate leaf'));
}
try {
    api=await loadApi();
    const {hydrateRoot}=await import('react-dom/client');
    await React.act(async()=>{root=hydrateRoot(container,element(),{onRecoverableError:error=>errors.push(String(error))});});
    assert.equal(control('notes-a'),first);assert.equal(first.id,initialId);assert.deepEqual(errors,[]);
    assertAssociations();
    assert.equal(container.querySelectorAll('.mx-sdk-complete-checkbox__feedback').length,1);
    assert.equal(container.querySelector('.mx-sdk-complete-checkbox__feedback').textContent,'Standalone feedback');
    const initialIds=Object.fromEntries(['notes-a','notes-b','checkbox-a','checkbox-b'].map(key=>[key,control(key).id]));
    models['notes-a'].value='Updated literal';models['notes-a'].showTitle=false;
    models['notes-a'].placement='tooltip';models['notes-a'].error=null;
    await render();assertAssociations();
    assert(row('notes-a').querySelector('label').classList.contains('mx-sdk-field-sr-only'));
    const descriptionId=control('notes-a').getAttribute('aria-describedby');
    assert(window.document.getElementById(descriptionId).classList.contains('mx-sdk-field-sr-only'));
    assert.equal(window.document.querySelector('[role="tooltip"]'),null);
    await React.act(async()=>row('notes-a').querySelector('.mx-sdk-field-tooltip-trigger').focus());
    assert(window.document.querySelector('[role="tooltip"]'));
    assert.equal(container.querySelectorAll('[id="'+descriptionId+'"]').length,1);
    models['notes-a'].description='<p>&nbsp;<br></p>';models['notes-a'].placement='bottom';
    await render();assert.equal(control('notes-a').getAttribute('aria-describedby'),null);
    assert.equal(row('notes-a').querySelector('.mx-sdk-field-description'),null);
    await React.act(async()=>row('checkbox-a').querySelector('label').click());
    assert.deepEqual(writes,[{key:'checkbox-a',value:true}]);assert.equal(control('checkbox-b').checked,false);
    await React.act(async()=>row('button').querySelector('.mx-sdk-field-title').click());
    assert.equal(writes.length,1);
    await React.act(async()=>control('button').click());
    assert.deepEqual(writes[1],{key:'button',value:true});
    await React.act(async()=>row('calendly').querySelector('.mx-sdk-field-title').click());
    assert.equal(actions.schedule,0);
    await React.act(async()=>row('calendly').querySelector('[data-local-schedule]').click());
    assert.equal(actions.schedule,1);
    models['checkbox-a'].readOnly=true;models['checkbox-a'].style='toggle';await render();
    assert.equal(control('checkbox-a').disabled,true);
    await React.act(async()=>row('checkbox-a').querySelector('label').click());
    assert.equal(writes.length,2);
    models['checkbox-b'].loading=true;await render();
    assert.equal(control('checkbox-b'),null);
    const loadingGroup=row('checkbox-b').querySelector('[role="group"]');
    assert(loadingGroup);assert.equal(window.document.getElementById(loadingGroup.getAttribute('aria-labelledby')).textContent,'Approved*');
    models['checkbox-b'].loading=false;models['checkbox-a'].readOnly=false;
    models['notes-b'].visible=false;await render();
    assert.equal(control('notes-b'),null);
    models['notes-b'].visible=true;await render();assertAssociations();
    for(const [key,id]of Object.entries(initialIds))assert.equal(control(key).id,id,'Mounted IDs survive value/config/loading/visibility rerenders');
    assert.equal(actions.submits,0);assert.equal(networks,0);assert.equal(window.location.href,'https://field-consumer.invalid/local');
    assert.equal(window.localStorage.length,0);assert.equal(window.sessionStorage.length,0);
    await React.act(async()=>root.unmount());root=undefined;
    console.log(JSON.stringify({react:React.version,format,hydrationErrors:errors.length,writes,actions,networkRequests:networks,cleanup:'completed'}));
} finally {
    if(root)await React.act(async()=>root.unmount());
    keys.forEach((key,index)=>{if(previous[index])Object.defineProperty(globalThis,key,previous[index]);else Reflect.deleteProperty(globalThis,key);});
    await window.happyDOM.close();
}
`;

export function checkFieldPresentationReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-field-presentation-'));
    const versions = [];
    const run = (command, args, options = {}) =>
        execFileSync(command, args, {
            cwd: directory,
            stdio: 'inherit',
            ...options,
        });
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
                const file = 'field-presentation.' + extension;
                writeFileSync(
                    join(directory, file),
                    fieldPresentationTypedConsumer
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
            const formats = [];
            for (const format of ['esm', 'cjs']) {
                const result = JSON.parse(
                    run(
                        process.execPath,
                        ['runtime.mjs', format, happyDomModulePath],
                        {
                            encoding: 'utf8',
                            stdio: ['ignore', 'pipe', 'inherit'],
                        }
                    )
                );
                assert.equal(result.react, version.react);
                assert.equal(result.hydrationErrors, 0);
                assert.equal(result.networkRequests, 0);
                assert.equal(result.actions.submits, 0);
                assert.equal(result.cleanup, 'completed');
                formats.push(result);
            }
            const installed = join(
                directory,
                'node_modules/@miniextensions/sdk'
            );
            for (const name of [
                'field-presentation',
                'complete-multiline',
                'complete-checkbox',
                'html-description',
            ]) {
                const esm = readFileSync(
                    join(installed, 'dist/esm/react/' + name + '.css')
                );
                assert(esm.length > 0);
                assert(
                    esm.equals(
                        readFileSync(
                            join(installed, 'dist/cjs/react/' + name + '.css')
                        )
                    )
                );
            }
            run(process.execPath, [
                '--input-type=module',
                '-e',
                String.raw`import{createRequire}from'node:module';
const require=createRequire(import.meta.url);
const{buildSync}=require(process.argv[1]);
const styles=['field-presentation','complete-multiline','complete-checkbox','html-description'];
for(const name of styles)require.resolve('@miniextensions/sdk/react/'+name+'.css');
for(const format of ['esm','cjs']) {
 const imports=styles.map(name=>format==='esm'?"import'@miniextensions/sdk/react/"+name+".css';":"require('@miniextensions/sdk/react/"+name+".css');").join('');
 const api=format==='esm'?"import{CompleteFormFieldPresentation,CompleteCheckboxField,CompleteMultilineTextField}from'@miniextensions/sdk/react';console.log(CompleteFormFieldPresentation,CompleteCheckboxField,CompleteMultilineTextField);":"console.log(require('@miniextensions/sdk/react').CompleteFormFieldPresentation);";
 buildSync({stdin:{contents:imports+api,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',outdir:'browser-output',write:false,logLevel:'silent'});
}`,
                esbuildModulePath,
            ]);
            versions.push({ react: version.react, formats });
            console.log(
                'Installed field presentation React' +
                    version.react +
                    ': ESM/CJS/types/CSS, real shell+Multiline+Checkbox SSR/hydration and local association isolation passed.'
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

export const fieldPresentationBrowserStyle = String.raw`
body{font:16px/1.5 system-ui,sans-serif;color:#111827;margin:20px}
.field-grid{display:flex;flex-wrap:wrap;gap:20px;max-width:850px;margin:auto}
.fixture-row{display:contents}
.mx-sdk-form-field{box-sizing:border-box}
.fixture-header,.fixture-controls,.fixture-state{max-width:850px;margin:0 auto 16px}
.fixture-header h1{font-size:1.4rem;margin:0 0 4px}
.fixture-header p{font-size:.875rem;margin:0;color:#475569}
.fixture-controls{box-sizing:border-box;border:1px solid #94a3b8;border-radius:8px;padding:12px;display:flex;flex-wrap:wrap;gap:10px 16px;font-size:.875rem;background:#f8fafc}
.fixture-controls legend{padding:0 6px;font-weight:600}
.fixture-controls label{display:inline-flex;gap:6px;align-items:center}
.fixture-controls button,.fixture-controls select{font:inherit;border:1px solid #94a3b8;background:white;border-radius:4px;padding:4px 8px;color:#111827}
.fixture-controls button{cursor:pointer}
.fixture-controls input[type=checkbox]{width:16px;height:16px}
.fixture-state{display:block;font-size:.8rem;color:#475569}
.fixture-viewport{max-width:850px;margin:auto}
.fixture-viewport[data-constrained=true]{box-sizing:border-box;width:320px;max-width:100%;height:60px;overflow:auto;border:2px solid #64748b;padding:8px}
.fixture-viewport[data-constrained=true] .field-grid{min-width:620px}
`;

export const fieldPresentationBrowserEntry =
    String.raw`import React,{useEffect} from 'react';
import{createRoot}from'react-dom/client';
import * as api from'@miniextensions/sdk/react';
` +
    assembly +
    String.raw`
const models=makeModels(),writes=[],actions={schedule:0,submits:0},errors=[];
let root,revision=0,committed=0,requests=0,resetSerial=0;
const fixtureOptions={constrained:false};
const pending=new Map();
window.addEventListener('error',event=>errors.push(String(event.error||event.message)));
window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
window.fetch=async()=>{requests++;throw Error('Field fixture cannot fetch');};
XMLHttpRequest.prototype.open=function(){requests++;throw Error('Field fixture cannot use XHR');};
function snapshot() {
 const ids=Array.from(document.querySelectorAll('[id]'),node=>node.id);
 return {react:React.version,committed,revision,requests,errors:[...errors],writes:[...writes],actions:{...actions},
  uniqueIds:new Set(ids).size===ids.length,rows:Object.fromEntries(Object.entries(models).map(([key,model])=>{
   const section=document.getElementById('row-'+key),shell=section.querySelector('.mx-sdk-form-field');
   const control=section.querySelector('textarea,input,button[aria-pressed]');
   const title=section.querySelector('.mx-sdk-field-title');
   const describedBy=control?.getAttribute('aria-describedby');
   return[key,{value:model.value,id:control?.id??null,form:control?.form?.id??null,
    checked:control&&'checked'in control?control.checked:null,disabled:control?.disabled??null,
    labelId:title?.id??null,labelTag:title?.tagName??null,
    labelIsLocal:title?.tagName==='LABEL'?!!title.control&&section.contains(title.control):null,
    descriptionIds:describedBy?.split(/\s+/)??[],
    descriptionsLocal:!describedBy||describedBy.split(/\s+/).every(id=>{const target=document.getElementById(id);return target&&section.contains(target);}),
    title:title?.textContent??null,visible:!!shell,
    width:shell?.getBoundingClientRect().width??null,basis:shell?getComputedStyle(shell).flexBasis:null}];
  }))};
}
function publish() {
 const current=++revision,promise=new Promise(resolve=>pending.set(current,resolve));
 root.render(React.createElement(App,{revision:current}));return promise;
}
function updateModel(key,patch) {
 Object.assign(models[key],patch);return publish();
}
function fixtureButton(label,onClick) {
 return React.createElement('button',{type:'button',onClick},label);
}
function fixtureToggle(label,checked,onChange) {
 return React.createElement('label',null,
  React.createElement('input',{type:'checkbox',checked,onChange:event=>onChange(event.currentTarget.checked)}),label);
}
function fixtureSelect(label,value,options,onChange) {
 return React.createElement('label',null,label,
  React.createElement('select',{value,onChange:event=>onChange(event.currentTarget.value)},
   ...options.map(([key,name])=>React.createElement('option',{key,value:key},name))));
}
function resetFixture() {
 for(const key of Object.keys(models))delete models[key];
 Object.assign(models,makeModels());
 for(const model of Object.values(models))model.key='fixture-reset-'+(++resetSerial);
 writes.length=0;actions.schedule=0;actions.submits=0;
 fixtureOptions.constrained=false;void publish();
}
function FixtureControls() {
 const notes=models['notes-a'],approval=models['checkbox-a'];
 const image=notes.image==='/field-presentation-image.svg'?'valid':
  notes.image==='/field-presentation-broken.svg'?'broken':'none';
 return React.createElement('fieldset',{className:'fixture-controls'},
  React.createElement('legend',null,'Synthetic fixture controls'),
  fixtureSelect('Notes description placement',notes.placement??'top',
   [['top','Top'],['bottom','Bottom'],['tooltip','Tooltip']],
   placement=>void updateModel('notes-a',{placement})),
  fixtureButton(notes.showTitle===false?'Show Notes title':'Hide Notes title',
   ()=>void updateModel('notes-a',{showTitle:notes.showTitle===false})),
  fixtureSelect('Description image',image,
   [['none','No image'],['valid','Valid local image'],['broken','Broken local image']],
   value=>void updateModel('notes-a',{image:value==='valid'?'/field-presentation-image.svg':value==='broken'?'/field-presentation-broken.svg':null})),
  fixtureButton('Show image only',()=>void updateModel('notes-a',{
   description:null,error:null,image:'/field-presentation-image.svg',
  })),
  fixtureButton('Restore text help and error',()=>void updateModel('notes-a',{
   description:'<p>Help <strong>notes-a</strong></p>',error:'Error notes-a',
  })),
  fixtureButton('Clear help and error',()=>void updateModel('notes-a',{description:null,error:null})),
  fixtureButton('Remount Notes field',()=>void updateModel('notes-a',{key:'fixture-remount-'+(++resetSerial)})),
  fixtureToggle('Image preview recovery',notes.preview===true,
   preview=>void updateModel('notes-a',{preview})),
  fixtureToggle('Readonly Notes',notes.readOnly===true,
   readOnly=>void updateModel('notes-a',{readOnly})),
  fixtureToggle('Readonly Approved',approval.readOnly===true,
   readOnly=>void updateModel('checkbox-a',{readOnly})),
  fixtureToggle('Show Notes loading state',notes.loading===true,
   loading=>void updateModel('notes-a',{loading})),
  fixtureToggle('Show Notes field',notes.visible!==false,
   visible=>void updateModel('notes-a',{visible})),
  fixtureToggle('Mobile same-row',notes.mobile===true,
   mobile=>{models['notes-a'].mobile=mobile;models['notes-b'].mobile=mobile;void publish();}),
  fixtureToggle('Constrain field viewport',fixtureOptions.constrained,
   constrained=>{fixtureOptions.constrained=constrained;void publish();}),
  fixtureButton('Reset synthetic fixture',resetFixture));
}
function App({revision}) {
 useEffect(()=>{committed=revision;for(const[key,resolve]of pending)if(key<=revision){pending.delete(key);resolve(snapshot());}},[revision]);
 const localActions={
  get schedule(){return actions.schedule;},
  set schedule(value){actions.schedule=value;void publish();},
 };
 const fieldRows=rows(React,api,models,(key,value)=>{
  writes.push({key,value});models[key].value=value;void publish();
 },localActions).map(node=>React.cloneElement(node,{},
  // Keep same-row checks separate from the shell's first-child boundary rule.
  React.createElement('span',{hidden:true,'data-synthetic-row-marker':'true'}),
  node.props.children));
 return React.createElement('main',null,
  React.createElement('header',{className:'fixture-header'},
   React.createElement('h1',null,'Complete field presentation local fixture'),
   React.createElement('p',null,'Synthetic configuration controls change these local demo fields. No record or provider is connected.')),
  React.createElement(FixtureControls),
  React.createElement('output',{className:'fixture-state','aria-label':'Synthetic fixture state','aria-live':'polite'},
   'Local value changes: '+writes.length+'; form submissions: '+actions.submits+'; local scheduling actions: '+actions.schedule),
  React.createElement('form',{id:'external-form',onSubmit(event){event.preventDefault();actions.submits++;void publish();}}),
  React.createElement('div',{className:'fixture-viewport','data-constrained':String(fixtureOptions.constrained),'aria-label':'Synthetic field viewport'},
   React.createElement('div',{className:'field-grid'},...fieldRows)));
}
window.__nativeProbe={snapshot};
window.__fieldPresentationFixture={
 snapshot,
 async update(key,patch){return updateModel(key,patch);},
 async flush(){return publish();},
 async remount(key){models[key].key=(models[key].key??0)+1;return publish();},
};
root=createRoot(document.getElementById('root'));void publish();
`;

/** The existing harness owns the archive, browser, origin/CSP and cleanup. */
export async function prepareFieldPresentationBrowserFixtures({
    temporary,
    archive,
    installed,
    allowed,
    report,
    build,
    assertBrowserInputs,
    regular,
    hash,
}) {
    const entry = join(temporary, 'field-presentation.mjs');
    writeFileSync(entry, fieldPresentationBrowserEntry);
    const bundle = await build({
        absWorkingDir: temporary,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        outfile: join(temporary, 'field-presentation.js'),
        write: false,
        metafile: true,
        legalComments: 'none',
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await assertBrowserInputs(bundle.metafile, temporary);
    const inputs = Object.keys(bundle.metafile.inputs);
    for (const name of [
        'CompleteFormFieldPresentation',
        'CompleteMultilineTextField',
        'CompleteCheckboxField',
    ])
        assert(
            inputs.some((input) => input.endsWith('/react/' + name + '.js')),
            'Fixture must mount the actual installed ' + name
        );
    const proofInputs = [];
    for (const name of inputs) {
        const path = realpathSync(resolve(temporary, name));
        const bytes = regular(path);
        const item = {
            path: relative(temporary, path),
            sha256: hash(bytes),
            bytes: bytes.length,
        };
        if (path.startsWith(installed + '/')) {
            const member =
                'package/' + relative(installed, path).replaceAll('\\', '/');
            assert.deepEqual(
                bytes,
                execFileSync('tar', ['-xOf', archive, member])
            );
            item.archiveMember = member;
        }
        proofInputs.push(item);
    }
    const require = createRequire(join(temporary, 'package.json'));
    const cssMembers = [];
    const links = [];
    for (const name of [
        'field-presentation',
        'complete-multiline',
        'complete-checkbox',
        'html-description',
    ]) {
        const path = realpathSync(
            require.resolve('@miniextensions/sdk/react/' + name + '.css')
        );
        assert(path.startsWith(installed + '/'));
        const bytes = regular(path);
        const member =
            'package/' + relative(installed, path).replaceAll('\\', '/');
        assert.deepEqual(bytes, execFileSync('tar', ['-xOf', archive, member]));
        cssMembers.push({ member, sha256: hash(bytes) });
        const route = '/field-presentation-' + name + '.css';
        allowed.set(route, bytes);
        links.push('<link rel="stylesheet" href="' + route + '">');
    }
    const code = bundle.outputFiles[0].contents;
    report.fieldPresentation = {
        sourceSha256: hash(fieldPresentationBrowserEntry),
        fixtureCssSha256: hash(fieldPresentationBrowserStyle),
        packagedCss: cssMembers,
        bundleSha256: hash(code),
        bundleInputs: proofInputs,
    };
    allowed.set('/field-presentation.js', code);
    allowed.set(
        '/field-presentation-fixture.css',
        Buffer.from(fieldPresentationBrowserStyle)
    );
    allowed.set(
        '/field-presentation-image.svg',
        Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><rect width="48" height="24" fill="green"/></svg>'
        )
    );
    // Intentional controlled decode failure; no provider or fixture traffic.
    allowed.set('/field-presentation-broken.svg', Buffer.from('<svg broken'));
    allowed.set(
        '/field-presentation.html',
        Buffer.from(
            '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
                "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'\">" +
                '<title>Complete field presentation</title>' +
                links.join('') +
                '<link rel="stylesheet" href="/field-presentation-fixture.css">' +
                '</head><body><div id="root"></div><script type="module" src="/field-presentation.js"></script></body></html>'
        )
    );
    return { path: '/field-presentation.html' };
}

export async function checkFieldPresentationBrowser({ page, evidence }) {
    await page.waitForFunction(
        () => window.__nativeProbe?.snapshot().committed > 0
    );
    const row = (key) => page.locator('#row-' + key);
    const input = (key) => row(key).locator('textarea,input');
    const update = (key, patch) =>
        page.evaluate(
            ({ key, patch }) =>
                window.__fieldPresentationFixture.update(key, patch),
            { key, patch }
        );
    const flush = () =>
        page.evaluate(() => window.__fieldPresentationFixture.flush());
    const groups = [];
    const verify = async (name) => {
        const snapshot = await flush();
        assert(snapshot.uniqueIds, name + ': all DOM identities are unique');
        for (const value of Object.values(snapshot.rows)) {
            assert(value.descriptionsLocal, name + ': feedback stays local');
            if (value.labelTag === 'LABEL') assert(value.labelIsLocal);
            if (value.id != null) assert.equal(value.form, 'external-form');
        }
        assert.equal(snapshot.requests, 0);
        assert.equal(snapshot.actions.submits, 0);
        assert.deepEqual(snapshot.errors, []);
        groups.push({ name, snapshot });
        return snapshot;
    };
    let value = await verify(
        'real complete leaves and local labels/help/errors'
    );
    const ids = Object.fromEntries(
        ['notes-a', 'notes-b', 'checkbox-a', 'checkbox-b'].map((key) => [
            key,
            value.rows[key].id,
        ])
    );
    assert.equal(
        await input('notes-a').inputValue(),
        '  Literal <b>value</b>\n🙂'
    );
    assert.equal(
        await row('notes-a').locator('.mx-sdk-field-title b').count(),
        0
    );
    assert.equal(await page.getByText('Duplicate leaf title').count(), 0);
    assert.equal(await page.getByText('Duplicate leaf feedback').count(), 0);

    await row('checkbox-a').locator('label').click();
    value = await verify(
        'label activation stays in its own same-field instance'
    );
    assert.equal(value.rows['checkbox-a'].checked, true);
    assert.equal(value.rows['checkbox-b'].checked, false);
    assert.deepEqual(value.writes, [{ key: 'checkbox-a', value: true }]);
    await input('checkbox-b').click();
    await input('checkbox-b').press('Space');
    value = await verify('direct toggle and Space preserve sibling state');
    assert.equal(value.rows['checkbox-b'].checked, false);
    assert.equal(value.rows['checkbox-a'].checked, true);
    assert.deepEqual(value.writes.slice(1), [
        { key: 'checkbox-b', value: true },
        { key: 'checkbox-b', value: false },
    ]);
    await row('button').locator('.mx-sdk-field-title').click();
    await row('calendly').locator('.mx-sdk-field-title').click();
    value = await verify(
        'non-labelable titles do not activate an adjacent input'
    );
    assert.equal(value.writes.length, 3);
    assert.equal(value.actions.schedule, 0);
    assert.equal(value.rows.button.labelTag, 'SPAN');
    assert.equal(value.rows.calendly.labelTag, 'SPAN');
    await row('button').locator('button[aria-pressed]').click();
    await row('calendly')
        .getByRole('button', { name: 'Schedule locally' })
        .click();
    value = await verify('explicit button and synthetic scheduling action');
    assert.equal(value.writes[3].key, 'button');
    assert.equal(value.actions.schedule, 1);

    await update('notes-a', {
        showTitle: false,
        placement: 'tooltip',
        error: null,
    });
    const hidden = row('notes-a').locator('.mx-sdk-field-title');
    assert(
        await hidden.evaluate(
            (element) =>
                getComputedStyle(element).clip === 'rect(0px, 0px, 0px, 0px)'
        )
    );
    const trigger = row('notes-a').getByRole('button', {
        name: 'Field description for Notes <b>literal</b>',
    });
    await trigger.focus();
    await page.getByRole('tooltip').waitFor();
    assert.equal(await page.getByRole('tooltip').count(), 1);
    value = await verify('hidden title and separate accessible tooltip copy');
    const descriptionId = value.rows['notes-a'].descriptionIds[0];
    assert.equal(
        await row('notes-a')
            .locator('[id="' + descriptionId + '"]')
            .evaluate((element) =>
                element.classList.contains('mx-sdk-field-sr-only')
            ),
        true
    );
    assert.equal(await page.locator('[id="' + descriptionId + '"]').count(), 1);
    await trigger.press('Escape');
    await page.getByRole('tooltip').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('tooltip').count(), 0);

    // Ordinary pointer travel must cross the popup gap without losing it.
    await input('notes-b').focus();
    const triggerBox = await trigger.boundingBox();
    assert(triggerBox);
    await page.mouse.move(
        triggerBox.x + triggerBox.width / 2,
        triggerBox.y + triggerBox.height / 2
    );
    await page.getByRole('tooltip').waitFor();
    const hoveredPopup = await page.getByRole('tooltip').boundingBox();
    assert(hoveredPopup);
    await page.mouse.move(
        hoveredPopup.x + hoveredPopup.width / 2,
        hoveredPopup.y + hoveredPopup.height / 2,
        { steps: 5 }
    );
    assert.equal(await page.getByRole('tooltip').isVisible(), true);
    await page.mouse.move(8, 8);
    await page.getByRole('tooltip').waitFor({ state: 'detached' });
    await verify('pointer reaches the portaled popup and leaving dismisses it');

    // Constrain only the synthetic ancestor. The actual popup must escape its
    // overflow boundary and remain hit-testable outside the clipped rectangle.
    const viewportToggle = page.getByRole('checkbox', {
        name: 'Constrain field viewport',
        exact: true,
    });
    await viewportToggle.check();
    await trigger.scrollIntoViewIfNeeded();
    const constrainedTrigger = await trigger.boundingBox();
    assert(constrainedTrigger);
    await page.mouse.move(
        constrainedTrigger.x + constrainedTrigger.width / 2,
        constrainedTrigger.y + constrainedTrigger.height / 2
    );
    await page.getByRole('tooltip').waitFor();
    const clipBox = await page.locator('.fixture-viewport').boundingBox();
    const escapedPopup = await page.getByRole('tooltip').boundingBox();
    assert(clipBox && escapedPopup);
    assert(
        escapedPopup.y + escapedPopup.height > clipBox.y + clipBox.height,
        'The portaled popup extends beyond the short scrolling ancestor'
    );
    assert.equal(
        await page
            .getByRole('tooltip')
            .evaluate(
                (element) => element.closest('.fixture-viewport') != null
            ),
        false
    );
    const outsidePoint = {
        x: escapedPopup.x + escapedPopup.width / 2,
        y: Math.max(clipBox.y + clipBox.height + 1, escapedPopup.y + 1),
    };
    assert(outsidePoint.y < escapedPopup.y + escapedPopup.height);
    await page.mouse.move(outsidePoint.x, outsidePoint.y, { steps: 5 });
    assert.equal(
        await page.evaluate(
            ({ x, y }) =>
                document.elementFromPoint(x, y)?.closest('[role="tooltip"]') !=
                null,
            outsidePoint
        ),
        true
    );
    await verify('popup escapes a narrow scrolling ancestor without clipping');
    await viewportToggle.uncheck();
    await page.mouse.move(8, 8);
    await page.getByRole('tooltip').waitFor({ state: 'detached' });

    await update('notes-a', {
        description: '<p>&nbsp;<br></p>',
        placement: 'bottom',
    });
    assert.equal(await input('notes-a').getAttribute('aria-describedby'), null);
    assert.equal(
        await row('notes-a').locator('.mx-sdk-field-description').count(),
        0
    );

    await update('checkbox-a', { readOnly: true, style: 'toggle' });
    assert.equal(await input('checkbox-a').isDisabled(), true);
    const readonlyLabel = row('checkbox-a').locator('label');
    await readonlyLabel.scrollIntoViewIfNeeded();
    const readonlyLabelBounds = await readonlyLabel.boundingBox();
    assert(readonlyLabelBounds);
    // A real pointer can hit the label, while the associated disabled input
    // remains inert. Playwright's label.click() instead waits for that input
    // to become enabled and never delivers this readonly-negative interaction.
    await page.mouse.click(
        readonlyLabelBounds.x + readonlyLabelBounds.width / 2,
        readonlyLabelBounds.y + readonlyLabelBounds.height / 2
    );
    assert.equal(await input('checkbox-a').isDisabled(), true);
    value = await verify('readonly projects to disabled native checkbox');
    assert.equal(value.writes.length, 4);
    await update('checkbox-b', { loading: true });
    assert.equal(await input('checkbox-b').count(), 0);
    assert.equal(
        await row('checkbox-b')
            .getByRole('group', { name: 'Approved*' })
            .count(),
        1
    );
    await update('checkbox-b', { loading: false });
    await update('notes-b', { visible: false });
    assert.equal(await row('notes-b').locator('.mx-sdk-form-field').count(), 0);
    await update('notes-b', { visible: true });
    value = await verify('host visibility/loading projection and stable IDs');
    for (const [key, id] of Object.entries(ids))
        assert.equal(value.rows[key].id, id);

    await input('notes-b').fill('Literal <i>edited</i>\n🙂');
    value = await verify('real multiline editing preserves literal text');
    assert.equal(value.rows['notes-b'].value, 'Literal <i>edited</i>\n🙂');
    assert.equal(value.rows['notes-a'].value, '  Literal <b>value</b>\n🙂');

    await update('notes-a', {
        description: null,
        error: null,
        placement: 'top',
        image: '/field-presentation-image.svg',
    });
    await row('notes-a').locator('img').waitFor();
    await page.waitForFunction(
        () => document.querySelector('#row-notes-a img')?.naturalWidth === 48
    );
    assert.equal(await input('notes-a').getAttribute('aria-describedby'), null);
    await update('notes-a', { image: '/field-presentation-broken.svg' });
    await row('notes-a').locator('img').waitFor({ state: 'detached' });
    assert.equal(await row('notes-a').getByRole('status').count(), 0);
    await update('notes-a', { title: 'Updated image instructions' });
    assert.equal(await row('notes-a').locator('img').count(), 0);
    await update('notes-a', { preview: true });
    assert.equal(await row('notes-a').getByRole('status').count(), 1);
    await row('notes-a').getByRole('button', { name: 'Try again' }).click();
    await row('notes-a').getByRole('status').waitFor();
    await update('notes-a', { image: '/field-presentation-image.svg' });
    await page.waitForFunction(
        () => document.querySelector('#row-notes-a img')?.naturalWidth === 48
    );
    await row('notes-a').locator('img').dispatchEvent('error');
    assert.equal(await row('notes-a').getByRole('status').count(), 1);
    await row('notes-a').getByRole('button', { name: 'Try again' }).click();
    await page.waitForFunction(
        () => document.querySelector('#row-notes-a img')?.naturalWidth === 48
    );
    await update('notes-a', { placement: 'tooltip' });
    await row('notes-a').locator('.mx-sdk-field-tooltip-trigger').focus();
    await page.getByRole('tooltip').waitFor();
    assert.equal(await input('notes-a').getAttribute('aria-describedby'), null);
    assert.equal(await page.getByRole('tooltip').locator('img').count(), 1);
    await verify(
        'controlled local image decode failure/replacement/preview retry and image-only tooltip'
    );

    await page.setViewportSize({ width: 900, height: 900 });
    value = await verify('desktop same-row layout');
    assert(value.rows['notes-a'].width < 500);
    assert(value.rows['notes-b'].width < 500);
    await page.setViewportSize({ width: 390, height: 900 });
    value = await verify('mobile stacks same-row fields by default');
    assert.equal(value.rows['notes-a'].basis, '100%');
    assert.equal(value.rows['notes-b'].basis, '100%');
    await update('notes-a', { mobile: true });
    await update('notes-b', { mobile: true });
    value = await verify('explicit mobile same-row layout');
    assert(value.rows['notes-a'].width < 220);
    assert(value.rows['notes-b'].width < 220);

    evidence.groups = groups;
    evidence.limits = [
        'Synthetic localhost scalar assemblies; no native backend or durable persistence claim.',
        'Scheduling is an explicitly admitted local button; no provider is loaded.',
        'Image resources are controlled local SVG success/decode-failure responses.',
    ];
}
