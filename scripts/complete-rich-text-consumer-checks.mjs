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
import {RichTextField,type RichTextFieldProps,type BindingRichTextFieldProps,type ControlledRichTextFieldProps,CompleteRichTextEditor,type CompleteRichTextEditorProps,type NativeRichTextEditorHandle} from '@miniextensions/sdk/react';
import type {FormFieldBinding} from '@miniextensions/sdk/forms';
const props:CompleteRichTextEditorProps={value:'**Formatted**',onValueChange(value){const stored:string=value;void stored;},readOnly:false,placeholder:'Write',id:'rich-editor',ariaLabelledBy:'label',ariaDescribedBy:'help',ariaInvalid:false,identity:'record:field',accentColor:'#6366f1',linkColor:'#4338ca',linkHoverColor:'#6366f1'};
createElement(CompleteRichTextEditor,{...props,ref:createRef<NativeRichTextEditorHandle>()});
createElement(CompleteRichTextEditor,{...props,ref(instance){if(instance){const dom:HTMLElement|undefined=instance.view?.dom;void dom;return()=>void instance;}}});
// @ts-expect-error complete editor controlled values are nullable stored strings
const numberValue:CompleteRichTextEditorProps={...props,value:42};
// @ts-expect-error complete editor owns its engine and has no required or optional editor slot
const editorSlot:CompleteRichTextEditorProps={...props,renderEditor:()=>createElement('textarea')};
// @ts-expect-error writes persist stored strings, never synthetic input events
const eventWriter:CompleteRichTextEditorProps={...props,onValueChange(event:Event){void event;}};
const canonical:ControlledRichTextFieldProps={...props};
createElement(RichTextField,canonical);
declare const binding:FormFieldBinding;
const literal:RichTextFieldProps={binding,className:'literal',render({snapshot,binding:owner}){void owner;return createElement('output',null,String(snapshot.value));}};
createElement(RichTextField,literal);
type AcceptedRichTextProps=BindingRichTextFieldProps|ControlledRichTextFieldProps;
// @ts-expect-error controlled and binding contracts cannot be mixed
const mixed:AcceptedRichTextProps={...props,binding};
// @ts-expect-error component overloads reject mixing binding and controlled props
createElement(RichTextField,{...props,binding});
// @ts-expect-error component overloads require the controlled writer
createElement(RichTextField,{value:null});
// @ts-expect-error controlled values require their stored-string writer
const missingWriter:ControlledRichTextFieldProps={value:null};
// @ts-expect-error a writer without a controlled value is not a complete field
const missingValue:ControlledRichTextFieldProps={onValueChange(value:string){void value;}};
// @ts-expect-error controlled fields own their editor and do not borrow a renderer
const canonicalSlot:ControlledRichTextFieldProps={...props,renderEditor:()=>createElement('textarea')};
// @ts-expect-error binding custom render cannot be combined with controlled props
const mixedRender:ControlledRichTextFieldProps={...props,render:()=>null};
// @ts-expect-error controlled values remain nullable strings
const invalidCanonicalValue:ControlledRichTextFieldProps={...props,value:42};
// @ts-expect-error controlled writes are strings rather than input events
const invalidCanonicalWriter:ControlledRichTextFieldProps={...props,onValueChange(event:Event){void event;}};
void numberValue;void editorSlot;void eventWriter;void mixed;void missingWriter;void missingValue;void canonicalSlot;void mixedRender;void invalidCanonicalValue;void invalidCanonicalWriter;
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

        // A real React image NodeView exercises the packed portal owner in each
        // React/format profile. The data URI requires no external fixture; image
        // decoding, zoom geometry and native browser acceptance are separate.
        const imageIdentity = 'record-image:rich';
        const imageSource = 'data:image/png;base64,AA==';
        stored = `![Consumer image](${imageSource})`;
        await render({ identity: imageIdentity });
        const imageEditor = ref.current;
        assert(
            imageEditor?.view,
            'The image document must use the real engine'
        );
        const imageView = imageEditor.view;
        for (
            let attempt = 0;
            (!imageView.dom.querySelector('img[alt="Consumer image"]') ||
                !imageView.dom.querySelector('.caption[role="textbox"]')) &&
            attempt < 100;
            attempt++
        )
            await renderCommit(tick);
        const image = imageView.dom.querySelector('img[alt="Consumer image"]');
        const caption = imageView.dom.querySelector('.caption[role="textbox"]');
        assert(image, 'The actual image NodeView must render its React portal');
        assert(
            caption,
            'The actual image caption must render through that portal'
        );
        assert.equal(image.getAttribute('src'), imageSource);
        assert.equal(caption.textContent, 'Consumer image');
        assert.equal(caption.getAttribute('contenteditable'), 'true');
        assert.equal(
            container.querySelectorAll('img[alt="Consumer image"]').length,
            1
        );
        assert.equal(finalView.isDestroyed, true);
        const beforeImagePolicy = writes.length;

        await render({ identity: imageIdentity, readOnly: true });
        assert.equal(ref.current, imageEditor);
        assert.equal(ref.current.view, imageView);
        assert.equal(imageView.editable, false);
        assert.equal(
            imageView.dom.querySelector('img[alt="Consumer image"]'),
            image
        );
        assert.equal(
            imageView.dom.querySelector('.caption[role="textbox"]'),
            caption
        );
        assert.equal(caption.getAttribute('contenteditable'), 'false');
        assert.equal(image.isConnected, true);
        assert.equal(writes.length, beforeImagePolicy);

        await render({ identity: imageIdentity, readOnly: false });
        assert.equal(ref.current, imageEditor);
        assert.equal(ref.current.view, imageView);
        assert.equal(imageView.editable, true);
        assert.equal(caption.getAttribute('contenteditable'), 'true');
        assert.equal(writes.length, beforeImagePolicy);
        await renderCommit(() => root.render(null));
        assert.equal(ref.current, null);
        assert.equal(imageView.isDestroyed, true);
        assert.equal(image.isConnected, false);
        assert.equal(caption.isConnected, false);
        assert.equal(container.querySelector('.ProseMirror'), null);
        assert.equal(
            window.document.querySelector('img[alt="Consumer image"]'),
            null
        );
        assert.equal(container.querySelector('.caption[role="textbox"]'), null);
        assert.equal(writes.length, beforeImagePolicy);

        stored = '**After image**';
        await render({ identity: 'record-after-image:rich' });
        assert(ref.current?.view);
        assert.equal(
            ref.current.view.dom.querySelector('strong')?.textContent,
            'After image'
        );
        const postImageView = ref.current.view;

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
        assert.equal(postImageView.isDestroyed, true);
        assert.equal(imageView.isDestroyed, true);
        assert.equal(image.isConnected, false);
        assert.equal(caption.isConnected, false);
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
            imageNodeView: true,
            imageReadOnlyTransition: true,
            imagePortalUnmount: true,
            callbackCleanupRetirement: true,
            ownerRetirement: true,
            unmount: true,
        };
    } finally {
        if (mounted) await renderCommit(() => root.unmount());
        container.remove();
    }
}

// Exercise the canonical function through ordinary props and DOM events. No ref,
// runtime slot, provider or synthetic replacement editor is supplied by this host.
async function exerciseCanonicalField({
    api,
    React,
    createRoot,
    renderCommit,
    window,
}) {
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container);
    const writes = [];
    const literal = '  **literal** <b>escaped</b>\r\n';
    const snapshot = {
        field: {
            fieldId: 'rich',
            title: 'Stored notes',
            fieldType: 'richText',
            isComputed: false,
            readOnly: false,
            schema: {
                fieldType: 'richText',
                miniExtConfig: {},
                airtableField: {
                    id: 'rich',
                    name: 'Stored notes',
                    description: null,
                    isComputed: false,
                    isPrimaryField: false,
                    config: { type: 'richText', options: null },
                },
            },
        },
        value: literal,
        dirty: false,
        revision: 0,
        visibility: { type: 'visible', diagnostics: [] },
        readOnly: false,
        canEdit: true,
        pending: false,
        error: null,
        validation: [],
        selection: null,
        retired: false,
    };
    let subscribers = 0;
    const binding = {
        getSnapshot: () => snapshot,
        subscribe() {
            subscribers++;
            return () => {
                subscribers--;
            };
        },
    };
    for (const name of ['setValue', 'scalar', 'selection', 'date', 'save'])
        Object.defineProperty(binding, name, {
            get() {
                throw Error(`Literal field cannot borrow ${name}`);
            },
        });
    let stored = '**Bold** and _italic_\n\n[ ] task';
    const input = () => container.querySelector('.ProseMirror[role="textbox"]');
    const render = async (overrides = {}) => {
        await renderCommit(() =>
            root.render(
                React.createElement(
                    'form',
                    {
                        id: 'canonical-form',
                        onSubmit: (event) => {
                            event.preventDefault();
                            throw Error('Editing must not submit');
                        },
                    },
                    React.createElement(
                        'label',
                        { id: 'canonical-label', htmlFor: 'canonical-notes' },
                        'Canonical notes'
                    ),
                    React.createElement(
                        'p',
                        { id: 'canonical-help' },
                        'Describe the request.'
                    ),
                    React.createElement(api.RichTextField, {
                        value: stored,
                        onValueChange(value) {
                            writes.push(value);
                            stored = value;
                        },
                        identity: 'canonical-one',
                        id: 'canonical-notes',
                        ariaLabelledBy: 'canonical-label',
                        ariaDescribedBy: 'canonical-help',
                        emptyContent: React.createElement(
                            'i',
                            null,
                            'No notes'
                        ),
                        ...overrides,
                    }),
                    React.createElement('input', {
                        name: 'sibling',
                        defaultValue: 'untouched',
                    })
                )
            )
        );
        const expectsEditor = !(
            overrides.readOnly &&
            Object.hasOwn(overrides, 'value') &&
            overrides.value === null
        );
        for (let turn = 0; expectsEditor && !input() && turn < 100; turn++)
            await renderCommit(tick);
    };
    const paste = async (target, text) => {
        const event = new window.Event('paste', {
            bubbles: true,
            cancelable: true,
        });
        Object.defineProperty(event, 'clipboardData', {
            value: {
                types: ['text/plain'],
                files: [],
                items: [],
                getData: (type) => (type === 'text/plain' ? text : ''),
            },
        });
        await renderCommit(() => target.dispatchEvent(event));
    };
    try {
        await renderCommit(() =>
            root.render(React.createElement(api.RichTextField, { binding }))
        );
        assert.equal(container.querySelector('output')?.textContent, literal);
        assert.equal(
            container.querySelector('strong,b,[contenteditable]'),
            null
        );
        assert.equal(subscribers, 1);
        await render();
        assert.equal(
            subscribers,
            0,
            'Controlled props retire the prior binding subscription'
        );
        const first = input();
        assert(first, 'Canonical RichTextField loads the actual editor');
        assert.equal(first.querySelector('strong')?.textContent, 'Bold');
        assert.equal(first.querySelector('em')?.textContent, 'italic');
        assert(first.querySelector('input[type="checkbox"]'));
        assert.equal(first.getAttribute('aria-labelledby'), 'canonical-label');
        assert.equal(first.getAttribute('aria-describedby'), 'canonical-help');
        assert.deepEqual(writes, []);
        await paste(first, 'Canonical paste ');
        assert.equal(writes.length, 1);
        assert.match(writes[0], /Canonical paste/);
        assert.match(writes[0], /\*\*[^*]*Bold\*\*/);
        assert.match(writes[0], /\[ \] task/);
        await render({
            id: 'canonical-updated',
            ariaDescribedBy: 'canonical-help error',
            ariaInvalid: true,
        });
        assert.equal(
            input(),
            first,
            'Echo and metadata retain the actual DOM editor'
        );
        assert.equal(first.getAttribute('id'), 'canonical-updated');
        assert.equal(first.getAttribute('aria-invalid'), 'true');
        assert.equal(
            container.querySelector('input[name="sibling"]').value,
            'untouched'
        );
        await render({ readOnly: true });
        assert.equal(input(), first);
        assert.equal(first.getAttribute('contenteditable'), 'false');
        const readonlyText = first.textContent;
        await paste(first, 'Refused');
        assert.equal(first.textContent, readonlyText);
        assert.equal(writes.length, 1);
        await render({ identity: 'canonical-two' });
        const successor = input();
        assert(successor);
        assert.notEqual(
            successor,
            first,
            'Equal-valued new owner replaces the editor'
        );
        assert.equal(first.isConnected, false);
        await paste(first, 'Late retired edit');
        assert.equal(writes.length, 1);
        await render({
            identity: 'canonical-two',
            value: null,
            readOnly: true,
        });
        assert.equal(input(), null);
        assert.equal(container.querySelector('i')?.textContent, 'No notes');
        await render({ identity: 'canonical-three', value: null });
        assert(input());
        assert.equal(input().textContent, '');
        await renderCommit(() =>
            root.render(React.createElement(api.RichTextField, { binding }))
        );
        assert.equal(subscribers, 1);
        assert.equal(container.querySelector('output')?.textContent, literal);
        assert.equal(input(), null);
        assert.equal(writes.length, 1);
        return {
            canonical: true,
            bindingCompatibility: true,
            modeReplacement: true,
            formatted: true,
            paste: true,
            readOnly: true,
            metadata: true,
            sibling: true,
            ownerRetirement: true,
            empty: true,
        };
    } finally {
        await renderCommit(() => root.unmount());
        assert.equal(subscribers, 0);
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
            const canonical = await exerciseCanonicalField({
                api,
                React,
                createRoot,
                renderCommit: (callback) =>
                    React.act(async () => {
                        await callback();
                    }),
                window,
            });
            receipts.push({ format, ...receipt, canonical });
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
                canonical: await exerciseCanonicalField({
                    api,
                    React,
                    createRoot,
                    window,
                    renderCommit: async (callback) => {
                        flushSync(() => callback());
                        await tick();
                    },
                }),
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
            const jsxName = 'canonical-rich-text.tsx';
            writeFileSync(
                join(directory, jsxName),
                `
import {RichTextField,type RichTextFieldProps} from '@miniextensions/sdk/react';
import type {FormFieldBinding} from '@miniextensions/sdk/forms';
declare const binding:FormFieldBinding;
export const Controlled=()=> <RichTextField value={null} onValueChange={value=>{const stored:string=value;void stored;}}/>;
export function Binding(props:RichTextFieldProps){return <RichTextField {...props} render={({snapshot})=><span>{String(snapshot.value)}</span>}/>;}
// @ts-expect-error JSX cannot mix binding and controlled contracts
export const Mixed=()=> <RichTextField binding={binding} value={null} onValueChange={()=>{}}/>;
// @ts-expect-error controlled JSX requires its writer
export const Incomplete=()=> <RichTextField value={null}/>;
`
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
                '--jsx',
                'react-jsx',
                jsxName,
            ]);
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
