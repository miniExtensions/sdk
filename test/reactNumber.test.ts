import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    NumberField,
    FieldRenderer,
    renderNumberField,
} from '../src/react/index.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { createFormFieldRendererHost } from '../src/ui/rendererHosts.js';
import type {
    FieldConfig,
    FieldRendererProps,
} from '../src/ui/rendererRegistry.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';

async function fixture(
    t: TestContext,
    config: FieldConfig<'number'> = {},
    initial: number | null | undefined = undefined
) {
    const window = new Window();
    for (const key of ['AbortController', 'AbortSignal'] as const)
        Object.defineProperty(window, key, { value: globalThis[key] });
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    const loaded = loadedForm();
    loaded.payload.fieldIdsInForm.push('number');
    if (initial !== undefined) loaded.payload.formRecord.data.number = initial;
    loaded.payload.fieldIdsToSchemas.number = {
        fieldType: 'number',
        airtableField: {
            id: 'number',
            name: 'Quantity',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'number', options: { precision: 2 } },
        },
        miniExtConfig: config,
    };
    let requests = 0;
    const scope = { current: true, writable: true, visible: true, revision: 0 };
    const owner = createFormFieldBindings({
        loaded,
        saveOptions: formSaveOptions(),
        client: createMiniExtensionsClient({
            apiOrigin: 'https://synthetic.invalid',
            fetch: async () => {
                requests++;
                throw Error('No implicit requests');
            },
        }),
        getScope: () => ({ ownerId: 'number-test', revision: 0 }),
        canWrite: () => scope.writable,
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('number');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'number',
        isCurrent: () => scope.current,
        configurationRevision: () => scope.revision,
    });
    t.after(async () => {
        await act(async () => root.unmount());
        host.dispose();
        owner.destroy();
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
        assert.equal(requests, 0);
    });
    const input = () => {
        const node = container.querySelector('input');
        assert.ok(node);
        return node;
    };
    return {
        window,
        container,
        owner,
        binding,
        host,
        scope,
        input,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        tree: () =>
            h(FieldRenderer, {
                host,
                renderers: { renderNumberField },
                fallback: () => null,
            }),
        props: () => {
            const snapshot = host.getSnapshot();
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'number'
            )
                throw Error('Number props expected');
            return snapshot.fields[0];
        },
        edit: async (value: string) => {
            await act(async () => {
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                )!.set!.call(input(), value);
                input().dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
        },
    };
}

it('binding and slot retain owner input through StrictMode/remount, including incomplete drafts', async (t) => {
    const f = await fixture(t, {}, 12.5);
    const scalar = f.binding.scalar;
    const before = scalar!.getState().revision;
    await f.render(h(NumberField, { binding: f.binding, className: 'custom' }));
    assert.ok(f.container.querySelector('.mx-sdk-number-field.custom'));
    assert.equal(f.input().type, 'text');
    assert.equal(f.input().inputMode, 'decimal');
    assert.equal(f.input().value, '12.5');
    assert.equal(scalar!.getState().revision, before);
    for (const partial of [
        '-',
        '1e',
        'NaN',
        'Infinity',
        '1e400',
        ' ',
        '0x10',
    ]) {
        await f.edit(partial);
        assert.equal(f.input().value, partial);
        assert.equal(f.binding.getSnapshot().value, 12.5);
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    }
    const revision = scalar!.getState().revision;
    await act(async () => {
        await assert.rejects(() => f.owner.save());
    });
    await f.render(null);
    await f.render(f.tree());
    assert.equal(f.input().value, '0x10');
    assert.equal(f.binding.scalar, scalar);
    assert.equal(scalar!.getState().revision, revision);
    await f.edit('-2.75');
    assert.equal(f.binding.getSnapshot().value, -2.75);
    assert.equal(f.input().getAttribute('aria-invalid'), 'false');
    await f.edit('1e2');
    assert.equal(f.binding.getSnapshot().value, 100);
    assert.equal(f.input().value, '1e2');
    await f.edit('');
    assert.equal(f.binding.getSnapshot().value, null);
    await act(async () => {
        f.binding.setValue(0);
    });
    assert.equal(f.input().value, '0');
    await act(async () => {
        f.binding.setValue(7.123456);
    });
    assert.equal(
        f.input().value,
        '7.123456',
        'presentation must not round native precision'
    );
});

it('keeps initial absence and null until a deliberate edit and does not manufacture a scalar', async (t) => {
    const f = await fixture(t, {}, undefined);
    await f.render(f.tree());
    assert.equal(f.input().value, '');
    assert.equal(f.binding.getSnapshot().dirty, false);
    assert.equal(f.binding.getSnapshot().value, undefined);
    await f.render(null);
    await f.render(h(NumberField, { binding: f.binding }));
    assert.equal(f.binding.getSnapshot().value, undefined);
    await f.edit('0');
    assert.equal(f.binding.getSnapshot().value, 0);
    await f.edit('');
    assert.equal(f.binding.getSnapshot().value, null);
    let writes = 0;
    await f.render(
        renderNumberField({
            ...f.props(),
            value: 42,
            capability: {
                type: 'editable',
                setValue: () => {
                    writes++;
                    return { accepted: true };
                },
            },
        })
    );
    assert.equal(f.input().value, '42');
    assert.equal(f.input().disabled, true);
    await f.edit('99');
    assert.equal(f.input().value, '42');
    assert.equal(writes, 0);
});

it('associates unique labels and plain-text feedback, honors hidden titles and contains Portal events', async (t) => {
    const f = await fixture(t, {
        title: 'Amount',
        required: true,
        placeholderText: 'Enter an amount',
    });
    let rows = 0;
    const row = () => {
        rows++;
    };
    const props = { ...f.props(), error: '<b>Enter a quantity</b>' };
    await f.render(
        h(
            'div',
            {
                onClick: row,
                onChange: row,
                onPointerDown: row,
                onDoubleClick: row,
                onAuxClick: row,
                onKeyDown: row,
                onKeyUp: row,
                onCompositionStart: row,
                onCompositionEnd: row,
            },
            renderNumberField(props),
            renderNumberField(props)
        )
    );
    const ids = Array.from(f.container.querySelectorAll('[id]')).map(
        (node) => node.id
    );
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(f.container.querySelector('label')!.htmlFor, f.input().id);
    assert.equal(f.container.querySelector('label')!.textContent, 'Amount');
    assert.equal(f.input().placeholder, 'Enter an amount');
    assert.equal(f.input().getAttribute('aria-required'), 'true');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    const feedback = f.window.document.getElementById(
        f.input().getAttribute('aria-describedby')!
    )!;
    assert.equal(feedback.textContent, '<b>Enter a quantity</b>');
    assert.equal(feedback.querySelector('b'), null);
    assert.equal(feedback.getAttribute('aria-live'), 'polite');
    await f.edit('3');
    await act(async () => {
        for (const type of [
            'click',
            'dblclick',
            'auxclick',
            'pointerdown',
            'keydown',
            'keyup',
            'compositionstart',
            'compositionend',
        ])
            f.input().dispatchEvent(
                new f.window.Event(type, { bubbles: true })
            );
    });
    assert.equal(rows, 0);
    await f.render(
        renderNumberField(
            {
                ...props,
                title: ' ',
                error: '',
                displayConfig: { showTitle: false, placeholderText: '' },
                validation: [
                    {
                        fieldId: 'number',
                        fieldTitle: 'Quantity',
                        errorMessage: 'Fallback must stay hidden',
                    },
                ],
            },
            { className: '' }
        )
    );
    assert.equal(f.container.querySelector('label'), null);
    assert.equal(f.input().getAttribute('aria-label'), 'Quantity');
    assert.equal(f.input().placeholder, '');
    assert.equal(f.container.querySelector('[role=status]')!.textContent, '');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    assert.equal(f.input().getAttribute('aria-describedby'), null);
});

it('honors readonly, pending, computed and missing or mismatched scalar capabilities', async (t) => {
    const f = await fixture(t, {}, 5);
    const props = f.props();
    assert.equal(props.capability.type, 'editable');
    if (props.capability.type !== 'editable') throw Error('Editable expected');
    const cap = props.capability;
    assert.ok(cap.scalar);
    const variants: FieldRendererProps<'number'>[] = [
        { ...props, pending: true },
        { ...props, computed: true },
        { ...props, displayConfig: { readOnly: true } },
        { ...props, writeConfig: { readOnly: true } },
        { ...props, capability: { type: 'readonly' } },
        {
            ...props,
            capability: {
                ...cap,
                scalar: {
                    ...cap.scalar,
                    state: { ...cap.scalar.state, canEdit: false },
                },
            },
        },
        {
            ...props,
            capability: {
                ...cap,
                scalar: {
                    ...cap.scalar,
                    state: { ...cap.scalar.state, kind: 'checkbox' },
                },
            },
        },
    ];
    for (const variant of variants) {
        await f.render(renderNumberField(variant));
        assert.equal(f.input().disabled, true);
        await f.edit('88');
        assert.equal(f.binding.getSnapshot().value, 5);
        assert.equal(f.input().value, '5');
    }
    await f.render(
        renderNumberField({
            ...props,
            capability: {
                ...cap,
                scalar: {
                    ...cap.scalar,
                    state: { ...cap.scalar.state, retired: true },
                },
            },
        })
    );
    assert.equal(f.container.querySelector('input'), null);
    for (const value of [null, undefined, NaN]) {
        await f.render(
            renderNumberField({
                ...props,
                value,
                capability: { type: 'readonly' },
            })
        );
        assert.equal(f.input().value, '');
    }
});

it('refuses stale displayed actions after configuration or permissions change without inventing input', async (t) => {
    const f = await fixture(t, {}, 7);
    await f.render(renderNumberField(f.props()));
    f.scope.revision++;
    await f.edit('9');
    assert.equal(f.binding.getSnapshot().value, 7);
    assert.equal(f.input().value, '7');
    await f.render(h(NumberField, { binding: f.binding }));
    f.scope.writable = false;
    await f.edit('10');
    assert.equal(f.binding.getSnapshot().value, 7);
    assert.equal(f.input().value, '7');
    await act(async () => f.owner.refresh());
    await f.render(h(NumberField, { binding: f.binding }));
    assert.equal(f.input().disabled, true);
});

it('binding presentation honors configuration and custom rendering without taking ownership', async (t) => {
    const f = await fixture(
        t,
        {
            showTitle: false,
            readOnly: true,
            required: true,
            placeholderText: 'Optional number',
        },
        null
    );
    await f.render(h(NumberField, { binding: f.binding }));
    assert.equal(f.input().disabled, true);
    assert.equal(f.input().getAttribute('aria-label'), 'Quantity');
    assert.equal(f.input().getAttribute('aria-required'), 'true');
    assert.equal(f.input().placeholder, 'Optional number');
    await f.render(
        h(NumberField, {
            binding: f.binding,
            render: ({ binding }) =>
                h('output', null, String(binding.getSnapshot().value)),
        })
    );
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(f.container.querySelector('output')!.textContent, 'null');
});

it('preserves numeric login masking from display or write policy', async (t) => {
    const f = await fixture(t, { maskPasswordOnLoginScreen: true }, 1234);
    await f.render(h(NumberField, { binding: f.binding }));
    assert.equal(f.input().type, 'password');
    assert.equal(f.input().inputMode, 'decimal');
    for (const [displayConfig, writeConfig] of [
        [{ maskPasswordOnLoginScreen: true }, {}],
        [{}, { maskPasswordOnLoginScreen: true }],
    ]) {
        await f.render(
            renderNumberField({
                ...f.props(),
                displayConfig,
                writeConfig,
                capability: { type: 'readonly' },
            })
        );
        assert.equal(f.input().type, 'password');
        assert.equal(f.input().value, '1234');
        assert.equal(f.input().disabled, true);
    }
});

it('hidden and retired owners do not leave an editable control or reset retained input', async (t) => {
    const f = await fixture(t, {}, 3);
    await f.render(f.tree());
    await f.edit('-');
    f.scope.visible = false;
    await f.render(h(NumberField, { binding: f.binding }));
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(f.binding.getSnapshot().value, 3);
    f.scope.visible = true;
    await act(async () => f.owner.destroy());
    await f.render(h(NumberField, { binding: f.binding }));
    assert.equal(f.container.querySelector('input'), null);
});
