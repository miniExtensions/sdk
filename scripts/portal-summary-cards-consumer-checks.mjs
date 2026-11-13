import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    cpSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const typed = String.raw`
import {createElement} from 'react';
import {projectPortalSummaryFields,type PortalSummaryFieldsProjectionInput} from '@miniextensions/sdk/portals';
import {PortalSummaryCards,type PortalSummaryCard,type PortalSummaryCardsProps,type PortalSummaryFieldsHeight} from '@miniextensions/sdk/react';
const input:PortalSummaryFieldsProjectionInput={summaryFieldIds:['a','deleted','a'],fieldIdsToSchemas:{a:{airtableField:{name:'Current name'}}}};
const cards:readonly PortalSummaryCard[]=projectPortalSummaryFields(input).map(field=>({...field,readable:'0.00'}));
const height:PortalSummaryFieldsHeight='extra tall';
const props:PortalSummaryCardsProps={cards,height,hideTitles:true,decorateCard:(card,content)=>createElement('section',{'data-host-field':card.fieldId},content)};
createElement(PortalSummaryCards,props);createElement(PortalSummaryCards,{cards});
// @ts-expect-error text DTOs are readonly
cards[0]!.readable='Replacement';
// @ts-expect-error collections are readonly
props.cards.push({fieldId:'x',fieldName:'X',readable:''});
// @ts-expect-error raw values must be formatted before rendering
const rawText:PortalSummaryCard['readable']=false;
// @ts-expect-error no read authority enters the presenter
const reader:PortalSummaryCardsProps={cards,fetchRecord(){return Promise.resolve({});}};
void rawText;void reader;
`;

const runtime = String.raw`
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
const require=createRequire(import.meta.url),format=process.argv[2];
assert.equal(typeof window,'undefined');assert.equal(typeof document,'undefined');
const ui=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
const portals=format==='esm'?await import('@miniextensions/sdk/portals'):require('@miniextensions/sdk/portals');
const formulas=format==='esm'?await import('@miniextensions/sdk/formulas'):require('@miniextensions/sdk/formulas');
const css=readFileSync(require.resolve('@miniextensions/sdk/react/portal-summary-cards.css'),'utf8');
const schema=Object.freeze({zero:Object.freeze({airtableField:Object.freeze({name:'Zero',config:{type:'number',options:{precision:2}}})}),unchecked:Object.freeze({airtableField:Object.freeze({name:'Unchecked',config:{type:'checkbox'}})}),blank:Object.freeze({airtableField:Object.freeze({name:'Blank',config:{type:'singleLineText'}})}),nil:Object.freeze({airtableField:Object.freeze({name:'Null',config:{type:'singleLineText'}})})});
const values=Object.freeze({zero:0,unchecked:false,blank:'   ',nil:null});
const projection=portals.projectPortalSummaryFields({summaryFieldIds:Object.freeze(['zero','unchecked','deleted','zero','blank','nil']),fieldIdsToSchemas:schema});
assert.deepEqual(projection.map(field=>field.fieldId),['zero','unchecked','blank','nil']);
const initialCards=Object.freeze(projection.map(field=>Object.freeze({...field,readable:formulas.getReadableStringFromAirtableValue({fieldName:field.fieldName,airtableFieldConfig:schema[field.fieldId].airtableField.config,value:values[field.fieldId],source:{type:'airtableMock',linkedTableStates:{},dateParsing:'local'}})})));
assert.deepEqual(initialCards.map(card=>card.readable),['0.00','','   ','']);
let cards=initialCards,height,hideTitles,decorateCard;
const element=()=>React.createElement(React.StrictMode,null,React.createElement(ui.PortalSummaryCards,{cards,height,hideTitles,decorateCard}));
const {renderToString}=await import('react-dom/server');
const html=renderToString(element());assert.match(html,/^<dl/);assert.match(html,/title="0.00"/);
assert.equal(renderToString(React.createElement(ui.PortalSummaryCards,{cards:[]})),'');
const {Window}=require(process.argv[3]);let networks=0,submits=0;
const rejectRequest=()=>{networks++;throw new Error('Unexpected PortalSummaryCards network request');};
const domWindow=new Window({url:'https://consumer.invalid/portal',settings:{fetch:{interceptor:{beforeAsyncRequest:rejectRequest,beforeSyncRequest:rejectRequest}}}});
const globalValues={window:domWindow,document:domWindow.document,navigator:domWindow.navigator,HTMLElement:domWindow.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,fetch:rejectRequest};
const originals=Object.keys(globalValues).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
for(const[key,value]of Object.entries(globalValues))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
const style=domWindow.document.createElement('style');style.textContent=css;domWindow.document.head.append(style);
const container=domWindow.document.createElement('form');domWindow.document.body.append(container);container.innerHTML=html;
container.addEventListener('submit',event=>{submits++;event.preventDefault();});
const original=container.firstChild,errors=[];const {hydrateRoot,createRoot}=await import('react-dom/client');let root;
try {
 await React.act(async()=>{root=hydrateRoot(container,element(),{onRecoverableError:error=>errors.push(error.message)});});
 assert.deepEqual(errors,[]);assert.equal(container.firstChild,original);
 const list=container.querySelector('dl');assert(list);assert.equal(list.dataset.height,'short');
 const initialSlots=Array.from(list.children),initialValues=Array.from(list.querySelectorAll('dd'));
 assert.deepEqual(initialValues.map(value=>value.textContent),['0.00','','   ','']);
 assert.deepEqual(initialValues.map(value=>value.getAttribute('title')),['0.00','','   ','']);
 assert.equal(list.querySelectorAll('dt').length,4);
 const slotStyle=domWindow.getComputedStyle(initialSlots[0]);assert.equal(slotStyle.width,'320px');assert.match(slotStyle.minWidth,/^0(?:px)?$/);assert.equal(slotStyle.margin,'8px');assert.equal(slotStyle.maxWidth,'calc(100% - 16px)');
 for(const currentHeight of ['short','medium','tall','extra tall']){
  height=currentHeight;
  for(const hidden of [false,true]){
   hideTitles=hidden;await React.act(async()=>root.render(element()));
   assert.equal(container.querySelector('dl').dataset.height,currentHeight);assert.equal(container.querySelectorAll('dt').length,hidden?0:4);
   assert.deepEqual(Array.from(container.querySelectorAll('dd')).map(value=>value.textContent),['0.00','','   ','']);
  }
 }
 hideTitles=false;cards=[initialCards[1],{...initialCards[0],fieldName:'Renamed zero',readable:'12.50'}];await React.act(async()=>root.render(element()));
 assert.deepEqual(Array.from(container.querySelectorAll('dt')).map(title=>title.textContent),['Unchecked','Renamed zero']);
 assert.equal(container.querySelectorAll('dd')[1],initialValues[0]);assert.equal(initialValues[0].textContent,'12.50');assert.equal(container.querySelectorAll('dl > div')[0],initialSlots[1]);
 cards=[];await React.act(async()=>root.render(element()));assert.equal(container.childElementCount,0);
 const privateText='<script>private()</script> & "quote"';cards=[{fieldId:'other-parent',fieldName:'<img src=x onerror=private()>',readable:privateText}];
 await React.act(async()=>root.render(element()));assert.equal(container.querySelector('dt').textContent,cards[0].fieldName);assert.equal(container.querySelector('dd').textContent,privateText);assert.equal(container.querySelector('dd').getAttribute('title'),privateText);assert.equal(container.querySelector('script,img'),null);assert(!container.textContent.includes('Renamed zero'));
 const completeMarkup=container.querySelector('.mx-sdk-portal-summary-card').outerHTML;
 decorateCard=(card,content)=>React.createElement('section',{'data-host-field':card.fieldId},content);
 await React.act(async()=>root.render(element()));assert.equal(container.querySelector('section').dataset.hostField,'other-parent');assert.equal(container.querySelector('.mx-sdk-portal-summary-card').outerHTML,completeMarkup);assert.equal(container.querySelector('dt').nextElementSibling.tagName,'DD');
 await React.act(async()=>root.unmount());root=undefined;
 await React.act(async()=>{root=createRoot(container);root.render(element());});assert.equal(container.querySelector('dd').textContent,privateText);
 assert.equal(container.querySelectorAll('button,input,a,iframe').length,0);
 await React.act(async()=>root.unmount());root=undefined;
 assert.equal(domWindow.location.href,'https://consumer.invalid/portal');assert.equal(networks,0);assert.equal(submits,0);assert.equal(domWindow.localStorage.length,0);assert.equal(domWindow.sessionStorage.length,0);assert.equal(domWindow.document.cookie,'');
 console.log(JSON.stringify({format,react:React.version,hydrationErrors:errors.length,networkRequests:networks,submits,heights:4,plainText:true,computedStyles:true}));
} finally {
 if(root)await React.act(async()=>root.unmount());
 for(const[key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
 await domWindow.happyDOM.close();
}
`;

const browserBundles = String.raw`
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{buildSync}=require(process.argv[1]);
for(const format of ['esm','cjs']){
 const contents=format==='esm'?"import{PortalSummaryCards}from'@miniextensions/sdk/react';import{projectPortalSummaryFields}from'@miniextensions/sdk/portals';import'@miniextensions/sdk/react/portal-summary-cards.css';console.log(PortalSummaryCards,projectPortalSummaryFields)":"require('@miniextensions/sdk/react/portal-summary-cards.css');console.log(require('@miniextensions/sdk/react').PortalSummaryCards,require('@miniextensions/sdk/portals').projectPortalSummaryFields)";
 const result=buildSync({stdin:{contents,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',outdir:'browser-output',write:false,logLevel:'silent'});
 assert(result.outputFiles.some(file=>file.path.endsWith('.js')));const css=result.outputFiles.find(file=>file.path.endsWith('.css'));assert(css);assert(css.text.includes('.mx-sdk-portal-summary-cards'));
}
buildSync({entryPoints:['example/main.ts'],bundle:true,platform:'browser',format:'esm',outdir:'example-output',write:false,logLevel:'silent'});
`;

const browserFixture = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {PortalSummaryCards} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/portal-summary-cards.css';
let root=createRoot(document.querySelector('#summary-owner'));
window.fixtureReactVersion=React.version;
window.renderSummary=(cards,height,hideTitles,decorate=false)=>flushSync(()=>root.render(React.createElement(React.StrictMode,null,React.createElement(PortalSummaryCards,{cards,height,hideTitles,decorateCard:decorate?(card,content)=>React.createElement('section',{'data-host-field':card.fieldId},content):undefined}))));
window.remountSummary=()=>{flushSync(()=>root.unmount());root=createRoot(document.querySelector('#summary-owner'));};
window.summaryLongText='A long parent summary value with spaces for wrapping. '.repeat(30);
window.renderSummary([{fieldId:'long',fieldName:'A long summary field title that needs to truncate at a narrow mobile width',readable:window.summaryLongText},{fieldId:'zero',fieldName:'Zero',readable:'0.00'},{fieldId:'blank',fieldName:'Blank',readable:''}]);
`;

const localhostBrowser = String.raw`
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url),{buildSync}=require(process.argv[2]),{chromium}=require(process.argv[3]);
const executablePath=process.argv[4],expectedReact=process.argv[5],proofDirectory=process.argv[6];
mkdirSync('browser-proof',{recursive:true});
buildSync({entryPoints:['browser-fixture.mjs'],bundle:true,platform:'browser',format:'iife',outfile:'browser-proof/app.js',define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
writeFileSync('browser-proof/index.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><style>body{margin:0;padding:16px;font-family:Arial,sans-serif}</style><script defer src="/app.js"></script></head><body><main id="summary-owner"></main></body></html>');
const allowed=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/app.css','app.css']]),unexpectedPaths=[];
const server=createServer((request,response)=>{const path=new URL(request.url,'http://127.0.0.1').pathname,file=allowed.get(path);if(request.method!=='GET'||!file){unexpectedPaths.push(path);response.writeHead(404);response.end();return;}response.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html');response.end(readFileSync(resolve('browser-proof',file)));});
let browser;
try {
 await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1100,height:800}}),externalRequests=[],pageErrors=[];let documentRequests=0;
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin){externalRequests.push(request.url());await route.abort();return;}if(request.isNavigationRequest())documentRequests++;await route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>pageErrors.push(error.message));
 await page.goto(origin+'/',{waitUntil:'networkidle'});await page.waitForFunction(()=>typeof window.renderSummary==='function');assert.equal(await page.evaluate(()=>window.fixtureReactVersion),expectedReact);
 const desktop=await page.evaluate(()=>Array.from(document.querySelectorAll('.mx-sdk-portal-summary-slot')).map(element=>({width:element.getBoundingClientRect().width,top:element.getBoundingClientRect().top})));
 assert.equal(desktop.length,3);assert(desktop.every(slot=>slot.width===320));assert(desktop.every(slot=>slot.top===desktop[0].top));
 if(proofDirectory){mkdirSync(proofDirectory,{recursive:true});await page.screenshot({path:resolve(proofDirectory,'portal-summary-react'+expectedReact+'-desktop.png'),fullPage:true});}
 const heights=[];
 for(const[height,lines]of [['short',1],['medium',2],['tall',3],['extra tall',4]]){
  const observation=await page.evaluate(({height})=>{window.renderSummary([{fieldId:'long',fieldName:'Current label',readable:window.summaryLongText}],height);const value=document.querySelector('dd'),title=document.querySelector('dt'),style=getComputedStyle(value);return {height:value.clientHeight,scrollHeight:value.scrollHeight,clamp:style.webkitLineClamp,tooltip:value.title,full:window.summaryLongText,titleSibling:title.nextElementSibling.tagName};},{height});
  assert.equal(observation.clamp,String(lines));assert.equal(observation.height,28*lines);assert(observation.scrollHeight>observation.height);assert.equal(observation.tooltip,observation.full);assert.equal(observation.titleSibling,'DD');heights.push({height,lines,pixels:observation.height});
 }
 await page.setViewportSize({width:240,height:700});
 const mobile=await page.evaluate(()=>{window.renderSummary([{fieldId:'long',fieldName:'Long title for truncation at mobile width',readable:window.summaryLongText},{fieldId:'zero',fieldName:'Zero',readable:'0.00'}],'medium');const slots=Array.from(document.querySelectorAll('.mx-sdk-portal-summary-slot')),title=document.querySelector('dt');return {pageWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,slots:slots.map(element=>({left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right,top:element.getBoundingClientRect().top})),titleStyle:{overflow:getComputedStyle(title).overflow,ellipsis:getComputedStyle(title).textOverflow,whiteSpace:getComputedStyle(title).whiteSpace},titleClipped:title.scrollWidth>title.clientWidth};});
 assert.equal(mobile.scrollWidth,mobile.pageWidth);assert(mobile.slots.every(slot=>slot.left>=0&&slot.right<=mobile.pageWidth));assert(mobile.slots[1].top>mobile.slots[0].top);assert.equal(mobile.titleClipped,true);assert.deepEqual(mobile.titleStyle,{overflow:'hidden',ellipsis:'ellipsis',whiteSpace:'nowrap'});
 if(proofDirectory)await page.screenshot({path:resolve(proofDirectory,'portal-summary-react'+expectedReact+'-mobile.png'),fullPage:true});
 await page.evaluate(()=>window.renderSummary([{fieldId:'long',fieldName:'Hidden title',readable:'0.00'}],'short',true));assert.equal(await page.locator('dt').count(),0);assert.equal(await page.locator('dd').textContent(),'0.00');
 await page.evaluate(()=>window.renderSummary([],undefined,false));assert.equal(await page.locator('dl').count(),0);
 await page.evaluate(()=>{window.remountSummary();window.renderSummary([{fieldId:'new-parent',fieldName:'<img src=x onerror=private()>',readable:'<script>private()</script> & "quoted"'}],'short',false,true);});
 assert.equal(await page.locator('dt').textContent(),'<img src=x onerror=private()>');assert.equal(await page.locator('dd').textContent(),'<script>private()</script> & "quoted"');assert.equal(await page.locator('dd').getAttribute('title'),'<script>private()</script> & "quoted"');assert.equal(await page.locator('#summary-owner script,#summary-owner img').count(),0);assert.equal(await page.locator('[data-host-field]').getAttribute('data-host-field'),'new-parent');
 assert.equal(await page.locator('#summary-owner button,#summary-owner input,#summary-owner a').count(),0);
 assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length,cookies:document.cookie,href:location.href})),{local:0,session:0,cookies:'',href:origin+'/'});
 assert.deepEqual(pageErrors,[]);assert.deepEqual(externalRequests,[]);assert.deepEqual(unexpectedPaths,[]);assert.equal(documentRequests,1);
 console.log(JSON.stringify({react:expectedReact,chromium:browser.version(),heights,mobileClipping:true,desktopColumns:3,documentRequests,pageErrors:pageErrors.length,externalRequests:externalRequests.length,computedStyles:true}));
} finally {if(browser)await browser.close();if(server.listening)await new Promise((accept,reject)=>server.close(error=>error?reject(error):accept()));}
`;

/** Qualify the actual SDK archive and public standalone consumer. */
export function checkPortalSummaryCardsReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
    playwrightModulePath,
    chromiumExecutablePath = process.env.SDK_PORTAL_SUMMARY_CHROMIUM ||
        '/usr/bin/chromium',
    proofDirectory = process.env.SDK_PORTAL_SUMMARY_PROOF_DIR,
}) {
    assert(archivePath, 'Provide an existing SDK package archive');
    const archive = resolve(archivePath);
    const directory = mkdtempSync(join(tmpdir(), 'sdk-portal-summary-cards-'));
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
                dependencies: { '@miniextensions/sdk': `file:${archive}` },
            })
        );
        writeFileSync(join(directory, 'runtime.mjs'), runtime);
        if (playwrightModulePath) {
            writeFileSync(
                join(directory, 'browser-fixture.mjs'),
                browserFixture
            );
            writeFileSync(
                join(directory, 'localhost-browser.mjs'),
                localhostBrowser
            );
        }
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
                `react@${version.react}`,
                `react-dom@${version.react}`,
                `@types/react@${version.types}`,
                `@types/react-dom@${version.domTypes}`,
            ]);
            const installed = join(
                directory,
                'node_modules/@miniextensions/sdk'
            );
            for (const extension of ['mts', 'cts']) {
                const file = `summary.${extension}`;
                writeFileSync(join(directory, file), typed);
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
            cpSync(
                join(installed, 'examples/react-portal-summary-cards'),
                join(directory, 'example'),
                { recursive: true }
            );
            run(process.execPath, [
                typescriptBin,
                '--project',
                'example/tsconfig.json',
            ]);
            const css = readFileSync(
                join(installed, 'dist/esm/react/portal-summary-cards.css')
            );
            assert(css.length > 0);
            assert(
                css.equals(
                    readFileSync(
                        join(
                            installed,
                            'dist/cjs/react/portal-summary-cards.css'
                        )
                    )
                ),
                'ESM and CJS must distribute identical summary styles'
            );
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
                assert.equal(result.submits, 0);
                assert.equal(result.heights, 4);
                assert.equal(result.plainText, true);
                formats.push(result);
            }
            run(process.execPath, [
                '--input-type=module',
                '-e',
                browserBundles,
                esbuildModulePath,
            ]);
            let localhost;
            if (playwrightModulePath) {
                localhost = JSON.parse(
                    run(
                        process.execPath,
                        [
                            'localhost-browser.mjs',
                            esbuildModulePath,
                            playwrightModulePath,
                            chromiumExecutablePath,
                            version.react,
                            proofDirectory ? resolve(proofDirectory) : '',
                        ],
                        {
                            encoding: 'utf8',
                            stdio: ['ignore', 'pipe', 'inherit'],
                        }
                    )
                );
                assert.equal(localhost.react, version.react);
                assert.equal(localhost.pageErrors, 0);
                assert.equal(localhost.externalRequests, 0);
                assert.equal(localhost.mobileClipping, true);
                assert.equal(localhost.heights.length, 4);
            }
            versions.push({
                react: version.react,
                formats,
                ...(localhost ? { localhost } : {}),
            });
            console.log(
                `Installed PortalSummaryCards React ${version.react}: ESM/CJS/types/CSS/browser bundles/standalone example/SSR/hydration/order/replacement/plain text passed; no network or saves.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

if (
    process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
    assert(
        process.argv[2],
        'Usage: node scripts/portal-summary-cards-consumer-checks.mjs <existing-sdk.tgz>'
    );
    const require = createRequire(import.meta.url);
    console.log(
        JSON.stringify(
            checkPortalSummaryCardsReactMatrix({
                archivePath: process.argv[2],
                typescriptBin: require.resolve('typescript/bin/tsc'),
                happyDomModulePath: require.resolve('happy-dom'),
                esbuildModulePath: require.resolve('esbuild'),
                playwrightModulePath: require.resolve('playwright'),
            })
        )
    );
}
