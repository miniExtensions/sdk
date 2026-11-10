import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const completeClearableInputTypedConsumer = String.raw`import { createElement, createRef } from 'react';
import {
    CompleteClearableTextInput,
    CompleteDeferredClearableTextInput,
    resolveCurrentClearableInputMobile,
    type CompleteClearableTextInputProps,
    type CompleteDeferredClearableTextInputProps,
} from '@miniextensions/sdk/react';
const ref = createRef<HTMLInputElement>();
const props: CompleteClearableTextInputProps = {
    value: 'answer', onChange(value) { const text: string = value; void text; },
    onClear() {}, clearLabel: 'Clear', initialMobile: false, enableInlineEdit: false,
    id: 'answer', name: 'answer', form: 'existing-form', placeholder: 'Hint',
    autoComplete: 'section-contact email', 'aria-describedby': 'help',
    'aria-invalid': true, style: { color: 'red' }, onFocus() {},
    onBlur() {}, onKeyDown() {}, validateInput: (value) => value.length < 100,
};
createElement(CompleteClearableTextInput, { ...props, ref });
const { enableInlineEdit, ...deferred } = props;
const direct: CompleteDeferredClearableTextInputProps = deferred;
createElement(CompleteDeferredClearableTextInput, { ...direct, ref });
const current: boolean = resolveCurrentClearableInputMobile();
// @ts-expect-error controlled data is a string
const numeric: CompleteClearableTextInputProps = { ...props, value: 1 };
// @ts-expect-error device snapshot must be explicit
const missingDevice: CompleteClearableTextInputProps = { value: '', onChange() {}, onClear() {}, clearLabel: 'Clear', enableInlineEdit: false };
// @ts-expect-error localized accessible Clear label is required
const missingLabel: CompleteDeferredClearableTextInputProps = { value: '', onChange() {}, onClear() {}, initialMobile: false };
// @ts-expect-error no second uncontrolled value
createElement(CompleteClearableTextInput, { ...props, defaultValue: 'other' });
// @ts-expect-error scalar callback is not a native change event
const eventCallback: CompleteClearableTextInputProps = { ...props, onChange(event: import('react').ChangeEvent<HTMLInputElement>) { void event; } };
// @ts-expect-error complete presentation is not a core export
import { CompleteClearableTextInput as CoreInput } from '@miniextensions/sdk';
void enableInlineEdit; void current; void numeric; void missingDevice;
void missingLabel; void eventCallback; void CoreInput;
`;

// Mechanical lifecycle oracle from native blobs b91b4eb045502f4a1e574658ba4dc53aca8bbfeb
// and 3fd226d290eb8eba86a49d716280406c642dd97a. Only language/mobile resolution
// is injected: native wrappers resolve the label and use mount-captured hook data.
// SDK TextInput/InputClearButton are the original actual public primitives.
const frozenNativeSource = String.raw`function nativeClearableOracle(React, TextInput, InputClearButton) {
    const h = React.createElement;
    const classes = (value, mobile) => [value, mobile && 'pr-10'].filter(Boolean).join(' ');
    const clear = (label, disabled, onClick) => h(InputClearButton, {
        label, disabled, onClick,
        className: 'absolute inset-y-0 right-3 flex items-center text-gray-900',
        indicatorClassName: 'flex h-5 w-5 rounded-full bg-gray-600',
        iconClassName: 'm-auto h-3 w-3 text-white',
    });
    const Deferred = React.forwardRef(function NativeDeferred(props, ref) {
        const { value, onChange, onClear, clearLabel, initialMobile, validateInput, ...rest } = props;
        const [mobile] = React.useState(initialMobile);
        const [localValue, setLocalValue] = React.useState(value);
        const latest = React.useRef(localValue);
        const dirty = React.useRef(false);
        React.useEffect(() => { if (!dirty.current) setLocalValue(value); }, [value]);
        React.useEffect(() => { latest.current = localValue; }, [localValue]);
        React.useEffect(() => () => { if (dirty.current) onChange(latest.current); }, []);
        const change = React.useCallback((event) => {
            const next = event.target.value;
            if (validateInput == null || validateInput(next)) {
                dirty.current = true; setLocalValue(next);
            }
        }, [validateInput]);
        const blur = React.useCallback(() => {
            dirty.current = false;
            if (localValue !== value) onChange(localValue);
        }, [onChange, localValue, value]);
        const key = React.useCallback((event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                if (!event.nativeEvent.isComposing) event.currentTarget.blur();
            }
        }, []);
        const onClearClick = React.useCallback(() => {
            dirty.current = false; setLocalValue(''); onClear();
        }, [onClear]);
        return h('div', { className: 'relative flex-1' },
            h(TextInput, { ...rest, ref, className: classes(rest.className, mobile),
                value: localValue, onChange: change, onBlur: blur, onKeyDown: key }),
            mobile && localValue.length > 0 ? clear(clearLabel, rest.disabled || rest.readOnly, onClearClick) : null);
    });
    const Immediate = React.forwardRef(function NativeClearable(props, ref) {
        const { value, onChange, onClear, clearLabel, initialMobile, validateInput, enableInlineEdit, ...rest } = props;
        const [mobile] = React.useState(initialMobile);
        if (enableInlineEdit) return h(Deferred, {
            ...rest, ref, value, onChange, onClear, clearLabel, initialMobile, validateInput,
        });
        return h('div', { className: 'relative flex-1' },
            h(TextInput, { ...rest, ref, value, autoComplete: rest.autoComplete ?? 'on',
                className: classes(rest.className, mobile), onChange: (event) => onChange(event.target.value) }),
            mobile && value.length > 0 ? clear(clearLabel, rest.disabled || rest.readOnly, onClear) : null);
    });
    return { Immediate, Deferred };
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
const require = createRequire(import.meta.url);
const mode = process.argv[2];
const { Window } = await import(pathToFileURL(process.argv[3]).href);
const keys = ['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT','fetch'];
const install = (window, fetch) => {
    const originals = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
    keys.forEach((key) => Object.defineProperty(globalThis, key, {
        configurable: true, writable: true,
        value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : key === 'fetch' ? fetch : window[key],
    }));
    return () => keys.forEach((key, index) => {
        if (originals[index]) Object.defineProperty(globalThis, key, originals[index]);
        else Reflect.deleteProperty(globalThis, key);
    });
};
const load = async () => [await import('@miniextensions/sdk/react'), require('@miniextensions/sdk/react')];
` +
    frozenNativeSource +
    String.raw`
if (mode === 'device') {
    // A separate child process installs a real DOM before the SDK/vendor import.
    const vendorPath = require.resolve('ua-parser-js');
    assert.equal(require.cache[vendorPath], undefined, 'device proof requires an uninitialized vendor realm');
    const window = new Window();
    let requests = 0, entropyReads = 0;
    const restore = install(window, async () => { requests++; throw Error('No device request'); });
    try {
        const apis = await load();
        const { UAParser } = require('ua-parser-js');
        const profiles = [
            { name: 'iphone', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', expected: true },
            { name: 'android-mobile', ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36', expected: true },
            { name: 'ipad', ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', expected: false },
            { name: 'desktop', ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', expected: false },
        ];
        const observations = [];
        for (const profile of profiles) {
            Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: profile.ua });
            Object.defineProperty(window.navigator, 'userAgentData', { configurable: true, value: {
                mobile: profile.expected, brands: [],
                getHighEntropyValues() { entropyReads++; throw Error('No high entropy'); },
            } });
            const type = new UAParser(window.navigator.userAgent).getDevice().type;
            assert.equal(type === 'mobile', profile.expected);
            for (const api of apis) assert.equal(api.resolveCurrentClearableInputMobile(), profile.expected);
            observations.push({ name: profile.name, type: type ?? null, mobile: profile.expected });
        }
        assert.equal(requests, 0); assert.equal(entropyReads, 0);
        console.log(JSON.stringify({ react: React.version, observations, requests, entropyReads,
            scope: 'Fresh DOM-initialized actual UAParser; not the server-imported component realm.' }));
    } finally { restore(); await window.happyDOM.close(); }
} else {
    const apis = await load();
    const directory = dirname(fileURLToPath(import.meta.url));
    const installed = join(directory, 'node_modules/@miniextensions/sdk');
    assert(fileURLToPath(import.meta.resolve('@miniextensions/sdk/react')).startsWith(join(installed, 'dist/esm/react')));
    assert(require.resolve('@miniextensions/sdk/react').startsWith(join(installed, 'dist/cjs/react')));
    assert.equal('CompleteClearableTextInput' in require('@miniextensions/sdk'), false);
    const cssPath = require.resolve('@miniextensions/sdk/react/complete-clearable-text-input.css');
    assert(cssPath.startsWith(join(installed, 'dist/esm/react')));
    const css = readFileSync(cssPath, 'utf8');
    for (const selector of ['.mx-sdk-complete-clearable-input','.mx-sdk-complete-clearable-button','.mx-sdk-complete-clearable-indicator','.mx-sdk-complete-clearable-icon']) assert(css.includes(selector));
    assert(!css.includes('@apply') && !css.includes('@tailwind'));
    let groups = 0;
    for (const api of apis) {
        assert.equal(typeof globalThis.document, 'undefined');
        assert.equal(api.resolveCurrentClearableInputMobile(), false, 'no-window guard only, not browser UA parity');
        const native = nativeClearableOracle(React, api.TextInput, api.InputClearButton);
        for (const direct of [false, true]) {
            const outcomes = [];
            for (const Component of [direct ? api.CompleteDeferredClearableTextInput : api.CompleteClearableTextInput,
                direct ? native.Deferred : native.Immediate]) {
                const model = { value: 'seed', writer: 'A', active: 'A', mobile: true,
                    inline: direct, visible: true, key: 0, autoComplete: undefined };
                const events = [], accepted = [], validations = [], host = [];
                const ref = React.createRef();
                let root, mounted = false, submits = 0, requests = 0;
                const reject = async () => { requests++; throw Error('Clearable input must not fetch'); };
                const record = (type, writer, value) => {
                    events.push({ type, writer, value });
                    if (writer !== model.active) return;
                    accepted.push({ type, writer, value });
                    model.value = type === 'clear' ? '' : value;
                    if (mounted) root.render(node());
                };
                const props = () => {
                    const writer = model.writer;
                    return { value: model.value, clearLabel: 'Clear field', initialMobile: model.mobile,
                        onChange: (value) => record('change', writer, value),
                        onClear: () => record('clear', writer, ''),
                        validateInput(value) { validations.push(value); return !value.includes('#'); },
                        autoComplete: model.autoComplete, ref, id: 'answer', name: 'answer',
                        form: 'fixture-form', placeholder: 'Answer hint', 'aria-describedby': 'answer-help',
                        'aria-invalid': true, onBlur() { host.push('blur'); },
                        onKeyDown(event) { host.push('key:' + event.key); },
                        ...(direct ? {} : { enableInlineEdit: model.inline }) };
                };
                const node = () => React.createElement(React.StrictMode, null,
                    React.createElement('form', { id: 'fixture-form', onSubmit(event) { event.preventDefault(); submits++; } },
                        model.visible ? React.createElement(Component, { ...props(), key: model.key }) : null,
                        React.createElement('input', { 'aria-label': 'Adjacent', defaultValue: 'Keep adjacent' })));
                const html = renderToString(node());
                assert(html.includes('value="seed"') && html.includes('aria-label="Clear field"'));
                const window = new Window();
                Object.defineProperty(window, 'fetch', { value: reject });
                const container = window.document.createElement('div');
                container.innerHTML = html; window.document.body.append(container);
                const beforeInput = container.querySelector('#answer');
                const restore = install(window, reject);
                const errors = [];
                try {
                    const { hydrateRoot } = await import('react-dom/client');
                    await React.act(async () => { root = hydrateRoot(container, node(), {
                        onRecoverableError(error) { errors.push(error); },
                    }); });
                    mounted = true;
                    assert.equal(ref.current, beforeInput);
                    const adjacent = container.querySelector('[aria-label="Adjacent"]');
                    adjacent.value = 'Retain neighboring draft';
                    const publish = async (patch = {}) => {
                        Object.assign(model, patch);
                        await React.act(async () => root.render(node()));
                        assert.equal(adjacent.value, 'Retain neighboring draft');
                    };
                    const field = () => container.querySelector('#answer');
                    const type = async (value) => React.act(async () => {
                        field().focus();
                        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field(), value);
                        field().dispatchEvent(new window.Event('input', { bubbles: true }));
                    });
                    assert.equal(field().getAttribute('form'), 'fixture-form');
                    assert.equal(field().getAttribute('name'), 'answer');
                    assert.equal(field().getAttribute('aria-describedby'), 'answer-help');
                    if (!direct) {
                        assert.equal(field().getAttribute('autocomplete'), 'on');
                        await type('seed#');
                        assert.equal(model.value, 'seed#'); assert.deepEqual(validations, []);
                        await publish({ inline: true });
                    }
                    assert.equal(field().getAttribute('autocomplete'), null);
                    const deferredInput = field();
                    const beforeEcho = events.length;
                    await publish({ value: 'echo' });
                    assert.equal(field(), deferredInput); assert.equal(field().value, 'echo');
                    assert.equal(events.length, beforeEcho);
                    await type('draft!');
                    const afterType = events.length;
                    await publish({ value: 'acknowledged', writer: 'B', active: 'B' });
                    assert.equal(field().value, 'draft!');
                    assert.equal(events.length, afterType);
                    await React.act(async () => field().blur());
                    assert.deepEqual(events.at(-1), { type: 'change', writer: 'B', value: 'draft!' });
                    const settled = events.length;
                    await publish({ visible: false });
                    assert.equal(events.length, settled); assert.equal(ref.current, null);
                    await publish({ visible: true, key: model.key + 1, value: 'start', writer: 'A', active: 'A' });
                    await type('latest');
                    await publish({ writer: 'B', active: 'B', value: 'successor' });
                    const acceptedBefore = accepted.length;
                    await publish({ visible: false });
                    assert.deepEqual(events.at(-1), { type: 'change', writer: 'A', value: 'latest' });
                    assert.equal(accepted.length, acceptedBefore);
                    assert.equal(model.value, 'successor');
                    assert.equal(ref.current, null);
                    await publish({ visible: true, key: model.key + 1, value: 'fresh', writer: 'A', active: 'A' });
                    const beforeClear = events.length;
                    await React.act(async () => container.querySelector('button').click());
                    assert.deepEqual(events.slice(beforeClear), [{ type: 'clear', writer: 'A', value: '' }]);
                    assert.equal(field().value, '');
                    assert.equal(container.querySelector('button'), null);
                    for (const autoComplete of [undefined,'off','on','section-contact email']) {
                        await publish({ autoComplete });
                        assert.equal(field().getAttribute('autocomplete'), autoComplete ?? null);
                    }
                    assert.equal(submits, 0); assert.equal(requests, 0); assert.deepEqual(errors, []);
                    outcomes.push({ events, accepted, validations, host, value: model.value });
                } finally {
                    mounted = false;
                    try { if (root) await React.act(async () => root.unmount()); }
                    finally { restore(); await window.happyDOM.close(); }
                }
            }
            assert.deepEqual(outcomes[0], outcomes[1], 'installed component matches frozen native lifecycle');
            groups++;
        }
    }
    console.log(JSON.stringify({ react: React.version, groups, cleanup: 'completed',
        scope: 'Actual installed ESM/CJS and frozen native lifecycle through generic Form DOM, SSR/hydration and declarations; not host Form/Portal or provider proof.' }));
}
`;

export function checkCompleteClearableInputReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(
        join(tmpdir(), 'sdk-complete-clearable-input-')
    );
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
                const name = 'complete-clearable-input.' + extension;
                writeFileSync(
                    join(directory, name),
                    completeClearableInputTypedConsumer
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
                    name,
                ]);
            }
            const execute = (mode) =>
                JSON.parse(
                    execFileSync(
                        process.execPath,
                        [
                            join(directory, 'consumer-runtime.mjs'),
                            mode,
                            happyDomModulePath,
                        ],
                        { cwd: directory, encoding: 'utf8' }
                    )
                );
            const runtime = execute('ssr');
            assert.equal(runtime.react, version.react);
            assert.equal(runtime.groups, 4);
            assert.equal(runtime.cleanup, 'completed');
            const device = execute('device');
            assert.equal(device.react, version.react);
            assert.equal(device.observations.length, 4);
            assert.equal(device.requests, 0);
            assert.equal(device.entropyReads, 0);
            versions.push({ ...runtime, device });
            console.log(
                'Installed complete clearable input React' +
                    version.react +
                    ': strict ESM/CJS, explicit-device SSR/hydration, frozen native lifecycle and fresh-realm device checks passed.'
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

export const completeClearableInputBrowserStyle = [
    'body { font-family:monospace; font-size:16px; line-height:24px; margin:16px; }',
    '.fixture-row { width:320px; margin-bottom:24px; }',
    '.fixture-row input { box-sizing:border-box; width:280px; height:36px; padding-left:8px; border:1px solid #555; font:inherit; }',
    '.frozen-native :where(.relative) { position:relative; }',
    '.frozen-native :where(.flex-1) { flex:1 1 0%; }',
    '.frozen-native :where(.pr-10) { padding-right:2.5rem; }',
    '.frozen-native :where(button.absolute) { position:absolute;top:0;bottom:0;right:.75rem;display:flex;align-items:center;border:0;padding:0;background:transparent; }',
    '.frozen-native :where(button > span) { display:flex;width:20px;height:20px;border-radius:9999px;background:#4b5563; }',
    '.frozen-native :where(button svg) { margin:auto;width:12px;height:12px;color:white; }',
    '.fixture-row .consumer-override { padding-right:9px; }',
].join('\n');

export const completeClearableInputBrowserSource =
    String.raw`import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { UAParser } from 'ua-parser-js';
import { CompleteClearableTextInput, CompleteDeferredClearableTextInput,
    resolveCurrentClearableInputMobile, TextInput, InputClearButton } from '@miniextensions/sdk/react';
` +
    frozenNativeSource +
    String.raw`
const native = nativeClearableOracle(React, TextInput, InputClearButton);
const state = { errors: [], requests: 0, entropyReads: 0, submits: 0, revision: 0, committed: 0 };
let models, root, serial = 0;
const pending = new Map();
const make = () => ({
    key: ++serial, value: 'seed', writer: 'A', active: 'A', values: { A: 'seed', B: 'successor' },
    inline: false, direct: false, mobileOverride: true, visible: true,
    disabled: false, readOnly: false, validate: true, label: 'Clear field',
    hint: 'Answer hint', invalid: true, className: '', autoComplete: undefined,
    events: [], accepted: [], validations: [], host: [], trusted: [], ref: React.createRef(),
});
const snapshot = () => ({
    ...state, errors: [...state.errors], reactVersion: React.version,
    models: Object.fromEntries(Object.entries(models ?? {}).map(([kind, model]) => {
        const row = document.getElementById('row-' + kind);
        const input = row?.querySelector('input[name="answer"]');
        const button = row?.querySelector('button');
        return [kind, {
            value: model.value, values: { ...model.values }, events: [...model.events],
            accepted: [...model.accepted], validations: [...model.validations], host: [...model.host],
            trusted: [...model.trusted], displayed: input?.value ?? null,
            clearVisible: !!button, refMatches: !!input && model.ref.current === input,
            refNull: model.ref.current === null, mobileClass: input?.classList.contains('pr-10') ?? null,
            autocomplete: input?.getAttribute('autocomplete') ?? null,
            focused: !!input && document.activeElement === input,
            selection: input ? [input.selectionStart,input.selectionEnd] : null,
            adjacent: document.getElementById('adjacent-' + kind)?.value ?? null,
        }];
    })),
});
window.__nativeProbe = { snapshot };
window.addEventListener('error', (event) => state.errors.push(String(event.error || event.message)));
window.addEventListener('unhandledrejection', (event) => state.errors.push(String(event.reason)));
window.fetch = async () => { state.requests++; throw Error('Clearable fixture cannot fetch'); };
XMLHttpRequest.prototype.open = function () { state.requests++; throw Error('Clearable fixture cannot use XHR'); };
function publish() {
    const revision = ++state.revision;
    const committed = new Promise((resolve) => pending.set(revision, resolve));
    root.render(React.createElement(App, { revision }));
    return committed;
}
function record(model, type, writer, value) {
    model.events.push({ type, writer, value });
    if (writer !== model.active) return;
    model.accepted.push({ type, writer, value });
    model.value = value; model.values[writer] = value;
    void publish();
}
function App({ revision }) {
    useEffect(() => {
        state.committed = revision;
        for (const [key, resolve] of pending) if (key <= revision) { pending.delete(key); resolve(); }
    }, [revision]);
    return React.createElement('main', null, ...Object.entries(models).map(([kind, model]) => {
        const writer = model.writer;
        const Component = kind === 'sdk'
            ? (model.direct ? CompleteDeferredClearableTextInput : CompleteClearableTextInput)
            : (model.direct ? native.Deferred : native.Immediate);
        const mobile = typeof model.mobileOverride === 'boolean'
            ? model.mobileOverride : resolveCurrentClearableInputMobile();
        const props = {
            key: model.key, ref: model.ref, value: model.value, initialMobile: mobile,
            clearLabel: model.label,
            onChange: (value) => record(model,'change',writer,value),
            onClear: () => record(model,'clear',writer,''),
            validateInput: model.validate ? (value) => { model.validations.push(value); return !value.includes('#'); } : undefined,
            id: 'answer-' + kind, name: 'answer', form: 'form-' + kind,
            placeholder: model.hint, 'aria-label': 'Answer ' + kind,
            'aria-describedby': 'help-' + kind, 'aria-invalid': model.invalid,
            disabled: model.disabled, readOnly: model.readOnly,
            className: model.className, autoComplete: model.autoComplete,
            onBlur() { model.host.push('blur'); },
            onKeyDown(event) { model.host.push('key:' + event.key); },
            onFocus() { model.host.push('focus'); },
            onCompositionStart() { model.host.push('composition-start'); },
            onCompositionEnd() { model.host.push('composition-end'); },
            onInput(event) { model.trusted.push(event.isTrusted); },
            ...(model.direct ? {} : { enableInlineEdit: model.inline }),
        };
        return React.createElement('form', {
            key: kind, id:'form-' + kind,
            onSubmit(event) { event.preventDefault(); state.submits++; },
        }, React.createElement('section', {
            id:'row-' + kind, className:'fixture-row ' + (kind === 'native' ? 'frozen-native' : ''),
        }, model.visible ? React.createElement(Component, props) : null,
        React.createElement('p', { id:'help-' + kind }, 'Synthetic help'),
        React.createElement('input', { id:'adjacent-' + kind, defaultValue:'Keep adjacent' })));
    }));
}
window.__clearableFixture = {
    async reset(patch = {}) {
        if (models) { Object.values(models).forEach((model) => { model.visible = false; }); await publish(); }
        models = { sdk: make(), native: make() };
        Object.values(models).forEach((model) => Object.assign(model, patch));
        await publish(); return snapshot();
    },
    async update(patch, selectedKind) {
        for (const [kind, model] of Object.entries(models))
            if (selectedKind == null || selectedKind === kind) Object.assign(model, patch);
        await publish(); return snapshot();
    },
    async flush() { await publish(); return snapshot(); },
    capture() { window.__clearableSavedNodes = Object.fromEntries(Object.entries(models).map(([kind,model]) => [kind,model.ref.current])); },
    identity() { return Object.fromEntries(Object.entries(models).map(([kind,model]) => [kind,window.__clearableSavedNodes?.[kind] === model.ref.current])); },
    device(profile) {
        for (const [key,value] of Object.entries({ userAgent: profile.ua, platform: profile.platform ?? 'Linux', maxTouchPoints: profile.touch ?? 0 }))
            Object.defineProperty(navigator,key,{configurable:true,value});
        Object.defineProperty(navigator,'userAgentData',{configurable:true,value:{
            mobile: profile.hint ?? false, brands: [],
            getHighEntropyValues() { state.entropyReads++; throw Error('No high entropy'); },
        }});
        const type = new UAParser(navigator.userAgent).getDevice().type;
        return { type:type ?? null, mobile:resolveCurrentClearableInputMobile() };
    },
};
models = { sdk: make(), native: make() };
root = createRoot(document.getElementById('root'));
void publish();
`;

const iphone =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const desktop =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Existing normal harness owns the page, browser, CSP, route map and cleanup. */
export async function checkCompleteClearableInputBrowser({ page, evidence }) {
    await page.waitForFunction(
        () => window.__nativeProbe?.snapshot().committed > 0
    );
    const groups = [];
    const reset = (patch = {}) =>
        page.evaluate((value) => window.__clearableFixture.reset(value), patch);
    const update = (patch) =>
        page.evaluate(
            (value) => window.__clearableFixture.update(value),
            patch
        );
    // Settle each focused dirty input before focusing the other fixture. Moving
    // focus itself causes native blur, so two simultaneous dirty fixture inputs
    // would invalidate the intended callback/owner transition observation.
    const updateKind = (kind, patch) =>
        page.evaluate(
            ({ kind, patch }) => window.__clearableFixture.update(patch, kind),
            { kind, patch }
        );
    const flush = () => page.evaluate(() => window.__clearableFixture.flush());
    const input = (kind) =>
        page.locator('#row-' + kind + ' input[name="answer"]');
    const clear = (kind) => page.locator('#row-' + kind + ' button');
    const each = async (action) => {
        for (const kind of ['sdk', 'native']) await action(kind);
    };
    const equal = async (name) => {
        const value = await flush();
        for (const key of [
            'events',
            'accepted',
            'validations',
            'displayed',
            'value',
            'values',
            'clearVisible',
            'autocomplete',
            'mobileClass',
        ]) {
            assert.deepEqual(
                value.models.sdk[key],
                value.models.native[key],
                name + ': ' + key
            );
        }
        assert.deepEqual(value.errors, []);
        assert.equal(value.requests, 0);
        assert.equal(value.entropyReads, 0);
        assert.equal(value.submits, 0);
        groups.push({
            name,
            sdk: value.models.sdk,
            native: value.models.native,
        });
        return value;
    };

    await reset();
    await each(async (kind) => {
        await input(kind).fill('immediate#');
        assert.equal(await input(kind).inputValue(), 'immediate#');
    });
    let value = await equal(
        'immediate controlled typing ignores deferred validator'
    );
    assert.deepEqual(value.models.sdk.validations, []);
    assert.deepEqual(value.models.sdk.events, [
        { type: 'change', writer: 'A', value: 'immediate#' },
    ]);

    await reset({ inline: true });
    await each(async (kind) => {
        await input(kind).focus();
        await input(kind).press('End');
        await input(kind).pressSequentially('!#');
        assert.equal(await input(kind).inputValue(), 'seed!');
        await updateKind(kind, { writer: 'B', active: 'B' });
        await input(kind).press('Tab');
    });
    value = await equal('deferred validation and current blur callback');
    assert.deepEqual(value.models.sdk.events, [
        { type: 'change', writer: 'B', value: 'seed!' },
    ]);
    assert(value.models.sdk.validations.includes('seed!#'));
    assert.equal(value.models.sdk.host.includes('blur'), false);

    await reset({ inline: true });
    await page.evaluate(() => window.__clearableFixture.capture());
    await update({ value: 'echo' });
    await page.waitForFunction(() =>
        Object.values(window.__nativeProbe.snapshot().models).every(
            (m) => m.displayed === 'echo'
        )
    );
    await each(async (kind) => {
        await input(kind).fill('dirty');
        await updateKind(kind, { value: 'acknowledged' });
        const current = (await flush()).models[kind];
        assert.equal(current.displayed, 'dirty');
        assert.deepEqual(current.events, []);
        await input(kind).press('Tab');
    });
    value = await equal('clean echoes reconcile; dirty echoes preserve drafts');
    assert.equal(value.models.sdk.displayed, 'dirty');
    assert.deepEqual(value.models.sdk.events, [
        { type: 'change', writer: 'A', value: 'dirty' },
    ]);
    assert.deepEqual(
        await page.evaluate(() => window.__clearableFixture.identity()),
        { sdk: true, native: true }
    );

    await reset({ inline: true });
    await each(async (kind) => {
        await input(kind).fill('enter');
        await input(kind).press('Enter');
    });
    value = await equal('ordinary Enter blurs and commits without submit');
    assert.deepEqual(value.models.sdk.events, [
        { type: 'change', writer: 'A', value: 'enter' },
    ]);
    assert.equal(
        value.models.sdk.host.some(
            (event) => event.startsWith('key:') || event === 'blur'
        ),
        false
    );

    await reset({ inline: true });
    await each(async (kind) => {
        await input(kind).fill('composition');
        await input(kind).focus();
        const result = await input(kind).evaluate((element) => {
            element.dispatchEvent(
                new CompositionEvent('compositionstart', {
                    bubbles: true,
                    data: 'x',
                })
            );
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true,
                isComposing: true,
            });
            element.dispatchEvent(event);
            const result = {
                prevented: event.defaultPrevented,
                focused: document.activeElement === element,
            };
            element.dispatchEvent(
                new CompositionEvent('compositionend', {
                    bubbles: true,
                    data: 'x',
                })
            );
            return result;
        });
        assert.deepEqual(result, { prevented: true, focused: true });
        assert.deepEqual((await flush()).models[kind].events, []);
        await input(kind).press('Enter');
    });
    value = await equal(
        'synthetic DOM composition Enter then trusted Enter; not OS IME proof'
    );
    assert.deepEqual(value.models.sdk.events, [
        { type: 'change', writer: 'A', value: 'composition' },
    ]);

    await reset({ inline: true });
    await each(async (kind) => {
        await input(kind).focus();
        await clear(kind).click();
    });
    value = await equal('pristine pointer Clear');
    assert.deepEqual(value.models.sdk.events, [
        { type: 'clear', writer: 'A', value: '' },
    ]);

    await reset({ inline: true });
    await each(async (kind) => {
        await input(kind).fill('pointer');
        await clear(kind).click();
    });
    value = await equal('dirty pointer blur commits before Clear');
    assert.deepEqual(value.models.sdk.events, [
        { type: 'change', writer: 'A', value: 'pointer' },
        { type: 'clear', writer: 'A', value: '' },
    ]);

    await reset({ inline: true });
    await each(async (kind) => {
        await input(kind).fill('keyboard');
        await input(kind).press('Tab');
        assert.equal(
            await clear(kind).evaluate(
                (button) => document.activeElement === button
            ),
            true
        );
        await page.keyboard.press('Space');
    });
    value = await equal('dirty keyboard Tab then Space Clear');
    assert.deepEqual(value.models.sdk.events, [
        { type: 'change', writer: 'A', value: 'keyboard' },
        { type: 'clear', writer: 'A', value: '' },
    ]);

    for (const inline of [false, true])
        for (const policy of ['disabled', 'readOnly']) {
            await reset({ inline, [policy]: true });
            await each(async (kind) => {
                assert.equal(await clear(kind).isDisabled(), true);
                const box = await clear(kind).boundingBox();
                assert(box);
                await page.mouse.click(
                    box.x + box.width / 2,
                    box.y + box.height / 2
                );
                if (policy === 'readOnly') {
                    await input(kind).focus();
                    await page.keyboard.type('forbidden');
                }
            });
            value = await flush();
            for (const model of Object.values(value.models)) {
                assert.equal(model.displayed, 'seed');
                assert.deepEqual(model.events, []);
            }
        }
    await equal('disabled and readonly policies retain text and deny Clear');

    await page.evaluate(
        (ua) => window.__clearableFixture.device({ ua, hint: true }),
        iphone
    );
    await reset({ mobileOverride: null });
    await page.evaluate(
        (ua) => window.__clearableFixture.device({ ua, hint: false }),
        desktop
    );
    await update({ mobileOverride: null, label: 'Borrar' });
    assert.equal(await clear('sdk').getAttribute('aria-label'), 'Borrar');
    value = await flush();
    assert.equal(value.models.sdk.clearVisible, true);
    await update({ inline: true });
    value = await flush();
    assert.equal(value.models.sdk.clearVisible, false);
    await page.evaluate(
        (ua) => window.__clearableFixture.device({ ua, hint: true }),
        iphone
    );
    await update({ mobileOverride: null });
    value = await flush();
    assert.equal(value.models.sdk.clearVisible, false);
    await update({ inline: false });
    value = await flush();
    assert.equal(value.models.sdk.clearVisible, true);
    await update({ inline: true });
    value = await equal(
        'mount capture and fresh deferred mode use raw current device'
    );
    assert.equal(value.models.sdk.clearVisible, true);

    await reset({ direct: true });
    await each(async (kind) => {
        await input(kind).fill('direct');
        assert.equal(await input(kind).getAttribute('autocomplete'), null);
        await input(kind).press('Tab');
    });
    value = await equal('standalone deferred public component');
    assert.deepEqual(value.models.sdk.events, [
        { type: 'change', writer: 'A', value: 'direct' },
    ]);

    await reset({ inline: true });
    await each(async (kind) => {
        await input(kind).fill('latest');
        await updateKind(kind, { writer: 'B', active: 'B' });
        await updateKind(kind, { writer: 'A', active: 'A' });
        await updateKind(kind, { visible: false });
    });
    value = await equal(
        'callback ABA unmount retains mounted writer and latest draft'
    );
    assert.deepEqual(value.models.sdk.events, [
        { type: 'change', writer: 'A', value: 'latest' },
    ]);
    assert.equal(value.models.sdk.refNull, true);

    await reset({ inline: true });
    await each(async (kind) => {
        await input(kind).fill('old-draft');
        await updateKind(kind, {
            writer: 'B',
            active: 'B',
            value: 'successor',
            key: 9999,
        });
    });
    value = await equal(
        'keyed owner replacement records and rejects retired writer attempt'
    );
    assert.deepEqual(value.models.sdk.events, [
        { type: 'change', writer: 'A', value: 'old-draft' },
    ]);
    assert.deepEqual(value.models.sdk.accepted, []);
    assert.equal(value.models.sdk.value, 'successor');
    assert.equal(value.models.sdk.displayed, 'successor');
    assert.equal(value.models.sdk.values.B, 'successor');

    const profiles = [
        { name: 'iphone', ua: iphone, hint: true, expected: true },
        {
            name: 'android-mobile',
            ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            hint: true,
            expected: true,
        },
        {
            name: 'ipad',
            ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
            platform: 'iPad',
            touch: 5,
            expected: false,
        },
        { name: 'desktop', ua: desktop, expected: false },
        {
            name: 'desktop-mode-ipad',
            ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
            platform: 'MacIntel',
            touch: 5,
            expected: false,
        },
    ];
    const observations = [];
    for (const profile of profiles) {
        const actual = await page.evaluate(
            (item) => window.__clearableFixture.device(item),
            profile
        );
        assert.equal(actual.mobile, actual.type === 'mobile');
        assert.equal(actual.mobile, profile.expected);
        observations.push({ name: profile.name, ...actual });
    }
    await equal(
        'real browser-initialized vendor device policy; no entropy or transmission'
    );

    for (const inline of [false, true])
        for (const autoComplete of [
            undefined,
            'off',
            'on',
            'section-contact email',
        ]) {
            await reset({ inline, autoComplete });
            for (const kind of ['sdk', 'native'])
                assert.equal(
                    await input(kind).getAttribute('autocomplete'),
                    autoComplete ?? (inline ? null : 'on')
                );
        }
    await reset();
    await each(async (kind) => {
        await page
            .locator('#adjacent-' + kind)
            .fill('Retain neighboring draft');
        await input(kind).focus();
        await input(kind).evaluate((element) =>
            element.setSelectionRange(1, 3)
        );
    });
    await page.evaluate(() => window.__clearableFixture.capture());
    await update({
        hint: 'Current hint',
        invalid: false,
        className: 'consumer-override',
    });
    const geometry = await page.evaluate(() => {
        const input = document.querySelector('#row-sdk input[name="answer"]');
        const button = document.querySelector('#row-sdk button');
        const indicator = button.querySelector('span'),
            icon = button.querySelector('svg');
        const wrapper = input.parentElement,
            a = wrapper.getBoundingClientRect(),
            b = button.getBoundingClientRect();
        return {
            ref: window.__clearableFixture.identity(),
            hint: input.placeholder,
            invalid: input.getAttribute('aria-invalid'),
            padding: getComputedStyle(input).paddingRight,
            selection: [input.selectionStart, input.selectionEnd],
            indicator: [
                indicator.getBoundingClientRect().width,
                indicator.getBoundingClientRect().height,
            ],
            icon: [
                icon.getBoundingClientRect().width,
                icon.getBoundingClientRect().height,
            ],
            contained:
                b.left >= a.left &&
                b.right <= a.right &&
                b.top >= a.top &&
                b.bottom <= a.bottom,
            adjacent: document.getElementById('adjacent-sdk').value,
        };
    });
    assert.deepEqual(geometry.ref, { sdk: true, native: true });
    assert.equal(geometry.hint, 'Current hint');
    assert.equal(geometry.invalid, 'false');
    assert.equal(geometry.padding, '9px');
    assert.deepEqual(geometry.selection, [1, 3]);
    assert.deepEqual(geometry.indicator, [20, 20]);
    assert.deepEqual(geometry.icon, [12, 12]);
    assert.equal(geometry.contained, true);
    assert.equal(geometry.adjacent, 'Retain neighboring draft');
    await update({ className: '' });
    assert.equal(
        await input('sdk').evaluate(
            (element) => getComputedStyle(element).paddingRight
        ),
        '40px'
    );
    await equal('attributes refs autocomplete and scoped standalone CSS');
    assert.equal(groups.length, 15);
    Object.assign(evidence, {
        groups,
        device: observations,
        geometry,
        oracle: {
            immediate: 'b91b4eb045502f4a1e574658ba4dc53aca8bbfeb',
            deferred: '3fd226d290eb8eba86a49d716280406c642dd97a',
            scope: 'Mechanical frozen lifecycle with actual SDK primitives and explicit resolved label/mobile inputs.',
        },
        scope: 'Installed public clearable UI plus frozen native generic Form fixture; real Chromium focus/pointer/layout, synthetic composition branch only; not actual host Form/Portal, OS IME, provider or authorization proof.',
        cleanup:
            'Page/context/browser cleanup belongs to the normal shared harness.',
    });
}
