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
nativeEditorElement(SuppliedNativeEditor,{...suppliedNative,ref(instance){if(!instance)return;return ()=>{void instance;};}});
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
            const defaultWriter = (stored) => writes.push(stored);
            const render = (
                value,
                readonly = false,
                forwarded = ref,
                Editor = SlotProbe,
                placeholder = '',
                writer = defaultWriter
            ) =>
                React.act(async () =>
                    root.render(
                        React.createElement(api.NativeRichTextEditor, {
                            ref: forwarded,
                            value,
                            readOnly: readonly,
                            removeStaleEditorRoots: true,
                            onValueChange: writer,
                            placeholder,
                            emptyContent: React.createElement(
                                'b',
                                null,
                                'Localized empty'
                            ),
                            renderEditor: (native, focused) => {
                                latest = { native, focused };
                                return React.createElement(Editor, {
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
                const originalChange = latest.native.onChange;
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
                let retiredReads = 0;
                const retiredRead = () => {
                    retiredReads++;
                    return 'Late retired edit';
                };
                await React.act(async () => originalChange(retiredRead));
                assert.equal(retiredReads, 0);
                assert.deepEqual(writes, ['[x] changed  \n\n']);
                const currentChange = latest.native.onChange;
                await render('External', true);
                await React.act(async () => currentChange(retiredRead));
                assert.equal(retiredReads, 0);
                await render(null, true);
                assert.equal(ref.current, null);
                assert.equal(container.textContent, 'Localized empty');
                for (const [value, readonly] of [
                    ['', true],
                    [null, true],
                    [null, false],
                    ['', false],
                    [null, true],
                    ['', true],
                    ['', false],
                ]) {
                    await render(value, readonly);
                    assert.equal(
                        container.querySelectorAll('[data-stale]').length,
                        0
                    );
                    assert.equal(
                        container.querySelectorAll('[data-active]').length,
                        readonly && value === null ? 0 : 1
                    );
                }
                const entries = [],
                    nulls = [];
                const callback = (owner) => (instance) => {
                    if (instance === null) {
                        nulls.push(owner);
                        return;
                    }
                    const entry = { owner, released: 0 };
                    entries.push(entry);
                    return () => {
                        entry.released++;
                    };
                };
                const firstRef = callback('first'),
                    secondRef = callback('second');
                await render('Alpha', false, firstRef);
                await render('Alpha', false, secondRef);
                assert(
                    entries
                        .filter((x) => x.owner === 'first')
                        .every((x) => x.released === 1)
                );
                await render('Replacement', false, secondRef);
                const unmountedChange = latest.native.onChange;
                await React.act(async () => root.render(null));
                await React.act(async () => unmountedChange(retiredRead));
                assert.equal(retiredReads, 0);
                assert.deepEqual(writes, ['[x] changed  \n\n']);
                assert(entries.length >= 3);
                assert(entries.every((x) => x.released === 1));
                assert.deepEqual(nulls, []);
                let live = null,
                    attaches = 0,
                    detaches = 0;
                const legacy = (instance) => {
                    if (instance) {
                        assert.equal(live, null);
                        live = instance;
                        attaches++;
                    } else {
                        assert(live);
                        live = null;
                        detaches++;
                    }
                };
                await render('Legacy', false, legacy);
                await render('Legacy replacement', false, legacy);
                await React.act(async () => root.render(null));
                assert(attaches >= 2);
                assert.equal(detaches, attaches);

                // Same text/key does not authorize an old actual instance.
                class OtherSlot extends SlotProbe {}
                await render('Same document');
                const retiredSlot = latest.native;
                const oldInstance = ref.current;
                await render('Same document', false, ref, OtherSlot);
                assert.notEqual(ref.current, oldInstance);
                writes.length = 0;
                let disposedReads = 0;
                await React.act(async () =>
                    retiredSlot.onChange(() => {
                        disposedReads++;
                        return 'Retired instance document';
                    })
                );
                assert.equal(disposedReads, 0);
                assert.deepEqual(writes, []);
                await React.act(async () =>
                    latest.native.onChange(() => 'Current instance document')
                );
                assert.deepEqual(writes, ['Current instance document']);

                let commitReads = 0;
                class PolicyFlushSlot extends SlotProbe {
                    componentDidUpdate(previous) {
                        super.componentDidUpdate(previous);
                        if (
                            previous.native.readOnly !==
                            this.props.native.readOnly
                        )
                            this.props.native.onChange(() => {
                                commitReads++;
                                return 'Policy commit document';
                            });
                    }
                }
                await render('Policy document', false, ref, PolicyFlushSlot);
                writes.length = 0;
                await render('Policy document', true, ref, PolicyFlushSlot);
                assert.equal(commitReads, 0);
                assert.deepEqual(writes, []);

                class WriterFlushSlot extends SlotProbe {
                    componentDidUpdate(previous) {
                        super.componentDidUpdate(previous);
                        if (
                            previous.native.placeholder !==
                            this.props.native.placeholder
                        )
                            this.props.native.onChange(() => {
                                commitReads++;
                                return 'Writer commit document';
                            });
                    }
                }
                const oldWrites = [],
                    newWrites = [];
                await render(
                    'Writer document',
                    false,
                    ref,
                    WriterFlushSlot,
                    'Before',
                    (value) => oldWrites.push(value)
                );
                const retainedWriter = latest.native;
                await render(
                    'Writer document',
                    false,
                    ref,
                    WriterFlushSlot,
                    'After',
                    (value) => newWrites.push(value)
                );
                assert.equal(commitReads, 1);
                assert.deepEqual(oldWrites, []);
                assert.deepEqual(newWrites, ['Writer commit document']);
                await React.act(async () =>
                    retainedWriter.onChange(() => 'Settled current writer')
                );
                assert.deepEqual(oldWrites, []);
                assert.deepEqual(newWrites, [
                    'Writer commit document',
                    'Settled current writer',
                ]);
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
