import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { Window } from 'happy-dom';
import { act, createElement as h, useState } from 'react';
import { CompleteRichTextEditor } from '../src/react/CompleteRichTextEditor.js';
import type { NativeRichTextEditorHandle } from '../src/react/NativeRichTextEditor.js';
import { completeRichTextFixture } from './completeRichTextTestHarness.js';

function clipboardPaste(window: Window, text: string) {
    const event = new window.Event('paste', {
        bubbles: true,
        cancelable: true,
    });
    Object.defineProperty(event, 'clipboardData', {
        value: {
            types: ['text/plain'],
            files: [],
            items: [],
            getData: (type: string) => (type === 'text/plain' ? text : ''),
        },
    });
    return event as unknown as Event;
}

it('releases each callback-ref lease once while real image portals follow read-only, null and unmount ownership', async (t) => {
    const f = await completeRichTextFixture(t);
    const current = { current: null as NativeRichTextEditorHandle | null };
    const leases: {
        instance: NativeRichTextEditorHandle;
        released: number;
    }[] = [];
    const nullCalls: null[] = [];
    const writes: string[] = [];
    const callbackRef = (instance: NativeRichTextEditorHandle | null) => {
        if (instance === null) {
            nullCalls.push(null);
            return;
        }
        assert.equal(
            current.current,
            null,
            'Previous ref ownership must retire'
        );
        current.current = instance;
        const lease = { instance, released: 0 };
        leases.push(lease);
        return () => {
            lease.released++;
            assert.equal(lease.released, 1, 'A callback lease cleans up once');
            assert.equal(current.current, instance);
            current.current = null;
        };
    };
    const imageValue = '![Owned image](data:image/png;base64,AA==)';
    const render = (
        value: string | null,
        readOnly: boolean,
        metadata: {
            id?: string;
            ariaDescribedBy?: string;
            ariaInvalid?: boolean;
        } = {}
    ) =>
        f.render(
            h(CompleteRichTextEditor, {
                value,
                readOnly,
                ref: callbackRef,
                onValueChange: (stored) => writes.push(stored),
                placeholder: 'Write a note',
                emptyContent: h('p', { lang: 'es' }, 'Sin notas'),
                ...metadata,
            })
        );
    await render(imageValue, false, { id: 'editable-notes' });
    const editor = await f.editor(current);
    const view = editor.view;
    const image = view.dom.querySelector('img[alt="Owned image"]');
    assert(image, 'Expected the real React image NodeView portal');
    assert.equal(
        view.dom.querySelector('.caption')?.getAttribute('contenteditable'),
        'true'
    );
    const liveLeaseCount = leases.length;
    assert(liveLeaseCount > 0);
    assert.equal(leases.filter((lease) => lease.released === 0).length, 1);
    const lateImageEdit = view.state.tr.delete(0, view.state.doc.content.size);

    await render(imageValue, true, {
        id: 'locked-notes',
        ariaDescribedBy: 'notes-help',
        ariaInvalid: true,
    });
    assert.equal(current.current, editor);
    assert.equal(editor.view, view);
    assert.equal(leases.length, liveLeaseCount);
    assert.equal(view.editable, false);
    assert.equal(view.dom.getAttribute('id'), 'locked-notes');
    assert.equal(view.dom.getAttribute('aria-describedby'), 'notes-help');
    assert.equal(view.dom.getAttribute('aria-invalid'), 'true');
    assert.equal(
        view.dom.querySelector('.caption')?.getAttribute('contenteditable'),
        'false'
    );
    assert.equal(image.isConnected, true);

    await render(imageValue, false);
    assert.equal(current.current, editor);
    assert.equal(editor.view, view);
    assert.equal(leases.length, liveLeaseCount);
    assert.equal(view.editable, true);
    assert.equal(view.dom.getAttribute('id'), null);
    assert.equal(view.dom.getAttribute('aria-describedby'), null);
    assert.equal(view.dom.getAttribute('aria-invalid'), null);
    assert.equal(
        view.dom.querySelector('.caption')?.getAttribute('contenteditable'),
        'true'
    );

    await render(null, true, { id: 'empty-notes', ariaInvalid: true });
    assert.equal(current.current, null);
    assert.equal(view.isDestroyed, true);
    assert.equal(image.isConnected, false);
    assert.equal(f.container.querySelector('.caption'), null);
    assert.equal(f.container.querySelector('[role="textbox"]'), null);
    assert.equal(
        f.container.querySelector('[lang="es"]')?.textContent,
        'Sin notas'
    );
    assert(leases.every((lease) => lease.released === 1));
    const retiredLeaseCount = leases.length;
    await render(null, true, { ariaDescribedBy: 'empty-help' });
    assert.equal(leases.length, retiredLeaseCount);
    assert.equal(current.current, null);
    assert.equal(f.container.querySelector('[role="textbox"]'), null);

    await render(null, false, { id: 'fresh-notes' });
    const replacement = await f.editor(current);
    const replacementView = replacement.view;
    assert.notEqual(replacement, editor);
    assert.notEqual(replacementView, view);
    assert.equal(replacementView.editable, true);
    assert.equal(replacementView.state.doc.textContent, '');
    assert.equal(replacementView.dom.getAttribute('id'), 'fresh-notes');
    assert.equal(f.container.querySelector('[lang="es"]'), null);
    assert.equal(leases.filter((lease) => lease.released === 0).length, 1);
    const lateReplacementEdit = replacementView.state.tr.insertText('Late');
    await f.render(null);
    assert.equal(current.current, null);
    assert.equal(replacementView.isDestroyed, true);
    assert(leases.every((lease) => lease.released === 1));
    assert.deepEqual(nullCalls, []);
    assert.equal(f.document.querySelector('[role="textbox"]'), null);
    assert.equal(f.document.querySelector('.me-rich-text'), null);
    await act(async () => {
        view.dispatch(lateImageEdit);
        replacementView.dispatch(lateReplacementEdit);
    });
    assert.deepEqual(writes, []);
});

it('supports normal controlled use without a ref through paste, read-only metadata updates and unmount', async (t) => {
    const f = await completeRichTextFixture(t);
    const writes: string[] = [];
    function NoRefEditor({ readOnly }: { readOnly: boolean }) {
        const [value, setValue] = useState<string | null>('Alpha');
        return h(CompleteRichTextEditor, {
            value,
            readOnly,
            id: readOnly ? 'locked-note' : 'editable-note',
            ariaDescribedBy: readOnly ? 'locked-help' : undefined,
            ariaInvalid: readOnly || undefined,
            onValueChange: (stored) => {
                writes.push(stored);
                setValue(stored);
            },
        });
    }
    await f.render(h(NoRefEditor, { readOnly: false }));
    const input = f.container.querySelector<HTMLElement>(
        '.ProseMirror[role="textbox"]'
    );
    assert(input);
    assert.equal(input.textContent, 'Alpha');
    assert.equal(input.getAttribute('contenteditable'), 'true');
    assert.equal(input.getAttribute('id'), 'editable-note');
    await act(async () => {
        input.dispatchEvent(clipboardPaste(f.window, 'Additional '));
    });
    assert.equal(writes.length, 1);
    assert.match(input.textContent ?? '', /Additional/);
    const acceptedText = input.textContent;

    await f.render(h(NoRefEditor, { readOnly: true }));
    assert.equal(
        f.container.querySelector('.ProseMirror[role="textbox"]'),
        input
    );
    assert.equal(input.getAttribute('contenteditable'), 'false');
    assert.equal(input.getAttribute('id'), 'locked-note');
    assert.equal(input.getAttribute('aria-describedby'), 'locked-help');
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    await act(async () => {
        input.dispatchEvent(clipboardPaste(f.window, 'Refused'));
    });
    assert.equal(input.textContent, acceptedText);
    assert.equal(writes.length, 1);

    await f.render(h(NoRefEditor, { readOnly: false }));
    assert.equal(
        f.container.querySelector('.ProseMirror[role="textbox"]'),
        input
    );
    assert.equal(input.getAttribute('contenteditable'), 'true');
    assert.equal(input.getAttribute('id'), 'editable-note');
    assert.equal(input.getAttribute('aria-describedby'), null);
    assert.equal(input.getAttribute('aria-invalid'), null);
    assert.equal(input.textContent, acceptedText);
    await f.render(null);
    assert.equal(input.isConnected, false);
    assert.equal(f.document.querySelector('.me-rich-text'), null);
    assert.equal(writes.length, 1);
});
