import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    PortalGridMultilineTextCell,
    type PortalGridMultilineTextCellProps,
    type PortalGridMultilineTextEditor,
} from '../src/react/PortalGridMultilineTextCell.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

type Fixture = Awaited<ReturnType<typeof htmlPresentationFixture>>;
const baseline = 'Seed\nhttps://example.test/notes';

function grid(overrides: Partial<PortalGridMultilineTextCellProps> = {}) {
    return h(
        'table',
        null,
        h(
            'tbody',
            null,
            h(
                'tr',
                null,
                h(PortalGridMultilineTextCell, {
                    value: baseline,
                    displayText: baseline,
                    language: 'en',
                    cellIdentity: 'row-A',
                    selected: false,
                    onSelect: () => {},
                    rowHeight: 'medium',
                    ...overrides,
                })
            )
        )
    );
}

function textarea(fixture: Fixture) {
    const field = fixture.container.querySelector('textarea');
    assert.ok(field instanceof fixture.window.HTMLTextAreaElement);
    return field;
}

async function change(
    fixture: Fixture,
    field: ReturnType<typeof textarea>,
    value: string,
    isComposing = false
) {
    const setter = Object.getOwnPropertyDescriptor(
        fixture.window.HTMLTextAreaElement.prototype,
        'value'
    )?.set;
    assert.ok(setter);
    await act(async () => {
        setter.call(field, value);
        field.dispatchEvent(
            new fixture.window.InputEvent('input', {
                bubbles: true,
                isComposing,
            })
        );
    });
}

it('renders a literal linked value, a blank cell and selected guidance on the server', () => {
    const literal = renderToString(grid());
    assert.match(
        literal,
        /class="mx-sdk-portal-grid-cell mx-sdk-portal-grid-multiline-text-cell"/
    );
    assert.match(literal, /href="https:\/\/example\.test\/notes"/);
    assert.match(literal, /data-row-height="medium"/);
    assert.doesNotMatch(literal, /<textarea/);
    const blank = renderToString(
        grid({
            value: null,
            displayText: '',
            selected: true,
            readOnlyGuidance: {
                label: 'Edit form required',
                text: 'Use the edit form.',
            },
        })
    );
    assert.match(blank, /class="read-only-text"><\/span>/);
    assert.match(blank, /aria-label="Edit form required"/);
    assert.match(blank, /mx-sdk-portal-grid-text-cell__selection/);
    assert.doesNotMatch(blank, /<textarea/);
});

it('selects without writing and forwards literal native changes including composition and clear', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: string[] = [];
    let selections = 0;
    const editor: PortalGridMultilineTextEditor = {
        id: 'notes',
        form: 'html-presentation-owner',
        placeholder: 'Multiline notes',
        characterLimit: 42,
        hasDescription: true,
        owner: { token: {}, isCurrent: () => true },
        onChange: (value) => writes.push(value),
    };
    await fixture.render(grid({ editor, onSelect: () => selections++ }));
    const cell = fixture.container.querySelector('td');
    assert.ok(cell);
    await fixture.click(cell);
    assert.equal(selections, 1);
    assert.equal(fixture.window.document.activeElement, cell);
    assert.equal(fixture.container.querySelector('textarea'), null);
    assert.deepEqual(writes, []);

    await fixture.render(grid({ editor, selected: true }));
    const field = textarea(fixture);
    assert.equal(field.value, baseline);
    assert.equal(field.id, 'notes');
    assert.equal(field.getAttribute('form'), 'html-presentation-owner');
    assert.equal(field.getAttribute('aria-describedby'), 'notes-description');
    assert.equal(field.getAttribute('placeholder'), 'Multiline notes');
    assert.equal(field.getAttribute('maxlength'), '42');
    assert.equal(
        cell
            .querySelector('[data-row-height]')
            ?.getAttribute('data-row-height'),
        'fit-content'
    );
    await change(fixture, field, 'First\n中', true);
    await change(fixture, field, '');
    assert.deepEqual(writes, ['First\n中', '']);

    await fixture.render(grid({ editor, selected: false }));
    assert.equal(fixture.container.querySelector('textarea'), null);
    await change(fixture, field, 'Detached');
    assert.deepEqual(writes, ['First\n中', '']);
});

it('checks host admission on each change and uses only the current cell writer', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const firstWrites: string[] = [];
    const nextWrites: string[] = [];
    let current = true;
    const first: PortalGridMultilineTextEditor = {
        id: 'notes-A',
        owner: { token: {}, isCurrent: () => current },
        onChange: (value) => firstWrites.push(value),
    };
    const next: PortalGridMultilineTextEditor = {
        id: 'notes-B',
        owner: { token: {}, isCurrent: () => true },
        onChange: (value) => nextWrites.push(value),
    };
    await fixture.render(grid({ editor: first, selected: true }));
    const firstField = textarea(fixture);
    await change(fixture, firstField, 'Accepted A');
    current = false;
    await change(fixture, firstField, 'Revoked A');
    await fixture.render(
        grid({ cellIdentity: 'row-B', editor: next, selected: true })
    );
    const nextField = textarea(fixture);
    assert.equal(nextField.id, 'notes-B');
    await change(fixture, nextField, 'Accepted B');
    assert.deepEqual(firstWrites, ['Accepted A']);
    assert.deepEqual(nextWrites, ['Accepted B']);
});
