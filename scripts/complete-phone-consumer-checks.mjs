import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const completePhoneTypedConsumer = String.raw`import { createElement } from 'react';
import { CompletePhoneNumberField, type CompletePhoneNumberFieldProps,
    type CompletePhoneEditOwner, type CompletePhoneCommit,
    PhoneNumberField, type PhoneNumberFieldProps, type TextFieldProps,
    type PhoneEditOwner, type PhoneCommit } from '@miniextensions/sdk/react';
const owner: CompletePhoneEditOwner = { token: {}, isCurrent: () => true };
const props: CompletePhoneNumberFieldProps = {
    value: '+233201234567', showCountryCodes: true, defaultCountry: 'GH',
    commit: 'deferred', owner, clearLabel: 'Clear phone',
    input: { id: 'phone', form: 'existing-form', 'aria-describedby': 'phone-help' },
    onValueChange(value: string | undefined, commit: CompletePhoneCommit) {
        void value; void commit.ownerToken; void commit.reason;
    },
};
createElement(CompletePhoneNumberField, props);
createElement(CompletePhoneNumberField, { value: '', onValueChange() {} });
const canonical: PhoneNumberFieldProps = props;
const canonicalOwner: PhoneEditOwner = owner;
const canonicalCommit = (commit: PhoneCommit) => commit.reason;
declare const bindingProps: TextFieldProps;
createElement(PhoneNumberField, bindingProps);
createElement(PhoneNumberField, canonical);
createElement(PhoneNumberField, { value: null, onValueChange() {} });
// @ts-expect-error a caller must select binding or controlled props, never both
const mixed: PhoneNumberFieldProps = { ...props, binding: bindingProps.binding };
// @ts-expect-error a controlled field cannot inject the binding renderer
const injected: PhoneNumberFieldProps = { ...props, render() { return null; } };
// @ts-expect-error controlled-only options cannot silently configure a binding field
const ambiguous: PhoneNumberFieldProps = { ...bindingProps, showCountryCodes: true };
// @ts-expect-error the canonical deferred contract retains its owner requirement
const canonicalUnowned: PhoneNumberFieldProps = { value: '', commit: 'deferred', onValueChange() {} };
// @ts-expect-error deferred edits require an actual host owner
const unowned: CompletePhoneNumberFieldProps = { value: '', commit: 'deferred', onValueChange() {} };
// @ts-expect-error telephone data is not a numeric value
const numeric: CompletePhoneNumberFieldProps = { ...props, value: 233 };
// @ts-expect-error the component owns its input change callback
createElement(CompletePhoneNumberField, { ...props, input: { onChange() {} } });
// @ts-expect-error complete Phone is React-only
import { CompletePhoneNumberField as CorePhone } from '@miniextensions/sdk';
void unowned; void numeric; void CorePhone; void mixed; void injected; void ambiguous;
void canonicalUnowned; void canonicalOwner; void canonicalCommit;
`;

const runtime = String.raw`import assert from 'node:assert/strict';
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
const directory = dirname(fileURLToPath(import.meta.url));
const installed = join(directory, 'node_modules', '@miniextensions', 'sdk');
assert(fileURLToPath(import.meta.resolve('@miniextensions/sdk/react')).startsWith(join(installed, 'dist', 'esm', 'react')));
assert(require.resolve('@miniextensions/sdk/react').startsWith(join(installed, 'dist', 'cjs', 'react')));
assert.equal('CompletePhoneNumberField' in require('@miniextensions/sdk'), false);
const cssPath = require.resolve('@miniextensions/sdk/react/complete-phone.css');
assert(cssPath.startsWith(join(installed, 'dist', 'esm', 'react')));
const css = readFileSync(cssPath, 'utf8');
for (const selector of ['.mx-sdk-complete-phone', '.mx-sdk-phone-input',
    '.mx-sdk-phone-clear', '.mx-sdk-complete-phone-readonly']) assert(css.includes(selector));

let groups = 0;
for (const api of [esm, cjs]) {
    assert.equal(typeof api.CompletePhoneNumberField, 'function');
    assert.equal(typeof api.CompleteReadOnlyPhoneNumberField, 'function');
    assert.equal(typeof api.PhoneNumberField, 'function', 'legacy public component remains exported');
    assert.equal(typeof api.ReadOnlyPhoneNumberField, 'function');
    assert.equal(typeof globalThis.document, 'undefined');
    for (const Component of [api.CompletePhoneNumberField, api.PhoneNumberField]) {
    let value = '+14155552671';
    let deferred = false;
    let hint = 'Enter phone';
    let ownerToken = {};
    const writes = [];
    let mountedRoot;
    let active = false;
    let requests = 0;
    let submits = 0;
    const refuseRequest = async () => { requests++; throw Error('Unexpected Phone request'); };
    const node = () => {
        const renderedToken = ownerToken;
        const owner = { token: renderedToken, isCurrent: () => true };
        return React.createElement(React.StrictMode, null, React.createElement('form', {
        id: 'consumer-phone-form', onSubmit(event) { event.preventDefault(); submits++; },
    }, React.createElement(Component, {
        value, showCountryCodes: true, defaultCountry: 'GH',
        commit: deferred ? 'deferred' : 'immediate', owner,
        clearButton: 'always', clearLabel: 'Clear phone',
        input: { id: 'consumer-phone', form: 'consumer-phone-form', name: 'phone',
            placeholder: hint, 'aria-label': 'Phone', 'aria-describedby': 'phone-help' },
        onValueChange(next, commit) {
            assert.equal(commit.ownerToken, renderedToken);
            writes.push({ value: next, reason: commit.reason });
            value = next;
            if (active) mountedRoot.render(node());
        },
    }), React.createElement('input', { 'aria-label': 'Adjacent', defaultValue: 'Keep adjacent' })));
    };
    const html = renderToString(node());
    const window = new Window();
    Object.defineProperty(window, 'fetch', { value: refuseRequest });
    const container = window.document.createElement('div');
    container.innerHTML = html;
    window.document.body.append(container);
    const originalInput = container.querySelector('input[name="phone"]');
    assert(originalInput);
    assert.equal(originalInput.value, '+1 415 555 2671');
    // Assert React's serialized selected attribute, not Happy DOM 20's
    // parse-time selectedness. Hydration does not repair that parser state.
    const selected = html.match(/<option\b[^>]*\sselected=""[^>]*>/g) ?? [];
    assert.equal(selected.length, 1);
    assert(selected[0].includes(' value="US"'));
    assert.equal(container.querySelector('img'), null, 'unicode flags need no remote image');
    assert.deepEqual(writes, []);
    const keys = ['window', 'document', 'navigator', 'HTMLElement',
        'HTMLInputElement', 'HTMLSelectElement', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
    const original = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
    const recoverable = [];
    try {
        for (const key of keys) Object.defineProperty(globalThis, key, {
            configurable: true, writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true
                : key === 'fetch' ? refuseRequest : window[key],
        });
        const { hydrateRoot } = await import('react-dom/client');
        await React.act(async () => {
            mountedRoot = hydrateRoot(container, node(), {
                onRecoverableError(error) { recoverable.push(error); },
            });
        });
        active = true;
        const input = () => container.querySelector('input[name="phone"]');
        assert.equal(input(), originalInput);
        const adjacent = container.querySelector('input[aria-label="Adjacent"]');
        assert(adjacent);
        adjacent.value = 'Retain neighboring draft';
        const publish = async () => { await React.act(async () => mountedRoot.render(node())); };
        const edit = async (text) => {
            await React.act(async () => {
                const field = input();
                Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field, text);
                field.setSelectionRange(text.length, text.length);
                field.dispatchEvent(new window.InputEvent('input', {
                    bubbles: true, inputType: 'insertFromPaste', data: text,
                }));
            });
        };
        await React.act(async () => input().focus());
        await edit('+233501112222');
        assert.equal(writes.at(-1).value, '+233501112222');
        assert.equal(writes.at(-1).reason, 'input');
        assert.equal(input(), originalInput);
        assert.equal(container.querySelector('select').value, 'GH');
        const firstOwner = ownerToken;
        const beforeRetirement = writes.length;
        value = '+14155552671';
        deferred = true;
        await publish();
        assert.equal(container.querySelector('select').value, 'US', 'actual CSR mount uses explicit selection');
        await React.act(async () => input().focus());
        await edit('+44 (20) 7946-0958');
        assert.equal(writes.length, beforeRetirement);
        // Real owner replacement queues the old deferred editor's unmount
        // replay. Both host owners remain allowed; only the committed SDK
        // generation must reject that old cleanup after B has committed.
        ownerToken = {};
        value = '+233201234567';
        await publish();
        assert.equal(writes.length, beforeRetirement);
        assert.equal(input().value, '+233 20 123 4567');
        ownerToken = firstOwner;
        value = '+14155552671';
        await publish();
        assert.equal(writes.length, beforeRetirement, 'returning to A does not revive its old draft');
        assert.equal(container.querySelector('select').value, 'US');
        await React.act(async () => input().focus());
        await edit('+14155552672');
        assert.equal(writes.length, beforeRetirement);
        await React.act(async () => input().blur());
        assert.equal(writes.length, beforeRetirement + 1);
        assert.equal(writes.at(-1).value, '+14155552672');
        assert.equal(writes.at(-1).reason, 'blur');
        value = '+14155552671';
        deferred = true;
        await publish();
        const deferredInput = input();
        await React.act(async () => deferredInput.focus());
        const beforeDeferred = writes.length;
        await edit('+44 (20) 7946-0958');
        assert.equal(writes.length, beforeDeferred);
        assert.equal(deferredInput.value, '+44 (20) 7946-0958');
        assert.equal(container.querySelector('select').value, 'US');
        hint = 'Replacement hint';
        deferredInput.setSelectionRange(5, 5);
        await publish();
        assert.equal(input(), deferredInput);
        assert.equal(input().selectionStart, 5);
        assert.equal(input().value, '+44 (20) 7946-0958');
        await React.act(async () => input().blur());
        assert.equal(writes.length, beforeDeferred + 1);
        assert.equal(writes.at(-1).value, '+442079460958');
        assert.equal(writes.at(-1).reason, 'blur');
        value = '+14155552671';
        await publish();
        await React.act(async () => input().focus());
        const beforeClear = writes.length;
        await React.act(async () => {
            const clear = container.querySelector('button[aria-label="Clear phone"]');
            assert(clear);
            const down = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
            clear.dispatchEvent(down);
            assert.equal(down.defaultPrevented, false);
            clear.focus();
            clear.click();
        });
        assert.equal(input(), deferredInput);
        assert.equal(input().value, '');
        assert.equal(window.document.activeElement === input(), false);
        assert.equal(writes.length, beforeClear + 1);
        assert.equal(writes.at(-1).value, '+14155552671');
        assert.equal(writes.at(-1).reason, 'clear');
        await React.act(async () => input().focus());
        await edit('+233 20 123 4567');
        const detachedInput = input();
        const beforeUnmount = writes.length;
        active = false;
        await React.act(async () => { mountedRoot.render(null); await Promise.resolve(); });
        assert.equal(detachedInput.isConnected, false);
        assert.equal(writes.length, beforeUnmount + 1);
        assert.equal(writes.at(-1).value, '+233201234567');
        assert.equal(writes.at(-1).reason, 'unmount');
        assert.equal(adjacent.value, 'Retain neighboring draft');
        assert.equal(requests, 0);
        assert.equal(submits, 0);
        assert.equal(recoverable.length, 0);
        groups++;
    } finally {
        active = false;
        try {
            if (mountedRoot) await React.act(async () => mountedRoot.unmount());
        } finally {
            keys.forEach((key, index) => {
                if (original[index]) Object.defineProperty(globalThis, key, original[index]);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    }
}
}
console.log(JSON.stringify({ react: React.version, groups, cleanup: 'completed' }));
`;

/** Uses the same isolated installed-TGZ consumer contract as the readonly matrix.
 * This module is a proposal; no install or subprocess has been run by its author. */
export function checkCompletePhoneReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-complete-phone-'));
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
        writeFileSync(join(directory, 'consumer-runtime.mjs'), runtime);
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
                const path = 'complete-phone.' + extension;
                writeFileSync(
                    join(directory, path),
                    completePhoneTypedConsumer
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
                    path,
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
            assert.equal(result.groups, 4);
            assert.equal(result.cleanup, 'completed');
            versions.push(result);
            console.log(
                'Installed complete Phone React' +
                    result.react +
                    ': ESM/CommonJS, SSR/hydration, real vendor, deferred Clear/unmount, declarations and styles passed.'
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
