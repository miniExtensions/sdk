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

it('shows guidance only for the selected readonly cell and preserves its literal value', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const readOnlyGuidance = {
        label: 'Edit form required',
        text: 'Use the edit form for conditional fields.',
    };
    let selections = 0;
    const onSelect = () => {
        selections++;
    };
    const marker = '[aria-label="Edit form required"]';
    const popup = () =>
        fixture.window.document.body.querySelector('[role="tooltip"]');
    await fixture.render(table({ readOnlyGuidance, onSelect }));
    assert.equal(fixture.container.querySelector(marker), null);
    await fixture.render(table({ readOnlyGuidance, onSelect, selected: true }));
    const trigger = fixture.container.querySelector(marker);
    assert.ok(trigger instanceof fixture.window.HTMLElement);
    assert.equal(trigger.getAttribute('type'), 'button');
    const icon = trigger.querySelector('svg');
    assert.equal(icon?.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(icon?.getAttribute('aria-hidden'), 'true');
    assert.equal(icon?.getAttribute('focusable'), 'false');
    assert.equal(fixture.container.querySelector('input'), null);
    assert.equal(
        fixture.container.querySelector('.read-only-text')?.textContent,
        'Baseline'
    );
    await act(async () =>
        trigger.dispatchEvent(
            new fixture.window.MouseEvent('mouseover', { bubbles: true })
        )
    );
    assert.ok(popup());
    await act(async () => trigger.focus());
    const help = popup();
    assert.ok(help);
    assert.equal(help.textContent, readOnlyGuidance.text);
    assert.equal(trigger.getAttribute('aria-describedby'), help.id);
    await act(async () =>
        trigger.dispatchEvent(
            new fixture.window.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        )
    );
    assert.equal(popup(), null);
    assert.equal(trigger.getAttribute('aria-describedby'), null);
    await fixture.click(trigger);
    assert.ok(popup());
    assert.equal(selections, 0);
    await fixture.render(
        table({
            readOnlyGuidance,
            selected: true,
            editor: {
                onChange: () => assert.fail('No explicit edit was made'),
                owner: { token: 'restored', isCurrent: () => true },
            },
        })
    );
    assert.equal(fixture.container.querySelector(marker), null);
    assert.equal(popup(), null);
    assert.equal(input(fixture).value, 'Baseline');
    fixture.unchangedEffects();
});

it('retires focused guidance when the selected cell identity changes', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const rowA = {};
    const rowB = {};
    const present = (cellIdentity: object, text: string) =>
        fixture.render(
            table({
                cellIdentity,
                selected: true,
                value: text,
                displayText: text,
                readOnlyGuidance: {
                    label: 'Edit form required',
                    text: `Use the edit form for ${text}.`,
                },
                onSelect: () => assert.fail('Help must not select the cell'),
            })
        );
    const trigger = () => {
        const node = fixture.container.querySelector('button');
        assert.ok(node instanceof fixture.window.HTMLButtonElement);
        return node;
    };
    const popup = () =>
        fixture.window.document.body.querySelector('[role="tooltip"]');
    await present(rowA, 'A');
    const cell = fixture.container.querySelector('td');
    await act(async () => trigger().focus());
    assert.equal(popup()?.textContent, 'Use the edit form for A.');
    await present(rowA, 'Updated A');
    assert.equal(popup()?.textContent, 'Use the edit form for Updated A.');
    assert.equal(fixture.window.document.activeElement === trigger(), true);

    await present(rowB, 'B');
    assert.equal(fixture.container.querySelector('td') === cell, true);
    assert.equal(
        popup() === null,
        true,
        'The replacement must close prior help'
    );
    assert.equal(trigger().getAttribute('aria-describedby'), null);
    assert.equal(fixture.window.document.activeElement === trigger(), false);
    assert.equal(cell?.querySelector('.read-only-text')?.textContent, 'B');
    await act(async () => trigger().focus());
    assert.equal(popup()?.textContent, 'Use the edit form for B.');
    assert.equal(trigger().getAttribute('aria-describedby'), popup()?.id);

    await present(rowA, 'A again');
    assert.equal(popup() === null, true);
    assert.equal(trigger().getAttribute('aria-describedby'), null);
    assert.equal(fixture.window.document.activeElement === trigger(), false);
    fixture.unchangedEffects();
});

it('selects without admission, retains IME confirmation and commits once with ordinary Enter', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: string[] = [];
    const requests: string[] = [];
    const queue = createPortalInlineEditQueue<string, string, string>({
        commit: async (request) => {
            requests.push(request);
            return request;
        },
        committedValue: (result) => result,
    });
    t.after(() => queue.dispose());
    let value = 'Baseline';
    let selections = 0;
    const editor = {
        onChange(text: string) {
            writes.push(text);
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

    const unfinished = '仮 ';
    const edited = input(fixture);
    await act(async () => {
        edited.focus();
        edited.dispatchEvent(
            new fixture.window.CompositionEvent('compositionstart', {
                bubbles: true,
            })
        );
    });
    assert.equal(await edit(fixture, unfinished), edited);
    await enter(fixture, true);
    assert.equal(fixture.window.document.activeElement, edited);
    assert.deepEqual(writes, []);
    assert.equal(queue.hasPending(), false);

    const confirmation = new fixture.window.KeyboardEvent('keydown', {
        key: 'Enter',
        keyCode: 229,
        isComposing: false,
        bubbles: true,
        cancelable: true,
    });
    assert.equal(confirmation.key, 'Enter');
    assert.equal(confirmation.keyCode, 229);
    assert.equal(confirmation.isComposing, false);
    assert.equal(confirmation.bubbles, true);
    assert.equal(confirmation.cancelable, true);
    let dispatched = false;
    await act(async () => {
        dispatched = edited.dispatchEvent(confirmation);
    });
    const confirmationTrace = {
        dispatched,
        defaultPrevented: confirmation.defaultPrevented,
        sameInput: input(fixture) === edited,
        focused: fixture.window.document.activeElement === edited,
        value: edited.value,
        writes: [...writes],
        pending: queue.hasPending(),
    };
    await queue.flush();
    assert.deepEqual(
        { ...confirmationTrace, requests },
        {
            dispatched: true,
            defaultPrevented: false,
            sameInput: true,
            focused: true,
            value: unfinished,
            writes: [],
            pending: false,
            requests: [],
        },
        'IME confirmation must leave the unfinished draft focused and unwritten'
    );

    const finalized = '確定  ';
    await act(async () => {
        edited.dispatchEvent(
            new fixture.window.CompositionEvent('compositionend', {
                bubbles: true,
            })
        );
    });
    assert.equal(await edit(fixture, finalized), edited);
    await enter(fixture);
    assert.notEqual(fixture.window.document.activeElement, edited);
    assert.deepEqual(writes, [finalized]);
    assert.equal(queue.hasPending(), true);
    await queue.flush();
    assert.equal(value, finalized);
    assert.deepEqual(requests, [finalized]);
    await fixture.render(
        table({
            editor,
            selected: true,
            value: finalized,
            displayText: finalized,
        })
    );
    await act(async () => {
        edited.focus();
        edited.blur();
    });
    await fixture.render(null);
    await queue.flush();
    assert.equal(queue.hasPending(), false);
    assert.deepEqual(writes, [finalized]);
    assert.deepEqual(requests, [finalized]);
    fixture.unchangedEffects();
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
    reject(new Error('Synthetic host rejection'));
    await pending;
    await render();
    assert.equal(value, 'Baseline');
    assert.equal(input(fixture), node);
    assert.equal(node.value, 'Baseline');
    await act(async () => {
        node.focus();
        node.blur();
    });
    await queue.flush();
    assert.equal(queue.hasPending(), false);
    assert.deepEqual(requests, ['Rejected']);

    await edit(fixture, 'Explicit retry');
    await enter(fixture);
    await render();
    const pendingRetry = queue.flush();
    assert.deepEqual(requests, ['Rejected', 'Explicit retry']);
    await edit(fixture, 'Newer typing');
    reject(new Error('Synthetic rejection of new intent'));
    await pendingRetry;
    await render();
    assert.equal(value, 'Baseline');
    assert.equal(input(fixture), node);
    assert.equal(node.value, 'Newer typing');
    assert.equal(queue.hasPending(), false);
    assert.deepEqual(requests, ['Rejected', 'Explicit retry']);
    await enter(fixture);
    const retry = queue.flush();
    assert.deepEqual(requests, ['Rejected', 'Explicit retry', 'Newer typing']);
    resolve('Newer typing');
    await retry;
    await render();
    await act(async () => {
        node.focus();
        node.blur();
    });
    await queue.flush();
    assert.deepEqual(requests, ['Rejected', 'Explicit retry', 'Newer typing']);
    assert.equal(value, 'Newer typing');
    assert.equal(input(fixture), node);
    assert.equal(node.value, 'Newer typing');
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
    const nextFrame = { canEdit: true };
    const next = {
        owner: { token: nextFrame, isCurrent: () => nextFrame.canEdit },
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

    await fixture.render(
        table({
            cellIdentity: 'B',
            editor: next,
            selected: true,
            value: 'Current B',
            displayText: 'Current B',
        })
    );
    await edit(fixture, 'Retired by readonly');
    nextFrame.canEdit = false;
    await fixture.render(
        table({
            cellIdentity: 'B',
            selected: true,
            value: 'Current B',
            displayText: 'Current B',
        })
    );
    assert.equal(fixture.container.querySelector('input'), null);
    assert.match(fixture.container.textContent ?? '', /Current B/);
    assert.deepEqual(writes, [
        ['A', 'Admitted A'],
        ['B', 'Current B'],
    ]);
});
