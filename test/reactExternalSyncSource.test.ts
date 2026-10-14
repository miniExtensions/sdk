import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    ExternalSyncSourceField,
    FieldRenderer,
    TextField,
    renderExternalSyncSourceField,
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
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

async function fixture(
    t: TestContext,
    config: FieldConfig<'externalSyncSource'> = {},
    initial: string | null | undefined = undefined,
    computed = true
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
    loaded.payload.fieldIdsInForm.push('source');
    if (initial !== undefined) loaded.payload.formRecord.data.source = initial;
    loaded.payload.fieldIdsToSchemas.source = {
        fieldType: 'externalSyncSource',
        airtableField: {
            id: 'source',
            name: 'Source label',
            description: null,
            isComputed: computed,
            isPrimaryField: false,
            config: {
                type: 'externalSyncSource',
                options: {
                    choices: [{ id: 'choice_known', name: 'Known source' }],
                },
            },
        },
        miniExtConfig: config,
    };
    let requests = 0;
    const scope = { current: true, visible: true, revision: 0 };
    const owner = createFormFieldBindings({
        loaded,
        saveOptions: formSaveOptions(),
        client: createMiniExtensionsClient({
            apiOrigin: 'https://synthetic.invalid',
            fetch: async () => {
                requests++;
                throw Error(
                    'External Sync Source presentation must not perform I/O'
                );
            },
        }),
        getScope: () => ({ ownerId: 'external-sync-source-test', revision: 0 }),
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('source');
    let writes = 0;
    const originalSetValue = binding.setValue;
    binding.setValue = (value) => {
        writes++;
        return originalSetValue(value);
    };
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'source',
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
                renderers: { renderExternalSyncSourceField },
                fallback: () => null,
            }),
        props: (): FieldRendererProps<'externalSyncSource'> => {
            const snapshot = host.getSnapshot();
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'externalSyncSource'
            )
                throw Error('External Sync Source props expected');
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
            throw Error('External Sync Source cannot borrow a setter');
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

for (const initial of [
    undefined,
    null,
    '',
    'unlisted source',
    '  東京 <b>sync</b> 🛰️  ',
])
    it(`preserves native ${JSON.stringify(initial)} through the readonly Form binding, slot and remount`, async (t) => {
        const f = await fixture(t, {}, initial);
        const before = f.binding.getSnapshot();
        assert.equal(before.readOnly, true);
        assert.equal(before.canEdit, false);
        assert.equal(f.binding.scalar, null);
        assert.equal(f.binding.selection, null);
        assert.equal(f.props().capability.type, 'readonly');
        for (const node of [
            h(ExternalSyncSourceField, {
                binding: f.binding,
                className: 'source',
                clearLabel: 'Keep source',
            }),
            f.tree(),
        ]) {
            await f.render(node);
            assert.equal(f.input().value, initial ?? '');
            assert.equal(f.input().disabled, true);
            assert.equal(f.input().type, 'text');
            assert.equal(f.container.querySelector('button')!.disabled, true);
            assert.equal(
                f.container.querySelector('select,[role=combobox],b'),
                null
            );
            await f.edit('replacement');
            await act(async () => f.container.querySelector('button')!.click());
            assert.equal(f.input().value, initial ?? '');
            await f.render(null);
        }
        await f.render(h(ExternalSyncSourceField, { binding: f.binding }));
        assert.equal(f.binding.getSnapshot().value, initial);
        assert.equal(f.binding.getSnapshot().revision, before.revision);
        assert.equal(f.binding.getSnapshot().dirty, false);
        assert.equal(
            Object.hasOwn(f.owner.controller.getState().draft!.data, 'source'),
            initial !== undefined
        );
        assert.equal(f.writes(), 0);
    });

it('direct helpers ignore capability and choice getters and never coerce malformed native values', async (t) => {
    const f = await fixture(t, {}, 'choice_known');
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
    } as FieldRendererProps<'externalSyncSource'>;
    for (const value of [
        'choice_known',
        '  raw label  ',
        '',
        null,
        undefined,
        42,
        false,
        { id: 'choice_known', name: 'Known source' },
        ['Known source'],
    ]) {
        Object.assign(forged, { value });
        await f.render(
            renderExternalSyncSourceField(forged, {
                className: 'static-source',
                clearLabel: 'Do not clear',
            })
        );
        assert.ok(
            f.container.querySelector('.mx-sdk-text-field.static-source')
        );
        assert.equal(f.input().value, typeof value === 'string' ? value : '');
        assert.equal(f.input().disabled, true);
        const clear = f.container.querySelector('button')!;
        assert.equal(clear.disabled, true);
        assert.equal(clear.getAttribute('aria-label'), 'Do not clear');
        await f.edit('new source');
        assert.equal(f.input().value, typeof value === 'string' ? value : '');
    }
    assert.equal(reads, 0);
    assert.equal(f.binding.getSnapshot().value, 'choice_known');
    assert.equal(f.writes(), 0);
});

it('keeps malformed isComputed-false Form bindings disabled and preserves the existing host rejection', async (t) => {
    const f = await fixture(t, {}, 'Supplied native', false);
    assert.equal(f.binding.getSnapshot().canEdit, true);
    assert.equal(f.binding.getSnapshot().readOnly, false);
    assert.deepEqual(f.host.getSnapshot(), {
        status: 'unavailable',
        reason: 'Field presentation is unavailable.',
    });
    await f.render(f.tree());
    assert.equal(f.container.querySelector('input'), null);
    await f.render(h(ExternalSyncSourceField, { binding: f.binding }));
    assert.equal(f.input().disabled, true);
    await f.edit('unauthorized draft');
    await act(async () => f.container.querySelector('button')!.click());
    assert.equal(f.input().value, 'Supplied native');
    assert.equal(f.binding.getSnapshot().value, 'Supplied native');
    assert.equal(f.writes(), 0);
});

it('metadata ID/name replacements and owner value updates are presentation only on the same binding', async (t) => {
    const f = await fixture(t, {}, 'choice_known');
    const initial = f.binding.getSnapshot();
    const pure = snapshotBinding(initial);
    let authorityReads = 0;
    for (const name of ['scalar', 'selection', 'setValue'])
        Object.defineProperty(pure.binding, name, {
            get() {
                authorityReads++;
                throw Error('No owner action is borrowed');
            },
        });
    await f.render(h(ExternalSyncSourceField, { binding: pure.binding }));
    const nativeInput = f.input();
    for (const choices of [
        [{ id: 'choice_known', name: 'Renamed choice' }],
        [{ id: 'new_id', name: 'choice_known' }],
        [],
    ]) {
        const next = structuredClone(initial);
        const metadata = next.field!.schema.airtableField.config;
        if (metadata.type !== 'externalSyncSource')
            throw Error('Expected source metadata');
        metadata.options.choices = choices;
        await act(async () => pure.update(next));
        assert.equal(f.input(), nativeInput);
        assert.equal(f.input().value, 'choice_known');
        assert.equal(pure.binding.getSnapshot().value, 'choice_known');
    }
    for (const value of [
        'Changed native',
        '',
        null,
        undefined,
        17,
        { error: 'Not a label' },
    ]) {
        await act(async () => pure.update({ ...initial, value }));
        assert.equal(f.input().value, typeof value === 'string' ? value : '');
        assert.equal(f.input().disabled, true);
        assert.equal(pure.binding.getSnapshot().value, value);
    }
    assert.equal(authorityReads, 0);
    assert.equal(pure.writes, 0);
});

it('disabled input, Clear and composition callbacks stay inert across replacement and unmount', async (t) => {
    const f = await fixture(t, {}, 'original');
    const initial = f.binding.getSnapshot();
    const pure = snapshotBinding({
        ...initial,
        canEdit: true,
        readOnly: false,
    });
    await f.render(h(ExternalSyncSourceField, { binding: pure.binding }));
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
    assert.equal(f.input().value, 'original');
    await act(async () => pure.update({ ...initial, value: 'successor' }));
    await act(async () => {
        input.value = 'late';
        retained.onChange(event);
        retained.onCompositionEnd(event);
        retainedClear({ stopPropagation() {} });
    });
    assert.equal(pure.binding.getSnapshot().value, 'successor');
    await f.render(null);
    await act(async () => {
        retained.onChange(event);
        retainedClear({ stopPropagation() {} });
    });
    await f.render(h(ExternalSyncSourceField, { binding: pure.binding }));
    assert.equal(f.input().value, 'successor');
    assert.equal(pure.writes, 0);
});

it('accepted synthetic metadata reload retires the old binding without remapping native strings', async (t) => {
    const f = await fixture(t, {}, 'choice_known');
    await f.render(h(ExternalSyncSourceField, { binding: f.binding }));
    const fresh = f.owner.getLoaded();
    const schema = fresh.payload.fieldIdsToSchemas.source;
    if (schema.fieldType !== 'externalSyncSource')
        throw Error('Expected source schema');
    schema.airtableField.config.options.choices = [
        { id: 'replacement', name: 'Renamed metadata' },
    ];
    await act(async () => {
        assert.equal(
            await f.owner.reload({ dirty: 'keep', read: async () => fresh }),
            true
        );
    });
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(f.binding.getSnapshot().retired, true);
    const successor = f.owner.field('source');
    assert.notEqual(successor, f.binding);
    assert.equal(successor.getSnapshot().readOnly, true);
    await f.render(h(ExternalSyncSourceField, { binding: successor }));
    assert.equal(f.input().value, 'choice_known');
    await f.edit('replacement');
    assert.equal(successor.getSnapshot().value, 'choice_known');
    assert.equal(successor.getSnapshot().dirty, false);
    assert.equal(f.writes(), 0);
});

it('associates unique labels, pending and plain feedback while preserving hidden titles and empty owner errors', async (t) => {
    const f = await fixture(t, { title: 'Sync source' }, 'raw');
    const props = {
        ...f.props(),
        pending: true,
        error: '<b>Owner feedback</b>',
    };
    await f.render(
        h(
            'div',
            null,
            renderExternalSyncSourceField(props),
            renderExternalSyncSourceField(props)
        )
    );
    const inputs = f.container.querySelectorAll('input');
    assert.notEqual(inputs[0].id, inputs[1].id);
    assert.equal(f.container.querySelector('label')!.htmlFor, inputs[0].id);
    assert.equal(
        f.container.querySelector('label')!.textContent,
        'Sync source'
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
            renderExternalSyncSourceField({
                ...f.props(),
                title: ' ',
                displayConfig: { showTitle: false },
                error,
                validation: [
                    {
                        fieldId: 'source',
                        fieldTitle: 'Source label',
                        errorMessage: 'Owner validation',
                    },
                ],
            })
        );
        assert.equal(f.container.querySelector('label'), null);
        assert.equal(f.input().getAttribute('aria-label'), 'Source label');
        assert.equal(
            f.container.querySelector('[role=status]')!.textContent,
            error === '' ? '' : 'Owner validation'
        );
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    }
});

it('honors display and write masking without exposing the supplied string in labels or feedback', async (t) => {
    const f = await fixture(
        t,
        { maskPasswordOnLoginScreen: true },
        'Secret source'
    );
    await f.render(h(ExternalSyncSourceField, { binding: f.binding }));
    assert.equal(f.input().type, 'password');
    for (const which of ['displayConfig', 'writeConfig'] as const) {
        await f.render(
            renderExternalSyncSourceField({
                ...f.props(),
                displayConfig: { showTitle: false },
                writeConfig: {},
                [which]: { maskPasswordOnLoginScreen: true, showTitle: false },
            })
        );
        assert.equal(f.input().type, 'password');
        assert.equal(f.input().disabled, true);
        assert.equal(f.input().value, 'Secret source');
        assert.equal(f.container.textContent?.includes('Secret source'), false);
        assert.equal(f.container.querySelector('label'), null);
        assert.equal(f.input().getAttribute('aria-label'), 'Source label');
    }
});

it('omits hidden and retired bindings, refuses other physical kinds, and prioritizes custom rendering', async (t) => {
    const f = await fixture(t, {}, 'source');
    const initial = f.binding.getSnapshot();
    const pure = snapshotBinding(initial);
    await f.render(h(ExternalSyncSourceField, { binding: pure.binding }));
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
    for (const next of [f.owner.field('fld_title').getSnapshot(), mismatched]) {
        await act(async () => pure.update(next));
        assert.equal(f.container.querySelector('input'), null);
        assert.equal(
            f.container.querySelector('[role=status]')!.textContent,
            'This control supports External Sync Source fields.'
        );
    }
    await act(async () => pure.update({ ...initial, retired: true }));
    await f.render(
        h(ExternalSyncSourceField, {
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
    await f.render(h(ExternalSyncSourceField, { binding: f.binding }));
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(pure.writes, 0);
});

it('contains control events and leaves a neighboring Text field editable with native clear semantics', async (t) => {
    const f = await fixture(t, {}, 'Fixed source');
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
            renderExternalSyncSourceField(f.props())
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
            h(ExternalSyncSourceField, { binding: f.binding }),
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
    assert.equal(f.binding.getSnapshot().value, 'Fixed source');
    assert.equal(f.writes(), 0);
});

for (const layout of ['grid', 'list'] as const)
    it(`uses readonly Portal ${layout} detail props without inline authority or additional reads`, async (t) => {
        const f = await fixture(t, {}, 'unlisted native');
        const schema = f.loaded.payload.fieldIdsToSchemas.source;
        const detail = {
            fieldId: 'source',
            fieldName: 'Source label',
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
                                fields: { source: 'unlisted native' },
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
            getScope: () => ({ ownerId: 'source-portal', revision: 0 }),
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
                    value: 'unlisted native',
                    input: {
                        portalExtensionAccessToken: 'portal_access_example',
                        portalFieldId: 'fld_children',
                        recordId: 'record_1',
                        recordFieldId: 'source',
                        selectedCustomViewId: 'view_example',
                    },
                    getScope: () => ({ ownerId: 'source-portal', revision: 0 }),
                    isCurrent: () => current,
                    recovery: {
                        journal: new RecoveryJournal(),
                        scope: {
                            owner: 'source-portal',
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
        assert.equal(state.fields[0].physicalKind, 'externalSyncSource');
        assert.equal(state.fields[0].computed, true);
        assert.equal(state.fields[0].capability.type, 'readonly');
        const tree = () =>
            h(FieldRenderer, {
                host,
                renderers: { renderExternalSyncSourceField },
                fallback: () => null,
            });
        await f.render(tree());
        assert.equal(f.input().disabled, true);
        assert.equal(f.input().value, 'unlisted native');
        assert.equal(f.container.querySelector('button')!.disabled, true);
        await f.edit('edited');
        assert.equal(f.input().value, 'unlisted native');
        await f.render(null);
        await f.render(tree());
        assert.equal(f.input().value, 'unlisted native');
        current = false;
        await f.render(tree());
        assert.equal(f.container.querySelector('input'), null);
        assert.equal(api.calls.length, 1);
        assert.equal(api.mutations, 0);
    });
