import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    CheckboxField,
    CheckboxInput,
    FieldRenderer,
    renderCheckboxField,
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
    config: FieldConfig<'checkbox'> = {},
    initial: boolean | null | undefined = null
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
    loaded.payload.fieldIdsInForm.push('check');
    if (initial !== undefined) loaded.payload.formRecord.data.check = initial;
    loaded.payload.fieldIdsToSchemas.check = {
        fieldType: 'checkbox',
        airtableField: {
            id: 'check',
            name: 'Approved',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'checkbox',
                options: { icon: 'check', color: 'greenBright' },
            },
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
                throw Error('No requests expected');
            },
        }),
        getScope: () => ({ ownerId: 'checkbox-test', revision: 0 }),
        canWrite: () => scope.writable,
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('check');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'check',
        isCurrent: () => scope.current,
        configurationRevision: () => scope.revision,
    });
    t.after(async () => {
        await act(async () => root.unmount());
        host.dispose();
        owner.destroy();
        keys.forEach((key, i) => {
            const original = originals[i];
            if (original) Object.defineProperty(globalThis, key, original);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
        assert.equal(requests, 0);
    });
    return {
        window,
        scope,
        owner,
        binding,
        host,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        props: () => {
            const snapshot = host.getSnapshot();
            assert.equal(snapshot.status, 'ready');
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'checkbox'
            )
                throw Error('Checkbox expected');
            return snapshot.fields[0];
        },
        input: () => {
            const input = container.querySelector('input');
            assert.ok(input);
            return input;
        },
        container,
    };
}

it('native input preserves host labels, form association and bubbling while the host controls its value', async (t) => {
    const f = await fixture(t);
    const changes: boolean[] = [];
    const events: string[] = [];
    const view = (checked: boolean) =>
        h(
            'div',
            {
                onClick: (event: import('react').MouseEvent) => {
                    if (Object.is(event.target, f.input()))
                        events.push('click');
                },
                onChange: () => events.push('change'),
                onKeyDown: () => events.push('keydown'),
                onPointerDown: () => events.push('pointerdown'),
            },
            h('label', { htmlFor: 'host-check' }, 'Host consent'),
            h('form', { id: 'host-form' }),
            h('p', { id: 'host-description' }, 'Host description'),
            h('p', { id: 'host-error' }, 'Host error'),
            h(CheckboxInput, {
                checked,
                id: 'host-check',
                form: 'host-form',
                className: 'host-checkbox',
                'aria-checked': checked,
                'aria-describedby': 'host-description host-error',
                'aria-invalid': true,
                onChange: (event) => {
                    assert.ok(Object.is(event.currentTarget, f.input()));
                    changes.push(event.currentTarget.checked);
                },
            })
        );
    await f.render(view(false));
    assert.deepEqual(changes, []);
    assert.equal(f.input().type, 'checkbox');
    assert.equal(f.input().form?.id, 'host-form');
    assert.equal(f.input().className, 'host-checkbox');
    assert.equal(f.container.querySelectorAll('label').length, 1);
    assert.equal(f.container.querySelector('[role=status]'), null);
    assert.equal(
        f.input().getAttribute('aria-describedby'),
        'host-description host-error'
    );
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    await act(async () => f.container.querySelector('label')!.click());
    assert.deepEqual(changes, [true]);
    assert.deepEqual(events.sort(), ['change', 'click']);
    assert.equal(f.input().checked, false);
    await f.render(view(true));
    assert.equal(f.input().checked, true);
    assert.equal(f.input().getAttribute('aria-checked'), 'true');
    await act(async () => f.input().click());
    assert.deepEqual(changes, [true, false]);
    await f.render(view(false));
    await act(async () => {
        for (const type of ['keydown', 'pointerdown'])
            f.input().dispatchEvent(
                new f.window.Event(type, { bubbles: true })
            );
    });
    assert.deepEqual(events.sort(), [
        'change',
        'change',
        'click',
        'click',
        'keydown',
        'pointerdown',
    ]);
    await f.render(null);
    await f.render(view(false));
    assert.equal(f.input().checked, false);
    assert.deepEqual(changes, [true, false]);
    assert.equal(f.binding.getSnapshot().value, null);
});

it('native input forwards disabled and readOnly without adding a write policy', async (t) => {
    const f = await fixture(t);
    const changes: boolean[] = [];
    const view = (disabled: boolean) =>
        h(CheckboxInput, {
            checked: false,
            disabled,
            readOnly: true,
            'aria-label': 'Consent',
            onChange: (event) => changes.push(event.currentTarget.checked),
        });
    await f.render(view(true));
    assert.equal(f.input().disabled, true);
    assert.equal(f.input().readOnly, true);
    assert.equal(f.input().id, '');
    await act(async () => f.input().click());
    assert.deepEqual(changes, []);
    await f.render(view(false));
    await act(async () => f.input().click());
    assert.deepEqual(changes, [true]);
    assert.equal(f.input().checked, false);
    assert.equal(f.binding.getSnapshot().value, null);
});

it('binding and accepted slot retain null until interaction and survive StrictMode/remount without owning the scalar', async (t) => {
    const f = await fixture(t);
    const scalar = f.binding.scalar;
    let changes = 0;
    const unsubscribe = f.binding.subscribe(() => {
        changes++;
    });
    const initialNotifications = changes;
    t.after(unsubscribe);
    await f.render(
        h(CheckboxField, { binding: f.binding, className: 'custom' })
    );
    await f.render(null);
    await f.render(h(CheckboxField, { binding: f.binding }));
    assert.equal(f.binding.getSnapshot().value, null);
    assert.equal(f.binding.getSnapshot().dirty, false);
    assert.equal(changes, initialNotifications);
    assert.equal(f.input().checked, false);
    await act(async () => f.input().click());
    assert.equal(f.binding.getSnapshot().value, true);
    const accepted = changes;
    await f.render(null);
    await f.render(
        h(FieldRenderer, {
            host: f.host,
            renderers: { renderCheckboxField },
            fallback: () => null,
        })
    );
    assert.equal(f.input().checked, true);
    assert.equal(changes, accepted);
    assert.equal(f.binding.scalar, scalar);
    await act(async () => f.input().click());
    assert.equal(f.binding.getSnapshot().value, false);
    await act(async () => {
        f.binding.setValue(true);
    });
    assert.equal(f.input().checked, true);
});

it('uses unique labelled controls, associates plain-text validation, and contains Portal events', async (t) => {
    const f = await fixture(t, { required: true });
    const props = f.props();
    let rowEvents = 0,
        submits = 0;
    const row = () => {
        rowEvents++;
    };
    const error = '<img src=x onerror=alert(1)> Please confirm';
    await f.render(
        h(
            'form',
            {
                onSubmit: (e: import('react').FormEvent) => {
                    e.preventDefault();
                    submits++;
                },
                onClick: row,
                onDoubleClick: row,
                onAuxClick: row,
                onPointerDown: row,
                onKeyDown: row,
                onKeyUp: row,
                onChange: row,
            },
            renderCheckboxField(
                { ...props, error },
                { className: 'custom more' }
            ),
            renderCheckboxField(props)
        )
    );
    const inputs = Array.from(f.container.querySelectorAll('input'));
    assert.equal(inputs.length, 2);
    assert.notEqual(inputs[0].id, inputs[1].id);
    assert.equal(
        f.container.querySelector(`label[for="${inputs[0].id}"]`)?.textContent,
        'Approved'
    );
    assert.equal(f.input().getAttribute('aria-required'), 'true');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    const status = f.window.document.getElementById(
        f.input().getAttribute('aria-describedby')!
    );
    assert.equal(status?.textContent, error);
    assert.equal(status?.querySelector('img'), null);
    assert.ok(f.container.querySelector('.mx-sdk-checkbox-field.custom.more'));
    await act(async () => {
        f.container.querySelector('label')!.click();
        for (const type of [
            'dblclick',
            'auxclick',
            'pointerdown',
            'keydown',
            'keyup',
        ])
            f.input().dispatchEvent(
                new f.window.Event(type, { bubbles: true })
            );
    });
    assert.equal(f.binding.getSnapshot().value, true);
    assert.equal(rowEvents, 0);
    assert.equal(submits, 0);
});

it('honors configured hidden titles and provides a name for empty titles, with custom binding render preserved', async (t) => {
    const f = await fixture(t, { showTitle: false, title: 'Consent' });
    await f.render(
        h(CheckboxField, { binding: f.binding, className: 'custom' })
    );
    assert.equal(f.input().getAttribute('aria-label'), 'Consent');
    assert.equal(f.container.querySelector('label')!.textContent, '');
    assert.ok(f.container.querySelector('.custom'));
    await f.render(
        renderCheckboxField({
            ...f.props(),
            title: '  ',
            displayConfig: { showTitle: false },
        })
    );
    assert.equal(f.input().getAttribute('aria-label'), 'Approved');
    await f.render(
        h(CheckboxField, {
            binding: f.binding,
            render: ({ snapshot, binding }) =>
                h('output', null, `${snapshot.value}:${binding === f.binding}`),
        })
    );
    assert.equal(f.container.textContent, 'null:true');
});

it('disables read-only and pending snapshots and never creates write capability from a value', async (t) => {
    const f = await fixture(t);
    for (const override of [
        { capability: { type: 'readonly' as const }, value: true },
        { pending: true },
        { computed: true },
        { displayConfig: { readOnly: true } },
        { writeConfig: { readOnly: true } },
    ]) {
        await f.render(renderCheckboxField({ ...f.props(), ...override }));
        assert.equal(f.input().disabled, true);
        await act(async () => f.input().click());
        assert.equal(f.binding.getSnapshot().value, null);
    }
    f.scope.writable = false;
    await act(async () => f.owner.refresh());
    await f.render(h(CheckboxField, { binding: f.binding }));
    assert.equal(f.input().disabled, true);
});

it('does not substitute a boolean write for Calendly in either configuration surface or binding API', async (t) => {
    const f = await fixture(t, {
        enableCalendlyIntegration: true,
        calendlyURL: 'https://calendly.example.test/booking',
    });
    await f.render(h(CheckboxField, { binding: f.binding }));
    assert.equal(f.input().disabled, true);
    for (const which of ['displayConfig', 'writeConfig'] as const) {
        await f.render(
            renderCheckboxField({
                ...f.props(),
                displayConfig: {},
                writeConfig: {},
                [which]: { enableCalendlyIntegration: true },
            })
        );
        assert.equal(f.input().disabled, true);
        await act(async () => f.input().click());
        assert.equal(f.binding.getSnapshot().value, null);
    }
});

it('retained accepted callbacks refuse a stale context and blocked/retired hosts hide the control', async (t) => {
    const f = await fixture(t);
    const retained = f.props();
    await f.render(renderCheckboxField(retained));
    f.scope.revision++;
    await act(async () => f.input().click());
    assert.equal(f.binding.getSnapshot().value, null);
    assert.equal(f.input().checked, false);
    await f.render(
        h(FieldRenderer, {
            host: f.host,
            renderers: { renderCheckboxField },
            fallback: () => null,
        })
    );
    assert.equal(f.container.querySelector('input'), null);
    await f.render(h(CheckboxField, { binding: f.binding }));
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    assert.equal(f.container.querySelector('input'), null);
    await act(async () => f.owner.destroy());
    assert.equal(f.container.querySelector('input'), null);
});

it('supports the accepted setValue capability when scalar is absent across each slot context', async (t) => {
    const f = await fixture(t);
    for (const context of [
        'form',
        'portal-cell',
        'portal-detail',
        'linked-detail',
    ] as const) {
        const props = f.props();
        assert.equal(props.capability.type, 'editable');
        if (props.capability.type !== 'editable')
            throw Error('Editable expected');
        await act(async () => {
            f.binding.setValue(null);
        });
        await f.render(
            renderCheckboxField({
                ...props,
                context,
                value: undefined,
                capability: {
                    type: 'editable',
                    setValue: props.capability.setValue,
                },
            })
        );
        assert.equal(f.input().checked, false);
        await act(async () => f.input().click());
        assert.equal(f.binding.getSnapshot().value, true);
    }
});

it('preserves empty feedback, exposes validation, and refuses an incompatible or retired scalar', async (t) => {
    const f = await fixture(t);
    const props = f.props();
    if (props.capability.type !== 'editable' || !props.capability.scalar)
        throw Error('Scalar expected');
    const scalar = props.capability.scalar;
    const show = async (
        state: typeof scalar.state,
        other: Partial<FieldRendererProps<'checkbox'>> = {}
    ) => {
        await f.render(
            renderCheckboxField({
                ...props,
                ...other,
                capability: {
                    type: 'editable',
                    setValue:
                        props.capability.type === 'editable'
                            ? props.capability.setValue
                            : () => ({ accepted: false, reason: 'readonly' }),
                    scalar: { ...scalar, state },
                },
            })
        );
    };
    await show(
        { ...scalar.state, valid: false, error: '' },
        { error: 'Do not replace empty scalar feedback' }
    );
    assert.equal(f.container.querySelector('[role=status]')!.textContent, '');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    await show(scalar.state, {
        validation: [
            {
                fieldId: 'check',
                fieldTitle: 'Approved',
                errorMessage: 'Configured validation',
            },
        ],
    });
    assert.equal(
        f.container.querySelector('[role=status]')!.textContent,
        'Configured validation'
    );
    await show({ ...scalar.state, kind: 'number' });
    assert.equal(f.input().disabled, true);
    await show({ ...scalar.state, canEdit: false });
    assert.equal(f.input().disabled, true);
    await show({ ...scalar.state, retired: true });
    assert.equal(f.container.querySelector('input'), null);
});
