import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { createPortalInlineEditQueue } from '../src/portals/inlineEditQueue.js';
import {
    PortalGridSingleLineTextCell,
    type PortalGridSingleLineTextCellProps,
} from '../src/react/PortalGridSingleLineTextCell.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

type Fixture = Awaited<ReturnType<typeof htmlPresentationFixture>>;

function table(overrides: Partial<PortalGridSingleLineTextCellProps> = {}) {
    return h(
        'table',
        null,
        h(
            'tbody',
            null,
            h(
                'tr',
                null,
                h(PortalGridSingleLineTextCell, {
                    value: 'Baseline',
                    displayText: 'Baseline',
                    title: 'Note',
                    language: 'en',
                    cellIdentity: 'A',
                    selected: false,
                    onSelect: () => {},
                    rowHeight: 'medium',
                    ...overrides,
                })
            )
        )
    );
}

function input(fixture: Fixture) {
    const node = fixture.container.querySelector('input');
    assert.ok(node instanceof fixture.window.HTMLInputElement);
    return node;
}

async function edit(fixture: Fixture, text: string) {
    const node = input(fixture);
    await act(async () => {
        node.focus();
        const setter = Object.getOwnPropertyDescriptor(
            fixture.window.HTMLInputElement.prototype,
            'value'
        )?.set;
        assert.ok(setter);
        setter.call(node, text);
        node.dispatchEvent(
            new fixture.window.Event('input', { bubbles: true })
        );
    });
    assert.equal(node.value, text);
    return node;
}

async function enter(fixture: Fixture, isComposing = false) {
    const key = new fixture.window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        isComposing,
    });
    await act(async () => input(fixture).dispatchEvent(key));
    assert.equal(key.defaultPrevented, true);
}

it('server-renders complete cell markup, literal empty display and named admitted editor', () => {
    const write = () => assert.fail('Rendering must not stage a write');
    const readonly = renderToString(table({ value: null, displayText: '' }));
    assert.match(readonly, /<td[^>]+tabindex="-1"/);
    assert.match(readonly, /class="read-only-text"><\/span>/);
    assert.doesNotMatch(readonly, /<input|No Value/);
    const editable = renderToString(
        table({
            selected: true,
            editor: {
                onChange: write,
                owner: { token: 1, isCurrent: () => true },
            },
        })
    );
    assert.match(editable, /<input[^>]+aria-label="Note"/);
    assert.doesNotMatch(editable, /<form|<button[^>]+type="submit"/);
});

it('selects and focuses without admission, retains composing Enter and commits once with ordinary Enter', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: string[] = [];
    let selections = 0;
    const editor = {
        onChange: (text: string) => writes.push(text),
        owner: { token: 1, isCurrent: () => true },
    };
    await fixture.render(
        table({
            editor,
            onSelect: () => {
                selections++;
            },
        })
    );
    const cell = fixture.container.querySelector('td');
    assert.ok(cell);
    assert.equal(fixture.container.querySelector('input'), null);
    await fixture.click(cell);
    assert.equal(selections, 1);
    assert.equal(fixture.window.document.activeElement, cell);
    assert.deepEqual(writes, []);
    await fixture.render(table({ editor, selected: true }));

    const edited = await edit(fixture, 'New text  ');
    await enter(fixture, true);
    assert.equal(fixture.window.document.activeElement, edited);
    assert.deepEqual(writes, []);
    await enter(fixture);
    assert.deepEqual(writes, ['New text  ']);
    await fixture.render(
        table({
            editor,
            selected: false,
            value: 'New text  ',
            displayText: 'New text  ',
        })
    );
    assert.deepEqual(writes, ['New text  ']);
});

it('uses the host queue for rollback, keeps newer typing and requires a fresh intent', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    let value = 'Baseline';
    let reject!: (cause: Error) => void;
    let resolve!: (result: string) => void;
    const requests: string[] = [];
    const queue = createPortalInlineEditQueue<string, string, string>({
        commit: (request) => {
            requests.push(request);
            return new Promise((success, failure) => {
                resolve = success;
                reject = failure;
            });
        },
        committedValue: (result) => result,
    });
    t.after(() => queue.dispose());
    const editor = {
        owner: { token: 1, isCurrent: () => true },
        onChange(text: string) {
            queue.enqueue({
                cell: { tableId: 'table', recordId: 'A', fieldId: 'note' },
                value: text,
                request: text,
                committedValue: value,
                applyValue(next) {
                    value = next;
                },
                onError() {},
                onCommitted() {},
                onBatchSettled() {},
                onIdle() {},
            });
        },
    };
    const render = () =>
        fixture.render(
            table({ value, displayText: value, editor, selected: true })
        );
    await render();
    const node = await edit(fixture, 'Rejected');
    await enter(fixture);
    assert.equal(value, 'Rejected');
    await render();
    const pending = queue.flush();
    assert.deepEqual(requests, ['Rejected']);

    await edit(fixture, 'Newer typing');
    reject(new Error('Synthetic host rejection'));
    await pending;
    await render();
    assert.equal(value, 'Baseline');
    assert.equal(input(fixture), node);
    assert.equal(node.value, 'Newer typing');
    assert.equal(queue.hasPending(), false);
    assert.deepEqual(requests, ['Rejected']);
    await enter(fixture);
    const retry = queue.flush();
    assert.deepEqual(requests, ['Rejected', 'Newer typing']);
    resolve('Newer typing');
    await retry;
    await render();
    await act(async () => {
        node.focus();
        node.blur();
    });
    await queue.flush();
    assert.deepEqual(requests, ['Rejected', 'Newer typing']);
    assert.equal(value, 'Newer typing');
});

it('keeps the mounted writer on normal deselection and retires it on actual owner replacement', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: Array<[string, string]> = [];
    const frame = { current: true };
    const owner = { token: frame, isCurrent: () => frame.current };
    const original = {
        owner,
        onChange: (text: string) => writes.push(['A', text]),
    };
    const successor = {
        owner,
        onChange: (text: string) => writes.push(['B', text]),
    };
    await fixture.render(table({ editor: original, selected: true }));
    const first = await edit(fixture, 'Admitted A');
    await fixture.render(
        table({
            cellIdentity: 'B',
            value: 'B baseline',
            displayText: 'B baseline',
            editor: successor,
            selected: true,
        })
    );
    assert.equal(input(fixture), first);
    assert.equal(first.value, 'Admitted A');
    await fixture.render(
        table({
            cellIdentity: 'B',
            value: 'B baseline',
            displayText: 'B baseline',
            editor: successor,
            selected: false,
        })
    );
    assert.deepEqual(writes, [['A', 'Admitted A']]);

    await fixture.render(table({ editor: original, selected: true }));
    await edit(fixture, 'Retired A');
    frame.current = false;
    const next = {
        owner: { token: {}, isCurrent: () => true },
        onChange: (text: string) => writes.push(['B', text]),
    };
    await fixture.render(
        table({
            cellIdentity: 'B',
            editor: next,
            selected: true,
            value: 'B baseline',
        })
    );
    assert.deepEqual(writes, [['A', 'Admitted A']]);
    assert.equal(input(fixture).value, 'B baseline');
    await edit(fixture, 'Current B');
    await enter(fixture);
    assert.deepEqual(writes, [
        ['A', 'Admitted A'],
        ['B', 'Current B'],
    ]);
});
