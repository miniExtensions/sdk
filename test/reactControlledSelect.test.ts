import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { it } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SingleSelectField, MultipleSelectsField } from '../src/react/index.js';

const choices = [
    { id: 'alpha', name: 'Alpha', displayName: 'First' },
    { id: '', name: 'Pending', displayName: 'Pending' },
];
const common = {
    choices,
    availableChoices: choices,
    owner: { token: {}, isCurrent: () => true },
    presentation: 'list' as const,
    inputId: 'field',
    formId: 'form',
    ariaLabel: 'Choose a value',
};
it('canonical controlled Single Select server-renders actual radios and labels without host UI', () => {
    const html = renderToStaticMarkup(
        h(SingleSelectField, {
            ...common,
            value: 'Alpha',
            onValueChange: () => {
                throw new Error('render must not write');
            },
        })
    );
    assert.match(html, /type="radio"/);
    assert.match(html, /First/);
    assert.match(html, /Pending/);
    assert.match(html, /form="form"/);
    assert.match(html, /checked=""/);
});
it('canonical controlled Multiple Select retains removability at the selection cap', () => {
    const html = renderToStaticMarkup(
        h(MultipleSelectsField, {
            ...common,
            value: ['Alpha'],
            maxSelections: 1,
            onValueChange: () => {
                throw new Error('render must not write');
            },
        })
    );
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    assert.equal(inputs.length, 2);
    assert.match(inputs[0]!, /checked=""/);
    assert.doesNotMatch(inputs[0]!, /disabled/);
    assert.match(inputs[1]!, /disabled=""/);
});
it('readonly dropdown retains unavailable canonical values and hides mutation controls', () => {
    const html = renderToStaticMarkup(
        h(MultipleSelectsField, {
            ...common,
            presentation: 'dropdown',
            value: ['Missing', 'Alpha'],
            readOnly: true,
            onValueChange: () => {
                throw new Error('render must not write');
            },
        })
    );
    assert.match(html, /Missing/);
    assert.match(html, /First/);
    assert.doesNotMatch(html, /<button|<input/);
});

it('real controlled list publishes exact ordered values, permits cap reduction, and retires retained actions', async (t) => {
    const { act } = await import('react');
    const window = new Window();
    const globals = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'Node',
        'Event',
        'MouseEvent',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const descriptors = new Map(
        globals.map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ])
    );
    for (const key of globals)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'window'
                    ? window
                    : key === 'IS_REACT_ACT_ENVIRONMENT'
                      ? true
                      : window[key as keyof typeof window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    t.after(async () => {
        await act(async () => root.unmount());
        window.close();
        for (const key of globals) {
            const descriptor = descriptors.get(key);
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    });
    let value = ['Alpha', 'Pending'];
    const writes: string[][] = [];
    let current = true;
    let limitToOneSelection = false;
    const owner = { token: {}, isCurrent: () => current };
    const render = () =>
        root.render(
            h(MultipleSelectsField, {
                ...common,
                value,
                owner,
                maxSelections: 1,
                limitToOneSelection,
                onValueChange: (next) => {
                    writes.push(next);
                    value = next;
                    render();
                },
            })
        );
    await act(async () => render());
    const checked = container.querySelectorAll('input');
    assert.equal(checked.length, 2);
    await act(async () => checked[0]!.click());
    assert.deepEqual(writes, [['Pending']]);
    assert.equal(container.querySelectorAll('input')[0]!.disabled, true);
    await act(async () => container.querySelectorAll('input')[1]!.click());
    assert.deepEqual(writes, [['Pending'], []]);
    const retained = container.querySelectorAll('input')[0]!;
    current = false;
    await act(async () => retained.click());
    assert.deepEqual(writes, [['Pending'], []]);
    current = true;
    limitToOneSelection = true;
    value = ['Alpha'];
    await act(async () => render());
    await act(async () => container.querySelectorAll('input')[1]!.click());
    assert.deepEqual(writes, [['Pending'], [], ['Pending']]);
});

it('same-field list instances retain unique option IDs and label targets', () => {
    const html = renderToStaticMarkup(
        h(
            'div',
            null,
            ...[0, 1].map((instance) =>
                h(SingleSelectField, {
                    ...common,
                    key: instance,
                    value: null,
                    onValueChange: () => {},
                })
            ),
            ...[0, 1].map((instance) =>
                h(MultipleSelectsField, {
                    ...common,
                    key: `multi-${instance}`,
                    value: [],
                    onValueChange: () => {},
                })
            )
        )
    );
    const window = new Window();
    try {
        window.document.body.innerHTML = html;
        const inputs = [...window.document.querySelectorAll('input')];
        assert.equal(inputs.length, choices.length * 4);
        assert.equal(
            new Set(inputs.map((input) => input.id)).size,
            inputs.length
        );
        for (const fieldset of window.document.querySelectorAll('fieldset')) {
            const localInputs = [...fieldset.querySelectorAll('input')];
            const labels = [...fieldset.querySelectorAll('label')];
            assert.deepEqual(
                labels.map((label) => label.htmlFor),
                localInputs.map((input) => input.id)
            );
            for (const input of localInputs) {
                assert.ok(window.document.getElementById(input.id) === input);
            }
        }
        const radioNames = inputs
            .filter((input) => input.type === 'radio')
            .map((input) => input.name);
        assert.equal(new Set(radioNames).size, 2);
    } finally {
        window.close();
    }
});

it('limit-to-one Multiple Select lists retain radio presentation and ordered canonical values', () => {
    const html = renderToStaticMarkup(
        h(MultipleSelectsField, {
            ...common,
            value: ['Alpha'],
            limitToOneSelection: true,
            onValueChange: () => {
                throw Error('render must not write');
            },
        })
    );
    const window = new Window();
    try {
        window.document.body.innerHTML = html;
        const radios = [
            ...window.document.querySelectorAll('input[type=radio]'),
        ];
        assert.equal(radios.length, 2);
        assert.ok(radios[0] instanceof window.HTMLInputElement);
        assert.equal(radios[0].checked, true);
        assert.equal(
            window.document.querySelector('input[type=checkbox]'),
            null
        );
    } finally {
        window.close();
    }
});

it('unavailable canonical selections retain neutral badges in both readonly controls', () => {
    const window = new Window();
    try {
        for (const multiple of [false, true]) {
            const shared = {
                ...common,
                readOnly: true,
                presentation: 'dropdown' as const,
            };
            window.document.body.innerHTML = renderToStaticMarkup(
                multiple
                    ? h(MultipleSelectsField, {
                          ...shared,
                          value: ['Missing'],
                          onValueChange: () => {},
                      })
                    : h(SingleSelectField, {
                          ...shared,
                          value: 'Missing',
                          onValueChange: () => {},
                      })
            );
            const badge = window.document.querySelector('.mx-sdk-select-badge');
            assert.ok(badge instanceof window.HTMLElement);
            assert.equal(badge.textContent, 'Missing');
            assert.equal(badge.style.backgroundColor, 'gray');
            assert.equal(badge.style.color, '#f3f4f6');
        }
    } finally {
        window.close();
    }
});
