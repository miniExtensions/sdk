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
    leaf,
    quickFilterOwner,
    statusChoice,
    title,
} from './fixtures/portalVisitorQuickFilterFixture.js';

const saved = {
    logicalOperator: 'or' as const,
    conditions: [displayed, group('keep', title)],
};

async function mounted(
    t: TestContext,
    host = quickFilterOwner(saved),
    placeQuickSeparately = false
) {
    const f = await htmlPresentationFixture(t);
    const outcomes: PortalVisitorFilterOutcome[] = [];
    const quickContainer = placeQuickSeparately
        ? f.window.document.createElement('div')
        : undefined;
    if (quickContainer) {
        f.container.after(quickContainer);
        t.after(() => quickContainer.remove());
    }
    const control = h(PortalVisitorFilter, {
        port: host.port,
        showDropdowns: true,
        ...(quickContainer
            ? {
                  quickFiltersContainer:
                      quickContainer as unknown as HTMLElement,
              }
            : {}),
        labels: {
            quickFilters: 'Filtres rapides',
            allValues: 'Toutes les valeurs',
        },
        onOutcome: (outcome) => outcomes.push(outcome),
    });
    assert.doesNotMatch(renderToString(control), /Filtres rapides/);
    assert.equal(host.calls.length, 0);
    await f.render(control);
    const toolbar = (quickContainer ?? f.container).querySelector(
        '[role="group"][aria-label="Filtres rapides"]'
    );
    assert.ok(toolbar);
    if (quickContainer) assert.equal(f.container.contains(toolbar), false);
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
    const key = async (
        input: typeof status,
        pressed: string,
        repeat = false,
        event = 'keydown'
    ) => {
        await act(async () =>
            input.dispatchEvent(
                new f.window.KeyboardEvent(event, {
                    key: pressed,
                    repeat,
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
    const f = await mounted(t, quickFilterOwner(saved), true);
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
    await f.key(f.status, 'ArrowDown', true);
    await f.change(f.status, ['']);
    await f.click(f.button('Filter'));
    assert.equal(f.container.querySelector('dialog'), null);
    assert.equal(f.host.calls.length, 1);
    await act(async () => settle?.({ type: 'uncertain' }));
    assert.equal(f.host.calls.length, 1);
    assert.match(
        f.container.querySelector('[role="status"]')?.textContent ?? '',
        /could not be confirmed/
    );
    await f.key(f.status, 'ArrowDown', true);
    await f.change(f.status, ['']);
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

test('the opt-in Quick combobox searches and shares the Advanced draft owner', async (t) => {
    const f = await htmlPresentationFixture(t);
    const host = quickFilterOwner(null, ['labels']);
    const outcomes: PortalVisitorFilterOutcome[] = [];
    const blueStyle = {
        color: 'rgb(18, 52, 86)',
        backgroundColor: 'rgb(219, 234, 254)',
    };
    await f.render(
        h(PortalVisitorFilter, {
            port: host.port,
            showDropdowns: true,
            quickFiltersPresentation: 'combobox',
            quickFilterChoiceStyles: { labels: { blue: blueStyle } },
            onOutcome: (outcome) => outcomes.push(outcome),
        })
    );
    const quick = f.container.querySelector(
        '[role="group"][aria-label="Quick filters"]'
    );
    assert.ok(quick);
    const input = quick.querySelector('input[role="combobox"]');
    assert.ok(input instanceof f.window.HTMLInputElement);
    assert.equal(input.getAttribute('aria-label'), 'Labels');
    const chevron = quick.querySelector('svg.mx-sdk-select-portal-chevron');
    assert.ok(chevron);
    assert.equal(chevron.getAttribute('width'), '16');
    assert.equal(chevron.getAttribute('height'), '16');
    assert.equal(quick.querySelector('button[aria-label="Clear"]'), null);
    const listbox = () => {
        const menu = f.window.document.getElementById(
            input.getAttribute('aria-controls') ?? ''
        );
        assert.equal(menu?.getAttribute('role'), 'listbox');
        assert.ok(menu);
        return menu;
    };
    const option = (label: string) => {
        const item = [...listbox().querySelectorAll('[role="option"]')].find(
            (node) => node.textContent === label
        );
        assert.ok(
            item instanceof f.window.HTMLElement,
            `Expected Quick option ${label}`
        );
        return item;
    };
    const press = async (key: string) => {
        await act(async () => {
            input.dispatchEvent(
                new f.window.KeyboardEvent('keydown', {
                    key,
                    bubbles: true,
                    cancelable: true,
                })
            );
        });
    };

    await act(async () => input.focus());
    await f.click(input);
    await press('ArrowDown');
    assert.equal(input.getAttribute('aria-expanded'), 'true');
    assert.equal(listbox().getAttribute('aria-multiselectable'), 'true');
    assert.equal(option('Blue').getAttribute('aria-selected'), 'false');
    assert.equal(host.calls.length, 0);

    const setValue = Object.getOwnPropertyDescriptor(
        f.window.HTMLInputElement.prototype,
        'value'
    )?.set;
    assert.ok(setValue);
    await act(async () => {
        setValue.call(input, 'Blue');
        input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    });
    assert.deepEqual(
        [...listbox().querySelectorAll('[role="option"]')].map(
            (node) => node.textContent
        ),
        ['Blue']
    );
    assert.equal(host.calls.length, 0);
    await f.click(option('Blue'));
    assert.equal(host.calls.length, 1);
    const condition = host.calls[0].criteria?.conditions[0];
    assert.equal(condition?.type, 'singleCondition');
    assert.deepEqual(condition.setting, {
        fieldType: 'multipleSelects',
        type: 'hasAnyOf',
        idOrName: { type: 'id', id: 'labels' },
        value: ['blue'],
    });
    const accepted = host.port.read()?.criteria;
    const chip = quick.querySelector(
        '.mx-sdk-select-selected .mx-sdk-select-badge'
    );
    assert.ok(chip instanceof f.window.HTMLElement);
    assert.match(chip.textContent ?? '', /Blue/);
    assert.equal(chip.style.color, blueStyle.color);
    assert.equal(chip.style.backgroundColor, blueStyle.backgroundColor);

    await press('ArrowDown');
    const selected = option('Blue');
    assert.equal(selected.getAttribute('aria-selected'), 'true');
    assert.notEqual(selected.getAttribute('aria-disabled'), 'true');
    await press('Escape');
    assert.equal(input.getAttribute('aria-expanded'), 'false');
    assert.equal(f.window.document.activeElement, input);

    const advanced = [...f.container.querySelectorAll('button')].find(
        (node) => node.textContent === 'Filter'
    );
    assert.ok(advanced);
    await f.click(advanced);
    const dialog = f.container.querySelector('dialog[open]');
    assert.ok(dialog);
    await f.click(input);
    await press('ArrowDown');
    await press('Enter');
    assert.equal(host.calls.length, 1);
    assert.deepEqual(host.port.read()?.criteria, accepted);
    const done = [...dialog.querySelectorAll('button')].find(
        (node) => node.textContent === 'Done'
    );
    assert.ok(done);
    await f.click(done);
    assert.equal(host.calls.length, 1);
    assert.deepEqual(
        outcomes.map(({ type }) => type),
        ['allocated', 'unchanged']
    );
    f.unchangedEffects();
});

test('mounted quick Filter leaves a renamed isExactly rule intact when the select returns the same members in DOM order', async (t) => {
    const effective = {
        fieldType: 'multipleSelects' as const,
        type: 'isExactly' as const,
        idOrName: { type: 'id' as const, id: 'labels' },
        value: ['blue', 'red'],
    };
    const criteria = {
        logicalOperator: 'or' as const,
        conditions: [
            group('keep', title),
            leaf('saved-labels', {
                ...effective,
                idOrName: { type: 'name', name: 'Former labels' },
            }),
        ],
    };
    const host = quickFilterOwner(criteria);
    host.update({ effectiveSettings: { 'saved-labels': effective } });
    const f = await mounted(t, host);
    assert.deepEqual(
        Array.from(f.labels.selectedOptions, (option) => option.value),
        ['red', 'blue']
    );
    await f.key(f.labels, 'ArrowDown');
    await f.change(f.labels, ['red', 'blue']);
    assert.equal(host.calls.length, 0);
    assert.deepEqual(host.port.read()?.criteria, criteria);
    await f.key(f.labels, 'ArrowDown');
    await f.change(f.labels, ['red']);
    assert.equal(host.calls.length, 1);
    assert.deepEqual(host.calls[0].criteria?.conditions.slice(1), [
        group('keep', title),
    ]);
    const replacement = host.calls[0].criteria?.conditions[0];
    assert.equal(replacement?.type, 'singleCondition');
    assert.deepEqual(replacement.setting, {
        ...effective,
        type: 'hasAnyOf',
        value: ['red'],
    });
});

test('a held quick-Filter key continues on its own acknowledged successor and stops after A→B→A', async (t) => {
    const f = await mounted(t, quickFilterOwner(null));
    await f.key(f.status, 'ArrowDown');
    await f.change(f.status, ['red']);
    assert.equal(f.host.calls.length, 1);
    await f.key(f.status, 'ArrowDown', true);
    await f.change(f.status, ['blue']);
    assert.equal(f.host.calls.length, 2);
    assert.equal(f.host.calls[1].stamp.generation, 2);

    const previous = f.host.port.read();
    assert.ok(previous);
    await act(async () => {
        f.host.update({
            stamp: { ...previous.stamp, generation: 4, viewId: 'view-b' },
        });
        f.host.update({ stamp: { ...previous.stamp, generation: 5 } });
    });
    assert.equal(f.toolbar.querySelectorAll('select')[1], f.status);
    await f.key(f.status, 'ArrowDown', true);
    await f.change(f.status, ['red']);
    assert.equal(f.host.calls.length, 2);
    await f.key(f.status, 'ArrowDown', false, 'keyup');
    await f.key(f.status, 'ArrowDown');
    await f.change(f.status, ['red']);
    assert.equal(f.host.calls.length, 3);
    assert.equal(f.host.calls[2].stamp.generation, 5);
});

test('an already-held key cannot borrow authority from a newly focused quick Filter', async (t) => {
    const f = await mounted(t, quickFilterOwner(null));
    await act(async () => f.status.focus());
    await f.key(f.status, 'ArrowDown');
    await f.change(f.status, ['red']);
    assert.equal(f.host.calls.length, 1);

    await act(async () => f.labels.focus());
    assert.equal(f.window.document.activeElement, f.labels);
    await f.key(f.labels, 'ArrowDown', true);
    await f.change(f.labels, ['blue']);
    assert.equal(f.host.calls.length, 1);
    assert.deepEqual(f.host.port.read()?.criteria, f.host.calls[0].criteria);

    await f.key(f.labels, 'ArrowDown', false, 'keyup');
    await f.key(f.labels, 'ArrowDown');
    await f.change(f.labels, ['blue']);
    assert.equal(f.host.calls.length, 2);
    const condition = f.host.calls[1].criteria?.conditions[0];
    assert.equal(condition?.type, 'singleCondition');
    assert.deepEqual(condition.setting, {
        fieldType: 'multipleSelects',
        type: 'hasAnyOf',
        idOrName: { type: 'id', id: 'labels' },
        value: ['blue'],
    });
});
