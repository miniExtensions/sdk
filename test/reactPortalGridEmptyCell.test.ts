import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h, type ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { PortalGridEmptyCell } from '../src/react/PortalGridEmptyCell.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

type Props = ComponentProps<typeof PortalGridEmptyCell>;
type Fixture = Awaited<ReturnType<typeof htmlPresentationFixture>>;

function table(props: Props) {
    return h(
        'table',
        null,
        h(
            'thead',
            null,
            h(
                'tr',
                null,
                h('th', { scope: 'col' }, 'Name'),
                h('th', { scope: 'col' }, 'Missing value'),
                h('th', { scope: 'col' }, 'Status')
            )
        ),
        h(
            'tbody',
            null,
            h(
                'tr',
                null,
                h('td', null, 'Original record'),
                h(PortalGridEmptyCell, props),
                h('td', null, 'Unchanged status')
            )
        )
    );
}

function cell(fixture: Fixture) {
    const node = fixture.container.querySelector(
        '.mx-sdk-portal-grid-empty-cell'
    );
    assert.ok(node instanceof fixture.window.HTMLTableCellElement);
    return node;
}

it('server-renders a blank semantic table cell without shifting adjacent values', () => {
    const markup = renderToString(table({ rowHeight: 'medium' }));
    assert.match(
        markup,
        /<th scope="col">Name<\/th><th scope="col">Missing value<\/th><th scope="col">Status<\/th>/
    );
    assert.match(
        markup,
        /<td>Original record<\/td><td[^>]*class="mx-sdk-portal-grid-empty-cell"[^>]*><div[^>]*class="mx-sdk-portal-grid-empty-cell__content"[^>]*><\/div><\/td><td>Unchanged status<\/td>/
    );
    assert.equal((markup.match(/<td(?:\s|>)/g) ?? []).length, 3);
    assert.doesNotMatch(
        markup,
        /tabindex=|role=|aria-|contenteditable=|<button|<input|<textarea|<select|<a(?:\s|>)/
    );
});

it('projects every row height and exact absent, zero and positive sticky offsets', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const heights: Props['rowHeight'][] = [
        'short',
        'medium',
        'tall',
        'extra-tall',
        'fit-content',
    ];
    for (const rowHeight of heights) {
        for (const stickyLeft of [undefined, 0, 37.5]) {
            for (const lastRow of [false, true]) {
                await fixture.render(table({ rowHeight, stickyLeft, lastRow }));
                const node = cell(fixture);
                const content = node.querySelector(
                    '.mx-sdk-portal-grid-empty-cell__content'
                );
                assert.ok(content);
                assert.equal(
                    content.getAttribute('data-row-height'),
                    rowHeight
                );
                assert.equal(
                    node.getAttribute('data-last-row'),
                    String(lastRow)
                );
                assert.equal(
                    node.getAttribute('data-sticky'),
                    String(stickyLeft !== undefined)
                );
                assert.equal(
                    node.style.getPropertyValue('--mx-sdk-grid-empty-left'),
                    stickyLeft === undefined ? '' : `${stickyLeft}px`
                );
                assert.equal(node.cellIndex, 1);
                assert.equal(node.parentElement?.children.length, 3);
                assert.equal(
                    node.previousElementSibling?.textContent,
                    'Original record'
                );
                assert.equal(
                    node.nextElementSibling?.textContent,
                    'Unchanged status'
                );
                assert.equal(node.textContent, '');
                assert.equal(content.children.length, 0);
            }
        }
    }
});

it('keeps placeholder focus, selection and clipboard behavior inert', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    await fixture.render(
        h(
            'div',
            null,
            h('button', { type: 'button' }, 'Before grid'),
            table({ rowHeight: 'short', stickyLeft: 0 }),
            h('button', { type: 'button' }, 'After grid')
        )
    );
    const node = cell(fixture);
    const before = fixture.container.querySelector('button');
    assert.ok(before);
    before.focus();
    assert.equal(fixture.window.document.activeElement, before);
    assert.equal(node.hasAttribute('tabindex'), false);
    assert.equal(node.hasAttribute('role'), false);
    assert.equal(
        node.querySelector(
            'button,input,textarea,select,a[href],[tabindex],[contenteditable], [role]'
        ),
        null
    );

    const observed: string[] = [];
    const clipboardWrites: unknown[] = [];
    const initialMarkup = node.outerHTML;
    for (const type of ['pointerdown', 'click', 'keydown', 'copy']) {
        const observer = () => observed.push(type);
        fixture.container.addEventListener(type, observer);
        const event =
            type === 'keydown'
                ? new fixture.window.KeyboardEvent(type, {
                      key: 'Enter',
                      bubbles: true,
                      cancelable: true,
                  })
                : new fixture.window.Event(type, {
                      bubbles: true,
                      cancelable: true,
                  });
        if (type === 'copy')
            Object.defineProperty(event, 'clipboardData', {
                value: {
                    setData: (...args: unknown[]) => clipboardWrites.push(args),
                },
            });
        await act(async () => {
            node.dispatchEvent(event);
        });
        fixture.container.removeEventListener(type, observer);
        assert.equal(event.defaultPrevented, false);
        assert.equal(fixture.window.document.activeElement, before);
    }
    assert.deepEqual(observed, ['pointerdown', 'click', 'keydown', 'copy']);
    assert.deepEqual(clipboardWrites, []);
    assert.equal(node.outerHTML, initialMarkup);
    assert.equal(fixture.window.document.getSelection()?.toString() ?? '', '');
});
