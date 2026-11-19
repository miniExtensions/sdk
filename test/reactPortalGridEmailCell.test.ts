import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    PortalGridEmailCell,
    type PortalGridEmailCellProps,
} from '../src/react/PortalGridEmailCell.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

type Fixture = Awaited<ReturnType<typeof htmlPresentationFixture>>;
const baseline = 'seed@example.com';
const edited = 'Changed@example.com';

function grid(overrides: Partial<PortalGridEmailCellProps> = {}) {
    return h(
        'table',
        null,
        h(
            'tbody',
            null,
            h(
                'tr',
                null,
                h(PortalGridEmailCell, {
                    value: baseline,
                    displayText: baseline,
                    title: 'Contact email',
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

async function change(fixture: Fixture, value: string) {
    const input = fixture.container.querySelector('input');
    assert.ok(input instanceof fixture.window.HTMLInputElement);
    await act(async () => {
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(
            fixture.window.HTMLInputElement.prototype,
            'value'
        )?.set;
        assert.ok(setter);
        setter.call(input, value);
        input.dispatchEvent(
            new fixture.window.Event('input', { bubbles: true })
        );
    });
    assert.equal(input.value, value);
    return input;
}

it('server-renders a literal link or blank without mounting an unselected editor', () => {
    const html = renderToString(grid());
    assert.match(html, /<td[^>]+tabindex="-1"/);
    assert.match(html, /href="mailto:seed@example\.com"/);
    assert.doesNotMatch(html, /<input/);
    const blank = renderToString(grid({ value: null, displayText: '' }));
    assert.match(blank, /class="read-only-text"><\/span>/);
});

it('selects without writing and commits the literal email on ordinary Enter, not IME Enter', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: string[] = [];
    let selections = 0;
    const editor = {
        owner: { token: {}, isCurrent: () => true },
        onChange: (value: string) => writes.push(value),
        form: 'html-presentation-owner',
    };
    await fixture.render(grid({ editor, onSelect: () => selections++ }));
    const cell = fixture.container.querySelector('td');
    const link = fixture.container.querySelector('a');
    assert.ok(cell && link);
    assert.equal(link.getAttribute('href'), 'mailto:seed@example.com');
    link.addEventListener('click', (event) => event.preventDefault());
    await fixture.click(link);
    assert.equal(selections, 0);
    await fixture.click(cell);
    assert.equal(selections, 1);
    assert.equal(fixture.window.document.activeElement, cell);
    assert.deepEqual(writes, []);

    await fixture.render(grid({ editor, selected: true }));
    const input = await change(fixture, edited);
    assert.equal(input.type, 'email');
    assert.equal(input.getAttribute('aria-label'), 'Contact email');
    assert.equal(input.form, fixture.container);
    assert.deepEqual(writes, []);
    for (const isComposing of [true, false]) {
        const enter = new fixture.window.KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
            isComposing,
        });
        await act(async () => input.dispatchEvent(enter));
        assert.equal(enter.defaultPrevented, true);
        assert.deepEqual(writes, isComposing ? [] : [edited]);
        assert.equal(
            Object.is(fixture.window.document.activeElement, input),
            isComposing
        );
    }
    fixture.unchangedEffects();
});

it('settles a current draft on deselection through its original writer', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: string[] = [];
    const editor = {
        owner: { token: {}, isCurrent: () => true },
        onChange: (value: string) => writes.push(value),
    };
    await fixture.render(grid({ editor, selected: true }));
    const input = await change(fixture, edited);
    assert.deepEqual(writes, []);
    const updated = {
        ...editor,
        onChange: () => assert.fail('Cleanup must retain the original writer'),
    };
    await fixture.render(grid({ editor: updated, selected: true }));
    assert.equal(fixture.container.querySelector('input'), input);
    await fixture.render(grid({ editor: updated }));
    assert.deepEqual(writes, [edited]);
    assert.equal(fixture.container.querySelector('input'), null);
});

for (const transition of ['row', 'owner', 'readonly'] as const) {
    it(`retires a dirty Email editor on ${transition} replacement`, async (t) => {
        const fixture = await htmlPresentationFixture(t);
        const writes: Array<{ owner: string; value: string }> = [];
        const owner = { token: {}, isCurrent: () => true };
        const original = {
            owner,
            onChange: (value: string) => writes.push({ owner: 'A', value }),
        };
        await fixture.render(grid({ editor: original, selected: true }));
        const input = await change(fixture, edited);
        const successor = {
            owner: transition === 'owner' ? { ...owner, token: {} } : owner,
            onChange: (value: string) => writes.push({ owner: 'B', value }),
        };
        await fixture.render(
            grid({
                cellIdentity: transition === 'row' ? 'row-B' : 'row-A',
                selected: true,
                editor: transition === 'readonly' ? undefined : successor,
            })
        );
        assert.equal(input.isConnected, false);
        assert.deepEqual(writes, []);
        if (transition === 'readonly') return;
        const next = await change(fixture, edited);
        await act(async () => next.blur());
        assert.deepEqual(writes, [{ owner: 'B', value: edited }]);
    });
}
