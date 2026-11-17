import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transformSync } from 'esbuild';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import { assertBrowserInputs } from './package-checks.mjs';

export const nativeFormPagesTypedConsumer = String.raw`
import {createElement} from 'react';
import {createNativeFormPages,type NativeFormPageDescriptor,type NativeFormPagesPublication,type NativeFormPagesSnapshot,type NativeFormPages} from '@miniextensions/sdk/ui';
import {CompleteFormPageNavigation,FormPageNavigationButton,CompleteFormReview,type CompleteFormPageNavigationProps,type FormPageNavigationButtonProps,type CompleteFormReviewProps,type FormReviewItem} from '@miniextensions/sdk/react';
import type {FormPageOwner} from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/form-pages.css';
const owner={},configuration={};
const pages:readonly NativeFormPageDescriptor[]=[{title:'First',description:null,fieldIds:['answer'],hidden:false}];
const items:readonly FormReviewItem[]=[{id:'answer',title:'Answer',semanticTitle:'Answer',value:createElement('strong',null,'Accepted value')}];
const publication:NativeFormPagesPublication<FormReviewItem>={owner,configuration,pages,multiple:true,reviewItems:items,isCurrent:()=>true,onNext({pageIndex,advance}){void pageIndex;advance();},onBack(index){void index;}};
const controller:NativeFormPages<FormReviewItem>=createNativeFormPages(publication);
const snapshot:NativeFormPagesSnapshot<FormReviewItem>=controller.getSnapshot();
const unsubscribe:()=>void=controller.subscribe(()=>{});
controller.update({...publication,controlledPageIndex:0});
snapshot.actions.next();snapshot.actions.back();snapshot.actions.openReview(()=>Promise.resolve('native receipt'));
const receipt:unknown=controller.confirmReview();
const navigation:CompleteFormPageNavigationProps={pages:snapshot.pages,activePageIndex:snapshot.activePageIndex,onSelectTitle(){},progressTestId:'host-progress',progressItemTestId:'host-progress-item'};
const next:FormPageNavigationButtonProps={direction:'next',label:'Next',form:'existing-form',loading:false,disabled:false,type:'submit'};
const review:CompleteFormReviewProps={open:snapshot.reviewing,items:snapshot.reviewItems,title:'Review',editLabel:'Edit',confirmLabel:'Submit',emptyLabel:'No values',onEdit:snapshot.actions.dismissReview,onDismiss:snapshot.actions.dismissReview,onConfirm:snapshot.actions.confirmReview,style:{color:'black'}};
createElement(CompleteFormPageNavigation,navigation);createElement(FormPageNavigationButton,next);createElement(CompleteFormReview,review);
// @ts-expect-error published page descriptors are readonly
pages.push(pages[0]!);
// @ts-expect-error field order is a readonly host projection
pages[0]!.fieldIds.push('extra');
// @ts-expect-error Review rows are not a mutable canonical draft
snapshot.reviewItems.push(items[0]!);
// @ts-expect-error this presentation lifecycle cannot write native fields
controller.setValue('answer','replacement');
// @ts-expect-error only the captured host callback can submit
controller.submit({answer:'replacement'});
// @ts-expect-error a current-owner predicate is required
const missingCurrent:NativeFormPagesPublication<FormReviewItem>={owner,configuration,pages,multiple:true,reviewItems:items,onNext(){}};
// @ts-expect-error controlled page indexes are numeric
controller.update({...publication,controlledPageIndex:'first'});
// @ts-expect-error the complete Review does not accept a native modal renderer
const nativeModal:CompleteFormReviewProps={...review,renderReview(){return null;}};
// @ts-expect-error final field values are presentation, not a native draft object
const nativeDraft:FormReviewItem={id:'a',title:'A',semanticTitle:'A',value:'A',draft:{a:'A'}};
// @ts-expect-error navigation buttons admit only button or submit semantics
const reset:FormPageNavigationButtonProps={...next,type:'reset'};
declare const detached:FormPageOwner;
// @ts-expect-error detached standalone approval is not the native live lifecycle
const incompatible:NativeFormPages<FormReviewItem>=detached;
void [receipt,unsubscribe,missingCurrent,nativeModal,nativeDraft,reset,incompatible];
`;

// Each subprocess loads one actual installed format and one React version.
// The only host model here is a scalar canonical value and explicit admitted
// callbacks. No FormDraftStore, fabricated bindings or native Redux exist here.
const hydrationRuntime = String.raw`
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToString} from 'react-dom/server';
const require=createRequire(import.meta.url),format=process.argv[2];
assert.equal(typeof document,'undefined');
const ui=format==='esm'?await import('@miniextensions/sdk/ui'):require('@miniextensions/sdk/ui');
const view=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
const {Window}=require('happy-dom');
let checks=0,nextRequests=[],backRequests=[],saveCallbacks=0,canonical='Initial accepted value',allocation,result;
const payloads=[],owner={},configuration={};
const descriptors=[
 {title:'First page',description:'<p>Safe <strong>description</strong><script>privateCode()</script></p>',fieldIds:['answer'],hidden:false},
 {title:'Hidden page',description:null,fieldIds:['hidden'],hidden:true},
 {title:'Final page',description:null,fieldIds:['answer'],hidden:false}
];
const publication=()=>({owner,configuration,pages:descriptors,multiple:true,reviewItems:[{id:'answer',title:'Answer',semanticTitle:'Answer',value:canonical}],isCurrent:()=>true,onNext(request){nextRequests.push(request);},onBack(index){backRequests.push(index);}});
const controller=ui.createNativeFormPages(publication());
const submit=()=>{
 saveCallbacks++;
 return new Promise(resolve=>{allocation=()=>{const payload=canonical;payloads.push(payload);resolve({payload});};});
};
function App(){
 const snapshot=React.useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
 if(snapshot.retired)return React.createElement('p',{'data-testid':'retired'},'Retired');
 return React.createElement(React.Fragment,null,
  React.createElement(view.CompleteFormPageNavigation,{pages:snapshot.pages,activePageIndex:snapshot.activePageIndex}),
  React.createElement('form',{id:'live-form',onSubmit(event){event.preventDefault();if(snapshot.isLastPage)snapshot.actions.openReview(submit);else snapshot.actions.next();}},React.createElement('span',{'data-testid':'canonical'},canonical)),
  !snapshot.isFirstPage?React.createElement(view.FormPageNavigationButton,{direction:'back',label:'Back',onClick:snapshot.actions.back}):null,
  React.createElement(view.FormPageNavigationButton,{direction:'next',label:snapshot.isLastPage?'Review':'Next',form:'live-form'}),
  React.createElement(view.CompleteFormReview,{open:snapshot.reviewing,items:snapshot.reviewItems,title:'Review accepted fields',editLabel:'Edit',confirmLabel:'Submit',emptyLabel:'No set values',onEdit:snapshot.actions.dismissReview,onDismiss:snapshot.actions.dismissReview,onConfirm(){result=snapshot.actions.confirmReview();return result;}})
 );
}
const tree=()=>React.createElement(React.StrictMode,null,React.createElement(App));
const html=renderToString(tree());
assert(html.includes('First page'));assert(html.includes('<strong>description</strong>'));assert(!html.includes('<script'));assert(!html.includes('privateCode'));assert.equal(nextRequests.length,0);assert.equal(saveCallbacks,0);checks++;
let networks=0;
const domWindow=new Window({url:'https://native-pages-consumer.example.test/',settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableIframePageLoading:true,fetch:{interceptor:{beforeAsyncRequest(){networks++;throw new Error('Unexpected consumer network');},beforeSyncRequest(){networks++;throw new Error('Unexpected consumer network');}}}}});
const keys=['window','document','navigator','HTMLElement','HTMLDialogElement','Element','Node','NodeFilter','DocumentFragment','CustomEvent','MutationObserver','IS_REACT_ACT_ENVIRONMENT'];
const originals=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:domWindow[key]});
const container=domWindow.document.createElement('main');container.innerHTML=html;domWindow.document.body.append(container);
const original=container.firstChild,errors=[];
const {hydrateRoot}=await import('react-dom/client');let root;
const button=label=>{const node=Array.from(container.querySelectorAll('button')).find(node=>node.getAttribute('aria-label')===label||node.textContent===label);assert(node,'Missing '+label);return node;};
const click=async label=>React.act(async()=>button(label).click());
try{
 await React.act(async()=>{root=hydrateRoot(container,tree(),{onRecoverableError:error=>errors.push(error.message)});});
 assert.deepEqual(errors,[]);assert.equal(container.firstChild,original);assert.equal(controller.getSnapshot().activePageIndex,0);assert.equal(saveCallbacks,0);checks++;
 await click('Next');assert.equal(nextRequests.length,1);assert.equal(controller.getSnapshot().activePageIndex,0);assert.equal(button('Next').type,'submit');assert.equal(button('Next').form.id,'live-form');checks++;
 await React.act(async()=>nextRequests[0].advance());assert.equal(controller.getSnapshot().activePageIndex,2);assert.equal(container.querySelector('h2').textContent,'Final page');assert.equal(container.querySelectorAll('[data-testid="form-page-progress-item"]').length,2);checks++;
 await click('Back');assert.deepEqual(backRequests,[0]);assert.equal(controller.getSnapshot().activePageIndex,0);assert.equal(button('Next').textContent,'Next');checks++;
 await click('Next');await React.act(async()=>nextRequests[1].advance());await click('Review');assert.equal(controller.getSnapshot().reviewing,true);assert.equal(container.querySelectorAll('dialog[open]').length,1);assert.equal(saveCallbacks,0);checks++;
 const oldReview=controller.getSnapshot().actions;
 canonical='Edited while Review is open';await React.act(async()=>controller.update(publication()));assert.equal(container.querySelector('dd').textContent,canonical);assert.equal(controller.getSnapshot().reviewing,true);assert.equal(saveCallbacks,0);checks++;
 await click('Submit');assert.equal(saveCallbacks,1);assert.equal(controller.getSnapshot().reviewing,false);assert.equal(container.querySelector('dialog'),null);assert(result instanceof Promise);assert.equal(oldReview.confirmReview(),undefined);assert.equal(saveCallbacks,1);checks++;
 canonical='Edited after Confirm before allocation';await React.act(async()=>controller.update(publication()));await React.act(async()=>allocation());assert.deepEqual(await result,{payload:canonical});assert.deepEqual(payloads,[canonical]);assert.equal(saveCallbacks,1);checks++;
 await click('Review');await React.act(async()=>oldReview.confirmReview());assert.equal(controller.getSnapshot().reviewing,true);await click('Edit');assert.equal(controller.getSnapshot().reviewing,false);assert.equal(saveCallbacks,1);checks++;
 await click('Review');await React.act(async()=>domWindow.document.activeElement.dispatchEvent(new domWindow.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));assert.equal(controller.getSnapshot().reviewing,false);assert.equal(domWindow.document.activeElement,button('Review'));assert.equal(saveCallbacks,1);checks++;
 const retained=controller.getSnapshot().actions;await React.act(async()=>controller.update({...publication(),owner:{}}));await React.act(async()=>controller.update(publication()));retained.openReview(submit);assert.equal(controller.getSnapshot().retired,true);assert.equal(container.querySelector('[data-testid="retired"]').textContent,'Retired');assert.equal(saveCallbacks,1);checks++;
 await React.act(async()=>root.unmount());root=undefined;assert.equal(networks,0);assert.equal(domWindow.localStorage.length,0);assert.equal(domWindow.sessionStorage.length,0);assert.equal(domWindow.location.href,'https://native-pages-consumer.example.test/');assert.deepEqual(errors,[]);checks++;
 console.log(JSON.stringify({format,react:React.version,checks,hydrationErrors:errors.length,saveCallbacks,payloads,networkRequests:networks}));
}finally{
 if(root)await React.act(async()=>root.unmount());
 controller.dispose();container.remove();
 keys.forEach((key,index)=>{if(originals[index])Object.defineProperty(globalThis,key,originals[index]);else Reflect.deleteProperty(globalThis,key);});
 await domWindow.happyDOM.close();
}
`;

const testsPerProfile = 27;
const hydrationChecksPerProfile = 13;

/** Qualify public installed bytes; do not count local source execution as a package proof. */
export async function checkNativeFormPagesReactMatrix({
    archivePath,
    typescriptBin,
}) {
    archivePath = realpathSync(archivePath);
    const archiveSha256 = createHash('sha256')
        .update(readFileSync(archivePath))
        .digest('hex');
    const sourceTests = [
        ['core', '../test/nativeFormPages.test.ts'],
        ['presentation', '../test/formPagePresentation.component.test.ts'],
    ].map(([name, path]) => [
        name,
        readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'),
    ]);
    const profiles = [];
    const versions = [];
    for (const [react, types, domTypes] of [
        ['18.3.1', '18.3.12', '18.3.1'],
        ['19.2.0', '19.2.2', '19.2.2'],
    ]) {
        const root = realpathSync(
            mkdtempSync(join(tmpdir(), 'sdk-native-form-pages-'))
        );
        let completed;
        try {
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': `file:${archivePath}`,
                        react,
                        'react-dom': react,
                        '@types/react': types,
                        '@types/react-dom': domTypes,
                        '@types/node': '22.20.5',
                        'happy-dom': '20.0.11',
                    },
                })
            );
            const receipt = installAgeQualifiedConsumer({
                directory: root,
                args: ['install', '--ignore-scripts'],
            });
            assert.equal(receipt.archiveSha256, archiveSha256);
            const run = (command, args) =>
                execFileSync(command, args, {
                    cwd: root,
                    encoding: 'utf8',
                    timeout: 120000,
                });
            const installed = join(root, 'node_modules/@miniextensions/sdk');
            const guide = readFileSync(
                join(installed, 'docs/native-form-pages.md'),
                'utf8'
            ).match(/```tsx\n([\s\S]*?)\n```/)?.[1];
            assert(
                guide,
                'The actual package must include its live-page guide'
            );
            for (const extension of ['mts', 'cts']) {
                const typedName = `native-form-pages.${extension}`;
                const guideName = `native-form-pages-guide.${extension}`;
                writeFileSync(
                    join(root, typedName),
                    nativeFormPagesTypedConsumer
                );
                writeFileSync(join(root, guideName), guide);
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
                    typedName,
                    guideName,
                ]);
            }
            writeFileSync(join(root, 'hydration.mjs'), hydrationRuntime);
            for (const format of ['esm', 'cjs']) {
                const extension = format === 'esm' ? 'mjs' : 'cjs';
                const files = sourceTests.map(([name, source]) => {
                    const installedSource = source
                        .replaceAll(
                            '../src/ui/nativeFormPages.js',
                            '@miniextensions/sdk/ui'
                        )
                        .replaceAll(
                            '../src/react/CompleteFormPageNavigation.js',
                            '@miniextensions/sdk/react'
                        )
                        .replaceAll(
                            '../src/react/CompleteFormReview.js',
                            '@miniextensions/sdk/react'
                        );
                    assert(
                        !installedSource.includes('../src/'),
                        'A package proof cannot import local implementation'
                    );
                    const filename = `${name}.${format}.test.${extension}`;
                    writeFileSync(
                        join(root, filename),
                        transformSync(installedSource, {
                            loader: 'ts',
                            format,
                            target: 'es2022',
                        }).code
                    );
                    return filename;
                });
                const output = run(process.execPath, [
                    '--test',
                    '--test-concurrency=1',
                    '--test-reporter=tap',
                    ...files,
                ]);
                assert.match(
                    output,
                    new RegExp(`# tests ${testsPerProfile}\\b`)
                );
                assert.match(
                    output,
                    new RegExp(`# pass ${testsPerProfile}\\b`)
                );
                assert.match(output, /# fail 0\b/);
                assert.match(output, /# skipped 0\b/);
                assert.match(output, /# cancelled 0\b/);
                const hydration = JSON.parse(
                    run(process.execPath, ['hydration.mjs', format])
                );
                assert.equal(hydration.react, react);
                assert.equal(hydration.format, format);
                assert.equal(hydration.checks, hydrationChecksPerProfile);
                assert.equal(hydration.hydrationErrors, 0);
                assert.equal(hydration.saveCallbacks, 1);
                assert.equal(hydration.networkRequests, 0);
                assert.deepEqual(hydration.payloads, [
                    'Edited after Confirm before allocation',
                ]);
                profiles.push({
                    react,
                    format,
                    tests: testsPerProfile,
                    hydration,
                    archiveSha256,
                    lockSha256: receipt.lockSha256,
                });
            }
            const esmCSS = readFileSync(
                join(installed, 'dist/esm/react/form-pages.css')
            );
            assert(
                esmCSS.equals(
                    readFileSync(
                        join(installed, 'dist/cjs/react/form-pages.css')
                    )
                ),
                'ESM and CommonJS must ship identical live-page styles'
            );
            writeFileSync(
                join(root, 'styles.css'),
                "@import '@miniextensions/sdk/react/form-pages.css';\n"
            );
            const style = await build({
                absWorkingDir: root,
                entryPoints: ['styles.css'],
                bundle: true,
                outfile: join(root, 'native-form-pages.css'),
                metafile: true,
            });
            await assertBrowserInputs(style.metafile, root);
            assert(
                Object.keys(style.metafile.inputs).some((path) =>
                    path.endsWith('/react/html-description.css')
                ),
                'The public stylesheet must carry the page HTML style closure'
            );
            const css = readFileSync(
                join(root, 'native-form-pages.css'),
                'utf8'
            );
            for (const token of [
                'mx-sdk-form-pages-progress',
                'mx-sdk-form-page-button',
                'mx-sdk-form-review-dialog',
                'mx-sdk-form-review-label--hidden',
                '32rem',
                '80vh',
            ])
                assert(css.includes(token), `Missing public CSS: ${token}`);
            for (const format of ['esm', 'cjs']) {
                const contents =
                    format === 'esm'
                        ? "import {createNativeFormPages} from '@miniextensions/sdk/ui'; import {CompleteFormPageNavigation,FormPageNavigationButton,CompleteFormReview} from '@miniextensions/sdk/react'; import '@miniextensions/sdk/react/form-pages.css'; console.log(createNativeFormPages,CompleteFormPageNavigation,FormPageNavigationButton,CompleteFormReview);"
                        : "const {createNativeFormPages}=require('@miniextensions/sdk/ui'); const {CompleteFormPageNavigation,FormPageNavigationButton,CompleteFormReview}=require('@miniextensions/sdk/react'); require('@miniextensions/sdk/react/form-pages.css'); console.log(createNativeFormPages,CompleteFormPageNavigation,FormPageNavigationButton,CompleteFormReview);";
                const entry = `browser-${format}-entry.${format === 'esm' ? 'mjs' : 'cjs'}`;
                writeFileSync(join(root, entry), contents);
                const bundled = await build({
                    absWorkingDir: root,
                    entryPoints: [entry],
                    bundle: true,
                    platform: 'browser',
                    format: 'iife',
                    outfile: join(root, `browser-${format}.js`),
                    write: false,
                    metafile: true,
                });
                await assertBrowserInputs(bundled.metafile, root);
            }
            assert.equal(
                createHash('sha256')
                    .update(readFileSync(archivePath))
                    .digest('hex'),
                archiveSha256,
                'The archive must remain unchanged throughout qualification'
            );
            completed = {
                react,
                profiles: 2,
                tests: testsPerProfile * 2,
                hydrationChecks: hydrationChecksPerProfile * 2,
                strictTypes: ['ESM', 'CJS'],
                styles: 'live-page + HTML closure',
                ...receipt,
            };
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
        assert(!existsSync(root), 'Owned consumer directory must be removed');
        versions.push(completed);
        console.log(JSON.stringify({ ...completed, cleanup: 'completed' }));
    }
    return {
        profiles,
        versions,
        tests: testsPerProfile * profiles.length,
        hydrationProfiles: profiles.length,
        hydrationChecks: hydrationChecksPerProfile * profiles.length,
        archiveSha256,
        cleanup: 'completed',
    };
}
