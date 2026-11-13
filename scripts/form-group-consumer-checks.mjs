import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

export const formGroupTypedConsumer = String.raw`
import {createElement} from 'react';
import {groupFormFieldsBySections,type FormSectionField,type FormFieldsGroup} from '@miniextensions/sdk/forms';
import {FormGroup,CompleteMultilineTextField,type FormGroupProps,type FormGroupPreview} from '@miniextensions/sdk/react';
const field=Object.freeze({id:'fld_email',name:'Email'});
const descriptors:readonly FormSectionField<typeof field>[]=[{field,sectionHeader:{title:'Contact',description:null,isExpanded:false}}];
const sections=groupFormFieldsBySections(descriptors);
const preview:FormGroupPreview={startFieldId:field.id,onSelectSection(id){const target:string=id;void target;}};
const props:FormGroupProps={title:'Contact',description:'<p>Details</p>',allFieldsHidden:false,hasError:true,isExpanded:false,isReadOnlyPage:true,preview,children:createElement(CompleteMultilineTextField,{id:field.id,value:null,onChange(value){const scalar:string=value;void scalar;}})};
createElement(FormGroup,props);
for(const section of sections)if(section.kind==='group'){const group:FormFieldsGroup<typeof field>=section;const original:typeof field=group.fieldsInSection[0];void original;}
// @ts-expect-error visibility is already resolved by the host
createElement(FormGroup,{...props,selectFieldVisibility(){return {};}});
// @ts-expect-error no canonical writer/Save capability is accepted
createElement(FormGroup,{...props,onSave(){}});
// @ts-expect-error no replacement host renderer is accepted
createElement(FormGroup,{...props,renderNative(){return null;}});
// @ts-expect-error page routing remains in host composition
createElement(FormGroup,{...props,pageMode:'multi-page'});
// @ts-expect-error readonly projection cannot replace field references
sections.push({kind:'field',field});
`;

// Execute in the installed consumer. Missing exports/CSS remain real failures;
// neither source aliases nor deep dist imports are permitted substitutes.
export const formGroupPublicContractProbe = String.raw`
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ui=await import('@miniextensions/sdk/react');
const forms=await import('@miniextensions/sdk/forms');
const missing=[];
if(typeof ui.FormGroup!=='function')missing.push('@miniextensions/sdk/react: FormGroup');
if(typeof forms.groupFormFieldsBySections!=='function')missing.push('@miniextensions/sdk/forms: groupFormFieldsBySections');
try{require.resolve('@miniextensions/sdk/react/form-group.css');}catch(error){missing.push('@miniextensions/sdk/react/form-group.css: '+error.code);}
console.log(JSON.stringify({missing}));
assert.deepEqual(missing,[],'Public FormGroup/grouping/CSS contract is incomplete');
`;

// Host-only canonical values and composition. The packed SDK owns grouping and
// disclosure presentation; this fixture creates no SDK client or transport.
const assembly = String.raw`
const model={value:'ada@example.com',sibling:'Adjacent draft',expanded:false,readonly:false,hidden:false,error:true,preview:false,mode:'one-page',theme:'indigo'};
const actions={writes:[],selected:[],submits:0};
let root;
function sections(){
 const prefix=React.createElement('span',{id:'ungrouped-prefix'},'Ungrouped prefix');
 const field=React.createElement(api.CompleteMultilineTextField,{key:'email',id:'fld_email',form:'group-form',value:model.value,readOnly:model.readonly,onChange(value){actions.writes.push(value);model.value=value;rerender();}});
 const input=[{field:prefix},{field,sectionHeader:{title:'Contact',description:'<p><strong>Contact details</strong><script>unexpected()</script></p>',isExpanded:model.expanded}}];
 const projected=forms.groupFormFieldsBySections(input);
 if(projected[0].field!==prefix||projected[1].fieldsInSection[0]!==field)throw Error('Host node identity/order changed');
 return projected;
}
function element(){return React.createElement(React.StrictMode,null,
 React.createElement('form',{id:'group-form',onSubmit(event){event.preventDefault();actions.submits++;}},
  React.createElement('label',{htmlFor:'adjacent-field'},'Adjacent field'),
  React.createElement('input',{id:'adjacent-field',value:model.sibling,onChange(event){model.sibling=event.target.value;rerender();}}),
  React.createElement('a',{id:'error-anchor',href:'#fld_email'},'Existing field error anchor'),
  React.createElement(api.ThemeBoundary,{theme:model.theme},
   sections().map((section,index)=>section.kind==='field'?React.createElement(React.Fragment,{key:'prefix'},section.field):
    model.mode==='one-page'?React.createElement(api.FormGroup,{key:'contact',title:section.title,description:section.description,isExpanded:section.isExpanded,isReadOnlyPage:model.readonly,allFieldsHidden:model.hidden,hasError:model.error,
     preview:model.preview?{startFieldId:'fld_email',onSelectSection(startFieldId){actions.selected.push({kind:'section',startFieldId});}}:undefined,
     children:section.fieldsInSection}):
    React.createElement('section',{key:'page-'+index,'data-host-page':true},React.createElement('h2',null,section.title),React.createElement(htmlApi.CompleteQuillHTMLRenderer,{html:section.description??''}),section.fieldsInSection))),
  model.mode==='one-page'?React.createElement(api.FormGroup,{title:'Readonly initial',description:'<p><em>Readonly help</em><script>privateReadonlyScript()</script></p>',allFieldsHidden:false,hasError:false,isReadOnlyPage:true,isExpanded:false,children:React.createElement('span',{id:'readonly-value'},'Readonly canonical value')}):React.createElement('section',{'data-host-readonly-page':true},React.createElement('span',{id:'readonly-value'},'Readonly canonical value'))));
}
function rerender(){root.render(element());}
`;

export const formGroupRuntimeConsumer =
    String.raw`
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import React from 'react';
const require=createRequire(import.meta.url),format=process.argv[2];
let api,forms,htmlApi;
const load=async()=>{
 api=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
 forms=format==='esm'?await import('@miniextensions/sdk/forms'):require('@miniextensions/sdk/forms');
 htmlApi=format==='esm'?await import('@miniextensions/sdk/react/html'):require('@miniextensions/sdk/react/html');
};
` +
    assembly +
    String.raw`
if(process.argv[4]==='--ssr'){
 assert.equal(typeof globalThis.window,'undefined');assert.equal(typeof globalThis.document,'undefined');await load();
 const {renderToString}=await import('react-dom/server');const html=renderToString(element());
 assert(html.includes('Readonly canonical value'));assert(html.includes('<em>Readonly help</em>'));assert(!html.includes('<script'));assert(!html.includes('privateReadonlyScript'));assert.equal(actions.submits,0);assert.deepEqual(actions.writes,[]);
 console.log(JSON.stringify({html,react:React.version}));process.exit(0);
}
const ssr=JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),format,process.argv[3],'--ssr'],{encoding:'utf8',stdio:['ignore','pipe','inherit']}));
assert.equal(ssr.react,React.version);
const {Window}=await import(pathToFileURL(process.argv[3]).href);
let requests=0;
const window=new Window({url:'https://form-group.invalid/local',settings:{fetch:{interceptor:{beforeAsyncRequest(){requests++;throw Error('Unexpected request');},beforeSyncRequest(){requests++;throw Error('Unexpected request');}}}}});
const keys=['window','document','navigator','Node','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','MutationObserver','ResizeObserver','getComputedStyle','fetch','IS_REACT_ACT_ENVIRONMENT'];
const originals=keys.map(key=>Object.getOwnPropertyDescriptor(globalThis,key));
for(const key of keys){let value=key==='IS_REACT_ACT_ENVIRONMENT'?true:key==='fetch'?async()=>{requests++;throw Error('Unexpected installed FormGroup fetch');}:window[key];if(key==='getComputedStyle')value=value.bind(window);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
const container=window.document.createElement('main');window.document.body.append(container);container.innerHTML=ssr.html;
const first=container.firstElementChild,errors=[];
const group=()=>container.querySelector('.mx-sdk-form-group');
const toggle=()=>group().querySelector('button[aria-expanded]');
const render=()=>React.act(async()=>rerender());
try{
 await load();const{hydrateRoot}=await import('react-dom/client');
 await React.act(async()=>{root=hydrateRoot(container,element(),{onRecoverableError:error=>errors.push(String(error))});});
 assert.equal(container.firstElementChild,first);assert.deepEqual(errors,[]);assert.equal(container.querySelector('textarea'),null);assert.equal(toggle().textContent,'Contact');assert(group().querySelector('.mx-sdk-form-group__error'));
 await React.act(async()=>toggle().click());const control=container.querySelector('textarea');assert(control);assert.equal(control.value,'ada@example.com');assert(container.querySelector('.mx-sdk-quill strong'));assert.equal(container.querySelector('script'),null);
 await React.act(async()=>{const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;setter.call(control,'grace@example.com');control.dispatchEvent(new window.InputEvent('input',{bubbles:true,inputType:'insertText',data:'grace@example.com'}));});
 assert.deepEqual(actions.writes,['grace@example.com']);await React.act(async()=>toggle().click());assert.equal(control.isConnected,false);assert.equal(container.querySelector('textarea'),null);
 await React.act(async()=>toggle().click());assert.equal(container.querySelector('textarea').value,'grace@example.com');assert.notEqual(container.querySelector('textarea'),control);
 await React.act(async()=>toggle().click());model.error=false;model.readonly=true;model.expanded=true;await render();assert.equal(group().querySelector('.mx-sdk-form-group__error'),null);assert.equal(container.querySelector('textarea'),null,'Defaults cannot force an existing disclosure open');
 model.preview=true;await render();assert.deepEqual(actions.selected,[]);await React.act(async()=>group().querySelector('.mx-sdk-form-group__title-button').click());assert.deepEqual(actions.selected,[{kind:'section',startFieldId:'fld_email'}]);assert.equal(toggle().getAttribute('aria-label'),'Expand Contact');assert.equal(container.querySelector('textarea'),null);
 await React.act(async()=>toggle().click());assert.equal(actions.selected.length,1);assert.equal(toggle().getAttribute('aria-label'),'Collapse Contact');
 model.hidden=true;await render();assert.equal(container.querySelectorAll('.mx-sdk-form-group').length,1);assert.equal(container.querySelector('textarea'),null);
 model.value='host-update-while-hidden@example.com';model.readonly=false;model.hidden=false;await render();assert.equal(container.querySelector('textarea').value,model.value);assert.deepEqual(actions.writes,['grace@example.com']);
 model.mode='multi-page';await render();assert.equal(container.querySelectorAll('[data-host-page]').length,1);assert.equal(container.querySelector('#group-form button[aria-expanded]'),null);assert.equal(container.querySelector('textarea').value,model.value);
 assert.equal(container.querySelector('#error-anchor').getAttribute('href'),'#fld_email');assert.equal(container.querySelector('#adjacent-field').value,'Adjacent draft');assert.deepEqual(actions.writes,['grace@example.com']);assert.deepEqual(actions.selected,[{kind:'section',startFieldId:'fld_email'}]);assert.equal(actions.submits,0);assert.equal(requests,0);assert.equal(window.localStorage.length,0);assert.equal(window.sessionStorage.length,0);
 await React.act(async()=>root.unmount());root=undefined;assert.equal(container.childElementCount,0);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({format,react:React.version,hydrationErrors:errors.length,networkRequests:requests,actions,cleanup:'completed'}));
}finally{try{if(root)await React.act(async()=>root.unmount());}finally{try{keys.forEach((key,index)=>{if(originals[index])Object.defineProperty(globalThis,key,originals[index]);else Reflect.deleteProperty(globalThis,key);});}finally{await window.happyDOM.close();}}}
`;

export function checkFormGroupReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-form-group-'));
    const run = (command, args, options = {}) =>
        execFileSync(command, args, {
            cwd: directory,
            stdio: 'inherit',
            ...options,
        });
    const versions = [];
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
        writeFileSync(
            join(directory, 'contract.mjs'),
            formGroupPublicContractProbe
        );
        writeFileSync(join(directory, 'runtime.mjs'), formGroupRuntimeConsumer);
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
            run(process.execPath, ['contract.mjs']);
            const installed = join(
                directory,
                'node_modules/@miniextensions/sdk'
            );
            const guide = readFileSync(
                join(installed, 'docs/form-groups.md'),
                'utf8'
            ).match(/```tsx\n([\s\S]*?)\n```/)?.[1];
            assert(guide, 'Missing packed FormGroup recipe');
            for (const extension of ['mts', 'cts']) {
                const file = 'form-group.' + extension;
                const guideFile = 'form-group-guide.' + extension;
                writeFileSync(join(directory, file), formGroupTypedConsumer);
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
            for (const name of [
                'form-group',
                'complete-multiline',
                'html-description',
            ]) {
                const css = readFileSync(
                    join(installed, 'dist/esm/react/' + name + '.css')
                );
                assert(css.length > 0);
                assert(
                    css.equals(
                        readFileSync(
                            join(installed, 'dist/cjs/react/' + name + '.css')
                        )
                    )
                );
            }
            run(process.execPath, [
                '--input-type=module',
                '-e',
                String.raw`
import{createRequire}from'node:module';const require=createRequire(import.meta.url),{buildSync}=require(process.argv[1]);
for(const format of ['esm','cjs']){
 const styles=['form-group','complete-multiline','html-description'].map(name=>format==='esm'?"import'@miniextensions/sdk/react/"+name+".css';":"require('@miniextensions/sdk/react/"+name+".css');").join('');
 const api=format==='esm'?"import{FormGroup}from'@miniextensions/sdk/react';import{groupFormFieldsBySections}from'@miniextensions/sdk/forms';console.log(FormGroup,groupFormFieldsBySections);":"console.log(require('@miniextensions/sdk/react').FormGroup,require('@miniextensions/sdk/forms').groupFormFieldsBySections);";
 buildSync({stdin:{contents:styles+api,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',outdir:'browser-output',write:false,logLevel:'silent'});
}`,
                esbuildModulePath,
            ]);
            versions.push({ react: version.react, formats });
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

export const formGroupBrowserStyle = String.raw`
body { margin: 2rem; font: 16px/1.5 system-ui; }
main { max-width: 48rem; margin: auto; }
#fixture-controls { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 1rem; }
#adjacent-field { display: block; margin-bottom: 1rem; }
[data-host-page] { border: 1px solid #ddd; padding: 1rem; }
`;

export const formGroupBrowserEntry =
    String.raw`
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import*as api from'@miniextensions/sdk/react';import*as forms from'@miniextensions/sdk/forms';import*as htmlApi from'@miniextensions/sdk/react/html';
` +
    assembly +
    String.raw`
const errors=[];let requests=0;window.addEventListener('error',event=>errors.push(event.message));window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
window.fetch=async()=>{requests++;throw Error('Unexpected FormGroup fixture fetch');};
XMLHttpRequest.prototype.open=function(){requests++;throw Error('Unexpected FormGroup fixture XHR');};
const controls=document.createElement('nav');controls.id='fixture-controls';controls.setAttribute('aria-label','Synthetic host controls');document.querySelector('main').append(controls);
const mount=document.createElement('div');document.querySelector('main').append(mount);root=createRoot(mount);flushSync(rerender);
function control(label,action){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',()=>flushSync(action));controls.append(button);}
control('Preview mode',()=>{model.preview=!model.preview;rerender();});
control('Readonly default',()=>{model.readonly=!model.readonly;rerender();});
control('Configured expansion',()=>{model.expanded=!model.expanded;rerender();});
control('Section error',()=>{model.error=!model.error;rerender();});
control('Hide all fields',()=>{model.hidden=!model.hidden;rerender();});
control('Host canonical replacement',()=>{model.value='host-update-while-hidden@example.com';rerender();});
control('Page mode',()=>{model.mode=model.mode==='one-page'?'multi-page':'one-page';rerender();});
control('Teal theme',()=>{model.theme='teal';rerender();});
window.__formGroupFixture={snapshot(){return{model:{...model},actions:JSON.parse(JSON.stringify(actions)),errors:[...errors],requests,storage:{local:localStorage.length,session:sessionStorage.length}};},unmount(){flushSync(()=>root.unmount());}};
window.__nativeProbe={snapshot:()=>window.__formGroupFixture.snapshot()};
`;

export async function prepareFormGroupBrowserFixtures({
    temporary,
    archive,
    readArchiveMember = (member) =>
        execFileSync('tar', ['-xOf', archive, member]),
    installed,
    allowed,
    report,
    build,
    assertBrowserInputs,
    regular,
    hash,
}) {
    const entry = join(temporary, 'form-group.mjs');
    writeFileSync(entry, formGroupBrowserEntry);
    const bundle = await build({
        absWorkingDir: temporary,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        outfile: join(temporary, 'form-group.js'),
        write: false,
        metafile: true,
        legalComments: 'none',
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await assertBrowserInputs(bundle.metafile, temporary);
    const inputs = Object.keys(bundle.metafile.inputs);
    for (const name of [
        '/react/FormGroup.js',
        '/forms/formSections.js',
        '/react/html/CompleteQuillHTMLRenderer.js',
    ])
        assert(
            inputs.some((input) => input.endsWith(name)),
            'Actual installed SDK input required: ' + name
        );
    const proofInputs = inputs.map((name) => {
        const path = realpathSync(resolve(temporary, name)),
            bytes = regular(path);
        const item = {
            path: relative(temporary, path),
            sha256: hash(bytes),
            bytes: bytes.length,
        };
        if (path.startsWith(installed + '/')) {
            const member =
                'package/' + relative(installed, path).replaceAll('\\', '/');
            assert.deepEqual(bytes, readArchiveMember(member));
            item.archiveMember = member;
        }
        return item;
    });
    const require = createRequire(join(temporary, 'package.json'));
    const links = [],
        packagedCss = [];
    for (const name of [
        'form-group',
        'complete-multiline',
        'html-description',
    ]) {
        const path = realpathSync(
            require.resolve('@miniextensions/sdk/react/' + name + '.css')
        );
        assert(path.startsWith(installed + '/'));
        const bytes = regular(path),
            member =
                'package/' + relative(installed, path).replaceAll('\\', '/');
        assert.deepEqual(bytes, readArchiveMember(member));
        packagedCss.push({ member, sha256: hash(bytes) });
        const route = '/form-group-' + name + '.css';
        allowed.set(route, bytes);
        links.push('<link rel="stylesheet" href="' + route + '">');
    }
    const code = bundle.outputFiles[0].contents;
    report.formGroup = {
        sourceSha256: hash(formGroupBrowserEntry),
        fixtureCssSha256: hash(formGroupBrowserStyle),
        packagedCss,
        bundleSha256: hash(code),
        bundleInputs: proofInputs,
    };
    allowed.set('/form-group.js', code);
    allowed.set('/form-group-fixture.css', Buffer.from(formGroupBrowserStyle));
    allowed.set(
        '/form-group.html',
        Buffer.from(
            "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'\"><title>Form groups</title>" +
                links.join('') +
                '<link rel="stylesheet" href="/form-group-fixture.css"></head><body><main></main><script type="module" src="/form-group.js"></script></body></html>'
        )
    );
    return { path: '/form-group.html' };
}

export async function checkFormGroupBrowser({ page, evidence }) {
    await page.waitForFunction(() => Boolean(window.__formGroupFixture));
    const groups = [];
    let expectedWrites = [];
    let expectedSelected = [];
    const first = () => page.locator('.mx-sdk-form-group').first();
    const toggle = () => first().locator('button[aria-expanded]');
    const verify = async (name) => {
        const snapshot = await page.evaluate(() =>
            window.__formGroupFixture.snapshot()
        );
        assert.deepEqual(snapshot.errors, []);
        assert.equal(snapshot.requests, 0);
        assert.equal(snapshot.actions.submits, 0);
        assert.deepEqual(snapshot.actions.writes, expectedWrites);
        assert.deepEqual(snapshot.actions.selected, expectedSelected);
        assert.equal(snapshot.storage.local, 0);
        assert.equal(snapshot.storage.session, 0);
        groups.push({ name, snapshot });
        return snapshot;
    };
    assert.equal(await page.locator('#fld_email').count(), 0);
    assert.equal(
        await page.locator('#readonly-value').textContent(),
        'Readonly canonical value'
    );
    await verify('initial readonly expansion has no host actions');
    const errorPaint = await first()
        .locator('.mx-sdk-form-group__error')
        .evaluate((node) => {
            const rect = node.getBoundingClientRect();
            return {
                background: getComputedStyle(node).backgroundColor,
                width: rect.width,
                height: rect.height,
            };
        });
    assert.equal(errorPaint.background, 'rgb(185, 28, 28)');
    assert.equal(errorPaint.width, 6);
    assert.equal(errorPaint.height, 6);
    await page.locator('#adjacent-field').fill('Browser adjacent draft');
    await toggle().focus();
    await page.keyboard.press('Enter');
    await page.locator('#fld_email').waitFor({ state: 'visible' });
    assert.equal(
        await toggle().evaluate((node) => node === document.activeElement),
        true
    );
    const paint = await toggle().evaluate((node) => {
        const s = getComputedStyle(node);
        return {
            background: s.backgroundColor,
            color: s.color,
            focus: s.boxShadow,
            width: node.getBoundingClientRect().width,
        };
    });
    assert.equal(paint.background, 'rgb(224, 231, 255)');
    assert.equal(paint.color, 'rgb(17, 24, 39)');
    assert.notEqual(paint.focus, 'none');
    assert(paint.width > 0);
    await toggle().hover();
    assert.equal(
        await toggle().evaluate(
            (node) => getComputedStyle(node).backgroundColor
        ),
        'rgb(199, 210, 254)'
    );
    await page.locator('#fld_email').fill('grace@example.com');
    expectedWrites = ['grace@example.com'];
    await toggle().focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#fld_email').count(), 0);
    await page.keyboard.press('Enter');
    assert.equal(
        await page.locator('#fld_email').inputValue(),
        'grace@example.com'
    );
    await verify(
        'trusted disclosure keys, actual theme/focus paint and canonical reopen'
    );
    await toggle().click();
    await page.locator('#error-anchor').click();
    assert.equal(new URL(page.url()).hash, '#fld_email');
    assert.equal(await page.locator('#fld_email').count(), 0);
    assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
    await page
        .getByRole('button', { name: 'Section error', exact: true })
        .click();
    assert.equal(await first().locator('.mx-sdk-form-group__error').count(), 0);
    await page
        .getByRole('button', { name: 'Readonly default', exact: true })
        .click();
    await page
        .getByRole('button', { name: 'Configured expansion', exact: true })
        .click();
    assert.equal(await page.locator('#fld_email').count(), 0);
    await page
        .getByRole('button', { name: 'Preview mode', exact: true })
        .click();
    await page.mouse.move(0, 0);
    await verify('preview render does not select or write');
    const title = first().getByRole('button', { name: 'Contact', exact: true });
    await title.focus();
    await page.keyboard.press('Enter');
    expectedSelected = [{ kind: 'section', startFieldId: 'fld_email' }];
    assert.equal(await page.locator('#fld_email').count(), 0);
    assert.equal(await toggle().getAttribute('aria-label'), 'Expand Contact');
    assert.deepEqual(
        (await verify('preview title selects without toggling')).actions
            .selected,
        [{ kind: 'section', startFieldId: 'fld_email' }]
    );
    assert.equal(
        await title.evaluate(
            (node) => getComputedStyle(node).boxShadow !== 'none'
        ),
        true
    );
    assert.equal(
        await title.evaluate(
            (node) => getComputedStyle(node.parentElement).backgroundColor
        ),
        'rgb(224, 231, 255)'
    );
    assert.equal(
        await title.evaluate(
            (node) => getComputedStyle(node.parentElement).color
        ),
        'rgb(17, 24, 39)'
    );
    await page.keyboard.press('Tab');
    assert.equal(
        await toggle().evaluate((node) => node === document.activeElement),
        true
    );
    assert.equal(
        await toggle().evaluate(
            (node) => getComputedStyle(node).boxShadow !== 'none'
        ),
        true
    );
    await page.keyboard.press('Space');
    assert.equal(await toggle().getAttribute('aria-label'), 'Collapse Contact');
    await page
        .getByRole('button', { name: 'Hide all fields', exact: true })
        .click();
    assert.equal(await page.locator('#fld_email').count(), 0);
    assert.equal(
        await page.getByText('Contact details', { exact: true }).count(),
        0
    );
    await page
        .getByRole('button', { name: 'Readonly default', exact: true })
        .click();
    await page
        .getByRole('button', {
            name: 'Host canonical replacement',
            exact: true,
        })
        .click();
    await page
        .getByRole('button', { name: 'Hide all fields', exact: true })
        .click();
    assert.equal(
        await page.locator('#fld_email').inputValue(),
        'host-update-while-hidden@example.com'
    );
    assert.equal(
        await page.locator('#adjacent-field').inputValue(),
        'Browser adjacent draft'
    );
    const before = await verify(
        'configured-only remount retains the host canonical value'
    );
    assert.equal(before.model.readonly, false);
    assert.equal(before.model.expanded, true);
    await page.getByRole('button', { name: 'Teal theme', exact: true }).click();
    await page.mouse.move(0, 0);
    assert.equal(
        await first()
            .locator('.mx-sdk-form-group__header')
            .evaluate((node) => getComputedStyle(node).backgroundColor),
        'rgb(204, 251, 241)'
    );
    await page.getByRole('button', { name: 'Page mode', exact: true }).click();
    assert.equal(await page.locator('[data-host-page]').count(), 1);
    assert.equal(
        await page.locator('#group-form button[aria-expanded]').count(),
        0
    );
    assert.equal(
        await page.locator('#fld_email').inputValue(),
        before.model.value
    );
    assert.equal(
        await page.locator('#error-anchor').getAttribute('href'),
        '#fld_email'
    );
    await page.locator('#error-anchor').click();
    assert.equal(new URL(page.url()).hash, '#fld_email');
    await verify(
        'host-controlled multipage composition has no disclosure and preserves anchors'
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.locator('#fld_email').isVisible());
    await page.evaluate(() => window.__formGroupFixture.unmount());
    assert.equal(await page.locator('#group-form').count(), 0);
    await verify('unmount preserves action counts and no-I/O state');
    evidence.groups = groups;
    evidence.paint = paint;
    evidence.errorPaint = errorPaint;
    evidence.cleanup = 'component unmounted';
    evidence.boundaries = [
        'Synthetic host state only; no native Redux, backend Save or routing certification.',
        'Normal runner retains network, browser, server and installed-consumer cleanup checks.',
    ];
}
