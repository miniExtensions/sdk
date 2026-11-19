import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    PortalGridPhoneNumberCell,
    type PortalGridPhoneNumberCellProps,
} from '../src/react/PortalGridPhoneNumberCell.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const saved = '+14155552671';

function grid(overrides: Partial<PortalGridPhoneNumberCellProps> = {}) {
    return h(
        'table',
        null,
        h(
            'tbody',
            null,
            h(
                'tr',
                null,
                h(PortalGridPhoneNumberCell, {
                    value: saved,
                    displayText: saved,
                    title: 'Contact phone',
                    cellIdentity: 'phone-A',
                    selected: false,
                    onSelect() {},
                    rowHeight: 'medium',
                    ...overrides,
                })
            )
        )
    );
}

it('server-renders a literal telephone link or a blank Grid cell', () => {
    const html = renderToString(grid());
    assert.match(html, /href="tel:\+14155552671"/);
    assert.match(html, /class="[^"]*\bread-only-text\b[^"]*"/);
    assert.doesNotMatch(html, /<input/);
    assert.match(
        renderToString(grid({ value: null, displayText: '' })),
        /class="read-only-text"><\/span>/
    );
});

it('passes plain drafts, composing Enter and literal empty clear through the admitted editor', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: Array<[string | undefined, string]> = [];
    const editor: NonNullable<PortalGridPhoneNumberCellProps['editor']> = {
        owner: { token: {}, isCurrent: () => true },
        onValueChange: (value, commit) => writes.push([value, commit.reason]),
        input: { form: 'html-presentation-owner' },
    };
    await fixture.render(grid({ selected: true, editor }));
    const input = fixture.container.querySelector('input');
    assert.ok(input instanceof fixture.window.HTMLInputElement);
    assert.equal(input.getAttribute('aria-label'), 'Contact phone');
    assert.equal(input.getAttribute('form'), 'html-presentation-owner');
    const setter = Object.getOwnPropertyDescriptor(
        fixture.window.HTMLInputElement.prototype,
        'value'
    )?.set;
    assert.ok(setter);
    await act(async () => {
        input.focus();
        setter.call(input, '0123 ext. 4');
        input.dispatchEvent(
            new fixture.window.Event('input', { bubbles: true })
        );
        input.dispatchEvent(
            new fixture.window.KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                isComposing: true,
            })
        );
    });
    assert.equal(input.value, '0123 ext. 4');
    assert.equal(fixture.window.document.activeElement, input);
    assert.deepEqual(writes, []);
    await act(async () => input.blur());
    assert.deepEqual(writes, [['0123 ext. 4', 'blur']]);

    await fixture.render(
        grid({
            value: '0123 ext. 4',
            displayText: '0123 ext. 4',
            selected: true,
            editor,
        })
    );
    const current = fixture.container.querySelector('input');
    assert.ok(current instanceof fixture.window.HTMLInputElement);
    await act(async () => {
        current.focus();
        setter.call(current, '');
        current.dispatchEvent(
            new fixture.window.Event('input', { bubbles: true })
        );
    });
    assert.deepEqual(writes, [['0123 ext. 4', 'blur']]);
    await act(async () => current.blur());
    assert.deepEqual(writes, [
        ['0123 ext. 4', 'blur'],
        ['', 'blur'],
    ]);
});
