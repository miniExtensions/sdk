import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgeQualifiedConsumerInstall } from './age-qualified-consumer-install.mjs';
import { readonlyPortalListFixture } from './readonly-portal-list-fixture.mjs';
import { readonlyPortalRecordsConsumer } from './readonly-portal-records-consumer.mjs';

const typed = String.raw`
import {createElement} from 'react';
import {ReadonlyPortalList,AirtableList,ReadonlyPortalRecords,type ReadonlyPortalListProps,type ReadonlyPortalListOpenAction,type ReadonlyPortalRecordsProps,type ReadonlyPortalRecordsGridOptions} from '@miniextensions/sdk/react';
import type {BorrowedPortalRenderScope} from '@miniextensions/sdk/ui';
declare const scope:BorrowedPortalRenderScope;
const action:ReadonlyPortalListOpenAction={revision:1,activate(isCurrent,returnFocus){if(isCurrent())returnFocus();}};
const actions:ReadonlyMap<string,ReadonlyPortalListOpenAction>=new Map([['rec_B',action]]);
const props:ReadonlyPortalListProps={scope,renderers:{renderSingleLineTextField(field){if(field.capability.type!=='readonly')return null;const readonlyKind:'readonly'=field.capability.type;return String(field.value)+readonlyKind;}},openActions:actions,label:'Records'};
createElement(ReadonlyPortalList,props);
createElement(ReadonlyPortalList,{...props,recordLabel(recordId){return recordId==='rec_B'?'Account South':null;}});
createElement(AirtableList,{scope,renderers:{},children(state){return state.rows.length;}});
// @ts-expect-error the supplied accepted scope is mandatory
createElement(ReadonlyPortalList,{renderers:{}});
// @ts-expect-error the complete presenter owns row markup
const children:ReadonlyPortalListProps={...props,children(){return null;}};
// @ts-expect-error no collection/query owner belongs to this presenter
const transport:ReadonlyPortalListProps={...props,fetchRecords(){}};
// @ts-expect-error no canonical writer belongs to this presenter
const writer:ReadonlyPortalListProps={...props,onSave(){}};
// @ts-expect-error row naming requires a string or null
const invalidRecordLabel:ReadonlyPortalListProps={...props,recordLabel(){return 42;}};
// @ts-expect-error command revision is numeric
const wrongRevision:ReadonlyPortalListOpenAction={revision:'1',activate(){}};
// @ts-expect-error a revision does not itself confer command authority
const noCommand:ReadonlyPortalListOpenAction={revision:1};
// @ts-expect-error the supplied action map is read only
actions.set('rec_A',action);
// @ts-expect-error the older shell retains its mandatory children contract
createElement(AirtableList,{scope,renderers:{}});
const grid:ReadonlyPortalRecordsGridOptions={ready:true,preferenceScopeKey:'view',primaryFieldId:null,hiddenColumns:{},columnWidths:{}};
const records:ReadonlyPortalRecordsProps={scope,grid,layout:'grid',renderers:{},openActions:{scope,byRecordId:actions}};
createElement(ReadonlyPortalRecords,records);
createElement(ReadonlyPortalRecords,{...records,layout:'list',recordLabel(recordId){return recordId==='rec_A'?'Account North':null;},status:{kind:'loading',message:'Loading records'}});
// @ts-expect-error the public composed presenter owns both layouts
const recordLayout:ReadonlyPortalRecordsProps={...records,children(){return null;}};
// @ts-expect-error preferences cannot introduce a host-supplied row or cell
const recordGrid:ReadonlyPortalRecordsGridOptions={...grid,rows:[]};
// @ts-expect-error registration from a different source is never implicit
const recordActions:ReadonlyPortalRecordsProps={...records,openActions:{byRecordId:actions}};
void [children,transport,writer,invalidRecordLabel,wrongRevision,noCommand,recordLayout,recordGrid,recordActions];
`;

const runtime = String.raw`
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createListFixture} from './fixture.mjs';
const require=createRequire(import.meta.url),format=process.argv[2];
const React=format==='esm'?await import('react'):require('react');
const api=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
const ui=format==='esm'?await import('@miniextensions/sdk/ui'):require('@miniextensions/sdk/ui');
const {renderToString}=format==='esm'?await import('react-dom/server'):require('react-dom/server');
const f=createListFixture(ui),h=React.createElement;
const renderers={renderSingleLineTextField(field){assert.equal(field.capability.type,'readonly');return h('span',null,String(field.value??''));}};
let actions;const element=()=>h(React.StrictMode,null,h(api.ReadonlyPortalList,{scope:f.scope,renderers,openActions:actions,label:'Records'}));
const html=renderToString(element());
assert(html.indexOf('Beta')<html.indexOf('B detail'));assert(html.indexOf('B detail')<html.indexOf('Alpha'));assert(!html.includes('<button'));
const {Window}=await import(process.argv[3]),window=new Window({url:'https://consumer.invalid/list'});
const originals=new Map(),globals={window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
for(const [key,value]of Object.entries(globals)){originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
let root,submits=0,requests=0;const errors=[];
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{requests++;throw new Error('Unexpected List transport');};
try{
 const container=window.document.createElement('form');window.document.body.append(container);container.innerHTML=html;container.addEventListener('submit',event=>{submits++;event.preventDefault();});
 const firstRow=container.querySelector('li');const {hydrateRoot}=format==='esm'?await import('react-dom/client'):require('react-dom/client');
 await React.act(async()=>{root=hydrateRoot(container,element(),{onRecoverableError:error=>errors.push(String(error))});});
 assert.equal(container.querySelector('li'),firstRow);assert.equal(errors.length,0);
 let heldGuard,heldFocus;
 function commands(){const snapshot=f.scope.getSnapshot();return new Map(snapshot.rows.map(row=>[row.recordId,{revision:snapshot.revision,activate(isCurrent,restore){heldGuard=isCurrent;heldFocus=restore;if(isCurrent())void snapshot.actions.openChild(row.recordId);}}]));}
 actions=commands();await React.act(async()=>root.render(element()));
 const button=firstRow.querySelector('button');assert.equal(button.type,'button');
 await React.act(async()=>button.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true})));
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].recordId,'rec_B');assert.equal(heldGuard(),true);heldFocus();assert.equal(window.document.activeElement,button);
 await React.act(async()=>{f.replace({...f.initial,records:[...f.initial.records].reverse()});});
 assert.equal(heldGuard(),false);window.document.body.focus();heldFocus();assert.notEqual(window.document.activeElement,button);
 assert.equal(container.querySelectorAll('button').length,0);assert.equal(container.querySelector('li').dataset.recordId,'rec_A');
 actions=undefined;await React.act(async()=>root.render(element()));assert.equal(container.querySelectorAll('button,input').length,0);
 await React.act(async()=>f.replace({...f.initial,records:[]}));assert.deepEqual([...container.querySelectorAll('h3')].map(node=>node.textContent),['Name label','Detail label']);
 await React.act(async()=>{f.scope.destroy();});assert.equal(container.textContent,'');
 await React.act(async()=>root.unmount());root=undefined;
 assert.equal(f.subscriptions,0);assert.equal(submits,0);assert.equal(requests,0);assert.equal(window.document.cookie,'');assert.equal(window.localStorage.length,0);assert.equal(window.sessionStorage.length,0);
 console.log(JSON.stringify({format,react:React.version,hydrationErrors:errors.length,submits,requests,opens:f.calls.length,stableHydration:true,retirement:true,emptyLabels:true}));
}finally{if(root)await React.act(async()=>root.unmount());f.scope.destroy();globalThis.fetch=originalFetch;for(const[key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}await window.happyDOM.close();}
`;

export function checkReadonlyPortalListReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-readonly-list-'));
    const versions = [];
    const run = (command, args, options = {}) =>
        execFileSync(command, args, {
            cwd: directory,
            stdio: 'inherit',
            timeout: 120000,
            ...options,
        });
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                dependencies: { '@miniextensions/sdk': `file:${archivePath}` },
            })
        );
        writeFileSync(
            join(directory, 'fixture.mjs'),
            readonlyPortalListFixture
        );
        writeFileSync(join(directory, 'runtime.mjs'), runtime);
        writeFileSync(
            join(directory, 'records.mjs'),
            readonlyPortalRecordsConsumer
        );
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            runAgeQualifiedConsumerInstall(run, [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
                '--package-lock=false',
                `react@${version.react}`,
                `react-dom@${version.react}`,
                `@types/react@${version.types}`,
                `@types/react-dom@${version.domTypes}`,
            ]);
            for (const extension of ['mts', 'cts']) {
                writeFileSync(join(directory, `consumer.${extension}`), typed);
                run(process.execPath, [
                    typescriptBin,
                    '--noEmit',
                    '--strict',
                    '--exactOptionalPropertyTypes',
                    '--skipLibCheck',
                    'false',
                    '--target',
                    'ES2022',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    `consumer.${extension}`,
                ]);
            }
            const formats = ['esm', 'cjs'].map((format) => {
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
                assert.equal(result.opens, 1);
                const records = JSON.parse(
                    run(
                        process.execPath,
                        ['records.mjs', format, happyDomModulePath],
                        {
                            encoding: 'utf8',
                            stdio: ['ignore', 'pipe', 'inherit'],
                        }
                    )
                );
                assert.equal(records.react, version.react);
                assert.equal(records.subscriptions, 1);
                assert.equal(records.opens, 1);
                return { ...result, records };
            });
            const installed = join(
                directory,
                'node_modules/@miniextensions/sdk'
            );
            const css = readFileSync(
                join(installed, 'dist/esm/react/readonly-portal-list.css')
            );
            assert(
                css.equals(
                    readFileSync(
                        join(
                            installed,
                            'dist/cjs/react/readonly-portal-list.css'
                        )
                    )
                )
            );
            assert(css.includes('.mx-sdk-readonly-portal-list'));
            run(process.execPath, [
                '--input-type=module',
                '-e',
                `
import assert from 'node:assert/strict';import{createRequire}from'node:module';const require=createRequire(import.meta.url);require.resolve('@miniextensions/sdk/react/readonly-portal-list.css');const{buildSync}=require(${JSON.stringify(esbuildModulePath)});for(const format of ['esm','cjs']){const result=buildSync({stdin:{contents:format==='esm'?"import{ReadonlyPortalList}from'@miniextensions/sdk/react';import'@miniextensions/sdk/react/readonly-portal-list.css';console.log(ReadonlyPortalList)":"require('@miniextensions/sdk/react/readonly-portal-list.css');console.log(require('@miniextensions/sdk/react').ReadonlyPortalList)",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',outdir:'browser-output',write:false,logLevel:'silent'});assert(result.outputFiles.some(file=>file.path.endsWith('.css')&&file.text.includes('.mx-sdk-readonly-portal-list')));}
`,
            ]);
            versions.push({ react: version.react, formats });
        }
        const ageReceipts = JSON.parse(
            readFileSync(
                join(directory, 'consumer-age-install-receipts.json'),
                'utf8'
            )
        );
        return {
            archiveSHA256: createHash('sha256')
                .update(readFileSync(archivePath))
                .digest('hex'),
            ageReceipts,
            versions,
            cleanup: 'completed',
        };
    } finally {
        rmSync(directory, { recursive: true });
    }
}
