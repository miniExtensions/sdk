import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { createElement as h, createRef } from 'react';
import { CompleteQuillHTMLRenderer } from '../src/react/html/index.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

/* Native QuillHTMLRenderer blob8e364663d7f976d30d5b79d8731fc7d2b0eb08dc.
 * Assertions preserve WYSIWYG HTML and the native post-render link effect;
 * this is not a Markdown editor or a trusted browser navigation certificate. */
it('keeps native Markdown-like text literal under the WYSIWYG HTML contract', async (t) => {
    const dom = await htmlPresentationFixture(t);
    assert.ok(dom.window instanceof Window);
    const literal = '**Important** [Help](https://example.com/help)';
    await dom.render(h(CompleteQuillHTMLRenderer, { html: literal }));
    assert.equal(dom.container.textContent, literal);
    assert.equal(dom.container.querySelector('strong,a'), null);
});

it('isolates every native persisted link on initial render and rerender', async (t) => {
    const dom = await htmlPresentationFixture(t);
    await dom.render(
        h(CompleteQuillHTMLRenderer, {
            html: '<a href="https://example.com/first" target="_self" rel="opener">First</a>',
        })
    );
    const first = dom.container.querySelector('a');
    assert.ok(first);
    assert.equal(first.target, '_blank');
    assert.equal(first.rel, 'noopener noreferrer');
    await dom.render(
        h(CompleteQuillHTMLRenderer, {
            html: '<a href="https://example.com/second" target="named-window">Second</a>',
        })
    );
    const second = dom.container.querySelector('a');
    assert.ok(second);
    assert.equal(second.textContent, 'Second');
    assert.equal(second.target, '_blank');
    assert.equal(second.rel, 'noopener noreferrer');
});

it('forwards the actual sanitized editor div and retains Quill class placement', async (t) => {
    const dom = await htmlPresentationFixture(t);
    const first = createRef<HTMLDivElement>();
    const second = createRef<HTMLDivElement>();
    await dom.render(
        h(CompleteQuillHTMLRenderer, {
            html: '<h2>Styled HTML</h2><script>not retained</script>',
            className: 'consumer-description',
            ref: first,
        })
    );
    const wrapper = dom.container.firstElementChild;
    assert.ok(wrapper);
    assert.ok(wrapper.classList.contains('quill'));
    const container = wrapper.firstElementChild;
    assert.ok(container instanceof dom.window.HTMLDivElement);
    for (const token of [
        'ql-container',
        'ql-snow',
        'ql-disabled',
        '!border-none',
    ]) {
        assert.ok(container.classList.contains(token));
    }
    assert.equal(container.style.fontFamily, 'inherit');
    const editor = container.firstElementChild;
    assert.ok(editor instanceof dom.window.HTMLDivElement);
    assert.equal(first.current, editor);
    for (const token of ['ql-editor', '!p-0', 'consumer-description']) {
        assert.ok(editor.classList.contains(token));
    }
    assert.equal(editor.className.includes('[&_h2]:text-xl'), false);
    assert.equal(editor.style.contain, 'paint');
    assert.equal(editor.querySelector('script'), null);
    await dom.render(
        h(CompleteQuillHTMLRenderer, {
            html: '<p>Replacement HTML</p>',
            className: 'next-description',
            ref: second,
        })
    );
    assert.equal(first.current, null);
    assert.equal(second.current, editor);
    assert.equal(editor.textContent, 'Replacement HTML');
    assert.ok(editor.classList.contains('next-description'));
    assert.equal(editor.classList.contains('consumer-description'), false);
    await dom.render(null);
    assert.equal(second.current, null);
});

it('keeps isolated links across presentation-only rerenders and sanitizes changed content', async (t) => {
    const dom = await htmlPresentationFixture(t);
    const html =
        '<p><a href="#owned" target="_self" rel="opener">Owned</a></p>';
    const ref = createRef<HTMLDivElement>();
    await dom.render(
        h(CompleteQuillHTMLRenderer, { html, className: 'first', ref })
    );
    const editor = ref.current;
    assert.ok(editor);
    const link = editor.querySelector('a');
    assert.ok(link);
    await dom.render(
        h(CompleteQuillHTMLRenderer, { html, className: 'second', ref })
    );
    assert.equal(ref.current, editor);
    assert.equal(editor.querySelector('a'), link);
    assert.ok(editor.classList.contains('second'));
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
    // Equivalent raw attribute quoting has the same sanitized string, matching
    // the native React 18 update boundary while still processing new raw HTML.
    await dom.render(
        h(CompleteQuillHTMLRenderer, {
            html: html.replaceAll('"', "'"),
            className: 'second',
            ref,
        })
    );
    assert.equal(editor.querySelector('a'), link);
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
    await dom.render(
        h(CompleteQuillHTMLRenderer, {
            html: '<p><a href="#replacement">Replacement</a></p>',
            className: 'second',
            ref,
        })
    );
    const replacement = editor.querySelector('a');
    assert.ok(replacement);
    assert.notEqual(replacement, link);
    assert.equal(replacement.textContent, 'Replacement');
    assert.equal(replacement.target, '_blank');
    assert.equal(replacement.rel, 'noopener noreferrer');
    dom.unchangedEffects();
});
