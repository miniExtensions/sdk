import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    MultipleSelectField,
    SelectField,
    FieldRenderer,
    renderMultipleSelectsField,
} from '../src/react/index.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import {
    createFormFieldRendererHost,
    createPortalCellRendererHost,
    createPortalDetailRendererHost,
} from '../src/ui/rendererHosts.js';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import { createPortalCellBinding } from '../src/portals/cell.js';
import type {
    FieldConfig,
    FieldRendererProps,
} from '../src/ui/rendererRegistry.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

async function fixture(
    t: TestContext,
    config: FieldConfig<'multipleSelects'> = {},
    initial: readonly string[] | null = ['Red']
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
    loaded.payload.fieldIdsInForm = ['multi'];
    loaded.payload.formRecord.data.multi = initial;
    loaded.payload.fieldIdsToSchemas.multi = {
        fieldType: 'multipleSelects',
        airtableField: {
            id: 'multi',
            name: 'Colors',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'multipleSelects',
                options: {
                    choices: [
                        { id: 'red', name: 'Red' },
                        { id: 'blue', name: 'Blue' },
                    ],
                },
            },
        },
        miniExtConfig: config,
    };
    let requests = 0;
    const scope = { current: true, writable: true, visible: true, revision: 0 };
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://synthetic.invalid',
        fetch: async () => {
            requests++;
            throw Error('No requests expected');
        },
    });
    const owner = createFormFieldBindings({
        loaded,
        client,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'multiple-select', revision: 0 }),
        canWrite: () => scope.writable,
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('multi');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'multi',
        isCurrent: () => scope.current,
        configurationRevision: () => scope.revision,
    });
    const props = () => {
        const snapshot = host.getSnapshot();
        if (
            snapshot.status !== 'ready' ||
            snapshot.fields[0].physicalKind !== 'multipleSelects'
        )
            throw Error('Multiple Select expected');
        return snapshot.fields[0];
    };
    const render = async (node: ReactNode) => {
        await act(async () => root.render(h(StrictMode, null, node)));
    };
    const button = (label: string) => {
        const node = [...container.querySelectorAll('button')].find(
            (node) =>
                node.getAttribute('aria-label') === label ||
                node.textContent === label
        );
        assert.ok(node, label);
        return node;
    };
    const checkbox = (label: string) => {
        const node = [...container.querySelectorAll('label')]
            .find((node) => node.textContent === label)
            ?.querySelector('input');
        assert.ok(node, label);
        return node;
    };
    t.after(async () => {
        await act(async () => root.unmount());
        host.dispose();
        owner.destroy();
        keys.forEach((key, index) => {
            const original = originals[index];
            if (original) Object.defineProperty(globalThis, key, original);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
        assert.equal(requests, 0);
    });
    return {
        window,
        container,
        loaded,
        client,
        owner,
        binding,
        host,
        scope,
        props,
        render,
        button,
        checkbox,
    };
}

it('preserves native choice-name order through binding edits, slot remounts and explicit clear; generic SelectField stays compatible', async (t) => {
    const f = await fixture(t, {}, null);
    await f.render(h(MultipleSelectField, { binding: f.binding }));
    assert.equal(f.binding.getSnapshot().value, null);
    assert.equal(f.binding.getSnapshot().dirty, false);
    await act(async () => f.checkbox('Blue').click());
    await act(async () => f.checkbox('Red').click());
    assert.deepEqual(f.binding.getSnapshot().value, ['Blue', 'Red']);
    await f.render(null);
    await f.render(
        h(FieldRenderer, {
            host: f.host,
            renderers: { renderMultipleSelectsField },
        })
    );
    assert.deepEqual(
        [...f.container.querySelectorAll('li span')].map(
            (node) => node.textContent
        ),
        ['Blue', 'Red']
    );
    await act(async () => f.button('Remove Blue').click());
    assert.deepEqual(f.binding.getSnapshot().value, ['Red']);
    await act(async () => f.button('Clear Colors').click());
    assert.deepEqual(f.binding.getSnapshot().value, []);
    await f.render(h(SelectField, { binding: f.binding }));
    assert.equal(f.container.querySelector('select')?.multiple, true);
    await f.render(
        h(MultipleSelectField, {
            binding: f.binding,
            render: ({ snapshot, binding }) =>
                h('output', null, `${snapshot.value}:${binding === f.binding}`),
        })
    );
    assert.equal(f.container.querySelector('output')?.textContent, ':true');
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    await f.render(h(MultipleSelectField, { binding: f.binding }));
    assert.equal(f.container.textContent, '');
});

it('max limits and filtered-out selections block only additions, preserve retained names and aliases, and permit removal', async (t) => {
    const f = await fixture(
        t,
        {
            maxNumberOfSelections: 1,
            singleOrMultiSelectLimitSelectionOptions: ['blue'],
            enableConditionalOptions: true,
            conditionsForOptions: [
                {
                    id: 'alias',
                    config: {
                        optionForConditions: 'blue',
                        name: '<b>Azure</b>',
                        conditionsForOption: {
                            logicalOperator: 'and',
                            conditions: [],
                        },
                    },
                },
            ],
        },
        ['Legacy', 'Red']
    );
    await f.render(h(MultipleSelectField, { binding: f.binding }));
    assert.equal(f.checkbox('<b>Azure</b>').disabled, true);
    assert.equal(f.container.querySelector('b'), null);
    assert.ok(f.container.textContent?.includes('Legacy'));
    await act(async () => f.button('Remove Red').click());
    await act(async () => f.button('Remove Legacy').click());
    assert.equal(f.checkbox('<b>Azure</b>').disabled, false);
    await act(async () => f.checkbox('<b>Azure</b>').click());
    assert.deepEqual(f.binding.getSnapshot().value, ['Blue']);
    assert.equal(f.checkbox('<b>Azure</b>').disabled, false);
    await act(async () => f.checkbox('<b>Azure</b>').click());
    assert.deepEqual(f.binding.getSnapshot().value, []);
});

it('blocked availability leaves removal and clear available without adding new choices', async (t) => {
    const f = await fixture(t, {}, ['Legacy', 'Red']);
    const props = f.props();
    const blocked = {
        ...props,
        selectAvailability: { status: 'blocked', code: 'unavailable-record' },
    } as const;
    await f.render(renderMultipleSelectsField(blocked));
    assert.equal(f.checkbox('Blue').disabled, true);
    assert.equal(f.button('Remove Legacy').disabled, false);
    await act(async () => f.button('Remove Legacy').click());
    assert.deepEqual(f.binding.getSnapshot().value, ['Red']);
    await f.render(
        renderMultipleSelectsField({
            ...f.props(),
            selectAvailability: blocked.selectAvailability,
        })
    );
    await act(async () => f.button('Clear Colors').click());
    assert.deepEqual(f.binding.getSnapshot().value, []);
});

it('missing selection capability, readonly policies, pending and disabled owners never fall back to setValue', async (t) => {
    const f = await fixture(t, {}, ['Legacy', 'Red']);
    const props = f.props();
    assert.equal(props.capability.type, 'editable');
    if (props.capability.type !== 'editable' || !props.capability.selection)
        throw Error('Selection expected');
    const selection = props.capability.selection;
    const variants: FieldRendererProps<'multipleSelects'>[] = [
        { ...props, capability: { type: 'readonly' } },
        {
            ...props,
            capability: {
                type: 'editable',
                setValue: () => {
                    throw Error('No fallback');
                },
            },
        },
        { ...props, pending: true },
        { ...props, computed: true },
        { ...props, writeConfig: { readOnly: true } },
        { ...props, displayConfig: { readOnly: true } },
        {
            ...props,
            capability: {
                ...props.capability,
                selection: {
                    ...selection,
                    state: { ...selection.state, disabled: true },
                },
            },
        },
        {
            ...props,
            capability: {
                ...props.capability,
                selection: {
                    ...selection,
                    state: { ...selection.state, readOnly: true },
                },
            },
        },
    ];
    for (const variant of variants) {
        await f.render(renderMultipleSelectsField(variant));
        assert.equal(f.button('Remove Legacy').disabled, true);
        assert.equal(f.button('Clear Colors').disabled, true);
        for (const node of f.container.querySelectorAll('input,button'))
            assert.equal(node.hasAttribute('disabled'), true);
        assert.ok(f.container.textContent?.includes('Legacy'));
    }
    assert.deepEqual(f.binding.getSnapshot().value, ['Legacy', 'Red']);
});

it('labels and feedback stay literal, IDs are unique, and Grid/List gestures stay inside the control', async (t) => {
    const f = await fixture(t);
    let rowEvents = 0,
        submits = 0;
    const row = () => {
        rowEvents++;
    };
    const props = {
        ...f.props(),
        context: 'portal-cell',
        error: '<img> Review choices',
    } as const;
    await f.render(
        h(
            'form',
            {
                onSubmit: (event: import('react').FormEvent) => {
                    event.preventDefault();
                    submits++;
                },
            },
            h(
                'div',
                {
                    onClick: row,
                    onDoubleClick: row,
                    onPointerDown: row,
                    onKeyDown: row,
                    onKeyUp: row,
                    onChange: row,
                },
                renderMultipleSelectsField(props),
                renderMultipleSelectsField({
                    ...props,
                    displayConfig: { showTitle: false },
                })
            )
        )
    );
    const ids = [...f.container.querySelectorAll('[id]')].map(
        (node) => node.id
    );
    assert.equal(ids.length, new Set(ids).size);
    const group = f.container.querySelector('fieldset')!;
    const feedback = f.container.querySelector(
        `[id="${group.getAttribute('aria-describedby')}"]`
    );
    assert.equal(feedback?.textContent, '<img> Review choices');
    assert.equal(f.container.querySelector('img'), null);
    for (const type of ['click', 'dblclick', 'pointerdown', 'keydown', 'keyup'])
        await act(async () => {
            group.dispatchEvent(new f.window.Event(type, { bubbles: true }));
        });
    await act(async () => f.checkbox('Blue').click());
    await act(async () => f.button('Clear Colors').click());
    assert.equal(rowEvents, 0);
    assert.equal(submits, 0);
});

it('captured host actions cannot write after configuration replacement or retirement', async (t) => {
    const f = await fixture(t);
    const props = f.props();
    await f.render(renderMultipleSelectsField(props));
    f.scope.revision++;
    await act(async () => f.button('Clear Colors').click());
    if (props.capability.type !== 'editable') throw Error('Editable expected');
    props.capability.selection?.toggle('Blue');
    props.capability.selection?.choose(['Blue']);
    assert.deepEqual(f.binding.getSnapshot().value, ['Red']);
    await act(async () => f.owner.destroy());
    await f.render(h(MultipleSelectField, { binding: f.binding }));
    assert.equal(f.container.textContent, '');
});

it('optional creation stays Form-only, uses the owner once, exposes pending/cancel, and never saves', async (t) => {
    const f = await fixture(t, { allowAddingNewOptions: true });
    let creates = 0,
        saves = 0;
    let accept!: (value: { newChoice: { id: string; name: string } }) => void;
    const pending = new Promise<{ newChoice: { id: string; name: string } }>(
        (resolve) => {
            accept = resolve;
        }
    );
    f.client.forms.addSelectOption = async () => {
        creates++;
        return pending;
    };
    f.client.forms.save = async () => {
        saves++;
        throw Error('No implicit Save');
    };
    await f.render(h(MultipleSelectField, { binding: f.binding }));
    assert.equal(f.container.querySelector('input:not([type=checkbox])'), null);
    await act(async () => {
        f.owner.selectChoice('multi', {
            journal: new RecoveryJournal(),
            scope: {
                owner: 'multiple-select',
                parentFieldId: null,
                tableId: null,
                childExtensionId: 'form',
                context: 'modal',
            },
            loadVersion: 1,
        });
    });
    await f.render(h(MultipleSelectField, { binding: f.binding }));
    const input = f.container.querySelector('input:not([type=checkbox])')!;
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
            f.window.HTMLInputElement.prototype,
            'value'
        )!.set!;
        setter.call(input, 'Mint');
        input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    });
    const enter = new f.window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
    });
    await act(async () => {
        input.dispatchEvent(enter);
    });
    assert.equal(enter.defaultPrevented, true);
    assert.equal(creates, 0);
    await act(async () => f.button('Add choice').click());
    assert.equal(creates, 1);
    assert.equal(f.button('Add choice').disabled, true);
    assert.equal(f.button('Cancel choice creation').disabled, false);
    await act(async () => accept({ newChoice: { id: 'mint', name: 'Mint' } }));
    assert.deepEqual(f.binding.getSnapshot().value, ['Red', 'Mint']);
    assert.match(f.container.textContent!, /draft.*Save to update the record/);
    assert.equal(saves, 0);
    await f.render(
        renderMultipleSelectsField({ ...f.props(), context: 'portal-detail' })
    );
    assert.equal(f.container.querySelector('input:not([type=checkbox])'), null);
});

it('cancels through the optional Form controller and rejects its delayed creation response', async (t) => {
    const f = await fixture(t, { allowAddingNewOptions: true });
    let accept!: (value: { newChoice: { id: string; name: string } }) => void;
    let creates = 0;
    const pending = new Promise<{ newChoice: { id: string; name: string } }>(
        (resolve) => {
            accept = resolve;
        }
    );
    f.client.forms.addSelectOption = async () => {
        creates++;
        return pending;
    };
    const creator = f.owner.selectChoice('multi', {
        journal: new RecoveryJournal(),
        scope: {
            owner: 'multiple-select',
            parentFieldId: null,
            tableId: null,
            childExtensionId: 'form',
            context: 'modal',
        },
        loadVersion: 1,
    });
    await f.render(h(MultipleSelectField, { binding: f.binding }));
    const input = f.container.querySelector('input:not([type=checkbox])')!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(
            f.window.HTMLInputElement.prototype,
            'value'
        )!.set!.call(input, 'Mint');
        input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    });
    await act(async () => f.button('Add choice').click());
    await act(async () => f.button('Cancel choice creation').click());
    assert.equal(creator.getSnapshot().phase, 'uncertain');
    await act(async () => accept({ newChoice: { id: 'mint', name: 'Mint' } }));
    assert.equal(creates, 1);
    assert.deepEqual(f.binding.getSnapshot().value, ['Red']);
    assert.equal(
        f.binding.selection
            ?.getState()
            .options.some((option) => option.value === 'Mint'),
        false
    );
});

it('does not carry an unfinished creation name to a replacement Form owner with the same field ID', async (t) => {
    const f = await fixture(t, { allowAddingNewOptions: true });
    const recovery = (owner: string) => ({
        journal: new RecoveryJournal(),
        scope: {
            owner,
            parentFieldId: null,
            tableId: null,
            childExtensionId: 'form',
            context: 'modal' as const,
        },
        loadVersion: 1,
    });
    f.owner.selectChoice('multi', recovery('multiple-select'));
    const captured = f.binding.choiceCreation!.create;
    await f.render(h(MultipleSelectField, { binding: f.binding }));
    const input = f.container.querySelector('input:not([type=checkbox])')!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(
            f.window.HTMLInputElement.prototype,
            'value'
        )!.set!.call(input, 'Unsubmitted name');
        input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    });
    assert.equal(f.button('Add choice').disabled, false);
    const replacement = createFormFieldBindings({
        loaded: structuredClone(f.loaded),
        client: f.client,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'replacement', revision: 0 }),
    });
    t.after(() => replacement.destroy());
    replacement.selectChoice('multi', recovery('replacement'));
    await f.render(
        h(MultipleSelectField, { binding: replacement.field('multi') })
    );
    const fresh = f.container.querySelector('input:not([type=checkbox])');
    assert.ok(fresh instanceof f.window.HTMLInputElement);
    assert.equal(fresh.value, '');
    assert.equal(f.button('Add choice').disabled, true);
    await act(async () => f.owner.destroy());
    assert.equal(await captured('Unsubmitted name'), false);
    assert.deepEqual(replacement.field('multi').getSnapshot().value, ['Red']);
});

for (const layout of ['grid', 'list'] as const)
    it(`integrates with actual Portal ${layout} hosts without reads on render or automatic writes`, async (t) => {
        const f = await fixture(t);
        const schema = f.loaded.payload.fieldIdsToSchemas.multi;
        const api = portalFixture(async () =>
            portalListPage({
                recordIds: ['record_1'],
                customViewDetailFields: {
                    fld_children: [
                        {
                            fieldId: 'multi',
                            fieldName: 'Colors',
                            titleOverride: '',
                            isHidden: false,
                            fieldIsInEditingChildForm: true,
                            childFormField: null,
                            miniExtConfig: schema.miniExtConfig,
                        },
                    ],
                },
                tableIdsToLinkedTableStates: {
                    table_children: {
                        airtableFields: [schema.airtableField],
                        recordIdsToAirtableRecords: {
                            record_1: {
                                id: 'record_1',
                                fields: { multi: ['Red'] },
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
                ownerId: 'multiple-select-portal',
                revision: 0,
            }),
        });
        await owner.readFirst(owner.getSnapshot().revision, {
            pagesToFetch: 1,
            refreshLoggedInPortalRecord: false,
        });
        const cell = createPortalCellBinding({
            client: api.client,
            schema,
            value: ['Red'],
            input: {
                portalExtensionAccessToken: 'portal_access_example',
                portalFieldId: 'fld_children',
                recordId: 'record_1',
                recordFieldId: 'multi',
                selectedCustomViewId: 'view_example',
            },
            getScope: () => ({
                ownerId: 'multiple-select-portal',
                revision: 0,
            }),
            isCurrent: () => true,
            recovery: {
                journal: new RecoveryJournal(),
                scope: {
                    owner: 'multiple-select-portal',
                    parentFieldId: 'fld_children',
                    tableId: 'table_children',
                    childExtensionId: '',
                    context: 'modal',
                },
                loadVersion: 1,
            },
        });
        const options = {
            owner,
            client: api.client,
            recordId: 'record_1',
            isCurrent: () => true,
            configurationRevision: () => 0,
        };
        const host =
            layout === 'grid'
                ? createPortalCellRendererHost({
                      ...options,
                      cell,
                      fieldId: 'multi',
                  })
                : createPortalDetailRendererHost(options);
        t.after(() => {
            host.dispose();
            cell.destroy();
            owner.destroy();
            assert.equal(api.calls.length, 1);
            assert.equal(api.mutations, 0);
        });
        await f.render(
            h(FieldRenderer, {
                host,
                renderers: { renderMultipleSelectsField },
            })
        );
        assert.ok(f.container.textContent?.includes('Red'));
        assert.equal(f.button('Remove Red').disabled, layout === 'list');
        if (layout === 'grid') {
            await act(async () => f.checkbox('Blue').click());
            assert.deepEqual(cell.binding.getSnapshot().value, ['Red', 'Blue']);
        }
    });
