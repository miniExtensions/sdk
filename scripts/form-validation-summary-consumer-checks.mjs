import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const typed = String.raw`
import {createElement} from 'react';
import {FormValidationSummary,type FormValidationDiagnostic,type FormValidationSummaryProps} from '@miniextensions/sdk/react';
const diagnostic:FormValidationDiagnostic={fieldId:'fld_hidden',fieldTitle:'Semantic hidden title',errorMessage:'Field is required'};
const diagnostics:readonly FormValidationDiagnostic[]=[diagnostic];
const props:FormValidationSummaryProps={heading:'Please correct the following fields',diagnostics};
createElement(FormValidationSummary,props);
const nativeDiagnostics:{fieldId:string;fieldTitle:string;errorMessage:string}[]=[{...diagnostic}];
createElement(FormValidationSummary,{heading:props.heading,diagnostics:nativeDiagnostics});
// @ts-expect-error public diagnostics are immutable
 diagnostic.fieldTitle='Replacement';
// @ts-expect-error the diagnostic collection is immutable
 props.diagnostics.push(diagnostic);
// @ts-expect-error the SDK owns complete markup, without host renderer slots
const hostRenderer:FormValidationSummaryProps={...props,renderNative(){return null;}};
void hostRenderer;
`;

const runtime = String.raw`
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
const require=createRequire(import.meta.url),format=process.argv[2];
assert.equal(typeof window,'undefined');assert.equal(typeof document,'undefined');
const ui=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
const {renderToString}=await import('react-dom/server');
const css=readFileSync(require.resolve('@miniextensions/sdk/react/form-validation-summary.css'),'utf8');
const fieldId=' fld[raw]:a/b ?#% ';
const originalDiagnostics=Object.freeze([
 Object.freeze({fieldId,fieldTitle:'Hidden semantic title',errorMessage:'Field is required'}),
 Object.freeze({fieldId:'fld_email',fieldTitle:'Email address',errorMessage:'Enter a valid email address'})
]);
let diagnostics=originalDiagnostics,heading='Corrigez les champs suivants';
const element=()=>React.createElement(React.StrictMode,null,React.createElement(ui.FormValidationSummary,{heading,diagnostics}));
const html=renderToString(element());
assert(html.includes('Hidden semantic title'));assert(html.includes('Field is required'));assert(html.includes('role="alert"'));assert(html.includes('role="list"'));
const {Window}=require(process.argv[3]);let networks=0;
const rejectRequest=()=>{networks++;throw new Error('Unexpected FormValidationSummary network request');};
const domWindow=new Window({url:'https://consumer.invalid/form',settings:{fetch:{interceptor:{beforeAsyncRequest:rejectRequest,beforeSyncRequest:rejectRequest}}}});
const values={window:domWindow,document:domWindow.document,navigator:domWindow.navigator,HTMLElement:domWindow.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,fetch:rejectRequest};
const originals=Object.entries(values).map(([key])=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
for(const[key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
const style=domWindow.document.createElement('style');style.textContent=css;domWindow.document.head.append(style);
const container=domWindow.document.createElement('main');domWindow.document.body.append(container);container.innerHTML=html;
const original=container.firstChild,errors=[];const {hydrateRoot}=await import('react-dom/client');let root;
try {
 await React.act(async()=>{root=hydrateRoot(container,element(),{onRecoverableError:error=>errors.push(error.message)});});
 assert.deepEqual(errors,[]);assert.equal(container.firstChild,original);
 const alert=container.querySelector('[role="alert"]');assert(alert);assert.equal(alert.getAttribute('data-testid'),'alert-test-id');
 assert.equal(alert.querySelector('h3').textContent,heading);assert.equal(alert.querySelector('svg').getAttribute('aria-hidden'),'true');
 assert.equal(alert.querySelector('ul').getAttribute('role'),'list');
 const items=Array.from(alert.querySelectorAll('li'));
 assert.deepEqual(items.map(item=>item.textContent),['Hidden semantic title (Field is required)','Email address (Enter a valid email address)']);
 assert.deepEqual(items.map(item=>item.getAttribute('data-testid')),['field-'+fieldId+'-error','field-fld_email-error']);
 assert.deepEqual(items.map(item=>item.querySelector('a').getAttribute('href')),['#'+fieldId,'#fld_email']);
 const computed=element=>domWindow.getComputedStyle(element);
 const color=value=>/^#[0-9a-f]{6}$/i.test(value)?'rgb('+[1,3,5].map(index=>parseInt(value.slice(index,index+2),16)).join(', ')+')':value;
 const alertStyle=computed(alert);
 assert.equal(alertStyle.flex,'1 1 0%');assert.equal(alertStyle.overflow,'auto');assert.match(alertStyle.borderRadius,/^0(?:px)?$/);
 assert.equal(alertStyle.padding,'16px');assert.equal(color(alertStyle.backgroundColor),'rgb(254, 242, 242)');
 const headingStyle=computed(alert.querySelector('h3'));
 assert.equal(color(headingStyle.color),'rgb(153, 27, 27)');assert.equal(headingStyle.fontWeight,'500');assert.equal(headingStyle.fontSize,'14px');assert.equal(headingStyle.lineHeight,'20px');
 const linkStyle=computed(items[0].querySelector('a'));
 // happy-dom preserves the inherit keyword; Chromium below verifies the resolved color.
 assert.equal(linkStyle.color,'inherit');assert.equal(color(computed(alert.querySelector('.mx-sdk-form-validation-summary-errors')).color),'rgb(185, 28, 28)');assert.equal(linkStyle.fontWeight,'500');assert.equal(linkStyle.textDecoration,'underline');
 assert.equal(computed(alert.querySelector('ul')).paddingLeft,'20px');assert.equal(computed(items[1]).marginTop,'4px');
 diagnostics=[originalDiagnostics[1],{...originalDiagnostics[0],fieldTitle:'Updated semantic title',errorMessage:'Use at least two characters'}];heading='Updated heading';
 await React.act(async()=>root.render(element()));
 const reordered=Array.from(container.querySelectorAll('li'));assert.equal(reordered[0],items[1]);assert.equal(reordered[1],items[0]);
 assert.equal(reordered[1].textContent,'Updated semantic title (Use at least two characters)');assert.equal(container.querySelector('h3').textContent,heading);assert(!container.textContent.includes('Field is required'));
 diagnostics=[];await React.act(async()=>root.render(element()));assert.equal(container.childElementCount,0);assert.equal(container.textContent,'');
 diagnostics=[{fieldId:'fld_plain',fieldTitle:'<b>Semantic & title</b>',errorMessage:'<script>private()</script>'}];
 await React.act(async()=>root.render(element()));assert.equal(container.querySelector('li').textContent,'<b>Semantic & title</b> (<script>private()</script>)');assert.equal(container.querySelector('b,script'),null);
 assert.deepEqual(errors,[]);assert.equal(container.querySelectorAll('button,input').length,0);
 await React.act(async()=>root.unmount());root=undefined;
 assert.equal(domWindow.location.href,'https://consumer.invalid/form');assert.equal(networks,0);assert.equal(domWindow.localStorage.length,0);assert.equal(domWindow.sessionStorage.length,0);
 console.log(JSON.stringify({format,react:React.version,hydrationErrors:errors.length,networkRequests:networks,computedStyles:true}));
} finally {
 if(root)await React.act(async()=>root.unmount());
 for(const[key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
 await domWindow.happyDOM.close();
}
`;

const browser = String.raw`
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
require.resolve('@miniextensions/sdk/react/form-validation-summary.css');
const {buildSync}=require(process.argv[1]);
for(const format of ['esm','cjs']){
 const contents=format==='esm'
  ? "import{FormValidationSummary}from'@miniextensions/sdk/react';import'@miniextensions/sdk/react/form-validation-summary.css';console.log(FormValidationSummary)"
  : "require('@miniextensions/sdk/react/form-validation-summary.css');console.log(require('@miniextensions/sdk/react').FormValidationSummary)";
 const result=buildSync({stdin:{contents,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',outdir:'browser-output',write:false,logLevel:'silent'});
 assert(result.outputFiles.some(file=>file.path.endsWith('.js')));
 const css=result.outputFiles.find(file=>file.path.endsWith('.css'));assert(css);assert(css.text.includes('.mx-sdk-form-validation-summary'));
}
`;

const browserFixture = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {FormValidationSummary} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/form-validation-summary.css';
const root=createRoot(document.querySelector('#summary-owner'));
window.fixtureReactVersion=React.version;
window.fixtureIdentity=crypto.randomUUID();
window.summaryRenderCalls=0;
window.renderSummary=(heading,diagnostics)=>{
 window.summaryRenderCalls++;
 flushSync(()=>root.render(React.createElement(FormValidationSummary,{heading,diagnostics})));
};
window.renderSummary('Please correct the following fields',[
 {fieldId:'fld_hidden',fieldTitle:'Hidden semantic title',errorMessage:'Field is required'},
 {fieldId:'fld_email',fieldTitle:'Email address',errorMessage:'Enter a valid email address'}
]);
`;

const localhostBrowser = String.raw`
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {buildSync}=require(process.argv[2]);
const {chromium}=require(process.argv[3]);
const executablePath=process.argv[4],expectedReact=process.argv[5];
mkdirSync('browser-proof',{recursive:true});
buildSync({entryPoints:['browser-fixture.mjs'],bundle:true,platform:'browser',format:'iife',outfile:'browser-proof/app.js',define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
writeFileSync('browser-proof/index.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><style>body{margin:0;padding:16px;font-family:Arial,sans-serif}.fixture-frame{display:flex;flex-direction:column;height:180px;width:100%;overflow:hidden}.fixture-targets{margin-top:400px;padding-bottom:200px}</style><script defer src="/app.js"></script></head><body><main id="summary-owner" class="fixture-frame"></main><section class="fixture-targets"><label hidden for="fld_hidden">Hidden inline label</label><input id="fld_hidden" aria-label="Hidden-label field"><label for="fld_email">Email field</label><input id="fld_email"></section></body></html>');
const allowed=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/app.css','app.css']]);
const unexpectedPaths=[];
const server=createServer((request,response)=>{
 const path=new URL(request.url,'http://127.0.0.1').pathname,file=allowed.get(path);
 if(request.method!=='GET'||!file){unexpectedPaths.push(path);response.writeHead(404);response.end();return;}
 response.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html');
 response.end(readFileSync(resolve('browser-proof',file)));
});
let browser;
try {
 await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:480,height:360}});
 const externalRequests=[],pageErrors=[];let documentRequests=0;
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){externalRequests.push(request.url());await route.abort();return;}
  if(request.isNavigationRequest())documentRequests++;
  await route.continue();
 });
 const page=await context.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',error=>pageErrors.push(error.message));
 await page.goto(origin+'/',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>typeof window.renderSummary==='function');
 assert.equal(await page.evaluate(()=>window.fixtureReactVersion),expectedReact);
 const initial=await page.evaluate(()=>{
  const alert=document.querySelector('[role="alert"]'),heading=alert.querySelector('h3'),list=alert.querySelector('ul'),icon=alert.querySelector('svg'),items=Array.from(list.querySelectorAll('li')),link=items[0].querySelector('a');
  const css=element=>getComputedStyle(element);
  return {identity:window.fixtureIdentity,heading:heading.textContent,alertTestId:alert.dataset.testid,listRole:list.getAttribute('role'),items:items.map(item=>item.textContent),testIds:items.map(item=>item.dataset.testid),anchors:items.map(item=>item.querySelector('a').getAttribute('href')),hiddenLabel:document.querySelector('label[for="fld_hidden"]').hidden,inlineLabel:document.querySelector('label[for="fld_hidden"]').textContent,iconHidden:icon.getAttribute('aria-hidden'),style:{radius:css(alert).borderRadius,flex:css(alert).flex,overflow:css(alert).overflow,background:css(alert).backgroundColor,padding:css(alert).padding,headingColor:css(heading).color,headingSize:css(heading).fontSize,headingWeight:css(heading).fontWeight,headingLineHeight:css(heading).lineHeight,iconColor:css(icon).color,iconWidth:css(icon).width,iconHeight:css(icon).height,linkColor:css(link).color,linkWeight:css(link).fontWeight,linkDecoration:css(link).textDecorationLine,listPadding:css(list).paddingLeft,listStyle:css(list).listStyleType,itemGap:css(items[1]).marginTop},bespokeClickHandler:link.onclick!==null};
 });
 assert.equal(initial.heading,'Please correct the following fields');assert.equal(initial.alertTestId,'alert-test-id');assert.equal(initial.listRole,'list');
 assert.deepEqual(initial.items,['Hidden semantic title (Field is required)','Email address (Enter a valid email address)']);
 assert.deepEqual(initial.testIds,['field-fld_hidden-error','field-fld_email-error']);assert.deepEqual(initial.anchors,['#fld_hidden','#fld_email']);
 assert.equal(initial.hiddenLabel,true);assert.equal(initial.inlineLabel,'Hidden inline label');assert.equal(initial.iconHidden,'true');assert.equal(initial.bespokeClickHandler,false);
 assert.deepEqual(initial.style,{radius:'0px',flex:'1 1 0%',overflow:'auto',background:'rgb(254, 242, 242)',padding:'16px',headingColor:'rgb(153, 27, 27)',headingSize:'14px',headingWeight:'500',headingLineHeight:'20px',iconColor:'rgb(248, 113, 113)',iconWidth:'24px',iconHeight:'24px',linkColor:'rgb(185, 28, 28)',linkWeight:'500',linkDecoration:'underline',listPadding:'20px',listStyle:'disc',itemGap:'4px'});
 for(const [name,id]of [['Hidden semantic title','fld_hidden'],['Email address','fld_email']]){
  await page.getByRole('link',{name,exact:true}).click();
  await page.waitForFunction(id=>location.hash==='#'+id,id);
  assert.equal(new URL(page.url()).pathname,'/');
  assert.deepEqual(await page.evaluate(()=>({identity:window.fixtureIdentity,renders:window.summaryRenderCalls})),{identity:initial.identity,renders:1});
 }
 assert.equal(documentRequests,1,'Native fragment links must not reload the document');
 const scroll=await page.evaluate(()=>{
  window.renderSummary('Many diagnostics',Array.from({length:40},(_,index)=>({fieldId:'fld_long_'+index,fieldTitle:'Field '+index,errorMessage:'Field is required'})));
  const alert=document.querySelector('[role="alert"]');alert.scrollTop=alert.scrollHeight;
  return {clientHeight:alert.clientHeight,scrollHeight:alert.scrollHeight,scrollTop:alert.scrollTop,count:alert.querySelectorAll('li').length};
 });
 assert.equal(scroll.count,40);assert(scroll.clientHeight>0);assert(scroll.scrollHeight>scroll.clientHeight);assert(scroll.scrollTop>0);
 await page.evaluate(()=>window.renderSummary('Updated heading',[{fieldId:'fld_email',fieldTitle:'Updated email title',errorMessage:'Changed error'},{fieldId:'fld_hidden',fieldTitle:'Hidden semantic title',errorMessage:'Still required'}]));
 assert.deepEqual(await page.locator('[role="list"] li').allTextContents(),['Updated email title (Changed error)','Hidden semantic title (Still required)']);
 assert.equal(await page.locator('h3').textContent(),'Updated heading');
 await page.evaluate(()=>window.renderSummary('Cleared heading',[]));
 assert.equal(await page.locator('[role="alert"]').count(),0);assert.equal(await page.locator('[role="list"]').count(),0);assert.equal(await page.locator('#summary-owner').textContent(),'');
 await page.evaluate(()=>window.renderSummary('Restored heading',[{fieldId:'fld_hidden',fieldTitle:'Restored semantic title',errorMessage:'Current error'}]));
 assert.deepEqual(await page.locator('[role="list"] li').allTextContents(),['Restored semantic title (Current error)']);
 assert.equal(await page.locator('[role="list"] a').getAttribute('href'),'#fld_hidden');
 assert.deepEqual(pageErrors,[]);assert.deepEqual(externalRequests,[]);assert.deepEqual(unexpectedPaths,[]);assert.equal(documentRequests,1);
 console.log(JSON.stringify({react:expectedReact,chromium:browser.version(),viewport:{width:480,height:360},nativeAnchorChecks:2,documentRequests,scroll,transitions:['updated','cleared','restored'],pageErrors:pageErrors.length,externalRequests:externalRequests.length,computedStyles:true}));
} finally {
 if(browser)await browser.close();
 if(server.listening)await new Promise((accept,reject)=>server.close(error=>error?reject(error):accept()));
}
`;

/** Qualify a real packed SDK without depending on the shared package-check entrypoint. */
export function checkFormValidationSummaryReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
    playwrightModulePath,
    chromiumExecutablePath = process.env.SDK_FORM_VALIDATION_CHROMIUM ||
        '/usr/bin/chromium',
}) {
    assert(archivePath, 'Provide an existing SDK package archive');
    const archive = resolve(archivePath);
    const directory = mkdtempSync(
        join(tmpdir(), 'sdk-form-validation-summary-')
    );
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
            const css = readFileSync(
                join(installed, 'dist/esm/react/form-validation-summary.css')
            );
            assert(css.length > 0);
            assert(
                css.equals(
                    readFileSync(
                        join(
                            installed,
                            'dist/cjs/react/form-validation-summary.css'
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
                assert.equal(result.computedStyles, true);
                formats.push(result);
            }
            run(process.execPath, [
                '--input-type=module',
                '-e',
                browser,
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
                assert.equal(localhost.nativeAnchorChecks, 2);
            }
            versions.push({
                react: version.react,
                formats,
                ...(localhost ? { localhost } : {}),
            });
            console.log(
                `Installed FormValidationSummary React ${version.react}: ESM/CJS/types/CSS/browser bundles/SSR/hydration/diagnostic updates and clearing passed; no network.`
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
        'Usage: node scripts/form-validation-summary-consumer-checks.mjs <existing-sdk.tgz>'
    );
    const require = createRequire(import.meta.url);
    const result = checkFormValidationSummaryReactMatrix({
        archivePath: process.argv[2],
        typescriptBin: require.resolve('typescript/bin/tsc'),
        happyDomModulePath: require.resolve('happy-dom'),
        esbuildModulePath: require.resolve('esbuild'),
        playwrightModulePath: require.resolve('playwright'),
        chromiumExecutablePath:
            process.env.SDK_FORM_VALIDATION_CHROMIUM || '/usr/bin/chromium',
    });
    console.log(JSON.stringify(result));
}
