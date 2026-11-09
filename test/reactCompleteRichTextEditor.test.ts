import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { Window } from 'happy-dom';
import { act, createElement as h, createRef } from 'react';
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
