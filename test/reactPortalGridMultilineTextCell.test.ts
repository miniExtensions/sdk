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
    isComposing = false,
    selection?: readonly [number, number]
) {
    const setter = Object.getOwnPropertyDescriptor(
        fixture.window.HTMLTextAreaElement.prototype,
        'value'
    )?.set;
    assert.ok(setter);
    await act(async () => {
        setter.call(field, value);
        if (selection) field.setSelectionRange(...selection);
        field.dispatchEvent(
            new fixture.window.InputEvent('input', {
                bubbles: true,
                isComposing,
            })
        );
    });
}

async function composition(
    fixture: Fixture,
    field: ReturnType<typeof textarea>,
    type: 'compositionstart' | 'compositionend'
) {
    await act(async () => {
        field.dispatchEvent(
            new fixture.window.CompositionEvent(type, { bubbles: true })
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

it('rejects trailing composition input from a replaced textarea and admits the new cell', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const firstWrites: string[] = [];
    const nextWrites: string[] = [];
    let current = true;
    const first: PortalGridMultilineTextEditor = {
        id: 'notes',
        owner: { token: {}, isCurrent: () => current },
        onChange: (value) => firstWrites.push(value),
    };
    const next: PortalGridMultilineTextEditor = {
        id: first.id,
        owner: { token: {}, isCurrent: () => true },
        onChange: (value) => nextWrites.push(value),
    };
    await fixture.render(grid({ editor: first, selected: true }));
    const firstField = textarea(fixture);
    const cell = firstField.closest('td');
    assert.ok(cell);
    firstField.focus();
    await composition(fixture, firstField, 'compositionstart');
    await change(fixture, firstField, 'Composing in A 中', true);
    current = false;
    await change(fixture, firstField, 'Revoked A', true);
    await fixture.render(
        grid({
            cellIdentity: 'row-B',
            editor: next,
            selected: true,
            value: 'Baseline B',
        })
    );
    const nextField = textarea(fixture);
    await composition(fixture, firstField, 'compositionend');
    await change(fixture, firstField, 'Final input from A 中');
    assert.deepEqual(nextWrites, []);
    assert.notEqual(nextField, firstField);
    assert.equal(firstField.isConnected, false);
    assert.equal(nextField.closest('td'), cell);
    assert.equal(nextField.value, 'Baseline B');
    nextField.focus();
    await change(fixture, nextField, 'Accepted B');
    assert.deepEqual(firstWrites, ['Composing in A 中']);
    assert.deepEqual(nextWrites, ['Accepted B']);
});

it('preserves the focused textarea and caret across controlled updates for the same owner', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const originalWrites: string[] = [];
    const currentWrites: string[] = [];
    const editor: PortalGridMultilineTextEditor = {
        id: 'notes',
        owner: { token: {}, isCurrent: () => true },
        onChange: (value) => originalWrites.push(value),
    };
    await fixture.render(grid({ editor, selected: true }));
    const field = textarea(fixture);
    field.focus();
    await composition(fixture, field, 'compositionstart');
    await change(fixture, field, 'Composing in A 中', true, [2, 6]);

    const echoedEditor: PortalGridMultilineTextEditor = {
        ...editor,
        owner: { ...editor.owner },
        onChange: (value) => currentWrites.push(value),
    };
    await fixture.render(
        grid({
            editor: echoedEditor,
            selected: true,
            value: 'Composing in A 中',
        })
    );
    assert.equal(textarea(fixture), field);
    assert.equal(fixture.window.document.activeElement, field);
    assert.equal(field.value, 'Composing in A 中');
    assert.deepEqual([field.selectionStart, field.selectionEnd], [2, 6]);
    await composition(fixture, field, 'compositionend');
    await change(fixture, field, 'Completed in A 中文');
    assert.deepEqual(originalWrites, ['Composing in A 中']);
    assert.deepEqual(currentWrites, ['Completed in A 中文']);
});

it('replaces the textarea when either opaque identity changes independently', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const editor: PortalGridMultilineTextEditor = {
        id: 'notes',
        owner: { token: Symbol('owner'), isCurrent: () => true },
        onChange() {},
    };
    const firstIdentity = Symbol('row');
    const nextIdentity = Symbol('row');
    await fixture.render(
        grid({ cellIdentity: firstIdentity, editor, selected: true })
    );
    const first = textarea(fixture);
    await fixture.render(
        grid({ cellIdentity: nextIdentity, editor, selected: true })
    );
    const next = textarea(fixture);
    assert.notEqual(next, first);
    await fixture.render(
        grid({
            cellIdentity: nextIdentity,
            editor: {
                ...editor,
                owner: { ...editor.owner, token: Symbol('owner') },
            },
            selected: true,
        })
    );
    assert.notEqual(textarea(fixture), next);
});
