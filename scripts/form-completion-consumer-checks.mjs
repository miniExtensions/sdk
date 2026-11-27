import { runAgeQualifiedConsumerInstall } from './age-qualified-consumer-install.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const typed = String.raw`
import { createElement } from 'react';
import { projectFormCompletion, projectFormCompletionNavigation, createFormCompletionCountdown, dispatchFormCompletionCommands, type FormCompletionConfiguration, type FormCompletionCommand } from '@miniextensions/sdk/forms';
import { CompleteFormCompletion, CompleteFormCompletionMessage, CompleteFormReadonlyFooterActions, useFormCompletionCountdown, type CompleteFormCompletionProps, type CompleteFormReadonlyFooterActionsProps, type FormCompletionAction, type FormReadonlyFooterAction } from '@miniextensions/sdk/react';
const configuration: FormCompletionConfiguration = { afterFormSubmission:'stay',successAction:true,successMessageCanCreateNewRecord:true,allowCopySubmittedToNewForm:true };
const projection = projectFormCompletion({ configuration,language:'en',filteredValues:{},unfilteredValues:{},fields:{},linkedTableStates:{} });
const props: CompleteFormCompletionProps = { configuration,projection,canSubmit:true,onCommand(action: FormCompletionAction){ void action; },isCurrent:()=>true };
createElement(CompleteFormCompletion,props);
createElement(CompleteFormCompletionMessage,{message:projection.message,delay:0});
const footer: CompleteFormReadonlyFooterActionsProps = {
    configuration, language:'en', mode:'readonly', context:'side-panel',
    hasParentExtension:true, hasExistingRecord:true,
    onCommand(intent: FormReadonlyFooterAction){ void intent; }
};
createElement(CompleteFormReadonlyFooterActions,footer);
// @ts-expect-error a read-only footer cannot issue a Save
footer.onCommand('save');
// @ts-expect-error a read-only footer cannot issue automatic navigation
footer.onCommand('automatic_new_form');
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
import {mock} from 'node:test';
import React from 'react';
const require=createRequire(import.meta.url),format=process.argv[2];
assert.equal(typeof window,'undefined');assert.equal(typeof document,'undefined');
const forms=format==='esm'?await import('@miniextensions/sdk/forms'):require('@miniextensions/sdk/forms');
const ui=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
for (const share of ['record-survey', 'survey']) {
    const current = 'https://consumer.invalid/' + share + '/rec12345678901234?screen=success&recordIdToCopyFrom=recOld&prefill_Title=Keep&campaign=summer#section';
    assert.deepEqual(forms.projectFormCompletionNavigation({
        currentURL: current, inIframe: false, recordId: 'rec12345678901234',
        command: 'submit_another_form',
    }), [{ type: 'navigate', route: 'self', url: 'https://consumer.invalid/' + share + '?prefill_Title=Keep&campaign=summer#section' }]);
}
assert.deepEqual(forms.projectFormCompletionNavigation({
    currentURL: 'https://consumer.invalid/record-survey?screen=review#section',
    inIframe: false,
}), [{ type: 'navigate', route: 'self', url: 'https://consumer.invalid/record-survey?screen=review#section' }]);
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

 const h = React.createElement;
 const footerSettings = {
     afterFormSubmission: 'stay',
     successAction: true,
     successMessageCanCreateNewRecord: true,
     allowCopySubmittedToNewForm: true,
     enableLockingFormAfterSubmission: false,
 };
 const footerIntents = [], destinations = [];
 let submits = 0, writes = 0, footerCases = 0, successCases = 0;
 const footer = {
     configuration: footerSettings, language: 'en', context: 'direct-url',
     mode: 'readonly', hasParentExtension: false, hasExistingRecord: true,
     onCommand(command) {
         footerIntents.push(command);
         const [destination] = forms.projectFormCompletionNavigation({
             command, recordId: 'rec123', inIframe: false,
             currentURL: 'https://consumer.invalid/form/rec123?screen=success&recordIdToCopyFrom=recOld&prefill_Name=Current&campaign=summer',
         });
         assert.equal(destination.type, 'navigate');
         destinations.push(new URL(destination.url));
     },
 };
 const renderFooter = changes => h(React.StrictMode, null, h('form', {
     onSubmit(event) { event.preventDefault(); submits++; writes++; },
 }, h(ui.CompleteFormReadonlyFooterActions, { ...footer, ...changes })));
 const child = { context: 'side-panel', hasParentExtension: true };
 const childHTML = renderToString(renderFooter(child));
 assert.match(childHTML, /type="button"/);
 assert.match(childHTML, /Copy submission/);
 assert.doesNotMatch(childHTML, /Submit another form/);
 assert.deepEqual(footerIntents, []);
 const mountFooter = async (changes, labels) => {
     const before = footerIntents.length;
     await React.act(async () => root.render(renderFooter(changes)));
     const buttons = [...container.querySelectorAll('button')];
     assert.deepEqual(buttons.map(button => button.textContent), labels);
     for (const button of buttons) assert.equal(button.type, 'button');
     assert.equal(footerIntents.length, before);
     footerCases++;
     return buttons;
 };
 const submit = 'Submit another form', copy = 'Copy submission';
 const [childCopy] = await mountFooter(child, [copy]);
 await React.act(async () => childCopy.click());
 assert.deepEqual(footerIntents, ['copy_form']);
 assert.equal(destinations[0].searchParams.get('recordIdToCopyFrom'), 'rec123');
 const [rootSubmit, rootCopy] = await mountFooter({}, [submit, copy]);
 await React.act(async () => rootSubmit.click());
 assert.deepEqual(footerIntents, ['copy_form', 'submit_another_form']);
 await React.act(async () => rootCopy.click());
 assert.deepEqual(footerIntents, ['copy_form', 'submit_another_form', 'copy_form']);
 assert.equal(destinations[1].searchParams.has('recordIdToCopyFrom'), false);
 assert.equal(destinations[2].searchParams.get('recordIdToCopyFrom'), 'rec123');
 for (const destination of destinations) {
     assert.equal(destination.pathname, '/form');
     assert.equal(destination.searchParams.has('screen'), false);
     assert.equal(destination.searchParams.get('prefill_Name'), 'Current');
     assert.equal(destination.searchParams.get('campaign'), 'summer');
 }
 const locked = { ...footerSettings, enableLockingFormAfterSubmission: true };
 for (const [change, labels] of [
     [{ ...child, configuration: locked }, []],
     [{ ...child, context: 'modal' }, []],
     [{ configuration: locked }, [submit]],
     [{ configuration: { ...footerSettings, accessingRecordsMethod: 'loginPage' } }, [copy]],
     [{ mode: 'editable' }, []],
     [{ mode: 'config-preview' }, []],
     [{ configuration: { successMessageCanCreateNewRecord: true } }, [submit]],
     [{ configuration: { allowCopySubmittedToNewForm: true } }, [copy]],
     [{ configuration: {} }, []],
     [{ hasExistingRecord: false }, [submit]],
     [{ context: 'form-layout' }, [submit, copy]],
 ]) await mountFooter(change, labels);
 await mountFooter({ configuration: { ...footerSettings, successMessageNewRecordText: ' Continue ', allowCopySubmittedToNewFormButtonText: ' Duplicate ' } }, [' Continue ', ' Duplicate ']);
 const emptyCopy = { ...footerSettings, successMessageNewRecordText: '  ', allowCopySubmittedToNewFormButtonText: '' };
 const frenchSubmit = 'Soumettre un autre formulaire', frenchCopy = 'Copier la soumission';
 await mountFooter({ language: 'fr' }, [frenchSubmit, frenchCopy]);
 const disabled = await mountFooter({ language: 'fr', configuration: emptyCopy, disabled: true }, [frenchSubmit, '']);
 assert.equal(disabled[1].getAttribute('aria-label'), frenchCopy);
 for (const button of disabled) await React.act(async () => button.click());
 assert.deepEqual(footerIntents, ['copy_form', 'submit_another_form', 'copy_form']);

 const postSaveIntents = [];
 for (const [configuration, options, canSubmit, labels, accessibleCopy] of [
     [footerSettings, { hasParentExtension: true }, true, []],
     [footerSettings, {}, true, [frenchSubmit, frenchCopy]],
     [locked, {}, true, [frenchSubmit]],
     [emptyCopy, {}, true, [frenchSubmit]],
     [{ ...footerSettings, allowCopySubmittedToNewFormButtonText: '  ' }, {}, true, [frenchSubmit, '  '], frenchCopy],
     [{ ...footerSettings, allowCopySubmittedToNewFormButtonText: null }, {}, true, [frenchSubmit, frenchCopy]],
     [{ ...footerSettings, allowCopySubmittedToNewFormButtonText: ' Dupliquer ' }, {}, true, [frenchSubmit, ' Dupliquer ']],
     [{ ...footerSettings, accessingRecordsMethod: 'loginPage' }, {}, true, []],
     [footerSettings, { hasLogout: true }, true, []],
     [{ ...footerSettings, successAction: false }, {}, true, []],
     ...['readonly', 'redirect', 'newForm', 'close'].map(mode =>
         [{ ...footerSettings, afterFormSubmission: mode }, {}, true, []]),
     [footerSettings, {}, false, [frenchSubmit, frenchCopy]],
 ]) {
     const projection = forms.projectFormCompletion({ configuration, language: 'fr',
         filteredValues: {}, unfilteredValues: {}, fields: {}, linkedTableStates: {}, ...options });
     await React.act(async () => root.render(h(ui.CompleteFormCompletion, {
         key: ++successCases, configuration, projection, canSubmit,
         onCommand: command => postSaveIntents.push(command),
     })));
     const buttons = [...container.querySelectorAll('button')];
     assert.deepEqual(buttons.map(button => button.textContent), labels);
     assert.equal(buttons[1]?.getAttribute('aria-label') ?? null, accessibleCopy ?? null);
     if (!canSubmit) {
         for (const button of buttons) {
             assert(button.disabled);
             await React.act(async () => button.click());
         }
     }
     assert.deepEqual(postSaveIntents, []);
 }

 const delayedConfirmations = [];
 const delayedConfiguration = {afterFormSubmission:'stay',successAction:true,successMessageDelay:5};
 mock.timers.enable({apis:['setTimeout','Date'],now:0});
 try {
     for (const [language, loading, success] of [
         ['en', 'Loading', 'Form submitted successfully'],
         ['fr', 'Chargement', 'Formulaire soumis avec succès'],
     ]) {
         const projection = forms.projectFormCompletion({ configuration: delayedConfiguration, language,
             filteredValues: {}, unfilteredValues: {}, fields: {}, linkedTableStates: {} });
         await React.act(async () => root.render(h(ui.CompleteFormCompletion, {
             key: language, configuration: delayedConfiguration, projection, canSubmit: true,
             onCommand: command => postSaveIntents.push(command),
         })));
         await React.act(async () => mock.timers.tick(4999));
         const status = container.querySelector('[role="status"]');
         assert(status);
         const name = status.getAttribute('aria-label');
         const announcement = status.textContent;
         assert.deepEqual([name, announcement], [loading, loading + '...'], language);
         assert(!container.textContent.includes(success));
         await React.act(async () => mock.timers.tick(1));
         assert(!container.querySelector('[role="status"]'));
         assert.equal(container.textContent, success);
         delayedConfirmations.push({language, name, announcement, confirmation: container.textContent});
     }
 } finally {
     try {
         await React.act(async () => root.render(null));
     } finally {
         mock.timers.reset();
     }
 }
 assert.deepEqual(postSaveIntents, []);
 assert.deepEqual({ submits, writes }, { submits: 0, writes: 0 });
 await React.act(async()=>root.unmount());root=undefined;
 assert.equal(domWindow.location.href,'https://consumer.invalid/form/rec123');assert.equal(networks,0);assert.equal(domWindow.localStorage.length,0);assert.equal(domWindow.sessionStorage.length,0);
 console.log(JSON.stringify({format,react:React.version,hydrationErrors:errors.length,effects:calls,networkRequests:networks,footerCases,successCases,delayedConfirmations}));
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
            const guide = readFileSync(
                join(
                    directory,
                    'node_modules/@miniextensions/sdk/docs/form-completion.md'
                ),
                'utf8'
            ).matchAll(/```tsx\n([\s\S]*?)\n```/g);
            const [completionGuide, footerGuide] = [...guide].map(
                ([, source]) => source
            );
            assert(
                completionGuide && footerGuide,
                'Missing packed Form recipe'
            );
            for (const extension of ['mts', 'cts']) {
                const file = `completion.${extension}`,
                    guideFile = `completion-guide.${extension}`,
                    footerGuideFile = `readonly-footer-guide.${extension}`;
                writeFileSync(join(directory, file), typed);
                writeFileSync(join(directory, guideFile), completionGuide);
                writeFileSync(join(directory, footerGuideFile), footerGuide);
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
                    footerGuideFile,
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
                assert.equal(result.footerCases, 16);
                assert.equal(result.successCases, 15);
                assert.equal(result.delayedConfirmations.length, 2);
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
            assert(css.includes('.mx-sdk-form-readonly-footer-action'));
            run(process.execPath, [
                '--input-type=module',
                '-e',
                `import{createRequire}from'node:module';const r=createRequire(import.meta.url);r.resolve('@miniextensions/sdk/react/form-completion.css');const{buildSync}=r(${JSON.stringify(esbuildModulePath)});for(const format of ['esm','cjs'])buildSync({stdin:{contents:format==='esm'?"import{CompleteFormCompletion}from'@miniextensions/sdk/react';import'@miniextensions/sdk/react/form-completion.css';console.log(CompleteFormCompletion)":"require('@miniextensions/sdk/react/form-completion.css');console.log(require('@miniextensions/sdk/react').CompleteFormCompletion)",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',outdir:'browser-output',write:false,logLevel:'silent'});buildSync({absWorkingDir:process.cwd()+'/node_modules/@miniextensions/sdk/examples/react-form-completion',entryPoints:['main.ts'],bundle:true,platform:'browser',format:'esm',target:'es2022',outdir:'browser-output',write:false,logLevel:'silent'});`,
            ]);
            versions.push({ react: version.react, formats });
            console.log(
                `Installed Form completion and read-only footer React${version.react}: ESM/CJS/types/CSS/SSR and mounted actions passed; no network.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
