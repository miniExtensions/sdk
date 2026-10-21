import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    FormulaField,
    FieldRenderer,
    NumberField,
    renderFormulaField,
    AirtableForm,
    AirtableGrid,
    AirtableList,
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
    FieldRendererProps,
    FieldMetadata,
} from '../src/ui/rendererRegistry.js';
import type { AirtableValue } from '../src/runtime/types.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

type Result = NonNullable<
    FieldMetadata<'formula'>['config']['options']['result']
>;
const number = { type: 'number', options: { precision: 2 } } as const;
const text: Result = { type: 'singleLineText', options: null };
const date: Result = {
    type: 'date',
    options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
};
const collaborator = {
    id: 'usr_private',
    name: 'Ada',
    email: 'secret@example.invalid',
    profilePicUrl: 'https://secret.invalid/avatar',
};
const cases: [Result, AirtableValue | undefined, string][] = [
    [number, 1.23456, '1.23'],
    [number, 0, '0.00'],
    [number, null, ''],
    [number, undefined, ''],
    [
        text,
        '<img src="https://secret.invalid" onerror="alert(1)">\n**literal**',
        '<img src="https://secret.invalid" onerror="alert(1)">\n**literal**',
    ],
    [number, [1.234, null, -2.345], '1.23, -2.35'],
    [text, ['a', '', 'b'], 'a, , b'],
    [{ type: 'percent', options: { precision: 1 } }, 0.1256, '12.6%'],
    [
        { type: 'currency', options: { symbol: '$', precision: 2 } },
        -1234.567,
        '-$1,234.57',
    ],
    [
        { type: 'duration', options: { durationFormat: 'h:mm:ss.SS' } },
        -3680.4,
        '-1:01:20.40',
    ],
    [date, '2026-10-15', '2026-10-15'],
    [
        {
            type: 'dateTime',
            options: {
                dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                timeFormat: { name: '24hour', format: 'HH:mm' },
                timeZone: 'utc',
            },
        },
        '2026-10-15T20:30:00.000Z',
        '2026-10-15 20:30',
    ],
    [
        { type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
        true,
        'true',
    ],
    [
        { type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
        false,
        '',
    ],
    [
        {
            type: 'rating',
            options: { max: 5, icon: 'star', color: 'yellowBright' },
        },
        3,
        '3',
    ],
    [
        { type: 'count', options: { isValid: true, recordLinkFieldId: null } },
        7,
        '7',
    ],
    [{ type: 'autoNumber', options: null }, 42, '42'],
    [
        { type: 'singleSelect', options: { choices: [] } },
        'Native choice',
        'Native choice',
    ],
    [{ type: 'multipleSelects', options: { choices: [] } }, ['a', 'b'], 'a, b'],
    [
        { type: 'singleCollaborator', options: { choices: [] } },
        collaborator,
        'Ada',
    ],
    [
        { type: 'multipleCollaborators', options: { choices: [] } },
        [collaborator],
        'Ada',
    ],
    [{ type: 'createdBy', options: { choices: [] } }, collaborator, 'Ada'],
    [{ type: 'lastModifiedBy', options: { choices: [] } }, collaborator, 'Ada'],
    [
        { type: 'createdTime', options: { result: date } },
        '2026-10-15',
        '2026-10-15',
    ],
    [
        { type: 'lastModifiedTime', options: { isValid: true, result: date } },
        '2026-10-15',
        '2026-10-15',
    ],
    [{ type: 'barcode', options: null }, { text: 'code', type: 'qr' }, 'code'],
    [
        { type: 'button', options: null },
        { url: 'https://example.invalid', label: 'Go' },
        'https://example.invalid',
    ],
    [
        { type: 'externalSyncSource', options: { choices: [] } },
        'Native source',
        'Native source',
    ],
    [
        { type: 'aiText', options: {} },
        { state: 'generated', value: 'Supplied answer', isStale: false },
        'Supplied answer',
    ],
    [
        { type: 'multipleAttachments', options: { isReversed: false } },
        [{ filename: 'file.txt', url: 'https://example.invalid/file' }],
        'file.txt (https://example.invalid/file)',
    ],
    [
        {
            type: 'multipleRecordLinks',
            options: {
                linkedTableId: 'private',
                isReversed: false,
                prefersSingleRecordLink: false,
            },
        },
        ['rec12345678901234', 'Supplied label'],
        'Unavailable, Supplied label',
    ],
    [
        {
            type: 'multipleLookupValues',
            options: {
                isValid: true,
                result: number,
                recordLinkFieldId: 'link',
                fieldIdInLinkedTable: 'value',
            },
        },
        [1, 2],
        '1.00, 2.00',
    ],
    [
        { type: 'rollup', options: { isValid: true, result: number } },
        2.345,
        '2.35',
    ],
    [
        { type: 'formula', options: { isValid: true, result: number } },
        2.345,
        '2.35',
    ],
    [number, { error: '#ERROR!' }, '#ERROR!'],
    [number, [{ error: '#ERROR!' }, 1], '#ERROR!, 1.00'],
    [number, { specialValue: 'NaN' }, 'NaN'],
    [number, { specialValue: 'Infinity' }, 'Infinity'],
    [number, { specialValue: '-Infinity' }, '-Infinity'],
    [number, [1, { specialValue: 'NaN' }], '1.00, NaN'],
];
for (const type of [
    'email',
    'url',
    'phoneNumber',
    'multilineText',
    'richText',
] as const)
    cases.push([
        { type, options: null },
        type === 'richText' ? '**Hello**' : 'native text',
        type === 'richText' ? 'Hello' : 'native text',
    ]);

async function fixture(
    t: TestContext,
    result: Result = number,
    initial: AirtableValue | undefined = 1.23456,
    missing = false
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
    loaded.payload.fieldIdsInForm.push('formula', 'number');
    if (!missing && initial !== undefined)
        loaded.payload.formRecord.data.formula = initial;
    loaded.payload.fieldIdsToSchemas.formula = {
        fieldType: 'formula',
        airtableField: {
            id: 'formula',
            name: 'Computed answer',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'formula', options: { isValid: true, result } },
        },
        miniExtConfig: {},
    };
    loaded.payload.fieldIdsToSchemas.number = {
        fieldType: 'number',
        airtableField: {
            id: 'number',
            name: 'Neighbor',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: number,
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
                throw Error('No Formula I/O');
            },
        }),
        getScope: () => ({ ownerId: 'formula', revision: 0 }),
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('formula');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'formula',
        isCurrent: () => scope.current,
        configurationRevision: () => 0,
    });
    t.after(async () => {
        await act(async () => root.unmount());
        host.dispose();
        owner.destroy();
        keys.forEach((key, i) => {
            if (originals[i])
                Object.defineProperty(globalThis, key, originals[i]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
        assert.equal(requests, 0);
    });
    return {
        window,
        container,
        binding,
        loaded,
        owner,
        host,
        scope,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        props: () => {
            const state = host.getSnapshot();
            if (
                state.status !== 'ready' ||
                state.fields[0].physicalKind !== 'formula'
            )
                throw Error('Formula props expected');
            return state.fields[0];
        },
        tree: () =>
            h(FieldRenderer, {
                host,
                renderers: { renderFormulaField },
                fallback: () => null,
            }),
        output: () => {
            const output = container.querySelector('output');
            assert.ok(output);
            return output;
        },
    };
}

for (const [index, [result, value, expected]] of cases.entries())
    it(`formats supplied Formula result ${index}: ${result.type} without changing its native answer`, async (t) => {
        const f = await fixture(t, result, value, value === undefined);
        const before = f.binding.getSnapshot();
        assert.equal(before.canEdit, false);
        assert.equal(f.props().capability.type, 'readonly');
        for (const node of [
            h(FormulaField, { binding: f.binding }),
            f.tree(),
        ]) {
            await f.render(node);
            assert.equal(f.output().textContent, expected);
            assert.equal(
                f.container.querySelector(
                    'input,button,a,img,iframe,object,embed'
                ),
                null
            );
            assert.equal(
                f.container.innerHTML.includes('secret@example.invalid'),
                false
            );
            assert.deepEqual(f.binding.getSnapshot().value, before.value);
            assert.equal(f.binding.getSnapshot().dirty, before.dirty);
            await f.render(null);
        }
    });

it('rejects malformed direct values and metadata without displaying exception details', async (t) => {
    const f = await fixture(t);
    for (const value of [
        NaN,
        Infinity,
        {},
        { error: 3 },
        { specialValue: 'other' },
        [undefined],
        [[1]],
        new Array(2),
        'wrong numeric value',
    ]) {
        await f.render(
            renderFormulaField({
                ...f.props(),
                value,
            } as FieldRendererProps<'formula'>)
        );
        assert.equal(f.output().textContent, 'Unavailable');
        assert.equal(f.output().getAttribute('aria-invalid'), 'true');
    }
    const malformed = structuredClone(f.props());
    (malformed.field.config.options as unknown as { result: unknown }).result =
        { type: 'number', options: { precision: 200 } };
    await f.render(renderFormulaField(malformed));
    assert.equal(f.output().textContent, 'Unavailable');
    for (const options of [
        { result: null },
        { isValid: false, result: null },
        { isValid: true, result: null },
    ]) {
        const props = f.props();
        Object.assign(props.field.config, { options });
        await f.render(renderFormulaField(props));
        assert.equal(f.output().textContent, '');
    }
    assert.equal(f.binding.getSnapshot().value, 1.23456);
});

it('ignores forged capabilities, physical/computed hints and special presentation modes', async (t) => {
    const f = await fixture(t, text, '<script>secret()</script>');
    const props = f.props();
    Object.defineProperty(props, 'capability', {
        get() {
            throw Error('Do not borrow capabilities');
        },
    });
    Object.assign(props, {
        computed: false,
        presentation: { type: 'physical', config: number },
        displayConfig: {
            renderFormulaAsHTML: true,
            renderFormulaAsAttachment: true,
            displayAsButton: true,
        },
    });
    await f.render(renderFormulaField(props));
    assert.equal(f.output().textContent, '<script>secret()</script>');
    assert.equal(f.container.querySelector('script,a,img,input,button'), null);
});

it('masks before conversion from either configuration and either masking flag', async (t) => {
    const f = await fixture(t, text, 'private native value');
    for (const surface of ['displayConfig', 'writeConfig'] as const)
        for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen']) {
            const props = f.props();
            Object.assign(props, { [surface]: { [flag]: true } });
            Object.defineProperty(props.field, 'config', {
                get() {
                    throw Error('Masked values must not be formatted');
                },
            });
            await f.render(renderFormulaField(props));
            assert.equal(f.output().textContent, '••••••••');
            assert.equal(
                f.container.innerHTML.includes('private native value'),
                false
            );
        }
});

it('associates unique labels, title fallback, hidden title, pending and plain-text feedback', async (t) => {
    const f = await fixture(t);
    const props = {
        ...f.props(),
        title: ' ',
        pending: true,
        error: '<b>error</b>',
    };
    await f.render(
        h('div', null, renderFormulaField(props), renderFormulaField(props))
    );
    const outputs = f.container.querySelectorAll('output');
    assert.notEqual(outputs[0].id, outputs[1].id);
    for (const output of outputs) {
        assert.equal(
            f.container.querySelector(`label[for="${output.id}"]`)?.textContent,
            'Computed answer'
        );
        assert.equal(output.getAttribute('aria-busy'), 'true');
        assert.equal(
            f.container.querySelector(
                `[id="${output.getAttribute('aria-describedby')}"]`
            )?.textContent,
            '<b>error</b>'
        );
    }
    assert.equal(f.container.querySelector('b'), null);
    await f.render(
        renderFormulaField({
            ...props,
            displayConfig: { showTitle: false },
            error: '',
            validation: [
                {
                    fieldId: 'formula',
                    fieldTitle: 'Formula',
                    errorMessage: 'must not replace empty error',
                },
            ],
        })
    );
    assert.equal(f.container.querySelector('label'), null);
    assert.equal(f.output().getAttribute('aria-label'), 'Computed answer');
    assert.equal(f.output().hasAttribute('aria-describedby'), false);
    await f.render(
        renderFormulaField({
            ...props,
            error: null,
            validation: [
                {
                    fieldId: 'formula',
                    fieldTitle: 'Formula',
                    errorMessage: 'Validation',
                },
            ],
        })
    );
    assert.equal(
        f.container.querySelector('[role=status]')?.textContent,
        'Validation'
    );
});

it('keeps custom rendering first, omits hidden/retired bindings and refuses wrong kinds', async (t) => {
    const f = await fixture(t);
    await f.render(h(FormulaField, { binding: f.owner.field('number') }));
    assert.match(f.container.textContent!, /supports Formula/);
    await f.render(
        h(FormulaField, {
            binding: f.binding,
            render: ({ snapshot, binding }) =>
                h('b', null, `${snapshot.value}:${binding === f.binding}`),
        })
    );
    assert.equal(f.container.textContent, '1.23456:true');
    await f.render(f.tree());
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    assert.equal(f.container.querySelector('output'), null);
    await act(async () => f.owner.destroy());
    await f.render(h(FormulaField, { binding: f.binding }));
    assert.equal(f.container.querySelector('output'), null);
});

it('reflects same-binding updates and replacements without ever reading binding actions', async (t) => {
    const f = await fixture(t);
    let snapshot = f.binding.getSnapshot();
    const listeners = new Set<(value: FormFieldSnapshot) => void>();
    const binding: FormFieldBinding = {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        setValue() {
            throw Error('No Formula setter');
        },
        get scalar(): never {
            throw Error('No scalar');
        },
        get date(): never {
            throw Error('No date');
        },
        get selection(): never {
            throw Error('No selection');
        },
    };
    await f.render(h(FormulaField, { binding }));
    assert.equal(f.output().textContent, '1.23');
    await act(async () => {
        snapshot = { ...snapshot, value: 3.456 };
        for (const listener of listeners) listener(snapshot);
    });
    assert.equal(f.output().textContent, '3.46');
    await f.render(h(FormulaField, { binding: f.binding }));
    assert.equal(f.output().textContent, '1.23');
    await act(async () => {
        snapshot = { ...snapshot, value: 99 };
        for (const listener of listeners) listener(snapshot);
    });
    assert.equal(f.output().textContent, '1.23');
    await f.render(h(FormulaField, { binding }));
    assert.equal(f.output().textContent, '99.00');
});

it('contains row interaction and keeps an editable Number neighbor functional', async (t) => {
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
            h(FormulaField, { binding: f.binding }),
            h(NumberField, { binding: f.owner.field('number') })
        )
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
            f.output().dispatchEvent(
                new f.window.Event(type, { bubbles: true })
            );
    });
    assert.equal(rows, 0);
    const formScope = createFormRenderScope({
        fields: f.owner,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => formScope.destroy());
    await f.render(
        h(AirtableForm, {
            scope: formScope,
            renderers: { renderFormulaField },
            children: (state) =>
                state.fields
                    .filter((field) => field.fieldId === 'formula')
                    .map((field) => field.node),
        })
    );
    assert.equal(f.output().textContent, '1.23');
    await f.render(
        h(
            'div',
            null,
            h(FormulaField, { binding: f.binding }),
            h(NumberField, { binding: f.owner.field('number') })
        )
    );
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
    assert.equal(f.binding.getSnapshot().value, 1.23456);
});

for (const layout of ['grid', 'list'] as const)
    it(`uses accepted Portal ${layout} details without computed inline editing or added requests`, async (t) => {
        const f = await fixture(t);
        const schema = f.loaded.payload.fieldIdsToSchemas.formula;
        const detail = {
            fieldId: 'formula',
            fieldName: 'Computed answer',
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
                                fields: { formula: 1.23456 },
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
            getScope: () => ({ ownerId: 'formula-portal', revision: 0 }),
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
        if (state.status !== 'ready') throw Error('Expected Portal host');
        assert.equal(state.fields[0].capability.type, 'readonly');
        const tree = () =>
            h(FieldRenderer, {
                host,
                renderers: { renderFormulaField },
                fallback: () => null,
            });
        await f.render(tree());
        assert.equal(f.output().textContent, '1.23');
        const portalScope = createPortalRenderScope({
            owner,
            client: api.client,
            isCurrent: () => current,
            configurationRevision: () => 0,
        });
        t.after(() => portalScope.destroy());
        const Component = layout === 'grid' ? AirtableGrid : AirtableList;
        await f.render(
            h(Component, {
                scope: portalScope,
                renderers: { renderFormulaField },
                children: (state) =>
                    state.rows.flatMap((row) =>
                        row.cells.map((cell) => cell.node)
                    ),
            })
        );
        assert.equal(f.output().textContent, '1.23');
        current = false;
        await f.render(tree());
        assert.equal(f.container.querySelector('output'), null);
    });

it('keeps shared admission and nested array-conversion gaps explicit without changing contracts', async (t) => {
    const f = await fixture(t);
    const props = f.props();
    props.field.config.options = {
        isValid: true,
        result: { type: 'manualSort', options: null },
    };
    await f.render(renderFormulaField(props));
    assert.equal(f.output().textContent, 'Unavailable');
    props.field.config.options = {
        isValid: true,
        result: {
            type: 'formula',
            options: {
                isValid: true,
                result: { type: 'multipleSelects', options: { choices: [] } },
            },
        },
    };
    await f.render(renderFormulaField({ ...props, value: ['a', 'b'] }));
    assert.equal(f.output().textContent, 'Unavailable');
    props.field.config.options = { isValid: false, result: null };
    await f.render(
        renderFormulaField({ ...props, value: { error: '#ERROR!' } })
    );
    assert.equal(f.output().textContent, '#ERROR!');
    assert.equal(f.binding.getSnapshot().value, 1.23456);
});
