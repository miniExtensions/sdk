import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement,
    StrictMode,
    useLayoutEffect,
    type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import {
    PortalList,
    SelectField,
    TextField,
    LinkedField,
    AirtableForm,
    AirtableGrid,
    AirtableList,
    PortalSortEditor,
    PortalFilterEditor,
    useButtonField,
} from '../src/react/index.js';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { createPortalRenderScope } from '../src/ui/portalRenderScope.js';
import {
    createButtonFieldModel,
    type ButtonFieldData,
    type ButtonFieldRenderProps,
} from '../src/ui/buttonModel.js';
import {
    createPortalSortEditor,
    createPortalFilterEditor,
    type PortalEditorOptions,
    type PortalSortEditorModel,
    type PortalFilterEditorModel,
} from '../src/portals/editors.js';
import { createFormRenderScope } from '../src/ui/formRenderScope.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalFixture, portalPage, portalListPage } from './portalFixtures.js';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};

function environment(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const previous = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        })
    );
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    t.after(async () => {
        await act(async () => root.unmount());
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    return {
        container,
        render: async (node: ReactNode, strict = true) =>
            act(async () =>
                root.render(
                    strict ? createElement(StrictMode, null, node) : node
                )
            ),
        button: (text: string) => {
            const node = [...container.querySelectorAll('button')].find(
                (node) => node.textContent === text
            );
            assert.ok(node, `Missing button ${text}`);
            return node;
        },
        change: async (selector: string, value: string) => {
            const node = container.querySelector(selector);
            assert.ok(node);
            await act(async () => {
                (node as unknown as HTMLInputElement).value = value;
                Simulate.change(node as unknown as Element);
            });
        },
    };
}

const readOptions = { pagesToFetch: 1, refreshLoggedInPortalRecord: false };
function portal(read: Parameters<typeof portalFixture>[0]) {
    const api = portalFixture(read);
    let revision = 0;
    const owner = createPortalListOwner({
        client: api.client,
        portal: portalPage(),
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
        getScope: () => ({ ownerId: 'A', revision }),
        configurationRevision: () => 0,
    });
    return {
        ...api,
        get mutations() {
            return api.mutations;
        },
        owner,
        retire: () => {
            revision++;
        },
    };
}
const list = (owner: ReturnType<typeof portal>['owner']) =>
    createElement(PortalList, { owner, readOptions });

it('React Portal mount is inert, cancellation aborts the read and rejects late results', async (t) => {
    const dom = environment(t);
    const pending = deferred<ReturnType<typeof portalListPage>>();
    const f = portal(() => pending.promise);
    t.after(() => f.owner.destroy());
    await dom.render(list(f.owner));
    assert.equal(f.calls.length, 0);
    assert.equal(dom.button('Cancel read').disabled, true);
    await act(async () => dom.button('Load records').click());
    assert.equal(f.calls.length, 1);
    assert.equal(dom.button('Load records').disabled, true);
    assert.equal(
        dom.container.querySelector('[role=status]')!.getAttribute('aria-busy'),
        'true'
    );
    await act(async () => dom.button('Cancel read').click());
    assert.equal(f.calls[0].options?.signal?.aborted, true);
    await act(async () =>
        pending.resolve(portalListPage({ recordIds: ['private_late_record'] }))
    );
    assert.equal(f.owner.getSnapshot().page, null);
    assert.equal(dom.container.querySelectorAll('li').length, 0);
    assert.equal(dom.button('Load records').disabled, false);
    assert.equal(f.mutations, 0);
});

it('React Portal reports rejected and empty reads and recovers only on explicit user action', async (t) => {
    const dom = environment(t);
    let attempts = 0;
    const f = portal(async () => {
        if (++attempts === 1) throw Error('Synthetic read failed');
        return portalListPage();
    });
    t.after(() => f.owner.destroy());
    await dom.render(list(f.owner));
    await act(async () => dom.button('Load records').click());
    assert.equal(
        dom.container.querySelector('[role=status]')!.textContent,
        'The Portal read did not complete. Use an explicit fresh Load.'
    );
    assert.equal(dom.button('Load records').disabled, false);
    assert.equal(dom.button('Next page').disabled, true);
    await dom.render(list(f.owner));
    assert.equal(attempts, 1);
    await act(async () => dom.button('Load records').click());
    assert.equal(attempts, 2);
    assert.equal(
        dom.container.querySelector('[role=status]')!.textContent,
        'No records returned.'
    );
    assert.equal(f.mutations, 0);
});

it('React Portal replacement isolates a late old owner and remount preserves accepted records without reads', async (t) => {
    const dom = environment(t);
    const pending = deferred<ReturnType<typeof portalListPage>>();
    const first = portal(() => pending.promise);
    const second = portal(async () =>
        portalListPage({
            recordIds: ['private_current'],
            airtableOffset: 'next',
        })
    );
    t.after(() => {
        first.owner.destroy();
        second.owner.destroy();
    });
    await dom.render(list(first.owner));
    await act(async () => dom.button('Load records').click());
    await dom.render(list(second.owner));
    assert.equal(second.calls.length, 0);
    await act(async () => dom.button('Load records').click());
    assert.equal(dom.container.querySelectorAll('li').length, 1);
    assert.equal(dom.button('Next page').disabled, false);
    await act(async () =>
        pending.resolve(portalListPage({ recordIds: ['old_a', 'old_b'] }))
    );
    assert.equal(first.owner.getSnapshot().page?.recordIds.length, 2);
    assert.equal(dom.container.querySelectorAll('li').length, 1);
    assert.equal(dom.container.textContent.includes('private_current'), false);
    await dom.render(null);
    await dom.render(list(second.owner));
    assert.equal(second.calls.length, 1);
    assert.equal(dom.container.querySelectorAll('li').length, 1);
    await act(async () => {
        second.retire();
        second.owner.getSnapshot();
    });
    await dom.render(list(second.owner));
    assert.equal(dom.container.innerHTML, '');
    assert.equal(second.owner.getSnapshot().phase, 'retired');
});

function form(single = false) {
    const loaded = loadedForm();
    loaded.payload.fieldIdsInForm = ['fld_title', 'fld_choice'];
    loaded.payload.fieldIdsToSchemas.fld_choice = {
        fieldType: 'multipleSelects',
        airtableField: {
            id: 'fld_choice',
            name: 'Choice',
            isComputed: false,
            isPrimaryField: false,
            description: null,
            config: {
                type: 'multipleSelects',
                options: { choices: [{ id: 'sel_alpha', name: 'Alpha' }] },
            },
        },
        miniExtConfig: { allowAddingNewOptions: true },
    };
    if (single) {
        loaded.payload.fieldIdsToSchemas.fld_choice = {
            fieldType: 'singleSelect',
            airtableField: {
                id: 'fld_choice',
                name: 'Choice',
                isComputed: false,
                isPrimaryField: false,
                description: null,
                config: {
                    type: 'singleSelect',
                    options: { choices: [{ id: 'sel_alpha', name: 'Alpha' }] },
                },
            },
        };
    }
    loaded.payload.formRecord.data.fld_choice = single ? 'Alpha' : ['Alpha'];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        fetch: async () => {
            throw Error('No implicit I/O');
        },
    });
    const owner = createFormFieldBindings({
        client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'A', revision: 0 }),
    });
    owner.selectChoice('fld_choice', {
        journal: new RecoveryJournal(),
        loadVersion: 1,
        scope: {
            owner: 'A',
            parentFieldId: null,
            tableId: null,
            childExtensionId: 'form',
            context: 'modal',
        },
    });
    return { owner, client };
}

it('React field replacement releases subscriptions, directs edits to the new binding, and preserves owner drafts on unmount', async (t) => {
    const dom = environment(t);
    const first = form(),
        second = form();
    t.after(() => {
        first.owner.destroy();
        second.owner.destroy();
    });
    const oldBinding = first.owner.field('fld_title');
    const newBinding = second.owner.field('fld_title');
    let live = 0;
    const subscribe = oldBinding.subscribe.bind(oldBinding);
    oldBinding.subscribe = (listener) => {
        live++;
        const stop = subscribe(listener);
        return () => {
            live--;
            stop();
        };
    };
    await dom.render(createElement(TextField, { binding: oldBinding }));
    assert.equal(live, 1);
    await dom.change('input', 'Old draft');
    assert.equal(oldBinding.getSnapshot().value, 'Old draft');
    await dom.render(createElement(TextField, { binding: newBinding }));
    assert.equal(live, 0);
    await act(async () => oldBinding.setValue('Late old update'));
    assert.equal(dom.container.querySelector('input')!.value, 'Initial title');
    await dom.change('input', '');
    assert.equal(newBinding.getSnapshot().value, null);
    assert.equal(oldBinding.getSnapshot().value, 'Late old update');
    await dom.render(null);
    assert.equal(newBinding.getSnapshot().dirty, true);
    await dom.render(createElement(TextField, { binding: newBinding }));
    assert.equal(dom.container.querySelector('input')!.value, '');
});

it('React choice completion cannot clear text entered for a replacement binding', async (t) => {
    const dom = environment(t);
    const first = form(),
        second = form();
    t.after(() => {
        first.owner.destroy();
        second.owner.destroy();
    });
    const pending = deferred<{ newChoice: { id: string; name: string } }>();
    let calls = 0;
    first.client.forms.addSelectOption = async () => {
        calls++;
        return pending.promise;
    };
    await dom.render(
        createElement(SelectField, { binding: first.owner.field('fld_choice') })
    );
    assert.equal(dom.button('Create choice').disabled, true);
    await dom.change('input', 'Shared intent');
    await act(async () => dom.button('Create choice').click());
    assert.equal(calls, 1);
    assert.equal(dom.button('Cancel choice creation').disabled, false);
    await dom.render(
        createElement(SelectField, {
            binding: second.owner.field('fld_choice'),
        })
    );
    assert.equal(dom.container.querySelector('input')!.value, '');
    await dom.change('input', 'Shared intent');
    await act(async () =>
        pending.resolve({ newChoice: { id: 'created', name: 'Shared intent' } })
    );
    assert.equal(dom.container.querySelector('input')!.value, 'Shared intent');
    assert.deepEqual(second.owner.field('fld_choice').getSnapshot().value, [
        'Alpha',
    ]);
    assert.deepEqual(first.owner.field('fld_choice').getSnapshot().value, [
        'Alpha',
        'Shared intent',
    ]);
    assert.equal(dom.button('Create choice').disabled, false);
});

it('React choice cancellation preserves input and rejects the late mutation as draft authority', async (t) => {
    const dom = environment(t);
    const f = form();
    t.after(() => f.owner.destroy());
    const pending = deferred<{ newChoice: { id: string; name: string } }>();
    f.client.forms.addSelectOption = async () => pending.promise;
    await dom.render(
        createElement(SelectField, { binding: f.owner.field('fld_choice') })
    );
    await dom.change('input', 'Cancelled intent');
    await act(async () => dom.button('Create choice').click());
    await act(async () => dom.button('Cancel choice creation').click());
    await act(async () =>
        pending.resolve({
            newChoice: { id: 'created', name: 'Cancelled intent' },
        })
    );
    assert.equal(
        dom.container.querySelector('input')!.value,
        'Cancelled intent'
    );
    assert.deepEqual(f.owner.field('fld_choice').getSnapshot().value, [
        'Alpha',
    ]);
    assert.equal(dom.button('Cancel choice creation').disabled, true);
    assert.equal(
        f.owner.field('fld_choice').getSnapshot().choiceCreation?.busy,
        false
    );
});

it('React Form shell retains its scope across remount and removes retired fields', async (t) => {
    const dom = environment(t);
    const f = form();
    let current = true;
    const scope = createFormRenderScope({
        fields: f.owner,
        isCurrent: () => current,
        configurationRevision: () => 0,
    });
    t.after(() => {
        scope.destroy();
        f.owner.destroy();
    });
    const render = () =>
        createElement(AirtableForm, {
            scope,
            renderers: {},
            fallback: (failure) => createElement('span', null, failure.status),
            children: (state) =>
                createElement(
                    'section',
                    null,
                    ...state.fields.map((field) =>
                        createElement('div', { key: field.fieldId }, field.node)
                    )
                ),
        });
    await dom.render(render());
    assert.equal(dom.container.querySelectorAll('span').length, 2);
    assert.equal(
        dom.container.querySelector('span')!.textContent,
        'missing-renderer'
    );
    await act(async () =>
        f.owner.field('fld_title').setValue('Preserved draft')
    );
    await dom.render(null);
    assert.equal(scope.getSnapshot().retired, false);
    await dom.render(render());
    assert.equal(
        f.owner.field('fld_title').getSnapshot().value,
        'Preserved draft'
    );
    current = false;
    await dom.render(render());
    assert.equal(dom.container.innerHTML, '');
    assert.equal(scope.getSnapshot().retired, true);
});

for (const Shell of [AirtableGrid, AirtableList]) {
    it(`React ${Shell.name} follows accepted rows, preserves owner on unmount, and retires with its scope`, async (t) => {
        const dom = environment(t);
        const schema = loadedForm().payload.fieldIdsToSchemas.fld_title;
        const f = portal(async () =>
            portalListPage({
                recordIds: ['record_1'],
                customViewDetailFields: {
                    fld_children: [
                        {
                            fieldId: 'fld_title',
                            fieldName: 'Title',
                            titleOverride: '',
                            isHidden: false,
                            fieldIsInEditingChildForm: false,
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
                                fields: { fld_title: 'Accepted record' },
                            },
                        },
                    },
                },
            })
        );
        let current = true;
        const scope = createPortalRenderScope({
            owner: f.owner,
            client: f.client,
            isCurrent: () => current,
            configurationRevision: () => 0,
        });
        t.after(() => {
            scope.destroy();
            f.owner.destroy();
        });
        const render = () =>
            createElement(Shell, {
                scope,
                renderers: {},
                fallback: (failure) =>
                    createElement('span', null, failure.status),
                children: (state) =>
                    createElement(
                        'section',
                        null,
                        ...state.rows.map((row) =>
                            createElement(
                                'article',
                                { key: row.recordId },
                                ...row.cells.map((cell) =>
                                    createElement(
                                        'div',
                                        { key: cell.fieldId },
                                        cell.node
                                    )
                                )
                            )
                        )
                    ),
            });
        await dom.render(render());
        assert.equal(f.calls.length, 0);
        assert.equal(dom.container.querySelectorAll('article').length, 0);
        await act(async () => {
            assert.equal(
                await scope.getSnapshot().actions.load(readOptions),
                true
            );
        });
        assert.equal(dom.container.querySelectorAll('article').length, 1);
        assert.equal(
            dom.container.querySelector('span')!.textContent,
            'missing-renderer'
        );
        await dom.render(null);
        assert.equal(f.owner.getSnapshot().phase, 'ready');
        await dom.render(render());
        assert.equal(f.calls.length, 1);
        assert.equal(dom.container.querySelectorAll('article').length, 1);
        await act(async () => {
            current = false;
            scope.getSnapshot();
        });
        await dom.render(render());
        assert.equal(dom.container.innerHTML, '');
        assert.equal(f.owner.getSnapshot().phase, 'ready');
    });
}

function editorOptions(): PortalEditorOptions {
    const schema = loadedForm().payload.fieldIdsToSchemas.fld_title;
    return {
        portal: portalPage(),
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
        snapshot: {
            ...portalListPage({
                customViewDetailFields: {
                    fld_children: [
                        {
                            fieldId: 'fld_title',
                            fieldName: 'Title',
                            titleOverride: '',
                            fieldIsInEditingChildForm: false,
                            childFormField: null,
                            isHidden: false,
                            miniExtConfig: {},
                        },
                    ],
                },
                tableIdsToLinkedTableStates: {
                    table_children: {
                        airtableFields: [schema.airtableField],
                        recordIdsToAirtableRecords: {},
                    },
                },
            }),
            criteriaKey: 'fixture',
            detailFields: [
                {
                    fieldId: 'fld_title',
                    fieldName: 'Title',
                    titleOverride: '',
                    fieldIsInEditingChildForm: false,
                    childFormField: null,
                    isHidden: false,
                    miniExtConfig: {},
                },
            ],
            layoutSettings: {
                layout: 'grid',
                disableInlineEdit: false,
                allowUsersToUnlinkRecords: false,
                kanbanCategoryField: null,
            },
        },
        isCurrent: () => true,
        configurationRevision: () => 0,
        onApply: () => {
            throw Error('No automatic apply');
        },
    };
}

for (const kind of ['sort', 'filter'] as const) {
    it(`React Portal ${kind} editor catches child layout changes before subscription and keeps prepared state across remount`, async (t) => {
        const dom = environment(t);
        const created =
            kind === 'sort'
                ? createPortalSortEditor(editorOptions())
                : createPortalFilterEditor(editorOptions());
        assert.equal(created.type, 'ready');
        if (created.type !== 'ready') throw Error('Editor unavailable');
        const model = created.model;
        t.after(() => model.destroy());
        assert.equal(
            kind === 'sort'
                ? (model as PortalSortEditorModel).getSnapshot().direction
                : (model as PortalFilterEditorModel).getSnapshot().operand,
            kind === 'sort' ? 'asc' : ''
        );
        function Child() {
            useLayoutEffect(() => {
                assert.equal(model.setField('fld_title'), true);
                assert.equal(
                    kind === 'sort'
                        ? (model as PortalSortEditorModel).setDirection('desc')
                        : (model as PortalFilterEditorModel).setOperand(
                              'Prepared during layout'
                          ),
                    true
                );
            }, []);
            return null;
        }
        const node =
            kind === 'sort'
                ? createElement(PortalSortEditor, {
                      model: model as PortalSortEditorModel,
                      render: ({ snapshot }) =>
                          createElement(
                              'div',
                              null,
                              createElement(Child),
                              createElement('output', null, snapshot.direction)
                          ),
                  })
                : createElement(PortalFilterEditor, {
                      model: model as PortalFilterEditorModel,
                      render: ({ snapshot }) =>
                          createElement(
                              'div',
                              null,
                              createElement(Child),
                              createElement(
                                  'output',
                                  null,
                                  String(snapshot.operand)
                              )
                          ),
                  });
        // A single mount isolates the render-to-subscribe gap; StrictMode
        // effect replay would notify an already subscribed consumer.
        await dom.render(node, false);
        assert.equal(
            dom.container.querySelector('output')!.textContent,
            kind === 'sort' ? 'desc' : 'Prepared during layout'
        );
        await dom.render(null);
        assert.equal(model.getSnapshot().retired, false);
        assert.equal(model.getSnapshot().fieldId, 'fld_title');
        await dom.render(node, false);
        assert.equal(
            dom.container.querySelector('output')!.textContent,
            kind === 'sort' ? 'desc' : 'Prepared during layout'
        );
        await act(async () => model.destroy());
        assert.equal(model.getSnapshot().retired, true);
    });
}

it('React button hook preserves a pending webhook across remount and fences captured stale actions', async (t) => {
    const dom = environment(t);
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        fetch: async () => {
            throw Error('Unexpected I/O');
        },
    });
    const pending = deferred<{ success: boolean }>();
    let calls = 0;
    client.buttons.triggerWebhook = async () => {
        calls++;
        return pending.promise;
    };
    const data: ButtonFieldData = {
        field: {
            id: 'button',
            name: 'Run',
            description: null,
            isComputed: true,
            isPrimaryField: false,
            config: { type: 'button', options: null },
        },
        value: { url: 'https://action.example.test', label: 'Run' },
        config: { openLinkType: 'triggerWebhookPOST' },
        language: 'en',
        source: { type: 'current-record', recordId: 'record' },
        extensionAccessToken: 'synthetic',
        visible: true,
    };
    const model = createButtonFieldModel({
        client,
        adapter: {
            read: () => data,
            isCurrent: () => true,
            configurationRevision: () => 0,
        },
        recovery: {
            journal: new RecoveryJournal(),
            loadVersion: 1,
            scope: {
                owner: 'A',
                parentFieldId: null,
                tableId: 'table',
                childExtensionId: 'form',
                context: 'modal',
            },
        },
    });
    t.after(() => model.dispose());
    let rendered!: ButtonFieldRenderProps;
    function Button() {
        rendered = useButtonField(model);
        return createElement(
            'button',
            {
                onClick: () => void rendered.triggerWebhook(),
                disabled: !rendered.canTrigger,
            },
            rendered.phase
        );
    }
    await dom.render(createElement(Button));
    const initial = rendered;
    assert.equal(calls, 0);
    await act(async () => dom.container.querySelector('button')!.click());
    assert.equal(calls, 1);
    assert.equal(rendered.phase, 'pending');
    assert.equal(initial.cancel(), false);
    assert.equal((await initial.triggerWebhook()).type, 'refused');
    await dom.render(null);
    assert.equal(model.getSnapshot().phase, 'pending');
    await dom.render(createElement(Button));
    assert.equal(calls, 1);
    assert.equal(dom.container.querySelector('button')!.disabled, true);
    await act(async () => pending.resolve({ success: true }));
    assert.equal(
        dom.container.querySelector('button')!.textContent,
        'reported-success'
    );
    assert.equal(calls, 1);
    await act(async () => {
        assert.equal(rendered.acknowledgeNewIntent(), false);
    });
    assert.equal(
        dom.container.querySelector('button')!.textContent,
        'reported-success'
    );
});

it('React linked-record controls perform only explicit searches and retain native choices while paging', async (t) => {
    const dom = environment(t);
    const loaded = loadedForm();
    loaded.payload.fieldIdsInForm = ['fld_parent'];
    loaded.payload.fieldIdsToSchemas.fld_parent = {
        fieldType: 'multipleRecordLinks',
        airtableField: {
            id: 'fld_parent',
            name: 'Parent',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'multipleRecordLinks',
                options: {
                    linkedTableId: 'tbl_parent',
                    isReversed: false,
                    prefersSingleRecordLink: false,
                },
            },
        },
        miniExtConfig: {},
    };
    loaded.payload.formRecord.data.fld_parent = [];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        fetch: async () => {
            throw Error('No implicit request');
        },
    });
    const owner = createFormFieldBindings({
        client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'A', revision: 0 }),
    });
    t.after(() => owner.destroy());
    const calls: { searchTerm: string; offset: string | null }[] = [];
    owner.setLinkedLoader('fld_parent', async (request) => {
        calls.push({ searchTerm: request.searchTerm, offset: request.offset });
        return {
            options: [
                {
                    value: request.offset ? 'record_b' : 'record_a',
                    label: request.offset ? 'Beta' : 'Alpha',
                },
            ],
            offset: request.offset ? null : 'next',
        };
    });
    await dom.render(
        createElement(LinkedField, { binding: owner.field('fld_parent') })
    );
    assert.equal(calls.length, 0);
    assert.equal(dom.button('More').disabled, true);
    await dom.change('input', 'Exact search');
    assert.equal(calls.length, 0);
    await act(async () => dom.button('Search').click());
    assert.deepEqual(calls, [{ searchTerm: 'Exact search', offset: null }]);
    await act(async () =>
        Simulate.change(
            dom.container.querySelector(
                'input[type=checkbox]'
            )! as unknown as Element
        )
    );
    assert.deepEqual(owner.field('fld_parent').getSnapshot().value, [
        'record_a',
    ]);
    await act(async () => dom.button('More').click());
    assert.deepEqual(calls[1], { searchTerm: 'Exact search', offset: 'next' });
    assert.equal(
        dom.container.querySelectorAll('input[type=checkbox]').length,
        2
    );
    assert.equal(
        (
            dom.container.querySelector(
                'input[type=checkbox]'
            ) as unknown as HTMLInputElement
        ).checked,
        true
    );
    assert.equal(dom.button('More').disabled, true);
    await dom.render(
        createElement(LinkedField, {
            binding: owner.field('fld_parent'),
            render: ({ snapshot, binding }) =>
                createElement(
                    'button',
                    {
                        onClick: () => binding.selection!.choose([]),
                    },
                    `Custom selected: ${snapshot.selection!.value.join(',')}`
                ),
        })
    );
    assert.equal(
        dom.container.querySelector('button')!.textContent,
        'Custom selected: record_a'
    );
    await act(async () => dom.container.querySelector('button')!.click());
    assert.deepEqual(owner.field('fld_parent').getSnapshot().value, []);
    assert.equal(
        dom.container.querySelector('button')!.textContent,
        'Custom selected: '
    );
    assert.equal(calls.length, 2);
    // Return to the stock renderer before retirement: custom renderers own
    // how retired snapshots are presented.
    await dom.render(
        createElement(LinkedField, { binding: owner.field('fld_parent') })
    );
    await act(async () => owner.destroy());
    assert.equal(dom.container.innerHTML, '');
});

it('React Portal cleanup presentation requires explicit acceptance and never starts another read', async (t) => {
    const dom = environment(t);
    const f = portal(async () =>
        portalListPage({ endUserSortCleanup: { sortFields: [] } })
    );
    t.after(() => f.owner.destroy());
    await dom.render(list(f.owner));
    await act(async () => dom.button('Load records').click());
    assert.equal(f.calls.length, 1);
    assert.equal(f.owner.getSnapshot().phase, 'cleanup');
    assert.match(
        dom.container.querySelector('[role=status]')!.textContent,
        /Inspect replacements before acceptance/
    );
    assert.equal(dom.button('Load records').disabled, true);
    await act(async () => {
        assert.equal(
            f.owner.acceptCleanup(f.owner.getSnapshot().revision),
            true
        );
    });
    assert.equal(f.calls.length, 1);
    assert.equal(dom.button('Load records').disabled, false);
});

it('React single-select stock and custom renderers share native choice and explicit clearing authority', async (t) => {
    const dom = environment(t);
    const f = form(true);
    t.after(() => f.owner.destroy());
    const binding = f.owner.field('fld_choice');
    await dom.render(createElement(SelectField, { binding }));
    const select = dom.container.querySelector('select')!;
    assert.equal(select.multiple, false);
    assert.equal(select.value, 'Alpha');
    assert.equal(select.options[0].textContent, 'None');
    await dom.change('select', '');
    assert.equal(binding.getSnapshot().value, null);
    assert.equal(select.value, '');
    await dom.render(
        createElement(SelectField, {
            binding,
            render: ({ snapshot, binding: accepted }) =>
                createElement(
                    'button',
                    {
                        onClick: () =>
                            accepted.selection!.choose(
                                snapshot.value == null ? ['Alpha'] : []
                            ),
                    },
                    `Custom choice: ${snapshot.value ?? 'None'}`
                ),
        })
    );
    assert.equal(dom.container.querySelector('select'), null);
    assert.equal(
        dom.container.querySelector('button')!.textContent,
        'Custom choice: None'
    );
    await act(async () => dom.container.querySelector('button')!.click());
    assert.equal(binding.getSnapshot().value, 'Alpha');
    assert.equal(
        dom.container.querySelector('button')!.textContent,
        'Custom choice: Alpha'
    );
    await act(async () => dom.container.querySelector('button')!.click());
    assert.equal(binding.getSnapshot().value, null);
    assert.equal(
        dom.container.querySelector('button')!.textContent,
        'Custom choice: None'
    );
    await dom.render(createElement(SelectField, { binding }));
    assert.equal(dom.container.querySelector('select')!.value, '');
    assert.equal(binding.getSnapshot().dirty, true);
    await act(async () => f.owner.destroy());
    assert.equal(dom.container.innerHTML, '');
});

it('React custom Portal renderer uses the same owner and reports only accepted read results', async (t) => {
    const dom = environment(t);
    const pending = deferred<ReturnType<typeof portalListPage>>();
    const f = portal(() => pending.promise);
    t.after(() => f.owner.destroy());
    await dom.render(
        createElement(PortalList, {
            owner: f.owner,
            readOptions,
            render: ({ owner, snapshot }) =>
                createElement(
                    'div',
                    null,
                    createElement(
                        'output',
                        null,
                        `${snapshot.phase}:${snapshot.page?.recordIds.length ?? 0}`
                    ),
                    createElement(
                        'button',
                        {
                            disabled: snapshot.pending,
                            onClick: () =>
                                void owner.readFirst(
                                    snapshot.revision,
                                    readOptions
                                ),
                        },
                        'Custom load'
                    )
                ),
        })
    );
    assert.equal(f.calls.length, 0);
    assert.equal(dom.container.querySelector('output')!.textContent, 'idle:0');
    await act(async () => dom.button('Custom load').click());
    assert.equal(f.calls.length, 1);
    assert.equal(dom.button('Custom load').disabled, true);
    assert.equal(
        dom.container.querySelector('output')!.textContent,
        'loading:0'
    );
    await act(async () =>
        pending.resolve(portalListPage({ recordIds: ['one', 'two'] }))
    );
    assert.equal(dom.container.querySelector('output')!.textContent, 'ready:2');
    await dom.render(list(f.owner));
    assert.equal(dom.container.querySelectorAll('li').length, 2);
    assert.equal(f.calls.length, 1);
    assert.equal(f.mutations, 0);
});
