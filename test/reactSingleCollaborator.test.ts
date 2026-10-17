import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    AirtableForm,
    AirtableGrid,
    AirtableList,
    SingleCollaboratorField,
    FieldRenderer,
    NumberField,
    renderSingleCollaboratorField,
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

const person = (name: string): AirtableCollaborator => ({
    id: 'usr_private',
    email: 'PRIVATE_EMAIL@example.invalid',
    name,
    profilePicUrl: 'https://private.invalid/PRIVATE_AVATAR',
});
const native = person('  Supplied\n雪 <b>literal</b>  ');

async function fixture(
    t: TestContext,
    options: {
        value?: AirtableCollaborator | null;
        config?: FieldConfig<'singleCollaborator'>;
        edit?: boolean;
        choices?: AirtableCollaborator[];
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
            recordId: 'record_singleCollaborator',
            data: loaded.payload.formRecord.data,
        };
    loaded.payload.fieldIdsInForm.push('singleCollaborator', 'number');
    const value = Object.hasOwn(options, 'value') ? options.value : native;
    if (value !== undefined)
        loaded.payload.formRecord.data.singleCollaborator = value;
    loaded.payload.fieldIdsToSchemas.singleCollaborator = {
        fieldType: 'singleCollaborator',
        airtableField: {
            id: 'singleCollaborator',
            name: 'Supplied collaborator',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'singleCollaborator',
                options: { choices: options.choices ?? [] },
            },
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
                throw Error(
                    'Single Collaborator presentation must not perform I/O'
                );
            },
        }),
        getScope: () => ({ ownerId: 'singleCollaborator', revision: 0 }),
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('singleCollaborator');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'singleCollaborator',
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
                state.fields[0].physicalKind !== 'singleCollaborator'
            )
                throw Error('SingleCollaborator props expected');
            return state.fields[0];
        },
        tree: () =>
            h(FieldRenderer, {
                host,
                renderers: { renderSingleCollaboratorField },
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
            throw Error('Single Collaborator display cannot borrow a setter');
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
                throw Error(`Single Collaborator display cannot read ${name}`);
            },
        });
    return {
        binding,
        update(next: FormFieldSnapshot) {
            snapshot = next;
            for (const listener of listeners) listener(snapshot);
        },
    };
}

for (const [index, value] of [
    undefined,
    null,
    person(''),
    person('  \n\t  '),
    person('Unlisted person'),
    person('https://private.invalid/name'),
    person('<img src="https://private.invalid" onerror="alert(1)">'),
    {
        id: 'usr_without_avatar',
        email: 'other@example.invalid',
        name: 'No avatar',
    },
    { id: '', email: '', name: 'Empty identifiers remain admitted strings' },
    {
        ...person('Additional native metadata'),
        extra: { retained: 'PRIVATE_EXTRA' },
    },
    native,
].entries())
    it(`presents supplied Single Collaborator name case ${index} without changing native data or exposing controls`, async (t) => {
        const f = await fixture(t, { value });
        const before = f.binding.getSnapshot();
        assert.equal(before.canEdit, true);
        assert.equal(f.props().capability.type, 'editable');
        assert.equal(f.props().physicalKind, 'singleCollaborator');
        for (const node of [
            h(SingleCollaboratorField, { binding: f.binding }),
            f.tree(),
        ]) {
            await f.render(node);
            assert.equal(f.output().textContent, value?.name ?? '');
            assert.equal(
                f.container.querySelector(
                    'input,textarea,button,select,option,[role=combobox],a,img,svg,canvas,video,iframe,object,embed,b'
                ),
                null
            );
            assert.equal(f.output().style.whiteSpace, 'pre-wrap');
            assert.equal(f.output().style.overflowWrap, 'anywhere');
            assert.deepEqual(f.binding.getSnapshot().value, before.value);
            assert.equal(f.binding.getSnapshot().dirty, before.dirty);
            assert.deepEqual(f.props().value, before.value);
            for (const privateText of [
                'usr_private',
                'PRIVATE_EMAIL',
                'PRIVATE_AVATAR',
                'PRIVATE_EXTRA',
            ])
                assert(!f.container.innerHTML.includes(privateText));
            await f.render(null);
        }
    });

it('rejects malformed direct native values without coercion or modifying the owner', async (t) => {
    const f = await fixture(t);
    for (const value of [
        'Supplied person',
        42,
        false,
        [],
        [native],
        {},
        { name: 'Missing identity fields' },
        { id: native.id, email: native.email },
        { ...native, id: 42 },
        { ...native, email: null },
        { ...native, name: null },
        { ...native, name: 42 },
        { ...native, profilePicUrl: null },
        { ...native, profilePicUrl: false },
        Object.assign(Object.create(null), native),
        Object.defineProperty({ ...native }, 'name', {
            enumerable: true,
            get() {
                throw Error('Malformed native getter');
            },
        }),
    ]) {
        await f.render(
            renderSingleCollaboratorField({
                ...f.props(),
                value,
            } as unknown as FieldRendererProps<'singleCollaborator'>)
        );
        assert.equal(f.output().textContent, 'Unavailable');
        assert.equal(f.output().getAttribute('aria-invalid'), 'true');
    }
    assert.deepEqual(f.binding.getSnapshot().value, native);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

it('does not inspect the native value, name or identity properties before masking either configuration surface', async (t) => {
    const f = await fixture(t);
    for (const surface of ['displayConfig', 'writeConfig'] as const)
        for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen'])
            for (const guarded of ['value', 'nativeProperties'] as const) {
                const props = f.props();
                Object.assign(props, { [surface]: { [flag]: true } });
                if (guarded === 'value')
                    Object.defineProperty(props, 'value', {
                        get() {
                            throw Error('Masked native value must not be read');
                        },
                    });
                else {
                    const value = {} as AirtableCollaborator;
                    for (const key of ['name', 'id', 'email', 'profilePicUrl'])
                        Object.defineProperty(value, key, {
                            enumerable: true,
                            get() {
                                throw Error(
                                    'Masked SingleCollaborator must not be inspected'
                                );
                            },
                        });
                    props.value = value;
                }
                await f.render(renderSingleCollaboratorField(props));
                assert.equal(f.output().textContent, '••••••••');
                assert(!f.container.innerHTML.includes(native.name));
                assert.equal(f.output().getAttribute('aria-invalid'), 'false');
            }
});

it('masks bound snapshots before reading their native values and resumes supplied names when unmasked', async (t) => {
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
        await f.render(h(SingleCollaboratorField, { binding: pure.binding }));
        assert.equal(f.output().textContent, '••••••••');
        await act(async () => pure.update(initial));
        assert.equal(f.output().textContent, native.name);
    }
});

it('ignores even editable capabilities and all borrowed action getters', async (t) => {
    const f = await fixture(t);
    const props = f.props();
    assert.equal(props.capability.type, 'editable');
    for (const name of ['capability', 'linkedRecords', 'selectAvailability'])
        Object.defineProperty(props, name, {
            get() {
                throw Error(`Single Collaborator display cannot read ${name}`);
            },
        });
    await f.render(
        renderSingleCollaboratorField(props, {
            className: 'singleCollaborator-test',
        })
    );
    assert.equal(f.output().textContent, native.name);
    assert.ok(f.container.querySelector('.singleCollaborator-test'));
    const snapshot = f.binding.getSnapshot();
    for (const name of [
        'selection',
        'scalar',
        'date',
        'choiceCreation',
        'selectAvailability',
    ])
        Object.defineProperty(snapshot, name, {
            get() {
                throw Error(`Supplied name cannot use derived ${name}`);
            },
        });
    const pure = snapshotBinding(snapshot);
    await f.render(h(SingleCollaboratorField, { binding: pure.binding }));
    assert.equal(f.output().textContent, native.name);
    assert.deepEqual(f.binding.getSnapshot().value, native);
});

it('omits hidden, blocked and retired bindings before inspecting native values', async (t) => {
    const f = await fixture(t);
    const initial = f.binding.getSnapshot();
    for (const snapshot of [
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
    ]) {
        Object.defineProperty(snapshot, 'value', {
            get() {
                throw Error('Invisible native value must not be inspected');
            },
        });
        await f.render(
            h(SingleCollaboratorField, {
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
    await f.render(h(SingleCollaboratorField, { binding: f.binding }));
    assert.equal(f.container.querySelector('output'), null);
});

it('keeps custom rendering first and refuses the wrong physical field kind', async (t) => {
    const f = await fixture(t);
    await f.render(
        h(SingleCollaboratorField, { binding: f.owner.field('number') })
    );
    assert.match(f.container.textContent!, /supports.*Collaborator/);
    const initial = f.binding.getSnapshot();
    const retired = snapshotBinding({ ...initial, retired: true });
    await f.render(
        h(SingleCollaboratorField, {
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
    const wrongMetadata = structuredClone(initial);
    Object.assign(wrongMetadata.field!.schema.airtableField, {
        config: { type: 'singleLineText', options: null },
    });
    await f.render(
        h(SingleCollaboratorField, {
            binding: snapshotBinding(wrongMetadata).binding,
        })
    );
    assert.match(f.container.textContent!, /supports.*Collaborator/);
    assert.equal(f.container.querySelector('output'), null);
});

it('reflects owner updates and replacement subscriptions without local drafts or action access', async (t) => {
    const f = await fixture(t);
    const initial = f.binding.getSnapshot();
    const pure = snapshotBinding(initial);
    const replacement = {
        ...person('Changed supplied name'),
        id: 'usr_replacement',
    };
    await f.render(h(SingleCollaboratorField, { binding: pure.binding }));
    await act(async () => pure.update({ ...initial, value: replacement }));
    assert.equal(f.output().textContent, replacement.name);
    assert.deepEqual(pure.binding.getSnapshot().value, replacement);
    await f.render(h(SingleCollaboratorField, { binding: f.binding }));
    assert.equal(f.output().textContent, native.name);
    await act(async () => pure.update({ ...initial, value: person('stale') }));
    assert.equal(f.output().textContent, native.name);
    await f.render(h(SingleCollaboratorField, { binding: pure.binding }));
    assert.equal(f.output().textContent, 'stale');
    await f.render(null);
    await f.render(h(SingleCollaboratorField, { binding: f.binding }));
    assert.equal(f.output().textContent, native.name);
    assert.deepEqual(f.binding.getSnapshot().value, native);
});

it('never replaces a native name with metadata choices or exposes private identity fallback', async (t) => {
    const f = await fixture(t, {
        choices: [
            {
                id: native.id,
                email: 'choice@example.invalid',
                name: 'Metadata name',
            },
        ],
    });
    const initial = f.binding.getSnapshot();
    const pure = snapshotBinding(initial);
    await f.render(h(SingleCollaboratorField, { binding: pure.binding }));
    for (const choices of [
        [{ id: native.id, email: native.email, name: 'Renamed metadata' }],
        [{ id: native.id, email: native.email, name: null }],
        [
            {
                id: 'different_identity',
                email: native.email,
                name: 'Email match',
            },
        ],
        [],
    ]) {
        const snapshot = structuredClone(initial);
        const config = snapshot.field!.schema.airtableField.config;
        if (config.type !== 'singleCollaborator')
            throw Error('Expected collaborator metadata');
        // Runtime host validation admits null metadata names even though the
        // generated choice type requires a string. Neither supplies our label.
        Object.assign(config.options, { choices });
        await act(async () => pure.update(snapshot));
        assert.equal(f.output().textContent, native.name);
        assert.deepEqual(pure.binding.getSnapshot().value, native);
    }
    const props = f.props();
    Object.defineProperty(props.field.config.options, 'choices', {
        get() {
            throw Error('Supplied names do not require metadata choices');
        },
    });
    await f.render(renderSingleCollaboratorField(props));
    assert.equal(f.output().textContent, native.name);
    await f.render(
        renderSingleCollaboratorField({ ...props, value: person('') })
    );
    assert.equal(f.output().textContent, '');
    for (const privateText of [native.id, native.email, native.profilePicUrl!])
        assert(!f.container.innerHTML.includes(privateText));
});

it('keeps masking active when the other configuration surface explicitly disables the same flag', async (t) => {
    const f = await fixture(t);
    for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen'])
        for (const surface of ['displayConfig', 'writeConfig'] as const) {
            const other =
                surface === 'displayConfig' ? 'writeConfig' : 'displayConfig';
            const props = f.props();
            Object.assign(props, {
                [surface]: { [flag]: true },
                [other]: { [flag]: false },
            });
            Object.defineProperty(props, 'value', {
                get() {
                    throw Error('One active mask protects both configurations');
                },
            });
            await f.render(renderSingleCollaboratorField(props));
            assert.equal(f.output().textContent, '••••••••');
        }
});

it('associates unique labels and plain status feedback while preserving hidden titles and empty errors', async (t) => {
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
            renderSingleCollaboratorField(props),
            renderSingleCollaboratorField(props)
        )
    );
    const outputs = f.container.querySelectorAll('output');
    assert.notEqual(outputs[0].id, outputs[1].id);
    for (const output of outputs) {
        assert.equal(
            f.container.querySelector(`label[for="${output.id}"]`)?.textContent,
            'Supplied collaborator'
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
            fieldId: 'singleCollaborator',
            fieldTitle: 'SingleCollaborator',
            errorMessage: 'Validation',
        },
    ];
    await f.render(
        renderSingleCollaboratorField({
            ...props,
            displayConfig: { showTitle: false },
            error: '',
            validation,
        })
    );
    assert.equal(f.container.querySelector('label'), null);
    assert.equal(
        f.output().getAttribute('aria-label'),
        'Supplied collaborator'
    );
    assert.equal(f.output().hasAttribute('aria-describedby'), false);
    assert.equal(f.container.querySelector('[role=status]')?.textContent, '');
    await f.render(
        renderSingleCollaboratorField({ ...props, error: null, validation })
    );
    const feedback = f.container.querySelector('[role=status]');
    assert.equal(feedback?.textContent, 'Validation');
    assert.equal(feedback?.getAttribute('aria-live'), 'polite');
    const maskedProps = { ...props, error: 'Owner status' };
    Object.assign(maskedProps, { displayConfig: { obscurePassword: true } });
    await f.render(renderSingleCollaboratorField(maskedProps));
    assert.equal(f.output().textContent, '••••••••');
    assert.equal(
        f.container.querySelector('[role=status]')?.textContent,
        'Owner status'
    );
});

it('contains mouse, pointer and keyboard row events while preserving an editable neighbor', async (t) => {
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
            h(SingleCollaboratorField, { binding: f.binding }),
            h(NumberField, { binding: f.owner.field('number') })
        )
    );
    await act(async () => {
        for (const type of ['click', 'dblclick', 'auxclick', 'pointerdown'])
            f.output().dispatchEvent(
                new f.window.Event(type, { bubbles: true })
            );
        for (const type of ['keydown', 'keyup'])
            for (const key of ['Enter', ' ', 'ArrowDown'])
                f.output().dispatchEvent(
                    new f.window.KeyboardEvent(type, { key, bubbles: true })
                );
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

it('renders the existing SingleCollaborator slot through actual Form composition without Save or native conversion', async (t) => {
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
            renderers: { renderSingleCollaboratorField },
            children: (state) =>
                state.fields
                    .filter((field) => field.fieldId === 'singleCollaborator')
                    .map((field) => field.node),
        })
    );
    assert.equal(f.output().textContent, native.name);
    assert.deepEqual(f.binding.getSnapshot().value, native);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

for (const layout of ['grid', 'list'] as const)
    it(`renders accepted Portal ${layout} SingleCollaborator details without write controls or added requests`, async (t) => {
        const f = await fixture(t);
        const schema = f.loaded.payload.fieldIdsToSchemas.singleCollaborator;
        const detail = {
            fieldId: 'singleCollaborator',
            fieldName: 'Supplied collaborator',
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
                                fields: { singleCollaborator: native },
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
                ownerId: 'singleCollaborator-portal',
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
            throw Error('Expected Portal SingleCollaborator host');
        assert.equal(state.fields[0].capability.type, 'readonly');
        assert.deepEqual(state.fields[0].value, native);
        const tree = () =>
            h(FieldRenderer, {
                host,
                renderers: { renderSingleCollaboratorField },
                fallback: () => null,
            });
        await f.render(tree());
        assert.equal(f.output().textContent, native.name);
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
                renderers: { renderSingleCollaboratorField },
                children: (snapshot) =>
                    snapshot.rows.flatMap((row) =>
                        row.cells.map((cell) => cell.node)
                    ),
            })
        );
        assert.equal(f.output().textContent, native.name);
        assert.equal(
            f.container.querySelector('input,button,a,img,canvas,video'),
            null
        );
        current = false;
        await f.render(tree());
        assert.equal(f.container.querySelector('output'), null);
    });

it('preserves visible empty create-Form presentation when hide-empty is configured', async (t) => {
    const f = await fixture(t, {
        value: null,
        config: { hideFieldIfEmpty: true },
    });
    assert.equal(f.binding.getSnapshot().visibility.type, 'visible');
    for (const node of [
        h(SingleCollaboratorField, { binding: f.binding }),
        f.tree(),
    ]) {
        await f.render(node);
        assert.equal(f.output().textContent, '');
        assert.equal(f.binding.getSnapshot().value, null);
    }
});

for (const value of [undefined, null, person(''), native])
    it(`preserves existing edit-Form hide-empty refusal for ${JSON.stringify(value)}`, async (t) => {
        const f = await fixture(t, {
            value,
            config: { hideFieldIfEmpty: true },
            edit: true,
        });
        assert.deepEqual(f.binding.getSnapshot().visibility, {
            type: 'blocked',
            code: 'unsupported-hide-empty',
            diagnostics: [],
        });
        for (const node of [
            h(SingleCollaboratorField, { binding: f.binding }),
            f.tree(),
        ]) {
            await f.render(node);
            assert.equal(f.container.querySelector('output'), null);
            assert.deepEqual(f.binding.getSnapshot().value, value);
        }
    });
