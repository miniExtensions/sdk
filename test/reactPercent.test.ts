import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    NumberField,
    PercentField,
    FieldRenderer,
    renderPercentField,
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
    config: FieldConfig<'percent'> = {},
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
    loaded.payload.fieldIdsInForm.push('percent');
    if (initial !== undefined) loaded.payload.formRecord.data.percent = initial;
    loaded.payload.fieldIdsToSchemas.percent = {
        fieldType: 'percent',
        airtableField: {
            id: 'percent',
            name: 'Fraction',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'percent', options: { precision: 2 } },
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
        getScope: () => ({ ownerId: 'percent-test', revision: 0 }),
        canWrite: () => scope.writable,
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('percent');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'percent',
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
                renderers: { renderPercentField },
                fallback: () => null,
            }),
        props: () => {
            const snapshot = host.getSnapshot();
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'percent'
            )
                throw Error('Percent props expected');
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

it('PercentField and NumberField keep native fractions and precision without scaling, suffixes or range limits', async (t) => {
    const f = await fixture(
        t,
        {
            numberSeparator: 'period-comma',
            showThousandsSeparator: true,
            showAsProgressBar: true,
        },
        0.25
    );
    for (const Component of [PercentField, NumberField]) {
        await f.render(
            h(Component, { binding: f.binding, className: 'fraction' })
        );
        assert.ok(f.container.querySelector('.mx-sdk-number-field.fraction'));
        assert.equal(f.input().value, '0.25');
        assert.equal(f.input().type, 'text');
        assert.equal(f.input().inputMode, 'decimal');
        assert.equal(f.input().hasAttribute('min'), false);
        assert.equal(f.input().hasAttribute('max'), false);
        assert.equal(f.container.textContent, 'Fraction');
        assert.equal(
            f.container.querySelector('progress,[role=progressbar]'),
            null
        );
        const revision = f.binding.getSnapshot().revision;
        await act(async () => {
            f.input().dispatchEvent(
                new f.window.FocusEvent('focusin', { bubbles: true })
            );
            f.input().dispatchEvent(
                new f.window.FocusEvent('focusout', { bubbles: true })
            );
        });
        assert.equal(f.binding.getSnapshot().revision, revision);
        for (const [input, value] of [
            ['0.25', 0.25],
            ['0.1234567890123', 0.1234567890123],
            ['-0.375', -0.375],
            ['1.5', 1.5],
            ['25', 25],
            ['2.5e-3', 0.0025],
        ] as const) {
            await f.edit(input);
            assert.equal(f.binding.getSnapshot().value, value);
            assert.equal(f.input().value, input);
            assert.equal(f.input().getAttribute('aria-invalid'), 'false');
        }
        await act(async () => f.binding.setValue(0.25));
    }
});

it('partial and invalid percent drafts remain owner-held through StrictMode, remount and refresh until an external replacement', async (t) => {
    const f = await fixture(t, {}, 0.25);
    const model = f.binding.scalar!;
    const nativeRevision = f.binding.getSnapshot().revision;
    await f.render(h(PercentField, { binding: f.binding }));
    for (const draft of [
        '-',
        '1e',
        '25%',
        '0,25',
        'NaN',
        'Infinity',
        '1e400',
    ]) {
        await f.edit(draft);
        await act(async () => f.owner.refresh());
        await f.render(null);
        await f.render(f.tree());
        assert.equal(f.input().value, draft);
        assert.equal(f.binding.getSnapshot().value, 0.25);
        assert.equal(f.binding.getSnapshot().revision, nativeRevision);
        assert.equal(f.binding.getSnapshot().dirty, false);
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    }
    await act(async () => {
        await assert.rejects(() => f.owner.save());
    });
    assert.equal(f.binding.scalar, model);
    assert.equal(model.getState().retired, false);
    await act(async () => f.binding.setValue(0.8754321));
    assert.equal(f.input().value, '0.8754321');
    assert.equal(f.input().getAttribute('aria-invalid'), 'false');
    await f.edit('-');
    await f.render(h(NumberField, { binding: f.binding }));
    assert.equal(f.input().value, '-');
    assert.equal(f.binding.getSnapshot().value, 0.8754321);
    await f.edit('0.5');
    assert.equal(f.binding.getSnapshot().value, 0.5);
});

for (const initial of [undefined, null, 0] as const)
    it(`preserves initial ${initial === undefined ? 'absence' : initial} until a deliberate empty edit`, async (t) => {
        const f = await fixture(t, {}, initial);
        const revision = f.binding.getSnapshot().revision;
        await f.render(h(PercentField, { binding: f.binding }));
        await f.render(null);
        await f.render(f.tree());
        assert.equal(f.input().value, initial === 0 ? '0' : '');
        assert.equal(f.binding.getSnapshot().value, initial);
        assert.equal(f.binding.getSnapshot().revision, revision);
        assert.equal(f.binding.getSnapshot().dirty, false);
        await f.edit('0');
        assert.equal(f.binding.getSnapshot().value, 0);
        await f.edit('');
        assert.equal(f.binding.getSnapshot().value, null);
        assert.equal(f.input().value, '');
    });

it('requires a matching editable scalar and leaves readonly native fractions unscaled in every host context', async (t) => {
    const f = await fixture(t, {}, 0.25);
    const props = f.props();
    if (props.capability.type !== 'editable' || !props.capability.scalar)
        throw Error('Expected numeric bridge');
    const cap = props.capability;
    const scalar = cap.scalar!;
    let rawWrites = 0;
    const variants: FieldRendererProps<'percent'>[] = [
        { ...props, pending: true },
        { ...props, computed: true },
        { ...props, displayConfig: { readOnly: true } },
        { ...props, writeConfig: { readOnly: true } },
        { ...props, capability: { type: 'readonly' } },
        {
            ...props,
            capability: {
                type: 'editable',
                setValue: () => {
                    rawWrites++;
                    return { accepted: true };
                },
            },
        },
        ...[
            { ...scalar.state, canEdit: false },
            { ...scalar.state, kind: 'checkbox' as const },
            {
                ...scalar.state,
                kind: 'duration' as const,
                focused: false,
                durationFormat: 'h:mm:ss' as const,
            },
        ].map((state) => ({
            ...props,
            capability: { ...cap, scalar: { ...scalar, state } },
        })),
    ];
    for (const variant of variants) {
        await f.render(renderPercentField(variant));
        assert.equal(f.input().disabled, true);
        await f.edit('99');
        assert.equal(f.input().value, '0.25');
        assert.equal(f.binding.getSnapshot().value, 0.25);
    }
    assert.equal(rawWrites, 0);
    for (const context of [
        'form',
        'portal-cell',
        'portal-detail',
        'linked-detail',
    ] as const)
        for (const value of [undefined, null, 0, 0.123456789, NaN, Infinity]) {
            await f.render(
                renderPercentField({
                    ...props,
                    context,
                    value,
                    capability: { type: 'readonly' },
                })
            );
            assert.equal(f.input().disabled, true);
            assert.equal(
                f.input().value,
                typeof value === 'number' && Number.isFinite(value)
                    ? String(value)
                    : ''
            );
        }
    await f.render(
        renderPercentField({
            ...props,
            capability: {
                ...cap,
                scalar: {
                    ...scalar,
                    state: { ...scalar.state, retired: true },
                },
            },
        })
    );
    assert.equal(f.container.querySelector('input'), null);
});

it('associates plain owner feedback and applies display or write masking, required and hidden-title policy', async (t) => {
    const f = await fixture(
        t,
        { title: 'Stored fraction', placeholderText: '0.25' },
        0.25
    );
    const props = f.props();
    const validation = [
        {
            fieldId: 'percent',
            fieldTitle: 'Stored fraction',
            errorMessage: 'Owner validation',
        },
    ];
    await f.render(
        h(
            'div',
            null,
            renderPercentField({ ...props, error: '<b>Review fraction</b>' }),
            renderPercentField({ ...props, error: '<b>Review fraction</b>' })
        )
    );
    const inputs = f.container.querySelectorAll('input');
    assert.notEqual(inputs[0].id, inputs[1].id);
    assert.equal(f.container.querySelector('label')!.htmlFor, f.input().id);
    assert.equal(f.input().placeholder, '0.25');
    const feedback = f.window.document.getElementById(
        f.input().getAttribute('aria-describedby')!
    )!;
    assert.equal(feedback.textContent, '<b>Review fraction</b>');
    assert.equal(feedback.querySelector('b'), null);
    for (const error of ['', null]) {
        await f.render(renderPercentField({ ...props, error, validation }));
        assert.equal(
            f.container.querySelector('[role=status]')!.textContent,
            error === '' ? '' : 'Owner validation'
        );
    }
    for (const which of ['displayConfig', 'writeConfig'] as const) {
        await f.render(
            renderPercentField({
                ...props,
                title: ' ',
                displayConfig: { showTitle: false },
                writeConfig: {},
                [which]: {
                    showTitle: false,
                    maskPasswordOnLoginScreen: true,
                    required: true,
                },
            })
        );
        assert.equal(f.input().type, 'password');
        assert.equal(f.input().value, '0.25');
        assert.equal(f.input().getAttribute('aria-label'), 'Fraction');
        assert.equal(f.input().getAttribute('aria-required'), 'true');
        assert.equal(f.container.querySelector('label'), null);
    }
});

it('retained percent actions respect configuration and permission changes, then hidden and retired owners remove controls', async (t) => {
    const f = await fixture(t, {}, 0.25);
    const props = f.props();
    await f.render(renderPercentField(props));
    f.scope.revision++;
    await f.edit('0.75');
    assert.equal(f.input().value, '0.25');
    assert.equal(f.binding.getSnapshot().dirty, false);
    await f.render(h(PercentField, { binding: f.binding }));
    f.scope.writable = false;
    await f.edit('0.5');
    assert.equal(f.binding.getSnapshot().value, 0.25);
    await act(async () => f.owner.refresh());
    assert.equal(f.input().disabled, true);
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    assert.equal(f.container.querySelector('input'), null);
    await act(async () => f.owner.destroy());
    assert.equal(f.container.querySelector('input'), null);
    if (props.capability.type !== 'editable' || !props.capability.scalar)
        throw Error('Expected numeric bridge');
    assert.equal(props.capability.scalar.setInput('0.9'), false);
});

it('retired or wrong-kind borrowed models render nothing while custom rendering remains app-owned', async (t) => {
    const f = await fixture(t, {}, 0.25);
    const original = f.binding.getSnapshot();
    const wrongSnapshot = {
        ...original,
        scalar: { ...original.scalar!, kind: 'checkbox' as const },
    };
    const wrong = {
        ...f.binding,
        getSnapshot: () => wrongSnapshot,
        subscribe: () => () => {},
    };
    await f.render(h(PercentField, { binding: wrong }));
    assert.equal(f.container.querySelector('input'), null);
    await f.render(h(PercentField, { binding: f.owner.field('fld_title') }));
    assert.equal(f.container.querySelector('input'), null);
    await f.render(h(PercentField, { binding: f.binding }));
    await act(async () => f.binding.scalar!.destroy());
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(f.binding.getSnapshot().value, 0.25);
    assert.equal(f.binding.getSnapshot().retired, false);
    await f.render(
        h(PercentField, {
            binding: f.binding,
            render: ({ snapshot, binding }) =>
                h('output', null, `${snapshot.value}:${binding === f.binding}`),
        })
    );
    assert.equal(f.container.textContent, '0.25:true');
});
