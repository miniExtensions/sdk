import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    SingleSelectField,
    SelectField,
    FieldRenderer,
    renderSingleSelectField,
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
    FieldRendererHost,
    FieldRendererProps,
} from '../src/ui/rendererRegistry.js';
import {
    createMiniExtensionsClient,
    type FormLoadedResult,
    type SelectFieldChoice,
    type UpdateGridCellInput,
    type UpdateGridCellResult,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions, invalidForm } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

const choices = [
    { id: 'sel_alpha', name: 'Alpha' },
    { id: 'sel_beta', name: 'Beta' },
    { id: 'sel_exact', name: '  <b>Exact & native</b>  ' },
];
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => {
        resolve = accept;
    });
    return { promise, resolve };
};

function typeBoundaries(
    single: FieldRendererProps<'singleSelect'>,
    multiple: FieldRendererProps<'multipleSelects'>
) {
    renderSingleSelectField(single, {
        source: {},
        emptyLabel: 'Choose',
        clearLabel: 'Remove choice',
    });
    // @ts-expect-error Multiple Select remains a distinct physical renderer.
    renderSingleSelectField(multiple);
}

async function environment(t: TestContext) {
    const window = new Window();
    for (const key of ['AbortController', 'AbortSignal'] as const)
        Object.defineProperty(window, key, { value: globalThis[key] });
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLSelectElement',
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
    const cleanups: (() => void)[] = [];
    t.after(async () => {
        await act(async () => root.unmount());
        cleanups.reverse().forEach((cleanup) => cleanup());
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    const select = () => {
        const node = container.querySelector('select');
        assert.ok(node, 'Expected the native single-select control');
        return node;
    };
    const input = () => {
        const node = container.querySelector('input');
        assert.ok(node, 'Expected an explicit new-choice input');
        return node;
    };
    const button = (label: string) => {
        const node = Array.from(container.querySelectorAll('button')).find(
            (node) =>
                node.textContent === label ||
                node.getAttribute('aria-label') === label
        );
        assert.ok(node, `Expected ${label} button`);
        return node;
    };
    const tree = (host: FieldRendererHost) =>
        h(FieldRenderer, {
            host,
            renderers: { renderSingleSelectField },
            fallback: () => null,
        });
    const makeOwner = (
        config: FieldConfig<'singleSelect'> = {},
        initial: string | null | undefined = 'Alpha',
        configure: (page: FormLoadedResult) => void = () => {},
        create = false
    ) => {
        const page = loadedForm();
        page.payload.fieldIdsInForm = ['fld_title', 'choice'];
        page.payload.fieldIdsToSchemas.choice = {
            fieldType: 'singleSelect',
            airtableField: {
                id: 'choice',
                name: 'Decision',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: 'singleSelect',
                    options: { choices: structuredClone(choices) },
                },
            },
            miniExtConfig: config,
        };
        if (initial !== undefined)
            page.payload.formRecord.data.choice = initial;
        configure(page);
        let requests = 0,
            saves = 0;
        const scope = {
            current: true,
            writable: true,
            visible: true,
            revision: 0,
            ownerRevision: 0,
        };
        const client = createMiniExtensionsClient({
            apiOrigin: 'https://synthetic.invalid',
            session: { visitor: 'synthetic_A' },
            fetch: async () => {
                requests++;
                throw Error('Unexpected network request');
            },
        });
        client.forms.save = async () => {
            saves++;
            return invalidForm();
        };
        const owner = createFormFieldBindings({
            loaded: page,
            saveOptions: formSaveOptions(),
            client,
            getScope: () => ({
                ownerId: 'single-select-test',
                revision: scope.ownerRevision,
            }),
            canWrite: () => scope.writable,
            canWriteField: () => scope.visible,
        });
        const journal = new RecoveryJournal();
        const creator = create
            ? owner.selectChoice('choice', {
                  journal,
                  scope: {
                      owner: 'single-select-test',
                      parentFieldId: null,
                      tableId: null,
                      childExtensionId: 'synthetic',
                      context: 'modal',
                  },
                  loadVersion: 1,
              })
            : null;
        const binding = owner.field('choice');
        const host = createFormFieldRendererHost({
            fields: owner,
            fieldId: 'choice',
            isCurrent: () => scope.current,
            configurationRevision: () => scope.revision,
        });
        cleanups.push(() => {
            host.dispose();
            owner.destroy();
            assert.equal(requests, 0);
            assert.equal(
                saves,
                0,
                'Selection and choice creation never invoke Form Save'
            );
        });
        const props = (): FieldRendererProps<'singleSelect'> => {
            const snapshot = host.getSnapshot();
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'singleSelect'
            )
                throw Error('Expected accepted Single Select props');
            return snapshot.fields[0];
        };
        return {
            page,
            client,
            owner,
            binding,
            host,
            scope,
            creator,
            journal,
            props,
        };
    };
    return {
        window,
        container,
        select,
        input,
        button,
        tree,
        makeOwner,
        cleanups,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        choose: async (value: string, node = select()) => {
            await act(async () => {
                node.value = value;
                node.dispatchEvent(
                    new window.Event('change', { bubbles: true })
                );
            });
        },
        name: async (value: string) => {
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
        click: async (label: string) => {
            await act(async () => button(label).click());
        },
    };
}

it('dedicated binding, generic SelectField and slot preserve exact names, null clearing and owner drafts', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner({}, null);
    for (const view of [
        h(SingleSelectField, {
            binding: f.binding,
            className: 'custom-select',
        }),
        h(SelectField, { binding: f.binding }),
        dom.tree(f.host),
    ]) {
        await dom.render(view);
        assert.equal(dom.select().multiple, false);
        assert.equal(dom.select().value, '');
        assert.equal(f.binding.getSnapshot().dirty, false);
    }
    await dom.choose(choices[2].name);
    assert.equal(f.binding.getSnapshot().value, choices[2].name);
    assert.equal(dom.container.querySelector('b'), null);
    await dom.render(null);
    await dom.render(h(SingleSelectField, { binding: f.binding }));
    assert.equal(dom.select().value, choices[2].name);
    await dom.click('Clear Decision');
    assert.equal(f.binding.getSnapshot().value, null);
    assert.equal(dom.select().value, '');
    assert.equal(dom.window.document.activeElement, dom.select());
    await act(async () => {
        f.binding.setValue('Beta');
    });
    assert.equal(dom.select().value, 'Beta');
    await dom.choose('');
    assert.equal(f.binding.getSnapshot().value, null);
});

for (const initial of [undefined, null, '', 'Unknown legacy choice', 'Alpha'])
    it(`mount preserves the native ${String(initial)} baseline without hydration writes`, async (t) => {
        const dom = await environment(t);
        const f = dom.makeOwner({}, initial, (page) => {
            if (initial === undefined)
                delete page.payload.formRecord.data.choice;
        });
        const baseline = f.binding.getSnapshot();
        await dom.render(dom.tree(f.host));
        assert.equal(dom.select().value, initial ?? '');
        assert.equal(f.binding.getSnapshot().value, baseline.value);
        assert.equal(f.binding.getSnapshot().revision, baseline.revision);
        assert.equal(f.binding.getSnapshot().dirty, false);
        assert.equal(dom.container.querySelector('input'), null);
    });

it('restricted selected names remain visible until cleared and cannot be re-added through forged options', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner(
        { singleOrMultiSelectLimitSelectionOptions: ['sel_beta'] },
        'Alpha'
    );
    await dom.render(dom.tree(f.host));
    assert.equal(dom.select().value, 'Alpha');
    assert.deepEqual(
        new Set(Array.from(dom.select().options, (o) => o.value)),
        new Set(['', 'Alpha', 'Beta'])
    );
    await dom.choose('');
    assert.equal(f.binding.getSnapshot().value, null);
    assert.equal(
        Array.from(dom.select().options).some((o) => o.value === 'Alpha'),
        false
    );
    const forged = dom.window.document.createElement('option');
    forged.value = 'Alpha';
    dom.select().append(forged);
    await dom.choose('Alpha');
    assert.equal(f.binding.getSnapshot().value, null);
    await dom.choose('Beta');
    assert.equal(f.binding.getSnapshot().value, 'Beta');
});

it('conditional duplicate labels are presentation only and native names remain canonical', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner({
        enableConditionalOptions: true,
        conditionsForOptions: ['sel_alpha', 'sel_beta'].map((id) => ({
            id,
            config: {
                optionForConditions: id,
                name: 'Same label',
                conditionsForOption: { logicalOperator: 'and', conditions: [] },
            },
        })),
    });
    await dom.render(dom.tree(f.host));
    assert.equal(
        Array.from(dom.select().options).find((o) => o.value === 'Alpha')
            ?.textContent,
        'Same label (Alpha)'
    );
    assert.equal(
        Array.from(dom.select().options).find((o) => o.value === 'Beta')
            ?.textContent,
        'Same label (Beta)'
    );
    await dom.choose('Beta');
    assert.equal(f.binding.getSnapshot().value, 'Beta');
});

const conditionalBeta: FieldConfig<'singleSelect'> = {
    allowAddingNewOptions: true,
    enableConditionalOptions: true,
    conditionsForOptions: [
        {
            id: 'beta-rule',
            config: {
                optionForConditions: 'sel_beta',
                name: 'Conditional Beta',
                conditionsForOption: {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'title-rule',
                            type: 'singleCondition',
                            setting: {
                                type: 'is',
                                fieldType: 'singleLineText',
                                idOrName: { type: 'id', id: 'fld_title' },
                                value: 'Allowed',
                            },
                        },
                    ],
                },
            },
        },
    ],
};

it('live conditional changes retain selected native names but refuse re-addition after deliberate clearing', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner(conditionalBeta, 'Beta', (page) => {
        page.payload.formRecord.data.fld_title = 'Allowed';
    });
    await dom.render(dom.tree(f.host));
    assert.equal(
        dom.select().selectedOptions[0].textContent,
        'Conditional Beta'
    );
    await act(async () => {
        f.owner.field('fld_title').setValue('Denied');
    });
    assert.equal(f.binding.getSnapshot().value, 'Beta');
    assert.equal(dom.select().value, 'Beta');
    await dom.click('Clear Decision');
    assert.equal(f.binding.getSnapshot().value, null);
    assert.equal(
        Array.from(dom.select().options).some(
            (option) => option.value === 'Beta'
        ),
        false
    );
    assert.equal(f.binding.setValue('Beta').accepted, false);
    await act(async () => {
        f.owner.field('fld_title').setValue('Allowed');
    });
    await dom.choose('Beta');
    assert.equal(f.binding.getSnapshot().value, 'Beta');
});

it('blocked availability retains a persisted choice and permits explicit removal without inventing eligible options', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner(
        { enableConditionalOptions: true },
        'Alpha',
        (page) => {
            const mini = page.payload.fieldIdsToSchemas.choice
                .miniExtConfig as Record<string, unknown>;
            mini.conditionsForOptions = 'malformed';
        }
    );
    assert.equal(f.binding.getSnapshot().selectAvailability?.status, 'blocked');
    await dom.render(h(SingleSelectField, { binding: f.binding }));
    assert.equal(dom.select().disabled, false);
    assert.equal(dom.select().value, 'Alpha');
    assert.deepEqual(
        Array.from(dom.select().options, (o) => o.value),
        ['', 'Alpha']
    );
    await dom.click('Clear Decision');
    assert.equal(f.binding.getSnapshot().value, null);
});

it('missing or multiple selection authority cannot turn raw metadata into an editable picker', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner();
    const original = f.props();
    if (
        original.capability.type !== 'editable' ||
        !original.capability.selection
    )
        throw Error('Expected selection');
    let calls = 0;
    const setValue = () => {
        calls++;
        return { accepted: true as const };
    };
    for (const capability of [
        { type: 'readonly' as const },
        { type: 'editable' as const, setValue },
        {
            ...original.capability,
            setValue,
            selection: {
                ...original.capability.selection,
                state: {
                    ...original.capability.selection.state,
                    multiple: true,
                },
            },
        },
    ]) {
        await dom.render(renderSingleSelectField({ ...original, capability }));
        assert.equal(dom.select().disabled, true);
        await dom.choose('Beta');
        assert.equal(calls, 0);
        assert.equal(f.binding.getSnapshot().value, 'Alpha');
    }
});

for (const which of ['displayConfig', 'writeConfig'] as const)
    it(`${which} restrictions tighten editing and masked values expose no choice names`, async (t) => {
        const dom = await environment(t);
        const f = dom.makeOwner();
        const props = f.props();
        await dom.render(
            renderSingleSelectField({ ...props, [which]: { readOnly: true } })
        );
        assert.equal(dom.select().disabled, true);
        await dom.choose('Beta');
        assert.equal(f.binding.getSnapshot().value, 'Alpha');
        await dom.render(
            renderSingleSelectField({
                ...props,
                [which]: { maskPasswordOnLoginScreen: true },
            })
        );
        assert.equal(dom.container.querySelector('select,option'), null);
        assert.equal(dom.input().type, 'password');
        assert.equal(dom.input().disabled, true);
        assert.notEqual(dom.input().value, 'Alpha');
        assert.equal(dom.container.innerHTML.includes('Alpha'), false);
        assert.equal(dom.container.innerHTML.includes('Beta'), false);
        assert.equal(dom.container.innerHTML.includes('Exact'), false);
    });

it('pending, computed and disabled owner state block local changes while preserving values', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner();
    const props = f.props();
    if (props.capability.type !== 'editable' || !props.capability.selection)
        throw Error('Expected selection');
    for (const next of [
        { ...props, pending: true },
        { ...props, computed: true },
        {
            ...props,
            capability: {
                ...props.capability,
                selection: {
                    ...props.capability.selection,
                    state: {
                        ...props.capability.selection.state,
                        disabled: true,
                    },
                },
            },
        },
        {
            ...props,
            capability: {
                ...props.capability,
                selection: {
                    ...props.capability.selection,
                    state: {
                        ...props.capability.selection.state,
                        readOnly: true,
                    },
                },
            },
        },
    ]) {
        await dom.render(renderSingleSelectField(next));
        assert.equal(dom.select().disabled, true);
        await dom.choose('Beta');
        assert.equal(f.binding.getSnapshot().value, 'Alpha');
    }
});

it('custom binding rendering remains app-owned and Multiple Select retains its existing component', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner({}, 'Alpha', (page) => {
        const single = page.payload.fieldIdsToSchemas.choice;
        if (single.fieldType !== 'singleSelect') throw Error('Expected select');
        page.payload.fieldIdsInForm.push('multi');
        page.payload.fieldIdsToSchemas.multi = {
            ...single,
            fieldType: 'multipleSelects',
            airtableField: {
                ...single.airtableField,
                id: 'multi',
                config: { type: 'multipleSelects', options: { choices } },
            },
        };
        page.payload.formRecord.data.multi = ['Alpha', 'Beta'];
    });
    const multi = f.owner.field('multi');
    await dom.render(h(SingleSelectField, { binding: multi }));
    assert.equal(dom.container.querySelector('select'), null);
    await dom.render(
        h(SingleSelectField, {
            binding: multi,
            render: ({ binding, snapshot }) =>
                h(
                    'output',
                    null,
                    `${binding === multi}:${String(snapshot.value)}`
                ),
        })
    );
    assert.equal(dom.container.textContent, 'true:Alpha,Beta');
    await dom.render(h(SelectField, { binding: multi }));
    assert.equal(dom.select().multiple, true);
    assert.deepEqual(
        Array.from(dom.select().selectedOptions, (o) => o.value),
        ['Alpha', 'Beta']
    );
});

it('retained slot closures honor configuration retirement and hidden bindings remove controls', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner();
    const captured = f.props();
    await dom.render(renderSingleSelectField(captured));
    f.scope.revision++;
    await dom.choose('Beta');
    assert.equal(f.binding.getSnapshot().value, 'Alpha');
    f.scope.revision--;
    await dom.choose('Beta');
    assert.equal(
        f.binding.getSnapshot().value,
        'Alpha',
        'Observed A→B→A does not revive a retired host'
    );
    await dom.render(h(SingleSelectField, { binding: f.binding }));
    await act(async () => {
        f.scope.writable = false;
        f.owner.refresh();
    });
    assert.equal(dom.select().disabled, true);
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    assert.equal(dom.container.querySelector('select'), null);
    await act(async () => f.owner.destroy());
    assert.equal(dom.container.querySelector('select'), null);
});

it('choice creation requires explicit intent, preserves draft selection and never saves the Form', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner(
        { allowAddingNewOptions: true },
        'Alpha',
        undefined,
        true
    );
    const calls: string[] = [];
    f.client.forms.addSelectOption = async (input) => {
        calls.push(input.newChoiceText);
        return { newChoice: { id: 'created', name: 'Canonical response' } };
    };
    await dom.render(dom.tree(f.host));
    assert.equal(dom.button('Create choice').disabled, true);
    await dom.name('   ');
    assert.equal(dom.button('Create choice').disabled, true);
    await dom.name('  Exact intent  ');
    await act(async () => f.owner.refresh());
    assert.equal(
        dom.input().value,
        '  Exact intent  ',
        'Ordinary owner snapshots retain local intent'
    );
    assert.deepEqual(calls, []);
    await dom.click('Create choice');
    assert.deepEqual(calls, ['  Exact intent  ']);
    assert.equal(f.binding.getSnapshot().value, 'Canonical response');
    assert.equal(dom.select().value, 'Canonical response');
    assert.equal(dom.input().value, '');
    assert.equal(f.creator!.getSnapshot().phase, 'created-selected');
    assert.match(dom.container.textContent, /Save/);
});

it('pending creation can be cancelled and late success never becomes draft authority or clears typed intent', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner(
        { allowAddingNewOptions: true },
        'Alpha',
        undefined,
        true
    );
    const held = deferred<{ newChoice: SelectFieldChoice }>();
    let calls = 0;
    f.client.forms.addSelectOption = async () => {
        calls++;
        return held.promise;
    };
    await dom.render(h(SingleSelectField, { binding: f.binding }));
    await dom.name('Cancelled name');
    await dom.click('Create choice');
    assert.equal(dom.select().disabled, true);
    assert.equal(dom.input().disabled, true);
    assert.equal(dom.button('Cancel choice creation').disabled, false);
    await dom.click('Cancel choice creation');
    await act(async () =>
        held.resolve({ newChoice: { id: 'late', name: 'Cancelled name' } })
    );
    assert.equal(calls, 1);
    assert.equal(f.binding.getSnapshot().value, 'Alpha');
    assert.equal(dom.input().value, 'Cancelled name');
    assert.equal(f.creator!.getSnapshot().phase, 'uncertain');
    assert.equal(dom.button('Create choice').disabled, true);
});

it('a confirmed but conditionally unavailable choice reports its outcome without selecting or saving', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner(conditionalBeta, 'Alpha', undefined, true);
    let creates = 0;
    f.client.forms.addSelectOption = async () => {
        creates++;
        return { newChoice: { id: 'sel_beta', name: 'Beta' } };
    };
    await dom.render(dom.tree(f.host));
    await dom.name('Beta');
    await dom.click('Create choice');
    assert.equal(creates, 1);
    assert.equal(f.creator!.getSnapshot().phase, 'created-not-selected');
    assert.equal(f.binding.getSnapshot().value, 'Alpha');
    assert.equal(f.binding.getSnapshot().dirty, false);
    assert.match(dom.container.textContent, /not currently selectable/);
    assert.match(dom.container.textContent, /has not been saved/);
});

it('denied creation never dispatches and Enter in the choice editor does not implicitly create or submit', async (t) => {
    const dom = await environment(t);
    const denied = dom.makeOwner(
        { allowAddingNewOptions: false },
        'Alpha',
        undefined,
        true
    );
    let creates = 0,
        submits = 0;
    denied.client.forms.addSelectOption = async () => {
        creates++;
        throw Error('Denied creation');
    };
    await dom.render(h(SingleSelectField, { binding: denied.binding }));
    assert.equal(dom.input().disabled, true);
    assert.equal(dom.button('Create choice').disabled, true);
    await dom.click('Create choice');
    const accepted = dom.makeOwner(
        { allowAddingNewOptions: true },
        'Alpha',
        undefined,
        true
    );
    accepted.client.forms.addSelectOption = denied.client.forms.addSelectOption;
    await dom.render(
        h(
            'form',
            {
                onSubmit: (event: import('react').FormEvent) => {
                    event.preventDefault();
                    submits++;
                },
            },
            dom.tree(accepted.host)
        )
    );
    await dom.name('Unsubmitted intent');
    let prevented = false;
    await act(async () => {
        const enter = new dom.window.KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
        });
        dom.input().dispatchEvent(enter);
        prevented = enter.defaultPrevented;
    });
    assert.equal(prevented, true);
    assert.equal(creates, 0);
    assert.equal(submits, 0);
    assert.equal(accepted.binding.getSnapshot().value, 'Alpha');
});

it('standalone helpers retain the original props identity and retire fresh snapshots sharing the same actions', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner(
        { allowAddingNewOptions: true },
        'Alpha',
        undefined,
        true
    );
    const first = f.props();
    const second = { ...first };
    assert.notEqual(second, first);
    assert.equal(second.capability, first.capability);
    await dom.render(renderSingleSelectField(first));
    await dom.name('Local intent');
    assert.equal(dom.input().value, 'Local intent');
    assert.equal(dom.button('Create choice').disabled, false);
    await dom.render(renderSingleSelectField(first));
    assert.equal(
        dom.input().value,
        'Local intent',
        'Fresh transformed control props do not replace the original snapshot'
    );
    await dom.render(renderSingleSelectField(second));
    assert.equal(dom.input().value, '');
    assert.equal(dom.button('Create choice').disabled, true);
    await dom.name('Successor intent');
    await dom.render(renderSingleSelectField(first));
    assert.equal(
        dom.input().value,
        '',
        'A→B→A retires both earlier generations'
    );
    assert.equal(dom.button('Create choice').disabled, true);
    assert.equal(f.binding.getSnapshot().value, 'Alpha');
    assert.equal(f.binding.getSnapshot().dirty, false);
});

it('a late standalone creation completion cannot clear same-named input after an A→B→A snapshot replacement', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner(
        { allowAddingNewOptions: true },
        'Alpha',
        undefined,
        true
    );
    const props = f.props();
    if (props.capability.type !== 'editable' || !props.capability.choice)
        throw Error('Expected choice creation');
    const held = deferred<boolean>();
    const submitted: string[] = [];
    const first: FieldRendererProps<'singleSelect'> = {
        ...props,
        capability: {
            ...props.capability,
            choice: {
                ...props.capability.choice,
                create: (name) => {
                    submitted.push(name);
                    return held.promise;
                },
            },
        },
    };
    const second = { ...first };
    await dom.render(renderSingleSelectField(first));
    await dom.name('Shared name');
    await dom.click('Create choice');
    assert.deepEqual(submitted, ['Shared name']);
    await dom.render(renderSingleSelectField(second));
    assert.equal(dom.input().value, '');
    await dom.render(renderSingleSelectField(first));
    assert.equal(dom.input().value, '');
    await dom.name('Shared name');
    await act(async () => held.resolve(true));
    assert.equal(dom.input().value, 'Shared name');
    assert.equal(dom.button('Create choice').disabled, false);
    assert.deepEqual(submitted, ['Shared name']);
    assert.equal(f.binding.getSnapshot().value, 'Alpha');
    assert.equal(f.binding.getSnapshot().dirty, false);
});

it('host context outranks fresh standalone props and explicit source outranks host context', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner(
        { allowAddingNewOptions: true },
        'Alpha',
        undefined,
        true
    );
    const replacement = createFormFieldRendererHost({
        fields: f.owner,
        fieldId: 'choice',
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    dom.cleanups.push(() => replacement.dispose());
    const show = (host: FieldRendererHost, source?: object) =>
        dom.render(
            h(FieldRenderer, {
                host,
                renderers: {
                    renderSingleSelectField: (props) =>
                        renderSingleSelectField({ ...props }, { source }),
                },
            })
        );
    await show(f.host);
    await dom.name('Host intent');
    await show(f.host);
    assert.equal(dom.input().value, 'Host intent');
    await show(replacement);
    assert.equal(dom.input().value, '');
    const source = {};
    await show(replacement, source);
    await dom.name('Explicit intent');
    await show(f.host, source);
    assert.equal(dom.input().value, 'Explicit intent');
    assert.equal(f.binding.getSnapshot().value, 'Alpha');
    assert.equal(f.binding.getSnapshot().dirty, false);
});

it('standalone helpers retain intent with an explicit source and discard it across observed source replacement', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner(
        { allowAddingNewOptions: true },
        'Alpha',
        undefined,
        true
    );
    const first = {},
        second = {};
    await dom.render(
        renderSingleSelectField(f.props(), {
            source: first,
            emptyLabel: 'Choose one',
            clearLabel: 'Remove decision',
            className: 'custom-select',
        })
    );
    assert.equal(dom.select().options[0].textContent, 'Choose one');
    assert.ok(dom.container.querySelector('.custom-select'));
    assert.ok(dom.button('Remove decision'));
    await dom.name('Local intent');
    await act(async () => {
        f.owner.field('fld_title').setValue('New title');
    });
    await dom.render(renderSingleSelectField(f.props(), { source: first }));
    assert.equal(dom.input().value, 'Local intent');
    await dom.render(renderSingleSelectField(f.props(), { source: second }));
    assert.equal(dom.input().value, '');
    await dom.render(renderSingleSelectField(f.props(), { source: first }));
    assert.equal(dom.input().value, '');
    assert.equal(f.binding.getSnapshot().value, 'Alpha');
});

for (const mode of ['binding', 'slot'] as const)
    it(`${mode} replacement resets creation text and a late old completion cannot clear successor intent`, async (t) => {
        const dom = await environment(t);
        const first = dom.makeOwner(
            { allowAddingNewOptions: true },
            'Alpha',
            undefined,
            true
        );
        const second = dom.makeOwner(
            { allowAddingNewOptions: true },
            'Beta',
            undefined,
            true
        );
        const held = deferred<{ newChoice: SelectFieldChoice }>();
        first.client.forms.addSelectOption = async () => held.promise;
        const show = (f: typeof first) =>
            dom.render(
                mode === 'binding'
                    ? h(SingleSelectField, { binding: f.binding })
                    : dom.tree(f.host)
            );
        await show(first);
        await dom.name('Shared name');
        await dom.click('Create choice');
        await show(second);
        assert.equal(dom.input().value, '');
        await dom.name('Shared name');
        await act(async () =>
            held.resolve({ newChoice: { id: 'created', name: 'Shared name' } })
        );
        assert.equal(dom.input().value, 'Shared name');
        assert.equal(second.binding.getSnapshot().value, 'Beta');
        assert.equal(first.binding.getSnapshot().value, 'Shared name');
        await show(first);
        assert.equal(
            dom.input().value,
            '',
            'A→B→A cannot resurrect unfinished intent'
        );
        assert.equal(dom.select().value, 'Shared name');
    });

it('repeated controls keep label/status associations unique and contain row interaction without submitting', async (t) => {
    const dom = await environment(t);
    const f = dom.makeOwner({ required: true, showTitle: false }, 'Alpha');
    const props = {
        ...f.props(),
        title: ' ',
        error: '<img src=x> Review choice',
    };
    let rowEvents = 0,
        submits = 0;
    const row = () => {
        rowEvents++;
    };
    await dom.render(
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
            renderSingleSelectField(props),
            renderSingleSelectField(props)
        )
    );
    const ids = Array.from(
        dom.container.querySelectorAll('[id]'),
        (node) => node.id
    );
    assert.equal(new Set(ids).size, ids.length);
    for (const select of dom.container.querySelectorAll('select')) {
        assert.equal(select.getAttribute('aria-label'), 'Decision');
        assert.equal(select.getAttribute('aria-required'), 'true');
        assert.equal(select.getAttribute('aria-invalid'), 'true');
        const described = select.getAttribute('aria-describedby');
        assert.ok(described);
        assert.match(
            dom.window.document.getElementById(described)!.textContent,
            /Review choice/
        );
        await act(async () => {
            for (const type of [
                'click',
                'dblclick',
                'auxclick',
                'pointerdown',
                'keydown',
                'keyup',
            ])
                select.dispatchEvent(
                    new dom.window.Event(type, { bubbles: true })
                );
        });
    }
    await dom.choose('Beta');
    await dom.click('Clear Decision');
    assert.equal(rowEvents, 0);
    assert.equal(submits, 0);
    assert.equal(dom.container.querySelector('img'), null);
});

for (const layout of ['grid', 'list'] as const)
    it(`accepted Portal ${layout} uses the real host and ${layout === 'grid' ? 'requires explicit Save' : 'remains readonly'}`, async (t) => {
        const dom = await environment(t);
        const f = dom.makeOwner({}, 'Alpha');
        const schema = f.page.payload.fieldIdsToSchemas.choice;
        const detail = {
            fieldId: 'choice',
            fieldName: 'Decision',
            titleOverride: '',
            isHidden: false,
            fieldIsInEditingChildForm: true,
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
                                fields: { choice: 'Alpha' },
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
            getScope: () => ({ ownerId: 'single-select-portal', revision: 0 }),
        });
        await owner.readFirst(owner.getSnapshot().revision, {
            pagesToFetch: 1,
            refreshLoggedInPortalRecord: false,
        });
        let current = true;
        const writes: UpdateGridCellInput[] = [];
        api.client.portals.updateGridCell = async (input) => {
            writes.push(structuredClone(input));
            return {
                auditTrail: null,
                auditTrails: [],
                record: { id: 'record_1', fields: { choice: input.value } },
            } as UpdateGridCellResult;
        };
        const cell = createPortalCellBinding({
            client: api.client,
            schema,
            value: 'Alpha',
            input: {
                portalExtensionAccessToken: 'portal_access_example',
                portalFieldId: 'fld_children',
                recordId: 'record_1',
                recordFieldId: 'choice',
                selectedCustomViewId: 'view_example',
            },
            getScope: () => ({ ownerId: 'single-select-portal', revision: 0 }),
            isCurrent: () => current,
            recovery: {
                journal: new RecoveryJournal(),
                scope: {
                    owner: 'single-select-portal',
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
            isCurrent: () => current,
            configurationRevision: () => 0,
        };
        const host =
            layout === 'grid'
                ? createPortalCellRendererHost({
                      ...options,
                      cell,
                      fieldId: 'choice',
                  })
                : createPortalDetailRendererHost(options);
        dom.cleanups.push(() => {
            host.dispose();
            cell.destroy();
            owner.destroy();
            assert.equal(api.calls.length, 1);
            assert.equal(api.mutations, 0);
        });
        await dom.render(dom.tree(host));
        assert.equal(dom.select().value, 'Alpha');
        assert.equal(dom.select().disabled, layout === 'list');
        assert.equal(
            dom.container.querySelector('input'),
            null,
            'No invented Portal choice-creation controller'
        );
        await dom.choose('Beta');
        assert.equal(writes.length, 0);
        if (layout === 'grid') {
            assert.equal(cell.binding.getSnapshot().value, 'Beta');
            await dom.render(null);
            await dom.render(dom.tree(host));
            assert.equal(dom.select().value, 'Beta');
            await act(async () => {
                await cell.save();
            });
            assert.equal(writes.length, 1);
            assert.equal(writes[0].value, 'Beta');
        } else {
            assert.equal(cell.binding.getSnapshot().value, 'Alpha');
            assert.equal(writes.length, 0);
        }
        current = false;
        await dom.render(dom.tree(host));
        assert.equal(dom.container.querySelector('select'), null);
    });
