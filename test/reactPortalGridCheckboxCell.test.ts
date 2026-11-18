import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { createPortalInlineEditQueue } from '../src/portals/inlineEditQueue.js';
import {
    PortalGridCheckboxCell,
    type PortalGridCheckboxCellProps,
} from '../src/react/PortalGridCheckboxCell.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

type Fixture = Awaited<ReturnType<typeof htmlPresentationFixture>>;
type Editor = NonNullable<PortalGridCheckboxCellProps['editor']>;

function table(overrides: Partial<PortalGridCheckboxCellProps> = {}) {
    return h(
        'table',
        null,
        h(
            'tbody',
            null,
            h(
                'tr',
                null,
                h(PortalGridCheckboxCell, {
                    value: false,
                    displayText: 'Unchecked',
                    title: 'Approved',
                    cellIdentity: 'record-A-approved',
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
    assert.ok(node instanceof fixture.window.HTMLTableCellElement);
    return node;
}

function input(fixture: Fixture) {
    const node = fixture.container.querySelector('input[type="checkbox"]');
    assert.ok(node instanceof fixture.window.HTMLInputElement);
    return node;
}

// Retain the real mounted leaf callback: dispatching on detached DOM would not
// reach React and would make stale-callback assertions vacuous.
function retainChange(node: object): (checked: boolean) => void {
    const key = Object.keys(node).find((name) =>
        name.startsWith('__reactProps$')
    );
    assert.ok(key, 'The actual mounted checkbox has React event props');
    const props = Reflect.get(node, key);
    assert.equal(typeof props.onChange, 'function');
    return (checked) => props.onChange({ currentTarget: { checked } });
}

async function copy(fixture: Fixture) {
    const writes: Array<[string, string]> = [];
    const event = new fixture.window.Event('copy', {
        bubbles: true,
        cancelable: true,
    });
    Object.defineProperty(event, 'clipboardData', {
        value: {
            setData: (type: string, value: string) =>
                writes.push([type, value]),
        },
    });
    await act(async () => {
        cell(fixture).focus();
        cell(fixture).dispatchEvent(event);
    });
    fixture.unchangedEffects();
    return { event, writes };
}

it('server-renders the default checkbox leaf or exact blank without a form or write', () => {
    const writes: boolean[] = [];
    const editor: Editor = {
        owner: { token: 'A', isCurrent: () => true },
        onChange: (value) => writes.push(value),
    };
    const editable = renderToString(table({ editor }));
    assert.match(editable, /<td[^>]+tabindex="-1"/);
    assert.match(editable, /<input[^>]+aria-label="Approved"/);
    assert.match(editable, /type="checkbox"/);
    assert.doesNotMatch(editable, /<form|<button|disabled=""/);
    const readonly = renderToString(table({ value: true }));
    assert.match(readonly, /data-checkbox-grid-value="true"/);
    assert.doesNotMatch(readonly, /<input|<button|<label/);
    for (const overrides of [{ value: null }, { displayText: '' }]) {
        const blank = renderToString(table(overrides));
        assert.match(blank, /class="read-only-text"><\/span>/);
        assert.doesNotMatch(blank, /<input|data-checkbox-grid-value|No Value/);
    }
    assert.deepEqual(writes, []);
});

it('edits immediately while unselected, while the background only selects and focuses', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: boolean[] = [];
    let selections = 0;
    await fixture.render(
        table({
            editor: {
                owner: { token: 'A', isCurrent: () => true },
                onChange: (value) => writes.push(value),
            },
            onSelect: () => selections++,
        })
    );
    const node = input(fixture);
    assert.equal(node.disabled, false);
    assert.equal(node.checked, false);
    await fixture.click(cell(fixture));
    assert.equal(selections, 1);
    assert.equal(fixture.window.document.activeElement, cell(fixture));
    assert.deepEqual(writes, []);
    await act(async () => node.focus());
    await fixture.click(node);
    assert.deepEqual(writes, [true]);
    assert.equal(fixture.window.document.activeElement, node);
    assert.equal(node.checked, false, 'Only the host can echo a new value');
});

it('keeps null, checked and unchecked values controlled on the same mounted input', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: boolean[] = [];
    const editor: Editor = {
        owner: { token: {}, isCurrent: () => true },
        onChange: (value) => writes.push(value),
    };
    await fixture.render(table({ editor, value: null, displayText: '' }));
    const node = input(fixture);
    assert.equal(node.checked, false);
    await fixture.click(node);
    assert.deepEqual(writes, [true]);
    await fixture.render(
        table({ editor, value: true, displayText: 'Checked' })
    );
    assert.equal(input(fixture), node);
    assert.equal(node.checked, true);
    await fixture.click(node);
    assert.deepEqual(writes, [true, false]);
    assert.equal(node.checked, true);
    await fixture.render(table({ editor, value: false }));
    assert.equal(input(fixture), node);
    assert.equal(node.checked, false);
    assert.deepEqual(writes, [true, false]);
});

it('projects host rollback and requires another click before retrying a rejected write', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const requests: boolean[] = [];
    let value = false;
    let reject!: (error: Error) => void;
    let resolve!: (value: boolean) => void;
    const queue = createPortalInlineEditQueue<boolean, boolean, boolean>({
        commit(request) {
            requests.push(request);
            return new Promise((success, failure) => {
                resolve = success;
                reject = failure;
            });
        },
        committedValue: (result) => result,
    });
    t.after(() => queue.dispose());
    const editor: Editor = {
        owner: { token: {}, isCurrent: () => true },
        onChange(checked) {
            queue.enqueue({
                cell: { tableId: 'table', recordId: 'A', fieldId: 'approved' },
                value: checked,
                request: checked,
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
    const render = () => fixture.render(table({ editor, value }));
    await render();
    const node = input(fixture);
    await fixture.click(node);
    await render();
    assert.equal(node.checked, true);
    const pending = queue.flush();
    assert.deepEqual(requests, [true]);
    reject(new Error('Synthetic host rejection'));
    await pending;
    await render();
    assert.equal(input(fixture), node);
    assert.equal(node.checked, false);
    await act(async () => {
        node.focus();
        node.blur();
    });
    await render();
    await queue.flush();
    assert.equal(queue.hasPending(), false);
    assert.deepEqual(requests, [true]);
    await fixture.click(node);
    const retry = queue.flush();
    assert.deepEqual(requests, [true, true]);
    resolve(true);
    await retry;
    await render();
    assert.equal(node.checked, true);
    assert.equal(queue.hasPending(), false);
});

it('keeps readonly booleans static, exact empties blank, and raw booleans out of cell copy', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const cases = [
        { value: true, displayText: 'Checked', blank: false },
        { value: false, displayText: 'Unchecked', blank: false },
        { value: null, displayText: 'Ignored display', blank: true },
        { value: true, displayText: '', blank: true },
        { value: false, displayText: '', blank: true },
    ];
    for (const { blank, ...props } of cases) {
        for (const copyDisabled of [false, true]) {
            await fixture.render(
                table({ ...props, selected: true, copyDisabled })
            );
            assert.equal(
                cell(fixture).querySelector('input,button,label'),
                null
            );
            const indicator = cell(fixture).querySelector(
                '[data-checkbox-grid-value]'
            );
            const literal = cell(fixture).querySelector('.read-only-text');
            if (blank) {
                assert.equal(indicator, null);
                assert.equal(literal?.textContent, '');
            } else {
                assert.equal(
                    indicator?.getAttribute('data-checkbox-grid-value'),
                    String(props.value)
                );
                assert.equal(indicator?.getAttribute('aria-hidden'), 'true');
                assert.equal(literal, null);
            }
            const copied = await copy(fixture);
            assert.equal(
                copied.writes.some(
                    ([, text]) => text === 'true' || text === 'false'
                ),
                false
            );
            if (!blank || copyDisabled) {
                assert.deepEqual(copied.writes, []);
                assert.equal(copied.event.defaultPrevented, false);
            }
        }
    }
});

it('forwards host checkbox associations and a title without adding labels or nested forms', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    await fixture.render(
        h(
            'div',
            null,
            h('p', { id: 'approval-help' }, 'Choose whether this is approved'),
            table({
                editor: {
                    owner: { token: 'A', isCurrent: () => true },
                    onChange: () => assert.fail('Rendering is not a gesture'),
                    id: 'approval-control',
                    form: fixture.container.id,
                    ariaDescribedBy: 'approval-help',
                    ariaInvalid: true,
                },
            })
        )
    );
    const node = input(fixture);
    assert.equal(node.id, 'approval-control');
    assert.equal(node.getAttribute('form'), fixture.container.id);
    assert.equal(node.getAttribute('aria-label'), 'Approved');
    assert.equal(node.getAttribute('aria-describedby'), 'approval-help');
    assert.equal(node.getAttribute('aria-invalid'), 'true');
    assert.equal(fixture.container.querySelector('label,form,button'), null);
});

it('checks current admission on each gesture and fails closed if the owner throws', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: boolean[] = [];
    let current = false;
    let throws = false;
    await fixture.render(
        table({
            editor: {
                owner: {
                    token: 'A',
                    isCurrent() {
                        if (throws) throw new Error('Synthetic retired host');
                        return current;
                    },
                },
                onChange: (value) => writes.push(value),
            },
        })
    );
    await fixture.click(input(fixture));
    assert.deepEqual(writes, []);
    current = true;
    await fixture.click(input(fixture));
    assert.deepEqual(writes, [true]);
    throws = true;
    await fixture.click(input(fixture));
    assert.deepEqual(writes, [true]);
});

it('uses current callbacks and values for a retained placement and owner', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: Array<[string, boolean]> = [];
    const owner = { token: {}, isCurrent: () => true };
    await fixture.render(
        table({
            editor: { owner, onChange: (value) => writes.push(['old', value]) },
        })
    );
    const node = input(fixture);
    await fixture.render(
        table({
            value: true,
            editor: {
                owner,
                onChange: (value) => writes.push(['current', value]),
            },
        })
    );
    assert.equal(input(fixture), node);
    await fixture.click(node);
    assert.deepEqual(writes, [['current', false]]);
});

for (const transition of ['placement', 'owner'] as const) {
    it(`retires retained checkbox callbacks across ${transition} A/B/A`, async (t) => {
        const fixture = await htmlPresentationFixture(t);
        const writes: string[] = [];
        const A = {};
        const B = {};
        const render = (identity: object, label: string) =>
            fixture.render(
                table({
                    cellIdentity:
                        transition === 'placement' ? identity : 'same-cell',
                    editor: {
                        owner: {
                            token:
                                transition === 'owner'
                                    ? identity
                                    : 'same-owner',
                            isCurrent: () => true,
                        },
                        onChange: () => writes.push(label),
                    },
                })
            );
        await render(A, 'old A');
        const oldA = retainChange(input(fixture));
        await render(B, 'B');
        const oldB = retainChange(input(fixture));
        await render(A, 'current A');
        const liveA = retainChange(input(fixture));
        await act(async () => {
            oldA(true);
            oldB(true);
        });
        assert.deepEqual(writes, []);
        await act(async () => liveA(true));
        assert.deepEqual(writes, ['current A']);
    });
}

it('does not revive a retained callback after readonly retirement and readmission', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: boolean[] = [];
    const editor: Editor = {
        owner: { token: 'A', isCurrent: () => true },
        onChange: (value) => writes.push(value),
    };
    await fixture.render(table({ editor }));
    const retired = retainChange(input(fixture));
    await fixture.render(table());
    assert.equal(fixture.container.querySelector('input'), null);
    await act(async () => retired(true));
    assert.deepEqual(writes, []);
    await fixture.render(table({ editor }));
    await act(async () => retired(true));
    assert.deepEqual(writes, []);
    await fixture.click(input(fixture));
    assert.deepEqual(writes, [true]);
});

it('does not invoke an owner after the cell unmounts', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: boolean[] = [];
    await fixture.render(
        table({
            editor: {
                owner: { token: 'A', isCurrent: () => true },
                onChange: (value) => writes.push(value),
            },
        })
    );
    const retired = retainChange(input(fixture));
    await fixture.render(null);
    await act(async () => retired(true));
    assert.deepEqual(writes, []);
});

it('rechecks placement after a currentness callback synchronously retires the editor', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const { flushSync } = await import('react-dom');
    const writes: boolean[] = [];
    let armed = false;
    let retire = () => {};
    const editor: Editor = {
        owner: {
            token: 'A',
            isCurrent() {
                if (armed) flushSync(() => retire());
                return true;
            },
        },
        onChange: (value) => writes.push(value),
    };
    function Host() {
        const [admitted, setAdmitted] = useState(true);
        retire = () => setAdmitted(false);
        return table({ editor: admitted ? editor : undefined });
    }
    await fixture.render(h(Host));
    const stale = retainChange(input(fixture));
    armed = true;
    await act(async () => stale(true));
    assert.equal(fixture.container.querySelector('input'), null);
    assert.deepEqual(writes, []);
});

it('preserves shell height, selection and zero or positive sticky offsets', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const editor: Editor = {
        owner: { token: 'A', isCurrent: () => true },
        onChange: () => assert.fail('Layout is not a gesture'),
    };
    for (const rowHeight of [
        'short',
        'medium',
        'tall',
        'extra-tall',
        'fit-content',
    ] as const) {
        for (const stickyLeft of [undefined, 0, 23.5]) {
            await fixture.render(
                table({
                    rowHeight,
                    stickyLeft,
                    firstRow: true,
                    lastRow: true,
                    selected: true,
                })
            );
            const node = cell(fixture);
            assert.equal(node.getAttribute('data-first-row'), 'true');
            assert.equal(node.getAttribute('data-last-row'), 'true');
            assert.equal(
                node.getAttribute('data-sticky'),
                String(stickyLeft !== undefined)
            );
            assert.equal(
                node.style.getPropertyValue('--mx-sdk-grid-text-left'),
                stickyLeft === undefined ? '' : `${stickyLeft}px`
            );
            assert.equal(
                node
                    .querySelector('.mx-sdk-portal-grid-text-cell__content')
                    ?.getAttribute('data-row-height'),
                rowHeight
            );
            assert.ok(
                node.querySelector('.mx-sdk-portal-grid-text-cell__selection')
            );
            await fixture.render(
                table({ rowHeight, stickyLeft, selected: true, editor })
            );
            assert.equal(
                cell(fixture)
                    .querySelector('.mx-sdk-portal-grid-text-cell__content')
                    ?.getAttribute('data-row-height'),
                'fit-content'
            );
            assert.equal(
                cell(fixture).querySelector(
                    '.mx-sdk-portal-grid-text-cell__selection'
                ),
                null
            );
        }
    }
});
