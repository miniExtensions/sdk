import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    DateField,
    DateTimeField,
    FieldRenderer,
    renderDateTimeField,
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
    config: FieldConfig<'dateTime'> = {},
    initial: string | null = null,
    missing = false,
    timeZone: 'utc' | 'client' = 'utc'
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
    loaded.payload.fieldIdsInForm.push('date', 'dateTime');
    if (!missing) loaded.payload.formRecord.data.dateTime = initial;
    loaded.payload.formRecord.data.date = '2011-12-30';
    loaded.payload.fieldIdsToSchemas.date = {
        fieldType: 'date',
        airtableField: {
            id: 'date',
            name: 'Due date',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'date',
                options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
            },
        },
        miniExtConfig: {},
    };
    loaded.payload.fieldIdsToSchemas.dateTime = {
        fieldType: 'dateTime',
        airtableField: {
            id: 'dateTime',
            name: 'Appointment',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'dateTime',
                options: {
                    dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                    timeFormat: { name: '24hour', format: 'HH:mm' },
                    timeZone,
                },
            },
        },
        miniExtConfig: config,
    };
    let requests = 0;
    const scope = {
        current: true,
        writable: true,
        visible: true,
        revision: 0,
        clientTimeZone: 'America/Los_Angeles',
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
        getScope: () => ({ ownerId: 'datetime-test', revision: 0 }),
        getClientTimeZone: () => scope.clientTimeZone,
        canWrite: () => scope.writable,
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('dateTime');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'dateTime',
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
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        props: () => {
            const snapshot = host.getSnapshot();
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'dateTime'
            )
                throw Error('DateTime props expected');
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

it('retains owner-held partial and invalid timestamp drafts across binding, slot and StrictMode remounts', async (t) => {
    const f = await fixture(t, {}, '2024-01-31T23:45:59.120+05:45');
    const model = f.binding.date;
    await f.render(
        h(DateTimeField, { binding: f.binding, className: 'custom' })
    );
    assert.ok(f.container.querySelector('.custom'));
    assert.equal(f.input().type, 'text');
    assert.equal(f.input().placeholder, 'YYYY-MM-DDTHH:mm:ssZ');
    await f.edit('2024-');
    assert.equal(f.input().value, '2024-');
    assert.equal(
        f.binding.getSnapshot().value,
        '2024-01-31T23:45:59.120+05:45'
    );
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    await f.render(null);
    await f.render(
        h(FieldRenderer, {
            host: f.host,
            renderers: { renderDateTimeField },
            fallback: () => null,
        })
    );
    assert.equal(f.input().value, '2024-');
    await f.edit('2024-02-30T12:00:00Z');
    assert.equal(
        f.binding.getSnapshot().value,
        '2024-01-31T23:45:59.120+05:45'
    );
    assert.equal(f.input().value, '2024-02-30T12:00:00Z');
    await f.render(null);
    await f.render(h(DateTimeField, { binding: f.binding }));
    assert.equal(f.input().value, '2024-02-30T12:00:00Z');
    assert.equal(f.binding.date, model);
    assert.equal(model!.getState().retired, false);
    for (const value of [
        '2024-02-29T12:30:00.120+05:45',
        '2011-12-30T12:00:00-10:00',
        '2024-03-10T02:30:00-08:00',
        '2024-11-03T01:30:00-07:00',
        '2024-11-03T01:30:00-08:00',
        '2024-01-01T00:00:00.1Z',
        '2024-01-01T00:00:00.10+00:00',
    ]) {
        await f.edit(value);
        assert.equal(f.input().value, value);
        assert.equal(f.binding.getSnapshot().value, value);
        assert.equal(f.input().getAttribute('aria-invalid'), 'false');
    }
    await act(async () => f.binding.setValue('2000-02-29T00:00:00Z'));
    assert.equal(f.input().value, '2000-02-29T00:00:00Z');
});

it('retains missing seconds, missing offsets and malformed instants without normalizing the native value', async (t) => {
    const initial = '2024-02-29T12:30:00.120+05:45';
    const f = await fixture(t, {}, initial);
    await f.render(h(DateTimeField, { binding: f.binding }));
    for (const text of [
        '2024-02-29T12:30',
        '2024-02-29T12:30Z',
        '2024-02-29T12:30:00',
        '2024-02-29T12:30:00-00:00',
        '2024-02-29T12:30:00.1234Z',
        '2024-02-29T24:00:00Z',
        '2024-02-29T12:30:60Z',
        '2024-02-29T12:30:00+24:00',
        '2024-02-29',
    ]) {
        await f.edit(text);
        assert.equal(f.input().value, text);
        assert.equal(f.binding.getSnapshot().value, initial);
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    }
    await f.render(null);
    await f.render(h(DateField, { binding: f.binding }));
    assert.equal(f.input().value, '2024-02-29');
    assert.equal(f.binding.getSnapshot().value, initial);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

for (const initial of [null, undefined] as const)
    it(`leaves initial ${initial === null ? 'null' : 'missing'} native data untouched and clears deliberately to null`, async (t) => {
        const f = await fixture(t, {}, initial ?? null, initial === undefined);
        const before = f.binding.getSnapshot();
        await f.render(
            h(DateTimeField, {
                binding: f.binding,
                clearLabel: 'Effacer la date',
            })
        );
        await f.render(null);
        await f.render(
            h(DateTimeField, {
                binding: f.binding,
                clearLabel: 'Effacer la date',
            })
        );
        assert.equal(f.binding.getSnapshot().value, before.value);
        assert.equal(before.value, initial);
        assert.equal(f.binding.getSnapshot().dirty, false);
        assert.equal(f.input().value, '');
        assert.equal(f.container.querySelector('button')!.disabled, true);
        await f.edit('2024-');
        assert.equal(f.container.querySelector('button')!.disabled, false);
        const button = f.container.querySelector('button')!;
        assert.equal(button.type, 'button');
        assert.equal(button.getAttribute('aria-label'), 'Effacer la date');
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
        await f.edit('2024-02-29T12:30:00.120+05:45');
        await f.edit('');
        assert.equal(f.binding.getSnapshot().value, null);
    });

it('provides unique labels, configured placeholder, required and plain feedback associations, and contains Portal events', async (t) => {
    const f = await fixture(t, {
        title: 'Deadline',
        required: true,
        placeholderText: 'Enter explicit timestamp',
    });
    let rows = 0,
        submits = 0;
    const row = () => rows++;
    const feedback = '<img src=x> Check the date';
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
            renderDateTimeField(props, { className: 'custom more' }),
            renderDateTimeField(props)
        )
    );
    const ids = Array.from(f.container.querySelectorAll('[id]')).map(
        (node) => node.id
    );
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(f.container.querySelector('label')!.htmlFor, f.input().id);
    assert.equal(f.container.querySelector('label')!.textContent, 'Deadline');
    assert.equal(f.input().placeholder, 'Enter explicit timestamp');
    assert.equal(f.input().getAttribute('aria-required'), 'true');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    assert.equal(
        f.window.document.getElementById(
            f.input().getAttribute('aria-describedby')!
        )!.textContent,
        feedback
    );
    assert.equal(f.container.querySelector('img'), null);
    assert.ok(f.container.querySelector('.mx-sdk-datetime-field.custom.more'));
    await f.edit('2024-02-29T12:30:00.120+05:45');
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
            title: 'Private appointment',
        },
        '2024-02-29T12:30:00.120+05:45'
    );
    await f.render(h(DateTimeField, { binding: f.binding }));
    assert.equal(f.input().type, 'password');
    assert.equal(f.input().getAttribute('aria-label'), 'Private appointment');
    assert.equal(f.container.querySelector('label'), null);
    assert.equal(
        f.container.querySelector('button')!.getAttribute('aria-label'),
        'Clear Private appointment'
    );
    for (const which of ['displayConfig', 'writeConfig'] as const)
        for (const mask of [
            { obscurePassword: true },
            { maskPasswordOnLoginScreen: true },
        ]) {
            await f.render(
                renderDateTimeField(
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
            assert.equal(f.input().getAttribute('aria-label'), 'Appointment');
            assert.equal(
                f.container.querySelector('button')!.getAttribute('aria-label'),
                'Clear Appointment'
            );
        }
    await f.render(
        h(DateTimeField, {
            binding: f.binding,
            render: ({ snapshot, binding }) =>
                h('output', null, `${snapshot.value}:${binding === f.binding}`),
        })
    );
    assert.equal(f.container.textContent, '2024-02-29T12:30:00.120+05:45:true');
});

it('honors both read-only configurations, pending, computed and permission refusal without raw writes', async (t) => {
    const f = await fixture(t, {}, '2024-02-29T12:30:00.120+05:45');
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
                    throw Error('Missing date bridge must not call setValue');
                },
            },
        },
    ]) {
        await f.render(renderDateTimeField({ ...f.props(), ...override }));
        assert.equal(f.input().disabled, true);
        assert.equal(f.container.querySelector('button')!.disabled, true);
        await f.edit('2000-02-29T00:00:00Z');
        await act(async () => f.container.querySelector('button')!.click());
        assert.equal(
            f.binding.getSnapshot().value,
            '2024-02-29T12:30:00.120+05:45'
        );
    }
    await f.render(h(DateTimeField, { binding: f.binding }));
    await act(async () => {
        f.scope.writable = false;
        f.owner.refresh();
    });
    assert.equal(f.input().disabled, true);
    await f.edit('2000-02-29T00:00:00Z');
    assert.equal(
        f.binding.getSnapshot().value,
        '2024-02-29T12:30:00.120+05:45'
    );
});

it('preserves empty feedback and validation priority and rejects wrong-kind, noneditable and retired date states', async (t) => {
    const f = await fixture(t, {}, '2024-02-29T12:30:00.120+05:45');
    const props = f.props();
    if (props.capability.type !== 'editable' || !props.capability.date)
        throw Error('Date bridge expected');
    const capability = props.capability;
    const date = capability.date!;
    const show = async (
        state: typeof date.state,
        override: Partial<FieldRendererProps<'dateTime'>> = {}
    ) =>
        f.render(
            renderDateTimeField({
                ...props,
                ...override,
                capability: { ...capability, date: { ...date, state } },
            })
        );
    const validation = [
        {
            fieldId: 'dateTime',
            fieldTitle: 'Appointment',
            errorMessage: 'Configured validation',
        },
    ];
    await show(
        { ...date.state, valid: false, error: '' },
        { error: 'Do not replace empty model feedback', validation }
    );
    assert.equal(f.container.querySelector('[role=status]')!.textContent, '');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    await show(date.state, { error: '', validation });
    assert.equal(f.container.querySelector('[role=status]')!.textContent, '');
    await show(date.state, { validation });
    assert.equal(
        f.container.querySelector('[role=status]')!.textContent,
        'Configured validation'
    );
    for (const state of [
        { ...date.state, kind: 'date' as const },
        { ...date.state, canEdit: false },
    ]) {
        await show(state);
        assert.equal(f.input().disabled, true);
        await f.edit('2000-02-29T00:00:00Z');
        assert.equal(
            f.binding.getSnapshot().value,
            '2024-02-29T12:30:00.120+05:45'
        );
    }
    await show({ ...date.state, retired: true });
    assert.equal(f.container.querySelector('input'), null);
});

it('retained slot actions refuse stale configuration and hidden or retired owners remove binding controls', async (t) => {
    const f = await fixture(t, {}, '2024-02-29T12:30:00.120+05:45');
    await f.render(renderDateTimeField(f.props()));
    f.scope.revision++;
    await f.edit('2000-02-29T00:00:00Z');
    assert.equal(
        f.binding.getSnapshot().value,
        '2024-02-29T12:30:00.120+05:45'
    );
    await act(async () => f.container.querySelector('button')!.click());
    assert.equal(
        f.binding.getSnapshot().value,
        '2024-02-29T12:30:00.120+05:45'
    );
    await f.render(h(DateTimeField, { binding: f.binding }));
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
        for (const value of [undefined, null, '2011-12-30T12:00:00-10:00']) {
            await f.render(
                renderDateTimeField({
                    ...f.props(),
                    context,
                    value,
                    capability: { type: 'readonly' },
                })
            );
            assert.equal(f.input().value, value ?? '');
            assert.equal(f.input().disabled, true);
            assert.equal(f.binding.getSnapshot().value, null);
            assert.equal(f.binding.getSnapshot().dirty, false);
        }
});

it('client-zone replacement retires the borrowed model and retained slot actions while preserving the native timestamp', async (t) => {
    const initial = '2024-07-01T12:00:00.120Z';
    const f = await fixture(t, {}, initial, false, 'client');
    await f.render(h(DateTimeField, { binding: f.binding }));
    assert.equal(f.binding.date!.getState().timeZone, 'America/Los_Angeles');
    const props = f.props();
    if (props.capability.type !== 'editable' || !props.capability.date)
        throw Error('DateTime bridge expected');
    const actions = props.capability.date;
    f.scope.clientTimeZone = 'Asia/Kathmandu';
    await act(async () => {
        assert.equal(actions.setInput('2000-02-29T00:00:00Z'), false);
        assert.equal(actions.clear(), false);
    });
    await f.render(h(DateTimeField, { binding: f.binding }));
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(
        f.container.querySelector('[role=status]')!.textContent,
        'Load a fresh Form before editing this date.'
    );
    assert.equal(f.binding.date!.getState().retired, true);
    assert.equal(f.binding.getSnapshot().value, initial);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

it('fixed-zone editing survives client timezone changes and keeps native offset and fraction bytes', async (t) => {
    const initial = '2024-07-01T12:00:00.120+05:45';
    const f = await fixture(t, {}, initial);
    await f.render(h(DateTimeField, { binding: f.binding }));
    const model = f.binding.date!;
    const before = model.getState();
    f.scope.clientTimeZone = 'Pacific/Apia';
    await f.render(h(DateTimeField, { binding: f.binding }));
    assert.equal(model.getState().retired, false);
    assert.equal(model.getState().timeZone, before.timeZone);
    assert.equal(model.getState().display, before.display);
    assert.equal(f.input().value, initial);
    assert.equal(f.input().disabled, false);
    await f.edit('2024-07-01T12:00:00.010-03:30');
    assert.equal(
        f.binding.getSnapshot().value,
        '2024-07-01T12:00:00.010-03:30'
    );
});

it('retains the retired dateTime status and custom renderer, and omits non-date bindings', async (t) => {
    const f = await fixture(t, {}, '2024-02-29T12:30:00Z');
    await f.render(h(DateTimeField, { binding: f.owner.field('fld_title') }));
    assert.equal(f.container.querySelector('input'), null);
    await f.render(h(DateTimeField, { binding: f.binding }));
    await act(async () => f.binding.date!.destroy());
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(
        f.container.querySelector('[role=status]')!.textContent,
        'Load a fresh Form before editing this date.'
    );
    assert.equal(f.binding.getSnapshot().value, '2024-02-29T12:30:00Z');
    await f.render(
        h(DateTimeField, {
            binding: f.binding,
            render: ({ snapshot, binding }) =>
                h(
                    'output',
                    null,
                    `${snapshot.date!.retired}:${binding === f.binding}`
                ),
        })
    );
    assert.equal(f.container.textContent, 'true:true');
});

it('DateField keeps calendar-only legacy editing through either component alias', async (t) => {
    const f = await fixture(t);
    const binding = f.owner.field('date');
    for (const Component of [DateField, DateTimeField]) {
        await f.render(h(Component, { binding }));
        assert.equal(f.input().placeholder, 'YYYY-MM-DD');
        assert.equal(f.input().value, '2011-12-30');
        await f.edit('2024-02-30');
        assert.equal(binding.getSnapshot().value, '2011-12-30');
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
        await f.edit('2024-02-29');
        assert.equal(binding.getSnapshot().value, '2024-02-29');
        await act(async () => f.container.querySelector('button')!.click());
        assert.equal(binding.getSnapshot().value, null);
        await act(async () => binding.setValue('2011-12-30'));
    }
});
