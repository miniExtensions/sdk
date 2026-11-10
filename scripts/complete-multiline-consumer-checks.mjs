import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const completeMultilineTypedConsumer = String.raw`import { createElement, createRef } from 'react';
import {
    CompleteMultilineTextField,
    type CompleteMultilineTextFieldProps,
} from '@miniextensions/sdk/react';
const ref = createRef<HTMLTextAreaElement>();
const props: CompleteMultilineTextFieldProps = {
    value: '  Literal <b>text</b>\n🙂', id: 'answer',
    onChange(value) { const scalar: string = value; void scalar; },
    form: 'existing-form', placeholder: 'Describe the request',
    readOnly: false, characterLimit: 100, hasErrorMessage: true,
    hasDescription: true,
};
createElement(CompleteMultilineTextField, { ...props, ref });
createElement(CompleteMultilineTextField, { ...props, value: null });
// @ts-expect-error canonical multiline data is a string or null
const numeric: CompleteMultilineTextFieldProps = { ...props, value: 12 };
// @ts-expect-error this complete control requires its native field identity
createElement(CompleteMultilineTextField, { value: '', onChange() {} });
// @ts-expect-error change callbacks receive a scalar, never a DOM event
const eventWriter: CompleteMultilineTextFieldProps = { ...props, onChange(event: import('react').ChangeEvent<HTMLTextAreaElement>) { void event; } };
// @ts-expect-error native rows are owned by the complete 3-30 presentation
createElement(CompleteMultilineTextField, { ...props, autoSize: { minRows: 1 } });
// @ts-expect-error no uncontrolled second value
createElement(CompleteMultilineTextField, { ...props, defaultValue: 'other' });
// @ts-expect-error complete presentation has no renderer slot
createElement(CompleteMultilineTextField, { ...props, renderInput() { return null; } });
// @ts-expect-error complete React presentation is not a core export
import { CompleteMultilineTextField as CoreField } from '@miniextensions/sdk';
void numeric; void eventWriter; void CoreField;
`;

// Frozen native MultilineTextField presentation, source SHA256
// 0c82f7ba2166d9e656cf06a85ca0c67bed9904812f964b52b8447ca23a03c327.
// Only field/config lookups are projected to the agreed portable scalar props;
// the observer ref exposes the existing private native textarea for comparison.
// Selection state/effect, exact limits, disabled policy and actual public
// TextareaInput stay native. This is not a provider or Form authority model.
const frozenNativeSource = String.raw`function nativeMultilineOracle(React, TextareaInput) {
    return React.forwardRef(function NativeMultiline(props, forwardedRef) {
        const textareaRef = React.useRef(null);
        const [selectionStart, setSelectionStart] = React.useState(null);
        const [selectionEnd, setSelectionEnd] = React.useState(null);
        const setRef = React.useCallback((node) => {
            textareaRef.current = node;
            if (typeof forwardedRef === 'function') forwardedRef(node);
            else if (forwardedRef) forwardedRef.current = node;
        }, [forwardedRef]);
        const limit = !props.readOnly ? props.characterLimit : undefined;
        const reached = props.value != null && limit != null && limit <= props.value.length;
        const change = (event) => {
            if (textareaRef.current != null) {
                setSelectionStart(textareaRef.current.selectionStart);
                setSelectionEnd(textareaRef.current.selectionEnd);
            }
            props.onChange(event.target.value);
        };
        React.useEffect(() => {
            if (textareaRef.current != null && selectionStart != null && selectionEnd != null)
                textareaRef.current.setSelectionRange(selectionStart, selectionEnd);
        }, [props.value, selectionStart, selectionEnd]);
        const describedBy = [
            props.hasErrorMessage && props.id + '-error',
            props.hasDescription && props.id + '-description',
        ].filter(Boolean).join(' ');
        return React.createElement('div', { className: 'relative mt-1 w-full' },
            React.createElement(TextareaInput, {
                ref: setRef,
                className: 'block w-full resize-y rounded-md border-gray-300 shadow-sm transition-colors duration-100 disabled:resize-none disabled:bg-gray-100 disabled:text-gray-600 sm:text-sm ' +
                    (reached ? 'focus:border-red-500 focus:ring-red-500' : 'focus:border-theme-500 focus:ring-theme-500'),
                value: props.value ?? '', onChange: change, disabled: props.readOnly,
                autoSize: { minRows: 3, maxRows: 30 }, id: props.id,
                autoComplete: 'off', placeholder: props.placeholder, form: props.form,
                'aria-describedby': describedBy || undefined,
                'aria-invalid': props.hasErrorMessage, maxLength: limit,
            }),
            limit != null ? React.createElement('p', {
                className: 'ml-auto mt-1 w-fit text-xs ' + (reached ? 'text-red-500' : 'text-gray-500'),
                title: 'Character Limit',
            }, String(props.value?.length ?? 0) + '/' + limit) : null);
    });
}
`;

const consumerRuntime =
    String.raw`import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';
import * as esm from '@miniextensions/sdk/react';
const require = createRequire(import.meta.url);
const cjs = require('@miniextensions/sdk/react');
const { Window } = await import(pathToFileURL(process.argv[2]).href);
const installed = join(dirname(fileURLToPath(import.meta.url)), 'node_modules/@miniextensions/sdk');
assert(fileURLToPath(import.meta.resolve('@miniextensions/sdk/react')).startsWith(join(installed,'dist/esm/react')));
assert(require.resolve('@miniextensions/sdk/react').startsWith(join(installed,'dist/cjs/react')));
assert.equal('CompleteMultilineTextField' in require('@miniextensions/sdk'), false);
const cssPath = require.resolve('@miniextensions/sdk/react/complete-multiline.css');
assert(cssPath.startsWith(join(installed,'dist/esm/react')));
const css = readFileSync(cssPath, 'utf8');
assert(css.includes('.mx-sdk-complete-multiline'));
assert(!css.includes('@tailwind') && !css.includes('@apply'));
const keys = ['window','document','navigator','HTMLElement','HTMLTextAreaElement','IS_REACT_ACT_ENVIRONMENT','fetch'];
const install = (window, fetch) => {
    const original = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis,key));
    for (const key of keys) Object.defineProperty(globalThis,key,{
        configurable:true,writable:true,
        value:key === 'IS_REACT_ACT_ENVIRONMENT' ? true : key === 'fetch' ? fetch : window[key],
    });
    return () => keys.forEach((key,index) => {
        if (original[index]) Object.defineProperty(globalThis,key,original[index]);
        else Reflect.deleteProperty(globalThis,key);
    });
};
` +
    frozenNativeSource +
    String.raw`
let groups = 0;
const callbackRefControls = [];
for (const api of [esm,cjs]) {
    const Native = nativeMultilineOracle(React,api.TextareaInput);
    const outcomes = [];
    for (const Component of [api.CompleteMultilineTextField,Native]) {
        assert.equal(typeof globalThis.document,'undefined');
        const model = {
            value:'  <b>literal</b>\n🙂', id:'answer', form:'multiline-form',
            placeholder:'Initial hint', characterLimit:100,
            hasErrorMessage:true,hasDescription:true,readOnly:false,visible:true,callback:'A',
        };
        const events = [];
        const ref = React.createRef();
        let root, mounted = false, requests = 0, submits = 0;
        const reject = async () => { requests++; throw Error('Multiline presentation must not fetch'); };
        const node = () => {
            const callback = model.callback;
            return React.createElement(React.StrictMode,null,
                React.createElement('form',{id:'multiline-form',onSubmit(event) {event.preventDefault();submits++;}},
                    model.visible ? React.createElement(Component,{
                        ...model,ref,onChange(value) {
                            events.push({callback,value}); model.value = value;
                            if (mounted) root.render(node());
                        },
                    }) : null,
                    React.createElement('input',{'aria-label':'Adjacent',defaultValue:'Retain adjacent'})));
        };
        const html = renderToString(node());
        assert(html.includes('&lt;b&gt;literal&lt;/b&gt;') && !html.includes('<b>'));
        const window = new Window();
        Object.defineProperty(window,'fetch',{configurable:true,value:reject});
        const container = window.document.createElement('div');
        container.innerHTML = html; window.document.body.append(container);
        const initial = container.querySelector('textarea');
        const restore = install(window,reject);
        const recoverable = [];
        try {
            const { hydrateRoot } = await import('react-dom/client');
            await React.act(async () => {root = hydrateRoot(container,node(),{
                onRecoverableError(error) {recoverable.push(String(error));},
            });});
            mounted = true;
            assert.equal(ref.current,initial);
            const adjacent = container.querySelector('[aria-label="Adjacent"]');
            adjacent.value = 'Keep neighboring draft';
            const field = () => container.querySelector('textarea');
            const update = async (patch) => {
                Object.assign(model,patch);
                await React.act(async () => root.render(node()));
                assert.equal(adjacent.value,'Keep neighboring draft');
            };
            const change = async (value,selection = [value.length,value.length]) => React.act(async () => {
                field().focus();
                Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(field(),value);
                field().setSelectionRange(...selection);
                field().dispatchEvent(new window.Event('input',{bubbles:true}));
            });
            assert.equal(field().form.id,'multiline-form');
            assert.equal(field().getAttribute('aria-describedby'),'answer-error answer-description');
            assert.equal(field().getAttribute('aria-invalid'),'true');
            assert.equal(field().getAttribute('autocomplete'),'off');
            assert.equal(field().getAttribute('maxlength'),'100');
            assert.equal(field().value,model.value);
            await change('abQef',[3,3]);
            assert.equal(field(),initial); assert.equal(ref.current,initial);
            assert.equal(field().value,'abQef');
            assert.deepEqual([field().selectionStart,field().selectionEnd],[3,3]);
            assert.deepEqual(events,[{callback:'A',value:'abQef'}]);
            const beforeMetadata = events.length;
            await update({id:'next-answer',placeholder:'Current hint',form:undefined,
                hasErrorMessage:false,hasDescription:false,callback:'B'});
            assert.equal(field(),initial); assert.equal(field().getAttribute('form'),null);
            assert.equal(field().placeholder,'Current hint');
            assert.equal(field().getAttribute('aria-describedby'),null);
            assert.equal(field().getAttribute('aria-invalid'),'false');
            assert.deepEqual([field().selectionStart,field().selectionEnd],[3,3]);
            assert.equal(events.length,beforeMetadata);
            await change('🙂\né');
            assert.deepEqual(events.at(-1),{callback:'B',value:'🙂\né'});
            assert.equal(container.querySelector('[title="Character Limit"]').textContent,'4/100');
            for (const limit of [0,3,2.5,-1,undefined]) {
                const count = events.length;
                await update({characterLimit:limit});
                assert.equal(field().getAttribute('maxlength'),limit == null ? null : String(limit));
                assert.equal(container.querySelector('[title="Character Limit"]')?.textContent ?? null,
                    limit == null ? null : '4/' + limit);
                assert.equal(events.length,count);
            }
            await update({readOnly:true,characterLimit:3});
            assert.equal(field().disabled,true);
            assert.equal(field().getAttribute('maxlength'),null);
            assert.equal(container.querySelector('[title="Character Limit"]'),null);
            await update({readOnly:false,value:null,characterLimit:0,hasErrorMessage:undefined});
            assert.equal(field().value,'');
            assert.equal(field().getAttribute('aria-invalid'),null);
            assert.equal(container.querySelector('[title="Character Limit"]').textContent,'0/0');
            assert.equal(container.querySelector('[title="Character Limit"]').classList.contains('text-red-500'),false);
            assert.equal(events.length,beforeMetadata + 1);
            await update({visible:false});
            assert.equal(ref.current,null);
            assert.equal(events.length,beforeMetadata + 1,'no pending draft cleanup writer');
            assert.equal(submits,0); assert.equal(requests,0); assert.deepEqual(recoverable,[]);
            outcomes.push({events,submits,requests});
        } finally {
            mounted = false;
            try {if (root) await React.act(async () => root.unmount());}
            finally {restore();await window.happyDOM.close();}
        }
    }
    assert.deepEqual(outcomes[0],outcomes[1],'packed complete multiline matches frozen native presentation');
    // Bare CSR deliberately avoids StrictMode's imperative-effect replay.
    // The direct DOM textarea checks the actual installed React-version
    // contract independently of the frozen native observer-ref adapter above.
    const referenceOutcomes = [];
    for (const Component of ['textarea',api.CompleteMultilineTextField]) {
        const window = new Window();
        let requests = 0, edits = 0, referenceRoot;
        const reject = async () => {requests++;throw Error('Callback ref control must not fetch');};
        const restore = install(window,reject);
        const container = window.document.createElement('div');
        window.document.body.append(container);
        const events = [], attachedNodes = [];
        const supportsRefCleanup = React.version.startsWith('19.');
        const makeRef = (name) => (node) => {
            if (node == null) {events.push(name + ':null');return;}
            assert.equal(node.tagName,'TEXTAREA');
            assert.equal(node,container.querySelector('textarea'));
            attachedNodes.push(node);
            events.push(name + ':mount');
            if (supportsRefCleanup) return () => {events.push(name + ':cleanup');};
        };
        const refA = makeRef('A'), refB = makeRef('B');
        const node = (ref) => React.createElement(Component,{
            id:'callback-ref',value:'Packed callback ref',ref,
            onChange() {edits++;},
        });
        try {
            const { createRoot } = await import('react-dom/client');
            referenceRoot = createRoot(container);
            await React.act(async () => referenceRoot.render(node(refA)));
            const first = container.querySelector('textarea');
            assert(first);
            assert.deepEqual(events,['A:mount']);
            await React.act(async () => referenceRoot.render(node(refB)));
            assert.equal(container.querySelector('textarea'),first);
            assert.deepEqual(attachedNodes,[first,first]);
            assert.deepEqual(events,['A:mount',supportsRefCleanup ? 'A:cleanup' : 'A:null','B:mount']);
            await React.act(async () => referenceRoot.unmount());
            referenceRoot = undefined;
            assert.equal(container.querySelector('textarea'),null);
            assert.deepEqual(events,[
                'A:mount',supportsRefCleanup ? 'A:cleanup' : 'A:null',
                'B:mount',supportsRefCleanup ? 'B:cleanup' : 'B:null',
            ]);
            assert.equal(edits,0);assert.equal(requests,0);
            referenceOutcomes.push({events,edits,requests});
        } finally {
            try {if (referenceRoot) await React.act(async () => referenceRoot.unmount());}
            finally {restore();await window.happyDOM.close();}
        }
    }
    assert.deepEqual(referenceOutcomes[1],referenceOutcomes[0],
        'packed callback ref replacement/unmount matches direct installed React textarea');
    callbackRefControls.push({format:api === esm ? 'esm' : 'cjs',
        retirement:React.version.startsWith('19.') ? 'returned-cleanup' : 'null',
        direct:referenceOutcomes[0],packed:referenceOutcomes[1]});
    groups++;
}
console.log(JSON.stringify({react:React.version,groups,callbackRefControls,cleanup:'completed',
    scope:'Actual packed ESM/CJS scalar UI, strict declarations and SSR/hydration; no geometry or host Form/Portal authority claim.'}));
`;

export function checkCompleteMultilineReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-complete-multiline-'));
    const versions = [];
    const run = (command, args) =>
        execFileSync(command, args, { cwd: directory, stdio: 'inherit' });
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
        writeFileSync(join(directory, 'consumer-runtime.mjs'), consumerRuntime);
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
            for (const extension of ['mts', 'cts']) {
                const file = 'complete-multiline.' + extension;
                writeFileSync(
                    join(directory, file),
                    completeMultilineTypedConsumer
                );
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
            const result = JSON.parse(
                execFileSync(
                    process.execPath,
                    [
                        join(directory, 'consumer-runtime.mjs'),
                        happyDomModulePath,
                    ],
                    { cwd: directory, encoding: 'utf8' }
                )
            );
            assert.equal(result.react, version.react);
            assert.equal(result.groups, 2);
            assert.equal(result.callbackRefControls.length, 2);
            for (const control of result.callbackRefControls)
                assert.equal(
                    control.retirement,
                    version.react.startsWith('19.')
                        ? 'returned-cleanup'
                        : 'null'
                );
            assert.equal(result.cleanup, 'completed');
            versions.push(result);
            console.log(
                'Installed complete multiline React' +
                    version.react +
                    ': strict ESM/CJS, SSR/hydration and frozen native scalar presentation passed.'
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

export const completeMultilineBrowserStyle = String.raw`body {font-family:monospace;font-size:16px;line-height:24px;color:#111827;margin:16px}
.fixture-row {width:360px;margin-bottom:20px}
.fixture-row label {display:block}
#paste-source {width:360px;height:72px}
.native > div {position:relative;margin-top:.25rem;width:100%}
.native textarea {box-sizing:border-box;display:block;width:100%;resize:vertical;appearance:none;border:1px solid #d1d5db;border-radius:.375rem;background:white;color:inherit;padding:.5rem .75rem;font-family:inherit;font-size:1rem;line-height:1.5rem;box-shadow:0 1px 2px rgb(0 0 0 / .05)}
.native textarea:focus {outline:2px solid transparent;outline-offset:2px;border-color:#3b82f6;box-shadow:0 0 0 1px #3b82f6,0 1px 2px rgb(0 0 0 / .05)}
.native textarea.focus\:border-red-500:focus {border-color:#ef4444;box-shadow:0 0 0 1px #ef4444,0 1px 2px rgb(0 0 0 / .05)}
.native textarea:disabled {resize:none;background-color:#f3f4f6;color:#4b5563}
.native p[title] {width:fit-content;margin:0;margin-left:auto;margin-top:.25rem;font-size:.75rem;line-height:1rem;color:#6b7280}
.native p.text-red-500 {color:#ef4444}
@media (min-width:640px) {.native textarea {font-size:.875rem;line-height:1.25rem}}
`;

export const completeMultilineBrowserSource =
    String.raw`import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {CompleteMultilineTextField,TextareaInput} from '@miniextensions/sdk/react';
` +
    frozenNativeSource +
    String.raw`
const Native = nativeMultilineOracle(React,TextareaInput);
const state = {errors:[],requests:0,submits:0,revision:0,committed:0};
let models,root,serial = 0;
const pending = new Map();
const make = (kind) => ({
    key:++serial,value:'abcdef',id:'answer-' + kind,form:'form-' + kind,
    placeholder:'Initial hint',characterLimit:100,hasErrorMessage:true,hasDescription:true,
    readOnly:false,visible:true,callback:'A',events:[],ref:React.createRef(),
});
const snapshot = () => ({
    ...state,errors:[...state.errors],reactVersion:React.version,
    models:Object.fromEntries(Object.entries(models ?? {}).map(([kind,model]) => {
        const row = document.getElementById('row-' + kind);
        const input = row?.querySelector('textarea');
        const counter = row?.querySelector('[title="Character Limit"]');
        return [kind,{value:model.value,events:[...model.events],displayed:input?.value ?? null,
            id:input?.id ?? null,form:input?.form?.id ?? null,placeholder:input?.getAttribute('placeholder') ?? null,
            describedBy:input?.getAttribute('aria-describedby') ?? null,invalid:input?.getAttribute('aria-invalid') ?? null,
            maxLength:input?.getAttribute('maxlength') ?? null,disabled:input?.disabled ?? null,
            counter:counter?.textContent ?? null,reached:counter?.classList.contains('text-red-500') ?? false,
            selection:input ? [input.selectionStart,input.selectionEnd] : null,
            focused:!!input && document.activeElement === input,refMatches:!!input && model.ref.current === input,
            refNull:model.ref.current === null,adjacent:document.getElementById('adjacent-' + kind)?.value ?? null}];
    })),
});
window.__nativeProbe = {snapshot};
window.addEventListener('error',(event) => state.errors.push(String(event.error || event.message)));
window.addEventListener('unhandledrejection',(event) => state.errors.push(String(event.reason)));
window.fetch = async () => {state.requests++;throw Error('Multiline fixture cannot fetch');};
XMLHttpRequest.prototype.open = function () {state.requests++;throw Error('Multiline fixture cannot use XHR');};
function publish() {
    const revision = ++state.revision;
    const committed = new Promise((resolve) => pending.set(revision,resolve));
    root.render(React.createElement(App,{revision}));
    return committed;
}
function App({revision}) {
    useEffect(() => {
        state.committed = revision;
        for (const [key,resolve] of pending) if (key <= revision) {pending.delete(key);resolve();}
    },[revision]);
    return React.createElement('main',null,
        ...Object.entries(models).map(([kind,model]) => {
            const callback = model.callback;
            const Component = kind === 'sdk' ? CompleteMultilineTextField : Native;
            return React.createElement('form',{
                key:kind,id:'form-' + kind,onSubmit(event) {event.preventDefault();state.submits++;},
            },React.createElement('section',{id:'row-' + kind,className:'fixture-row ' + (kind === 'native' ? 'native' : '')},
                React.createElement('label',{htmlFor:model.id},'Answer ' + kind),
                model.visible ? React.createElement(Component,{
                    key:model.key,ref:model.ref,value:model.value,id:model.id,form:model.form,
                    placeholder:model.placeholder,characterLimit:model.characterLimit,readOnly:model.readOnly,
                    hasErrorMessage:model.hasErrorMessage,hasDescription:model.hasDescription,
                    onChange(value) {model.events.push({callback,value});model.value = value;void publish();},
                }) : null,
                React.createElement('p',{id:model.id + '-error'},'Synthetic error'),
                React.createElement('p',{id:model.id + '-description'},'Synthetic description'),
                React.createElement('input',{id:'adjacent-' + kind,defaultValue:'Keep adjacent'})));
        }),
        React.createElement('label',{htmlFor:'paste-source'},'Synthetic paste source'),
        React.createElement('textarea',{id:'paste-source',defaultValue:''}));
}
window.__multilineFixture = {
    async reset(patch = {}) {
        models = {sdk:make('sdk'),native:make('native')};
        for (const model of Object.values(models)) Object.assign(model,patch);
        await publish();return snapshot();
    },
    async update(patch,selectedKind) {
        for (const [kind,model] of Object.entries(models))
            if (selectedKind == null || kind === selectedKind) Object.assign(model,patch);
        await publish();return snapshot();
    },
    async flush() {await publish();return snapshot();},
    capture() {window.__multilineNodes = Object.fromEntries(Object.entries(models).map(([kind,model]) => [kind,model.ref.current]));},
    identity() {return Object.fromEntries(Object.entries(models).map(([kind,model]) => [kind,window.__multilineNodes?.[kind] === model.ref.current]));},
};
models = {sdk:make('sdk'),native:make('native')};
root = createRoot(document.getElementById('root'));
void publish();
`;

/** Existing harness owns the exact archive, CSP, page, browser and cleanup. */
export async function checkCompleteMultilineBrowser({ page, evidence }) {
    await page.waitForFunction(
        () => window.__nativeProbe?.snapshot().committed > 0
    );
    const reset = (patch = {}) =>
        page.evaluate((patch) => window.__multilineFixture.reset(patch), patch);
    const update = (patch, kind) =>
        page.evaluate(
            ({ patch, kind }) => window.__multilineFixture.update(patch, kind),
            { patch, kind }
        );
    const flush = () => page.evaluate(() => window.__multilineFixture.flush());
    const input = (kind) => page.locator('#row-' + kind + ' textarea');
    const each = async (callback) => {
        for (const kind of ['sdk', 'native']) await callback(kind);
    };
    const groups = [];
    const equal = async (name) => {
        const value = await flush();
        for (const key of [
            'value',
            'events',
            'displayed',
            'placeholder',
            'invalid',
            'maxLength',
            'disabled',
            'counter',
            'reached',
            'selection',
        ])
            assert.deepEqual(
                value.models.sdk[key],
                value.models.native[key],
                name + ': ' + key
            );
        for (const model of Object.values(value.models)) {
            assert(model.refMatches || model.refNull);
            assert.equal(model.adjacent, 'Keep adjacent');
        }
        assert.deepEqual(value.errors, []);
        assert.equal(value.requests, 0);
        assert.equal(value.submits, 0);
        groups.push({
            name,
            sdk: value.models.sdk,
            native: value.models.native,
        });
        return value;
    };
    const geometry = (kind) =>
        input(kind).evaluate((element) => {
            const style = getComputedStyle(element),
                box = element.getBoundingClientRect();
            return {
                height: box.height,
                width: box.width,
                line: parseFloat(style.lineHeight),
                padding:
                    parseFloat(style.paddingTop) +
                    parseFloat(style.paddingBottom),
                border:
                    parseFloat(style.borderTopWidth) +
                    parseFloat(style.borderBottomWidth),
                resize: style.resize,
                disabled: element.disabled,
                borderColor: style.borderColor,
                counterColor: element.parentElement.querySelector('[title]')
                    ? getComputedStyle(
                          element.parentElement.querySelector('[title]')
                      ).color
                    : null,
            };
        });
    const literal = '  <b>literal</b>\n🙂';
    await reset({ value: literal });
    await each(async (kind) => {
        assert.equal(await input(kind).inputValue(), literal);
        assert.equal(await input(kind).getAttribute('autocomplete'), 'off');
        assert.equal(
            await input(kind).getAttribute('aria-describedby'),
            'answer-' + kind + '-error answer-' + kind + '-description'
        );
        assert.equal(
            await input(kind).evaluate((element) => element.form.id),
            'form-' + kind
        );
        assert.equal(await page.locator('#row-' + kind + ' b').count(), 0);
    });
    await update({ value: null });
    let value = await equal(
        'literal native textarea, null-empty display and initial identity/ARIA'
    );
    assert.equal(value.models.sdk.displayed, '');
    assert.deepEqual(value.models.sdk.events, []);

    await reset();
    await page.evaluate(() => window.__multilineFixture.capture());
    await each(async (kind) => {
        await input(kind).focus();
        await input(kind).evaluate((element) =>
            element.setSelectionRange(2, 4, 'backward')
        );
        await page.keyboard.type('Q');
        assert.equal(await input(kind).inputValue(), 'abQef');
        assert.deepEqual(
            await input(kind).evaluate((element) => [
                element.selectionStart,
                element.selectionEnd,
            ]),
            [3, 3]
        );
        await update(
            {
                placeholder: 'Current hint',
                hasErrorMessage: false,
                hasDescription: false,
            },
            kind
        );
        assert.equal(
            await input(kind).evaluate(
                (element) => document.activeElement === element
            ),
            true
        );
        assert.deepEqual(
            await input(kind).evaluate((element) => [
                element.selectionStart,
                element.selectionEnd,
            ]),
            [3, 3]
        );
    });
    value = await equal(
        'focused mid-string edit and metadata preserve native textarea/caret'
    );
    assert.deepEqual(
        await page.evaluate(() => window.__multilineFixture.identity()),
        { sdk: true, native: true }
    );
    assert.deepEqual(value.models.sdk.events, [
        { callback: 'A', value: 'abQef' },
    ]);

    await reset({ value: '', characterLimit: undefined });
    await each(async (kind) => {
        await input(kind).focus();
        await page.keyboard.insertText('  literal <b>');
        await input(kind).press('Enter');
        await page.keyboard.insertText('🙂é');
    });
    value = await equal(
        'trusted literal Unicode and native Enter insert newlines without submit'
    );
    assert.equal(value.models.sdk.displayed, '  literal <b>\n🙂é');

    await reset({ value: 'prefix suffix', characterLimit: undefined });
    const pasted = '<i>paste</i>\n🙂';
    await page.locator('#paste-source').fill(pasted);
    await page.locator('#paste-source').press('ControlOrMeta+A');
    await page.locator('#paste-source').press('ControlOrMeta+C');
    const pasteEvents = [];
    await each(async (kind) => {
        await input(kind).focus();
        await input(kind).evaluate((element) => {
            element.setSelectionRange(7, 7);
            element.__pastes = [];
            element.addEventListener('paste', (event) =>
                element.__pastes.push({
                    trusted: event.isTrusted,
                    text: event.clipboardData.getData('text/plain'),
                })
            );
        });
        await input(kind).press('ControlOrMeta+V');
        const events = await input(kind).evaluate(
            (element) => element.__pastes
        );
        assert.deepEqual(
            events,
            [{ trusted: true, text: pasted }],
            'existing browser must support ordinary same-context keyboard clipboard without a new permission'
        );
        pasteEvents.push({ kind, events });
        assert.equal(
            await input(kind).inputValue(),
            'prefix ' + pasted + 'suffix'
        );
    });
    await equal(
        'same-context trusted keyboard paste retains literal text and newline'
    );

    await reset({ value: '1234', characterLimit: 5 });
    await update({ value: '12345' });
    value = await equal('raw bound and warning at exact native limit');
    assert.equal(value.models.sdk.counter, '5/5');
    assert.equal(value.models.sdk.reached, true);
    await each(async (kind) => {
        await input(kind).focus();
        await input(kind).press('End');
        await page.keyboard.type('6');
        assert.equal(await input(kind).inputValue(), '12345');
        assert.deepEqual((await flush()).models[kind].events, []);
    });
    await input('sdk').focus();
    await page.waitForFunction(
        () =>
            getComputedStyle(document.querySelector('#row-sdk textarea'))
                .borderColor === 'rgb(239, 68, 68)'
    );
    const warning = await geometry('sdk');
    assert.equal(warning.borderColor, 'rgb(239, 68, 68)');
    assert.equal(warning.counterColor, 'rgb(239, 68, 68)');
    const rawBounds = [];
    for (const limit of [0, 2.5, -1, undefined]) {
        await update({ characterLimit: limit });
        for (const kind of ['sdk', 'native'])
            assert.equal(
                await input(kind).getAttribute('maxlength'),
                limit == null ? null : String(limit)
            );
        const current = await flush();
        assert.equal(
            current.models.sdk.counter,
            limit == null ? null : '5/' + limit
        );
        assert.equal(current.models.sdk.counter, current.models.native.counter);
        assert.deepEqual(current.models.sdk.events, []);
        rawBounds.push({
            limit: limit ?? null,
            sdk: current.models.sdk,
            native: current.models.native,
        });
    }
    value = await flush();
    assert.equal(value.models.sdk.counter, null);
    assert.deepEqual(value.models.sdk.events, []);

    await reset({
        value: 'protected\ntext',
        characterLimit: 3,
        readOnly: true,
    });
    await each(async (kind) => {
        assert.equal(await input(kind).isDisabled(), true);
        await input(kind).click({ force: true });
        await page.keyboard.type('denied');
        assert.equal(await input(kind).inputValue(), 'protected\ntext');
        assert.equal((await geometry(kind)).resize, 'none');
    });
    value = await equal(
        'disabled readonly retains text and removes editable bound/counter'
    );
    assert.equal(value.models.sdk.maxLength, null);
    assert.equal(value.models.sdk.counter, null);
    assert.deepEqual(value.models.sdk.events, []);

    await reset();
    await each(async (kind) => {
        await update({ callback: 'B' }, kind);
        await input(kind).fill('current');
        assert.deepEqual((await flush()).models[kind].events, [
            { callback: 'B', value: 'current' },
        ]);
        await update({ value: 'external echo' }, kind);
        assert.equal(await input(kind).inputValue(), 'external echo');
        await update({ visible: false }, kind);
        assert.equal((await flush()).models[kind].refNull, true);
    });
    value = await equal(
        'controlled external echo/current callback and no cleanup draft write'
    );
    assert.deepEqual(value.models.sdk.events, [
        { callback: 'B', value: 'current' },
    ]);

    await reset({ value: '', characterLimit: undefined });
    const minimum = {},
        maximum = {};
    await each(async (kind) => {
        minimum[kind] = await geometry(kind);
        assert(
            Math.abs(
                minimum[kind].height -
                    (3 * minimum[kind].line +
                        minimum[kind].padding +
                        minimum[kind].border)
            ) <= 2
        );
    });
    await update({
        value: Array.from({ length: 40 }, (_, index) => 'line ' + index).join(
            '\n'
        ),
    });
    await each(async (kind) => {
        maximum[kind] = await geometry(kind);
        assert(
            Math.abs(
                maximum[kind].height -
                    (30 * maximum[kind].line +
                        maximum[kind].padding +
                        maximum[kind].border)
            ) <= 2
        );
    });
    assert(Math.abs(minimum.sdk.height - minimum.native.height) <= 2);
    assert(Math.abs(maximum.sdk.height - maximum.native.height) <= 2);
    await equal(
        'standalone actual TextareaInput autosizes to three and thirty rows'
    );

    await reset({ value: 'short', characterLimit: undefined });
    const manual = [];
    await each(async (kind) => {
        const before = await geometry(kind),
            box = await input(kind).boundingBox();
        assert.equal(before.resize, 'vertical');
        assert(box);
        await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width - 4, box.y + box.height + 76, {
            steps: 8,
        });
        await page.mouse.up();
        const after = await geometry(kind);
        assert(
            after.height > before.height + 40,
            'native vertical resize grip must be exercised'
        );
        await update({ placeholder: 'Metadata after manual resize' }, kind);
        const retained = await geometry(kind);
        assert(Math.abs(after.height - retained.height) <= 2);
        manual.push({ kind, before, after, retained });
    });
    await equal(
        'real vertical resize survives unrelated controlled metadata render'
    );

    await reset({ value: '', characterLimit: undefined });
    const composition = [];
    await each(async (kind) => {
        await input(kind).focus();
        const observation = await input(kind).evaluate((element) => {
            element.dispatchEvent(
                new CompositionEvent('compositionstart', {
                    bubbles: true,
                    data: '文',
                })
            );
            Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                'value'
            ).set.call(element, '文');
            element.setSelectionRange(1, 1);
            element.dispatchEvent(
                new InputEvent('input', {
                    bubbles: true,
                    inputType: 'insertCompositionText',
                    data: '文',
                    isComposing: true,
                })
            );
            return { focused: document.activeElement === element };
        });
        assert.equal(observation.focused, true);
        assert.deepEqual((await flush()).models[kind].events, [
            { callback: 'A', value: '文' },
        ]);
        await input(kind).evaluate((element) =>
            element.dispatchEvent(
                new CompositionEvent('compositionend', {
                    bubbles: true,
                    data: '文',
                })
            )
        );
        composition.push({ kind, observation });
    });
    value = await equal(
        'synthetic native composition change forwards immediately; no IME buffer'
    );
    assert.deepEqual(value.models.sdk.events, [{ callback: 'A', value: '文' }]);

    await reset({ value: 'no side effects' });
    await each(async (kind) => {
        await page.locator('#adjacent-' + kind).fill('Keep adjacent');
    });
    await update({
        placeholder: undefined,
        hasErrorMessage: undefined,
        hasDescription: false,
        characterLimit: undefined,
    });
    value = await equal(
        'standalone metadata has no canonical write, submit or I/O'
    );
    assert.deepEqual(value.models.sdk.events, []);
    assert.equal(value.models.sdk.invalid, null);
    assert.equal(await page.locator('textarea[aria-hidden="true"]').count(), 0);
    assert.equal(groups.length, 11);
    Object.assign(evidence, {
        groups,
        pasteEvents,
        warning,
        rawBounds,
        minimum,
        maximum,
        manual,
        composition,
        oracle: {
            sourceSha256:
                '0c82f7ba2166d9e656cf06a85ca0c67bed9904812f964b52b8447ca23a03c327',
            path: 'components/Fields/FieldRenderer/MultilineTextField/MultilineTextField.tsx',
            scope: 'Frozen native presentation projected to scalar metadata plus an observer ref; actual public TextareaInput.',
        },
        scope: 'Actual packed complete component/CSS with native generic Form oracle; trusted Chromium editing/paste/layout and synthetic composition only. Not OS IME, actual host Form/Portal ownership, provider or persistence proof.',
        cleanup:
            'Existing shared harness owns page/context/browser and same-origin resource cleanup.',
    });
}
