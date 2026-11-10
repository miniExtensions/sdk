import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { Window } from 'happy-dom';
import { act, createElement as h, createRef, useState } from 'react';
import {
    CompleteRichTextEditor,
    type CompleteRichTextEditorProps,
} from '../src/react/CompleteRichTextEditor.js';
import type { NativeRichTextEditorHandle } from '../src/react/NativeRichTextEditor.js';
import {
    completeRichTextFixture,
    ControlledCompleteEditor,
} from './completeRichTextTestHarness.js';

for (const readOnly of [false, true]) {
    it(`renders real formatted Markdown and stored checkboxes in ${readOnly ? 'read-only' : 'editable'} mode`, async (t) => {
        const f = await completeRichTextFixture(t);
        const ref = createRef<NativeRichTextEditorHandle>();
        const writes: string[] = [];
        await f.render(
            h(ControlledCompleteEditor, {
                editorRef: ref,
                writes,
                readOnly,
                initial: '**Bold** and _emphasis_\n\n[x] Complete\n[ ] Pending',
            })
        );
        const { view } = await f.editor(ref);
        assert.equal(view.editable, !readOnly);
        assert.equal(
            view.dom.getAttribute('contenteditable'),
            String(!readOnly)
        );
        assert.equal(view.dom.querySelector('strong')?.textContent, 'Bold');
        assert.equal(view.dom.querySelector('em')?.textContent, 'emphasis');
        const checkboxes = view.dom.querySelectorAll<HTMLInputElement>(
            'input[type="checkbox"]'
        );
        assert.equal(checkboxes.length, 2);
        assert.equal(checkboxes[0]?.checked, true);
        assert.equal(checkboxes[1]?.checked, false);
        assert.deepEqual(writes, []);
        if (readOnly) {
            const before = view.state.doc.toJSON();
            await f.paste(view, { 'text/plain': '# A refused edit' });
            assert.deepEqual(view.state.doc.toJSON(), before);
            assert.deepEqual(writes, []);
        }
    });
}

it('keeps the actual empty editor and native caret through canonical controlled edits', async (t) => {
    const f = await completeRichTextFixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    await f.render(
        h(ControlledCompleteEditor, {
            editorRef: ref,
            writes,
            placeholder: 'Write details',
        })
    );
    const editor = await f.editor(ref);
    const { view } = editor;
    const input = view.dom;
    assert.equal(
        input
            .querySelector('[data-empty-text]')
            ?.getAttribute('data-empty-text'),
        'Write details'
    );
    await act(async () => {
        view.dispatch(view.state.tr.insertText('Alpha Beta', 1));
    });
    assert.deepEqual(writes, ['Alpha Beta']);
    await f.select(view, 3);
    await act(async () => {
        view.dispatch(view.state.tr.insertText('Z'));
    });
    assert.deepEqual(writes, ['Alpha Beta', 'AlZpha Beta']);
    assert.equal(view.state.doc.textContent, 'AlZpha Beta');
    assert.equal(view.state.selection.head, 4);
    assert.equal(ref.current, editor);
    assert.equal(f.container.querySelector('[role="textbox"]'), input);
});

it('routes real DOM Mod-b and Mod-B through the replacement owner to formatting and canonical writes', async (t) => {
    const f = await completeRichTextFixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    let replaceOwner: (() => void) | undefined;
    function OwnedEditor() {
        const [state, setState] = useState({
            value: 'Previous owner',
            identity: 'record-one',
        });
        replaceOwner = () =>
            setState({ value: 'Alpha word', identity: 'record-two' });
        return h(CompleteRichTextEditor, {
            ref,
            value: state.value,
            identity: state.identity,
            id: 'rich-editor-renamed',
            ariaInvalid: true,
            onValueChange: (value) => {
                writes.push(value);
                setState((previous) => ({ ...previous, value }));
            },
        });
    }
    await f.render(h(OwnedEditor));
    const previous = (await f.editor(ref)).view;
    const replace = replaceOwner;
    assert(replace);
    await act(async () => replace());
    const editor = await f.editor(ref);
    const { view } = editor;
    assert.notEqual(view, previous);
    assert.equal(previous.isDestroyed, true);
    assert.equal(view.dom.getAttribute('id'), 'rich-editor-renamed');
    assert.deepEqual(writes, []);

    // Match prosemirror-keymap's actual Mod normalization; the fixture does not
    // choose a platform or invoke the editor's formatting command directly.
    const mac = /Mac|iP(hone|[oa]d)/.test(f.window.navigator.platform);
    const press = async (key: 'b' | 'B') => {
        const keyboard = {
            key,
            code: 'KeyB',
            keyCode: 66,
            bubbles: true,
            cancelable: true,
            ctrlKey: !mac,
            metaKey: mac,
            altKey: false,
            shiftKey: false,
        };
        const down = new f.window.KeyboardEvent('keydown', keyboard);
        await act(async () => {
            view.dom.dispatchEvent(down as unknown as Event);
            view.dom.dispatchEvent(
                new f.window.KeyboardEvent(
                    'keyup',
                    keyboard
                ) as unknown as Event
            );
        });
        assert.equal(
            down.defaultPrevented,
            true,
            `${key}: Mod-b was not handled`
        );
    };
    const expectedWrites: string[] = [];
    for (const key of ['b', 'B'] as const) {
        await f.select(view, 1, 6);
        assert.equal(f.window.getSelection()?.toString(), 'Alpha');
        assert.equal(view.state.selection.from, 1);
        assert.equal(view.state.selection.to, 6);
        assert.equal(view.state.doc.textBetween(1, 6), 'Alpha');
        assert.equal(view.hasFocus(), true);
        assert.equal(view.composing, false);
        await press(key);
        expectedWrites.push('**Alpha** word');
        assert.equal(view.dom.querySelector('strong')?.textContent, 'Alpha');
        assert.deepEqual(writes, expectedWrites);
        assert.equal(ref.current, editor);
        assert.equal(editor.view, view);
        assert.equal(view.state.selection.from, 1);
        assert.equal(view.state.selection.to, 6);

        await press(key);
        expectedWrites.push('Alpha word');
        assert.equal(view.dom.querySelector('strong'), null);
        assert.deepEqual(writes, expectedWrites);
        assert.equal(ref.current, editor);
        assert.equal(editor.view, view);
    }
});

it('models native end movement before and after the real delayed focus reconciliation', async (t) => {
    const f = await completeRichTextFixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    await f.render(
        h(ControlledCompleteEditor, {
            editorRef: ref,
            writes,
            initial: '**Bold** and _italic_\n\n[ ] task',
        })
    );
    const editor = await f.editor(ref);
    const { view } = editor;
    const selection = f.document.getSelection();
    assert(selection);
    assert.equal(view.state.doc.lastChild?.isTextblock, true);
    const docEnd = view.state.doc.content.size - 1;
    const start = view.domAtPos(1);
    const end = view.domAtPos(docEnd);
    const initialDocument = view.state.doc.toJSON();
    const dispatchDescriptor = Object.getOwnPropertyDescriptor(
        f.document,
        'dispatchEvent'
    );
    const dispatchEvent = f.document.dispatchEvent;
    const deferredSelectionChanges: Event[] = [];
    let holdSelectionChanges = false;
    let intercepted = false;
    let timersEnabled = false;
    let focusListenerInstalled = false;
    let nativeFocusEvents = 0;
    const observeFocus = (event: Event) => {
        if (event.target === view.dom) nativeFocusEvents++;
    };
    const cleanup = () => {
        holdSelectionChanges = false;
        deferredSelectionChanges.length = 0;
        try {
            if (intercepted) {
                if (dispatchDescriptor)
                    Object.defineProperty(
                        f.document,
                        'dispatchEvent',
                        dispatchDescriptor
                    );
                else Reflect.deleteProperty(f.document, 'dispatchEvent');
                intercepted = false;
            }
        } finally {
            try {
                if (focusListenerInstalled) {
                    view.dom.removeEventListener('focus', observeFocus);
                    focusListenerInstalled = false;
                }
            } finally {
                if (timersEnabled) {
                    t.mock.timers.reset();
                    timersEnabled = false;
                }
            }
        }
    };
    // Register before intercepting anything. The fixture already owns restoration
    // of its window/global descriptors; finally below releases our changes first.
    t.after(cleanup);
    const nativePosition = () => {
        assert(selection.anchorNode);
        return view.posAtDOM(selection.anchorNode, selection.anchorOffset);
    };
    const releaseSelectionChanges = () => {
        holdSelectionChanges = false;
        for (const event of deferredSelectionChanges.splice(0))
            dispatchEvent.call(f.document, event);
    };
    try {
        // Seed the observed browser baseline without an editor transaction.
        selection.collapse(start.node, start.offset);
        assert.equal(nativePosition(), 1);
        assert.equal(view.state.selection.from, 1);
        assert.equal(view.hasFocus(), false);
        t.mock.timers.enable({ apis: ['setTimeout'] });
        timersEnabled = true;
        view.dom.addEventListener('focus', observeFocus);
        focusListenerInstalled = true;
        await act(async () => {
            // HTMLElement.focus is the actual DOM entry used by locator.focus;
            // EditorView.focus would reconcile the DOM selection itself.
            view.dom.focus();
        });
        assert.equal(nativeFocusEvents, 1);
        assert.equal(f.document.activeElement, view.dom);
        assert.equal(view.hasFocus(), true);

        // HappyDOM emits selectionchange synchronously. Delay that notification
        // only, modeling the browser event ordering under investigation. The PM
        // observer, focus handler, selectionToDOM and editor remain unmodified.
        Object.defineProperty(f.document, 'dispatchEvent', {
            configurable: true,
            writable: true,
            value: (event: Event) => {
                if (holdSelectionChanges && event.type === 'selectionchange') {
                    deferredSelectionChanges.push(event);
                    return true;
                }
                return dispatchEvent.call(f.document, event);
            },
        });
        intercepted = true;
        holdSelectionChanges = true;
        await act(async () => selection.collapse(end.node, end.offset));
        assert(deferredSelectionChanges.length > 0);
        assert.equal(nativePosition(), docEnd);
        assert.equal(view.state.selection.from, 1);
        // prosemirror-view 1.33.1 handlers.focus schedules this exact 20ms
        // reconciliation; neither the callback nor its selection policy is mocked.
        await act(async () => t.mock.timers.tick(19));
        assert.equal(nativePosition(), docEnd);
        assert.equal(view.state.selection.from, 1);
        await act(async () => t.mock.timers.tick(1));
        assert.equal(
            nativePosition(),
            1,
            'The actual PM 20ms focus callback must reproduce the early native move being restored'
        );
        assert.equal(view.state.selection.from, 1);
        assert.deepEqual(writes, []);
        await act(async () => releaseSelectionChanges());

        // One end move after the actual reconciliation may now be admitted by
        // the real selectionchange listener, with no synthetic PM command.
        holdSelectionChanges = true;
        await act(async () => selection.collapse(end.node, end.offset));
        assert.equal(nativePosition(), docEnd);
        assert.equal(view.state.selection.from, 1);
        await act(async () => releaseSelectionChanges());
        assert.equal(nativePosition(), docEnd);
        assert.equal(view.state.selection.from, docEnd);
        assert.equal(view.state.selection.to, docEnd);
        await act(async () => t.mock.timers.tick(20));
        assert.equal(nativePosition(), docEnd);
        assert.equal(view.state.selection.from, docEnd);
        assert.equal(view.state.selection.to, docEnd);
        assert.equal(ref.current, editor);
        assert.equal(editor.view, view);
        assert.deepEqual(view.state.doc.toJSON(), initialDocument);
        assert.deepEqual(writes, []);
    } finally {
        cleanup();
    }
});

it('serializes a real checkbox transaction to the canonical stored checkbox syntax', async (t) => {
    const f = await completeRichTextFixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    await f.render(
        h(ControlledCompleteEditor, {
            editorRef: ref,
            writes,
            initial: '[ ] Todo',
        })
    );
    const { view } = await f.editor(ref);
    let itemPosition: number | undefined;
    view.state.doc.descendants((node, position) => {
        if (node.type.name === 'checkbox_item') itemPosition = position;
    });
    assert(itemPosition !== undefined);
    const checkboxPosition = itemPosition;
    await act(async () => {
        view.dispatch(
            view.state.tr.setNodeMarkup(checkboxPosition, undefined, {
                checked: true,
            })
        );
    });
    // The native trailing paragraph is part of the stored snapshot.
    assert.deepEqual(writes, ['[x] Todo\n\n\n']);
    assert.equal(
        view.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')
            ?.checked,
        true
    );
    assert.equal(f.container.querySelectorAll('[role="textbox"]').length, 1);
});

it('updates and removes accessible metadata repeatedly without resetting the document or caret', async (t) => {
    const f = await completeRichTextFixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    const onValueChange = (value: string) => writes.push(value);
    const render = (metadata: Partial<CompleteRichTextEditorProps> = {}) =>
        f.render(
            h(
                'section',
                null,
                h('label', { id: 'notes-label', htmlFor: 'notes' }, 'Notes'),
                h('p', { id: 'notes-help' }, 'Describe the request.'),
                h('p', { id: 'notes-error' }, 'Add more detail.'),
                h(CompleteRichTextEditor, {
                    ref,
                    value: 'Alpha Beta',
                    onValueChange,
                    ...metadata,
                })
            )
        );
    await render({
        id: 'notes',
        ariaLabelledBy: 'notes-label',
        ariaDescribedBy: 'notes-help',
        ariaInvalid: false,
    });
    const editor = await f.editor(ref);
    const { view } = editor;
    const input = view.dom;
    await f.select(view, 3, 6);
    for (const metadata of [
        {
            id: 'revised-notes',
            ariaLabelledBy: 'notes-label',
            ariaDescribedBy: 'notes-error notes-help',
            ariaInvalid: true,
        },
        {},
        {
            id: 'notes',
            ariaLabelledBy: 'notes-label',
            ariaDescribedBy: 'notes-help',
            ariaInvalid: false,
            value: 'Alpha Beta\n\n',
        },
    ]) {
        await render(metadata);
        assert.equal(ref.current, editor);
        assert.equal(editor.view, view);
        assert.equal(view.dom, input);
        assert.equal(view.state.doc.textContent, 'Alpha Beta');
        assert.equal(view.state.selection.from, 3);
        assert.equal(view.state.selection.to, 6);
        assert.equal(input.getAttribute('id'), metadata.id ?? null);
        assert.equal(
            input.getAttribute('aria-labelledby'),
            metadata.ariaLabelledBy ?? null
        );
        assert.equal(
            input.getAttribute('aria-describedby'),
            metadata.ariaDescribedBy ?? null
        );
        assert.equal(
            input.getAttribute('aria-invalid'),
            metadata.ariaInvalid == null ? null : String(metadata.ariaInvalid)
        );
        assert.deepEqual(writes, []);
    }
    await act(async () => view.dispatch(view.state.tr.insertText('Z')));
    assert.deepEqual(writes, ['AlZ Beta']);
    assert.equal(view.state.selection.head, 4);
    assert.equal(ref.current, editor);
});

it('retires actual views on semantic value and identity changes without admitting late writes', async (t) => {
    const f = await completeRichTextFixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    const render = (value: string, identity = 'record-A') =>
        f.render(
            h(CompleteRichTextEditor, {
                ref,
                identity,
                value,
                onValueChange: (stored) => writes.push(stored),
                id: 'record-notes',
            })
        );
    await render('Original');
    const first = (await f.editor(ref)).view;
    const lateFirstEdit = first.state.tr.insertText('Late original', 1);
    await render('Replacement');
    const second = (await f.editor(ref)).view;
    assert.notEqual(second, first);
    assert.equal(first.isDestroyed, true);
    assert.equal(first.dom.isConnected, false);
    assert.equal(second.dom.getAttribute('id'), 'record-notes');
    const lateSecondEdit = second.state.tr.insertText('Late replacement', 1);
    await render('Original');
    const third = (await f.editor(ref)).view;
    assert.notEqual(third, first);
    assert.notEqual(third, second);
    assert.equal(second.isDestroyed, true);
    await act(async () => {
        first.dispatch(lateFirstEdit);
        second.dispatch(lateSecondEdit);
    });
    assert.equal(third.state.doc.textContent, 'Original');
    assert.deepEqual(writes, []);
    const lateThirdEdit = third.state.tr.insertText('Wrong record', 1);
    await render('Original', 'record-B');
    const current = (await f.editor(ref)).view;
    assert.notEqual(current, third);
    assert.equal(third.isDestroyed, true);
    await act(async () => third.dispatch(lateThirdEdit));
    assert.equal(current.state.doc.textContent, 'Original');
    assert.deepEqual(writes, []);
    await act(async () =>
        current.dispatch(current.state.tr.insertText('New ', 1))
    );
    assert.deepEqual(writes, ['New Original']);
});

it('uses caller-localized empty content only for read-only null and retires it on an empty editable document', async (t) => {
    const f = await completeRichTextFixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    const render = (value: string | null, readOnly: boolean) =>
        f.render(
            h(CompleteRichTextEditor, {
                ref,
                value,
                readOnly,
                onValueChange: (stored) => writes.push(stored),
                emptyContent: h('p', { lang: 'es' }, 'Sin valor'),
            })
        );
    await render(null, true);
    assert.equal(ref.current, null);
    assert.equal(
        f.container.querySelector('[lang="es"]')?.textContent,
        'Sin valor'
    );
    assert.equal(f.container.querySelector('[role="textbox"]'), null);
    await render('', true);
    const readOnlyView = (await f.editor(ref)).view;
    assert.equal(readOnlyView.editable, false);
    assert.equal(f.container.querySelector('[lang="es"]'), null);
    await render(null, true);
    assert.equal(readOnlyView.isDestroyed, true);
    await render(null, false);
    assert.equal((await f.editor(ref)).view.editable, true);
    assert.equal(f.container.querySelector('[lang="es"]'), null);
    assert.deepEqual(writes, []);
});

it('cleans real NodeView portals and editor roots across StrictMode mount, unmount and remount', async (t) => {
    const f = await completeRichTextFixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    const imageUrl = 'data:image/png;base64,AA==';
    const render = () =>
        f.render(
            h(ControlledCompleteEditor, {
                editorRef: ref,
                writes,
                initial: `![Draft diagram](${imageUrl})`,
            })
        );
    for (let cycle = 0; cycle < 2; cycle++) {
        await render();
        const { view } = await f.editor(ref);
        const image = view.dom.querySelector('img[alt="Draft diagram"]');
        assert(image, 'The actual image NodeView must render its React portal');
        assert.equal(image.getAttribute('src'), imageUrl);
        assert.equal(
            f.document.querySelectorAll('img[alt="Draft diagram"]').length,
            1
        );
        assert.equal(
            f.document.querySelectorAll('.ProseMirror[role="textbox"]').length,
            1
        );
        assert.equal(
            view.dom.querySelectorAll('.caption[role="textbox"]').length,
            1
        );
        assert.equal(
            view.dom.parentElement?.querySelectorAll('.ProseMirror').length,
            1
        );
        const lateEdit = view.state.tr.delete(0, view.state.doc.content.size);
        await f.render(null);
        assert.equal(ref.current, null);
        assert.equal(view.isDestroyed, true);
        assert.equal(image.isConnected, false);
        assert.equal(
            f.document.querySelector('img[alt="Draft diagram"]'),
            null
        );
        assert.equal(f.document.querySelector('[role="textbox"]'), null);
        assert.equal(f.document.querySelector('.me-rich-text'), null);
        await act(async () => view.dispatch(lateEdit));
        assert.deepEqual(writes, []);
    }
});

for (const code of [
    { name: 'indented code', initial: '    Alpha Beta', fence: false },
    { name: 'fenced code', initial: '```\nAlpha Beta\n```', fence: false },
    { name: 'code_fence', initial: 'Alpha Beta', fence: true },
]) {
    it(`pastes a selected URL literally in real ${code.name} before link handling`, async (t) => {
        const f = await completeRichTextFixture(t);
        const ref = createRef<NativeRichTextEditorHandle>();
        const writes: string[] = [];
        await f.render(
            h(ControlledCompleteEditor, {
                editorRef: ref,
                writes,
                initial: code.initial,
            })
        );
        const editor = await f.editor(ref);
        const { view } = editor;
        if (code.fence) {
            await act(async () => {
                view.dispatch(
                    view.state.tr.setBlockType(
                        0,
                        view.state.doc.content.size,
                        view.state.schema.nodes.code_fence,
                        { language: null }
                    )
                );
            });
        }
        const nodeType = code.fence ? 'code_fence' : 'code_block';
        assert.equal(view.state.doc.firstChild?.type.name, nodeType);
        await f.select(view, 7, 11);
        writes.length = 0;
        const url = 'https://example.com/path';
        const event = await f.paste(view, { 'text/plain': url });
        assert.equal(event.defaultPrevented, true);
        assert.equal(view.state.doc.textContent, 'Alpha ' + url);
        assert.equal(view.state.doc.firstChild?.type.name, nodeType);
        assert.equal(view.dom.querySelector('a'), null);
        assert.equal(view.state.selection.head, 7 + url.length);
        assert.deepEqual(writes, [
            '```\nAlpha https://example.com/path\n```\n\n\n',
        ]);
        assert.equal(ref.current, editor);
    });
}

for (const selected of [true, false]) {
    it(`keeps native paragraph URL behavior at a ${selected ? 'text selection' : 'caret'}`, async (t) => {
        const f = await completeRichTextFixture(t);
        const ref = createRef<NativeRichTextEditorHandle>();
        const writes: string[] = [];
        await f.render(
            h(ControlledCompleteEditor, {
                editorRef: ref,
                writes,
                initial: 'Alpha Beta',
            })
        );
        const { view } = await f.editor(ref);
        await f.select(view, 7, selected ? 11 : 7);
        const url = 'https://example.com/path';
        await f.paste(view, { 'text/plain': url });
        assert.equal(view.dom.querySelector('a')?.getAttribute('href'), url);
        assert.equal(
            view.dom.querySelector('a')?.textContent,
            selected ? 'Beta' : url
        );
        assert.equal(
            view.state.doc.textContent,
            selected ? 'Alpha Beta' : 'Alpha ' + url + 'Beta'
        );
        assert.deepEqual(writes, [
            selected
                ? 'Alpha [Beta](https://example.com/path)'
                : 'Alpha <https://example.com/path>Beta',
        ]);
    });
}

it('declines bold-only plain clipboard text and preserves the real native literal fallback', async (t) => {
    const f = await completeRichTextFixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    await f.render(
        h(ControlledCompleteEditor, {
            editorRef: ref,
            writes,
            initial: '',
        })
    );
    const editor = await f.editor(ref);
    const { view } = editor;
    await f.select(view, 1);
    // Import only after the real lazy runtime has mounted under this fixture's
    // browser globals, preserving the engine's platform and SSR initialization.
    const { generalPastePluginKey } = await import(
        '../src/react/completeRichTextPaste.js'
    );
    const plugin = generalPastePluginKey.get(view.state);
    assert(plugin, 'The actual General paste plugin must be installed');
    const handlePaste = plugin.props.handlePaste;
    assert(handlePaste);
    const text = '**Pasted strong**';
    const browserWindow: Window = f.window;
    const event = new browserWindow.Event('paste', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
        value: {
            types: ['text/plain'],
            files: [],
            items: [],
            getData: (type: string) => (type === 'text/plain' ? text : ''),
        },
    });
    await act(async () => {
        assert.equal(
            handlePaste.call(
                plugin,
                view,
                event as unknown as ClipboardEvent,
                view.state.doc.slice(0)
            ),
            false
        );
    });
    assert.equal(event.defaultPrevented, false);
    assert.equal(view.state.doc.textContent, '');
    assert.deepEqual(writes, []);

    // Run ProseMirror's public native paste path, including the same installed
    // handlers and its real plain-text parser, without a replacement engine.
    await act(async () => {
        assert.equal(
            view.pasteText(text, event as unknown as ClipboardEvent),
            true
        );
    });
    assert.equal(view.state.doc.textContent, text);
    assert.equal(view.dom.textContent, text);
    assert.equal(view.dom.querySelector('strong'), null);
    assert.equal(view.dom.querySelector('h1'), null);
    assert.deepEqual(writes, ['\\*\\*Pasted strong\\*\\*']);
    assert.equal(ref.current, editor);
});

it('parses recognized plain Markdown into actual heading and strong nodes with exact canonical output', async (t) => {
    const f = await completeRichTextFixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    await f.render(
        h(ControlledCompleteEditor, {
            editorRef: ref,
            writes,
            initial: '',
        })
    );
    const editor = await f.editor(ref);
    const { view } = editor;
    await f.select(view, 1);
    const markdown = '# Pasted heading\n\n**Pasted strong**';
    const event = await f.paste(view, { 'text/plain': markdown });
    assert.equal(event.defaultPrevented, true);
    assert.equal(view.state.doc.firstChild?.type.name, 'heading');
    assert.equal(
        view.dom.querySelector('h1 .heading-content')?.textContent,
        'Pasted heading'
    );
    assert.equal(
        view.dom.querySelector('strong')?.textContent,
        'Pasted strong'
    );
    assert.deepEqual(writes, [markdown]);
    assert.equal(ref.current, editor);
});

it('leaves native HTML clipboard parsing intact while explicit VSCode Markdown overrides ordinary HTML', async (t) => {
    const f = await completeRichTextFixture(t);
    const refs = [
        createRef<NativeRichTextEditorHandle>(),
        createRef<NativeRichTextEditorHandle>(),
    ];
    const writes = [[], []] as [string[], string[]];
    await f.render(
        h(
            'section',
            null,
            ...refs.map((editorRef, index) =>
                h(ControlledCompleteEditor, {
                    key: index,
                    editorRef,
                    writes: writes[index]!,
                    initial: '',
                })
            )
        )
    );
    const htmlView = (await f.editor(refs[0]!)).view;
    const markdownView = (await f.editor(refs[1]!)).view;
    await f.select(htmlView, 1);
    await f.paste(htmlView, {
        'text/plain': '# Markdown alternative',
        'text/html': '<p><strong>Rich clipboard</strong></p>',
        'vscode-editor-data': '{invalid JSON',
    });
    assert.equal(
        htmlView.dom.querySelector('strong')?.textContent,
        'Rich clipboard'
    );
    assert.equal(htmlView.dom.querySelector('h1'), null);
    assert.deepEqual(writes[0], ['**Rich clipboard**']);
    await f.select(markdownView, 1);
    await f.paste(markdownView, {
        'text/plain': '# Markdown alternative',
        'text/html': '<p>Rich clipboard</p>',
        'vscode-editor-data': JSON.stringify({ mode: 'markdown' }),
    });
    assert.equal(
        markdownView.dom.querySelector('h1 .heading-content')?.textContent,
        'Markdown alternative'
    );
    assert.deepEqual(writes[1], ['# Markdown alternative']);
});

it('keeps independently mounted editors and their paste extensions isolated through metadata changes', async (t) => {
    const f = await completeRichTextFixture(t);
    const firstRef = createRef<NativeRichTextEditorHandle>();
    const secondRef = createRef<NativeRichTextEditorHandle>();
    const firstWrites: string[] = [];
    const secondWrites: string[] = [];
    const render = (description?: string) =>
        f.render(
            h(
                'section',
                null,
                h('p', { id: 'first-help' }, 'First editor help'),
                h(ControlledCompleteEditor, {
                    editorRef: firstRef,
                    writes: firstWrites,
                    initial: 'Alpha Beta',
                    id: 'first-editor',
                    ariaDescribedBy: description,
                }),
                h(ControlledCompleteEditor, {
                    editorRef: secondRef,
                    writes: secondWrites,
                    initial: 'Gamma Delta',
                    id: 'second-editor',
                })
            )
        );
    await render();
    const first = await f.editor(firstRef);
    const second = await f.editor(secondRef);
    assert.notEqual(first, second);
    assert.notEqual(first.view, second.view);
    await f.select(first.view, 7, 11);
    await render('first-help');
    await render();
    await render('first-help');
    assert.equal(firstRef.current, first);
    assert.equal(secondRef.current, second);
    assert.equal(first.view.state.selection.from, 7);
    assert.equal(first.view.state.selection.to, 11);
    await f.paste(first.view, {
        'text/plain': 'https://first.synthetic.invalid/',
    });
    assert.equal(
        first.view.state.doc.rangeHasMark(
            0,
            first.view.state.doc.content.size,
            first.view.state.schema.marks.link
        ),
        true
    );
    assert.equal(first.view.dom.querySelector('a')?.textContent, 'Beta');
    assert.deepEqual(firstWrites, [
        'Alpha [Beta](https://first.synthetic.invalid/)',
    ]);
    assert.deepEqual(secondWrites, []);
    assert.equal(second.view.state.doc.textContent, 'Gamma Delta');
    assert.equal(second.view.dom.querySelector('a'), null);
    await f.select(second.view, 7, 12);
    await f.paste(second.view, {
        'text/plain': 'https://second.synthetic.invalid/',
    });
    assert.equal(
        second.view.state.doc.rangeHasMark(
            0,
            second.view.state.doc.content.size,
            second.view.state.schema.marks.link
        ),
        true
    );
    assert.deepEqual(secondWrites, [
        'Gamma [Delta](https://second.synthetic.invalid/)',
    ]);
    assert.equal(
        first.view.dom.querySelector('a')?.getAttribute('href'),
        'https://first.synthetic.invalid/'
    );
});

it('applies current read-only policy to the same selected code editor after metadata changes', async (t) => {
    const f = await completeRichTextFixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    const render = (readOnly: boolean) =>
        f.render(
            h(CompleteRichTextEditor, {
                ref,
                value: '```\nAlpha Beta\n```',
                onValueChange: (stored) => writes.push(stored),
                readOnly,
                id: readOnly ? 'locked-notes' : 'editable-notes',
                ariaInvalid: readOnly,
            })
        );
    await render(false);
    const editor = await f.editor(ref);
    const { view } = editor;
    await f.select(view, 7, 11);
    await render(true);
    assert.equal(ref.current, editor);
    assert.equal(editor.view, view);
    assert.equal(view.editable, false);
    assert.equal(view.dom.getAttribute('id'), 'locked-notes');
    assert.equal(view.dom.getAttribute('aria-invalid'), 'true');
    const before = view.state.doc.toJSON();
    await f.paste(view, { 'text/plain': 'https://example.com/path' });
    assert.deepEqual(view.state.doc.toJSON(), before);
    assert.deepEqual(writes, []);
});

for (const sliceMarker of ['html', 'mime']) {
    it(`preserves native ProseMirror ${sliceMarker} slices even with explicit VSCode Markdown metadata`, async (t) => {
        const f = await completeRichTextFixture(t);
        const ref = createRef<NativeRichTextEditorHandle>();
        const writes: string[] = [];
        await f.render(
            h(ControlledCompleteEditor, {
                editorRef: ref,
                writes,
                initial: '',
            })
        );
        const { view } = await f.editor(ref);
        await f.select(view, 1);
        await f.paste(
            view,
            {
                'text/plain': '# Competing Markdown',
                'text/html':
                    sliceMarker === 'html'
                        ? '<p data-pm-slice="0 0 []"><strong>Native slice</strong></p>'
                        : '<p><strong>Native slice</strong></p>',
                'vscode-editor-data': JSON.stringify({ mode: 'markdown' }),
            },
            sliceMarker === 'mime' ? ['application/x-prosemirror-slice'] : []
        );
        assert.equal(
            view.dom.querySelector('strong')?.textContent,
            'Native slice'
        );
        assert.equal(view.dom.querySelector('h1'), null);
        assert.equal(view.state.doc.textContent, 'Native slice');
        assert.deepEqual(writes, ['**Native slice**']);
    });
}

for (const language of ['javascript', '__proto__']) {
    it(`pastes VSCode ${language} as an actual code fence without interpreting Markdown`, async (t) => {
        const f = await completeRichTextFixture(t);
        const ref = createRef<NativeRichTextEditorHandle>();
        const writes: string[] = [];
        await f.render(
            h(ControlledCompleteEditor, {
                editorRef: ref,
                writes,
                initial: '',
            })
        );
        const { view } = await f.editor(ref);
        await f.select(view, 1);
        const text = '**literal code**';
        await f.paste(view, {
            'text/plain': text,
            'vscode-editor-data': JSON.stringify({ mode: language }),
        });
        assert.equal(view.state.doc.firstChild?.type.name, 'code_fence');
        assert.equal(
            view.state.doc.firstChild?.attrs.language,
            language === 'javascript' ? language : null
        );
        assert.equal(view.state.doc.textContent, text);
        assert.equal(view.dom.querySelector('strong'), null);
        assert.equal(writes.length, 1);
        assert.equal(
            writes[0],
            '```' +
                (language === 'javascript' ? language : '') +
                '\n**literal code**\n```\n\n\n'
        );
    });
}

it('normalizes bare stored checkbox syntax only through the real Markdown paste path', async (t) => {
    const f = await completeRichTextFixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    await f.render(
        h(ControlledCompleteEditor, {
            editorRef: ref,
            writes,
            initial: '',
        })
    );
    const { view } = await f.editor(ref);
    await f.select(view, 1);
    const event = await f.paste(view, {
        'text/plain': '[x] Complete\n[ ] Pending',
        'vscode-editor-data': JSON.stringify({ mode: 'markdown' }),
    });
    assert.equal(event.defaultPrevented, true);
    const checkboxes = view.dom.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]'
    );
    assert.equal(checkboxes.length, 2);
    assert.equal(checkboxes[0]?.checked, true);
    assert.equal(checkboxes[1]?.checked, false);
    assert.deepEqual(writes, ['[x] Complete\n[ ] Pending\n\n\n']);
});

it('refuses a captured paste handler after its document owner retires', async (t) => {
    const f = await completeRichTextFixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    const render = (identity: string) =>
        f.render(
            h(CompleteRichTextEditor, {
                ref,
                value: 'Original',
                identity,
                onValueChange: (value) => writes.push(value),
            })
        );
    await render('first');
    const old = (await f.editor(ref)).view;
    const browserWindow: Window = f.window;
    const event = new browserWindow.Event('paste', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
        value: {
            types: ['text/plain'],
            getData: () => 'https://stale.synthetic.invalid/',
        },
    });
    let paste: (() => boolean | void) | undefined;
    old.someProp('handlePaste', (handler) => {
        paste = () =>
            handler(
                old,
                event as unknown as ClipboardEvent,
                old.state.doc.slice(0)
            );
        return true;
    });
    assert(paste, 'Capture the actual installed paste handler');
    await render('second');
    const current = (await f.editor(ref)).view;
    assert.equal(old.isDestroyed, true);
    await act(async () => {
        assert.equal(paste!(), false);
    });
    assert.equal(current.state.doc.textContent, 'Original');
    assert.deepEqual(writes, []);
});

it('keeps a selected inline-code URL literal through the vendor code-mark query', async (t) => {
    const f = await completeRichTextFixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    await f.render(
        h(ControlledCompleteEditor, {
            editorRef: ref,
            writes,
            initial: 'Alpha `Beta`',
        })
    );
    const editor = await f.editor(ref);
    const { view } = editor;
    await f.select(view, 7, 11);
    const event = await f.paste(view, {
        'text/plain': 'https://example.com/path',
    });
    assert.equal(event.defaultPrevented, true);
    assert.equal(view.state.doc.textContent, 'Alpha https://example.com/path');
    assert.equal(
        view.dom.querySelector('code')?.textContent,
        'https://example.com/path'
    );
    assert.equal(view.dom.querySelector('a'), null);
    assert.deepEqual(writes, ['Alpha `https://example.com/path`']);
    assert.equal(ref.current, editor);
});
