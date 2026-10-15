import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    LastModifiedByField,
    FieldRenderer,
    TextField,
    renderLastModifiedByField,
} from '../src/react/index.js';
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
    type AirtableCollaborator,
    type AirtableValue,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

const person = (name: string): AirtableCollaborator => ({
    id: 'usr_stored',
    email: 'private@example.test',
    name,
    profilePicUrl: 'https://avatar.synthetic.invalid/private.png',
});

async function fixture(
    t: TestContext,
    config: FieldConfig<'lastModifiedBy'> = {},
    initial: AirtableValue | undefined = undefined,
    computed = true
) {
    const window = new Window();
    let requests = 0;
    window.fetch = async () => {
        requests++;
        throw Error('Last Modified By must not fetch identities or avatars');
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
    loaded.payload.fieldIdsInForm.push('modifier');
    if (initial !== undefined)
        loaded.payload.formRecord.data.modifier = initial;
    loaded.payload.fieldIdsToSchemas.modifier = {
        fieldType: 'lastModifiedBy',
        airtableField: {
            id: 'modifier',
            name: 'Last modified by',
            description: null,
            isComputed: computed,
            isPrimaryField: false,
            config: {
                type: 'lastModifiedBy',
                options: {
                    choices: [
                        {
                            id: 'usr_known',
                            email: 'known@example.test',
                            name: 'Known person',
                        },
                    ],
                },
            },
        },
        miniExtConfig: config,
    };
    const scope = { current: true, visible: true, revision: 0 };
    const owner = createFormFieldBindings({
        loaded,
        saveOptions: formSaveOptions(),
        client: createMiniExtensionsClient({
            apiOrigin: 'https://synthetic.invalid',
            fetch: async () => {
                requests++;
                throw Error(
                    'Last Modified By presentation must not perform I/O'
                );
            },
        }),
        getScope: () => ({ ownerId: 'last-modified-by-test', revision: 0 }),
        canWriteField: () => scope.visible,
    });
    let saveReads = 0;
    Object.defineProperty(owner, 'save', {
        get() {
            saveReads++;
            throw Error('Rendering cannot borrow Save');
        },
    });
    const binding = owner.field('modifier');
    let writes = 0;
    const originalSetValue = binding.setValue;
    binding.setValue = (value) => {
        writes++;
        return originalSetValue(value);
    };
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'modifier',
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
                renderers: { renderLastModifiedByField },
                fallback: () => null,
            }),
        props: (): FieldRendererProps<'lastModifiedBy'> => {
            const snapshot = host.getSnapshot();
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'lastModifiedBy'
            )
                throw Error('Last Modified By props expected');
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
            throw Error('Last Modified By cannot borrow a setter');
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

for (const { value, expected } of [
    { value: undefined, expected: '' },
    { value: null, expected: '' },
    { value: person(''), expected: '' },
    { value: person('Unlisted person'), expected: 'Unlisted person' },
    {
        value: person('  東京 <b>name</b> 🛰️  '),
        expected: '  東京 <b>name</b> 🛰️  ',
    },
])
    it(`preserves native ${JSON.stringify(value)} through readonly Form binding, slot and remount`, async (t) => {
        const f = await fixture(t, {}, value);
        const before = f.binding.getSnapshot();
        assert.equal(before.readOnly, true);
        assert.equal(before.canEdit, false);
        assert.equal(f.binding.scalar, null);
        assert.equal(f.binding.selection, null);
        assert.equal(f.props().capability.type, 'readonly');
        for (const node of [
            h(LastModifiedByField, {
                binding: f.binding,
                className: 'modifier',
                clearLabel: 'Keep modifier',
            }),
            f.tree(),
        ]) {
            await f.render(node);
            assert.equal(f.input().value, expected);
            assert.equal(f.input().disabled, true);
            assert.equal(f.input().type, 'text');
            assert.equal(f.container.querySelector('button')!.disabled, true);
            assert.equal(
                f.container.querySelector('select,[role=combobox],b,img,a'),
                null
            );
            assert.equal(
                f.container.innerHTML.includes('private@example.test'),
                false
            );
            assert.equal(f.container.innerHTML.includes('usr_stored'), false);
            assert.equal(
                f.container.innerHTML.includes('avatar.synthetic.invalid'),
                false
            );
            await f.edit('replacement');
            await act(async () => f.container.querySelector('button')!.click());
            assert.equal(f.input().value, expected);
            await f.render(null);
        }
        await f.render(h(LastModifiedByField, { binding: f.binding }));
        assert.deepEqual(f.binding.getSnapshot().value, value);
        assert.deepEqual(
            f.owner.controller.getState().draft!.data.modifier,
            value
        );
        assert.equal(f.binding.getSnapshot().revision, before.revision);
        assert.equal(f.binding.getSnapshot().dirty, false);
        assert.equal(
            Object.hasOwn(
                f.owner.controller.getState().draft!.data,
                'modifier'
            ),
            value !== undefined
        );
        assert.equal(f.writes(), 0);
    });

it('direct helpers validate native objects without coercion, choice fallback or capability access', async (t) => {
    const native = person('Supplied name');
    const f = await fixture(t, {}, native);
    let reads = 0;
    const props = f.props();
    const field = { ...props.field, config: { ...props.field.config } };
    Object.defineProperty(field.config, 'options', {
        get() {
            reads++;
            throw Error('Choices are not display authority');
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
    } as FieldRendererProps<'lastModifiedBy'>;
    const noCoercion = {
        toString() {
            throw Error('No object coercion');
        },
    };
    const invalid = [
        '',
        'usr_stored',
        42,
        false,
        [],
        [native],
        { name: 'Only name' },
        { email: native.email, name: 'Missing ID' },
        { id: native.id, name: 'Missing email' },
        { ...native, name: null },
        { ...native, name: noCoercion },
        { ...native, profilePicUrl: 17 },
        { ...native, profilePicUrl: null },
        Object.assign(Object.create(null), native),
        new (class {
            id = native.id;
            email = native.email;
            name = 'Instance';
        })(),
    ];
    for (const { value, expected } of [
        { value: native, expected: 'Supplied name' },
        { value: person(''), expected: '' },
        {
            value: { ...native, profilePicUrl: undefined },
            expected: 'Supplied name',
        },
        { value: null, expected: '' },
        { value: undefined, expected: '' },
        ...invalid.map((value) => ({ value, expected: '' })),
    ]) {
        Object.assign(forged, { value });
        await f.render(
            renderLastModifiedByField(forged, {
                className: 'static-modifier',
                clearLabel: 'Do not clear',
            })
        );
        assert.ok(
            f.container.querySelector('.mx-sdk-text-field.static-modifier')
        );
        assert.equal(f.input().value, expected);
        assert.equal(f.input().disabled, true);
        const clear = f.container.querySelector('button')!;
        assert.equal(clear.disabled, true);
        assert.equal(clear.getAttribute('aria-label'), 'Do not clear');
        await f.edit('new modifier');
        assert.equal(f.input().value, expected);
        assert.equal(f.container.querySelector('img,a,select'), null);
    }
    assert.equal(reads, 0);
    assert.deepEqual(f.binding.getSnapshot().value, native);
    assert.equal(f.writes(), 0);
});

it('physical Last Modified By stays computed and readonly when returned isComputed is false', async (t) => {
    const native = person('Supplied native');
    const f = await fixture(t, {}, native, false);
    assert.equal(f.binding.getSnapshot().canEdit, false);
    assert.equal(f.binding.getSnapshot().readOnly, true);
    assert.equal(f.binding.getSnapshot().field!.isComputed, true);
    assert.equal(f.props().computed, true);
    assert.equal(f.props().field.isComputed, false);
    assert.deepEqual(f.props().capability, { type: 'readonly' });
    for (const node of [
        f.tree(),
        h(LastModifiedByField, { binding: f.binding }),
    ]) {
        await f.render(node);
        assert.equal(f.input().disabled, true);
        await f.edit('unauthorized draft');
        await act(async () => f.container.querySelector('button')!.click());
        assert.equal(f.input().value, 'Supplied native');
    }
    assert.deepEqual(f.binding.getSnapshot().value, native);
    assert.equal(f.writes(), 0);
});

it('choices and extra reference metadata never remap names and native updates retain complete objects', async (t) => {
    const native = person('Supplied native');
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
    await f.render(h(LastModifiedByField, { binding: pure.binding }));
    const nativeInput = f.input();
    for (const choices of [
        [
            {
                id: native.id,
                email: 'different@example.test',
                name: 'Renamed choice',
            },
        ],
        [{ id: 'new_id', email: native.email, name: 'Metadata name' }],
        [],
    ]) {
        const next = structuredClone(initial);
        const metadata = next.field!.schema.airtableField.config;
        if (metadata.type !== 'lastModifiedBy')
            throw Error('Expected modifier metadata');
        metadata.options.choices = choices;
        // LastModifiedBy has no result/validity or referenced-field display policy.
        Object.assign(metadata.options, {
            referencedFieldIds: ['fld_title', 'unreturned_private_field'],
            isValid: false,
        });
        await act(async () => pure.update(next));
        assert.equal(f.input(), nativeInput);
        assert.equal(f.input().value, 'Supplied native');
        assert.deepEqual(pure.binding.getSnapshot().value, native);
    }
    for (const { value, expected } of [
        { value: person('Changed native'), expected: 'Changed native' },
        { value: person(''), expected: '' },
        { value: null, expected: '' },
        { value: undefined, expected: '' },
        {
            value: { id: native.id, email: native.email, name: 17 },
            expected: '',
        },
        { value: { ...native, profilePicUrl: false }, expected: '' },
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

it('real Form hosts reject malformed values and metadata without changing the native draft', async (t) => {
    const f = await fixture(t, {}, person('Accepted'));
    for (const { value, options } of [
        { value: 'raw string', options: { choices: [] } },
        { value: { name: 'Incomplete' }, options: { choices: [] } },
        {
            value: { ...person('Malformed avatar'), profilePicUrl: 1 },
            options: { choices: [] },
        },
        { value: [person('Wrong array')], options: { choices: [] } },
        { value: person('Preserved'), options: null },
        { value: person('Preserved'), options: {} },
        {
            value: person('Preserved'),
            options: { choices: [{ id: 'usr_bad', name: 'Missing email' }] },
        },
    ]) {
        const loaded = f.owner.getLoaded();
        loaded.payload.formRecord.data.modifier = value as AirtableValue;
        const schema = loaded.payload.fieldIdsToSchemas.modifier;
        if (schema.fieldType !== 'lastModifiedBy')
            throw Error('Expected modifier metadata');
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
        const binding = f.owner.field('modifier');
        const host = createFormFieldRendererHost({
            fields: f.owner,
            fieldId: 'modifier',
            isCurrent: () => true,
            configurationRevision: () => 0,
        });
        try {
            assert.equal(host.getSnapshot().status, 'unavailable');
            await f.render(
                h(FieldRenderer, {
                    host,
                    renderers: { renderLastModifiedByField },
                    fallback: () => h('span', null, 'Unavailable'),
                })
            );
            assert.equal(f.container.textContent, 'Unavailable');
            assert.equal(f.container.querySelector('input'), null);
            assert.deepEqual(binding.getSnapshot().value, value);
            assert.deepEqual(
                f.owner.controller.getState().draft!.data.modifier,
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
    const f = await fixture(t, {}, person('Original'));
    const initial = f.binding.getSnapshot();
    const pure = snapshotBinding({
        ...initial,
        canEdit: true,
        readOnly: false,
    });
    await f.render(h(LastModifiedByField, { binding: pure.binding }));
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
    const retainedClear = handlers(clear).onClick;
    const event = { currentTarget: input, stopPropagation() {} };
    await act(async () => {
        retained.onCompositionStart(event);
        input.value = '未確定';
        retained.onChange(event);
        retained.onCompositionEnd(event);
        retainedClear({ stopPropagation() {} });
    });
    assert.equal(f.input().value, 'Original');
    await act(async () =>
        pure.update({ ...initial, value: person('Successor') })
    );
    await act(async () => {
        input.value = 'late';
        retained.onChange(event);
        retained.onCompositionEnd(event);
        retainedClear({ stopPropagation() {} });
    });
    assert.deepEqual(pure.binding.getSnapshot().value, person('Successor'));
    await f.render(null);
    await act(async () => {
        retained.onChange(event);
        retainedClear({ stopPropagation() {} });
    });
    await f.render(h(LastModifiedByField, { binding: pure.binding }));
    assert.equal(f.input().value, 'Successor');
    assert.equal(pure.writes, 0);
});

it('accepted synthetic metadata reload retires the old binding without remapping native collaborator objects', async (t) => {
    const f = await fixture(t, {}, person('Stored modifier'));
    await f.render(h(LastModifiedByField, { binding: f.binding }));
    const fresh = f.owner.getLoaded();
    const schema = fresh.payload.fieldIdsToSchemas.modifier;
    if (schema.fieldType !== 'lastModifiedBy')
        throw Error('Expected modifier schema');
    schema.airtableField.config.options.choices = [
        {
            id: 'replacement',
            email: 'replacement@example.test',
            name: 'Renamed metadata',
        },
    ];
    const references = ['fld_title', 'unreturned_private_field'];
    Object.assign(schema.airtableField.config.options, {
        referencedFieldIds: references,
    });
    await act(async () => {
        assert.equal(
            await f.owner.reload({ dirty: 'keep', read: async () => fresh }),
            true
        );
    });
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(f.binding.getSnapshot().retired, true);
    const successor = f.owner.field('modifier');
    assert.notEqual(successor, f.binding);
    assert.equal(successor.getSnapshot().readOnly, true);
    const successorHost = createFormFieldRendererHost({
        fields: f.owner,
        fieldId: 'modifier',
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    try {
        const state = successorHost.getSnapshot();
        assert.equal(state.status, 'ready');
        if (state.status !== 'ready') throw Error('Expected successor props');
        assert.equal(state.fields[0].physicalKind, 'lastModifiedBy');
        assert.deepEqual(
            Reflect.get(
                state.fields[0].field.config.options!,
                'referencedFieldIds'
            ),
            references
        );
        assert.deepEqual(state.fields[0].value, person('Stored modifier'));
    } finally {
        successorHost.dispose();
    }
    await f.render(h(LastModifiedByField, { binding: successor }));
    assert.equal(f.input().value, 'Stored modifier');
    await f.edit('replacement');
    assert.deepEqual(successor.getSnapshot().value, person('Stored modifier'));
    assert.equal(successor.getSnapshot().dirty, false);
    assert.equal(f.writes(), 0);
});

it('associates unique labels, pending and plain feedback while preserving hidden titles and empty owner errors', async (t) => {
    const f = await fixture(t, { title: 'Modifier title' }, person('Raw name'));
    const props = {
        ...f.props(),
        pending: true,
        error: '<b>Owner feedback</b>',
    };
    await f.render(
        h(
            'div',
            null,
            renderLastModifiedByField(props),
            renderLastModifiedByField(props)
        )
    );
    const inputs = f.container.querySelectorAll('input');
    assert.notEqual(inputs[0].id, inputs[1].id);
    assert.equal(f.container.querySelector('label')!.htmlFor, inputs[0].id);
    assert.equal(
        f.container.querySelector('label')!.textContent,
        'Modifier title'
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
            renderLastModifiedByField({
                ...f.props(),
                title: ' ',
                displayConfig: { showTitle: false },
                error,
                validation: [
                    {
                        fieldId: 'modifier',
                        fieldTitle: 'Last modified by',
                        errorMessage: 'Owner validation',
                    },
                ],
            })
        );
        assert.equal(f.container.querySelector('label'), null);
        assert.equal(f.input().getAttribute('aria-label'), 'Last modified by');
        assert.equal(
            f.container.querySelector('[role=status]')!.textContent,
            error === '' ? '' : 'Owner validation'
        );
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    }
});

it('honors display and write masking without exposing the supplied name in labels or feedback', async (t) => {
    const f = await fixture(
        t,
        { maskPasswordOnLoginScreen: true },
        person('Secret modifier')
    );
    await f.render(h(LastModifiedByField, { binding: f.binding }));
    assert.equal(f.input().type, 'password');
    for (const which of ['displayConfig', 'writeConfig'] as const) {
        await f.render(
            renderLastModifiedByField({
                ...f.props(),
                displayConfig: { showTitle: false },
                writeConfig: {},
                [which]: { maskPasswordOnLoginScreen: true, showTitle: false },
            })
        );
        assert.equal(f.input().type, 'password');
        assert.equal(f.input().disabled, true);
        assert.equal(f.input().value, 'Secret modifier');
        assert.equal(
            f.container.textContent?.includes('Secret modifier'),
            false
        );
        assert.equal(f.container.querySelector('label'), null);
        assert.equal(f.input().getAttribute('aria-label'), 'Last modified by');
    }
});

it('omits hidden and retired bindings, refuses other physical kinds, and prioritizes custom rendering', async (t) => {
    const f = await fixture(t, {}, person('Modifier'));
    const initial = f.binding.getSnapshot();
    const pure = snapshotBinding(initial);
    await f.render(h(LastModifiedByField, { binding: pure.binding }));
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
    const mismatched = structuredClone(initial);
    mismatched.field!.schema.airtableField.config = {
        type: 'singleLineText',
        options: null,
    } as never;
    const createdBy = structuredClone(initial);
    createdBy.field!.fieldType = 'createdBy';
    createdBy.field!.schema.fieldType = 'createdBy';
    createdBy.field!.schema.airtableField.config = {
        type: 'createdBy',
        options: { choices: [] },
    };
    for (const next of [
        f.owner.field('fld_title').getSnapshot(),
        mismatched,
        createdBy,
    ]) {
        await act(async () => pure.update(next));
        assert.equal(f.container.querySelector('input'), null);
        assert.equal(
            f.container.querySelector('[role=status]')!.textContent,
            'This control supports Last Modified By fields.'
        );
    }
    await act(async () => pure.update({ ...initial, retired: true }));
    await f.render(
        h(LastModifiedByField, {
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
    await f.render(h(LastModifiedByField, { binding: f.binding }));
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(pure.writes, 0);
});

it('contains control events and leaves a neighboring Text field editable with native clear semantics', async (t) => {
    const f = await fixture(t, {}, person('Fixed modifier'));
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
            renderLastModifiedByField(f.props())
        )
    );
    const wrapper = f.container.querySelector('.mx-sdk-text-field')!;
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
    const text = f.owner.field('fld_title');
    await f.render(
        h(
            'div',
            null,
            h(LastModifiedByField, { binding: f.binding }),
            h(TextField, { binding: text })
        )
    );
    const inputs = f.container.querySelectorAll('input');
    assert.equal(inputs[0].disabled, true);
    assert.equal(inputs[1].disabled, false);
    await f.edit('  日本語 <b>native</b>  ', inputs[1]);
    assert.equal(text.getSnapshot().value, '  日本語 <b>native</b>  ');
    await act(async () => f.container.querySelectorAll('button')[1].click());
    assert.equal(text.getSnapshot().value, null);
    assert.deepEqual(f.binding.getSnapshot().value, person('Fixed modifier'));
    assert.equal(f.writes(), 0);
});

for (const layout of ['grid', 'list'] as const)
    it(`uses readonly Portal ${layout} detail props without inline authority or additional reads`, async (t) => {
        const f = await fixture(t, {}, person('Portal modifier'));
        const schema = f.loaded.payload.fieldIdsToSchemas.modifier;
        const detail = {
            fieldId: 'modifier',
            fieldName: 'Last modified by',
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
                                fields: { modifier: person('Portal modifier') },
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
            getScope: () => ({
                ownerId: 'last-modified-by-portal',
                revision: 0,
            }),
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
                    schema,
                    value: person('Portal modifier'),
                    input: {
                        portalExtensionAccessToken: 'portal_access_example',
                        portalFieldId: 'fld_children',
                        recordId: 'record_1',
                        recordFieldId: 'modifier',
                        selectedCustomViewId: 'view_example',
                    },
                    getScope: () => ({
                        ownerId: 'last-modified-by-portal',
                        revision: 0,
                    }),
                    isCurrent: () => current,
                    recovery: {
                        journal: new RecoveryJournal(),
                        scope: {
                            owner: 'last-modified-by-portal',
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
        assert.equal(state.fields[0].physicalKind, 'lastModifiedBy');
        assert.equal(state.fields[0].computed, true);
        assert.deepEqual(state.fields[0].value, person('Portal modifier'));
        assert.equal(state.fields[0].capability.type, 'readonly');
        const tree = () =>
            h(FieldRenderer, {
                host,
                renderers: { renderLastModifiedByField },
                fallback: () => null,
            });
        await f.render(tree());
        assert.equal(f.input().disabled, true);
        assert.equal(f.input().value, 'Portal modifier');
        assert.equal(f.container.querySelector('button')!.disabled, true);
        await f.edit('edited');
        assert.equal(f.input().value, 'Portal modifier');
        await f.render(null);
        await f.render(tree());
        assert.equal(f.input().value, 'Portal modifier');
        current = false;
        await f.render(tree());
        assert.equal(f.container.querySelector('input'), null);
        assert.equal(api.calls.length, 1);
        assert.equal(api.mutations, 0);
    });
