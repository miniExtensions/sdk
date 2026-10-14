import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export const countReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    CountField, renderCountField, AirtableForm, AirtableGrid, AirtableList,
    type CountFieldProps, type CountFieldOptions, type NumberFieldOptions,
} from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/number.css';
const options: CountFieldOptions = { className: 'count-consumer' };
const sharedOptions: NumberFieldOptions = options;
// @ts-expect-error Count has no Clear control.
const clear: CountFieldOptions = { clearLabel: 'Clear count' };
// @ts-expect-error A presentation option cannot grant computed write authority.
const setter: CountFieldOptions = { setValue: (value: number) => {} };
// @ts-expect-error Count does not impose a numeric range.
const range: CountFieldOptions = { min: 0 };
export const renderers: FieldRendererSlots<ReactNode> = {
    renderCountField: props => renderCountField(props, sharedOptions),
};
export function BoundCount(props: CountFieldProps) {
    return <CountField {...props} {...options} />;
}
export function Override(props: CountFieldProps) {
    return <CountField {...props} render={({ snapshot }) => <span>{String(snapshot.value ?? '')}</span>} />;
}
export function checkKinds(count: FieldRendererProps<'count'>, number: FieldRendererProps<'number'>, autoNumber: FieldRendererProps<'autoNumber'>) {
    renderCountField(count);
    const readonlyCapability: { type: 'readonly' } = count.capability;
    // @ts-expect-error An editable Number slot is not a Count slot.
    renderCountField(number);
    // @ts-expect-error AutoNumber is a distinct physical kind.
    renderCountField(autoNumber);
    // @ts-expect-error Count cannot expose an editable capability.
    const editable: FieldRendererProps<'count'>['capability'] = { type: 'editable', setValue: () => ({ accepted: true }) };
    // @ts-expect-error Count has no scalar capability.
    count.capability.scalar;
    return readonlyCapability;
}
export function Compositions({ form, portal }: { form: FormRenderScope; portal: PortalRenderScope }) {
    return <>
        <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
        <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
        <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
    </>;
}
`;

/** Installed read-only Count presentation against synthetic accepted owners. */
export async function checkCountConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    let requests = 0;
    window.fetch = () => {
        requests++;
        throw Error('No Count request');
    };
    const keys = [
        'window',
        'document',
        'navigator',
        'fetch',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        });
    const { createElement: h, act, StrictMode, Fragment } = require('react');
    const { createRoot } = require('react-dom/client');
    let checks = 0;
    try {
        assert.match(
            readFileSync(
                require.resolve('@miniextensions/sdk/react/number.css'),
                'utf8'
            ),
            /\.mx-sdk-number:focus-visible/
        );
        assert.throws(
            () => require.resolve('@miniextensions/sdk/react/count.css'),
            { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }
        );
        for (const format of ['esm', 'cjs']) {
            const load = (name) =>
                format === 'cjs'
                    ? require(`@miniextensions/sdk/${name}`)
                    : import(
                          pathToFileURL(
                              join(
                                  consumerDirectory,
                                  `node_modules/@miniextensions/sdk/dist/esm/${name}/index.js`
                              )
                          )
                      );
            const [ui, forms, portals, react] = await Promise.all(
                ['ui', 'forms', 'portals', 'react'].map(load)
            );
            assert.equal(typeof react.CountField, 'function');
            assert.equal(typeof react.renderCountField, 'function');
            assert.equal(ui.renderCountField, undefined);
            const loaded = fixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.publicFields.state = {
                ...loaded.payload.publicFields.state,
                multiPageFormMode: 'multi-page',
                promptUserBeforeSubmission: false,
                enableFormComputeMode: false,
                autoSubmitAfterPrefill: false,
            };
            loaded.payload.fieldIdsInForm = [
                'count',
                'empty',
                'missing',
                'replacement',
                'number',
            ];
            for (const [id, value] of [
                ['count', 42.125],
                ['empty', null],
                ['missing', undefined],
                ['replacement', -9.25],
                ['number', 17],
            ]) {
                const kind = id === 'number' ? 'number' : 'count';
                if (value === undefined)
                    delete loaded.payload.formRecord.data[id];
                else loaded.payload.formRecord.data[id] = value;
                loaded.payload.fieldIdsToSchemas[id] = {
                    fieldType: kind,
                    airtableField: {
                        id,
                        name: id === 'number' ? 'Number' : 'Count',
                        description: null,
                        isPrimaryField: false,
                        isComputed: kind === 'count',
                        config: {
                            type: kind,
                            options:
                                kind === 'number'
                                    ? { precision: 2 }
                                    : {
                                          isValid: true,
                                          recordLinkFieldId: null,
                                      },
                        },
                    },
                    miniExtConfig: {},
                };
            }
            const client = {
                getSession: () => ({}),
                forms: {
                    save: async () => {
                        requests++;
                        throw Error('No Count Save');
                    },
                },
            };
            const fields = forms.createFormFieldBindings({
                loaded,
                client,
                getScope: () => ({ ownerId: 'count-consumer', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            let current = true;
            let host = ui.createFormFieldRendererHost({
                fields,
                fieldId: 'count',
                isCurrent: () => current,
                configurationRevision: () => 0,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            let destroyed = false;
            const cleanup = [];
            try {
                let binding = fields.field('count');
                let writes = 0,
                    capabilityReads = 0,
                    capabilityActions = 0;
                const trapSetter = () => {
                    binding.setValue = () => {
                        writes++;
                        throw Error('Count setter must not be borrowed');
                    };
                };
                trapSetter();
                const input = () => container.querySelector('input');
                const edit = async (value, node = input()) =>
                    act(async () => {
                        Object.getOwnPropertyDescriptor(
                            window.HTMLInputElement.prototype,
                            'value'
                        ).set.call(node, value);
                        node.dispatchEvent(
                            new window.Event('input', { bubbles: true })
                        );
                    });
                const tree = () =>
                    h(
                        StrictMode,
                        null,
                        h(react.FieldRenderer, {
                            host,
                            renderers: {
                                renderCountField: react.renderCountField,
                            },
                            fallback: () => null,
                        })
                    );
                const before = fields.controller.getState().draftRevision;
                await act(async () => root.render(tree()));
                assert.equal(input().value, '42.125');
                assert.equal(input().disabled, true);
                assert.equal(binding.scalar, null);
                assert.deepEqual(host.getSnapshot().fields[0].capability, {
                    type: 'readonly',
                });
                await edit('100');
                assert.equal(input().value, '42.125');
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(binding.getSnapshot().value, 42.125);
                assert.equal(
                    fields.controller.getState().draftRevision,
                    before
                );
                assert.equal(writes, 0);
                checks++;

                let props = host.getSnapshot().fields[0];
                for (const value of [
                    0,
                    -0,
                    -3.75,
                    1e21,
                    1e-7,
                    1234.56789,
                    null,
                    undefined,
                    NaN,
                    Infinity,
                    -Infinity,
                    '12',
                ]) {
                    await act(async () =>
                        root.render(react.renderCountField({ ...props, value }))
                    );
                    assert.equal(
                        input().value,
                        typeof value === 'number' && Number.isFinite(value)
                            ? String(value)
                            : ''
                    );
                    assert.equal(input().disabled, true);
                    assert.equal(
                        container.querySelector(
                            'button,progress,[role=slider],input[type=number]'
                        ),
                        null
                    );
                    assert.equal(binding.getSnapshot().value, 42.125);
                }
                for (const [id, native] of [
                    ['empty', null],
                    ['missing', undefined],
                ]) {
                    let empty;
                    await act(async () => {
                        empty = fields.field(id);
                    });
                    await act(async () =>
                        root.render(h(react.CountField, { binding: empty }))
                    );
                    assert.equal(input().value, '');
                    await act(async () => root.render(null));
                    await act(async () =>
                        root.render(h(react.CountField, { binding: empty }))
                    );
                    assert.equal(empty.getSnapshot().value, native);
                }
                checks++;

                // A nonempty native value does not override invalid Count metadata.
                for (const options of [
                    { isValid: false, recordLinkFieldId: null },
                    null,
                    undefined,
                    {},
                    { isValid: 'true' },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderCountField({
                                ...props,
                                value: 42,
                                field: {
                                    ...props.field,
                                    config: { type: 'count', options },
                                },
                            })
                        )
                    );
                    assert.equal(input().value, '');
                    assert.equal(input().disabled, true);
                }
                const originalOwner = fields;
                for (const options of [
                    { isValid: false, recordLinkFieldId: null },
                    null,
                    undefined,
                    { isValid: true, recordLinkFieldId: null },
                ]) {
                    const next = fields.getLoaded();
                    next.payload.formRecord.data.count = 42;
                    next.payload.fieldIdsToSchemas.count.airtableField.config =
                        { type: 'count', options };
                    await act(async () => {
                        assert.equal(
                            await fields.reload({
                                dirty: 'discard',
                                read: async () => next,
                            }),
                            true
                        );
                    });
                    await act(async () => {
                        host.dispose();
                        host = ui.createFormFieldRendererHost({
                            fields,
                            fieldId: 'count',
                            isCurrent: () => current,
                            configurationRevision: () => 0,
                        });
                        binding = fields.field('count');
                        trapSetter();
                    });
                    assert.equal(
                        host.getSnapshot().status,
                        options == null ? 'unavailable' : 'ready'
                    );
                    await act(async () =>
                        root.render(h(react.CountField, { binding }))
                    );
                    assert.equal(fields, originalOwner);
                    assert.equal(
                        input().value,
                        options?.isValid === true ? '42' : ''
                    );
                    assert.equal(binding.getSnapshot().value, 42);
                    assert.equal(binding.scalar, null);
                }
                props = host.getSnapshot().fields[0];
                checks++;

                const forged = {
                    type: 'editable',
                    setValue: () => {
                        capabilityActions++;
                        throw Error('No raw Count write');
                    },
                };
                Object.defineProperty(forged, 'scalar', {
                    get() {
                        capabilityReads++;
                        throw Error('No Count scalar authority');
                    },
                });
                await act(async () =>
                    root.render(
                        react.renderCountField({
                            ...props,
                            value: 7.125,
                            computed: false,
                            capability: forged,
                        })
                    )
                );
                await edit('8');
                await act(async () => {
                    for (const type of ['change', 'blur'])
                        input().dispatchEvent(
                            new window.Event(type, { bubbles: true })
                        );
                    for (const type of ['compositionstart', 'compositionend'])
                        input().dispatchEvent(
                            new window.CompositionEvent(type, { bubbles: true })
                        );
                    input().dispatchEvent(
                        new window.KeyboardEvent('keydown', {
                            key: 'ArrowUp',
                            bubbles: true,
                        })
                    );
                });
                assert.equal(input().value, '7.125');
                assert.equal(input().disabled, true);
                assert.equal(capabilityReads, 0);
                assert.equal(capabilityActions, 0);
                assert.equal(writes, 0);
                checks++;

                for (const side of ['displayConfig', 'writeConfig']) {
                    await act(async () =>
                        root.render(
                            react.renderCountField({
                                ...props,
                                displayConfig: { showTitle: false },
                                [side]: {
                                    showTitle: false,
                                    maskPasswordOnLoginScreen: true,
                                },
                                error: '<b>Unavailable</b>',
                            })
                        )
                    );
                    assert.equal(input().type, 'password');
                    assert.equal(input().getAttribute('aria-label'), 'Count');
                    assert.equal(container.querySelector('label,b'), null);
                    assert.equal(
                        window.document.getElementById(
                            input().getAttribute('aria-describedby')
                        ).textContent,
                        '<b>Unavailable</b>'
                    );
                }
                await act(async () =>
                    root.render(
                        h(
                            Fragment,
                            null,
                            react.renderCountField(props),
                            react.renderCountField(props)
                        )
                    )
                );
                const inputs = [...container.querySelectorAll('input')];
                assert.equal(new Set(inputs.map((node) => node.id)).size, 2);
                for (const node of inputs)
                    assert.ok(
                        container.querySelector(`label[for="${node.id}"]`)
                    );
                checks++;

                await act(async () =>
                    root.render(
                        react.renderCountField({
                            ...props,
                            title: '  ',
                            pending: true,
                            error: null,
                            validation: [
                                { errorMessage: 'First problem' },
                                { errorMessage: 'Second problem' },
                            ],
                        })
                    )
                );
                assert.equal(input().getAttribute('aria-busy'), 'true');
                assert.equal(input().getAttribute('aria-invalid'), 'true');
                assert.equal(input().disabled, true);
                assert.equal(
                    container.querySelector('label').textContent,
                    'Count'
                );
                assert.equal(
                    container.querySelector('[role=status]').textContent,
                    'First problem\nSecond problem'
                );
                await act(async () =>
                    root.render(
                        react.renderCountField({
                            ...props,
                            error: '',
                            validation: [{ errorMessage: 'Suppressed' }],
                        })
                    )
                );
                assert.equal(
                    container.querySelector('[role=status]').textContent,
                    ''
                );
                assert.equal(input().getAttribute('aria-describedby'), null);
                checks++;

                await act(async () =>
                    root.render(
                        h(react.CountField, { binding, className: 'consumer' })
                    )
                );
                assert.ok(
                    container.querySelector('.consumer.mx-sdk-number-field')
                );
                let number;
                await act(async () => {
                    number = fields.field('number');
                });
                await act(async () =>
                    root.render(h(react.CountField, { binding: number }))
                );
                assert.equal(input(), null);
                assert.ok(container.querySelector('[role=status]'));
                assert.equal(container.textContent.includes('17'), false);
                await act(async () =>
                    root.render(
                        h(react.CountField, {
                            binding: number,
                            render: ({ snapshot }) =>
                                h('output', null, `Custom ${snapshot.value}`),
                        })
                    )
                );
                assert.equal(container.textContent, 'Custom 17');
                await act(async () =>
                    root.render(h(react.NumberField, { binding: number }))
                );
                assert.equal(input().disabled, false);
                await edit('7.125');
                assert.equal(number.getSnapshot().value, 7.125);
                assert.equal(binding.getSnapshot().value, 42);
                checks++;

                await act(async () =>
                    root.render(h(react.CountField, { binding }))
                );
                const heldInput = input();
                let replacement;
                await act(async () => {
                    replacement = fields.field('replacement');
                });
                await act(async () =>
                    root.render(h(react.CountField, { binding: replacement }))
                );
                await edit('100', heldInput);
                assert.equal(input().value, '-9.25');
                assert.equal(binding.getSnapshot().value, 42);
                assert.equal(replacement.getSnapshot().value, -9.25);
                for (const visibility of [
                    { type: 'hidden' },
                    { type: 'blocked', code: 'invalid', diagnostics: [] },
                ]) {
                    const hidden = {
                        ...binding,
                        getSnapshot: () => ({
                            ...binding.getSnapshot(),
                            visibility,
                        }),
                        subscribe: (notify) =>
                            binding.subscribe((snapshot) =>
                                notify({ ...snapshot, visibility })
                            ),
                    };
                    await act(async () =>
                        root.render(h(react.CountField, { binding: hidden }))
                    );
                    assert.equal(input(), null);
                }
                await act(async () => root.render(tree()));
                current = false;
                await act(async () => root.render(tree()));
                assert.equal(input(), null);
                current = true;
                checks++;

                const formScope = ui.createFormRenderScope({
                    fields,
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                });
                cleanup.push(() => formScope.destroy());
                await act(async () =>
                    root.render(
                        h(
                            react.AirtableForm,
                            {
                                scope: formScope,
                                renderers: {
                                    renderCountField: react.renderCountField,
                                },
                            },
                            (state) =>
                                state.fields
                                    .filter(
                                        (field) => field.fieldId === 'count'
                                    )
                                    .map((field) => field.node)
                        )
                    )
                );
                assert.equal(input().value, '42');
                assert.equal(input().disabled, true);
                assert.equal(requests, 0);
                checks++;

                const countField =
                    loaded.payload.fieldIdsToSchemas.count.airtableField;
                const portal = fixtures.makePortal();
                portal.payload.initialLinkedTableStates.tbl_children.airtableFields =
                    [countField];
                const details = [
                    {
                        fieldId: 'count',
                        fieldName: 'Count',
                        titleOverride: null,
                        isHidden: false,
                        fieldIsInEditingChildForm: false,
                        childFormField: null,
                        miniExtConfig: {},
                    },
                ];
                portal.payload.linkedRecordFieldIdToDetailFields.fld_children =
                    details;
                let reads = 0,
                    portalWrites = 0;
                const portalClient = {
                    getSession: () => ({}),
                    portals: {
                        listLinkedRecords: async () => {
                            reads++;
                            return fixtures.page(
                                [{ id: 'rec_count', fields: { count: 42 } }],
                                null,
                                {
                                    customViewDetailFields: {
                                        fld_children: details,
                                    },
                                    tableIdsToLinkedTableStates: {
                                        tbl_children: {
                                            airtableFields: [countField],
                                            recordIdsToAirtableRecords: {
                                                rec_count: {
                                                    id: 'rec_count',
                                                    fields: { count: 42 },
                                                },
                                            },
                                        },
                                    },
                                }
                            );
                        },
                        updateGridCell: async () => {
                            portalWrites++;
                            throw Error('No computed inline write');
                        },
                    },
                };
                const owner = portals.createPortalListOwner({
                    client: portalClient,
                    portal,
                    portalFieldId: 'fld_children',
                    criteria: {
                        selectedCustomViewId: 'view_example',
                        searchTerm: null,
                        searchParamsMap: {},
                        sortFieldsByEndUser: null,
                        filtersByEndUser: null,
                        supportsEndUserSortCleanup: true,
                        supportsEndUserFilterCleanup: true,
                    },
                    getScope: () => ({ ownerId: 'count-portal', revision: 0 }),
                });
                cleanup.push(() => owner.destroy());
                const portalScope = ui.createPortalRenderScope({
                    owner,
                    client: portalClient,
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                });
                cleanup.push(() => portalScope.destroy());
                assert.equal(reads, 0);
                assert.equal(
                    await portalScope.getSnapshot().actions.load({
                        pagesToFetch: 1,
                        refreshLoggedInPortalRecord: false,
                    }),
                    true
                );
                const detailProps = portalScope
                    .getSnapshot()
                    .rows[0].cells[0].host.getSnapshot().fields[0];
                assert.equal(detailProps.context, 'portal-detail');
                assert.deepEqual(detailProps.capability, { type: 'readonly' });
                for (const Component of [
                    react.AirtableGrid,
                    react.AirtableList,
                ]) {
                    await act(async () =>
                        root.render(
                            h(
                                Component,
                                {
                                    scope: portalScope,
                                    renderers: {
                                        renderCountField:
                                            react.renderCountField,
                                    },
                                },
                                (state) =>
                                    state.rows.flatMap((row) =>
                                        row.cells.map((cell) => cell.node)
                                    )
                            )
                        )
                    );
                    assert.equal(input().value, '42');
                    assert.equal(input().disabled, true);
                    await edit('100');
                    assert.equal(input().value, '42');
                    assert.equal(reads, 1);
                    assert.equal(portalWrites, 0);
                }
                await act(async () =>
                    root.render(h(react.CountField, { binding }))
                );
                await act(async () => {
                    fields.destroy();
                    destroyed = true;
                });
                assert.equal(input(), null);
                assert.equal(writes, 0);
                assert.equal(capabilityReads, 0);
                assert.equal(capabilityActions, 0);
                assert.equal(requests, 0);
                checks++;
            } finally {
                await act(async () => root.unmount());
                for (const dispose of cleanup.reverse()) dispose();
                host.dispose();
                if (!destroyed) fields.destroy();
                container.remove();
            }
        }
        return { checks };
    } finally {
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}
