import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    AirtableForm,
    AirtableGrid,
    AirtableList,
    FieldRenderer,
    NumberField,
    MultipleCollaboratorsField,
    renderMultipleCollaboratorsField,
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
import { createFormRenderScope } from '../src/ui/formRenderScope.js';
import { createPortalRenderScope } from '../src/ui/portalRenderScope.js';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import type {
    FieldConfig,
    FieldRendererProps,
} from '../src/ui/rendererRegistry.js';
import type { AirtableCollaborator } from '../src/runtime/types.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

const native = [
    {
        id: 'usr_same',
        email: 'first@private.invalid',
        name: '  Ada\n雪 <b>literal</b>  ',
        profilePicUrl: 'https://private.invalid/avatar',
        metadata: { retained: true },
    },
    { id: 'usr_blank', email: 'blank@private.invalid', name: '' },
    { id: 'usr_same', email: 'second@private.invalid', name: 'Second name' },
    {
        id: 'usr_same',
        email: 'first@private.invalid',
        name: '  Ada\n雪 <b>literal</b>  ',
    },
];
const nativeText =
    '  Ada\n雪 <b>literal</b>  , , Second name,   Ada\n雪 <b>literal</b>  ';

async function fixture(
    t: TestContext,
    options: {
        value?: readonly AirtableCollaborator[] | null;
        config?: FieldConfig<'multipleCollaborators'>;
        edit?: boolean;
    } = {}
) {
    const window = new Window();
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
    if (options.edit)
        loaded.payload.formRecord = {
            type: 'edit',
            tableId: 'table_projects',
            recordId: 'record_collaborators',
            data: loaded.payload.formRecord.data,
        };
    loaded.payload.fieldIdsInForm.push('collaborators', 'number');
    const value = Object.hasOwn(options, 'value') ? options.value : native;
    if (value !== undefined)
        loaded.payload.formRecord.data.collaborators = value;
    loaded.payload.fieldIdsToSchemas.collaborators = {
        fieldType: 'multipleCollaborators',
        airtableField: {
            id: 'collaborators',
            name: 'Supplied collaborators',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'multipleCollaborators', options: { choices: [] } },
        },
        miniExtConfig: { hideFieldIfEmpty: false, ...options.config },
    };
    loaded.payload.fieldIdsToSchemas.number = {
        fieldType: 'number',
        airtableField: {
            id: 'number',
            name: 'Editable neighbor',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'number', options: { precision: 2 } },
        },
        miniExtConfig: {},
    };
    loaded.payload.formRecord.data.number = 2;
    let requests = 0;
    const scope = { current: true, visible: true };
    const owner = createFormFieldBindings({
        loaded,
        saveOptions: formSaveOptions(),
        client: createMiniExtensionsClient({
            apiOrigin: 'https://synthetic.invalid',
            fetch: async () => {
                requests++;
                throw Error('Collaborator presentation must not perform I/O');
            },
        }),
        getScope: () => ({ ownerId: 'multiple-collaborators', revision: 0 }),
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('collaborators');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'collaborators',
        isCurrent: () => scope.current,
        configurationRevision: () => 0,
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
    return {
        window,
        container,
        loaded,
        owner,
        binding,
        host,
        scope,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        props: () => {
            const state = host.getSnapshot();
            if (
                state.status !== 'ready' ||
                state.fields[0].physicalKind !== 'multipleCollaborators'
            )
                throw Error('Multiple Collaborators props expected');
            return state.fields[0];
        },
        tree: () =>
            h(FieldRenderer, {
                host,
                renderers: { renderMultipleCollaboratorsField },
                fallback: () => null,
            }),
        output: () => {
            const output = container.querySelector('output');
            assert.ok(output);
            return output;
        },
    };
}

function snapshotBinding(initial: FormFieldSnapshot) {
    let snapshot = initial;
    const listeners = new Set<(state: FormFieldSnapshot) => void>();
    const binding: FormFieldBinding = {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        setValue() {
            throw Error('Display cannot borrow a setter');
        },
        scalar: null,
        date: null,
        selection: null,
    };
    for (const name of [
        'setValue',
        'scalar',
        'date',
        'selection',
        'choiceCreation',
        'save',
    ])
        Object.defineProperty(binding, name, {
            get() {
                throw Error(`Display cannot read ${name}`);
            },
        });
    return {
        binding,
        listeners,
        update(next: FormFieldSnapshot) {
            snapshot = next;
            for (const listener of listeners) listener(snapshot);
        },
    };
}

for (const [label, value, expected] of [
    ['missing', undefined, ''],
    ['null', null, ''],
    ['empty array', [], ''],
    ['blank name', [{ id: '', email: '', name: '' }], ''],
    [
        'blank entries',
        [
            { id: 'a', email: 'a', name: '' },
            { id: 'a', email: 'a', name: '' },
        ],
        ', ',
    ],
    ['whitespace', [{ id: 'w', email: 'w', name: ' \n\t ' }], ' \n\t '],
    [
        'literal URL',
        [{ id: 'u', email: 'u', name: 'https://private.invalid/path' }],
        'https://private.invalid/path',
    ],
    [
        'literal markup',
        [
            {
                id: 'm',
                email: 'm',
                name: '<img src="https://private.invalid" onerror="alert(1)">',
            },
        ],
        '<img src="https://private.invalid" onerror="alert(1)">',
    ],
    ['native order, duplicates and metadata', native, nativeText],
] as const)
    it(`presents Multiple Collaborators ${label} without changing native data or exposing controls`, async (t) => {
        const f = await fixture(t, { value });
        const before = f.binding.getSnapshot();
        assert.equal(before.canEdit, true);
        assert.equal(f.props().capability.type, 'editable');
        assert.equal(f.props().physicalKind, 'multipleCollaborators');
        for (const node of [
            h(MultipleCollaboratorsField, { binding: f.binding }),
            f.tree(),
        ]) {
            await f.render(node);
            assert.equal(f.output().textContent, expected);
            assert.equal(
                f.container.querySelector(
                    'input,textarea,button,a,img,svg,canvas,video,iframe,object,embed,b'
                ),
                null
            );
            assert.equal(f.output().style.whiteSpace, 'pre-wrap');
            assert.equal(f.output().style.overflowWrap, 'anywhere');
            assert.deepEqual(f.binding.getSnapshot().value, before.value);
            assert.equal(f.binding.getSnapshot().dirty, before.dirty);
            assert.deepEqual(f.props().value, before.value);
            assert(!f.container.innerHTML.includes('first@private.invalid'));
            assert(!f.container.innerHTML.includes('usr_same'));
            await f.render(null);
        }
    });

it('rejects malformed arrays as a whole without partial display, coercion or owner changes', async (t) => {
    const f = await fixture(t);
    const sparse = new Array(2);
    sparse[0] = native[0];
    const poisonous = Object.defineProperty({ ...native[0] }, 'name', {
        get() {
            throw Error('Malformed member getter');
        },
    });
    for (const value of [
        'Ada',
        42,
        false,
        {},
        native[0],
        [null],
        [undefined],
        [native],
        sparse,
        [native[0], null],
        [native[0], { id: 'a', email: 'a' }],
        [{ id: 1, email: 'a', name: 'a' }],
        [{ id: 'a', email: null, name: 'a' }],
        [{ id: 'a', email: 'a', name: null }],
        [{ id: 'a', email: 'a', name: 'a', profilePicUrl: null }],
        [Object.assign(Object.create({ inherited: true }), native[0])],
        [poisonous],
    ]) {
        await f.render(
            renderMultipleCollaboratorsField({
                ...f.props(),
                value,
            } as unknown as FieldRendererProps<'multipleCollaborators'>)
        );
        assert.equal(f.output().textContent, 'Unavailable');
        assert.equal(f.output().getAttribute('aria-invalid'), 'true');
        const pure = snapshotBinding({
            ...f.binding.getSnapshot(),
            value,
        } as FormFieldSnapshot);
        await f.render(
            h(MultipleCollaboratorsField, { binding: pure.binding })
        );
        assert.equal(f.output().textContent, 'Unavailable');
        assert.equal(f.output().getAttribute('aria-invalid'), 'true');
        await f.render(null);
    }
    assert.deepEqual(f.binding.getSnapshot().value, native);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

it('uses a fixed mask before value, array length, member or identity reads on either config surface', async (t) => {
    const f = await fixture(t);
    for (const surface of ['displayConfig', 'writeConfig'] as const)
        for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen'])
            for (const guarded of [
                'value',
                'length',
                'member',
                'identity',
            ] as const) {
                const props = f.props();
                const other =
                    surface === 'displayConfig'
                        ? 'writeConfig'
                        : 'displayConfig';
                Object.assign(props, {
                    [surface]: { [flag]: true },
                    [other]: { [flag]: false },
                });
                let reads = 0;
                const poison = () => {
                    reads++;
                    throw Error(`Masked ${guarded} must not be read`);
                };
                if (guarded === 'value')
                    Object.defineProperty(props, 'value', { get: poison });
                else if (guarded === 'length')
                    props.value = new Proxy(native, { get: poison });
                else if (guarded === 'member')
                    props.value = Object.defineProperty([native[0]], '0', {
                        get: poison,
                    });
                else {
                    const member = {};
                    for (const key of ['id', 'email', 'name', 'profilePicUrl'])
                        Object.defineProperty(member, key, {
                            enumerable: true,
                            get: poison,
                        });
                    props.value = [
                        member,
                    ] as unknown as readonly AirtableCollaborator[];
                }
                await f.render(renderMultipleCollaboratorsField(props));
                assert.equal(reads, 0);
                assert.equal(f.output().textContent, '••••••••');
                assert.equal(f.output().getAttribute('aria-invalid'), 'false');
                assert(!f.container.innerHTML.includes('private.invalid'));
                assert(!f.container.innerHTML.includes('Second name'));
            }
    for (const value of [undefined, null, [], native.slice(0, 1), native]) {
        const props = { ...f.props(), value };
        Object.assign(props, { displayConfig: { obscurePassword: true } });
        await f.render(renderMultipleCollaboratorsField(props));
        assert.equal(f.output().textContent, '••••••••');
    }
});

it('masks bound snapshots before native access and resumes supplied names after unmasking', async (t) => {
    const f = await fixture(t);
    const initial = f.binding.getSnapshot();
    for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen']) {
        const snapshot = structuredClone(initial);
        Object.assign(snapshot.field!.schema.miniExtConfig!, { [flag]: true });
        Object.defineProperty(snapshot, 'value', {
            get() {
                throw Error('Masked binding value must not be read');
            },
        });
        const pure = snapshotBinding(snapshot);
        await f.render(
            h(MultipleCollaboratorsField, { key: flag, binding: pure.binding })
        );
        assert.equal(f.output().textContent, '••••••••');
        await act(async () => pure.update(initial));
        assert.equal(f.output().textContent, nativeText);
    }
});

it('ignores editable capabilities, choices, selection availability and all binding action getters', async (t) => {
    const f = await fixture(t);
    const props = f.props();
    assert.equal(props.capability.type, 'editable');
    for (const name of ['capability', 'linkedRecords', 'selectAvailability'])
        Object.defineProperty(props, name, {
            get() {
                throw Error(`Display cannot read ${name}`);
            },
        });
    Object.defineProperty(props.field.config.options!, 'choices', {
        get() {
            throw Error('Display must use supplied names, not choices');
        },
    });
    await f.render(
        renderMultipleCollaboratorsField(props, {
            className: 'collaborators-test',
        })
    );
    assert.equal(f.output().textContent, nativeText);
    assert.ok(f.container.querySelector('.collaborators-test'));
    const snapshot = structuredClone(f.binding.getSnapshot());
    Object.defineProperty(
        snapshot.field!.schema.airtableField.config.options!,
        'choices',
        {
            get() {
                throw Error('Bound display cannot read choices');
            },
        }
    );
    const pure = snapshotBinding(snapshot);
    await f.render(
        h(MultipleCollaboratorsField, {
            binding: pure.binding,
            className: 'bound-test',
        })
    );
    assert.equal(f.output().textContent, nativeText);
    assert.ok(f.container.querySelector('.bound-test'));
    assert.deepEqual(f.binding.getSnapshot().value, native);
});

it('omits hidden, blocked and retired bindings before reading fields or native values', async (t) => {
    const f = await fixture(t);
    const initial = f.binding.getSnapshot();
    const states = [
        {
            ...initial,
            visibility: { type: 'hidden' as const, diagnostics: [] },
        },
        {
            ...initial,
            visibility: {
                type: 'blocked' as const,
                code: 'invalid-native-value' as const,
                diagnostics: [],
            },
        },
        { ...initial, retired: true },
    ];
    for (const [index, snapshot] of states.entries()) {
        for (const property of ['field', 'value'])
            Object.defineProperty(snapshot, property, {
                get() {
                    throw Error(`Invisible ${property} must not be read`);
                },
            });
        await f.render(
            h(MultipleCollaboratorsField, {
                key: `hidden-${index}`,
                binding: snapshotBinding(snapshot).binding,
            })
        );
        assert.equal(f.container.textContent, '');
    }
    await f.render(f.tree());
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    assert.equal(f.container.querySelector('output'), null);
    await act(async () => f.owner.destroy());
    await f.render(h(MultipleCollaboratorsField, { binding: f.binding }));
    assert.equal(f.container.querySelector('output'), null);
});

it('preserves custom rendering precedence and refuses mismatched physical metadata', async (t) => {
    const f = await fixture(t);
    await f.render(
        h(MultipleCollaboratorsField, { binding: f.owner.field('number') })
    );
    assert.match(f.container.textContent!, /supports Multiple Collaborators/i);
    const initial = f.binding.getSnapshot();
    const retired = snapshotBinding({ ...initial, retired: true });
    await f.render(
        h(MultipleCollaboratorsField, {
            binding: retired.binding,
            render: ({ snapshot, binding }) =>
                h(
                    'b',
                    null,
                    `${snapshot.retired}:${binding === retired.binding}`
                ),
        })
    );
    assert.equal(f.container.textContent, 'true:true');
    const wrong = structuredClone(initial);
    Object.assign(wrong.field!.schema.airtableField, {
        config: { type: 'singleCollaborator', options: { choices: [] } },
    });
    await f.render(
        h(MultipleCollaboratorsField, {
            binding: snapshotBinding(wrong).binding,
        })
    );
    assert.match(f.container.textContent!, /supports Multiple Collaborators/i);
    assert.equal(f.container.querySelector('output'), null);
});

it('tracks accepted updates, replacements, unmounts and retirement without retaining stale subscriptions', async (t) => {
    const f = await fixture(t);
    const initial = f.binding.getSnapshot();
    const first = snapshotBinding(initial);
    const secondValue = [{ id: 'b', email: 'b', name: 'Replacement' }];
    const second = snapshotBinding({ ...initial, value: secondValue });
    await f.render(h(MultipleCollaboratorsField, { binding: first.binding }));
    assert.equal(first.listeners.size, 1);
    await act(async () =>
        first.update({ ...initial, value: [...native].reverse() })
    );
    assert.equal(
        f.output().textContent,
        '  Ada\n雪 <b>literal</b>  , Second name, ,   Ada\n雪 <b>literal</b>  '
    );
    await f.render(h(MultipleCollaboratorsField, { binding: second.binding }));
    assert.equal(f.output().textContent, 'Replacement');
    assert.equal(first.listeners.size, 0);
    assert.equal(second.listeners.size, 1);
    await act(async () => first.update({ ...initial, value: [] }));
    assert.equal(f.output().textContent, 'Replacement');
    await f.render(null);
    assert.equal(second.listeners.size, 0);
    await f.render(h(MultipleCollaboratorsField, { binding: second.binding }));
    assert.equal(f.output().textContent, 'Replacement');
    await act(async () =>
        second.update({ ...initial, retired: true, value: secondValue })
    );
    assert.equal(f.container.querySelector('output'), null);
    await f.render(h(MultipleCollaboratorsField, { binding: f.binding }));
    assert.equal(second.listeners.size, 0);
    assert.equal(f.output().textContent, nativeText);
    await act(async () => f.owner.destroy());
    assert.equal(f.container.querySelector('output'), null);
});

it('associates unique labels and escaped status feedback with hidden-title and empty-error support', async (t) => {
    const f = await fixture(t);
    const props = {
        ...f.props(),
        title: ' ',
        pending: true,
        error: '<b>error</b>',
    };
    await f.render(
        h(
            'div',
            null,
            renderMultipleCollaboratorsField(props),
            renderMultipleCollaboratorsField(props)
        )
    );
    const outputs = f.container.querySelectorAll('output');
    assert.notEqual(outputs[0].id, outputs[1].id);
    for (const output of outputs) {
        assert.equal(
            f.container.querySelector(`label[for="${output.id}"]`)?.textContent,
            'Supplied collaborators'
        );
        assert.equal(output.getAttribute('aria-busy'), 'true');
        assert.equal(output.getAttribute('aria-invalid'), 'true');
        assert.equal(
            f.container.querySelector(
                `[id="${output.getAttribute('aria-describedby')}"]`
            )?.textContent,
            '<b>error</b>'
        );
    }
    assert.equal(f.container.querySelector('b'), null);
    const validation = [
        {
            fieldId: 'collaborators',
            fieldTitle: 'Collaborators',
            errorMessage: 'Validation',
        },
    ];
    await f.render(
        renderMultipleCollaboratorsField({
            ...props,
            displayConfig: { showTitle: false },
            error: '',
            validation,
        })
    );
    assert.equal(f.container.querySelector('label'), null);
    assert.equal(
        f.output().getAttribute('aria-label'),
        'Supplied collaborators'
    );
    assert.equal(f.output().hasAttribute('aria-describedby'), false);
    assert.equal(f.container.querySelector('[role=status]')?.textContent, '');
    await f.render(
        renderMultipleCollaboratorsField({ ...props, error: null, validation })
    );
    assert.equal(
        f.container.querySelector('[role=status]')?.textContent,
        'Validation'
    );
    assert.equal(
        f.container.querySelector('[role=status]')?.getAttribute('aria-live'),
        'polite'
    );
    const maskedProps = { ...props, error: 'Owner status' };
    Object.assign(maskedProps, { displayConfig: { obscurePassword: true } });
    await f.render(renderMultipleCollaboratorsField(maskedProps));
    assert.equal(f.output().textContent, '••••••••');
    assert.equal(
        f.container.querySelector('[role=status]')?.textContent,
        'Owner status'
    );
});

it('isolates pointer, mouse and keyboard row events without cancelling native defaults or editing neighbors', async (t) => {
    const f = await fixture(t);
    let rows = 0;
    await f.render(
        h(
            'div',
            {
                onClick: () => rows++,
                onDoubleClick: () => rows++,
                onAuxClick: () => rows++,
                onPointerDown: () => rows++,
                onKeyDown: () => rows++,
                onKeyUp: () => rows++,
            },
            h(MultipleCollaboratorsField, { binding: f.binding }),
            h(NumberField, { binding: f.owner.field('number') })
        )
    );
    await act(async () => {
        for (const type of ['click', 'dblclick', 'auxclick', 'pointerdown']) {
            const event = new f.window.Event(type, {
                bubbles: true,
                cancelable: true,
            });
            f.output().dispatchEvent(event);
            assert.equal(event.defaultPrevented, false);
        }
        for (const type of ['keydown', 'keyup'])
            for (const key of ['Enter', ' ', 'ArrowDown']) {
                const event = new f.window.KeyboardEvent(type, {
                    key,
                    bubbles: true,
                    cancelable: true,
                });
                f.output().dispatchEvent(event);
                assert.equal(event.defaultPrevented, false);
            }
    });
    assert.equal(rows, 0);
    const input = f.container.querySelector('input')!;
    assert.equal(input.disabled, false);
    await act(async () => {
        Object.getOwnPropertyDescriptor(
            f.window.HTMLInputElement.prototype,
            'value'
        )!.set!.call(input, '3.125');
        input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    });
    assert.equal(f.owner.field('number').getSnapshot().value, 3.125);
    assert.deepEqual(f.binding.getSnapshot().value, native);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

it('renders the physical slot through actual Form composition without Save or native conversion', async (t) => {
    const f = await fixture(t);
    const scope = createFormRenderScope({
        fields: f.owner,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => scope.destroy());
    await f.render(
        h(AirtableForm, {
            scope,
            renderers: { renderMultipleCollaboratorsField },
            children: (state) =>
                state.fields
                    .filter((field) => field.fieldId === 'collaborators')
                    .map((field) => field.node),
        })
    );
    assert.equal(f.output().textContent, nativeText);
    assert.equal(f.container.querySelector('input,button,a,img'), null);
    assert.deepEqual(f.binding.getSnapshot().value, native);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

for (const layout of ['grid', 'list'] as const)
    it(`renders accepted Portal ${layout} details without writes, identity lookup or added requests`, async (t) => {
        const f = await fixture(t);
        const schema = f.loaded.payload.fieldIdsToSchemas.collaborators;
        const detail = {
            fieldId: 'collaborators',
            fieldName: 'Supplied collaborators',
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
                                fields: { collaborators: native },
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
                ownerId: 'multiple-collaborators-portal',
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
        const state = host.getSnapshot();
        assert.equal(state.status, 'ready');
        if (state.status !== 'ready')
            throw Error('Expected Portal Collaborators host');
        assert.equal(state.fields[0].capability.type, 'readonly');
        assert.deepEqual(state.fields[0].value, native);
        const tree = () =>
            h(FieldRenderer, {
                host,
                renderers: { renderMultipleCollaboratorsField },
                fallback: () => null,
            });
        await f.render(tree());
        assert.equal(f.output().textContent, nativeText);
        const scope = createPortalRenderScope({
            owner,
            client: api.client,
            isCurrent: () => current,
            configurationRevision: () => 0,
        });
        t.after(() => scope.destroy());
        const Component = layout === 'grid' ? AirtableGrid : AirtableList;
        await f.render(
            h(Component, {
                scope,
                renderers: { renderMultipleCollaboratorsField },
                children: (snapshot) =>
                    snapshot.rows.flatMap((row) =>
                        row.cells.map((cell) => cell.node)
                    ),
            })
        );
        assert.equal(f.output().textContent, nativeText);
        assert.equal(
            f.container.querySelector('input,button,a,img,canvas,video'),
            null
        );
        const latest = host.getSnapshot();
        assert.equal(latest.status, 'ready');
        if (latest.status === 'ready')
            assert.deepEqual(latest.fields[0].value, native);
        current = false;
        await f.render(tree());
        assert.equal(f.container.querySelector('output'), null);
    });

for (const [label, value] of [
    ['missing', undefined],
    ['null', null],
    ['empty array', []],
    ['populated array', native],
] as const)
    it(`preserves unsupported hide-empty policy for ${label}`, async (t) => {
        const f = await fixture(t, {
            value,
            config: { hideFieldIfEmpty: true },
            edit: true,
        });
        const visibility = f.binding.getSnapshot().visibility;
        assert.equal(visibility.type, 'blocked');
        if (visibility.type === 'blocked')
            assert.equal(visibility.code, 'unsupported-hide-empty');
        for (const node of [
            h(MultipleCollaboratorsField, { binding: f.binding }),
            f.tree(),
        ]) {
            await f.render(node);
            assert.equal(f.container.querySelector('output'), null);
            assert.deepEqual(f.binding.getSnapshot().value, value);
        }
    });
