import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    isValidElement,
    StrictMode,
    type ReactNode,
} from 'react';
import {
    CreatedTimeField,
    FieldRenderer,
    DateTimeField,
    type CreatedTimeFieldOptions,
    type DateTimeFieldOptions,
    renderCreatedTimeField,
} from '../src/react/index.js';
import { DateTimeControl } from '../src/react/DateTimeField.js';
import {
    createFormFieldBindings,
    type FormFieldBinding,
    type FormFieldSnapshot,
} from '../src/forms/bindings.js';
import {
    createFormFieldRendererHost,
    createPortalDetailRendererHost,
} from '../src/ui/rendererHosts.js';
import { createPortalCellBinding } from '../src/portals/cell.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import type {
    FieldConfig,
    FieldRendererProps,
} from '../src/ui/rendererRegistry.js';
import {
    createMiniExtensionsClient,
    type AirtableValue,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

type ResultConfig =
    FieldRendererProps<'createdTime'>['field']['config']['options']['result'];
const dateResult: ResultConfig = {
    type: 'date',
    options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
};
const dateTimeResult: ResultConfig = {
    type: 'dateTime',
    options: {
        dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
        timeFormat: { name: '24hour', format: 'HH:mm' },
        timeZone: 'utc',
    },
};

// Compile-time physical-kind boundaries are separate from shared string shapes.
function typeBoundaries(
    created: FieldRendererProps<'createdTime'>,
    modified: FieldRendererProps<'lastModifiedTime'>,
    timestamp: FieldRendererProps<'dateTime'>,
    options: DateTimeFieldOptions
) {
    const accepted: CreatedTimeFieldOptions = options;
    const reused: DateTimeFieldOptions = accepted;
    renderCreatedTimeField(created, reused);
    // @ts-expect-error Last Modified Time remains its own physical renderer kind.
    renderCreatedTimeField(modified);
    // @ts-expect-error Editable DateTime props do not become Created Time props.
    renderCreatedTimeField(timestamp);
}

async function fixture(
    t: TestContext,
    config: FieldConfig<'createdTime'> = {},
    initial: AirtableValue | undefined = undefined,
    computed = true,
    result: ResultConfig = dateTimeResult
) {
    const window = new Window();
    let requests = 0;
    window.fetch = async () => {
        requests++;
        throw Error('Created Time must not perform network requests');
    };
    for (const key of ['AbortController', 'AbortSignal'] as const)
        Object.defineProperty(window, key, { value: globalThis[key] });
    const keys = [
        'window',
        'document',
        'navigator',
        'fetch',
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
    loaded.payload.fieldIdsInForm.push('created');
    if (initial !== undefined) loaded.payload.formRecord.data.created = initial;
    loaded.payload.fieldIdsToSchemas.created = {
        fieldType: 'createdTime',
        airtableField: {
            id: 'created',
            name: 'Created time',
            description: null,
            isComputed: computed,
            isPrimaryField: false,
            config: {
                type: 'createdTime',
                options: { result: structuredClone(result) },
            },
        },
        miniExtConfig: config,
    };
    loaded.payload.fieldIdsInForm.push('dateTime');
    loaded.payload.formRecord.data.dateTime = '2024-01-31T23:45:59.120+05:45';
    loaded.payload.fieldIdsToSchemas.dateTime = {
        fieldType: 'dateTime',
        airtableField: {
            id: 'dateTime',
            name: 'Editable appointment',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: structuredClone(dateTimeResult) as Extract<
                ResultConfig,
                { type: 'dateTime' }
            >,
        },
        miniExtConfig: {},
    };
    const scope = { current: true, visible: true, revision: 0 };
    const owner = createFormFieldBindings({
        loaded,
        saveOptions: formSaveOptions(),
        client: createMiniExtensionsClient({
            apiOrigin: 'https://synthetic.invalid',
            fetch: async () => {
                requests++;
                throw Error('Created Time presentation must not perform I/O');
            },
        }),
        getScope: () => ({ ownerId: 'created-time-test', revision: 0 }),
        canWriteField: () => scope.visible,
    });
    let saveReads = 0;
    Object.defineProperty(owner, 'save', {
        get() {
            saveReads++;
            throw Error('Rendering cannot borrow Save');
        },
    });
    const binding = owner.field('created');
    let writes = 0;
    const originalSetValue = binding.setValue;
    binding.setValue = (value) => {
        writes++;
        return originalSetValue(value);
    };
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'created',
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
        assert.equal(saveReads, 0);
    });
    const input = () => {
        const node = container.querySelector('input');
        assert.ok(node);
        return node;
    };
    return {
        window,
        container,
        loaded,
        owner,
        binding,
        host,
        scope,
        input,
        writes: () => writes,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        tree: () =>
            h(FieldRenderer, {
                host,
                renderers: { renderCreatedTimeField },
                fallback: () => null,
            }),
        props: (): FieldRendererProps<'createdTime'> => {
            const snapshot = host.getSnapshot();
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'createdTime'
            )
                throw Error('Created Time props expected');
            return snapshot.fields[0];
        },
        edit: async (value: string, node = input()) => {
            await act(async () => {
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                )!.set!.call(node, value);
                node.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
        },
    };
}

function snapshotBinding(initial: FormFieldSnapshot) {
    let snapshot = initial;
    const listeners = new Set<(state: FormFieldSnapshot) => void>();
    let writes = 0;
    const binding: FormFieldBinding = {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            listener(snapshot);
            return () => {
                listeners.delete(listener);
            };
        },
        setValue() {
            writes++;
            throw Error('Created Time cannot borrow a setter');
        },
        scalar: null,
        date: null,
        selection: null,
    };
    return {
        binding,
        get writes() {
            return writes;
        },
        update(next: FormFieldSnapshot) {
            snapshot = next;
            for (const listener of listeners) listener(snapshot);
        },
    };
}

for (const value of [
    undefined,
    null,
    '',
    '2024-02-29T12:34:56.000Z',
    '2024-02-29T12:34:56.120+05:45',
    '2011-12-30T12:00:00-10:00',
])
    it(`preserves native ${JSON.stringify(value)} through readonly Form binding, slot and remount`, async (t) => {
        const f = await fixture(t, {}, value);
        const before = f.binding.getSnapshot();
        assert.equal(before.readOnly, true);
        assert.equal(before.canEdit, false);
        assert.equal(f.binding.date, null);
        assert.equal(f.binding.scalar, null);
        assert.equal(f.binding.selection, null);
        assert.equal(f.props().capability.type, 'readonly');
        for (const node of [
            h(CreatedTimeField, {
                binding: f.binding,
                className: 'created',
                clearLabel: 'Keep timestamp',
            }),
            f.tree(),
        ]) {
            await f.render(node);
            assert.equal(f.input().value, value ?? '');
            assert.equal(f.input().disabled, true);
            assert.equal(f.input().type, 'text');
            assert.equal(f.input().placeholder, 'YYYY-MM-DDTHH:mm:ssZ');
            assert.equal(f.container.querySelector('button')!.disabled, true);
            assert.equal(
                f.container.querySelector('select,[role=combobox],time,img,a'),
                null
            );
            await f.edit('replacement');
            await act(async () => f.container.querySelector('button')!.click());
            assert.equal(f.input().value, value ?? '');
            await f.render(null);
        }
        await f.render(h(CreatedTimeField, { binding: f.binding }));
        assert.equal(f.binding.getSnapshot().value, value);
        assert.equal(f.owner.controller.getState().draft!.data.created, value);
        assert.equal(f.binding.getSnapshot().revision, before.revision);
        assert.equal(f.binding.getSnapshot().dirty, false);
        assert.equal(
            Object.hasOwn(f.owner.controller.getState().draft!.data, 'created'),
            value !== undefined
        );
        assert.equal(f.writes(), 0);
    });

for (const result of [dateResult, dateTimeResult])
    it(`retains all accepted native strings with ${result.type} result metadata without parsing or formatting`, async (t) => {
        const f = await fixture(
            t,
            {},
            '2024-03-31T01:30:00.123+05:45',
            true,
            result
        );
        const initial = f.binding.getSnapshot();
        for (const value of [
            '2024-03-31T01:30:00.123+05:45',
            '2024-03-31T01:30:00',
            '2024-02-30T25:61:00Z',
            '2024-02-29',
            'not a timestamp',
            '  東京 <b>native</b> 🛰️  ',
            ' ',
            '',
        ]) {
            const loaded = f.owner.getLoaded();
            loaded.payload.formRecord.data.created = value;
            await act(async () => {
                assert.equal(
                    await f.owner.reload({
                        dirty: 'keep',
                        read: async () => loaded,
                    }),
                    true
                );
            });
            const binding = f.owner.field('created');
            const host = createFormFieldRendererHost({
                fields: f.owner,
                fieldId: 'created',
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            try {
                assert.equal(host.getSnapshot().status, 'ready');
                for (const node of [
                    h(CreatedTimeField, { binding }),
                    h(FieldRenderer, {
                        host,
                        renderers: { renderCreatedTimeField },
                        fallback: () => null,
                    }),
                ]) {
                    await f.render(node);
                    assert.equal(f.input().value, value);
                    assert.equal(
                        f.input().getAttribute('aria-invalid'),
                        'false'
                    );
                    assert.equal(
                        f.container.querySelector('[role=status]')!.textContent,
                        ''
                    );
                    assert.equal(f.container.querySelector('b'), null);
                    assert.equal(binding.getSnapshot().value, value);
                    assert.equal(binding.getSnapshot().dirty, false);
                    assert.equal(binding.date, null);
                }
            } finally {
                host.dispose();
            }
        }
        assert.equal(initial.value, '2024-03-31T01:30:00.123+05:45');
        assert.equal(f.writes(), 0);
    });

it('preserves CR/LF in native data while leaving single-line DOM sanitization to the input', async (t) => {
    const value = '2024-02-29T12:34:56Z\r\nsecond line\rthird\nfourth';
    const f = await fixture(t, {}, value, true, dateResult);
    const reference = f.window.document.createElement('input');
    reference.type = 'text';
    reference.value = value;
    for (const node of [
        h(CreatedTimeField, { binding: f.binding }),
        f.tree(),
    ]) {
        await f.render(node);
        assert.equal(f.input().value, reference.value);
        assert.equal(f.binding.getSnapshot().value, value);
        assert.equal(f.owner.controller.getState().draft!.data.created, value);
        assert.equal(f.binding.getSnapshot().dirty, false);
        await f.render(null);
    }
    assert.equal(f.writes(), 0);
});

it('direct helpers reject nonstring display without coercion or reading capabilities and nested result metadata', async (t) => {
    const native = '2024-02-29T12:34:56.120+05:45';
    const f = await fixture(t, {}, native);
    let reads = 0;
    const props = f.props();
    const field = { ...props.field, config: { ...props.field.config } };
    Object.defineProperty(field.config, 'options', {
        get() {
            reads++;
            throw Error('Nested result metadata is not display authority');
        },
    });
    const forged = {
        ...props,
        field,
        computed: false,
        get capability(): never {
            reads++;
            throw Error('No edit capability is borrowed');
        },
    } as FieldRendererProps<'createdTime'>;
    const invalid: unknown[] = [
        42,
        false,
        [],
        [native],
        {},
        { value: native },
        new Date(0),
        {
            toString() {
                throw Error('No object coercion');
            },
        },
    ];
    for (const { value, expected } of [
        { value: native, expected: native },
        { value: 'naive value', expected: 'naive value' },
        { value: '', expected: '' },
        { value: null, expected: '' },
        { value: undefined, expected: '' },
        ...invalid.map((value) => ({ value, expected: '' })),
    ]) {
        Object.assign(forged, { value });
        await f.render(
            renderCreatedTimeField(forged, {
                className: 'static-created',
                clearLabel: 'Do not clear',
            })
        );
        assert.ok(
            f.container.querySelector('.mx-sdk-datetime-field.static-created')
        );
        assert.equal(f.input().value, expected);
        assert.equal(f.input().disabled, true);
        assert.equal(f.input().getAttribute('aria-invalid'), 'false');
        const clear = f.container.querySelector('button')!;
        assert.equal(clear.disabled, true);
        assert.equal(clear.getAttribute('aria-label'), 'Do not clear');
        await f.edit('new timestamp');
        assert.equal(f.input().value, expected);
    }
    assert.equal(reads, 0);
    assert.equal(f.binding.getSnapshot().value, native);
    assert.equal(f.writes(), 0);
});

it('physical Created Time stays computed and readonly when returned isComputed is false', async (t) => {
    const native = '2024-02-29T12:34:56Z';
    const f = await fixture(t, {}, native, false, dateResult);
    assert.equal(f.binding.getSnapshot().canEdit, false);
    assert.equal(f.binding.getSnapshot().readOnly, true);
    assert.equal(f.binding.getSnapshot().field!.isComputed, true);
    assert.equal(f.props().computed, true);
    assert.equal(f.props().field.isComputed, false);
    assert.deepEqual(f.props().capability, { type: 'readonly' });
    for (const node of [
        f.tree(),
        h(CreatedTimeField, { binding: f.binding }),
    ]) {
        await f.render(node);
        assert.equal(f.input().disabled, true);
        await f.edit('unauthorized draft');
        await act(async () => f.container.querySelector('button')!.click());
        assert.equal(f.input().value, native);
    }
    assert.equal(f.binding.getSnapshot().value, native);
    assert.equal(f.writes(), 0);
});

it('binding value and result-metadata updates never borrow a model or reinterpret supplied timestamps', async (t) => {
    const native = '2024-02-29T12:34:56.120+05:45';
    const f = await fixture(t, {}, native);
    const initial = f.binding.getSnapshot();
    const pure = snapshotBinding(initial);
    let authorityReads = 0;
    for (const name of ['scalar', 'selection', 'date', 'setValue', 'save'])
        Object.defineProperty(pure.binding, name, {
            get() {
                authorityReads++;
                throw Error('No owner action is borrowed');
            },
        });
    await f.render(h(CreatedTimeField, { binding: pure.binding }));
    const nativeInput = f.input();
    for (const result of [
        dateResult,
        dateTimeResult,
        {
            ...dateTimeResult,
            options: { ...dateTimeResult.options, timeZone: 'client' },
        },
    ]) {
        const next = structuredClone(initial);
        const metadata = next.field!.schema.airtableField.config;
        if (metadata.type !== 'createdTime')
            throw Error('Expected Created Time metadata');
        metadata.options.result = result as ResultConfig;
        await act(async () => pure.update(next));
        assert.equal(f.input(), nativeInput);
        assert.equal(f.input().value, native);
        assert.equal(pure.binding.getSnapshot().value, native);
    }
    for (const { value, expected } of [
        {
            value: '2011-12-30T12:00:00-10:00',
            expected: '2011-12-30T12:00:00-10:00',
        },
        { value: '', expected: '' },
        { value: null, expected: '' },
        { value: undefined, expected: '' },
        { value: 17, expected: '' },
        { value: { value: native }, expected: '' },
    ]) {
        await act(async () =>
            pure.update({ ...initial, value: value as AirtableValue })
        );
        assert.equal(f.input().value, expected);
        assert.equal(f.input().disabled, true);
        assert.deepEqual(pure.binding.getSnapshot().value, value);
    }
    assert.equal(authorityReads, 0);
    assert.equal(pure.writes, 0);
});

it('real Form hosts reject malformed native shapes and result metadata without changing the draft', async (t) => {
    const native = '2024-02-29T12:34:56Z';
    const f = await fixture(t, {}, native);
    for (const { value, options } of [
        { value: 42, options: { result: dateResult } },
        { value: { value: native }, options: { result: dateResult } },
        { value: [native], options: { result: dateTimeResult } },
        { value: native, options: null },
        { value: native, options: {} },
        { value: native, options: { result: null } },
        { value: native, options: { result: { type: 'date', options: {} } } },
        {
            value: native,
            options: {
                result: {
                    type: 'dateTime',
                    options: {
                        dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                    },
                },
            },
        },
    ]) {
        const loaded = f.owner.getLoaded();
        loaded.payload.formRecord.data.created = value as AirtableValue;
        const schema = loaded.payload.fieldIdsToSchemas.created;
        if (schema.fieldType !== 'createdTime')
            throw Error('Expected Created Time metadata');
        schema.airtableField.config.options = options as never;
        await act(async () => {
            assert.equal(
                await f.owner.reload({
                    dirty: 'keep',
                    read: async () => loaded,
                }),
                true
            );
        });
        const binding = f.owner.field('created');
        const host = createFormFieldRendererHost({
            fields: f.owner,
            fieldId: 'created',
            isCurrent: () => true,
            configurationRevision: () => 0,
        });
        try {
            assert.equal(host.getSnapshot().status, 'unavailable');
            await f.render(
                h(FieldRenderer, {
                    host,
                    renderers: { renderCreatedTimeField },
                    fallback: () => h('span', null, 'Unavailable'),
                })
            );
            assert.equal(f.container.textContent, 'Unavailable');
            assert.equal(f.container.querySelector('input'), null);
            assert.deepEqual(binding.getSnapshot().value, value);
            assert.deepEqual(
                f.owner.controller.getState().draft!.data.created,
                value
            );
            assert.equal(binding.getSnapshot().dirty, false);
        } finally {
            host.dispose();
        }
    }
    assert.equal(f.writes(), 0);
});

it('disabled input, Clear and composition callbacks stay inert across replacement and unmount', async (t) => {
    const f = await fixture(t, {}, '2024-01-31T23:45:59.120+05:45');
    const initial = f.binding.getSnapshot();
    const pure = snapshotBinding({
        ...initial,
        canEdit: true,
        readOnly: false,
    });
    await f.render(h(CreatedTimeField, { binding: pure.binding }));
    const input = f.input();
    const clear = f.container.querySelector('button')!;
    const handlers = (node: object) => {
        const key = Object.keys(node).find((key) =>
            key.startsWith('__reactProps$')
        )!;
        return (
            node as Record<string, Record<string, (event: unknown) => void>>
        )[key];
    };
    const retained = handlers(input);
    const retainedWrapper = handlers(
        f.container.querySelector('.mx-sdk-datetime-field')!
    );
    const retainedClear = handlers(clear).onClick;
    const event = { currentTarget: input, stopPropagation() {} };
    await act(async () => {
        retainedWrapper.onCompositionStart(event);
        input.value = '未確定';
        retained.onChange(event);
        retainedWrapper.onCompositionEnd(event);
        retainedClear({ stopPropagation() {} });
    });
    assert.equal(f.input().value, '2024-01-31T23:45:59.120+05:45');
    await act(async () =>
        pure.update({ ...initial, value: '2011-12-30T12:00:00-10:00' })
    );
    await act(async () => {
        input.value = 'late';
        retained.onChange(event);
        retainedWrapper.onCompositionEnd(event);
        retainedClear({ stopPropagation() {} });
    });
    assert.deepEqual(
        pure.binding.getSnapshot().value,
        '2011-12-30T12:00:00-10:00'
    );
    await f.render(null);
    await act(async () => {
        retained.onChange(event);
        retainedClear({ stopPropagation() {} });
    });
    await f.render(h(CreatedTimeField, { binding: pure.binding }));
    assert.equal(f.input().value, '2011-12-30T12:00:00-10:00');
    assert.equal(pure.writes, 0);
});

it('captured control callbacks cannot borrow authority or change native data even when invoked directly after replacement', async (t) => {
    const original = '2024-01-31T23:45:59.120+05:45';
    const replacement = '2011-12-30T12:00:00-10:00';
    const f = await fixture(t, {}, original);
    const initial = f.binding.getSnapshot();
    const pure = snapshotBinding({
        ...initial,
        canEdit: true,
        readOnly: false,
    });
    let authorityReads = 0;
    for (const name of ['scalar', 'selection', 'date', 'setValue', 'save'])
        Object.defineProperty(pure.binding, name, {
            get() {
                authorityReads++;
                throw Error(
                    'Readonly callbacks must not borrow owner authority'
                );
            },
        });
    const props = {
        ...f.props(),
        get capability(): never {
            authorityReads++;
            throw Error('Readonly callbacks must not borrow slot authority');
        },
    };
    type ControlBoundary = {
        disabled: boolean;
        input: string;
        setInput(value: string): void;
        clear(): void;
    };
    const slot = renderCreatedTimeField(props);
    assert.ok(isValidElement<ControlBoundary>(slot));
    assert.equal(slot.props.disabled, true);
    await f.render(h(CreatedTimeField, { binding: pure.binding }));
    // Like the retained DOM-event test above, inspect React's committed props
    // only to exercise the adapter boundary independently of disabled DOM guards.
    // The actual binding component remains mounted through React with its hooks.
    type MountedFiber = {
        type: unknown;
        memoizedProps: ControlBoundary;
        return: MountedFiber | null;
    };
    const input = f.input();
    const fiberKey = Object.keys(input).find((key) =>
        key.startsWith('__reactFiber$')
    );
    assert.ok(fiberKey);
    let fiber = (input as unknown as Record<string, MountedFiber>)[fiberKey];
    while (fiber && fiber.type !== DateTimeControl) fiber = fiber.return!;
    assert.ok(fiber, 'Mounted DateTimeControl callback boundary expected');
    const bindingCallbacks = fiber.memoizedProps;
    assert.equal(bindingCallbacks.disabled, true);
    const retained = [slot.props, bindingCallbacks];
    const invoke = () => {
        for (const callbacks of retained) {
            callbacks.setInput('2000-01-01T00:00:00Z');
            callbacks.setInput('');
            callbacks.clear();
        }
    };
    await act(async () => invoke());
    assert.equal(f.input().value, original);
    assert.equal(pure.binding.getSnapshot().value, original);
    assert.equal(pure.binding.getSnapshot().dirty, false);
    await act(async () => pure.update({ ...initial, value: replacement }));
    await act(async () => invoke());
    assert.equal(f.input().value, replacement);
    assert.equal(pure.binding.getSnapshot().value, replacement);
    assert.equal(pure.binding.getSnapshot().dirty, false);
    await f.render(null);
    await act(async () => invoke());
    assert.equal(pure.binding.getSnapshot().value, replacement);
    assert.equal(f.binding.getSnapshot().value, original);
    assert.equal(f.owner.controller.getState().draft!.data.created, original);
    assert.equal(authorityReads, 0);
    assert.equal(pure.writes, 0);
    assert.equal(f.writes(), 0);
});

it('accepted metadata reload retires the old binding while preserving the native timestamp', async (t) => {
    const f = await fixture(t, {}, '2024-02-29T12:34:56.123+05:45');
    await f.render(h(CreatedTimeField, { binding: f.binding }));
    const fresh = f.owner.getLoaded();
    const schema = fresh.payload.fieldIdsToSchemas.created;
    if (schema.fieldType !== 'createdTime')
        throw Error('Expected created schema');
    schema.airtableField.config.options.result = structuredClone(dateResult);
    await act(async () => {
        assert.equal(
            await f.owner.reload({ dirty: 'keep', read: async () => fresh }),
            true
        );
    });
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(f.binding.getSnapshot().retired, true);
    const successor = f.owner.field('created');
    assert.notEqual(successor, f.binding);
    assert.equal(successor.getSnapshot().readOnly, true);
    await f.render(h(CreatedTimeField, { binding: successor }));
    assert.equal(f.input().value, '2024-02-29T12:34:56.123+05:45');
    await f.edit('replacement');
    assert.deepEqual(
        successor.getSnapshot().value,
        '2024-02-29T12:34:56.123+05:45'
    );
    assert.equal(successor.getSnapshot().dirty, false);
    assert.equal(f.writes(), 0);
});

it('associates unique labels, pending and plain feedback while preserving hidden titles and empty owner errors', async (t) => {
    const f = await fixture(
        t,
        { title: 'Created title' },
        '2024-02-29T12:34:56.000Z'
    );
    const props = {
        ...f.props(),
        pending: true,
        error: '<b>Owner feedback</b>',
    };
    await f.render(
        h(
            'div',
            null,
            renderCreatedTimeField(props),
            renderCreatedTimeField(props)
        )
    );
    const inputs = f.container.querySelectorAll('input');
    assert.notEqual(inputs[0].id, inputs[1].id);
    assert.equal(f.container.querySelector('label')!.htmlFor, inputs[0].id);
    assert.equal(
        f.container.querySelector('label')!.textContent,
        'Created title'
    );
    assert.equal(f.input().getAttribute('aria-busy'), 'true');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    const feedback = f.window.document.getElementById(
        f.input().getAttribute('aria-describedby')!
    )!;
    assert.equal(feedback.textContent, props.error);
    assert.equal(feedback.querySelector('b'), null);
    assert.equal(feedback.getAttribute('aria-live'), 'polite');
    for (const error of ['', null]) {
        await f.render(
            renderCreatedTimeField({
                ...f.props(),
                title: ' ',
                displayConfig: { showTitle: false },
                error,
                validation: [
                    {
                        fieldId: 'created',
                        fieldTitle: 'Created time',
                        errorMessage: 'Owner validation',
                    },
                ],
            })
        );
        assert.equal(f.container.querySelector('label'), null);
        assert.equal(f.input().getAttribute('aria-label'), 'Created time');
        assert.equal(
            f.container.querySelector('[role=status]')!.textContent,
            error === '' ? '' : 'Owner validation'
        );
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    }
});

it('honors display and write masking without exposing the native timestamp in labels or feedback', async (t) => {
    const f = await fixture(
        t,
        { maskPasswordOnLoginScreen: true },
        '2024-02-29T12:34:56.123-04:00'
    );
    await f.render(h(CreatedTimeField, { binding: f.binding }));
    assert.equal(f.input().type, 'password');
    for (const which of ['displayConfig', 'writeConfig'] as const) {
        await f.render(
            renderCreatedTimeField({
                ...f.props(),
                displayConfig: { showTitle: false },
                writeConfig: {},
                [which]: { maskPasswordOnLoginScreen: true, showTitle: false },
            })
        );
        assert.equal(f.input().type, 'password');
        assert.equal(f.input().disabled, true);
        assert.equal(f.input().value, '2024-02-29T12:34:56.123-04:00');
        assert.equal(
            f.container.textContent?.includes('2024-02-29T12:34:56.123-04:00'),
            false
        );
        assert.equal(f.container.querySelector('label'), null);
        assert.equal(f.input().getAttribute('aria-label'), 'Created time');
    }
});

it('omits hidden and retired bindings, refuses other physical kinds, and prioritizes custom rendering', async (t) => {
    const f = await fixture(t, {}, '2024-02-29T12:34:56.000Z');
    const initial = f.binding.getSnapshot();
    const pure = snapshotBinding(initial);
    await f.render(h(CreatedTimeField, { binding: pure.binding }));
    for (const next of [
        {
            ...initial,
            visibility: { type: 'hidden' as const, diagnostics: [] },
        },
        { ...initial, retired: true },
    ]) {
        await act(async () => pure.update(next));
        assert.equal(f.container.querySelector('input'), null);
        assert.equal(f.container.textContent, '');
    }
    const modified = structuredClone(initial);
    modified.field!.fieldType = 'lastModifiedTime';
    modified.field!.schema = {
        ...modified.field!.schema,
        fieldType: 'lastModifiedTime',
        airtableField: {
            ...modified.field!.schema.airtableField,
            config: {
                type: 'lastModifiedTime',
                options: { isValid: true, result: dateTimeResult },
            },
        },
    } as NonNullable<FormFieldSnapshot['field']>['schema'];
    const mismatched = structuredClone(initial);
    mismatched.field!.schema.airtableField.config = {
        type: 'singleLineText',
        options: null,
    } as never;
    for (const next of [
        f.owner.field('dateTime').getSnapshot(),
        modified,
        mismatched,
    ]) {
        await act(async () => pure.update(next));
        assert.equal(f.container.querySelector('input'), null);
        assert.equal(
            f.container.querySelector('[role=status]')!.textContent,
            'This control supports Created Time fields.'
        );
    }
    await act(async () => pure.update({ ...initial, retired: true }));
    await f.render(
        h(CreatedTimeField, {
            binding: pure.binding,
            render: ({ snapshot, binding }) =>
                h(
                    'output',
                    null,
                    `${snapshot.retired}:${binding === pure.binding}`
                ),
        })
    );
    assert.equal(f.container.textContent, 'true:true');
    await f.render(f.tree());
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    assert.equal(f.container.querySelector('input'), null);
    await act(async () => f.owner.destroy());
    await f.render(h(CreatedTimeField, { binding: f.binding }));
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(pure.writes, 0);
});

it('contains control events and leaves a neighboring DateTime field editable with owner-held validation and clear semantics', async (t) => {
    const f = await fixture(t, {}, '2024-02-29T12:34:56.000Z');
    let rows = 0;
    const row = () => {
        rows++;
    };
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
            renderCreatedTimeField(f.props())
        )
    );
    const wrapper = f.container.querySelector('.mx-sdk-datetime-field')!;
    await act(async () => {
        for (const type of [
            'click',
            'dblclick',
            'auxclick',
            'pointerdown',
            'keydown',
            'keyup',
        ])
            wrapper.dispatchEvent(new f.window.Event(type, { bubbles: true }));
        for (const type of ['compositionstart', 'compositionend'])
            f.input().dispatchEvent(
                new f.window.CompositionEvent(type, { bubbles: true })
            );
    });
    await f.edit('attempt');
    assert.equal(rows, 0);
    const timestamp = f.owner.field('dateTime');
    await f.render(
        h(
            'div',
            null,
            h(CreatedTimeField, { binding: f.binding }),
            h(DateTimeField, { binding: timestamp })
        )
    );
    const inputs = f.container.querySelectorAll('input');
    assert.equal(inputs[0].disabled, true);
    assert.equal(inputs[1].disabled, false);
    await f.edit('2024-', inputs[1]);
    assert.equal(
        timestamp.getSnapshot().value,
        '2024-01-31T23:45:59.120+05:45'
    );
    assert.equal(timestamp.date!.getState().valid, false);
    await f.edit('2024-02-29T12:30:00.120+05:45', inputs[1]);
    assert.equal(
        timestamp.getSnapshot().value,
        '2024-02-29T12:30:00.120+05:45'
    );
    assert.equal(timestamp.date!.getState().valid, true);
    await act(async () => f.container.querySelectorAll('button')[1].click());
    assert.equal(timestamp.getSnapshot().value, null);
    assert.deepEqual(f.binding.getSnapshot().value, '2024-02-29T12:34:56.000Z');
    assert.equal(f.writes(), 0);
});

for (const layout of ['grid', 'list'] as const)
    it(`uses readonly Portal ${layout} detail props without inline authority or additional reads`, async (t) => {
        const f = await fixture(
            t,
            {},
            '2024-02-29T12:34:56.120+05:45',
            false,
            layout === 'grid' ? dateResult : dateTimeResult
        );
        const schema = f.loaded.payload.fieldIdsToSchemas.created;
        if (schema.fieldType !== 'createdTime')
            throw Error('Expected Created Time schema');
        const detail = {
            fieldId: 'created',
            fieldName: 'Created time',
            titleOverride: '',
            isHidden: false,
            fieldIsInEditingChildForm: false,
            childFormField: null,
            miniExtConfig: schema.miniExtConfig,
        };
        const api = portalFixture(async () =>
            portalListPage({
                recordIds: ['record_1'],
                customViewDetailFields: { fld_children: [detail] },
                tableIdsToLinkedTableStates: {
                    table_children: {
                        airtableFields: [schema.airtableField],
                        recordIdsToAirtableRecords: {
                            record_1: {
                                id: 'record_1',
                                fields: {
                                    created: '2024-02-29T12:34:56.120+05:45',
                                },
                            },
                        },
                    },
                },
            })
        );
        const owner = createPortalListOwner({
            client: api.client,
            portal: portalPage({ disableInlineEdit: false, layout }),
            portalFieldId: 'fld_children',
            criteria: {
                selectedCustomViewId: 'view_example',
                searchTerm: '',
                searchParamsMap: {},
                sortFieldsByEndUser: null,
                filtersByEndUser: null,
                supportsEndUserSortCleanup: true,
                supportsEndUserFilterCleanup: true,
            },
            getScope: () => ({ ownerId: 'created-time-portal', revision: 0 }),
        });
        await owner.readFirst(owner.getSnapshot().revision, {
            pagesToFetch: 1,
            refreshLoggedInPortalRecord: false,
        });
        let current = true;
        const host = createPortalDetailRendererHost({
            owner,
            client: api.client,
            recordId: 'record_1',
            isCurrent: () => current,
            configurationRevision: () => 0,
        });
        t.after(() => {
            host.dispose();
            owner.destroy();
            assert.equal(api.calls.length, 1);
            assert.equal(api.mutations, 0);
        });
        assert.throws(
            () =>
                createPortalCellBinding({
                    client: api.client,
                    // Standalone admission reads the explicit metadata flag;
                    // the accepted detail host below independently enforces kind.
                    schema: {
                        ...schema,
                        airtableField: {
                            ...schema.airtableField,
                            isComputed: true,
                        },
                    },
                    value: '2024-02-29T12:34:56.120+05:45',
                    input: {
                        portalExtensionAccessToken: 'portal_access_example',
                        portalFieldId: 'fld_children',
                        recordId: 'record_1',
                        recordFieldId: 'created',
                        selectedCustomViewId: 'view_example',
                    },
                    getScope: () => ({
                        ownerId: 'created-time-portal',
                        revision: 0,
                    }),
                    isCurrent: () => current,
                    recovery: {
                        journal: new RecoveryJournal(),
                        scope: {
                            owner: 'created-time-portal',
                            parentFieldId: 'fld_children',
                            tableId: 'table_children',
                            childExtensionId: '',
                            context: 'modal',
                        },
                        loadVersion: 1,
                    },
                }),
            /This field cannot be edited inline/
        );
        const state = host.getSnapshot();
        assert.equal(state.status, 'ready');
        if (state.status !== 'ready') throw Error('Portal props expected');
        assert.equal(state.fields[0].physicalKind, 'createdTime');
        assert.equal(state.fields[0].computed, true);
        assert.equal(state.fields[0].field.isComputed, false);
        assert.deepEqual(
            state.fields[0].value,
            '2024-02-29T12:34:56.120+05:45'
        );
        assert.equal(state.fields[0].capability.type, 'readonly');
        const tree = () =>
            h(FieldRenderer, {
                host,
                renderers: { renderCreatedTimeField },
                fallback: () => null,
            });
        await f.render(tree());
        assert.equal(f.input().disabled, true);
        assert.equal(f.input().value, '2024-02-29T12:34:56.120+05:45');
        assert.equal(f.container.querySelector('button')!.disabled, true);
        await f.edit('edited');
        assert.equal(f.input().value, '2024-02-29T12:34:56.120+05:45');
        await f.render(null);
        await f.render(tree());
        assert.equal(f.input().value, '2024-02-29T12:34:56.120+05:45');
        current = false;
        await f.render(tree());
        assert.equal(f.container.querySelector('input'), null);
        assert.equal(api.calls.length, 1);
        assert.equal(api.mutations, 0);
    });
