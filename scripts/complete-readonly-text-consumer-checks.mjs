import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { autoNumberPublicCompatibilityTypedConsumer } from './autonumber-public-contract-fixtures.mjs';

export const completeReadOnlyTextTypedConsumer = String.raw`import { createElement } from 'react';
import {
    AutoNumberField,
    type AutoNumberControlledProps,
    CompleteReadOnlyTextField,
    type CompleteReadOnlyTextFieldProps,
    type CompleteReadOnlyTextLanguage,
    type CompleteReadOnlyTextLayout,
    type CompleteReadOnlyTextSize,
} from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
declare const binding: FormFieldBinding;
const language: CompleteReadOnlyTextLanguage = 'zh-Hans';
const layout: CompleteReadOnlyTextLayout = 'cell-medium';
const textSize: CompleteReadOnlyTextSize = 'very large';
const props: CompleteReadOnlyTextFieldProps = {
    value: '  Literal <b>text</b>\nhttps://example.com  ',
    language, layout, textSize, className: 'consumer-layout',
};
createElement(CompleteReadOnlyTextField, props);
createElement(CompleteReadOnlyTextField, { ...props, value: null });
createElement(CompleteReadOnlyTextField, { ...props, value: undefined });
const autoNumber: AutoNumberControlledProps = {
    mode: 'controlled', value: '0', language, layout, textSize,
    className: 'consumer-autonumber',
};
createElement(AutoNumberField, autoNumber);
createElement(AutoNumberField, { ...autoNumber, value: null });
createElement(AutoNumberField, { ...autoNumber, value: undefined });
// @ts-expect-error native projection supplies text, never a raw number
createElement(AutoNumberField, { ...autoNumber, value: 0 });
// @ts-expect-error controlled presentation has no canonical setter
createElement(AutoNumberField, { ...autoNumber, onValueChange() {} });
// @ts-expect-error controlled presentation does not borrow a binding
createElement(AutoNumberField, { ...autoNumber, binding });
// @ts-expect-error the complete component supplies its own rendering
createElement(AutoNumberField, { ...autoNumber, render: () => null });
// @ts-expect-error controlled presentation requires explicit localization
createElement(AutoNumberField, { mode: 'controlled', value: '0' });
// @ts-expect-error controlled presentation requires an explicit discriminator
createElement(AutoNumberField, { value: '0', language: 'en' });
// @ts-expect-error canonical text is never a number
const numeric: CompleteReadOnlyTextFieldProps = { ...props, value: 0 };
// @ts-expect-error the complete display owns link rendering
createElement(CompleteReadOnlyTextField, { ...props, renderText: () => null });
// @ts-expect-error this readonly display owns no canonical writer
createElement(CompleteReadOnlyTextField, { ...props, onValueChange() {} });
// @ts-expect-error language is an explicit portable input
createElement(CompleteReadOnlyTextField, { value: 'text' });
// @ts-expect-error only the finite portable layouts are supported
const invalidLayout: CompleteReadOnlyTextFieldProps = { ...props, layout: 'scroll' };
// @ts-expect-error complete text is React-only; headless consumers keep optional React
import { CompleteReadOnlyTextField as CoreText } from '@miniextensions/sdk';
void numeric; void invalidLayout; void CoreText;
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
const { Window } = await import(pathToFileURL(process.argv[2]).href);
const directory = dirname(fileURLToPath(import.meta.url));
const installed = join(directory, 'node_modules', '@miniextensions', 'sdk');
assert(fileURLToPath(import.meta.resolve('@miniextensions/sdk/react')).startsWith(join(installed, 'dist', 'esm', 'react')));
assert(require.resolve('@miniextensions/sdk/react').startsWith(join(installed, 'dist', 'cjs', 'react')));
assert.equal('CompleteReadOnlyTextField' in require('@miniextensions/sdk'), false);
assert.equal('AutoNumberField' in require('@miniextensions/sdk'), false);
const cssPath = require.resolve('@miniextensions/sdk/react/complete-readonly-text.css');
assert(cssPath.startsWith(join(installed, 'dist', 'esm', 'react')));
const css = readFileSync(cssPath, 'utf8');
assert(css.includes('.mx-sdk-complete-readonly-text'));
assert(css.includes('.mx-sdk-readonly-text-empty'));
assert(!css.includes('@tailwind') && !css.includes('@apply'));

const labels = {
    en: 'No Value', es: 'Sin Valor', fr: 'Pas de Valeur',
    vi: 'Không có Giá trị', nl: 'Geen Waarde', de: 'Keine Wert',
    ja: 'いいえ値', ko: '아니요 값', pt: 'Sem Valor',
    cs: 'Žádná hodnota', he: 'אין ערך', it: 'Nessun Valore',
    ka: 'არცერთი მნიშვნელობა', 'zh-Hans': '没有值', ca: 'Sense Valor',
};
const sizes = { small: 'text-sm', medium: 'text-base', large: 'text-lg', 'very large': 'text-xl' };
const layouts = ['default', 'linked-list', 'cell-short', 'cell-medium', 'cell-tall', 'cell-extra-tall', 'cell-fit-content'];
let groups = 0;
for (const api of [esm, cjs]) {
    assert.equal(typeof api.CompleteReadOnlyTextField, 'function');
    assert.equal(typeof api.AutoNumberField, 'function');
    assert.equal(typeof api.LiteralText, 'object');
    assert.equal(typeof globalThis.document, 'undefined');
    const Component = api.CompleteReadOnlyTextField;
    let value = '  <b>literal</b>\nhttps://example.invalid/a  ';
    let language = 'en';
    let textSize;
    let layout;
    let autoNumberValue = null;
    let autoNumberLanguage = 'es';
    let autoNumberTextSize;
    let autoNumberLayout;
    let autoNumberRowClicks = 0;
    let root;
    let requests = 0;
    let submits = 0;
    let parentClicks = 0;
    const recoverable = [];
    const refuseRequest = async () => {
        requests++;
        throw Error('Readonly text must not fetch');
    };
    const node = () => React.createElement(React.StrictMode, null,
        React.createElement('form', { onSubmit(event) { event.preventDefault(); submits++; } },
            React.createElement('section', { onClick() { parentClicks++; } },
                React.createElement(Component, { value, language, textSize, layout, className: 'consumer-text' })),
            React.createElement('section', { id: 'consumer-autonumber', onClick() { autoNumberRowClicks++; } },
                React.createElement(api.AutoNumberField, {
                    mode: 'controlled', value: autoNumberValue, language: autoNumberLanguage,
                    textSize: autoNumberTextSize, layout: autoNumberLayout, className: 'consumer-autonumber',
                })),
            React.createElement('input', { 'aria-label': 'Adjacent', defaultValue: 'Keep adjacent' })));
    const html = renderToString(node());
    assert(html.includes('&lt;b&gt;literal&lt;/b&gt;'));
    assert(!html.includes('<b>'));
    const literalHtml = renderToString(React.createElement(api.LiteralText, {
        value: 'https://example.com <b>literal</b>',
    }));
    assert(literalHtml.includes('&lt;b&gt;literal&lt;/b&gt;'));
    assert(!literalHtml.includes('<a'), 'legacy LiteralText remains inert by default');
    const window = new Window();
    Object.defineProperty(window, 'fetch', { value: refuseRequest });
    const container = window.document.createElement('div');
    container.innerHTML = html;
    window.document.body.append(container);
    const originalParagraph = container.querySelector('.read-only-text');
    assert(originalParagraph);
    const originalAutoNumber = container.querySelector('#consumer-autonumber p');
    assert.equal(originalAutoNumber.textContent, 'Sin Valor');
    const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLAnchorElement',
        'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT', 'fetch'];
    const originals = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
    try {
        keys.forEach((key) => Object.defineProperty(globalThis, key, {
            configurable: true, writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true
                : key === 'fetch' ? refuseRequest : window[key],
        }));
        const { hydrateRoot } = await import('react-dom/client');
        await React.act(async () => {
            root = hydrateRoot(container, node(), {
                onRecoverableError(error) { recoverable.push(error); },
            });
        });
        assert.equal(container.querySelector('.read-only-text'), originalParagraph);
        assert.equal(container.querySelector('#consumer-autonumber p'), originalAutoNumber);
        const adjacent = container.querySelector('input');
        adjacent.value = 'Retain neighboring draft';
        const publish = async () => {
            await React.act(async () => root.render(node()));
            assert.equal(container.querySelector('input'), adjacent);
            assert.equal(adjacent.value, 'Retain neighboring draft');
            assert.equal(submits, 0);
            assert.equal(requests, 0);
        };
        const paragraph = () => container.querySelector('.read-only-text');
        assert.equal(paragraph().textContent, value);
        assert.equal(paragraph().tagName, 'P');
        assert.equal(paragraph().parentElement.getAttribute('style'), null);
        assert.equal(container.querySelector('b,script,img,iframe,button,select,textarea'), null);
        for (const item of [
            { text: 'https://example.com/a?x=1&y=2', href: 'https://example.com/a?x=1&y=2' },
            { text: 'http://example.com/path', href: 'http://example.com/path' },
            { text: 'example.com', href: 'http://example.com' },
            { text: 'person@example.com', href: 'mailto:person@example.com' },
        ]) {
            value = item.text;
            await publish();
            assert.equal(paragraph(), originalParagraph);
            assert.equal(paragraph().textContent, item.text);
            const link = paragraph().querySelector('a');
            assert(link);
            assert.equal(link.getAttribute('href'), item.href);
            assert.equal(link.getAttribute('target'), '_blank');
            assert.equal(link.getAttribute('rel'), null);
        }
        let observedDefaultPrevented;
        let hostClicks = 0;
        container.addEventListener('click', (event) => {
            hostClicks++;
            observedDefaultPrevented = event.defaultPrevented;
            event.preventDefault();
        });
        await React.act(async () => paragraph().querySelector('a').dispatchEvent(
            new window.MouseEvent('click', { bubbles: true, cancelable: true })));
        assert.equal(parentClicks, 0);
        assert.equal(hostClicks, 1);
        assert.equal(observedDefaultPrevented, false);
        await React.act(async () => paragraph().dispatchEvent(
            new window.MouseEvent('click', { bubbles: true, cancelable: true })));
        assert.equal(parentClicks, 1);

        value = '  zero 0\n<b>literal</b> & "quoted"  ';
        for (const [size, expectedClass] of Object.entries(sizes)) {
            textSize = size;
            await publish();
            assert.equal(paragraph().className, 'linkify read-only-text ' + expectedClass);
            assert.equal(paragraph().textContent, value);
            assert.equal(paragraph().querySelector('b'), null);
        }
        textSize = undefined;
        for (const candidate of layouts) {
            layout = candidate;
            await publish();
            assert.equal(paragraph().parentElement.getAttribute('data-layout'), candidate);
            assert.equal(paragraph().className, 'linkify read-only-text');
        }
        layout = undefined;
        value = '0';
        await publish();
        assert.equal(paragraph().textContent, '0');
        assert.equal(paragraph().parentElement.hasAttribute('data-layout'), false);
        for (const empty of [null, undefined, '']) {
            value = empty;
            for (const [candidate, label] of Object.entries(labels)) {
                language = candidate;
                await publish();
                const section = container.querySelector('section');
                assert.equal(section.children.length, 1);
                assert.equal(section.firstElementChild.tagName, 'P');
                assert.equal(section.firstElementChild.textContent, label);
                assert.equal(section.querySelector('.relative,.read-only-text,.mx-sdk-complete-readonly-text,a'), null);
                const icon = section.querySelector('svg');
                assert(icon);
                assert.equal(icon.getAttribute('aria-hidden'), 'true');
                assert.equal(section.querySelector('p').classList.contains('consumer-text'), true);
            }
        }
        const autoNumberSection = () => container.querySelector('#consumer-autonumber');
        for (const empty of [null, undefined, '']) {
            autoNumberValue = empty;
            autoNumberLanguage = 'fr';
            await publish();
            assert.equal(autoNumberSection().textContent, 'Pas de Valeur');
            assert.equal(autoNumberSection().querySelector('input,textarea,select,button,a'), null);
        }
        autoNumberValue = '0';
        autoNumberLanguage = 'en';
        autoNumberTextSize = 'small';
        autoNumberLayout = 'cell-medium';
        await publish();
        const autoNumberParagraph = autoNumberSection().querySelector('.read-only-text');
        assert.equal(autoNumberParagraph.textContent, '0');
        assert.equal(autoNumberParagraph.className, 'linkify read-only-text text-sm');
        assert.equal(autoNumberParagraph.parentElement.getAttribute('data-layout'), 'cell-medium');
        autoNumberValue = '  <b>literal</b>\nhttps://example.com/a?x=1&y=2  ';
        autoNumberTextSize = 'large';
        autoNumberLayout = 'default';
        await publish();
        assert.equal(autoNumberSection().querySelector('.read-only-text'), autoNumberParagraph);
        assert.equal(autoNumberParagraph.textContent, autoNumberValue);
        assert.equal(autoNumberParagraph.querySelector('b,img,script,iframe'), null);
        assert.equal(autoNumberParagraph.className, 'linkify read-only-text text-lg');
        const autoNumberLink = autoNumberParagraph.querySelector('a');
        assert.equal(autoNumberLink.getAttribute('href'), 'https://example.com/a?x=1&y=2');
        assert.equal(autoNumberLink.getAttribute('target'), '_blank');
        await React.act(async () => autoNumberLink.dispatchEvent(
            new window.MouseEvent('click', { bubbles: true, cancelable: true })));
        assert.equal(autoNumberRowClicks, 0);
        autoNumberValue = 'javascript:alert(1) <img src=x onerror=bad()> & "literal"';
        await publish();
        assert.equal(autoNumberParagraph.textContent, autoNumberValue);
        assert.equal(autoNumberParagraph.querySelector('a,img,script,iframe'), null);
        assert.equal(autoNumberSection().querySelector('input,textarea,select,button'), null);
        value = 'Fresh https://example.com';
        language = 'en';
        await publish();
        assert.equal(paragraph().textContent, value);
        assert.equal(paragraph().querySelector('a').getAttribute('href'), 'https://example.com');
        await React.act(async () => root.render(null));
        assert.equal(container.textContent, '');
        await React.act(async () => root.render(node()));
        assert.equal(paragraph().textContent, value);
        assert.equal(container.querySelector('input').value, 'Keep adjacent');
        assert.equal(recoverable.length, 0);
        assert.equal(requests, 0);
        assert.equal(submits, 0);
        groups++;
    } finally {
        try {
            if (root) await React.act(async () => root.unmount());
        } finally {
            keys.forEach((key, index) => {
                if (originals[index]) Object.defineProperty(globalThis, key, originals[index]);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    }
}
console.log(JSON.stringify({ react: React.version, groups, publicCss: true,
    cleanup: 'completed', scope: 'Installed public ESM/CommonJS, SSR/hydration, text/link/empty/size/layout DOM behavior; geometry is proved separately in Chromium.' }));
`;

export function checkCompleteReadOnlyTextReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(
        join(tmpdir(), 'sdk-complete-readonly-text-')
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
                const name = 'complete-readonly-text.' + extension;
                const compatibilityName =
                    'autonumber-public-compatibility.' + extension;
                writeFileSync(
                    join(directory, name),
                    completeReadOnlyTextTypedConsumer
                );
                writeFileSync(
                    join(directory, compatibilityName),
                    autoNumberPublicCompatibilityTypedConsumer
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
                    compatibilityName,
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
            assert.equal(result.publicCss, true);
            assert.equal(result.cleanup, 'completed');
            versions.push(result);
            console.log(
                'Installed complete readonly text React' +
                    result.react +
                    ': ESM/CommonJS, SSR/hydration, strict declarations, styles and literal/link behavior passed.'
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

const layoutContracts = [
    { layout: 'default', lines: 10, clamp: 'none', nowrap: false },
    { layout: 'linked-list', lines: 1, clamp: 'none', nowrap: true },
    { layout: 'cell-short', lines: 1, clamp: '1', nowrap: true },
    { layout: 'cell-medium', lines: 2, clamp: '2', nowrap: false },
    { layout: 'cell-tall', lines: 4, clamp: '4', nowrap: false },
    { layout: 'cell-extra-tall', lines: 7, clamp: '7', nowrap: false },
    { layout: 'cell-fit-content', lines: 1, clamp: 'none', nowrap: true },
];
const inheritedLayouts = [
    ['list-linked-record', 'linked-list'],
    ['cell-short', 'cell-short'],
    ['cell-medium', 'cell-medium'],
    ['cell-tall', 'cell-tall'],
    ['cell-extra-tall', 'cell-extra-tall'],
    ['cell-fit-content', 'cell-fit-content'],
];
const sizeContracts = [
    { textSize: undefined, fontSize: 20, lineHeight: 30 },
    { textSize: 'small', fontSize: 14, lineHeight: 20 },
    { textSize: 'medium', fontSize: 16, lineHeight: 24 },
    { textSize: 'large', fontSize: 18, lineHeight: 28 },
    { textSize: 'very large', fontSize: 20, lineHeight: 28 },
];
const browserCases = [
    ...layoutContracts.map((item) => ({
        ...item,
        id: 'explicit-' + item.layout,
        ancestor: '',
        fontSize: 20,
        lineHeight: 30,
    })),
    ...inheritedLayouts.map(([ancestor, inherited]) => ({
        ...layoutContracts.find((item) => item.layout === inherited),
        layout: undefined,
        id: 'inherited-' + ancestor,
        ancestor,
        fontSize: 20,
        lineHeight: 30,
    })),
    ...layoutContracts.map((item) => ({
        ...item,
        id: 'opposed-' + item.layout,
        ancestor: item.nowrap ? 'cell-extra-tall' : 'cell-short',
        fontSize: 20,
        lineHeight: 30,
    })),
    ...inheritedLayouts.map(([ancestor]) => ({
        layout: 'default',
        id: 'override-default-' + ancestor,
        ancestor,
        lines: 10,
        clamp: 'none',
        nowrap: false,
        fontSize: 20,
        lineHeight: 30,
    })),
    ...sizeContracts.map((item, index) => ({
        ...item,
        id: 'size-' + index,
        ancestor: '',
        lines: 10,
        clamp: 'none',
        nowrap: false,
    })),
];

export const completeReadOnlyTextBrowserTargetPath =
    '/complete-readonly-text-target';

/** Serve after the packaged stylesheet through the normal same-origin map. */
export const completeReadOnlyTextBrowserStyle = [
    'body { margin: 12px; font-family: monospace; font-size: 20px; line-height: 30px; }',
    '.readonly-case { width: 260px; margin-bottom: 10px; }',
    // These are the actual preexisting text rules, not a Tailwind installation.
    '.list-linked-record .read-only-text { display:block; white-space:nowrap; text-overflow:ellipsis; overflow:hidden; }',
    '.cell-short .read-only-text { display:block; text-overflow:ellipsis; white-space:nowrap; -webkit-line-clamp:1; }',
    '.cell-medium .read-only-text { -webkit-line-clamp:2; }',
    '.cell-tall .read-only-text { -webkit-line-clamp:4; }',
    '.cell-extra-tall .read-only-text { -webkit-line-clamp:7; }',
    '.cell-fit-content .read-only-text { display:block; text-overflow:ellipsis; white-space:nowrap; }',
].join('\n');

export const completeReadOnlyTextBrowserSource =
    String.raw`import React, { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AutoNumberField, CompleteReadOnlyTextField } from '@miniextensions/sdk/react';

const cases = ` +
    JSON.stringify(browserCases) +
    String.raw`;
const state = { ready: false, errors: [], componentRequests: 0,
    submits: 0, ordinaryClicks: 0, linkRowClicks: 0, trustedLinkClicks: 0,
    autoNumberRowClicks: 0, autoNumberTrustedLinkClicks: 0 };
window.__nativeProbe = { snapshot: () => ({ ...state, errors: [...state.errors], reactVersion: React.version }) };
window.addEventListener('error', (event) => state.errors.push(String(event.error || event.message)));
window.addEventListener('unhandledrejection', (event) => state.errors.push(String(event.reason)));
window.fetch = async () => {
    state.componentRequests++;
    throw Error('Readonly text must not allocate a fetch');
};
XMLHttpRequest.prototype.open = function () {
    state.componentRequests++;
    throw Error('Readonly text must not allocate XMLHttpRequest');
};
const lines = Array.from({ length: 10 }, (_, index) => 'Line ' + String(index + 1).padStart(2, '0')).join('\n');
const literal = '  <b>literal</b>\nA & "quoted" value  ';
const target = window.location.origin + '/complete-readonly-text-target';
function App() {
    const [autoNumber, setAutoNumber] = useState({ value: null, language: 'es' });
    useLayoutEffect(() => {
        state.ready = true;
        window.__nativeProbe.setAutoNumber = setAutoNumber;
        return () => { state.ready = false; delete window.__nativeProbe.setAutoNumber; };
    }, []);
    return React.createElement('main', null,
        ...cases.map((item) => React.createElement('section', {
            key: item.id, id: 'case-' + item.id,
            className: 'readonly-case ' + item.ancestor,
        }, React.createElement(CompleteReadOnlyTextField, {
            value: lines, language: 'en', layout: item.layout, textSize: item.textSize,
        }))),
        React.createElement('section', { id: 'case-literal', className: 'readonly-case' },
            React.createElement(CompleteReadOnlyTextField, { value: literal, language: 'en' })),
        React.createElement('section', { id: 'case-empty', className: 'readonly-case' },
            React.createElement(CompleteReadOnlyTextField, { value: undefined, language: 'es' })),
        React.createElement('section', { id: 'case-zero', className: 'readonly-case' },
            React.createElement(CompleteReadOnlyTextField, { value: '0', language: 'en' })),
        React.createElement('form', { onSubmit(event) { event.preventDefault(); state.submits++; } },
            React.createElement('section', {
                id: 'case-ordinary', className: 'readonly-case',
                onClick() { state.ordinaryClicks++; },
            }, React.createElement(CompleteReadOnlyTextField, { value: 'Ordinary text click', language: 'en' })),
            React.createElement('section', {
                id: 'case-link', className: 'readonly-case',
                onClick() { state.linkRowClicks++; },
                onClickCapture(event) {
                    if (event.target.closest('a') && event.isTrusted) state.trustedLinkClicks++;
                },
            }, React.createElement(CompleteReadOnlyTextField, { value: target, language: 'en' })),
            React.createElement('section', {
                id: 'case-autonumber', className: 'readonly-case',
                onClick() { state.autoNumberRowClicks++; },
                onClickCapture(event) {
                    if (event.target.closest('a') && event.isTrusted) state.autoNumberTrustedLinkClicks++;
                },
            }, React.createElement(AutoNumberField, { ...autoNumber, mode: 'controlled' })),
            React.createElement('input', { id: 'readonly-adjacent', defaultValue: 'Keep adjacent' })));
}
createRoot(document.getElementById('root')).render(
    React.createElement(React.StrictMode, null, React.createElement(App)));
`;

/** Inspect an existing normal-harness page; the harness owns browser/server/context. */
export async function checkCompleteReadOnlyTextBrowser({ page, evidence }) {
    await page.waitForFunction(
        () => window.__nativeProbe?.snapshot().ready === true
    );
    const samples = await page.evaluate(
        (ids) =>
            ids.map((id) => {
                const holder = document.getElementById('case-' + id);
                const paragraph = holder.querySelector('p.read-only-text');
                if (!paragraph)
                    throw Error('Missing readonly paragraph for ' + id);
                const root = paragraph.parentElement;
                const style = getComputedStyle(paragraph);
                const box = paragraph.getBoundingClientRect();
                return {
                    id,
                    fontSize: style.fontSize,
                    lineHeight: style.lineHeight,
                    whiteSpace: style.whiteSpace,
                    overflow: style.overflow,
                    textOverflow: style.textOverflow,
                    display: style.display,
                    clamp: style.webkitLineClamp,
                    height: box.height,
                    width: box.width,
                    scrollWidth: paragraph.scrollWidth,
                    clientWidth: paragraph.clientWidth,
                    scrollHeight: paragraph.scrollHeight,
                    clientHeight: paragraph.clientHeight,
                    layout: root.getAttribute('data-layout'),
                    text: paragraph.textContent,
                };
            }),
        browserCases.map((item) => item.id)
    );
    const expectedText = Array.from(
        { length: 10 },
        (_, index) => 'Line ' + String(index + 1).padStart(2, '0')
    ).join('\n');
    for (const [index, sample] of samples.entries()) {
        const expected = browserCases[index];
        assert.equal(sample.id, expected.id);
        assert.equal(sample.text, expectedText);
        assert.equal(sample.fontSize, expected.fontSize + 'px');
        assert.equal(sample.lineHeight, expected.lineHeight + 'px');
        assert.equal(
            sample.whiteSpace,
            expected.nowrap ? 'nowrap' : 'pre-wrap'
        );
        assert.equal(sample.overflow, 'hidden');
        assert.equal(sample.clamp, expected.clamp);
        assert.equal(sample.layout, expected.layout ?? null);
        assert(
            Math.abs(sample.width - 260) < 1,
            sample.id + ': constrained width'
        );
        assert(
            Math.abs(sample.height - expected.lines * expected.lineHeight) < 1,
            sample.id + ': measured line count'
        );
        if (expected.nowrap) {
            assert.equal(sample.textOverflow, 'ellipsis');
            assert.equal(sample.display, 'block');
            assert(
                sample.scrollWidth > sample.clientWidth,
                sample.id + ': actual horizontal clipping'
            );
        } else if (expected.lines < 10) {
            assert(
                sample.scrollHeight > sample.clientHeight,
                sample.id + ': actual multiline clipping'
            );
        }
    }
    const visible = await page.evaluate(() => {
        const literal = document.querySelector('#case-literal .read-only-text');
        const empty = document.querySelector('#case-empty');
        const emptyParagraph = empty.firstElementChild;
        const icon = emptyParagraph.querySelector('svg');
        const iconBox = icon.getBoundingClientRect();
        const link = document.querySelector('#case-link a');
        return {
            literal: literal.textContent,
            injectedMarkup:
                literal.querySelector('b,img,script,iframe') !== null,
            emptyChildren: empty.children.length,
            emptyTag: emptyParagraph.tagName,
            emptyText: emptyParagraph.textContent,
            emptyRoot:
                empty.querySelector(
                    '.relative,.read-only-text,.mx-sdk-complete-readonly-text'
                ) !== null,
            emptyFontSize: getComputedStyle(emptyParagraph).fontSize,
            iconWidth: iconBox.width,
            iconHeight: iconBox.height,
            iconHidden: icon.getAttribute('aria-hidden'),
            zero: document.querySelector('#case-zero .read-only-text')
                .textContent,
            linkHref: link.getAttribute('href'),
            linkTarget: link.getAttribute('target'),
            linkRel: link.getAttribute('rel'),
        };
    });
    assert.equal(visible.literal, '  <b>literal</b>\nA & "quoted" value  ');
    assert.equal(visible.injectedMarkup, false);
    assert.equal(visible.emptyChildren, 1);
    assert.equal(visible.emptyTag, 'P');
    assert.equal(visible.emptyText, 'Sin Valor');
    assert.equal(visible.emptyRoot, false);
    assert.equal(visible.emptyFontSize, '14px');
    assert.equal(visible.iconHidden, 'true');
    assert(Math.abs(visible.iconWidth - 16) < 1);
    assert(Math.abs(visible.iconHeight - 16) < 1);
    assert.equal(visible.zero, '0');
    const target = new URL(completeReadOnlyTextBrowserTargetPath, page.url());
    assert.equal(visible.linkHref, target.href);
    assert.equal(visible.linkTarget, '_blank');
    assert.equal(visible.linkRel, null);
    await page.locator('#readonly-adjacent').fill('Retain neighboring draft');
    await page.locator('#case-ordinary .read-only-text').click();
    let popup;
    try {
        [popup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#case-link a').click(),
        ]);
        await popup.waitForLoadState('domcontentloaded');
        assert.equal(
            new URL(popup.url()).pathname,
            completeReadOnlyTextBrowserTargetPath
        );
        assert.equal(await popup.title(), 'Readonly text synthetic target');
    } finally {
        if (popup) await popup.close();
    }
    assert.equal(
        await page.locator('#case-autonumber').textContent(),
        'Sin Valor'
    );
    await page.evaluate(() => {
        window.__nativeProbe.autoNumberAdjacent =
            document.getElementById('readonly-adjacent');
    });
    const autoNumberSamples = [];
    const publishAutoNumber = async (props, expected) => {
        await page.evaluate(
            (next) => window.__nativeProbe.setAutoNumber(next),
            props
        );
        await page.waitForFunction(
            (text) =>
                document.getElementById('case-autonumber').textContent === text,
            expected
        );
        const sample = await page.evaluate(() => {
            const section = document.getElementById('case-autonumber');
            const paragraph = section.querySelector('p');
            const link = section.querySelector('a');
            return {
                text: section.textContent,
                fontSize: getComputedStyle(paragraph).fontSize,
                layout: section.firstElementChild.getAttribute('data-layout'),
                controls: section.querySelectorAll(
                    'input,textarea,select,button'
                ).length,
                injectedMarkup:
                    section.querySelector('b,img,script,iframe') !== null,
                linkHref: link?.getAttribute('href') ?? null,
                linkTarget: link?.getAttribute('target') ?? null,
                sameAdjacent:
                    document.getElementById('readonly-adjacent') ===
                    window.__nativeProbe.autoNumberAdjacent,
                adjacent: document.getElementById('readonly-adjacent').value,
            };
        });
        assert.equal(sample.text, expected);
        assert.equal(sample.controls, 0);
        assert.equal(sample.injectedMarkup, false);
        assert.equal(sample.sameAdjacent, true);
        assert.equal(sample.adjacent, 'Retain neighboring draft');
        autoNumberSamples.push(sample);
        return sample;
    };
    const zero = await publishAutoNumber(
        {
            value: '0',
            language: 'en',
            textSize: 'small',
            layout: 'cell-medium',
        },
        '0'
    );
    assert.equal(zero.fontSize, '14px');
    assert.equal(zero.layout, 'cell-medium');
    const autoNumberLiteral = '  <b>literal</b>\n' + target.href + '  ';
    const literalAutoNumber = await publishAutoNumber(
        {
            value: autoNumberLiteral,
            language: 'en',
            textSize: 'large',
            layout: 'default',
        },
        autoNumberLiteral
    );
    assert.equal(literalAutoNumber.fontSize, '18px');
    assert.equal(literalAutoNumber.layout, 'default');
    assert.equal(literalAutoNumber.linkHref, target.href);
    assert.equal(literalAutoNumber.linkTarget, '_blank');
    for (const value of [null, undefined, '']) {
        const emptyAutoNumber = await publishAutoNumber(
            { value, language: 'fr' },
            'Pas de Valeur'
        );
        assert.equal(emptyAutoNumber.linkHref, null);
    }
    const unsafeLiteral = 'javascript:alert(1) <img src=x onerror=bad()>';
    const inertAutoNumber = await publishAutoNumber(
        { value: unsafeLiteral, language: 'en' },
        unsafeLiteral
    );
    assert.equal(inertAutoNumber.linkHref, null);
    await publishAutoNumber(
        { value: autoNumberLiteral, language: 'en' },
        autoNumberLiteral
    );
    let autoNumberPopup;
    try {
        [autoNumberPopup] = await Promise.all([
            page.waitForEvent('popup'),
            page.locator('#case-autonumber a').click(),
        ]);
        await autoNumberPopup.waitForLoadState('domcontentloaded');
        assert.equal(
            new URL(autoNumberPopup.url()).pathname,
            completeReadOnlyTextBrowserTargetPath
        );
        assert.equal(
            await autoNumberPopup.title(),
            'Readonly text synthetic target'
        );
    } finally {
        if (autoNumberPopup) await autoNumberPopup.close();
    }
    const final = await page.evaluate(() => ({
        ...window.__nativeProbe.snapshot(),
        adjacent: document.getElementById('readonly-adjacent').value,
    }));
    assert.deepEqual(final.errors, []);
    assert.equal(final.ordinaryClicks, 1);
    assert.equal(final.linkRowClicks, 0);
    assert.equal(final.trustedLinkClicks, 1);
    assert.equal(final.autoNumberRowClicks, 0);
    assert.equal(final.autoNumberTrustedLinkClicks, 1);
    assert.equal(final.submits, 0);
    assert.equal(final.componentRequests, 0);
    assert.equal(final.adjacent, 'Retain neighboring draft');
    Object.assign(evidence, {
        layouts: samples,
        visible,
        autoNumber: {
            samples: autoNumberSamples,
            rowClicks: final.autoNumberRowClicks,
            trustedLinkClicks: final.autoNumberTrustedLinkClicks,
        },
        clicks: {
            ordinary: final.ordinaryClicks,
            linkRow: final.linkRowClicks,
            trustedLink: final.trustedLinkClicks,
        },
        requests: final.componentRequests,
        submits: final.submits,
        adjacent: final.adjacent,
        reactVersion: final.reactVersion,
        scope: 'Installed public readonly text and controlled AutoNumber with packaged readonly CSS in standalone Chromium without Tailwind; measured layout, literal/localized replacements, sibling isolation and same-origin link behavior, not hosted Form/Portal acceptance.',
        cleanup:
            'owned synthetic popup closed; page/context cleanup belongs to normal browser harness',
    });
}
