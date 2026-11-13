import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const typed = String.raw`
import { createElement } from 'react';
import { projectFormCompletion, projectFormCompletionNavigation, createFormCompletionCountdown, dispatchFormCompletionCommands, type FormCompletionConfiguration, type FormCompletionCommand } from '@miniextensions/sdk/forms';
import { CompleteFormCompletion, CompleteFormCompletionMessage, useFormCompletionCountdown, type CompleteFormCompletionProps, type FormCompletionAction } from '@miniextensions/sdk/react';
const configuration: FormCompletionConfiguration = { afterFormSubmission:'stay',successAction:true,successMessageCanCreateNewRecord:true,allowCopySubmittedToNewForm:true };
const projection = projectFormCompletion({ configuration,language:'en',filteredValues:{},unfilteredValues:{},fields:{},linkedTableStates:{} });
const props: CompleteFormCompletionProps = { configuration,projection,canSubmit:true,onCommand(action: FormCompletionAction){ void action; },isCurrent:()=>true };
createElement(CompleteFormCompletion,props);
createElement(CompleteFormCompletionMessage,{message:projection.message,delay:0});
function HookConsumer(){ const countdown=useFormCompletionCountdown({start:0,onComplete(){}}); countdown.start(); countdown.stop(); countdown.reset(3); return null; }
createElement(HookConsumer);
const plan: FormCompletionCommand[] = projectFormCompletionNavigation({currentURL:'https://consumer.invalid/form/rec123?screen=2#answer',inIframe:false,recordId:'rec123',command:'copy_form'});
void dispatchFormCompletionCommands(plan,{dispatch(command){void command.type;},isCurrent:()=>true});
const controller=createFormCompletionCountdown({start:0,onComplete(){}});controller.start();controller.retire();
// @ts-expect-error effects are an explicit host adapter
const noAdapter: CompleteFormCompletionProps = {configuration,projection,canSubmit:true};
// @ts-expect-error the public component owns its renderer
const nativeRenderer: CompleteFormCompletionProps = {...props,renderNative(){return null;}};
// @ts-expect-error Save is not a completion command
props.onCommand('save');
void noAdapter;void nativeRenderer;
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
const calls=[];
let configuration={afterFormSubmission:'stay',successAction:true,successMessageStatic:'<p><strong>Saved</strong><script>alert(1)</script></p>',successMessageCanCreateNewRecord:true,allowCopySubmittedToNewForm:true};
const props=()=>({configuration,projection:forms.projectFormCompletion({configuration,language:'en',filteredValues:{},unfilteredValues:{},fields:{},linkedTableStates:{}}),canSubmit:true,onCommand(command){calls.push(command);}});
const element=()=>React.createElement(React.StrictMode,null,React.createElement(ui.CompleteFormCompletion,props()));
const html=renderToString(element());
assert(html.includes('<strong>Saved</strong>'));assert(!html.includes('<script'));assert(html.includes('role="alert"'));assert(html.includes('Submit another form'));assert(html.includes('Copy submission'));assert.deepEqual(calls,[]);
const {Window}=require(process.argv[3]);let networks=0;
const domWindow=new Window({url:'https://consumer.invalid/form/rec123',settings:{fetch:{interceptor:{beforeAsyncRequest(){networks++;throw new Error('Unexpected network');},beforeSyncRequest(){networks++;throw new Error('Unexpected network');}}}}});
const keys=['window','document','navigator','HTMLElement','IS_REACT_ACT_ENVIRONMENT'];
const originals=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:domWindow[key]});
const container=domWindow.document.createElement('main');domWindow.document.body.append(container);container.innerHTML=html;
const original=container.firstChild,errors=[];const {hydrateRoot}=await import('react-dom/client');let root;
try {
 await React.act(async()=>{root=hydrateRoot(container,element(),{onRecoverableError:error=>errors.push(error.message)});});
 assert.deepEqual(errors,[]);assert.equal(container.firstChild,original);
 const buttons=container.querySelectorAll('button');assert.equal(buttons.length,2);
 await React.act(async()=>{buttons[0].click();buttons[1].click();});assert.deepEqual(calls,['submit_another_form','copy_form']);
 configuration={...configuration,afterFormSubmission:'redirect',enableRedirectDelay:true,redirectDelay:0,redirectURLStatic:'/next'};
 await React.act(async()=>root.render(element()));
 await React.act(async()=>{await new Promise(resolve=>setTimeout(resolve,15));});
 assert.deepEqual(calls,['submit_another_form','copy_form','navigate']);
 assert(container.textContent.includes('Redirecting'));
 configuration={...configuration,redirectDelay:30,redirectURLStatic:'/changed'};
 await React.act(async()=>root.render(element()));
 await React.act(async()=>{await new Promise(resolve=>setTimeout(resolve,15));});
 assert.equal(calls.length,3);
 await React.act(async()=>root.unmount());root=undefined;
 assert.equal(domWindow.location.href,'https://consumer.invalid/form/rec123');assert.equal(networks,0);assert.equal(domWindow.localStorage.length,0);assert.equal(domWindow.sessionStorage.length,0);
 console.log(JSON.stringify({format,react:React.version,hydrationErrors:errors.length,effects:calls,networkRequests:networks}));
} finally {
 if(root)await React.act(async()=>root.unmount());
 keys.forEach((key,index)=>{if(originals[index])Object.defineProperty(globalThis,key,originals[index]);else Reflect.deleteProperty(globalThis,key);});
 await domWindow.happyDOM.close();
}
`;

export function checkFormCompletionReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-form-completion-'));
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
            const guide = readFileSync(
                join(
                    directory,
                    'node_modules/@miniextensions/sdk/docs/form-completion.md'
                ),
                'utf8'
            ).match(/```tsx\n([\s\S]*?)\n```/)?.[1];
            assert(guide, 'Missing packed completion recipe');
            for (const extension of ['mts', 'cts']) {
                const file = `completion.${extension}`,
                    guideFile = `completion-guide.${extension}`;
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
                    join(
                        directory,
                        'node_modules/@miniextensions/sdk/examples/react-form-completion/main.ts'
                    ),
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
                assert.deepEqual(result.effects, [
                    'submit_another_form',
                    'copy_form',
                    'navigate',
                ]);
                formats.push(result);
            }
            const css = readFileSync(
                join(
                    directory,
                    'node_modules/@miniextensions/sdk/dist/esm/react/form-completion.css'
                ),
                'utf8'
            );
            assert(css.includes('.mx-sdk-form-completion'));
            assert(css.includes('.mx-sdk-form-completion-spinner'));
            run(process.execPath, [
                '--input-type=module',
                '-e',
                `import{createRequire}from'node:module';const r=createRequire(import.meta.url);r.resolve('@miniextensions/sdk/react/form-completion.css');const{buildSync}=r(${JSON.stringify(esbuildModulePath)});for(const format of ['esm','cjs'])buildSync({stdin:{contents:format==='esm'?"import{CompleteFormCompletion}from'@miniextensions/sdk/react';import'@miniextensions/sdk/react/form-completion.css';console.log(CompleteFormCompletion)":"require('@miniextensions/sdk/react/form-completion.css');console.log(require('@miniextensions/sdk/react').CompleteFormCompletion)",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',outdir:'browser-output',write:false,logLevel:'silent'});buildSync({absWorkingDir:process.cwd()+'/node_modules/@miniextensions/sdk/examples/react-form-completion',entryPoints:['main.ts'],bundle:true,platform:'browser',format:'esm',target:'es2022',outdir:'browser-output',write:false,logLevel:'silent'});`,
            ]);
            versions.push({ react: version.react, formats });
            console.log(
                `Installed Form completion React${version.react}: ESM/CJS/types/CSS/SSR/hydration/full stock UI and zero countdown passed; no network.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
