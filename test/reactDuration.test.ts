import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    NumberField,
    DurationField,
    FieldRenderer,
    renderDurationField,
} from '../src/react/index.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { createFormFieldRendererHost } from '../src/ui/rendererHosts.js';
import type {
    FieldConfig,
    FieldRendererProps,
} from '../src/ui/rendererRegistry.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import type { DurationFormat } from '../src/ui/durationInput.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';

const formats = [
    'h:mm',
    'h:mm:ss',
    'h:mm:ss.S',
    'h:mm:ss.SS',
    'h:mm:ss.SSS',
] as const;
const canonical: {
    inputCases: {
        id: string;
        durationFormat: DurationFormat;
        input: string;
        seconds?: number | null;
        formattedNative?: string;
    }[];
    nativeCases: {
        durationFormat: DurationFormat;
        secondsText: string;
        formatted: string;
    }[];
} = JSON.parse(
    readFileSync('test/fixtures/duration-input-canonical.json', 'utf8')
);

async function fixture(
    t: TestContext,
    config: FieldConfig<'duration'> = {},
    initial: number | null = null,
    missing = false,
    durationFormat: DurationFormat = 'h:mm:ss'
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
    loaded.payload.fieldIdsInForm.push('duration', 'number');
    if (!missing) loaded.payload.formRecord.data.duration = initial;
    loaded.payload.formRecord.data.number = 1.25;
    loaded.payload.fieldIdsToSchemas.duration = {
        fieldType: 'duration',
        airtableField: {
            id: 'duration',
            name: 'Elapsed time',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'duration', options: { durationFormat } },
        },
        miniExtConfig: config,
    };
    loaded.payload.fieldIdsToSchemas.number = {
        fieldType: 'number',
        airtableField: {
            id: 'number',
            name: 'Count',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'number', options: { precision: 2 } },
        },
        miniExtConfig: {},
    };
    let requests = 0;
    const scope = {
        current: true,
        writable: true,
        visible: true,
        revision: 0,
    };
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
        getScope: () => ({ ownerId: 'duration-test', revision: 0 }),
        canWrite: () => scope.writable,
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('duration');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'duration',
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
        binding,
        host,
        owner,
        scope,
        input,
        loaded,
        focus: async (focused: boolean) => {
            await act(async () =>
                input().dispatchEvent(
                    new window.FocusEvent(focused ? 'focusin' : 'focusout', {
                        bubbles: true,
                    })
                )
            );
        },
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        props: () => {
            const snapshot = host.getSnapshot();
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'duration'
            )
                throw Error('Duration props expected');
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

for (const format of formats)
    it(`${format} preserves native seconds and uses canonical bare, clock, negative and overflow units`, async (t) => {
        const initial = 2.123456789;
        const f = await fixture(t, {}, initial, false, format);
        const before = f.binding.getSnapshot().revision;
        await f.render(
            h(DurationField, { binding: f.binding, className: 'custom' })
        );
        assert.ok(f.container.querySelector('.custom'));
        assert.equal(f.input().type, 'text');
        assert.equal(f.input().inputMode, 'text');
        assert.equal(f.input().placeholder, format);
        const native = canonical.nativeCases.find(
            (row) =>
                row.durationFormat === format &&
                row.secondsText === String(initial)
        )!;
        assert.equal(f.input().value, native.formatted);
        await f.focus(true);
        await f.focus(false);
        assert.equal(f.binding.getSnapshot().value, initial);
        assert.equal(f.binding.getSnapshot().revision, before);
        assert.equal(f.binding.getSnapshot().dirty, false);
        for (const name of [
            'bare',
            'two-clock',
            'negative-three-clock',
            'three-overflow',
            'bare-milliseconds',
        ]) {
            const row = canonical.inputCases.find(
                (candidate) => candidate.id === `${format}/admitted/${name}`
            )!;
            assert.ok(row, `${format} fixture ${name}`);
            await f.focus(true);
            await f.edit(row.input);
            assert.equal(f.input().value, row.input);
            assert.equal(f.binding.getSnapshot().value, row.seconds);
            const revision = f.binding.getSnapshot().revision;
            await f.focus(false);
            assert.equal(f.input().value, row.formattedNative);
            assert.equal(f.binding.getSnapshot().value, row.seconds);
            assert.equal(f.binding.getSnapshot().revision, revision);
        }
    });

it('keeps false-returning partial drafts in the owner across StrictMode, binding and accepted slot remounts', async (t) => {
    const f = await fixture(t, {}, 7);
    const model = f.binding.scalar!;
    const revision = f.binding.getSnapshot().revision;
    await f.render(h(DurationField, { binding: f.binding }));
    await f.focus(true);
    await f.edit('1:');
    assert.equal(f.input().value, '1:');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    assert.equal(f.binding.getSnapshot().value, 7);
    await f.render(null);
    await f.render(
        h(FieldRenderer, {
            host: f.host,
            renderers: { renderDurationField },
            fallback: () => null,
        })
    );
    assert.equal(f.input().value, '1:');
    await f.focus(false);
    assert.equal(f.input().value, '1:');
    await f.edit('-');
    await f.render(null);
    await f.render(h(NumberField, { binding: f.binding }));
    assert.equal(f.input().value, '-');
    assert.equal(f.binding.scalar, model);
    assert.equal(model.getState().retired, false);
    assert.equal(f.binding.getSnapshot().value, 7);
    assert.equal(f.binding.getSnapshot().revision, revision);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

it('external seconds observed while focused preserve typed input until valid blur without overwriting the replacement', async (t) => {
    const f = await fixture(t, {}, 7);
    await f.render(h(DurationField, { binding: f.binding }));
    await f.focus(true);
    await f.edit('1:02:03');
    await act(async () => f.binding.setValue(90.125));
    const revision = f.binding.getSnapshot().revision;
    assert.equal(f.input().value, '1:02:03');
    assert.equal(f.binding.getSnapshot().value, 90.125);
    await f.focus(false);
    assert.equal(f.input().value, '1:30');
    assert.equal(f.binding.getSnapshot().value, 90.125);
    assert.equal(f.binding.getSnapshot().revision, revision);
    await f.focus(true);
    await f.edit('1:');
    await act(async () => f.binding.setValue(42));
    const nextRevision = f.binding.getSnapshot().revision;
    await f.focus(false);
    assert.equal(f.input().value, '1:');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    assert.equal(f.binding.getSnapshot().value, 42);
    assert.equal(f.binding.getSnapshot().revision, nextRevision);
});

for (const initial of [null, undefined, 0] as const)
    it(`leaves initial ${initial === null ? 'null' : initial === undefined ? 'missing' : 'zero'} native data untouched and clears deliberately to null`, async (t) => {
        const f = await fixture(t, {}, initial ?? null, initial === undefined);
        const before = f.binding.getSnapshot();
        await f.render(
            h(DurationField, {
                binding: f.binding,
                clearLabel: 'Effacer la durée',
            })
        );
        await f.render(null);
        await f.render(
            h(DurationField, {
                binding: f.binding,
                clearLabel: 'Effacer la durée',
            })
        );
        assert.equal(f.binding.getSnapshot().value, before.value);
        assert.equal(before.value, initial);
        assert.equal(f.binding.getSnapshot().dirty, false);
        assert.equal(f.input().value, initial === 0 ? '0:00' : '');
        assert.equal(
            f.container.querySelector('button')!.disabled,
            initial !== 0
        );
        await f.edit('1:');
        assert.equal(f.container.querySelector('button')!.disabled, false);
        const button = f.container.querySelector('button')!;
        assert.equal(button.type, 'button');
        assert.equal(button.getAttribute('aria-label'), 'Effacer la durée');
        const press = new f.window.MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
        });
        await act(async () => button.dispatchEvent(press));
        assert.equal(press.defaultPrevented, true);
        await act(async () => button.click());
        assert.equal(f.binding.getSnapshot().value, null);
        assert.equal(f.input().value, '');
        assert.equal(f.input().getAttribute('aria-invalid'), 'false');
        assert.equal(f.window.document.activeElement, f.input());
        await f.edit('1:02:03.25');
        await f.edit('');
        assert.equal(f.binding.getSnapshot().value, null);
    });

it('provides unique labels, configured placeholder, required and plain feedback associations, and contains Portal events', async (t) => {
    const f = await fixture(t, {
        title: 'Deadline',
        required: true,
        placeholderText: 'Enter elapsed time',
    });
    let rows = 0,
        submits = 0;
    const row = () => rows++;
    const feedback = '<img src=x> Check the duration';
    const props = { ...f.props(), error: feedback };
    await f.render(
        h(
            'form',
            {
                onClick: row,
                onChange: row,
                onDoubleClick: row,
                onAuxClick: row,
                onPointerDown: row,
                onKeyDown: row,
                onKeyUp: row,
                onSubmit: (event: import('react').FormEvent) => {
                    event.preventDefault();
                    submits++;
                },
            },
            renderDurationField(props, { className: 'custom more' }),
            renderDurationField(props)
        )
    );
    const ids = Array.from(f.container.querySelectorAll('[id]')).map(
        (node) => node.id
    );
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(f.container.querySelector('label')!.htmlFor, f.input().id);
    assert.equal(f.container.querySelector('label')!.textContent, 'Deadline');
    assert.equal(f.input().placeholder, 'Enter elapsed time');
    assert.equal(f.input().getAttribute('aria-required'), 'true');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    assert.equal(
        f.window.document.getElementById(
            f.input().getAttribute('aria-describedby')!
        )!.textContent,
        feedback
    );
    assert.equal(f.container.querySelector('img'), null);
    assert.ok(f.container.querySelector('.mx-sdk-duration-field.custom.more'));
    await f.edit('1:02:03.25');
    await act(async () => {
        f.container.querySelector('label')!.click();
        for (const type of [
            'click',
            'dblclick',
            'auxclick',
            'pointerdown',
            'keydown',
            'keyup',
        ])
            f.input().dispatchEvent(
                new f.window.Event(type, { bubbles: true })
            );
        f.container.querySelector('button')!.click();
    });
    assert.equal(rows, 0);
    assert.equal(submits, 0);
});

it('masks either configuration surface, keeps hidden-title accessibility and preserves custom binding rendering', async (t) => {
    const f = await fixture(
        t,
        {
            maskPasswordOnLoginScreen: true,
            showTitle: false,
            title: 'Private duration',
        },
        3723.25
    );
    await f.render(h(DurationField, { binding: f.binding }));
    assert.equal(f.input().type, 'password');
    assert.equal(f.input().getAttribute('aria-label'), 'Private duration');
    assert.equal(f.container.querySelector('label'), null);
    assert.equal(
        f.container.querySelector('button')!.getAttribute('aria-label'),
        'Clear Private duration'
    );
    for (const which of ['displayConfig', 'writeConfig'] as const)
        for (const mask of [
            { obscurePassword: true },
            { maskPasswordOnLoginScreen: true },
        ]) {
            await f.render(
                renderDurationField(
                    {
                        ...f.props(),
                        title: ' ',
                        displayConfig: { showTitle: false },
                        writeConfig: {},
                        [which]: { ...mask, showTitle: false },
                    },
                    { clearLabel: '' }
                )
            );
            assert.equal(f.input().type, 'password');
            assert.equal(f.input().getAttribute('aria-label'), 'Elapsed time');
            assert.equal(
                f.container.querySelector('button')!.getAttribute('aria-label'),
                'Clear Elapsed time'
            );
        }
    await f.render(
        h(DurationField, {
            binding: f.binding,
            render: ({ snapshot, binding }) =>
                h('output', null, `${snapshot.value}:${binding === f.binding}`),
        })
    );
    assert.equal(f.container.textContent, '3723.25:true');
});

it('honors both read-only configurations, pending, computed and permission refusal without raw writes', async (t) => {
    const f = await fixture(t, {}, 3723.25);
    for (const override of [
        { capability: { type: 'readonly' as const } },
        { pending: true },
        { computed: true },
        { displayConfig: { readOnly: true } },
        { writeConfig: { readOnly: true } },
        {
            capability: {
                type: 'editable' as const,
                setValue: () => {
                    throw Error(
                        'Missing duration bridge must not call setValue'
                    );
                },
            },
        },
    ]) {
        await f.render(renderDurationField({ ...f.props(), ...override }));
        assert.equal(f.input().disabled, true);
        assert.equal(f.container.querySelector('button')!.disabled, true);
        await f.edit('90');
        await act(async () => f.container.querySelector('button')!.click());
        assert.equal(f.binding.getSnapshot().value, 3723.25);
    }
    await f.render(h(DurationField, { binding: f.binding }));
    await act(async () => {
        f.scope.writable = false;
        f.owner.refresh();
    });
    assert.equal(f.input().disabled, true);
    await f.edit('90');
    assert.equal(f.binding.getSnapshot().value, 3723.25);
});

it('preserves empty feedback and validation priority and rejects wrong-kind, noneditable and retired duration states', async (t) => {
    const f = await fixture(t, {}, 3723.25);
    const props = f.props();
    if (props.capability.type !== 'editable' || !props.capability.scalar)
        throw Error('Duration bridge expected');
    const capability = props.capability;
    const scalar = capability.scalar!;
    const show = async (
        state: typeof scalar.state,
        override: Partial<FieldRendererProps<'duration'>> = {}
    ) =>
        f.render(
            renderDurationField({
                ...props,
                ...override,
                capability: { ...capability, scalar: { ...scalar, state } },
            })
        );
    const validation = [
        {
            fieldId: 'duration',
            fieldTitle: 'Elapsed time',
            errorMessage: 'Configured validation',
        },
    ];
    await show(
        { ...scalar.state, valid: false, error: '' },
        { error: 'Do not replace empty model feedback', validation }
    );
    assert.equal(f.container.querySelector('[role=status]')!.textContent, '');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    await show(scalar.state, { error: '', validation });
    assert.equal(f.container.querySelector('[role=status]')!.textContent, '');
    await show(scalar.state, { validation });
    assert.equal(
        f.container.querySelector('[role=status]')!.textContent,
        'Configured validation'
    );
    for (const state of [
        { ...scalar.state, kind: 'number' } as unknown as typeof scalar.state,
        { ...scalar.state, canEdit: false },
        { ...scalar.state, durationFormat: null },
    ]) {
        await show(state);
        assert.equal(f.input().disabled, true);
        await f.edit('90');
        assert.equal(f.binding.getSnapshot().value, 3723.25);
    }
    await show({ ...scalar.state, retired: true });
    assert.equal(f.container.querySelector('input'), null);
});

it('requires the focus action in accepted slots and binding controls without invoking raw writes', async (t) => {
    const f = await fixture(t, {}, 90);
    const props = f.props();
    if (props.capability.type !== 'editable' || !props.capability.scalar)
        throw Error('Duration bridge expected');
    const scalar = props.capability.scalar;
    // Deliberately simulate a runtime bridge missing its mandatory focus action.
    await f.render(
        renderDurationField({
            ...props,
            capability: {
                type: 'editable',
                setValue: () => {
                    throw Error(
                        'Missing focus bridge cannot fall back to setValue'
                    );
                },
                scalar: {
                    ...scalar,
                    setFocused: undefined,
                } as unknown as typeof scalar,
            },
        })
    );
    assert.equal(f.input().value, '1:30');
    assert.equal(f.input().disabled, true);
    await f.focus(true);
    await f.edit('100');
    await f.focus(false);
    assert.equal(f.binding.getSnapshot().value, 90);
    const noFocus = {
        ...f.binding,
        scalar: { ...f.binding.scalar!, setFocused: undefined },
    };
    await f.render(h(DurationField, { binding: noFocus }));
    assert.equal(f.input().disabled, true);
    await f.edit('100');
    assert.equal(f.binding.getSnapshot().value, 90);
});

it('read-only slots format native seconds in all five formats and reject malformed values or metadata', async (t) => {
    const f = await fixture(t);
    const props = f.props();
    for (const durationFormat of formats) {
        const row = canonical.nativeCases.find(
            (candidate) =>
                candidate.durationFormat === durationFormat &&
                candidate.secondsText === '-3680.4'
        )!;
        await f.render(
            renderDurationField({
                ...props,
                value: -3680.4,
                field: {
                    ...props.field,
                    config: { type: 'duration', options: { durationFormat } },
                },
                capability: { type: 'readonly' },
            })
        );
        assert.equal(f.input().value, row.formatted);
        assert.equal(f.input().placeholder, durationFormat);
        assert.equal(f.input().disabled, true);
        assert.equal(f.input().getAttribute('aria-invalid'), 'false');
    }
    for (const value of [
        NaN,
        Infinity,
        -Infinity,
        Number.MAX_VALUE,
        '60',
        {},
    ]) {
        await f.render(
            renderDurationField({
                ...props,
                value,
                capability: { type: 'readonly' },
            } as unknown as FieldRendererProps<'duration'>)
        );
        assert.equal(f.input().value, '');
        assert.equal(f.input().disabled, true);
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
        assert.equal(
            f.container.querySelector('[role=status]')!.textContent,
            'This field has an unsupported native value.'
        );
    }
    for (const config of [
        { type: 'duration', options: { durationFormat: 'unsupported' } },
        { type: 'duration' },
        { type: 'number', options: { precision: 2 } },
    ]) {
        await f.render(
            renderDurationField({
                ...props,
                value: 90,
                field: { ...props.field, config },
                capability: { type: 'readonly' },
            } as unknown as FieldRendererProps<'duration'>)
        );
        assert.equal(f.input().value, '');
        assert.equal(f.input().disabled, true);
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
        assert.equal(
            f.container.querySelector('[role=status]')!.textContent,
            'This duration format is unavailable.'
        );
    }
    assert.equal(f.binding.getSnapshot().value, null);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

it('a synthetic accepted format replacement retires old focus and edit actions and keeps native seconds', async (t) => {
    const f = await fixture(t, {}, 90.125);
    await f.render(h(DurationField, { binding: f.binding }));
    await f.focus(true);
    await f.edit('1:30.125');
    const props = f.props();
    if (props.capability.type !== 'editable' || !props.capability.scalar)
        throw Error('Duration bridge expected');
    const retained = props.capability.scalar;
    const fresh = structuredClone(f.loaded);
    const schema = fresh.payload.fieldIdsToSchemas.duration;
    if (schema.fieldType !== 'duration')
        throw Error('Duration schema expected');
    schema.airtableField.config.options.durationFormat = 'h:mm';
    await act(async () => {
        assert.equal(
            await f.owner.reload({ dirty: 'keep', read: async () => fresh }),
            true
        );
    });
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(retained.setInput('8'), false);
    assert.equal(retained.setFocused(true), false);
    assert.equal(f.binding.scalar!.getState().retired, true);
    const successor = f.owner.field('duration');
    await f.render(h(DurationField, { binding: successor }));
    assert.equal(successor.getSnapshot().value, 90.125);
    assert.equal(f.input().placeholder, 'h:mm');
    assert.equal(f.input().value, '0:02');
    await f.edit('8');
    assert.equal(successor.getSnapshot().value, 480);
});

it('retired or incompatible duration scalars remove binding controls without altering native seconds', async (t) => {
    const f = await fixture(t, {}, 90);
    const original = f.binding.getSnapshot();
    const wrong = {
        ...f.binding,
        getSnapshot: () => ({
            ...original,
            scalar: { ...original.scalar!, kind: 'number' as const },
        }),
    };
    await f.render(h(DurationField, { binding: wrong }));
    assert.equal(f.container.querySelector('input'), null);
    await f.render(h(DurationField, { binding: f.binding }));
    await act(async () => f.binding.scalar!.destroy());
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(f.binding.getSnapshot().value, 90);
    assert.equal(f.binding.getSnapshot().retired, false);
});

it('DurationField and NumberField preserve non-duration numeric behavior and custom rendering', async (t) => {
    const f = await fixture(t);
    const binding = f.owner.field('number');
    for (const Component of [DurationField, NumberField]) {
        await f.render(h(Component, { binding }));
        assert.equal(f.input().inputMode, 'decimal');
        assert.equal(f.input().value, '1.25');
        await f.edit('2.5');
        assert.equal(binding.getSnapshot().value, 2.5);
        await act(async () => binding.setValue(1.25));
        await f.render(
            h(Component, {
                binding,
                render: ({ snapshot, binding: accepted }) =>
                    h(
                        'output',
                        null,
                        `${snapshot.value}:${accepted === binding}`
                    ),
            })
        );
        assert.equal(f.container.textContent, '1.25:true');
    }
    await f.render(null);
    await f.render(h(DurationField, { binding: f.owner.field('fld_title') }));
    assert.equal(f.container.querySelector('input'), null);
});

it('retained slot actions refuse stale configuration and hidden or retired owners remove binding controls', async (t) => {
    const f = await fixture(t, {}, 3723.25);
    await f.render(renderDurationField(f.props()));
    f.scope.revision++;
    await f.edit('90');
    assert.equal(f.binding.getSnapshot().value, 3723.25);
    await act(async () => f.container.querySelector('button')!.click());
    assert.equal(f.binding.getSnapshot().value, 3723.25);
    await f.render(h(DurationField, { binding: f.binding }));
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    assert.equal(f.container.querySelector('input'), null);
    await act(async () => f.owner.destroy());
    assert.equal(f.container.querySelector('input'), null);
});

it('accepted read-only slots preserve absent data in every Form and Portal context', async (t) => {
    const f = await fixture(t);
    for (const context of [
        'form',
        'portal-cell',
        'portal-detail',
        'linked-detail',
    ] as const)
        for (const value of [undefined, null, 3723.25]) {
            await f.render(
                renderDurationField({
                    ...f.props(),
                    context,
                    value,
                    capability: { type: 'readonly' },
                })
            );
            assert.equal(f.input().value, value == null ? '' : '1:02:03');
            assert.equal(f.input().disabled, true);
            assert.equal(f.binding.getSnapshot().value, null);
            assert.equal(f.binding.getSnapshot().dirty, false);
        }
});
