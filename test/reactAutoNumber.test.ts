import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    AutoNumberField,
    FieldRenderer,
    NumberField,
    renderAutoNumberField,
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
    config: FieldConfig<'autoNumber'> = {},
    initial: number | null | undefined = undefined
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
    loaded.payload.fieldIdsInForm.push('auto', 'number');
    if (initial !== undefined) loaded.payload.formRecord.data.auto = initial;
    loaded.payload.fieldIdsToSchemas.auto = {
        fieldType: 'autoNumber',
        airtableField: {
            id: 'auto',
            name: 'Record sequence',
            description: null,
            isComputed: true,
            isPrimaryField: false,
            config: { type: 'autoNumber', options: null },
        },
        miniExtConfig: config,
    };
    loaded.payload.fieldIdsToSchemas.number = {
        fieldType: 'number',
        airtableField: {
            id: 'number',
            name: 'Editable amount',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'number', options: { precision: 2 } },
        },
        miniExtConfig: {},
    };
    loaded.payload.formRecord.data.number = 2.5;
    let requests = 0;
    const scope = { current: true, visible: true, revision: 0 };
    const owner = createFormFieldBindings({
        loaded,
        saveOptions: formSaveOptions(),
        client: createMiniExtensionsClient({
            apiOrigin: 'https://synthetic.invalid',
            fetch: async () => {
                requests++;
                throw Error('AutoNumber presentation must not perform I/O');
            },
        }),
        getScope: () => ({ ownerId: 'autonumber-test', revision: 0 }),
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('auto');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'auto',
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
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        tree: () =>
            h(FieldRenderer, {
                host,
                renderers: { renderAutoNumberField },
                fallback: () => null,
            }),
        props: (): FieldRendererProps<'autoNumber'> => {
            const snapshot = host.getSnapshot();
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'autoNumber'
            )
                throw Error('AutoNumber props expected');
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
            throw Error('AutoNumber cannot borrow a setter');
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

for (const initial of [undefined, null, 0, 42, -0.125, 123456.7890123])
    it(`preserves native ${String(initial)} through the computed Form binding, slot and remount without generation`, async (t) => {
        const f = await fixture(t, {}, initial);
        const before = f.binding.getSnapshot();
        assert.equal(before.canEdit, false);
        assert.equal(before.readOnly, true);
        assert.equal(f.binding.scalar, null);
        assert.equal(f.binding.date, null);
        assert.equal(f.binding.selection, null);
        assert.equal(f.props().capability.type, 'readonly');
        for (const node of [
            h(AutoNumberField, { binding: f.binding, className: 'sequence' }),
            f.tree(),
        ]) {
            await f.render(node);
            assert.equal(
                f.input().value,
                initial == null ? '' : String(initial)
            );
            assert.equal(f.input().disabled, true);
            assert.equal(f.input().type, 'text');
            assert.equal(f.container.querySelector('button'), null);
            await f.edit('999');
            assert.equal(
                f.input().value,
                initial == null ? '' : String(initial)
            );
            await f.render(null);
        }
        await f.render(h(AutoNumberField, { binding: f.binding }));
        assert.equal(f.binding.getSnapshot().value, initial);
        assert.equal(f.binding.getSnapshot().dirty, false);
        assert.equal(f.binding.getSnapshot().revision, before.revision);
        assert.equal(
            Object.hasOwn(f.owner.controller.getState().draft!.data, 'auto'),
            initial !== undefined
        );
    });

it('always disables direct helper props and never reads or invokes a forged editable capability', async (t) => {
    const f = await fixture(t, {}, 7);
    let reads = 0;
    const forged = {
        ...f.props(),
        computed: false,
        get capability(): never {
            reads++;
            throw Error('AutoNumber has no action authority');
        },
    } as FieldRendererProps<'autoNumber'>;
    for (const value of [
        0,
        -3.25,
        1e21,
        null,
        undefined,
        NaN,
        Infinity,
        -Infinity,
    ]) {
        Object.assign(forged, { value });
        await f.render(
            renderAutoNumberField(forged, { className: 'static-number' })
        );
        assert.ok(
            f.container.querySelector('.mx-sdk-number-field.static-number')
        );
        assert.equal(f.input().disabled, true);
        assert.equal(
            f.input().value,
            typeof value === 'number' && Number.isFinite(value)
                ? String(value)
                : ''
        );
        await f.edit('1e2');
        assert.equal(f.binding.getSnapshot().value, 7);
    }
    assert.equal(reads, 0);
});

it('pure binding updates reflect the supplied number while retained callbacks and remounts cannot call its throwing setter', async (t) => {
    const f = await fixture(t, {}, 17);
    const initial = {
        ...f.binding.getSnapshot(),
        canEdit: true,
        readOnly: false,
    };
    const pure = snapshotBinding(initial);
    await f.render(h(AutoNumberField, { binding: pure.binding }));
    const oldInput = f.input();
    const reactKey = Object.keys(oldInput).find((key) =>
        key.startsWith('__reactProps$')
    )!;
    const retained = (
        oldInput as unknown as Record<
            string,
            { onChange(event: unknown): void }
        >
    )[reactKey].onChange;
    await act(async () =>
        pure.update({ ...initial, value: 29, pending: true })
    );
    assert.equal(f.input().value, '29');
    assert.equal(f.input().disabled, true);
    assert.equal(f.input().getAttribute('aria-busy'), 'true');
    await f.edit('30');
    await f.render(null);
    await act(async () =>
        retained({ currentTarget: oldInput, stopPropagation() {} })
    );
    await f.render(h(AutoNumberField, { binding: pure.binding }));
    assert.equal(f.input().value, '29');
    for (const value of [NaN, Infinity, -Infinity, '42', null, undefined]) {
        await act(async () => pure.update({ ...initial, value }));
        assert.equal(f.input().value, '');
        assert.equal(pure.binding.getSnapshot().value, value);
    }
    assert.equal(pure.writes, 0);
    assert.equal(pure.binding.scalar, null);
});

it('associates unique labels, pending and plain feedback while preserving empty errors and hidden titles', async (t) => {
    const f = await fixture(t, { title: 'Sequence' }, 123);
    const props = {
        ...f.props(),
        pending: true,
        error: '<b>Owner feedback</b>',
    };
    await f.render(
        h(
            'div',
            null,
            renderAutoNumberField(props),
            renderAutoNumberField(props)
        )
    );
    const inputs = f.container.querySelectorAll('input');
    assert.notEqual(inputs[0].id, inputs[1].id);
    assert.equal(f.container.querySelector('label')!.htmlFor, inputs[0].id);
    assert.equal(f.container.querySelector('label')!.textContent, 'Sequence');
    assert.equal(f.input().getAttribute('aria-busy'), 'true');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    const feedback = f.window.document.getElementById(
        f.input().getAttribute('aria-describedby')!
    )!;
    assert.equal(feedback.textContent, props.error);
    assert.equal(feedback.querySelector('b'), null);
    assert.equal(feedback.getAttribute('aria-live'), 'polite');
    const validation = [
        {
            fieldId: 'auto',
            fieldTitle: 'Sequence',
            errorMessage: 'Owner validation',
        },
    ];
    for (const error of ['', null]) {
        await f.render(
            renderAutoNumberField({
                ...f.props(),
                title: ' ',
                displayConfig: { showTitle: false },
                error,
                validation,
            })
        );
        assert.equal(f.container.querySelector('label'), null);
        assert.equal(f.input().getAttribute('aria-label'), 'Record sequence');
        assert.equal(
            f.container.querySelector('[role=status]')!.textContent,
            error === '' ? '' : 'Owner validation'
        );
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    }
});

it('honors masking on either configuration surface without echoing the native value', async (t) => {
    const f = await fixture(t, { maskPasswordOnLoginScreen: true }, 987654);
    await f.render(h(AutoNumberField, { binding: f.binding }));
    assert.equal(f.input().type, 'password');
    for (const which of ['displayConfig', 'writeConfig'] as const) {
        await f.render(
            renderAutoNumberField({
                ...f.props(),
                displayConfig: { showTitle: false },
                writeConfig: {},
                [which]: { maskPasswordOnLoginScreen: true, showTitle: false },
            })
        );
        assert.equal(f.input().type, 'password');
        assert.equal(f.input().disabled, true);
        assert.equal(f.input().value, '987654');
        assert.equal(f.container.textContent?.includes('987654'), false);
        assert.equal(f.container.querySelector('label'), null);
        assert.equal(f.input().getAttribute('aria-label'), 'Record sequence');
    }
});

it('omits hidden/retired bindings, refuses wrong physical kinds, and keeps custom rendering first', async (t) => {
    const f = await fixture(t, {}, 5);
    const initial = f.binding.getSnapshot();
    const pure = snapshotBinding(initial);
    await f.render(h(AutoNumberField, { binding: pure.binding }));
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
    const wrong = {
        ...f.owner.field('number').getSnapshot(),
        error: 'Wrong kind status',
    };
    await act(async () => pure.update(wrong));
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(
        f.container.querySelector('[role=status]')!.textContent,
        'Wrong kind status'
    );
    const mismatched = structuredClone(initial);
    mismatched.field!.schema.airtableField.config = {
        type: 'number',
        options: { precision: 2 },
    } as never;
    await act(async () =>
        pure.update({ ...mismatched, error: 'Mismatched physical metadata' })
    );
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(
        f.container.querySelector('[role=status]')!.textContent,
        'Mismatched physical metadata'
    );
    await act(async () => pure.update({ ...wrong, retired: true }));
    await f.render(
        h(AutoNumberField, {
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
    assert.equal(pure.writes, 0);
    await f.render(f.tree());
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    assert.equal(f.container.querySelector('input'), null);
    await act(async () => f.owner.destroy());
    await f.render(h(AutoNumberField, { binding: f.binding }));
    assert.equal(f.container.querySelector('input'), null);
});

it('contains control events without adding actions and leaves a neighboring Number field editable', async (t) => {
    const f = await fixture(t, {}, 10);
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
            renderAutoNumberField(f.props())
        )
    );
    const wrapper = f.container.querySelector('.mx-sdk-number-field')!;
    await act(async () => {
        for (const type of [
            'click',
            'dblclick',
            'auxclick',
            'pointerdown',
            'keydown',
            'keyup',
            'compositionstart',
            'compositionend',
        ])
            wrapper.dispatchEvent(new f.window.Event(type, { bubbles: true }));
    });
    await f.edit('99');
    assert.equal(rows, 0);
    assert.equal(f.binding.getSnapshot().value, 10);
    const number = f.owner.field('number');
    await f.render(
        h(
            'div',
            null,
            h(AutoNumberField, { binding: f.binding }),
            h(NumberField, { binding: number })
        )
    );
    const inputs = f.container.querySelectorAll('input');
    assert.equal(inputs[0].disabled, true);
    assert.equal(inputs[1].disabled, false);
    await f.edit('3.125', inputs[1]);
    assert.equal(number.getSnapshot().value, 3.125);
    await f.edit('1e', inputs[1]);
    assert.equal(inputs[1].value, '1e');
    assert.equal(number.getSnapshot().value, 3.125);
    assert.equal(f.binding.getSnapshot().value, 10);
});

for (const layout of ['grid', 'list'] as const)
    it(`uses actual readonly computed Portal ${layout} detail props without cell/edit authority or extra reads`, async (t) => {
        const f = await fixture(t, {}, 81);
        const schema = f.loaded.payload.fieldIdsToSchemas.auto;
        const detail = {
            fieldId: 'auto',
            fieldName: 'Record sequence',
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
                            record_1: { id: 'record_1', fields: { auto: 81 } },
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
            getScope: () => ({ ownerId: 'autonumber-portal', revision: 0 }),
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
        if (state.status !== 'ready') throw Error('Portal props expected');
        assert.equal(state.fields[0].physicalKind, 'autoNumber');
        assert.equal(state.fields[0].computed, true);
        assert.equal(state.fields[0].capability.type, 'readonly');
        const tree = () =>
            h(FieldRenderer, {
                host,
                renderers: { renderAutoNumberField },
                fallback: () => null,
            });
        await f.render(tree());
        assert.equal(f.input().disabled, true);
        assert.equal(f.input().value, '81');
        await f.edit('82');
        assert.equal(f.input().value, '81');
        await f.render(null);
        await f.render(tree());
        assert.equal(f.input().value, '81');
        current = false;
        await f.render(tree());
        assert.equal(f.container.querySelector('input'), null);
        assert.equal(api.calls.length, 1);
        assert.equal(api.mutations, 0);
    });
