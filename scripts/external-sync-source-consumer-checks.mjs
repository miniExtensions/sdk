import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export const externalSyncSourceReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    ExternalSyncSourceField, renderExternalSyncSourceField, AirtableForm, AirtableGrid, AirtableList,
    type ExternalSyncSourceFieldProps, type ExternalSyncSourceFieldOptions, type TextFieldOptions,
} from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/text.css';
const options: ExternalSyncSourceFieldOptions = { className: 'source-consumer', clearLabel: 'Clear source' };
const sharedOptions: TextFieldOptions = options;
// @ts-expect-error Appearance options cannot grant computed write authority.
const setter: ExternalSyncSourceFieldOptions = { setValue: (value: string) => {} };
// @ts-expect-error The renderer does not accept a choice resolver.
const resolver: ExternalSyncSourceFieldOptions = { resolveChoice: (id: string) => id };
export const renderers: FieldRendererSlots<ReactNode> = {
    renderExternalSyncSourceField: props => renderExternalSyncSourceField(props, sharedOptions),
};
export function BoundSource(props: ExternalSyncSourceFieldProps) {
    return <ExternalSyncSourceField {...props} {...options} />;
}
export function Override(props: ExternalSyncSourceFieldProps) {
    return <ExternalSyncSourceField {...props} render={({ snapshot }) => <span>{String(snapshot.value ?? '')}</span>} />;
}
export function checkKinds(source: FieldRendererProps<'externalSyncSource'>, text: FieldRendererProps<'singleLineText'>, select: FieldRendererProps<'singleSelect'>) {
    renderExternalSyncSourceField(source);
    const readonlyCapability: { type: 'readonly' } = source.capability;
    const native: string | null | undefined = source.value;
    // @ts-expect-error An editable text slot is not an External Sync Source slot.
    renderExternalSyncSourceField(text);
    // @ts-expect-error Select metadata does not make this a select renderer.
    renderExternalSyncSourceField(select);
    // @ts-expect-error External Sync Source cannot expose an editable capability.
    const editable: FieldRendererProps<'externalSyncSource'>['capability'] = { type: 'editable', setValue: () => ({ accepted: true }) };
    // @ts-expect-error External Sync Source has no selection capability.
    source.capability.selection;
    // @ts-expect-error The accepted SDK value is a string, not a raw Airtable object.
    const objectValue: FieldRendererProps<'externalSyncSource'>['value'] = { id: 'source_a', name: 'Source A' };
    return { readonlyCapability, native };
}
export function Compositions({ form, portal }: { form: FormRenderScope; portal: PortalRenderScope }) {
    return <>
        <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
        <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
        <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
    </>;
}
`;

/** Installed SDK string presentation with synthetic owners and no external transport. */
export async function checkExternalSyncSourceConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    let requests = 0;
    window.fetch = () => {
        requests++;
        throw Error('No source requests');
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
                require.resolve('@miniextensions/sdk/react/text.css'),
                'utf8'
            ),
            /\.mx-sdk-text:focus-visible/
        );
        assert.throws(
            () =>
                require.resolve(
                    '@miniextensions/sdk/react/external-sync-source.css'
                ),
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
            assert.equal(typeof react.ExternalSyncSourceField, 'function');
            assert.equal(
                typeof react.renderExternalSyncSourceField,
                'function'
            );
            assert.equal(ui.renderExternalSyncSourceField, undefined);
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
                'source',
                'empty',
                'missing',
                'replacement',
                'text',
            ];
            for (const [id, value] of [
                ['source', 'Unlisted source Ω'],
                ['empty', null],
                ['missing', undefined],
                ['replacement', 'Replacement source'],
                ['text', 'Editable neighbor'],
            ]) {
                const kind =
                    id === 'text' ? 'singleLineText' : 'externalSyncSource';
                if (value === undefined)
                    delete loaded.payload.formRecord.data[id];
                else loaded.payload.formRecord.data[id] = value;
                loaded.payload.fieldIdsToSchemas[id] = {
                    fieldType: kind,
                    airtableField: {
                        id,
                        name: id === 'text' ? 'Text' : 'Source',
                        description: null,
                        isPrimaryField: false,
                        isComputed: kind === 'externalSyncSource',
                        config: {
                            type: kind,
                            options:
                                kind === 'singleLineText'
                                    ? null
                                    : {
                                          choices: [
                                              {
                                                  id: 'source_a',
                                                  name: 'Known source',
                                              },
                                          ],
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
                        throw Error('No source Save');
                    },
                },
            };
            const bindingOptions = {
                client,
                getScope: () => ({ ownerId: 'source-consumer', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            };
            const fields = forms.createFormFieldBindings({
                loaded,
                ...bindingOptions,
            });
            let current = true;
            let host = ui.createFormFieldRendererHost({
                fields,
                fieldId: 'source',
                isCurrent: () => current,
                configurationRevision: () => 0,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            const cleanup = [];
            let destroyed = false;
            try {
                let binding = fields.field('source');
                let writes = 0,
                    capabilityReads = 0,
                    capabilityActions = 0;
                const trapSetter = () => {
                    binding.setValue = () => {
                        writes++;
                        throw Error(
                            'Readonly source setter must not be borrowed'
                        );
                    };
                };
                trapSetter();
                const input = () => container.querySelector('input');
                const clear = () => container.querySelector('button');
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
                                renderExternalSyncSourceField:
                                    react.renderExternalSyncSourceField,
                            },
                            fallback: () => null,
                        })
                    );
                const before = fields.controller.getState().draftRevision;
                await act(async () => root.render(tree()));
                assert.equal(input().value, 'Unlisted source Ω');
                assert.equal(input().disabled, true);
                assert.equal(clear().disabled, true);
                assert.equal(clear().type, 'button');
                assert.equal(binding.scalar, null);
                assert.equal(binding.selection, null);
                assert.deepEqual(host.getSnapshot().fields[0].capability, {
                    type: 'readonly',
                });
                await edit('Replacement');
                await act(async () =>
                    clear().dispatchEvent(
                        new window.MouseEvent('click', { bubbles: true })
                    )
                );
                assert.equal(input().value, 'Unlisted source Ω');
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(binding.getSnapshot().value, 'Unlisted source Ω');
                assert.equal(
                    fields.controller.getState().draftRevision,
                    before
                );
                assert.equal(writes, 0);
                checks++;

                let props = host.getSnapshot().fields[0];
                for (const value of [
                    'Unknown source',
                    'source_a',
                    'Known source',
                    '  spaced Ω  ',
                    '<img src=x>',
                    'https://example.test/source',
                    '',
                    null,
                    undefined,
                    42,
                    false,
                    ['Source'],
                    { id: 'source_a', name: 'Known source' },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderExternalSyncSourceField({
                                ...props,
                                value,
                            })
                        )
                    );
                    assert.equal(
                        input().value,
                        typeof value === 'string' ? value : ''
                    );
                    assert.equal(input().disabled, true);
                    assert.equal(clear().disabled, true);
                    assert.equal(
                        container.querySelector('a,img,select,[role=combobox]'),
                        null
                    );
                    assert.equal(
                        binding.getSnapshot().value,
                        'Unlisted source Ω'
                    );
                }
                let objectReads = 0;
                const objectValue = {
                    get name() {
                        objectReads++;
                        throw Error('No object label extraction');
                    },
                    toString() {
                        objectReads++;
                        throw Error('No object coercion');
                    },
                };
                await act(async () =>
                    root.render(
                        react.renderExternalSyncSourceField({
                            ...props,
                            value: objectValue,
                        })
                    )
                );
                assert.equal(input().value, '');
                assert.equal(objectReads, 0);
                for (const [id, native] of [
                    ['empty', null],
                    ['missing', undefined],
                ]) {
                    let empty;
                    await act(async () => {
                        empty = fields.field(id);
                    });
                    await act(async () =>
                        root.render(
                            h(react.ExternalSyncSourceField, { binding: empty })
                        )
                    );
                    assert.equal(input().value, '');
                    await act(async () => root.render(null));
                    await act(async () =>
                        root.render(
                            h(react.ExternalSyncSourceField, { binding: empty })
                        )
                    );
                    assert.equal(empty.getSnapshot().value, native);
                }
                checks++;

                const originalOwner = fields;
                for (const choices of [
                    [{ id: 'source_a', name: 'Renamed choice' }],
                    [],
                    [
                        {
                            id: 'Unlisted source Ω',
                            name: 'Must not replace native label',
                        },
                    ],
                ]) {
                    const next = fields.getLoaded();
                    next.payload.fieldIdsToSchemas.source.airtableField.config.options =
                        { choices };
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
                            fieldId: 'source',
                            isCurrent: () => current,
                            configurationRevision: () => 0,
                        });
                        binding = fields.field('source');
                        trapSetter();
                    });
                    assert.equal(host.getSnapshot().status, 'ready');
                    await act(async () =>
                        root.render(
                            h(react.ExternalSyncSourceField, { binding })
                        )
                    );
                    assert.equal(fields, originalOwner);
                    assert.equal(input().value, 'Unlisted source Ω');
                    assert.equal(
                        binding.getSnapshot().value,
                        'Unlisted source Ω'
                    );
                    assert.equal(binding.scalar, null);
                    assert.equal(binding.selection, null);
                }
                props = host.getSnapshot().fields[0];
                checks++;

                const forged = { type: 'editable' };
                for (const key of ['scalar', 'selection', 'setValue'])
                    Object.defineProperty(forged, key, {
                        get() {
                            capabilityReads++;
                            throw Error(`No borrowed ${key}`);
                        },
                    });
                await act(async () =>
                    root.render(
                        react.renderExternalSyncSourceField({
                            ...props,
                            value: 'Opaque source',
                            computed: false,
                            capability: forged,
                        })
                    )
                );
                await edit('Changed');
                await act(async () => {
                    clear().dispatchEvent(
                        new window.MouseEvent('click', { bubbles: true })
                    );
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
                            key: 'Enter',
                            bubbles: true,
                        })
                    );
                });
                const forgedBinding = {
                    ...binding,
                    getSnapshot: () => binding.getSnapshot(),
                    subscribe: (notify) => binding.subscribe(notify),
                };
                for (const key of ['scalar', 'selection', 'date'])
                    Object.defineProperty(forgedBinding, key, {
                        get() {
                            capabilityReads++;
                            throw Error(`No binding model ${key}`);
                        },
                    });
                forgedBinding.setValue = () => {
                    capabilityActions++;
                    throw Error('No direct binding write');
                };
                await act(async () =>
                    root.render(
                        h(react.ExternalSyncSourceField, {
                            binding: forgedBinding,
                        })
                    )
                );
                await edit('Changed');
                await act(async () =>
                    clear().dispatchEvent(
                        new window.MouseEvent('click', { bubbles: true })
                    )
                );
                assert.equal(input().value, 'Unlisted source Ω');
                assert.equal(input().disabled, true);
                assert.equal(capabilityReads, 0);
                assert.equal(capabilityActions, 0);
                assert.equal(writes, 0);
                checks++;

                for (const side of ['displayConfig', 'writeConfig']) {
                    await act(async () =>
                        root.render(
                            react.renderExternalSyncSourceField(
                                {
                                    ...props,
                                    displayConfig: { showTitle: false },
                                    [side]: {
                                        showTitle: false,
                                        maskPasswordOnLoginScreen: true,
                                    },
                                    error: '<b>Unavailable</b>',
                                },
                                {
                                    className: 'source-consumer',
                                    clearLabel: 'Clear supplied source',
                                }
                            )
                        )
                    );
                    assert.equal(input().type, 'password');
                    assert.equal(input().getAttribute('aria-label'), 'Source');
                    assert.equal(
                        clear().getAttribute('aria-label'),
                        'Clear supplied source'
                    );
                    assert.equal(clear().disabled, true);
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
                            react.renderExternalSyncSourceField(props),
                            react.renderExternalSyncSourceField(props)
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
                        react.renderExternalSyncSourceField({
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
                assert.equal(clear().disabled, true);
                assert.equal(
                    container.querySelector('label').textContent,
                    'Source'
                );
                assert.equal(
                    container.querySelector('[role=status]').textContent,
                    'First problem\nSecond problem'
                );
                await act(async () =>
                    root.render(
                        react.renderExternalSyncSourceField({
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
                        h(react.ExternalSyncSourceField, {
                            binding,
                            className: 'consumer',
                        })
                    )
                );
                assert.ok(
                    container.querySelector('.consumer.mx-sdk-text-field')
                );
                let text;
                await act(async () => {
                    text = fields.field('text');
                });
                await act(async () =>
                    root.render(
                        h(react.ExternalSyncSourceField, { binding: text })
                    )
                );
                assert.equal(input(), null);
                assert.ok(container.querySelector('[role=status]'));
                assert.equal(
                    container.textContent.includes('Editable neighbor'),
                    false
                );
                await act(async () =>
                    root.render(
                        h(react.ExternalSyncSourceField, {
                            binding: text,
                            render: ({ snapshot }) =>
                                h('output', null, `Custom ${snapshot.value}`),
                        })
                    )
                );
                assert.equal(container.textContent, 'Custom Editable neighbor');
                await act(async () =>
                    root.render(h(react.TextField, { binding: text }))
                );
                assert.equal(input().disabled, false);
                assert.equal(clear().disabled, false);
                await edit('Edited neighbor');
                assert.equal(text.getSnapshot().value, 'Edited neighbor');
                assert.equal(binding.getSnapshot().value, 'Unlisted source Ω');
                checks++;

                await act(async () =>
                    root.render(h(react.ExternalSyncSourceField, { binding }))
                );
                const heldInput = input();
                let replacement;
                await act(async () => {
                    replacement = fields.field('replacement');
                });
                await act(async () =>
                    root.render(
                        h(react.ExternalSyncSourceField, {
                            binding: replacement,
                        })
                    )
                );
                await edit('Changed', heldInput);
                assert.equal(input().value, 'Replacement source');
                assert.equal(binding.getSnapshot().value, 'Unlisted source Ω');
                assert.equal(
                    replacement.getSnapshot().value,
                    'Replacement source'
                );
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
                        root.render(
                            h(react.ExternalSyncSourceField, {
                                binding: hidden,
                            })
                        )
                    );
                    assert.equal(input(), null);
                }
                await act(async () => root.render(tree()));
                current = false;
                await act(async () => root.render(tree()));
                assert.equal(input(), null);
                current = true;
                checks++;

                let formScope;
                await act(async () => {
                    formScope = ui.createFormRenderScope({
                        fields,
                        isCurrent: () => true,
                        configurationRevision: () => 0,
                    });
                });
                cleanup.push(() => formScope.destroy());
                await act(async () =>
                    root.render(
                        h(
                            react.AirtableForm,
                            {
                                scope: formScope,
                                renderers: {
                                    renderExternalSyncSourceField:
                                        react.renderExternalSyncSourceField,
                                },
                            },
                            (state) =>
                                state.fields
                                    .filter(
                                        (field) => field.fieldId === 'source'
                                    )
                                    .map((field) => field.node)
                        )
                    )
                );
                assert.equal(input().value, 'Unlisted source Ω');
                assert.equal(input().disabled, true);
                const malformed = structuredClone(loaded);
                malformed.payload.fieldIdsToSchemas.source.airtableField.isComputed = false;
                const falseFields = forms.createFormFieldBindings({
                    loaded: malformed,
                    ...bindingOptions,
                });
                cleanup.push(() => falseFields.destroy());
                const falseBinding = falseFields.field('source');
                const falseHost = ui.createFormFieldRendererHost({
                    fields: falseFields,
                    fieldId: 'source',
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                });
                cleanup.push(() => falseHost.dispose());
                assert.equal(falseHost.getSnapshot().status, 'unavailable');
                falseBinding.setValue = () => {
                    writes++;
                    throw Error(
                        'Computed metadata cannot grant wrapper editing'
                    );
                };
                await act(async () =>
                    root.render(
                        h(react.ExternalSyncSourceField, {
                            binding: falseBinding,
                        })
                    )
                );
                assert.equal(input().disabled, true);
                await edit('Changed');
                assert.equal(
                    falseBinding.getSnapshot().value,
                    'Unlisted source Ω'
                );
                assert.equal(requests, 0);
                checks++;

                const sourceField =
                    loaded.payload.fieldIdsToSchemas.source.airtableField;
                const portal = fixtures.makePortal();
                portal.payload.initialLinkedTableStates.tbl_children.airtableFields =
                    [sourceField];
                const details = [
                    {
                        fieldId: 'source',
                        fieldName: 'Source',
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
                                [
                                    {
                                        id: 'rec_source',
                                        fields: {
                                            source: 'Unknown portal source',
                                        },
                                    },
                                ],
                                null,
                                {
                                    customViewDetailFields: {
                                        fld_children: details,
                                    },
                                    tableIdsToLinkedTableStates: {
                                        tbl_children: {
                                            airtableFields: [sourceField],
                                            recordIdsToAirtableRecords: {
                                                rec_source: {
                                                    id: 'rec_source',
                                                    fields: {
                                                        source: 'Unknown portal source',
                                                    },
                                                },
                                            },
                                        },
                                    },
                                }
                            );
                        },
                        updateGridCell: async () => {
                            portalWrites++;
                            throw Error('No source inline write');
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
                    getScope: () => ({ ownerId: 'source-portal', revision: 0 }),
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
                                        renderExternalSyncSourceField:
                                            react.renderExternalSyncSourceField,
                                    },
                                },
                                (state) =>
                                    state.rows.flatMap((row) =>
                                        row.cells.map((cell) => cell.node)
                                    )
                            )
                        )
                    );
                    assert.equal(input().value, 'Unknown portal source');
                    assert.equal(input().disabled, true);
                    assert.equal(clear().disabled, true);
                    await edit('Changed');
                    assert.equal(input().value, 'Unknown portal source');
                    assert.equal(reads, 1);
                    assert.equal(portalWrites, 0);
                }
                await act(async () =>
                    root.render(h(react.ExternalSyncSourceField, { binding }))
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
