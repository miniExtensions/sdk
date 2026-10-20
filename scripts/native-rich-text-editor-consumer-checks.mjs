import { fileSelectionTypedConsumer } from './file-selection-consumer-checks.mjs';
import { recoverableImageTypedConsumer } from './recoverable-image-consumer-checks.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const nativeEditorTypedConsumer = `
import {createElement as nativeEditorElement,createRef as nativeEditorRef} from 'react';
import {NativeRichTextEditor as SuppliedNativeEditor,type NativeRichTextEditorProps as SuppliedNativeEditorProps,type NativeRichTextEditorHandle as SuppliedNativeHandle,type NativeRichTextEditorRenderProps as SuppliedNativeProps} from '@miniextensions/sdk/react';
const suppliedNative:SuppliedNativeEditorProps={value:null,onValueChange(value){const stored:string=value;void stored;},renderEditor(native,focused){const initial:string=native.defaultValue;const readonly:boolean=native.readOnly;const focus:boolean=focused;const parser=native.parsers[0].match({content:'[x] item'});void initial;void readonly;void focus;void parser;return nativeEditorElement('section',null,'Slot type probe');}};
nativeEditorElement(SuppliedNativeEditor,{...suppliedNative,ref:nativeEditorRef<SuppliedNativeHandle>()});
// @ts-expect-error controlled stored values remain nullable strings
const numericNativeEditor:SuppliedNativeEditorProps={...suppliedNative,value:42};
// @ts-expect-error a caller must supply an actual editor element, not a text fallback
const textNativeEditor:SuppliedNativeEditorProps={...suppliedNative,renderEditor:()=> 'plain text'};
// @ts-expect-error native editor reads are synchronous strings
const asynchronousNativeRead:SuppliedNativeProps['onChange']=(read:()=>Promise<string>)=>void read;
function nativeEditorValue(native:SuppliedNativeProps){
// @ts-expect-error the uncontrolled native editor receives defaultValue, never a controlled value echo
return native.value;
}
void numericNativeEditor;void textNativeEditor;void asynchronousNativeRead;void nativeEditorValue;
`;

// External component-slot contract only; this is not a replacement rich editor.
async function checkInstalledSlot(consumerDirectory, happyDomModulePath) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const previous = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        });
    const React = consumer('react');
    const { createRoot } = consumer('react-dom/client');
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
            )
        )
    );
    class SlotProbe extends React.Component {
        element = null;
        view = undefined;
        active = null;
        initial = this.props.native.defaultValue;
        componentDidMount() {
            this.view = { dom: this.active };
            this.props.native.ref(this);
        }
        componentDidUpdate(previous) {
            if (previous.native.ref !== this.props.native.ref) {
                previous.native.ref(null);
                this.props.native.ref(this);
            }
        }
        componentWillUnmount() {
            this.props.native.ref(null);
        }
        render() {
            return React.createElement(
                'section',
                {
                    ref: (node) => {
                        this.element = node;
                    },
                },
                React.createElement(
                    'div',
                    {
                        ref: (node) => {
                            this.active = node;
                        },
                        'data-active': 'true',
                    },
                    this.initial
                ),
                React.createElement('div', { 'data-stale': 'true' }, 'stale')
            );
        }
    }
    let groups = 0;
    try {
        for (const api of [esm, consumer('@miniextensions/sdk/react')]) {
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            const ref = React.createRef();
            const writes = [];
            let latest;
            const render = (value, readonly = false) =>
                React.act(async () =>
                    root.render(
                        React.createElement(api.NativeRichTextEditor, {
                            ref,
                            value,
                            readOnly: readonly,
                            removeStaleEditorRoots: true,
                            onValueChange: (stored) => writes.push(stored),
                            emptyContent: React.createElement(
                                'b',
                                null,
                                'Localized empty'
                            ),
                            renderEditor: (native, focused) => {
                                latest = { native, focused };
                                return React.createElement(SlotProbe, {
                                    native,
                                    focused,
                                });
                            },
                        })
                    )
                );
            try {
                await render('[x] item');
                const instance = ref.current;
                const active = container.querySelector('[data-active]');
                assert(instance instanceof SlotProbe);
                assert.equal(instance.view.dom, active);
                assert.equal(container.querySelector('[data-stale]'), null);
                assert.equal(latest.native.defaultValue, '- [x] item');
                assert(!('value' in latest.native));
                await render('[x] item\n\n');
                assert.equal(ref.current, instance);
                assert.equal(container.querySelector('[data-active]'), active);
                await React.act(async () => latest.native.onFocus());
                assert.equal(latest.focused, true);
                assert.equal(ref.current, instance);
                await React.act(async () => latest.native.onBlur());
                assert.equal(latest.focused, false);
                await React.act(async () =>
                    latest.native.onChange(() => '- [x] item\n')
                );
                assert.deepEqual(writes, []);
                await React.act(async () =>
                    latest.native.onChange(() => '- [x] changed  \n\n')
                );
                assert.deepEqual(writes, ['[x] changed  \n\n']);
                await render('External');
                assert.notEqual(ref.current, instance);
                assert.equal(latest.native.defaultValue, 'External');
                assert.deepEqual(writes, ['[x] changed  \n\n']);
                await render(null, true);
                assert.equal(ref.current, null);
                assert.equal(container.textContent, 'Localized empty');
                groups++;
            } finally {
                await React.act(async () => root.unmount());
                assert.equal(ref.current, null);
                container.remove();
            }
        }
        return {
            react: React.version,
            groups,
            scope: 'External editor-slot ABI; real vendor acceptance is separate.',
        };
    } finally {
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}

export function checkNativeEditorReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-native-editor-matrix-'));
    const run = (command, args) =>
        execFileSync(command, args, { cwd: directory, stdio: 'inherit' });
    const versions = [];
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify(
                {
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': `file:${archivePath}`,
                    },
                },
                null,
                2
            )
        );
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
                `react@${version.react}`,
                `react-dom@${version.react}`,
                `@types/react@${version.types}`,
                `@types/react-dom@${version.domTypes}`,
            ]);
            for (const extension of ['mts', 'cts']) {
                const name = `native-editor.${extension}`;
                writeFileSync(
                    join(directory, name),
                    nativeEditorTypedConsumer +
                        recoverableImageTypedConsumer +
                        fileSelectionTypedConsumer
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
            // A fresh process avoids React's module cache hiding a version change.
            const bytes = execFileSync(
                process.execPath,
                [
                    fileURLToPath(import.meta.url),
                    '--run-consumer',
                    directory,
                    happyDomModulePath,
                ],
                { cwd: directory, encoding: 'utf8' }
            );
            const result = JSON.parse(bytes);
            assert.equal(result.react, version.react);
            assert.equal(result.groups, 2);
            versions.push(result);
            console.log(
                `Installed native editor slot React${result.react}: ${result.groups} ESM/CommonJS ABI groups and strict declarations passed; no vendor compatibility claim.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

if (process.argv[2] === '--run-consumer') {
    console.log(
        JSON.stringify(
            await checkInstalledSlot(process.argv[3], process.argv[4])
        )
    );
}
