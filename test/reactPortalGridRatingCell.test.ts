import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    PortalGridRatingCell,
    type PortalGridRatingCellProps,
} from '../src/react/PortalGridRatingCell.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

type Fixture = Awaited<ReturnType<typeof htmlPresentationFixture>>;
type Editor = NonNullable<PortalGridRatingCellProps['editor']>;

function table(overrides: Partial<PortalGridRatingCellProps> = {}) {
    return h(
        'table',
        null,
        h(
            'tbody',
            null,
            h(
                'tr',
                null,
                h(PortalGridRatingCell, {
                    value: 2,
                    displayText: '2',
                    title: 'Priority',
                    max: 5,
                    icon: 'star',
                    color: 'yellowBright',
                    cellIdentity: 'record-A-rating',
                    selected: false,
                    onSelect: () => {},
                    rowHeight: 'medium',
                    ...overrides,
                })
            )
        )
    );
}

function cell(fixture: Fixture) {
    const node = fixture.container.querySelector('td');
    assert.ok(node instanceof fixture.window.HTMLElement);
    return node;
}

function icons(fixture: Fixture) {
    const nodes = fixture.container.querySelectorAll('.mx-sdk-rating-icon');
    assert.equal(nodes.length, 5);
    return nodes;
}

function slider(fixture: Fixture) {
    const node = fixture.container.querySelector('input[type="range"]');
    assert.ok(node instanceof fixture.window.HTMLInputElement);
    return node;
}

async function clickIcon(fixture: Fixture, value: number) {
    const node = icons(fixture)[value - 1];
    assert.ok(node);
    await act(async () => {
        node.dispatchEvent(
            new fixture.window.MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            })
        );
    });
    fixture.unchangedEffects();
}

async function keyDown(
    fixture: Fixture,
    key: string,
    options: Pick<KeyboardEventInit, 'repeat' | 'isComposing'> = {}
) {
    const node = fixture.container.querySelector('input[type="range"]')
        ? slider(fixture)
        : cell(fixture);
    const event = new fixture.window.KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
    });
    await act(async () => {
        node.focus();
        node.dispatchEvent(event);
    });
    fixture.unchangedEffects();
    return event;
}

it('server-renders the complete rating cell without allocating a form or write', () => {
    const writes: Array<number | null> = [];
    const html = renderToString(
        table({
            selected: true,
            editor: {
                owner: { token: 'A', isCurrent: () => true },
                onChange: (value) => writes.push(value),
            },
        })
    );
    assert.match(html, /<td[^>]+tabindex="-1"/);
    assert.equal(
        (html.match(/class="[^"]*mx-sdk-rating-icon /g) ?? []).length,
        5
    );
    assert.match(html, /<input[^>]+aria-label="Priority"/);
    assert.doesNotMatch(html, /<form|type="submit"/);
    assert.deepEqual(writes, []);
});

it('uses the first icon click only to select and writes exactly the selected icon after admission', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: Array<number | null> = [];
    let selections = 0;
    const editor: Editor = {
        owner: { token: 'A', isCurrent: () => true },
        onChange: (value) => writes.push(value),
    };
    const onSelect = () => selections++;
    await fixture.render(table({ editor, onSelect }));

    await clickIcon(fixture, 3);
    assert.equal(selections, 1);
    assert.deepEqual(writes, []);

    await fixture.render(table({ editor, onSelect, selected: true }));
    await clickIcon(fixture, 3);
    assert.deepEqual(writes, [3]);
    assert.equal(fixture.container.querySelector('form'), null);
});

for (const key of ['Delete', 'Backspace'] as const) {
    it(`clears the selected current rating once with ${key} without submitting`, async (t) => {
        const fixture = await htmlPresentationFixture(t);
        const writes: Array<number | null> = [];
        const editor: Editor = {
            owner: { token: 'A', isCurrent: () => true },
            onChange: (value) => writes.push(value),
        };
        await fixture.render(table({ editor, selected: true, value: 3 }));

        const event = await keyDown(fixture, key);
        assert.equal(event.defaultPrevented, true);
        assert.deepEqual(writes, [null]);
        assert.equal(
            fixture.window.document.activeElement === slider(fixture),
            true
        );

        await fixture.render(
            table({ editor, selected: true, value: null, displayText: '' })
        );
        await keyDown(fixture, key);
        assert.deepEqual(writes, [null]);
        fixture.unchangedEffects();
    });
}

it('keeps readonly and retired-owner interactions outside the native writer', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: Array<number | null> = [];
    await fixture.render(table({ selected: true }));
    await clickIcon(fixture, 3);
    await keyDown(fixture, 'Delete');
    assert.equal(fixture.container.querySelector('input'), null);
    assert.equal(writes.length, 0);

    const editor: Editor = {
        owner: { token: 'retired-A', isCurrent: () => false },
        onChange: (value) => writes.push(value),
    };
    await fixture.render(table({ selected: true, editor }));
    await clickIcon(fixture, 3);
    await keyDown(fixture, 'Backspace');
    assert.deepEqual(writes, []);
});

it('forwards the admitted range association and accessible host labels', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: Array<number | null> = [];
    await fixture.render(
        h(
            'div',
            null,
            h('span', { id: 'rating-label' }, 'Host priority'),
            h('p', { id: 'rating-help' }, 'Choose a priority'),
            table({
                selected: true,
                editor: {
                    owner: { token: 'A', isCurrent: () => true },
                    onChange: (value) => writes.push(value),
                    id: 'priority-rating',
                    form: fixture.container.id,
                    labelledBy: 'rating-label',
                    describedBy: 'rating-help',
                    invalid: true,
                },
            })
        )
    );
    const input = slider(fixture);
    assert.equal(input.id, 'priority-rating');
    assert.equal(input.form === fixture.container, true);
    assert.equal(input.getAttribute('aria-labelledby'), 'rating-label');
    assert.equal(input.getAttribute('aria-describedby'), 'rating-help');
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.deepEqual(writes, []);
});

it('retains the cell through echoes and sends later actions only to the current owner', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: Array<[string, number | null]> = [];
    const first = { current: true };
    const editor: Editor = {
        owner: { token: first, isCurrent: () => first.current },
        onChange: (value) => writes.push(['A', value]),
    };
    await fixture.render(table({ selected: true, editor }));
    const original = cell(fixture);
    await act(async () => original.focus());
    await fixture.render(
        table({ selected: true, editor, value: 4, displayText: '4' })
    );
    assert.equal(cell(fixture) === original, true);
    assert.equal(fixture.window.document.activeElement === original, true);
    await clickIcon(fixture, 3);
    assert.deepEqual(writes, [['A', 3]]);

    first.current = false;
    const successor: Editor = {
        owner: { token: {}, isCurrent: () => true },
        onChange: (value) => writes.push(['B', value]),
    };
    await fixture.render(
        table({
            cellIdentity: 'record-B-rating',
            selected: true,
            editor: successor,
            value: 1,
            displayText: '1',
        })
    );
    await clickIcon(fixture, 3);
    assert.deepEqual(writes, [
        ['A', 3],
        ['B', 3],
    ]);
});

it('does not turn Escape, composing clear, or repeated clear into a rating write', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: Array<number | null> = [];
    await fixture.render(
        table({
            selected: true,
            editor: {
                owner: { token: 'A', isCurrent: () => true },
                onChange: (value) => writes.push(value),
            },
        })
    );
    await keyDown(fixture, 'Escape');
    await keyDown(fixture, 'Delete', { isComposing: true });
    await keyDown(fixture, 'Backspace', { repeat: true });
    assert.deepEqual(writes, []);
});
