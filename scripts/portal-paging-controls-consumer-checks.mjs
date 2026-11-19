import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgeQualifiedConsumerInstall } from './age-qualified-consumer-install.mjs';
import { portalPagingControlsFixture } from './portal-paging-controls-fixture.mjs';
import { readonlyPortalListFixture } from './readonly-portal-list-fixture.mjs';

const typed = String.raw`
import {createElement} from 'react';
import {
 PortalPagingControls,
 type PortalPagingControlsProps,
 type PortalPagingIntent,
 type PortalPagingOffer,
} from '@miniextensions/sdk/react';
const intents:PortalPagingIntent[]=[];
const offer:PortalPagingOffer={activate(intent,isCurrent){if(isCurrent())intents.push(intent);}};
const props:PortalPagingControlsProps={state:{type:'ready',hasNextPage:true},offer,labels:{retry:'Reintentar'}};
createElement(PortalPagingControls,props);
createElement(PortalPagingControls,{state:{type:'next-error',message:'Unavailable'},offer});
createElement(PortalPagingControls,{state:{type:'configuration-error',message:'Invalid view'}});
// @ts-expect-error a cursor remains with the consumer's query owner
const cursor:PortalPagingControlsProps={state:{type:'ready',hasNextPage:true,cursor:'page_2'}};
// @ts-expect-error the control receives an intent handler, not a transport
const transport:PortalPagingControlsProps={...props,fetchRecords(){}};
void [cursor,transport];
`;

const installedProgram = String.raw`
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createPagingFixture} from './paging-fixture.mjs';

const require=createRequire(import.meta.url);
const [format,happyDomModulePath]=process.argv.slice(2);
const React=format==='esm'?await import('react'):require('react');
const api=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
const ui=format==='esm'?await import('@miniextensions/sdk/ui'):require('@miniextensions/sdk/ui');
const {renderToString}=format==='esm'?await import('react-dom/server'):require('react-dom/server');
assert.equal(typeof api.PortalPagingControls,'function','Missing public Portal paging controls');
const layout=format==='esm'?'list':'grid';
let fixture=createPagingFixture({React,api,ui,layout});
const html=renderToString(fixture.element());
assert.match(html,/First/);
assert.match(html,/Más registros/);
assert.doesNotMatch(html,/Second|Reintentar/);
const {Window}=await import(happyDomModulePath);
const window=new Window({url:'https://consumer.invalid/portal'});
const globals={window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
const originalGlobals=new Map();
for(const [key,value] of Object.entries(globals)){
 originalGlobals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
 Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
}
let root;
let browserRequests=0;
let formSubmits=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=()=>{browserRequests++;throw new Error('Unexpected paging transport');};
try {
 const container=window.document.createElement('form');
 window.document.body.append(container);
 container.innerHTML=html;
 container.addEventListener('submit',event=>{formSubmits++;event.preventDefault();});
 const errors=[];
 const {hydrateRoot}=format==='esm'?await import('react-dom/client'):require('react-dom/client');
 const hydrate=async(paging)=>{
  await React.act(async()=>{
   root=hydrateRoot(container,paging.element(),{onRecoverableError(error){errors.push(error);}});
  });
  paging.connect(()=>root.render(paging.element()));
 };
 const unmount=async(paging)=>{
  await React.act(async()=>root.unmount());
  root=undefined;
  assert.equal(paging.presenterSubscriptions,0);
  assert.equal(paging.records.subscriptions,1);
  paging.records.scope.destroy();
  assert.equal(paging.records.subscriptions,0);
 };
 await hydrate(fixture);
 const button=()=>container.querySelector('button');
 const text=()=>container.textContent;
 const click=target=>target.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true}));
 assert.equal(errors.length,0);
 assert.deepEqual(fixture.requests,[]);
 assert.equal(button().textContent,fixture.labels.loadMore);
 assert.equal(button().type,'button');
 const initial=button();
 await React.act(async()=>{click(initial);click(initial);});
 assert.deepEqual(fixture.activations,['next-page']);
 assert.deepEqual(fixture.requests,[{intent:'next-page',offset:'page_2'}]);
 assert.equal(button().disabled,true);
 assert.match(text(),/First/);

 await React.act(async()=>fixture.fail());
 assert.deepEqual(fixture.requests,[{intent:'next-page',offset:'page_2'}]);
 assert.match(text(),/First/);
 assert.match(text(),/Next page unavailable/);
 assert.equal(button().textContent,fixture.labels.retry);
 assert.equal(button().disabled,false);
 await React.act(async()=>click(button()));
 assert.deepEqual(fixture.requests,[
  {intent:'next-page',offset:'page_2'},
  {intent:'retry-next-page',offset:'page_2'},
 ]);
 assert.doesNotMatch(text(),/Next page unavailable/);
 assert.match(text(),/First/);
 await React.act(async()=>fixture.succeed());
 assert.match(text(),/First.*Second/);
 assert.equal(button(),null);

 await React.act(async()=>fixture.firstFailure());
 assert.doesNotMatch(text(),/First\b.*Second/);
 assert.match(text(),/First page unavailable/);
 assert.equal(button().textContent,fixture.labels.retry);
 await React.act(async()=>click(button()));
 assert.deepEqual(fixture.requests.at(-1),{intent:'retry-first-page',offset:null});
 assert.equal(button(),null);
 await React.act(async()=>fixture.configurationError());
 assert.match(text(),/View is unavailable/);
 assert.equal(button(),null);
 assert.equal(fixture.guard()(),false);
 await React.act(async()=>fixture.retire());
 assert.equal(button(),null);
 assert.equal(fixture.guard()(),false);
 assert.equal(fixture.requests.length,3);
 const postedReads=fixture.requests;
 await unmount(fixture);

 fixture=createPagingFixture({React,api,ui,layout,emptyAcceptedPage:true});
 container.innerHTML=renderToString(fixture.element());
 assert.doesNotMatch(text(),/First|Second/);
 assert.equal(button().textContent,fixture.labels.loadMore);
 await hydrate(fixture);
 assert.equal(errors.length,0);
 assert.doesNotMatch(text(),/First|Second/);
 assert.equal(button().disabled,false);
 assert.deepEqual(fixture.activations,[]);
 assert.deepEqual(fixture.requests,[]);
 await React.act(async()=>click(button()));
 assert.deepEqual(fixture.activations,['next-page']);
 assert.deepEqual(fixture.requests,[{intent:'next-page',offset:'after_empty_page'}]);
 const pendingButton=button();
 assert.ok(pendingButton);
 assert.equal(pendingButton.hidden,false);
 assert.notEqual(window.getComputedStyle(pendingButton).display,'none');
 assert.equal(pendingButton.textContent,fixture.labels.loadMore);
 assert.equal(pendingButton.disabled,true);
 assert.equal(pendingButton.getAttribute('aria-busy'),'true');
 assert.doesNotMatch(text(),/First|Second/);
 await React.act(async()=>fixture.succeed());
 assert.deepEqual(text().match(/Second/g),['Second']);
 assert.doesNotMatch(text(),/First/);
 assert.equal(button(),null);
 assert.equal(fixture.requests.length,1);
 assert.equal(browserRequests,0);
 assert.equal(formSubmits,0);
 const emptyContinuationReads=fixture.requests;
 await unmount(fixture);
 console.log(JSON.stringify({format,react:React.version,cases:9,postedReads,emptyContinuationReads,hydrationErrors:errors.length,formSubmits,browserRequests}));
} finally {
 if(root) await React.act(async()=>root.unmount());
 fixture.records.scope.destroy();
 globalThis.fetch=originalFetch;
 for(const [key,value] of originalGlobals){
  if(value) Object.defineProperty(globalThis,key,value);
  else Reflect.deleteProperty(globalThis,key);
 }
 await window.happyDOM.close();
}
`;

/** Invoke only on the installed distribution, with real React 18 and 19 consumers. */
export function checkPortalPagingControlsReactMatrix({
    archivePath,
    happyDomModulePath,
    typescriptBin,
}) {
    const directory = mkdtempSync(
        join(tmpdir(), 'sdk-portal-paging-consumer-')
    );
    const results = [];
    const run = (command, args) =>
        execFileSync(command, args, {
            cwd: directory,
            encoding: 'utf8',
            timeout: 120_000,
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
            join(directory, 'list-fixture.mjs'),
            readonlyPortalListFixture
        );
        writeFileSync(
            join(directory, 'paging-fixture.mjs'),
            portalPagingControlsFixture
        );
        writeFileSync(join(directory, 'runtime.mjs'), installedProgram);
        for (const { react, types, domTypes } of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            runAgeQualifiedConsumerInstall(run, [
                'install',
                '--no-audit',
                '--no-fund',
                '--ignore-scripts',
                '--save-exact',
                `react@${react}`,
                `react-dom@${react}`,
                `@types/react@${types}`,
                `@types/react-dom@${domTypes}`,
            ]);
            for (const format of ['esm', 'cjs']) {
                const entry =
                    format === 'esm' ? 'consumer.mts' : 'consumer.cts';
                writeFileSync(join(directory, entry), typed);
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
                    entry,
                ]);
                const result = JSON.parse(
                    run(process.execPath, [
                        'runtime.mjs',
                        format,
                        happyDomModulePath,
                    ]).trim()
                );
                assert.equal(result.react, react);
                assert.equal(result.format, format);
                results.push(result);
            }
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
    return { results, cleanup: 'completed' };
}
