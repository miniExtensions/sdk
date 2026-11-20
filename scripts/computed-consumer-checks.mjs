import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { execPackageFileSync } from './package-manager-launch.mjs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const computedTypedConsumer = String.raw`
import {createElement} from 'react';
import {ComputedField,projectComputedFormulaDisplay,composeComputedPresentation,type ComputedFieldProps,type ComputedFormulaProjectionInput} from '@miniextensions/sdk/react';
import {projectComputedLookup} from '@miniextensions/sdk/ui';
const owner={token:{},isCurrent:()=>true};
const lookup:ComputedFieldProps={kind:'lookup',owner,identity:owner.token,state:{status:'empty'}};
createElement(ComputedField,lookup);
createElement(ComputedField,{kind:'formula',owner,identity:owner.token,display:{mode:'controlled',isValid:true,language:'en',resultType:'number',value:0,formattedValue:'0.00'}});
createElement(ComputedField,{kind:'rollup',owner,identity:owner.token,display:{mode:'controlled',language:'en',isValid:false}});
const facts:ComputedFormulaProjectionInput={isValid:true,language:'en',resultType:'number',value:0,formattedValue:'0',config:{textSizeForFormulaAsTextField:'large'}};
projectComputedFormulaDisplay(facts);
projectComputedLookup({field:null,value:[],displayConfig:{}});
composeComputedPresentation({projection:{status:'empty'},owner,entries:new Map()});
// @ts-expect-error Computed presentation grants no writer
createElement(ComputedField,{...lookup,onValueChange(){}});
// @ts-expect-error No host renderer or binding slot
createElement(ComputedField,{...lookup,render(){return null;}});
// @ts-expect-error Frame implementation metadata is not a public control option
createElement(ComputedField,{...lookup,frameRole:'group'});
// @ts-expect-error Formula inner IDs cannot duplicate the outer association
createElement(ComputedField,{kind:'formula',owner,identity:owner.token,display:{mode:'controlled',isValid:false,language:'en',inputId:'duplicate'}});
// @ts-expect-error Formula configuration projection accepts facts, not a formatter callback
const callback:ComputedFormulaProjectionInput={...facts,format(){return 'raw';}};void callback;
// @ts-expect-error Invalid Rollup metadata cannot carry an answer
createElement(ComputedField,{kind:'rollup',owner,identity:owner.token,display:{mode:'controlled',language:'en',isValid:false,value:'private'}});
`;

/** Provider-free host shared by installed SSR/hydration and real browser proof. */
export const computedHost = String.raw`
const h=React.createElement;
let current=true;const listeners=new Set();
const owner={token:{},isCurrent:()=>current,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}};
const source={id:'computed-lookup',name:'Computed Lookup',description:null,isComputed:true,isPrimaryField:false,config:{type:'multipleLookupValues',options:{isValid:true,recordLinkFieldId:'link',fieldIdInLinkedTable:'result',result:{type:'singleLineText',options:null}}}};
const canonical=Object.freeze(['Repeated',null,'Repeated',false,0]);
const projection=ui.projectComputedLookup({field:source,value:canonical,displayConfig:{},forceReadOnly:true});
if(projection.status!=='ready')throw Error('Computed Lookup admission');
const entries=new Map(projection.occurrences.map(item=>[item.key,{kind:'result',result:{kind:'literal',text:String(item.value)}}]));
const state=api.composeComputedPresentation({projection,entries,owner,language:'en'});
const projectedFormula=api.projectComputedFormulaDisplay({isValid:true,language:'en',resultType:'singleLineText',value:'<strong>Computed HTML</strong><script>forbidden()</script>',formattedValue:'Computed HTML',config:{renderFormulaAsHTML:true,renderFormulaAsAttachment:true,displayAsButton:true}});
if(projectedFormula.status!=='ready')throw Error('Computed Formula admission');
const base={owner,identity:owner.token,language:'en'};
function computedElement(){return h(React.StrictMode,null,h('form',{onSubmit(event){event.preventDefault();throw Error('Unexpected computed submit');}},h('input',{id:'neighbor',defaultValue:'Preserved draft'}),h('span',{id:'computed-formula-title'},'Computed Formula'),h(api.ComputedField,{...base,kind:'formula',inputId:'formula',labelledBy:'computed-formula-title',display:projectedFormula.display}),h(api.ComputedField,{...base,kind:'rollup',inputId:'rollup',display:{mode:'controlled',language:'en',isValid:true,value:'0, false'}}),h(api.ComputedField,{...base,kind:'lookup',inputId:'lookup',state})));}
`;

export const computedRuntime =
    String.raw`
import assert from 'node:assert/strict';import {createRequire} from 'node:module';import{execFileSync}from'node:child_process';import{fileURLToPath,pathToFileURL}from'node:url';import React from'react';
const require=createRequire(import.meta.url),format=process.argv[2];
const api=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
const ui=format==='esm'?await import('@miniextensions/sdk/ui'):require('@miniextensions/sdk/ui');
` +
    computedHost +
    String.raw`
if(process.argv[4]==='--ssr'){
 assert.equal(typeof globalThis.document,'undefined');const{renderToString}=await import('react-dom/server');const warnings=[],old=console.error;let html;
 try{console.error=(...args)=>warnings.push(args.map(String).join(' '));html=renderToString(computedElement());}finally{console.error=old;}
 assert.match(html,/<strong>Computed HTML<\/strong>/);assert(!html.includes('<script'));assert.match(html,/Repeated/);assert.deepEqual(warnings,[]);console.log(JSON.stringify({html}));process.exit(0);
}
const ssr=JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),format,process.argv[3],'--ssr'],{encoding:'utf8'}));
const{Window}=await import(pathToFileURL(process.argv[3]));let requests=0,opens=0;
const window=new Window({url:'https://computed.example.invalid/',settings:{fetch:{interceptor:{beforeAsyncRequest(){requests++;throw Error('Unexpected request');},beforeSyncRequest(){requests++;throw Error('Unexpected request');}}}}});
const globals={window,document:window.document,navigator:window.navigator,Node:window.Node,Element:window.Element,HTMLElement:window.HTMLElement,HTMLInputElement:window.HTMLInputElement,MutationObserver:window.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true};
const saved=Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);for(const[key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
const errors=[],warnings=[],old=console.error;let root;
try{
 window.open=()=>{opens++;return null;};console.error=(...args)=>warnings.push(args.map(String).join(' '));
 const host=document.createElement('main');document.body.append(host);host.innerHTML=ssr.html;const{hydrateRoot}=await import('react-dom/client');
 await React.act(async()=>{root=hydrateRoot(host,computedElement(),{onRecoverableError:error=>errors.push(String(error))});});
 assert.equal(host.querySelector('#lookup').textContent,'RepeatedRepeatedfalse0');assert.equal(host.querySelector('#rollup').textContent,'0, false');assert.equal(host.querySelector('strong').textContent,'Computed HTML');assert.equal(host.querySelector('script'),null);assert.equal(host.querySelector('#neighbor').value,'Preserved draft');
 const single=display=>h(api.ComputedField,{...base,kind:'formula',display});
 await React.act(async()=>root.render(single({mode:'controlled',isValid:false,language:'en'})));assert.match(host.textContent,/invalid value/);
 await React.act(async()=>root.render(single({mode:'controlled',isValid:true,language:'en',resultType:'singleLineText',value:null,formattedValue:null})));assert.match(host.textContent,/No Value/);
 await React.act(async()=>root.render(single(projectedFormula.display)));assert.equal(host.querySelector('strong').textContent,'Computed HTML');
 await React.act(async()=>{current=false;for(const listener of [...listeners])listener();});await React.act(async()=>root.render(single(projectedFormula.display)));assert.match(host.textContent,/Unavailable/);
 current=true;await React.act(async()=>root.render(single(projectedFormula.display)));assert.match(host.textContent,/Unavailable/);
 assert.equal(requests,0);assert.equal(opens,0);assert.deepEqual(errors,[]);assert.deepEqual(warnings,[]);assert.deepEqual(canonical,['Repeated',null,'Repeated',false,0]);
 await React.act(async()=>root.unmount());root=undefined;assert.equal(listeners.size,0);console.log(JSON.stringify({react:React.version,format,ssr:true,hydration:true,stickyRetirement:true,orderedOccurrences:4,errors:0,warnings:0,requests,cleanup:'completed'}));
}finally{try{if(root)await React.act(async()=>root.unmount());}finally{console.error=old;for(const[key,descriptor]of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);await window.happyDOM.close();}}
`;

export function checkComputedReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    const archive = resolve(archivePath),
        archiveSha256 = sha(readFileSync(archive));
    const profiles = [];
    for (const version of ['18.3.1', '19.2.0']) {
        const directory = mkdtempSync(join(tmpdir(), 'sdk-computed-consumer-'));
        const run = (command, args) =>
            execPackageFileSync(command, args, {
                cwd: directory,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'inherit'],
                timeout: 120000,
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
            writeFileSync(join(directory, 'runtime.mjs'), computedRuntime);
            for (const [extension, module, resolution] of [
                ['mts', 'NodeNext', 'NodeNext'],
                ['cts', 'NodeNext', 'NodeNext'],
                ['ts', 'ESNext', 'Bundler'],
            ]) {
                const name = `consumer.${extension}`;
                writeFileSync(join(directory, name), computedTypedConsumer);
                run(process.execPath, [
                    typescriptBin,
                    '--noEmit',
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--target',
                    'ES2022',
                    '--module',
                    module,
                    '--moduleResolution',
                    resolution,
                    name,
                ]);
            }
            const require = createRequire(join(directory, 'package.json'));
            const css = readFileSync(
                require.resolve('@miniextensions/sdk/react/computed.css')
            );
            assert.match(css.toString(), /@import '\.\/lookup\.css'/);
            assert(
                css.equals(
                    readFileSync(
                        join(
                            directory,
                            'node_modules/@miniextensions/sdk/dist/cjs/react/computed.css'
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
                const entry =
                    format === 'esm'
                        ? "import {ComputedField}from'@miniextensions/sdk/react';import '@miniextensions/sdk/react/computed.css';console.log(ComputedField);"
                        : "const{ComputedField}=require('@miniextensions/sdk/react');require('@miniextensions/sdk/react/computed.css');console.log(ComputedField);";
                writeFileSync(join(directory, `browser-${format}.js`), entry);
                run(process.execPath, [
                    '--input-type=module',
                    '-e',
                    "import{createRequire}from'node:module';const require=createRequire(import.meta.url);const{buildSync}=require(process.argv[1]);const r=buildSync({entryPoints:[process.argv[2]],bundle:true,platform:'browser',format:'iife',outdir:'out',write:false,logLevel:'silent'});if(!r.outputFiles.some(f=>f.path.endsWith('.css')))throw Error('Missing computed CSS');",
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
