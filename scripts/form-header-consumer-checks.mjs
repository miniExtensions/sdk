import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const typed = String.raw`
import {createElement} from 'react';
import {resolveFormHeaderTitle,resolveFormDisplayText,resolveFormLogo,type FormDisplaySource} from '@miniextensions/sdk/forms';
import {CompleteFormHeader,CompleteFormCover,CompleteFormFooterDescription,type CompleteFormHeaderProps} from '@miniextensions/sdk/react';
const identity={owner:'consumer',configuration:'v1',record:'create'};
const title:FormDisplaySource={type:'static',value:'A title'};
const props:CompleteFormHeaderProps={identity,title,extensionName:'Fallback',description:{enabled:true,source:{type:'static',value:'<p>Details</p>'},truncate:true},language:'fr'};
createElement(CompleteFormHeader,props);
createElement(CompleteFormCover,{identity,src:null});
createElement(CompleteFormFooterDescription,{identity,enabled:true,source:title});
resolveFormHeaderTitle(title,'Fallback');resolveFormDisplayText(title);resolveFormLogo(title,true);
createElement(CompleteFormHeader,{...props,preview:{showPlaceholders:true,showFieldSources:true,onOpenSettings(target){void target;},isCurrent(){return true;}}});
// @ts-expect-error the SDK owns the complete renderer
const nativeRenderer:CompleteFormHeaderProps={...props,renderNative(){return null;}};
// @ts-expect-error preview is a bounded capability, not an arbitrary action bus
createElement(CompleteFormHeader,{...props,preview:{showPlaceholders:true,showFieldSources:true,onSave(){}}});
void nativeRenderer;
`;

const runtime = String.raw`
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
const require=createRequire(import.meta.url),format=process.argv[2];
assert.equal(typeof window,'undefined');assert.equal(typeof document,'undefined');
const forms=format==='esm'?await import('@miniextensions/sdk/forms'):require('@miniextensions/sdk/forms');
const ui=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
const {renderToString}=await import('react-dom/server');
const image='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="208" height="48"%3E%3Crect width="208" height="48" fill="green"/%3E%3C/svg%3E';
const field={id:'accepted-field',name:'Current source',description:null,isPrimaryField:false,isComputed:false,config:{type:'singleLineText',options:null}};
let identity={owner:'consumer',configuration:'v1',record:'table:A'},source={type:'static',value:'Initial <b>title</b>'},enabled=true,child=false,preview;
const calls=[];
const staticSource=value=>({type:'static',value});
const element=()=>React.createElement(React.StrictMode,null,
 React.createElement(ui.CompleteFormCover,{identity,src:image,isChildForm:child,testId:'packed-cover'}),
 React.createElement(ui.CompleteFormHeader,{identity,title:source,extensionName:'Fallback name',logo:staticSource(image),isChildForm:child,description:{enabled,source:staticSource('<p><strong>Safe description</strong><script>privateScript()</script></p>')},testId:'packed-header',preview}),
 React.createElement(ui.CompleteFormFooterDescription,{identity,enabled,source:source.type==='field'?source:staticSource('<p><em>Safe footer</em><script>privateFooter()</script></p>'),preview}));
const html=renderToString(element());
assert(html.includes('Initial &lt;b&gt;title&lt;/b&gt;'));assert(html.includes('<strong>Safe description</strong>'));assert(html.includes('<em>Safe footer</em>'));assert(!html.includes('<script'));assert(!html.includes('privateScript'));assert.deepEqual(calls,[]);
assert.equal(forms.resolveFormHeaderTitle({type:'field',field:{status:'missing'}},'Fallback name'),'Fallback name');
assert.equal(forms.resolveFormHeaderTitle({type:'field',field:{status:'resolved',field,value:''}},'Fallback name'),'');
const {Window}=require(process.argv[3]);let networks=0;
const domWindow=new Window({url:'https://consumer.invalid/form',settings:{fetch:{interceptor:{beforeAsyncRequest(){networks++;throw new Error('Unexpected network');},beforeSyncRequest(){networks++;throw new Error('Unexpected network');}}}}});
const keys=['window','document','navigator','HTMLElement','IS_REACT_ACT_ENVIRONMENT'];
const originals=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:domWindow[key]});
const container=domWindow.document.createElement('main');domWindow.document.body.append(container);container.innerHTML=html;
const original=container.firstChild,errors=[];const {hydrateRoot}=await import('react-dom/client');const {flushSync}=await import('react-dom');let root;
try {
 await React.act(async()=>{root=hydrateRoot(container,element(),{onRecoverableError:error=>errors.push(error.message)});});
 assert.deepEqual(errors,[]);assert.equal(container.firstChild,original);
 assert.equal(container.querySelector('h1').textContent,'Initial <b>title</b>');assert.equal(container.querySelector('h1 b'),null);assert.equal(container.querySelectorAll('img').length,2);
 for(const record of ['B','A']){identity={...identity,record:'table:'+record};source=staticSource('Record '+record);await React.act(async()=>root.render(element()));assert.equal(container.querySelector('h1').textContent,'Record '+record);}
 child=true;await React.act(async()=>root.render(element()));assert.equal(container.querySelectorAll('img').length,0);assert.equal(container.querySelector('h1').textContent,'Record A');
 child=false;enabled=false;source={type:'field',field:{status:'resolved',field,value:''}};await React.act(async()=>root.render(element()));assert.equal(container.querySelector('h1'),null);assert(!container.textContent.includes('Safe description'));assert(!container.textContent.includes('Safe footer'));assert.equal(container.querySelectorAll('button').length,0);
 let retirementChecks=0;
 preview={showPlaceholders:true,showFieldSources:true,onOpenSettings:target=>calls.push(target),isCurrent(){
  retirementChecks++;
  if(retirementChecks===1){
   const originalIdentity=identity;
   flushSync(()=>{identity={...identity,record:'table:retiring-B'};root.render(element());});
   flushSync(()=>{identity=originalIdentity;root.render(element());});
  }
  return true;
 }};enabled=true;identity={...identity,configuration:'preview'};
 await React.act(async()=>root.render(element()));
 const footerButton=Array.from(container.querySelectorAll('button')).find(button=>button.textContent.includes('Footer from Airtable'));
 assert(footerButton,'Missing selected-field footer placeholder');await React.act(async()=>footerButton.click());
 assert.equal(retirementChecks,1);assert.deepEqual(calls,[],'First-A callback must retire after synchronous A–B–A inside isCurrent');
 const currentFooterButton=Array.from(container.querySelectorAll('button')).find(button=>button.textContent.includes('Footer from Airtable'));
 assert(currentFooterButton,'Missing current footer placeholder after A–B–A');await React.act(async()=>currentFooterButton.click());
 assert.equal(retirementChecks,2);assert.deepEqual(calls,['footer'],'The new current presentation dispatches exactly once');
 preview=undefined;identity={...identity,configuration:'public'};await React.act(async()=>root.render(element()));assert.equal(container.querySelectorAll('button').length,0);assert.deepEqual(calls,['footer']);
 source={type:'field',field:{status:'missing'}};await React.act(async()=>root.render(element()));assert.equal(container.querySelector('h1').textContent,'Fallback name');
 await React.act(async()=>root.unmount());root=undefined;
 assert.equal(domWindow.location.href,'https://consumer.invalid/form');assert.equal(networks,0);assert.equal(domWindow.localStorage.length,0);assert.equal(domWindow.sessionStorage.length,0);
 console.log(JSON.stringify({format,react:React.version,hydrationErrors:errors.length,effects:calls,networkRequests:networks}));
} finally {
 if(root)await React.act(async()=>root.unmount());
 keys.forEach((key,index)=>{if(originals[index])Object.defineProperty(globalThis,key,originals[index]);else Reflect.deleteProperty(globalThis,key);});
 await domWindow.happyDOM.close();
}
`;

export function checkFormHeaderReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-form-header-'));
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
                dependencies: { '@miniextensions/sdk': `file:${archivePath}` },
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
                `react@${version.react}`,
                `react-dom@${version.react}`,
                `@types/react@${version.types}`,
                `@types/react-dom@${version.domTypes}`,
            ]);
            const installed = join(
                directory,
                'node_modules/@miniextensions/sdk'
            );
            const guide = readFileSync(
                join(installed, 'docs/form-header.md'),
                'utf8'
            ).match(/```tsx\n([\s\S]*?)\n```/)?.[1];
            assert(guide, 'Missing packed header recipe');
            for (const extension of ['mts', 'cts']) {
                const file = `header.${extension}`;
                const guideFile = `header-guide.${extension}`;
                writeFileSync(join(directory, file), typed);
                writeFileSync(join(directory, guideFile), guide);
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
                    guideFile,
                    join(installed, 'examples/react-form-header/main.ts'),
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
                assert.deepEqual(result.effects, ['footer']);
                formats.push(result);
            }
            const css = readFileSync(
                join(installed, 'dist/esm/react/form-header.css')
            );
            assert(css.length > 0);
            assert(
                css.equals(
                    readFileSync(
                        join(installed, 'dist/cjs/react/form-header.css')
                    )
                )
            );
            run(process.execPath, [
                '--input-type=module',
                '-e',
                `import{createRequire}from'node:module';const r=createRequire(import.meta.url);r.resolve('@miniextensions/sdk/react/form-header.css');r.resolve('@miniextensions/sdk/react/html-description.css');const{buildSync}=r(${JSON.stringify(esbuildModulePath)});for(const format of ['esm','cjs'])buildSync({stdin:{contents:format==='esm'?"import{CompleteFormHeader,CompleteFormCover,CompleteFormFooterDescription}from'@miniextensions/sdk/react';import'@miniextensions/sdk/react/form-header.css';import'@miniextensions/sdk/react/html-description.css';console.log(CompleteFormHeader,CompleteFormCover,CompleteFormFooterDescription)":"require('@miniextensions/sdk/react/form-header.css');require('@miniextensions/sdk/react/html-description.css');console.log(require('@miniextensions/sdk/react').CompleteFormHeader)",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',outdir:'browser-output',write:false,logLevel:'silent'});buildSync({absWorkingDir:process.cwd()+'/node_modules/@miniextensions/sdk/examples/react-form-header',entryPoints:['main.ts'],bundle:true,platform:'browser',format:'esm',target:'es2022',outdir:'browser-output',write:false,logLevel:'silent'});`,
            ]);
            versions.push({ react: version.react, formats });
            console.log(
                `Installed Form header React${version.react}: ESM/CJS/types/CSS/SSR/hydration/full default header-cover-footer and current source transitions passed; no network.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
