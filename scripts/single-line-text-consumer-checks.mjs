import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const typed = String.raw`
import { createElement as h, createRef } from 'react';
import { SingleLineTextField, TextField, renderSingleLineTextField, type SingleLineTextFieldProps, type ControlledSingleLineTextFieldProps, type SingleLineTextEditOwner, type TextFieldProps } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/single-line-text.css';
declare const binding: TextFieldProps['binding'];
declare const owner: SingleLineTextEditOwner;
h(TextField, {binding});
const immediate: ControlledSingleLineTextFieldProps = {mode:'controlled',value:null,onChange(value){const scalar:string=value;void scalar;},language:'en',title:'Name',characterLimit:8,initialMobile:false};
h(SingleLineTextField, {...immediate,ref:createRef<HTMLInputElement>()});
h(SingleLineTextField, {...immediate,enableInlineEdit:true,owner});
const preview: SingleLineTextFieldProps = {...immediate,address:{mode:'preview' as const,explanation:'Standalone form only'}};
h(SingleLineTextField,preview);
h(SingleLineTextField,{mode:'readOnly',value:'https://example.test/file.pdf',language:'en',obscurePassword:true,displayAsAttachments:true,displayAsButton:true});
// @ts-expect-error deferred editing needs captured native authority
h(SingleLineTextField,{...immediate,enableInlineEdit:true});
// @ts-expect-error configured control and binding are separate APIs
h(SingleLineTextField,{...immediate,binding});
// @ts-expect-error whole-field renderer injection is not part of this API
h(SingleLineTextField,{...immediate,render:()=>null});
// @ts-expect-error provider reads do not belong to the manual preview
h(SingleLineTextField,{...immediate,address:{mode:'preview',explanation:'Preview',reads:{}}});
void renderSingleLineTextField;
`;

/** Actual installed exports; caller-owned drafts only, with zero implicit Save/I/O. */
export async function checkSingleLineTextConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const React = require('react');
    const { h = React.createElement, act, StrictMode } = React;
    const { renderToString } = require('react-dom/server');
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    let checks = 0;
    for (const format of ['esm', 'cjs']) {
        const api =
            format === 'esm'
                ? await import(
                      pathToFileURL(
                          join(
                              consumerDirectory,
                              'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
                          )
                      )
                  )
                : require('@miniextensions/sdk/react');
        assert.equal(typeof api.TextField, 'function');
        assert.equal(typeof api.renderSingleLineTextField, 'function');
        assert.equal(
            'SingleLineTextField' in require('@miniextensions/sdk'),
            false
        );
        const css = readFileSync(
            require.resolve('@miniextensions/sdk/react/single-line-text.css'),
            'utf8'
        );
        assert.match(css, /mx-sdk-single-line-input/);
        assert.doesNotMatch(css, /@tailwind|@apply/);
        for (const dependency of [
            'complete-clearable-text-input',
            'complete-barcode-scanner',
            'complete-address',
            'complete-readonly-text',
            'button',
        ])
            assert.ok(
                require.resolve(`@miniextensions/sdk/react/${dependency}.css`)
            );
        const html = renderToString(
            h(api.SingleLineTextField, {
                mode: 'controlled',
                value: null,
                onChange() {
                    throw Error('SSR write');
                },
                language: 'en',
                initialMobile: false,
            })
        );
        assert.match(html, /value=""/);
        assert.doesNotMatch(html, /video|iframe|owner=/);
        checks++;
        for (const [value, config, pattern] of [
            [null, {}, /No Value/],
            ['', { obscurePassword: true }, /No Value/],
            [
                'private',
                {
                    obscurePassword: true,
                    displayAsAttachments: true,
                    displayAsButton: true,
                },
                /••••••••/,
            ],
            [
                'https://example.test/file.pdf',
                { displayAsAttachments: true, displayAsButton: true },
                /<ul aria-label="Attachments"/,
            ],
            [
                'javascript:alert(1)',
                { displayAsAttachments: true, displayAsButton: true },
                /disabled=""/,
            ],
            ['literal <tag>  ', {}, /literal &lt;tag&gt;  /],
        ]) {
            const result = renderToString(
                h(api.SingleLineTextField, {
                    mode: 'readOnly',
                    value,
                    language: 'en',
                    ...config,
                })
            );
            assert.match(result, pattern);
            if (config.obscurePassword && value)
                assert.doesNotMatch(result, /private/);
            if (String(value).startsWith('javascript:'))
                assert.doesNotMatch(result, /href=|javascript:/);
            checks++;
        }
        const window = new Window({ url: 'https://single-line.example.test' });
        let network = 0,
            submits = 0;
        const keys = [
            'window',
            'document',
            'navigator',
            'HTMLElement',
            'HTMLInputElement',
            'HTMLButtonElement',
            'HTMLFieldSetElement',
            'HTMLLegendElement',
            'Node',
            'Element',
            'requestAnimationFrame',
            'cancelAnimationFrame',
            'IS_REACT_ACT_ENVIRONMENT',
            'fetch',
        ];
        const originals = keys.map((key) =>
            Object.getOwnPropertyDescriptor(globalThis, key)
        );
        for (const key of keys)
            Object.defineProperty(globalThis, key, {
                configurable: true,
                writable: true,
                value:
                    key === 'IS_REACT_ACT_ENVIRONMENT'
                        ? true
                        : key === 'fetch'
                          ? async () => {
                                network++;
                                throw Error('Unexpected network');
                            }
                          : [
                                  'requestAnimationFrame',
                                  'cancelAnimationFrame',
                              ].includes(key)
                            ? window[key].bind(window)
                            : window[key],
            });
        Object.defineProperty(window, 'fetch', { value: globalThis.fetch });
        const { createRoot } = require('react-dom/client'),
            container = window.document.createElement('main');
        window.document.body.append(container);
        const root = createRoot(container),
            ref = React.createRef(),
            writes = [];
        const a = { token: {}, isCurrent: () => true },
            b = { token: {}, isCurrent: () => true };
        let mounted = true,
            displayOnly = false;
        let props = {
            mode: 'controlled',
            value: 'seed',
            onChange(value) {
                writes.push(value);
                props = { ...props, value };
                root.render(view());
            },
            language: 'en',
            title: 'Name',
            id: 'name',
            form: 'existing-form',
            describedBy: 'name-help',
            invalid: true,
            initialMobile: true,
            owner: a,
            ref,
        };
        const view = () =>
            h(
                StrictMode,
                null,
                h(
                    'form',
                    {
                        id: 'existing-form',
                        onSubmit: (event) => {
                            event.preventDefault();
                            submits++;
                        },
                    },
                    mounted
                        ? displayOnly
                            ? h(api.SingleLineTextField, {
                                  mode: 'readOnly',
                                  value: 'current display',
                                  language: 'en',
                              })
                            : h(api.SingleLineTextField, props)
                        : null,
                    h('input', {
                        'aria-label': 'Sibling draft',
                        defaultValue: 'keep sibling',
                    })
                )
            );
        const input = () => container.querySelector('input');
        const render = async (patch) => {
            props = { ...props, ...patch };
            await act(async () => root.render(view()));
        };
        const edit = async (value, start, end = start) =>
            act(async () => {
                const node = input();
                node.focus();
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                ).set.call(node, value);
                if (start != null) node.setSelectionRange(start, end);
                node.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
        try {
            await render({});
            assert.equal(ref.current, input());
            assert.equal(input().form.id, 'existing-form');
            assert.equal(input().getAttribute('aria-describedby'), 'name-help');
            assert.equal(input().getAttribute('aria-invalid'), 'true');
            checks++;
            await edit('literal  ');
            assert.equal(writes.at(-1), 'literal  ');
            await render({ characterLimit: 2 });
            await edit('a😀suffix');
            assert.equal(writes.at(-1), 'a\ud83d');
            checks++;
            const clear = container.querySelector('button');
            assert.equal(clear.type, 'button');
            await act(async () => clear.click());
            assert.equal(writes.at(-1), '');
            checks++;
            await render({
                characterLimit: 4,
                enableInlineEdit: true,
                value: 'seed',
            });
            writes.length = 0;
            await edit('abcdef', 1, 3);
            assert.deepEqual(writes, []);
            input().setSelectionRange(2, 4);
            await act(async () => input().blur());
            assert.deepEqual(writes, ['abcd']);
            assert.equal(input().selectionStart, 4);
            checks++;
            await edit('old dirty');
            await render({ owner: b });
            await render({ owner: a });
            assert.deepEqual(writes, ['abcd']);
            checks++;
            await edit('new dirty');
            await render({ disabled: true });
            await render({ disabled: false });
            assert.deepEqual(writes, ['abcd']);
            checks++;
            await render({
                enableInlineEdit: false,
                readOnly: true,
                characterLimit: 1,
                value: 'long external',
            });
            assert.equal(input().hasAttribute('maxlength'), false);
            assert.equal(
                container.querySelector('[title="Character Limit"]'),
                null
            );
            checks++;
            await render({
                readOnly: false,
                characterLimit: undefined,
                address: {
                    mode: 'preview',
                    explanation: 'Standalone form only',
                },
            });
            assert.match(container.textContent, /Standalone form only/);
            assert.match(
                input().getAttribute('aria-describedby'),
                /address-preview/
            );
            checks++;
            await render({ obscurePassword: true });
            assert.equal(input().type, 'password');
            assert.equal(
                container.querySelector('[id$="address-preview"]'),
                null
            );
            checks++;
            await render({
                obscurePassword: false,
                address: undefined,
                enableInlineEdit: true,
            });
            writes.length = 0;
            await edit('obsolete mode draft');
            displayOnly = true;
            await act(async () => root.render(view()));
            assert.deepEqual(writes, []);
            assert.equal(ref.current, null);
            displayOnly = false;
            await act(async () => root.render(view()));
            assert.deepEqual(writes, []);
            assert.equal(ref.current, input());
            checks++;
            await edit('current  ');
            mounted = false;
            await act(async () => root.render(view()));
            assert.deepEqual(writes, ['current  ']);
            assert.equal(ref.current, null);
            checks++;
            assert.equal(
                container.querySelector('[aria-label="Sibling draft"]').value,
                'keep sibling'
            );
            assert.equal(submits, 0);
            assert.equal(network, 0);
            checks++;
        } finally {
            await act(async () => root.unmount());
            keys.forEach((key, i) => {
                if (originals[i])
                    Object.defineProperty(globalThis, key, originals[i]);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    }
    return { react: React.version, checks, cleanup: 'completed' };
}

export function checkSingleLineTextReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-single-line-text-')),
        versions = [];
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
        const runner = `import {checkSingleLineTextConsumer} from ${JSON.stringify(import.meta.url)};\nimport {checkTextConsumer} from ${JSON.stringify(new URL('./text-consumer-checks.mjs', import.meta.url).href)};\nconst options=${JSON.stringify({ consumerDirectory: directory, happyDomModulePath })};\nconst result=await checkSingleLineTextConsumer(options);result.bindingChecks=await checkTextConsumer(options);console.log(JSON.stringify(result));\n`;
        writeFileSync(join(directory, 'runtime.mjs'), runner);
        for (const version of [
            { react: '18.3.1', types: '18.3.12', dom: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', dom: '19.2.2' },
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
                '@types/react-dom@' + version.dom,
            ]);
            for (const extension of ['mts', 'cts']) {
                const file = 'consumer.' + extension;
                writeFileSync(join(directory, file), typed);
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
                    [join(directory, 'runtime.mjs')],
                    { cwd: directory, encoding: 'utf8' }
                )
                    .trim()
                    .split('\n')
                    .at(-1)
            );
            assert.equal(result.react, version.react);
            assert.equal(result.checks, 38);
            assert.ok(result.bindingChecks.checks > 0);
            assert.equal(result.cleanup, 'completed');
            versions.push(result);
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
