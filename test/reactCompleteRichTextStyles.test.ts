import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import type { Window } from 'happy-dom';
import { createElement as h, createRef } from 'react';
import { CompleteRichTextEditor } from '../src/react/CompleteRichTextEditor.js';
import type { NativeRichTextEditorHandle } from '../src/react/NativeRichTextEditor.js';
import { completeRichTextFixture } from './completeRichTextTestHarness.js';

it('keeps SDK field styles authoritative when the real engine injects its styles later', async (t) => {
    const f = await completeRichTextFixture(t);
    const browserWindow: Window = f.window;
    const stylesheet = browserWindow.document.createElement('style');
    stylesheet.textContent = readFileSync('src/react/rich-text.css', 'utf8');
    browserWindow.document.head.append(stylesheet);
    const ref = createRef<NativeRichTextEditorHandle>();
    await f.render(
        h(CompleteRichTextEditor, {
            ref,
            value: '# Heading\n\n[x] Done',
            readOnly: true,
            onValueChange: () =>
                assert.fail('Style setup must not propose a write'),
        })
    );
    const { view } = await f.editor(ref);
    const actions = view.dom.querySelector('.heading-actions');
    const checkbox = view.dom.querySelector('input[type="checkbox"]');
    const editor = f.document.querySelector('.me-rich-text-editor');
    const stylingWindow = f.document.defaultView;
    assert(actions && checkbox && editor && stylingWindow);
    assert.equal(stylingWindow.getComputedStyle(actions).display, 'none');
    assert.match(
        stylingWindow.getComputedStyle(checkbox).marginLeft,
        /^0(?:px)?$/
    );
    assert.equal(stylingWindow.getComputedStyle(editor).maxHeight, '640px');
});
