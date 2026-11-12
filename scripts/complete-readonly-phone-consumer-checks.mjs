import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const completeReadOnlyPhoneTypedConsumer = String.raw`import { createElement } from 'react';
import {
    CompleteReadOnlyPhoneNumberField,
    type CompleteReadOnlyPhoneNumberFieldProps,
    ReadOnlyPhoneNumberField,
    type ReadOnlyPhoneNumberFieldProps,
} from '@miniextensions/sdk/react';
const props: CompleteReadOnlyPhoneNumberFieldProps = {
    value: '+233 20 123 4567',
    emptyLabel: 'No value',
    className: 'phone-layout',
    linkClassName: 'host-cell-text',
};
createElement(CompleteReadOnlyPhoneNumberField, props);
createElement(CompleteReadOnlyPhoneNumberField, { ...props, value: null });
createElement(CompleteReadOnlyPhoneNumberField, { ...props, value: undefined });
const canonical: ReadOnlyPhoneNumberFieldProps = props;
createElement(ReadOnlyPhoneNumberField, canonical);
createElement(ReadOnlyPhoneNumberField, { ...canonical, value: null });
// @ts-expect-error the canonical read-only field cannot accept a writer
const canonicalWriter: ReadOnlyPhoneNumberFieldProps = { ...canonical, onValueChange() {} };
// @ts-expect-error saved phone text is never a numeric value
const numeric: CompleteReadOnlyPhoneNumberFieldProps = { ...props, value: 233 };
// @ts-expect-error the presentation owns no writer
const writer: CompleteReadOnlyPhoneNumberFieldProps = { ...props, onValueChange() {} };
// @ts-expect-error localized empty text is required from the host
createElement(CompleteReadOnlyPhoneNumberField, { value: '+233' });
// @ts-expect-error complete phone presentation is React-only
import { CompleteReadOnlyPhoneNumberField as CorePhone } from '@miniextensions/sdk';
void numeric; void writer; void CorePhone; void canonicalWriter;
`;
const consumerRuntime = String.raw`import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';
import * as esm from '@miniextensions/sdk/react';

const require = createRequire(import.meta.url);
const cjs = require('@miniextensions/sdk/react');
const root = dirname(fileURLToPath(import.meta.url));
const { Window } = await import(pathToFileURL(process.argv[2]).href);
const esmPath = fileURLToPath(import.meta.resolve('@miniextensions/sdk/react'));
const cjsPath = require.resolve('@miniextensions/sdk/react');
const installed = join(root, 'node_modules', '@miniextensions', 'sdk');
assert(esmPath.startsWith(join(installed, 'dist', 'esm', 'react')));
assert(cjsPath.startsWith(join(installed, 'dist', 'cjs', 'react')));
assert.equal('CompleteReadOnlyPhoneNumberField' in require('@miniextensions/sdk'), false);
const cssPath = require.resolve('@miniextensions/sdk/react/complete-phone.css');
assert(cssPath.startsWith(join(installed, 'dist', 'esm', 'react')));
const css = readFileSync(cssPath, 'utf8');
for (const selector of [
    '.mx-sdk-complete-phone-readonly',
    '.mx-sdk-complete-phone-link',
    '.mx-sdk-complete-phone-empty',
    '.mx-sdk-complete-phone-empty-icon',
]) assert(css.includes(selector));

let groups = 0;
for (const api of [esm, cjs]) {
    assert.equal(typeof api.CompleteReadOnlyPhoneNumberField, 'function');
    assert.equal(typeof api.PhoneNumberField, 'function');
    assert.equal(typeof globalThis.document, 'undefined');
    assert.equal(typeof api.ReadOnlyPhoneNumberField, 'function');
    for (const Component of [api.CompleteReadOnlyPhoneNumberField, api.ReadOnlyPhoneNumberField]) {
    const window = new Window();
    const keys = ['window', 'document', 'navigator', 'HTMLElement',
        'HTMLAnchorElement', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
    const original = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
    let requests = 0;
    const refuseRequest = async () => {
        requests++;
        throw Error('Read-only Phone must not request data');
    };
    Object.defineProperty(window, 'fetch', { value: refuseRequest });
    let mountedRoot;
    let recoverableErrors = [];
    try {
        let value = '  +233 20 123 4567 & "desk"  ';
        let emptyLabel = 'لا توجد قيمة';
        let parentClicks = 0;
        const node = () => React.createElement('div', { onClick: () => parentClicks++ },
            React.createElement(Component, { value, emptyLabel,
                className: 'consumer-phone', linkClassName: 'consumer-link' }),
            React.createElement('input', { 'aria-label': 'Adjacent', defaultValue: 'Keep adjacent' }));
        const html = renderToString(node());
        // Parsed attributes in Happy DOM 20 leave angle entities encoded.
        // Check SSR bytes independently; raw CSR hrefs are asserted below.
        const escaped = renderToString(React.createElement(Component, {
            value: '<em>not markup</em> & "desk"', emptyLabel,
        }));
        assert(escaped.includes('href="tel:&lt;em&gt;not markup&lt;/em&gt; &amp; &quot;desk&quot;"'));
        const container = window.document.createElement('div');
        container.innerHTML = html;
        window.document.body.append(container);
        const originalAnchor = container.querySelector('a');
        assert(originalAnchor);
        assert(originalAnchor.classList.contains('consumer-link'));
        assert(originalAnchor.parentElement.classList.contains('consumer-phone'));
        assert.equal(originalAnchor.textContent, value);
        assert.equal(originalAnchor.getAttribute('href'), 'tel:' + value);
        assert.equal(container.querySelector('em,script,img,iframe,button,select'), null);
        for (const key of keys) Object.defineProperty(globalThis, key, {
            configurable: true, writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true
                : key === 'fetch' ? refuseRequest : window[key],
        });
        const { hydrateRoot } = await import('react-dom/client');
        await React.act(async () => {
            mountedRoot = hydrateRoot(container, node(), {
                onRecoverableError: (error) => recoverableErrors.push(error),
            });
        });
        assert.equal(container.querySelector('a'), originalAnchor);
        const adjacent = container.querySelector('input');
        assert(adjacent);
        adjacent.value = 'Retain neighboring draft';
        const publish = async () => {
            await React.act(async () => mountedRoot.render(node()));
            assert.equal(container.querySelector('input'), adjacent);
            assert.equal(adjacent.value, 'Retain neighboring draft');
            assert.equal(requests, 0);
        };
        for (value of ['  +44 (20) 7946-0958  ', 'not a phone', 'tel:+14155552671', '<em>not markup</em> & "desk"', '+233201234567']) {
            await publish();
            const link = container.querySelector('a');
            assert.equal(link, originalAnchor);
            assert.equal(link.textContent, value);
            assert.equal(link.getAttribute('href'), 'tel:' + value);
            assert.equal(link.getAttribute('target'), '_blank');
            assert.equal(link.getAttribute('rel'), 'noreferrer');
            assert.equal(container.querySelector('em,script,img,iframe'), null);
        }
        let observedDefaultPrevented;
        let hostClicks = 0;
        // Prevent external tel navigation only after observing the component's decision.
        container.addEventListener('click', (event) => {
            hostClicks++;
            observedDefaultPrevented = event.defaultPrevented;
            event.preventDefault();
        });
        await React.act(async () => {
            container.querySelector('a').dispatchEvent(new window.MouseEvent('click', {
                bubbles: true, cancelable: true,
            }));
        });
        assert.equal(parentClicks, 0);
        assert.equal(hostClicks, 1);
        assert.equal(observedDefaultPrevented, false);
        for (value of [null, undefined, '']) {
            await publish();
            assert.equal(container.querySelector('a'), null);
            const empty = container.querySelector('p');
            assert(empty);
            assert(empty.classList.contains('consumer-phone'));
            assert.equal(empty.textContent, emptyLabel);
            assert.equal(empty.querySelector('svg').getAttribute('aria-hidden'), 'true');
        }
        emptyLabel = '<em>replacement empty</em> & "literal"';
        await publish();
        assert.equal(container.querySelector('p').textContent, emptyLabel);
        assert.equal(container.querySelector('em,script,img,iframe,button,select'), null);
        value = '+14155552671';
        await publish();
        assert.equal(container.querySelector('a').textContent, value);
        await React.act(async () => mountedRoot.render(null));
        assert.equal(container.textContent, '');
        await React.act(async () => mountedRoot.render(node()));
        assert.equal(container.querySelector('a').getAttribute('href'), 'tel:' + value);
        assert.equal(container.querySelector('input').value, 'Keep adjacent');
        assert.equal(recoverableErrors.length, 0);
        assert.equal(requests, 0);
        groups++;
    } finally {
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

export function checkCompleteReadOnlyPhoneReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(
        join(tmpdir(), 'sdk-complete-readonly-phone-')
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
                const name = 'complete-readonly-phone.' + extension;
                writeFileSync(
                    join(directory, name),
                    completeReadOnlyPhoneTypedConsumer
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
                'Installed complete read-only Phone React' +
                    result.react +
                    ': ESM/CommonJS, SSR/hydration, declarations and styles passed.'
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
