import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export const completeRichTextTypedConsumer = `
import {createElement,createRef} from 'react';
import {CompleteRichTextEditor,type CompleteRichTextEditorProps,type NativeRichTextEditorHandle} from '@miniextensions/sdk/react';
const props:CompleteRichTextEditorProps={value:'**Formatted**',onValueChange(value){const stored:string=value;void stored;},readOnly:false,placeholder:'Write',id:'rich-editor',ariaLabelledBy:'label',ariaDescribedBy:'help',ariaInvalid:false,identity:'record:field',accentColor:'#6366f1',linkColor:'#4338ca',linkHoverColor:'#6366f1'};
createElement(CompleteRichTextEditor,{...props,ref:createRef<NativeRichTextEditorHandle>()});
createElement(CompleteRichTextEditor,{...props,ref(instance){if(instance){const dom:HTMLElement|undefined=instance.view?.dom;void dom;return()=>void instance;}}});
// @ts-expect-error complete editor controlled values are nullable stored strings
const numberValue:CompleteRichTextEditorProps={...props,value:42};
// @ts-expect-error complete editor owns its engine and has no required or optional editor slot
const editorSlot:CompleteRichTextEditorProps={...props,renderEditor:()=>createElement('textarea')};
// @ts-expect-error writes persist stored strings, never synthetic input events
const eventWriter:CompleteRichTextEditorProps={...props,onValueChange(event:Event){void event;}};
void numberValue;void editorSlot;void eventWriter;
`;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Actual packed engine and ProseMirror documents, not the low-level editor-slot probe.
// Synthetic DOM cannot qualify native caret geometry, clipboard permissions or layout.
async function exerciseEngine({
    api,
    React,
    createRoot,
    renderCommit,
    window,
}) {
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container);
    const ref = React.createRef();
    const writes = [];
    let stored = '**Bold** and _italic_\n\n[ ] task';
    let mounted = true;
    const render = async (overrides = {}) => {
        await renderCommit(() =>
            root.render(
                React.createElement(api.CompleteRichTextEditor, {
                    ref,
                    value: stored,
                    onValueChange(value) {
                        assert.equal(typeof value, 'string');
                        writes.push(value);
                        stored = value;
                    },
                    id: 'complete-rich-editor',
                    ariaLabelledBy: 'rich-label',
                    ariaDescribedBy: 'rich-help',
                    ariaInvalid: false,
                    identity: 'record-one:rich',
                    emptyContent: React.createElement(
                        'b',
                        null,
                        'Localized empty'
                    ),
                    ...overrides,
                })
            )
        );
        const renderedValue = Object.hasOwn(overrides, 'value')
            ? overrides.value
            : stored;
        const expectsEditor = !(overrides.readOnly && renderedValue === null);
        for (
            let attempt = 0;
            expectsEditor &&
            !container.querySelector('.ProseMirror') &&
            attempt < 100;
            attempt++
        )
            await renderCommit(tick);
    };
    try {
        await render();
        assert(
            ref.current?.view,
            'The packed complete editor must load its real engine'
        );
        const initial = ref.current;
        const view = initial.view;
        assert.equal(container.querySelectorAll('.ProseMirror').length, 1);
        assert.equal(view.dom, container.querySelector('.ProseMirror'));
        assert.equal(view.dom.querySelector('strong')?.textContent, 'Bold');
        assert.equal(view.dom.querySelector('em')?.textContent, 'italic');
        assert.equal(
            view.dom.querySelector('input[type=checkbox]')?.checked,
            false
        );
        assert.equal(view.editable, true);
        assert.equal(view.dom.id, 'complete-rich-editor');
        assert.equal(view.dom.getAttribute('aria-labelledby'), 'rich-label');
        assert.deepEqual(
            writes,
            [],
            'Mounting must not persist normalized display text'
        );

        const selection = {
            from: view.state.selection.from,
            to: view.state.selection.to,
        };
        await render({
            id: 'complete-rich-editor-updated',
            ariaLabelledBy: 'new-label',
            ariaDescribedBy: 'new-help',
            ariaInvalid: true,
        });
        assert.equal(
            ref.current,
            initial,
            'Metadata changes retain the actual editor'
        );
        assert.equal(
            ref.current.view,
            view,
            'Metadata changes retain its ProseMirror view'
        );
        assert.deepEqual(
            { from: view.state.selection.from, to: view.state.selection.to },
            selection
        );
        assert.equal(view.dom.id, 'complete-rich-editor-updated');
        assert.equal(view.dom.getAttribute('aria-labelledby'), 'new-label');
        assert.equal(view.dom.getAttribute('aria-describedby'), 'new-help');
        assert.equal(view.dom.getAttribute('aria-invalid'), 'true');

        await renderCommit(() =>
            view.dispatch(
                view.state.tr.insertText(
                    ' edited',
                    view.state.doc.content.size - 1
                )
            )
        );
        assert.match(writes.at(-1), /edited/);
        assert.match(writes.at(-1), /\*\*Bold\*\*/);
        assert.match(writes.at(-1), /\[ \] task/);
        let checkbox;
        view.state.doc.descendants((node, position) => {
            if (node.type.name === 'checkbox_item')
                checkbox = { node, position };
        });
        assert(checkbox, 'The engine must contain a real checkbox node');
        await renderCommit(() =>
            view.dispatch(
                view.state.tr.setNodeMarkup(checkbox.position, undefined, {
                    ...checkbox.node.attrs,
                    checked: true,
                })
            )
        );
        assert.match(writes.at(-1), /\[x\] task/);
        assert.doesNotMatch(
            writes.at(-1),
            /^- \[x\]/m,
            'Persisted checkbox syntax remains native stored syntax'
        );
        assert.equal(
            view.dom.querySelector('input[type=checkbox]')?.checked,
            true
        );

        const beforeReadonly = writes.length;
        await render({ readOnly: true });
        assert.equal(ref.current, initial);
        assert.equal(view.editable, false);
        assert.equal(view.dom.getAttribute('contenteditable'), 'false');
        assert.equal(view.dom.querySelector('strong')?.textContent, 'Bold');
        assert.equal(writes.length, beforeReadonly);

        stored = '**Replacement**';
        await render({ identity: 'record-two:rich' });
        assert.notEqual(
            ref.current,
            initial,
            'A new semantic owner gets a new engine'
        );
        assert.equal(
            view.isDestroyed,
            true,
            'The former ProseMirror view is destroyed'
        );
        assert.equal(container.querySelectorAll('.ProseMirror').length, 1);
        assert.equal(
            ref.current.view.dom.querySelector('strong')?.textContent,
            'Replacement'
        );
        const finalView = ref.current.view;

        // React19 callback refs may supply cleanup instead of receiving null.
        // The SDK's React18-compatible ownership layer honors that convention too.
        const callbackAttachments = [];
        let callbackNulls = 0;
        let liveCallbackHandle = null;
        const cleanupRef = (instance) => {
            if (instance === null) {
                callbackNulls++;
                liveCallbackHandle = null;
                return;
            }
            const attachment = { instance, cleanups: 0 };
            callbackAttachments.push(attachment);
            liveCallbackHandle = instance;
            return () => {
                attachment.cleanups++;
                if (liveCallbackHandle === instance) liveCallbackHandle = null;
            };
        };
        await render({ ref: cleanupRef });
        assert(
            liveCallbackHandle?.view,
            'The cleanup callback must receive the actual engine'
        );
        const callbackView = liveCallbackHandle.view;
        await render({ ref: cleanupRef, value: null, readOnly: true });
        assert.equal(liveCallbackHandle, null);
        assert.equal(callbackView.isDestroyed, true);
        assert.equal(container.querySelector('.ProseMirror'), null);
        assert.equal(container.textContent, 'Localized empty');
        // A retired handle must not remain in SDK metadata state: this previously
        // attempted setProps through the destroyed engine's nulled view.
        await render({
            ref: cleanupRef,
            value: null,
            readOnly: true,
            id: 'empty-editor-metadata',
            ariaLabelledBy: 'empty-label',
            ariaInvalid: true,
        });
        assert.equal(container.querySelector('.ProseMirror'), null);
        assert.equal(container.textContent, 'Localized empty');
        assert(callbackAttachments.length >= 1);
        assert(
            callbackAttachments.every(
                (attachment) => attachment.cleanups === 1
            ),
            'Every callback attachment is retired exactly once'
        );
        assert.equal(
            callbackNulls,
            0,
            'A cleanup-returning callback is released through its cleanup'
        );

        await renderCommit(() => root.unmount());
        mounted = false;
        assert.equal(ref.current, null);
        assert.equal(finalView.isDestroyed, true);
        assert.equal(container.querySelector('.ProseMirror'), null);
        assert.equal(
            writes.length,
            beforeReadonly,
            'Replacement and retirement do not persist a document'
        );
        assert(
            callbackAttachments.every((attachment) => attachment.cleanups === 1)
        );
        return {
            formatted: true,
            edits: 2,
            checkbox: true,
            metadata: true,
            readOnly: true,
            callbackCleanupRetirement: true,
            ownerRetirement: true,
            unmount: true,
        };
    } finally {
        if (mounted) await renderCommit(() => root.unmount());
        container.remove();
    }
}

async function withSyntheticBrowser(happyDomModulePath, run) {
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window({ url: 'http://localhost/' });
    const names = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLImageElement',
        'Element',
        'Node',
        'Text',
        'DocumentFragment',
        'MutationObserver',
        'DOMParser',
        'Range',
        'Image',
        'File',
        'MouseEvent',
        'KeyboardEvent',
        'Event',
        'ResizeObserver',
        'getComputedStyle',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'getSelection',
        'innerHeight',
        'innerWidth',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const previous = names.map((name) =>
        Object.getOwnPropertyDescriptor(globalThis, name)
    );
    for (const name of names) {
        const value =
            name === 'window'
                ? window
                : name === 'IS_REACT_ACT_ENVIRONMENT'
                  ? true
                  : window[name];
        Object.defineProperty(globalThis, name, {
            configurable: true,
            writable: true,
            value:
                typeof value === 'function' &&
                [
                    'getComputedStyle',
                    'requestAnimationFrame',
                    'cancelAnimationFrame',
                    'getSelection',
                ].includes(name)
                    ? value.bind(window)
                    : value,
        });
    }
    try {
        return await run(window);
    } finally {
        await window.happyDOM.close();
        names.forEach((name, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, name, previous[index]);
            else Reflect.deleteProperty(globalThis, name);
        });
    }
}

async function checkInstalledCompleteEditor(
    consumerDirectory,
    happyDomModulePath
) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    // Public entry points remain importable before any browser global exists.
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
            )
        ).href
    );
    const commonjs = consumer('@miniextensions/sdk/react');
    return withSyntheticBrowser(happyDomModulePath, async (window) => {
        const React = consumer('react');
        const { createRoot } = consumer('react-dom/client');
        const receipts = [];
        for (const [format, api] of [
            ['esm', esm],
            ['commonjs', commonjs],
        ]) {
            const receipt = await exerciseEngine({
                api,
                React,
                createRoot,
                renderCommit: (callback) =>
                    React.act(async () => {
                        await callback();
                    }),
                window,
            });
            receipts.push({ format, ...receipt });
        }
        return {
            react: React.version,
            receipts,
            scope: 'Actual packed engine in synthetic DOM; native browser selection, clipboard, layout and accessibility acceptance remain separate.',
        };
    });
}

async function checkProductionBundle(consumerDirectory, happyDomModulePath) {
    const result = await build({
        stdin: {
            resolveDir: consumerDirectory,
            contents: `import * as React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import * as api from '@miniextensions/sdk/react';import '@miniextensions/sdk/react/rich-text.css';globalThis.__completeRichTextProduction={React,createRoot,flushSync,api};`,
        },
        bundle: true,
        platform: 'browser',
        format: 'iife',
        outfile: join(consumerDirectory, 'complete-rich-text-proof.js'),
        minify: true,
        metafile: true,
        write: false,
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    const javascript = result.outputFiles.find((file) =>
        file.path.endsWith('.js')
    );
    const css = result.outputFiles.find((file) => file.path.endsWith('.css'));
    assert(
        javascript && css,
        'The packed production consumer must emit both engine JavaScript and opted-in stylesheet'
    );
    assert(
        Object.keys(result.metafile.inputs).some((name) =>
            name.includes('/vendor/rich-markdown-editor/')
        ),
        'The production consumer must bundle the actual owned engine'
    );
    assert.match(css.text, /me-rich-text/);
    return withSyntheticBrowser(happyDomModulePath, async (window) => {
        const previous = Object.getOwnPropertyDescriptor(
            globalThis,
            '__completeRichTextProduction'
        );
        Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
            configurable: true,
            writable: true,
            value: false,
        });
        try {
            new Function(javascript.text)();
            const { React, createRoot, flushSync, api } =
                globalThis.__completeRichTextProduction;
            const receipt = await exerciseEngine({
                api,
                React,
                createRoot,
                window,
                renderCommit: async (callback) => {
                    flushSync(() => callback());
                    await tick();
                },
            });
            return {
                react: React.version,
                format: 'production-browser-bundle',
                javascriptBytes: javascript.contents.length,
                cssBytes: css.contents.length,
                ...receipt,
            };
        } finally {
            if (previous)
                Object.defineProperty(
                    globalThis,
                    '__completeRichTextProduction',
                    previous
                );
            else
                Reflect.deleteProperty(
                    globalThis,
                    '__completeRichTextProduction'
                );
        }
    });
}

export function checkCompleteRichTextReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(
        join(tmpdir(), 'sdk-complete-rich-text-matrix-')
    );
    const run = (command, args) =>
        execFileSync(command, args, { cwd: directory, stdio: 'inherit' });
    const versions = [];
    try {
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            // Each React profile gets a clean dependency tree, with no prior-version peer state.
            rmSync(join(directory, 'node_modules'), {
                recursive: true,
                force: true,
            });
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
                const name = `complete-rich-text.${extension}`;
                writeFileSync(
                    join(directory, name),
                    completeRichTextTypedConsumer
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
            // Separate processes keep both React versions and production/development caches honest.
            const receipts = [];
            for (const mode of ['--run-consumer', '--run-production']) {
                const bytes = execFileSync(
                    process.execPath,
                    [
                        fileURLToPath(import.meta.url),
                        mode,
                        directory,
                        happyDomModulePath,
                    ],
                    { cwd: directory, encoding: 'utf8' }
                );
                const receipt = JSON.parse(bytes);
                assert.equal(receipt.react, version.react);
                receipts.push(receipt);
            }
            assert.equal(receipts[0].receipts.length, 2);
            versions.push({ react: version.react, receipts });
            console.log(
                `Installed complete Rich Text React${version.react}: real engine ESM/CommonJS, strict declarations and minified production browser bundle passed in synthetic DOM; native browser acceptance remains separate.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

if (process.argv[2] === '--run-consumer')
    console.log(
        JSON.stringify(
            await checkInstalledCompleteEditor(process.argv[3], process.argv[4])
        )
    );
else if (process.argv[2] === '--run-production')
    console.log(
        JSON.stringify(
            await checkProductionBundle(process.argv[3], process.argv[4])
        )
    );
