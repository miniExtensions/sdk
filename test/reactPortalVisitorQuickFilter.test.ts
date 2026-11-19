import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { PortalVisitorFilter } from '../src/react/PortalVisitorFilter.js';
import type { PortalVisitorFilterOutcome } from '../src/portals/visitorFilter.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';
import {
    displayed,
    group,
    quickFilterOwner,
    statusChoice,
    title,
} from './fixtures/portalVisitorQuickFilterFixture.js';

const saved = {
    logicalOperator: 'or' as const,
    conditions: [displayed, group('keep', title)],
};

async function mounted(t: TestContext, host = quickFilterOwner(saved)) {
    const f = await htmlPresentationFixture(t);
    const outcomes: PortalVisitorFilterOutcome[] = [];
    const control = h(PortalVisitorFilter, {
        port: host.port,
        showDropdowns: true,
        labels: {
            quickFilters: 'Filtres rapides',
            allValues: 'Toutes les valeurs',
        },
        onOutcome: (outcome) => outcomes.push(outcome),
    });
    assert.doesNotMatch(renderToString(control), /Filtres rapides/);
    assert.equal(host.calls.length, 0);
    await f.render(control);
    const toolbar = f.container.querySelector(
        '[role="group"][aria-label="Filtres rapides"]'
    );
    assert.ok(toolbar);
    const [labels, status] = toolbar.querySelectorAll('select');
    assert.ok(labels instanceof f.window.HTMLSelectElement);
    assert.ok(status instanceof f.window.HTMLSelectElement);
    const button = (name: string) => {
        const found = Array.from(f.container.querySelectorAll('button')).find(
            (node) => node.textContent === name
        );
        assert.ok(found, name);
        return found;
    };
    const key = async (input: typeof status, pressed: string) => {
        await act(async () =>
            input.dispatchEvent(
                new f.window.KeyboardEvent('keydown', {
                    key: pressed,
                    bubbles: true,
                })
            )
        );
    };
    const change = async (input: typeof status, values: string[]) => {
        await act(async () => {
            if (input.multiple) {
                for (const option of input.options)
                    option.selected = values.includes(option.value);
            } else {
                input.value = values[0] ?? '';
            }
            input.dispatchEvent(
                new f.window.Event('change', { bubbles: true })
            );
        });
    };
    return {
        ...f,
        host,
        outcomes,
        toolbar,
        labels,
        status,
        button,
        key,
        change,
    };
}

test('mounted quick Filter retains configured labels and submits one replacement and one Clear', async (t) => {
    const f = await mounted(t);
    assert.equal(f.labels.multiple, true);
    assert.equal(f.status.multiple, false);
    assert.equal(f.status.options[0].textContent, 'Toutes les valeurs');
    assert.equal(f.status.value, 'red');
    await f.key(f.status, 'ArrowDown');
    await f.change(f.status, ['red']);
    assert.equal(f.host.calls.length, 0);
    await f.key(f.status, 'ArrowDown');
    await f.change(f.status, ['blue']);
    assert.equal(f.host.calls.length, 1);
    const changed = f.host.calls[0].criteria?.conditions[0];
    assert.equal(changed?.type, 'singleCondition');
    assert.deepEqual(changed.setting, statusChoice('blue'));
    assert.deepEqual(f.host.calls[0].criteria?.conditions.slice(1), [
        group('keep', title),
    ]);
    await f.key(f.status, 'Home');
    await f.change(f.status, ['']);
    assert.equal(f.host.calls.length, 2);
    assert.deepEqual(f.host.calls[1].criteria, {
        logicalOperator: 'or',
        conditions: [group('keep', title)],
    });
    assert.deepEqual(
        f.outcomes.map((outcome) => outcome.type),
        ['allocated', 'allocated']
    );
});

test('mounted quick Filter drops a retained change on the same select after a view changes and returns', async (t) => {
    const f = await mounted(t);
    await f.key(f.status, 'ArrowDown');
    const original = f.host.port.read();
    assert.ok(original);
    await act(async () => {
        f.host.update({
            stamp: { ...original.stamp, viewId: 'view-b', generation: 2 },
        });
        f.host.update({ stamp: { ...original.stamp, generation: 3 } });
    });
    assert.equal(f.toolbar.querySelectorAll('select')[1], f.status);
    await f.change(f.status, ['blue']);
    assert.equal(f.host.calls.length, 0);
    assert.match(
        f.container.querySelector('[role="status"]')?.textContent ?? '',
        /changed/
    );
    await f.key(f.status, 'ArrowDown');
    await f.change(f.status, ['blue']);
    assert.equal(f.host.calls.length, 1);
    assert.equal(f.host.calls[0].stamp.generation, 3);
});

test('mounted quick and advanced Filter share one active operation and never retry an unknown outcome', async (t) => {
    const f = await mounted(t);
    await f.click(f.button('Filter'));
    await f.key(f.status, 'ArrowDown');
    await f.change(f.status, ['blue']);
    assert.equal(f.host.calls.length, 0);
    await f.click(f.button('Done'));
    let settle: ((result: PortalVisitorFilterOutcome) => void) | undefined;
    f.host.respondWith(
        () =>
            new Promise((resolve) => {
                settle = resolve;
            })
    );
    await f.key(f.status, 'ArrowDown');
    await f.change(f.status, ['blue']);
    assert.ok(settle);
    await f.click(f.button('Filter'));
    assert.equal(f.container.querySelector('dialog'), null);
    assert.equal(f.host.calls.length, 1);
    await act(async () => settle?.({ type: 'uncertain' }));
    assert.equal(f.host.calls.length, 1);
    assert.match(
        f.container.querySelector('[role="status"]')?.textContent ?? '',
        /could not be confirmed/
    );
    await f.click(f.button('Filter'));
    assert.ok(f.container.querySelector('dialog[open]'));
    assert.equal(f.host.calls.length, 1);
});

test('mounted multi-value quick Filter sends only selected choice IDs and clears through its button', async (t) => {
    const f = await mounted(t, quickFilterOwner(null));
    await f.key(f.labels, 'ArrowDown');
    await f.change(f.labels, ['blue', 'red']);
    assert.equal(f.host.calls.length, 1);
    const condition = f.host.calls[0].criteria?.conditions[0];
    assert.equal(condition?.type, 'singleCondition');
    assert.deepEqual(condition.setting, {
        fieldType: 'multipleSelects',
        type: 'hasAnyOf',
        idOrName: { type: 'id', id: 'labels' },
        value: ['red', 'blue'],
    });
    const clear = f.button('Clear filters');
    await act(async () => clear.focus());
    await f.click(clear);
    assert.equal(f.host.calls.length, 2);
    assert.equal(f.host.calls[1].criteria, null);
    assert.equal(clear.disabled, true);
    assert.equal(f.window.document.activeElement, f.labels);
});
