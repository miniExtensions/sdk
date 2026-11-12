import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const formats = ['esm', 'cjs'];
const within = (root, path) => {
    const part = relative(root, path);
    return part === '' || (!part.startsWith('..') && !isAbsolute(part));
};
const fixtureStyle = String.raw`body {margin:16px;font-family:Arial,sans-serif;color:#111827}
#root form {width:840px;max-width:100%;display:grid;grid-template-columns:minmax(0,480px) minmax(0,1fr);gap:24px;align-items:start}
.fixture-primary,.fixture-neighbors {min-width:0}
#adjacent {display:block;margin-top:16px}
#root form.fixture-legacy-layout {display:block;width:480px}
.fixture-legacy-layout .fixture-primary,.fixture-legacy-layout .fixture-neighbors {display:contents}
.mx-sdk-complete-collaborators.fixture-portable-theme {
 --mx-sdk-collaborator-accent:#7e22ce;
 --mx-sdk-collaborator-tint:#faf5ff;
 --mx-sdk-collaborator-focus:#ea580c;
 --mx-sdk-collaborator-active:#166534;
}
`;
const avatar =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2563eb"/></svg>';

/** Require an actual nonmodal neighbor, rather than a control beneath the popup. */
export function assertCollaboratorNeighborTarget(measurement) {
    assert(measurement != null, 'Neighbor measurement is required');
    const validRect = (rect) =>
        rect != null &&
        [rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite) &&
        rect.right > rect.left &&
        rect.bottom > rect.top;
    assert(
        validRect(measurement.targetRect),
        'Neighbor target has no hit area'
    );
    assert(validRect(measurement.popupRect), 'Open popup has no hit area');
    assert.equal(measurement.visible, true, 'Neighbor target is not visible');
    assert.equal(measurement.disabled, false, 'Neighbor target is disabled');
    assert.equal(measurement.inert, false, 'Neighbor target is inert');
    assert.equal(
        measurement.ariaHidden,
        false,
        'Neighbor target is ARIA-hidden'
    );
    const x = (measurement.targetRect.left + measurement.targetRect.right) / 2;
    const y = (measurement.targetRect.top + measurement.targetRect.bottom) / 2;
    const popup = measurement.popupRect;
    assert(
        !(
            x >= popup.left &&
            x < popup.right &&
            y >= popup.top &&
            y < popup.bottom
        ),
        'Neighbor target center overlaps the open popup'
    );
    assert.equal(
        measurement.hitTarget,
        true,
        'Neighbor target center is occluded'
    );
    return measurement;
}

export function completeCollaboratorBrowserSource(format) {
    const imports =
        format === 'esm'
            ? `import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {CompleteSingleCollaboratorField,MultipleCollaboratorsField} from '@miniextensions/sdk/react';\n`
            : `const React = require('react');
const {createRoot} = require('react-dom/client');
const {flushSync} = require('react-dom');
const {CompleteSingleCollaboratorField,MultipleCollaboratorsField} = require('@miniextensions/sdk/react');\n`;
    return (
        imports +
        `const format = ${JSON.stringify(format)};\n` +
        String.raw`
// Real public components, controlled native objects and explicit current-action
// authority. No client, binding, native renderer or identity lookup is supplied.
const people = Object.freeze({
 A:Object.freeze({id:'usrAlpha',name:'Alpha Person',email:'alpha@example.invalid',profilePicUrl:'https://supplied.invalid/alpha.png',extra:'original A'}),
 B:Object.freeze({id:'usrBeta',name:'Beta Person',email:'beta@example.invalid',profilePicUrl:'https://supplied.invalid/beta.png',extra:'original B'}),
 C:Object.freeze({id:'usrRetired',name:'Retired Person',email:'retired@example.invalid',profilePicUrl:'https://not-approved.invalid/retired.png',extra:'stored C'}),
 Adup:Object.freeze({id:'usrAlpha',name:'Alpha second occurrence',email:'alpha-duplicate@example.invalid',extra:'original duplicate'}),
 literal:Object.freeze({id:'usrLiteral',name:'',email:'<img src=x onerror="identityLookup()">',extra:'literal label'}),
});
const state={errors:[],requests:0,submits:0,parentClicks:0,parentKeys:0,siblingActions:0,writes:[],mounts:0,cleanups:0,committed:0};
window.addEventListener('error',event=>state.errors.push(String(event.error||event.message)));
window.addEventListener('unhandledrejection',event=>state.errors.push(String(event.reason)));
window.fetch=async()=>{state.requests++;throw Error('Collaborator fixture cannot fetch');};
XMLHttpRequest.prototype.open=function(){state.requests++;throw Error('Collaborator fixture cannot use XHR');};
const scopes=new Map();
const scopeFor=key=>{if(!scopes.has(key))scopes.set(key,{});return scopes.get(key);};
const authority={active:true,token:scopeFor('A')};
const sources=new Set();
const sourcePolicy={type:'source',getSource(url){
 sources.add(url);
 return url==='https://supplied.invalid/alpha.png'||url==='https://supplied.invalid/beta.png'
  ?{src:'/complete-collaborator-avatar.svg',loading:'eager',decoding:'async'}:null;
}};
const tag=value=>value===null?null:Object.keys(people).find(key=>people[key]===value)||'FOREIGN';
const tags=value=>Array.isArray(value)?value.map(tag):tag(value);
let model={mode:'single',value:null,choices:[people.A,people.B],ownerKey:'A',readOnly:false,
 visible:true,mounted:true,refuseChanges:false,images:'source',writer:'initial',revision:0,
 placeholder:'Find a colleague',availableOptions:'Offered people',helpId:'collaborator-help',errorId:'collaborator-error',invalid:true,portableTheme:false};
let root,setModel,saved;
const settled=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function snapshot(){
 const field=document.querySelector('#field'),input=field?.querySelector('input[role=combobox]');
 return {...state,errors:[...state.errors],writes:state.writes.map(item=>({...item})),format,reactVersion:React.version,
  mode:model.mode,valueTags:tags(model.value),choiceTags:model.choices.map(tag),ownerKey:model.ownerKey,
  active:authority.active,readOnly:model.readOnly,disabled:model.disabled,visible:model.visible,mounted:model.mounted,
  focusedId:document.activeElement?.id||null,
  input:input?{id:input.id,form:input.form?.id,describedBy:input.getAttribute('aria-describedby'),invalid:input.getAttribute('aria-invalid'),query:input.value}:null,
  badges:Array.from(field?.querySelectorAll('.mx-sdk-collaborator-name')||[],node=>node.textContent),
  options:Array.from(document.querySelectorAll('[role=option]'),node=>({text:node.textContent,selected:node.getAttribute('aria-selected')})),
  images:Array.from(field?.querySelectorAll('img')||[],node=>({src:node.getAttribute('src'),alt:node.alt,width:node.width,height:node.height,naturalWidth:node.naturalWidth})),
  suppliedAvatarSources:Array.from(sources),
  saved:saved?{connected:saved.isConnected}:null,
  sameInput:input!=null&&input===window.__rememberedCollaboratorInput,
  adjacent:document.getElementById('adjacent')?.value??null,
 };
}
function App({initial}){
 const [current,update]=React.useState(initial);setModel=update;
 const scope=scopeFor(current.ownerKey);
 React.useEffect(()=>{state.mounts++;return()=>state.cleanups++;},[]);
 React.useLayoutEffect(()=>{model=current;state.committed++;});
 const labels={placeholder:current.placeholder,availableOptions:current.availableOptions,
  noMatches:'No supplied match',empty:'No collaborators supplied',open:'Open supplied choices',remove:label=>'Remove person '+label};
 const common={choices:current.choices,owner:{token:scope,isCurrent:()=>authority.active&&authority.token===scope},
  readOnly:current.readOnly,disabled:current.disabled,visible:current.visible,inputId:'native-collaborator',formId:'collaborator-form',
  describedBy:current.helpId+' '+current.errorId,invalid:current.invalid,labels,
  className:current.portableTheme?'fixture-portable-theme':undefined,
  avatarPolicy:current.images==='source'?sourcePolicy:{type:'none'},
  onValueChange(next){
   const values=Array.isArray(next)?next:next===null?[]:[next];
   state.writes.push({mode:current.mode,valueTags:tags(next),originalObjects:values.every(value=>tag(value)!=='FOREIGN'),
    writer:current.writer,adjacent:document.getElementById('adjacent')?.value});
   if(!current.refuseChanges)update(previous=>({...previous,value:next,revision:previous.revision+1}));
  }};
 const component=current.mode==='single'?CompleteSingleCollaboratorField:MultipleCollaboratorsField;
 return React.createElement('form',{id:'collaborator-form',onSubmit(event){event.preventDefault();state.submits++;}},
  React.createElement('div',{className:'fixture-primary'},
   React.createElement('label',{htmlFor:'native-collaborator'},'Synthetic collaborator'),
   React.createElement('p',{id:current.helpId},'Supplied collaborator help'),
   React.createElement('p',{id:current.errorId},'Supplied collaborator error'),
   React.createElement('section',{id:'field',onClick:()=>state.parentClicks++,onKeyDown:()=>state.parentKeys++},
    current.mounted?React.createElement(component,{...common,mode:current.mode==='multiple'?'controlled':undefined,value:current.value}):null)),
  React.createElement('div',{className:'fixture-neighbors'},
   React.createElement('label',{htmlFor:'adjacent'},'Adjacent draft'),
   React.createElement('input',{id:'adjacent',defaultValue:'Keep adjacent dirty value'}),
   React.createElement('button',{id:'adjacent-action',type:'button',onClick:()=>state.siblingActions++},'Adjacent action'),
   React.createElement('button',{type:'submit'},'Explicit Save')));
}
function mount(){
 root=createRoot(document.getElementById('root'));
 flushSync(()=>root.render(React.createElement(React.StrictMode,null,React.createElement(App,{initial:model}))));
}
window.__nativeProbe={snapshot};
window.__collaboratorFixture={
 snapshot,
 async configure(patch){
  if('ownerKey' in patch)authority.token=scopeFor(patch.ownerKey);
  if('active' in patch)authority.active=patch.active;
  flushSync(()=>setModel(previous=>{
   const next={...previous,...patch,revision:previous.revision+1};
   if('valueTags' in patch)next.value=Array.isArray(patch.valueTags)?patch.valueTags.map(key=>people[key]):patch.valueTags===null?null:people[patch.valueTags];
   if('choiceTags' in patch)next.choices=patch.choiceTags.map(key=>people[key]);
   if(patch.equivalentEcho){if(Array.isArray(next.value))next.value=[...next.value];next.choices=[...next.choices];}
   if(patch.policyDefaults==='omitted'){next.readOnly=undefined;next.disabled=undefined;next.visible=undefined;}
   if(patch.policyDefaults==='explicit'){next.readOnly=false;next.disabled=false;next.visible=true;}
   return next;
  }));
  await settled();return snapshot();
 },
 retire(){authority.active=false;return snapshot();},
 capture(selector){saved=document.querySelector(selector);if(!saved)throw Error('Current retained DOM target missing');return snapshot();},
 async clickSaved(){saved?.click();await settled();return snapshot();},
 rememberInput(){window.__rememberedCollaboratorInput=document.querySelector('#field input[role=combobox]');return snapshot();},
 async unmount(){if(root){flushSync(()=>root.unmount());root=null;}await settled();return snapshot();},
 async remount(){if(root)throw Error('Unmount before remount');mount();await settled();return snapshot();},
};
mount();
`
    );
}

/** Add only exact packed-consumer resources to the existing server's map. */
export async function prepareCompleteCollaboratorFixtures({
    temporary,
    archive,
    installed,
    allowed,
    report,
    build,
    assertBrowserInputs,
    regular,
    hash,
}) {
    temporary = realpathSync(temporary);
    installed = realpathSync(installed);
    assert(within(temporary, installed), 'Clean installed SDK required');
    const consumer = createRequire(join(temporary, 'package.json'));
    const reactVersion = JSON.parse(
        regular(realpathSync(consumer.resolve('react/package.json')))
    ).version;
    const cssPath = realpathSync(
        consumer.resolve('@miniextensions/sdk/react/complete-collaborators.css')
    );
    assert(within(installed, cssPath));
    const css = regular(cssPath);
    const cssMember =
        'package/' + relative(installed, cssPath).replaceAll('\\', '/');
    assert.deepEqual(css, execFileSync('tar', ['-xOf', archive, cssMember]));
    allowed.set('/complete-collaborators.css', css);
    allowed.set(
        '/complete-collaborator-fixture.css',
        Buffer.from(fixtureStyle)
    );
    allowed.set('/complete-collaborator-avatar.svg', Buffer.from(avatar));
    report.completeCollaborators = {};
    const routes = {};
    for (const format of formats) {
        const source = completeCollaboratorBrowserSource(format);
        const entry = join(
            temporary,
            `complete-collaborators-${format}.${format === 'esm' ? 'mjs' : 'cjs'}`
        );
        writeFileSync(entry, source);
        const bundled = await build({
            absWorkingDir: temporary,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            target: 'es2022',
            write: false,
            outfile: join(temporary, `complete-collaborators-${format}.js`),
            metafile: true,
            legalComments: 'none',
            define: { 'process.env.NODE_ENV': '"development"' },
        });
        await assertBrowserInputs(bundled.metafile, temporary);
        const inputs = [];
        for (const name of Object.keys(bundled.metafile.inputs)) {
            assert(
                !name.startsWith('node:'),
                'Node input in collaborator browser'
            );
            const path = realpathSync(resolve(temporary, name));
            assert(
                within(temporary, path),
                'Collaborator input escaped consumer'
            );
            const bytes = regular(path);
            const item = {
                path: relative(temporary, path),
                sha256: hash(bytes),
                bytes: bytes.length,
            };
            if (within(installed, path)) {
                const packagePath = relative(installed, path).replaceAll(
                    '\\',
                    '/'
                );
                // The ordinary React barrel reaches Address's shared closure.
                // Admit only its three shipped runtime files and bind their
                // bytes to this archive, just like the format-specific child.
                assert(
                    within(join(installed, 'dist', format), path) ||
                        within(
                            join(installed, 'dist/vendor/phone-number-input'),
                            path
                        ) ||
                        within(
                            join(installed, 'dist/vendor/rich-markdown-editor'),
                            path
                        ) ||
                        [
                            'dist/vendor/headlessui-address/combobox.js',
                            'dist/vendor/headlessui-address/react-peer.js',
                            'dist/vendor/headlessui-address/sdk-runtime.js',
                        ].includes(packagePath),
                    `Collaborator browser imported source or wrong SDK format: ${packagePath}`
                );
                item.archiveMember = 'package/' + packagePath;
                assert.deepEqual(
                    bytes,
                    execFileSync('tar', ['-xOf', archive, item.archiveMember])
                );
            }
            inputs.push(item);
        }
        const child = inputs.find(
            (item) =>
                item.archiveMember ===
                `package/dist/${format}/react/CompleteCollaboratorField.js`
        );
        assert(child, 'Actual packed complete collaborator field missing');
        const runtime = inputs.find(
            (item) =>
                item.archiveMember ===
                `package/dist/${format}/react/completeCollaboratorPickerRuntime.js`
        );
        assert(
            runtime,
            'Actual packed lazy collaborator picker runtime missing'
        );
        assert(
            inputs.some((item) => item.path.endsWith('/react.development.js'))
        );
        assert(
            inputs.some((item) =>
                /react-dom(?:-client)?\.development\.js$/.test(item.path)
            )
        );
        assert(
            !inputs.some((item) =>
                /(?:react|react-dom(?:-client)?)\.production/.test(item.path)
            ),
            'Development React required for actual StrictMode replay'
        );
        assert(
            !inputs.some((item) => /[/\\]@headlessui[/\\]/.test(item.path)),
            'Picker closure must be shipped by SDK, not supplied by consumer'
        );
        const code = bundled.outputFiles[0].contents;
        const route = `/complete-collaborators-${format}.html`;
        routes[format] = route;
        allowed.set(`/complete-collaborators-${format}.js`, code);
        allowed.set(
            route,
            Buffer.from(
                `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Standalone complete collaborators ${format}</title><link rel="stylesheet" href="/complete-collaborators.css"><link rel="stylesheet" href="/complete-collaborator-fixture.css"></head><body><div id="root"></div><script type="module" src="/complete-collaborators-${format}.js"></script></body></html>`
            )
        );
        report.completeCollaborators[format] = {
            format,
            route,
            mode: 'development',
            reactVersion,
            sourceSha256: hash(source),
            fixtureCssSha256: hash(fixtureStyle),
            avatarSha256: hash(avatar),
            packagedCssMember: cssMember,
            packagedCssSha256: hash(css),
            packagedChildMember: child.archiveMember,
            packagedChildSha256: child.sha256,
            packagedRuntimeMember: runtime.archiveMember,
            packagedRuntimeSha256: runtime.sha256,
            bundleSha256: hash(code),
            bundleInputs: inputs,
            limits: [
                'Controlled supplied objects and explicit current-action authority, without a native Form binding or backend persistence.',
                'Real Chromium popup, keyboard, pointer, focus and supplied local-avatar rendering; no identity or membership service.',
                'Callback-throw component proof remains separate; native pageerror and network guards are unchanged.',
            ],
        };
    }
    return { formats: [...formats], routes };
}

/** Existing run() owns navigation, page errors, network policy and teardown. */
export async function checkCompleteCollaboratorBrowser({
    page,
    evidence,
    format,
    output,
}) {
    assert(formats.includes(format));
    assert.equal(evidence.format, format);
    const snapshot = () =>
        page.evaluate(() => window.__collaboratorFixture.snapshot());
    const configure = async (patch) => {
        const value = await page.evaluate(
            (patch) => window.__collaboratorFixture.configure(patch),
            patch
        );
        await ready(value);
        return snapshot();
    };
    const input = () =>
        page.getByRole('combobox', { name: 'Synthetic collaborator' });
    const remove = (label) =>
        page.getByRole('button', {
            name: `Remove person ${label}`,
            exact: true,
        });
    const adjacent = page.getByRole('textbox', { name: 'Adjacent draft' });
    const ready = async (value) => {
        if (value === undefined) value = await snapshot();
        if (
            value.readOnly === true ||
            value.disabled === true ||
            value.visible === false ||
            value.mounted === false
        )
            return;
        const selector = value.mode !== 'single' || value.valueTags === null;
        await page.waitForFunction(
            (selector) => {
                const node = document.querySelector(
                    selector
                        ? '#field input[role="combobox"]'
                        : '#field button.mx-sdk-collaborator-remove'
                );
                return (
                    node != null &&
                    !node.disabled &&
                    node.getAttribute('aria-busy') !== 'true' &&
                    (!selector || node.hasAttribute('aria-expanded'))
                );
            },
            selector,
            { timeout: 5000 }
        );
    };
    const measureNeighbor = (selector) =>
        page.evaluate((selector) => {
            const target = document.querySelector(selector);
            const popup = document.querySelector('#field [role="listbox"]');
            if (!target || !popup)
                throw new Error('Current fixture neighbor and popup required');
            const targetBox = target.getBoundingClientRect();
            const popupBox = popup.getBoundingClientRect();
            const rect = (box) => ({
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
            });
            const hit = document.elementFromPoint(
                (targetBox.left + targetBox.right) / 2,
                (targetBox.top + targetBox.bottom) / 2
            );
            const style = getComputedStyle(target);
            return {
                targetRect: rect(targetBox),
                popupRect: rect(popupBox),
                visible:
                    target.getClientRects().length > 0 &&
                    style.display !== 'none' &&
                    style.visibility === 'visible',
                disabled: target.matches(':disabled'),
                inert: target.closest('[inert]') != null,
                ariaHidden: target.closest('[aria-hidden="true"]') != null,
                hitTarget:
                    hit != null && (target === hit || target.contains(hit)),
                hitPopup: hit != null && (popup === hit || popup.contains(hit)),
                hit: hit
                    ? {
                          tagName: hit.tagName,
                          id: hit.id,
                          role: hit.getAttribute('role'),
                          className:
                              typeof hit.className === 'string'
                                  ? hit.className
                                  : null,
                      }
                    : null,
            };
        }, selector);
    const legacyLayout = (enabled) =>
        page.evaluate((enabled) => {
            const form = document.getElementById('collaborator-form');
            if (!form) throw new Error('Current fixture form required');
            form.classList.toggle('fixture-legacy-layout', enabled);
        }, enabled);
    const portableStyles = () =>
        page.evaluate(() => {
            const root = document.querySelector(
                '#field .mx-sdk-complete-collaborators'
            );
            const control = root?.querySelector('.mx-sdk-collaborator-picker');
            const input = root?.querySelector('input[role="combobox"]');
            const popup = root?.querySelector('[role="listbox"]');
            const row = popup?.querySelector('[role="option"]');
            const active = popup?.querySelector('[role="option"][data-focus]');
            const badge = root?.querySelector('.mx-sdk-collaborator-badge');
            const box = (node) => {
                if (!node) return null;
                const rect = node.getBoundingClientRect();
                return {
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                };
            };
            const style = (node) => {
                if (!node) return null;
                const computed = getComputedStyle(node);
                return {
                    position: computed.position,
                    display: computed.display,
                    visibility: computed.visibility,
                    zIndex: computed.zIndex,
                    color: computed.color,
                    backgroundColor: computed.backgroundColor,
                    borderColor: computed.borderColor,
                    outlineColor: computed.outlineColor,
                };
            };
            const describedBy = input?.getAttribute('aria-describedby') ?? null;
            return {
                publicRoot: root != null,
                stylesheetPaths: Array.from(
                    document.querySelectorAll('link[rel="stylesheet"]'),
                    (link) => new URL(link.href).pathname
                ),
                control: { box: box(control), style: style(control) },
                popup: { box: box(popup), style: style(popup) },
                row: { box: box(row), style: style(row) },
                active: {
                    box: box(active),
                    style: style(active),
                    labelStyle: style(
                        active?.querySelector(
                            '.mx-sdk-collaborator-option-text span'
                        )
                    ),
                },
                badge: {
                    box: box(badge),
                    style: style(badge),
                    labelStyle: style(
                        badge?.querySelector('.mx-sdk-collaborator-name')
                    ),
                },
                describedBy,
                descriptions:
                    describedBy?.split(/\s+/).map((id) => ({
                        id,
                        text: document.getElementById(id)?.textContent ?? null,
                    })) ?? [],
                invalid: input?.getAttribute('aria-invalid') ?? null,
            };
        });
    const assertPopupLayout = (value) => {
        assert.equal(value.publicRoot, true);
        assert.deepEqual(value.stylesheetPaths, [
            '/complete-collaborators.css',
            '/complete-collaborator-fixture.css',
        ]);
        assert(value.control.box?.width > 100);
        assert(value.control.box?.height > 0);
        assert.equal(value.popup.style?.position, 'absolute');
        assert(Number(value.popup.style.zIndex) > 0);
        assert(value.popup.box?.width > 100 && value.popup.box?.height > 0);
        assert(
            Math.abs(value.popup.box.width - value.control.box.width) <=
                Math.max(4, value.control.box.width * 0.02),
            'Popup must span its actual picker control'
        );
        assert(value.popup.box.top >= value.control.box.bottom - 1);
        assert.equal(value.row.style?.visibility, 'visible');
        assert.notEqual(value.row.style?.display, 'none');
        assert(value.row.box?.width > 0 && value.row.box?.height > 0);
        assert(value.row.box.left >= value.popup.box.left - 1);
        assert(value.row.box.right <= value.popup.box.right + 1);
    };
    const assertDescriptions = (value, helpId, errorId, invalid = 'true') => {
        assert.equal(value.describedBy, `${helpId} ${errorId}`);
        assert.deepEqual(value.descriptions, [
            { id: helpId, text: 'Supplied collaborator help' },
            { id: errorId, text: 'Supplied collaborator error' },
        ]);
        assert.equal(value.invalid, invalid);
    };
    const canonical = (expected) =>
        page.waitForFunction(
            (expected) =>
                JSON.stringify(
                    window.__collaboratorFixture.snapshot().valueTags
                ) === JSON.stringify(expected),
            expected,
            { timeout: 5000 }
        );
    const writeCount = async (expected) => {
        await page.waitForFunction(
            (expected) =>
                window.__collaboratorFixture.snapshot().writes.length >=
                expected,
            expected,
            { timeout: 5000 }
        );
        assert.equal((await snapshot()).writes.length, expected);
    };
    const groups = [];
    // Keep completed groups even when a later browser assertion fails.
    evidence.browserGroups = groups;
    const record = async (name) => {
        const value = await snapshot();
        assert.deepEqual(value.errors, []);
        assert.equal(value.requests, 0);
        assert.equal(value.submits, 0);
        assert.equal(value.parentClicks, 0);
        assert.equal(value.parentKeys, 0);
        assert.equal(value.adjacent, 'Keep adjacent dirty value');
        assert.equal(value.reactVersion, evidence.reactVersion);
        assert.equal(value.format, format);
        assert(value.writes.every((write) => write.originalObjects));
        groups.push({ name, state: value });
        return value;
    };
    const fullEmailResults = async (query, names) => {
        const before = await snapshot();
        await input().fill(query);
        const options = page.getByRole('option');
        await options.nth(names.length - 1).waitFor();
        assert.equal(await options.count(), names.length);
        for (const [index, name] of names.entries())
            assert.equal(
                await options
                    .nth(index)
                    .getByText(name, { exact: true })
                    .count(),
                1
            );
        const value = await snapshot();
        assert.equal(value.input.query, query);
        assert.deepEqual(value.valueTags, before.valueTags);
        assert.equal(value.writes.length, before.writes.length);
    };
    const select = async (query, keyboard = false) => {
        await ready();
        await input().fill(query);
        const option = page.getByRole('option');
        await option.waitFor();
        assert.equal(await option.count(), 1);
        if (keyboard) {
            await input().press('ArrowDown');
            await input().press('Enter');
        } else await option.click();
    };
    let failure;
    try {
        await page.waitForFunction(
            () => window.__nativeProbe?.snapshot().committed > 0
        );
        await ready();
        let value = await snapshot();
        assert(value.mounts >= 2 && value.cleanups >= 1);
        assert.deepEqual(value.input, {
            id: 'native-collaborator',
            form: 'collaborator-form',
            describedBy: 'collaborator-help collaborator-error',
            invalid: 'true',
            query: '',
        });
        assert.equal(
            await input().getAttribute('placeholder'),
            'Find a colleague'
        );
        assert.equal(
            await page.locator('#field button[type=submit]').count(),
            0
        );
        assert.equal(await input().getAttribute('aria-expanded'), 'false');
        assert.equal(value.valueTags, null);
        assert.equal(value.writes.length, 0);
        for (const phase of [
            'empty input click',
            'focused empty input reclick',
            'trusted mouse arrow click',
            'focused input reclick after mouse arrow history',
        ]) {
            if (phase === 'trusted mouse arrow click')
                await page
                    .getByRole('button', {
                        name: 'Open supplied choices',
                        exact: true,
                    })
                    .click();
            else await input().click();
            await page.getByRole('listbox').waitFor({
                state: 'visible',
                timeout: 5000,
            });
            assert.equal(
                await input().getAttribute('aria-expanded'),
                'true',
                phase
            );
            const options = page.getByRole('option');
            assert.equal(await options.count(), 2, phase);
            assert.match(await options.nth(0).textContent(), /Alpha Person/);
            assert.match(await options.nth(1).textContent(), /Beta Person/);
            value = await snapshot();
            assert.equal(value.input.query, '', phase);
            assert.equal(value.valueTags, null, phase);
            assert.equal(value.writes.length, 0, phase);
            await input().press('Escape');
            await page.getByRole('listbox').waitFor({
                state: 'hidden',
                timeout: 5000,
            });
            assert.equal(await input().getAttribute('aria-expanded'), 'false');
            assert.equal(
                await input().evaluate(
                    (node) => node === document.activeElement
                ),
                true,
                phase
            );
        }
        await input().fill('Alpha');
        await input().press('End');
        await input().press('Space');
        assert.equal(await input().inputValue(), 'Alpha ');
        assert.equal(await input().getAttribute('aria-expanded'), 'true');
        assert.equal(
            await input().evaluate((node) => node === document.activeElement),
            true
        );
        await page.keyboard.type('Person');
        assert.equal(await input().inputValue(), 'Alpha Person');
        const spacedOption = page.getByRole('option');
        await spacedOption.waitFor({ state: 'visible', timeout: 5000 });
        assert.equal(await spacedOption.count(), 1);
        assert.match(await spacedOption.textContent(), /Alpha Person/);
        value = await snapshot();
        assert.equal(value.input.query, 'Alpha Person');
        assert.equal(value.valueTags, null);
        assert.equal(value.writes.length, 0);
        await input().fill('');
        await input().press('Escape');
        await page.getByRole('listbox').waitFor({
            state: 'hidden',
            timeout: 5000,
        });
        assert.equal(await input().getAttribute('aria-expanded'), 'false');
        value = await snapshot();
        assert.equal(value.input.query, '');
        assert.equal(value.valueTags, null);
        assert.equal(value.writes.length, 0);
        await record(
            'real StrictMode/physical ARIA, empty input and arrow-history reclick open real offers; Space types literal query text without a write or submit'
        );

        await input().fill('Alph Person');
        await page.getByRole('option').waitFor();
        assert.match(
            await page.getByRole('option').textContent(),
            /Alpha Person/
        );
        await page.getByText('Offered people', { exact: true }).waitFor();
        const defaultPopup = await portableStyles();
        assertPopupLayout(defaultPopup);
        assertDescriptions(
            defaultPopup,
            'collaborator-help',
            'collaborator-error'
        );
        assert.equal(
            defaultPopup.control.style.borderColor,
            'rgb(37, 99, 235)'
        );
        evidence.portableCss = { defaultPopup };
        evidence.neighborTargets = {};
        let legacyFailure;
        try {
            await legacyLayout(true);
            const legacyAction = await measureNeighbor('#adjacent-action');
            const legacyInput = await measureNeighbor('#adjacent');
            evidence.neighborTargets.legacy = {
                action: legacyAction,
                input: legacyInput,
            };
            await page.screenshot({
                path: join(
                    output,
                    `complete-collaborators-${format}-legacy-overlap.png`
                ),
                fullPage: true,
            });
            assert.equal(legacyAction.visible, true);
            assert.equal(legacyAction.disabled, false);
            assert.equal(legacyAction.inert, false);
            assert.equal(legacyAction.ariaHidden, false);
            assert.equal(
                legacyAction.hitPopup,
                true,
                'Original vertical fixture must reproduce the popup interception'
            );
            assert.throws(
                () => assertCollaboratorNeighborTarget(legacyAction),
                /overlaps the open popup/
            );
        } catch (error) {
            legacyFailure = error;
            throw error;
        } finally {
            try {
                await legacyLayout(false);
            } catch (error) {
                evidence.neighborTargets.legacyRestoreError = error.message;
                if (!legacyFailure) throw error;
            }
        }
        assert.equal(
            await adjacent.evaluate(
                (node) => node.closest('[inert],[aria-hidden="true"]') === null
            ),
            true
        );
        const adjacentAction = page.getByRole('button', {
            name: 'Adjacent action',
            exact: true,
        });
        assert.equal(
            await adjacentAction.evaluate(
                (node) => node.closest('[inert],[aria-hidden="true"]') === null
            ),
            true
        );
        evidence.neighborTargets.corrected = {
            action: assertCollaboratorNeighborTarget(
                await measureNeighbor('#adjacent-action')
            ),
            input: assertCollaboratorNeighborTarget(
                await measureNeighbor('#adjacent')
            ),
        };
        await adjacentAction.click();
        assert.equal((await snapshot()).siblingActions, 1);
        await input().fill('Alpha');
        await page.getByRole('option').waitFor();
        evidence.neighborTargets.inputAfterReopen =
            assertCollaboratorNeighborTarget(
                await measureNeighbor('#adjacent')
            );
        await adjacent.click();
        assert.equal(
            await adjacent.evaluate((node) => node === document.activeElement),
            true
        );
        await fullEmailResults('ALPHA@EXAMPLE.INVALID', [
            'Alpha Person',
            'Beta Person',
        ]);
        await fullEmailResults('BETA@EXAMPLE.INVALID', [
            'Beta Person',
            'Alpha Person',
        ]);
        await select('BETA@', true);
        await remove('Beta Person').waitFor();
        assert.equal(
            await remove('Beta Person').evaluate(
                (node) => node === document.activeElement
            ),
            true
        );
        assert.equal(await input().count(), 0);
        await page.waitForFunction(() =>
            window.__nativeProbe
                .snapshot()
                .images.some((image) => image.naturalWidth > 0)
        );
        value = await snapshot();
        assert.equal(value.valueTags, 'B');
        assert.deepEqual(
            value.writes.map((write) => write.valueTags),
            ['B']
        );
        assert(
            value.images.some(
                (image) =>
                    image.src === '/complete-collaborator-avatar.svg' &&
                    image.alt === '' &&
                    image.width === 32 &&
                    image.height === 32 &&
                    image.naturalWidth > 0
            )
        );
        const defaultBadge = await portableStyles();
        assert.equal(defaultBadge.badge.style.color, 'rgb(37, 99, 235)');
        assert.equal(defaultBadge.badge.labelStyle.color, 'rgb(37, 99, 235)');
        assert.equal(
            defaultBadge.badge.style.backgroundColor,
            'rgb(239, 246, 255)'
        );
        evidence.portableCss.defaultBadge = defaultBadge.badge;
        await record(
            'nonmodal popup, native full-email fuzzy ordering and unique-prefix keyboard selection preserve supplied object/avatar and remove-focus handoff'
        );

        await remove('Beta Person').press('Enter');
        await canonical(null);
        await ready();
        assert.equal(
            await input().evaluate((node) => node === document.activeElement),
            true
        );
        await select('Alpha', true);
        await remove('Alpha Person').click();
        await canonical(null);
        await ready();
        assert.equal(
            await input().evaluate((node) => node === document.activeElement),
            true
        );
        await select('Beta');
        assert.equal(
            await remove('Beta Person').evaluate(
                (node) => node === document.activeElement
            ),
            true
        );
        value = await snapshot();
        assert.deepEqual(
            value.writes.map((write) => write.valueTags),
            ['B', null, 'A', null, 'B']
        );
        await record(
            'keyboard/pointer removal and reselection preserve scalar null, focus and adjacent draft without Save'
        );

        await configure({
            mode: 'multiple',
            valueTags: ['C', 'A', 'Adup', 'literal'],
            choiceTags: ['A', 'B'],
            readOnly: true,
        });
        assert.equal(await input().count(), 0);
        assert.equal(await page.locator('#field button').count(), 0);
        value = await snapshot();
        assert.deepEqual(value.badges, [
            'Retired Person',
            'Alpha Person',
            'Alpha second occurrence',
            '<img src=x onerror="identityLookup()">',
        ]);
        assert.deepEqual(value.valueTags, ['C', 'A', 'Adup', 'literal']);
        assert.equal(
            await page.locator('#field .mx-sdk-collaborator-name img').count(),
            0
        );
        assert(
            !value.images.some((image) => image.src.includes('not-approved'))
        );
        await record(
            'readonly stored values preserve duplicate occurrence order and literal email fallback without controls or identity lookup'
        );

        await configure({
            readOnly: false,
            valueTags: ['C', 'A', 'Adup'],
            choiceTags: ['A', 'B'],
        });
        await input().fill('Alpha');
        const selected = page.getByRole('option');
        await selected.waitFor();
        assert.equal(await selected.getAttribute('aria-selected'), 'true');
        const multipleStart = (await snapshot()).writes.length;
        await selected.click();
        await writeCount(multipleStart + 1);
        await canonical(['C']);
        value = await snapshot();
        assert.deepEqual(value.valueTags, ['C']);
        assert.deepEqual(value.writes.at(-1).valueTags, ['C']);
        await select('beta@');
        await writeCount(multipleStart + 2);
        await canonical(['C', 'B']);
        value = await snapshot();
        assert.deepEqual(value.valueTags, ['C', 'B']);
        assert.deepEqual(value.writes.at(-1).valueTags, ['C', 'B']);
        await input().fill('retired@example.invalid');
        await page.getByText('No supplied match', { exact: true }).waitFor();
        assert.equal(await page.getByRole('option').count(), 0);
        await record(
            'multiple selected-state toggling removes every duplicate ID and appends original offered objects without discovering stored identities'
        );

        await configure({ valueTags: ['C'], choiceTags: [] });
        await input().fill('retired');
        await page.getByText('No supplied match', { exact: true }).waitFor();
        assert.equal(await page.getByRole('option').count(), 0);
        const emptyStart = (await snapshot()).writes.length;
        await remove('Retired Person').click();
        await writeCount(emptyStart + 1);
        await canonical([]);
        value = await snapshot();
        assert.deepEqual(value.valueTags, []);
        assert.deepEqual(value.writes.at(-1).valueTags, []);
        assert.equal(
            await input().evaluate(
                (element) => element === document.activeElement
            ),
            true,
            'accepted last multiple removal returns focus to the current input'
        );
        await input().fill('');
        await page
            .getByRole('button', { name: 'Open supplied choices', exact: true })
            .click();
        assert.equal(await page.getByRole('option').count(), 0);
        await record(
            'authoritative-empty offered list stays empty before and after removing its stored retired collaborator'
        );

        await configure({
            mode: 'single',
            valueTags: null,
            choiceTags: ['A', 'B'],
            refuseChanges: true,
        });
        const refusedStart = (await snapshot()).writes.length;
        await select('Alpha');
        await writeCount(refusedStart + 1);
        assert.equal((await snapshot()).valueTags, null);
        assert.equal((await snapshot()).writes.length, refusedStart + 1);
        assert.equal(await remove('Alpha Person').count(), 0);
        await adjacent.click();
        await configure({ valueTags: 'A', refuseChanges: false });
        assert.equal(
            await adjacent.evaluate((node) => node === document.activeElement),
            true
        );
        await configure({ refuseChanges: true });
        await remove('Alpha Person').click();
        await writeCount(refusedStart + 2);
        assert.equal((await snapshot()).valueTags, 'A');
        assert.equal((await snapshot()).writes.length, refusedStart + 2);
        await adjacent.click();
        await configure({ valueTags: null, refuseChanges: false });
        assert.equal(
            await adjacent.evaluate((node) => node === document.activeElement),
            true
        );
        await record(
            'refused selection/removal commit no private value and consume focus requests before unrelated later canonical changes'
        );

        for (const refuseChanges of [false, true]) {
            await configure({
                mode: 'multiple',
                valueTags: [],
                choiceTags: ['A', 'B'],
                refuseChanges,
            });
            await input().fill('Alpha');
            await page.getByRole('option').first().waitFor();
            const start = (await snapshot()).writes.length;
            try {
                await page.evaluate(() => {
                    const request = window.requestAnimationFrame;
                    const frames = [];
                    window.requestAnimationFrame = (callback) => {
                        frames.push(callback);
                        return frames.length;
                    };
                    window.__flushCollaboratorPointerFrames = () => {
                        window.requestAnimationFrame = request;
                        const pending = frames.splice(0);
                        pending.forEach((callback) =>
                            callback(performance.now())
                        );
                        return document.activeElement?.id === 'adjacent';
                    };
                    document
                        .querySelector('#field [role="option"]')
                        .dispatchEvent(
                            new MouseEvent('mousedown', {
                                button: 0,
                                bubbles: true,
                                cancelable: true,
                            })
                        );
                });
                await adjacent.focus();
                assert.equal(
                    await page.evaluate(() =>
                        window.__flushCollaboratorPointerFrames()
                    ),
                    true
                );
            } finally {
                await page.evaluate(() => {
                    window.__flushCollaboratorPointerFrames?.();
                    delete window.__flushCollaboratorPointerFrames;
                });
            }
            await writeCount(start + 1);
            await canonical(refuseChanges ? [] : ['A']);
            assert.equal(
                (await snapshot()).adjacent,
                'Keep adjacent dirty value'
            );
        }
        await record(
            'accepted and refused pointer selections cannot reclaim an adjacent draft after their pending animation frames'
        );

        await configure({
            mode: 'multiple',
            valueTags: [],
            choiceTags: ['A', 'B'],
            refuseChanges: false,
        });
        await input().fill('Alpha');
        await page.evaluate(() => window.__collaboratorFixture.rememberInput());
        await configure({
            placeholder: 'Updated supplied placeholder',
            availableOptions: 'Current offered people',
            helpId: 'collaborator-help-updated',
            errorId: 'collaborator-error-updated',
            invalid: false,
            writer: 'replacement',
            equivalentEcho: true,
            policyDefaults: 'omitted',
        });
        value = await snapshot();
        assert.equal(value.sameInput, true);
        assert.equal(value.input.query, 'Alpha');
        assert.equal(
            await input().evaluate((node) => node === document.activeElement),
            true
        );
        const updatedDescriptions = await portableStyles();
        assertPopupLayout(updatedDescriptions);
        assertDescriptions(
            updatedDescriptions,
            'collaborator-help-updated',
            'collaborator-error-updated',
            'false'
        );
        evidence.portableCss.updatedDescriptions = updatedDescriptions;
        await configure({ policyDefaults: 'explicit', invalid: true });
        value = await snapshot();
        assert.equal(value.sameInput, true);
        assert.equal(value.input.query, 'Alpha');
        assert.equal(
            await input().evaluate((node) => node === document.activeElement),
            true
        );
        assertDescriptions(
            await portableStyles(),
            'collaborator-help-updated',
            'collaborator-error-updated'
        );
        await page.screenshot({
            path: join(output, `complete-collaborators-${format}-popup.png`),
            fullPage: true,
        });
        const writerStart = (await snapshot()).writes.length;
        await page.getByRole('option').click();
        await writeCount(writerStart + 1);
        await canonical(['A']);
        assert.equal((await snapshot()).writes.at(-1).writer, 'replacement');
        await configure({ portableTheme: true });
        await input().fill('Beta');
        await page.getByRole('option').waitFor();
        await input().press('ArrowDown');
        await page
            .locator('#field [role="option"][data-focus]')
            .waitFor({ state: 'visible', timeout: 5000 });
        const themed = await portableStyles();
        assertPopupLayout(themed);
        assertDescriptions(
            themed,
            'collaborator-help-updated',
            'collaborator-error-updated'
        );
        assert.equal(themed.badge.style.color, 'rgb(126, 34, 206)');
        assert.equal(themed.badge.labelStyle.color, 'rgb(126, 34, 206)');
        assert.equal(themed.badge.style.backgroundColor, 'rgb(250, 245, 255)');
        assert.equal(themed.control.style.borderColor, 'rgb(234, 88, 12)');
        assert.equal(themed.control.style.outlineColor, 'rgb(234, 88, 12)');
        assert.equal(themed.active.style.color, 'rgb(22, 101, 52)');
        assert.equal(themed.active.labelStyle.color, 'rgb(22, 101, 52)');
        assert.equal(themed.active.style.backgroundColor, 'rgb(250, 245, 255)');
        assert.equal((await snapshot()).writes.length, writerStart + 1);
        evidence.portableCss.themeOverride = themed;
        await page.screenshot({
            path: join(
                output,
                `complete-collaborators-${format}-portable-theme.png`
            ),
            fullPage: true,
        });
        await input().press('Escape');
        await configure({ portableTheme: false });
        const restored = await portableStyles();
        assert.equal(restored.badge.style.color, 'rgb(37, 99, 235)');
        assert.equal(restored.badge.labelStyle.color, 'rgb(37, 99, 235)');
        assert.equal(
            restored.badge.style.backgroundColor,
            'rgb(239, 246, 255)'
        );
        evidence.portableCss.restoredDefaults = restored.badge;
        await record(
            'equivalent metadata/value echoes retain query/focus and current physical descriptions; portable theme variables affect real badge/focus/active styles without a write'
        );

        await configure({
            mode: 'single',
            valueTags: 'A',
            ownerKey: 'A',
            active: true,
        });
        await page.evaluate(() =>
            window.__collaboratorFixture.capture('#field button')
        );
        const retirementStart = (await snapshot()).writes.length;
        await page.evaluate(() => window.__collaboratorFixture.retire());
        await page.evaluate(() => window.__collaboratorFixture.clickSaved());
        assert.equal((await snapshot()).writes.length, retirementStart);
        await configure({ active: true, ownerKey: 'B', valueTags: 'B' });
        await page.evaluate(() => window.__collaboratorFixture.clickSaved());
        await configure({ ownerKey: 'A', valueTags: 'A' });
        await page.evaluate(() => window.__collaboratorFixture.clickSaved());
        value = await snapshot();
        assert.equal(value.saved.connected, false);
        assert.equal(value.writes.length, retirementStart);
        await remove('Alpha Person').click();
        await writeCount(retirementStart + 1);
        await canonical(null);
        assert.equal((await snapshot()).valueTags, null);
        await record(
            'live authority revocation and observed owner A-to-B-to-A retire retained actions without suppressing a fresh successor action'
        );

        for (const patch of [
            { readOnly: true },
            { visible: false },
            { mounted: false },
        ]) {
            await configure({
                valueTags: 'A',
                readOnly: false,
                visible: true,
                mounted: true,
            });
            await page.evaluate(() =>
                window.__collaboratorFixture.capture('#field button')
            );
            const before = (await snapshot()).writes.length;
            await configure(patch);
            await page.evaluate(() =>
                window.__collaboratorFixture.clickSaved()
            );
            assert.equal((await snapshot()).writes.length, before);
            await configure({ readOnly: false, visible: true, mounted: true });
            await page.evaluate(() =>
                window.__collaboratorFixture.clickSaved()
            );
            assert.equal((await snapshot()).writes.length, before);
            assert.equal((await snapshot()).saved.connected, false);
        }
        await configure({
            mode: 'multiple',
            valueTags: ['A'],
            readOnly: true,
            images: 'none',
        });
        assert.deepEqual((await snapshot()).badges, ['Alpha Person']);
        assert.equal(await page.locator('#field img').count(), 0);
        await configure({ valueTags: [] });
        await page
            .getByText('No collaborators supplied', { exact: true })
            .waitFor();
        assert.equal(await input().count(), 0);
        assert.equal(await page.locator('#field img').count(), 0);
        await record(
            'readonly, hidden and field-unmount replacement retire retained DOM actions and preserve localized empty display with explicit no-image policy'
        );

        await configure({
            mode: 'single',
            valueTags: 'A',
            readOnly: false,
            images: 'source',
        });
        await page.evaluate(() =>
            window.__collaboratorFixture.capture('#field button')
        );
        const unmountStart = (await snapshot()).writes.length;
        await page.evaluate(() => window.__collaboratorFixture.unmount());
        await page.evaluate(() => window.__collaboratorFixture.clickSaved());
        value = await snapshot();
        assert.equal(value.writes.length, unmountStart);
        assert.equal(value.saved.connected, false);
        assert.equal(value.mounts, value.cleanups);
        await page.evaluate(() => window.__collaboratorFixture.remount());
        await ready();
        await page.evaluate(() => window.__collaboratorFixture.clickSaved());
        assert.equal((await snapshot()).writes.length, unmountStart);
        await remove('Alpha Person').click();
        await writeCount(unmountStart + 1);
        await canonical(null);
        await record(
            'whole-root StrictMode unmount/remount preserves caller values without reviving a retired action'
        );
        assert.equal(groups.length, 12);
        evidence.browserGroups = groups;
    } catch (error) {
        failure = error;
        evidence.failure = {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
        try {
            evidence.failure.state = await snapshot();
        } catch (captureError) {
            evidence.failure.stateCaptureError = captureError.message;
        }
        try {
            evidence.failure.ax = await page.locator('body').ariaSnapshot();
        } catch (captureError) {
            evidence.failure.axCaptureError = captureError.message;
        }
        try {
            evidence.failure.neighbors = {
                action: await measureNeighbor('#adjacent-action'),
                input: await measureNeighbor('#adjacent'),
            };
        } catch (captureError) {
            evidence.failure.neighborCaptureError = captureError.message;
        }
        try {
            const name = `complete-collaborators-${format}-before-cleanup-failed.png`;
            await page.screenshot({
                path: join(output, name),
                fullPage: true,
            });
            evidence.failure.screenshot = name;
        } catch (captureError) {
            evidence.failure.screenshotCaptureError = captureError.message;
        }
        throw error;
    } finally {
        try {
            await page.evaluate(() => window.__collaboratorFixture?.unmount());
            evidence.cleanup = { status: 'completed' };
        } catch (cleanupError) {
            evidence.cleanup = {
                status: 'failed',
                error: cleanupError.message,
            };
            if (!failure) throw cleanupError;
        }
    }
}
