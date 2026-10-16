import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export const reactSingleSelectTypedConsumer = `
import type { ReactNode } from 'react';
import { SingleSelectField, SelectField, renderSingleSelectField, AirtableForm, AirtableGrid, AirtableList, type SingleSelectFieldProps, type SingleSelectFieldOptions } from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/single-select.css';
const source = {};
const options: SingleSelectFieldOptions = { className: 'choice-consumer', clearLabel: 'Clear choice', emptyLabel: 'Choose one', source };
// @ts-expect-error Presentation options do not create owner write authority.
const write: SingleSelectFieldOptions = { setValue: (value: string) => {} };
// @ts-expect-error Source identity must be an object.
const identity: SingleSelectFieldOptions = { source: 'owner' };
// @ts-expect-error Options come from the accepted selection owner.
const choices: SingleSelectFieldOptions = { options: ['Alpha'] };
export const renderers: FieldRendererSlots<ReactNode> = { renderSingleSelectField: props => renderSingleSelectField(props, options) };
export function Bound(props: SingleSelectFieldProps) { return <><SingleSelectField {...props} className={options.className} clearLabel={options.clearLabel} emptyLabel={options.emptyLabel}/><SelectField binding={props.binding}/></>; }
export function Custom(props: SingleSelectFieldProps) { return <SingleSelectField {...props} render={({snapshot}) => <span>{String(snapshot.value == null)}</span>}/>; }
export function Kinds(single: FieldRendererProps<'singleSelect'>, multiple: FieldRendererProps<'multipleSelects'>, text: FieldRendererProps<'singleLineText'>) {
    renderSingleSelectField(single);
    const native: string | null | undefined = single.value;
    // @ts-expect-error Single Select native answers are names, not ID/name objects.
    const object: FieldRendererProps<'singleSelect'>['value'] = { id: 'sel_a', name: 'Alpha' };
    // @ts-expect-error Multiple Select cannot use the single physical slot.
    renderSingleSelectField(multiple);
    // @ts-expect-error A native string alone does not make Text a Single Select slot.
    renderSingleSelectField(text);
    if (single.capability.type === 'editable') { single.capability.selection?.choose(['Alpha']); single.capability.choice?.create('New choice'); }
    return native;
}
export function Compositions({form,portal}:{form:FormRenderScope;portal:PortalRenderScope}) { return <><AirtableForm scope={form} renderers={renderers}>{s=>s.fields.map(f=>f.node)}</AirtableForm><AirtableGrid scope={portal} renderers={renderers}>{s=>s.rows.flatMap(r=>r.cells.map(c=>c.node))}</AirtableGrid><AirtableList scope={portal} renderers={renderers}>{s=>s.rows.flatMap(r=>r.cells.map(c=>c.node))}</AirtableList></>; }
`;

export const reactSingleSelectCommonJsTypedConsumer = `
import React = require('react');
import { SingleSelectField, renderSingleSelectField, type SingleSelectFieldProps, type SingleSelectFieldOptions } from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots } from '@miniextensions/sdk/ui';
const options: SingleSelectFieldOptions = { source: {}, emptyLabel: 'None' };
export const renderers: FieldRendererSlots<React.ReactNode> = { renderSingleSelectField: props => renderSingleSelectField(props, options) };
export function binding(props: SingleSelectFieldProps) { return React.createElement(SingleSelectField, {...props,className:options.className,clearLabel:options.clearLabel,emptyLabel:options.emptyLabel}); }
export function slot(props: FieldRendererProps<'singleSelect'>) { return renderSingleSelectField(props, options); }
// @ts-expect-error The optional React renderer does not leak through core.
import { renderSingleSelectField as coreRenderer } from '@miniextensions/sdk';
`;

/** Installed module-format parity with real owners and synthetic transports only. */
export async function checkReactSingleSelectConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    let network = 0;
    window.fetch = () => {
        network++;
        throw Error('No external Single Select transport');
    };
    const keys = [
        'window',
        'document',
        'navigator',
        'fetch',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLSelectElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const old = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        });
    const { createElement: h, act, StrictMode } = require('react');
    const { createRoot } = require('react-dom/client');
    let checks = 0;
    try {
        const stylesheet = require.resolve(
            '@miniextensions/sdk/react/single-select.css'
        );
        assert.match(
            readFileSync(stylesheet, 'utf8'),
            /\.mx-sdk-single-select:focus-visible/
        );
        const metadata = JSON.parse(
            readFileSync(
                join(
                    consumerDirectory,
                    'node_modules/@miniextensions/sdk/package.json'
                ),
                'utf8'
            )
        );
        assert.equal(metadata.dependencies?.react, undefined);
        assert.equal(metadata.peerDependenciesMeta.react.optional, true);
        for (const format of ['esm', 'cjs']) {
            const load = (name) =>
                format === 'cjs'
                    ? require(`@miniextensions/sdk${name ? '/' + name : ''}`)
                    : import(
                          pathToFileURL(
                              join(
                                  consumerDirectory,
                                  `node_modules/@miniextensions/sdk/dist/esm/${name ? name + '/' : 'runtime/'}index.js`
                              )
                          )
                      );
            const [core, ui, forms, portals, react] = await Promise.all(
                ['', 'ui', 'forms', 'portals', 'react'].map(load)
            );
            assert.equal(typeof react.SingleSelectField, 'function');
            assert.equal(typeof react.renderSingleSelectField, 'function');
            assert.equal(typeof react.SelectField, 'function');
            assert.equal(core.renderSingleSelectField, undefined);
            assert.equal(ui.renderSingleSelectField, undefined);
            const choices = [
                { id: 'sel_alpha', name: 'Alpha' },
                { id: 'sel_beta', name: '  Beta 日本語  ' },
            ];
            const schema = (
                id = 'choice',
                kind = 'singleSelect',
                config = {}
            ) => ({
                fieldType: kind,
                airtableField: {
                    id,
                    name: 'Choice',
                    description: null,
                    isPrimaryField: false,
                    isComputed: false,
                    config: {
                        type: kind,
                        options: { choices: structuredClone(choices) },
                    },
                },
                miniExtConfig: config,
            });
            const resources = [];
            let formSequence = 0;
            const makeForm = (config = {}, native = 'Alpha') => {
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
                loaded.payload.fieldIdsInForm = ['choice', 'multi'];
                loaded.payload.fieldIdsToSchemas = {
                    choice: schema('choice', 'singleSelect', {
                        allowAddingNewOptions: true,
                        ...config,
                    }),
                    multi: schema('multi', 'multipleSelects'),
                };
                loaded.payload.formRecord = {
                    type: 'create',
                    data: {
                        choice: native,
                        multi: ['Alpha'],
                        hidden: 'Preserved native',
                    },
                };
                loaded.payload.formFieldIdsWithUnsavedChanges = ['hidden'];
                loaded.payload.urlPrefilledFieldIds = [];
                const saves = [],
                    adds = [];
                let revision = 0;
                const client = core.createMiniExtensionsClient({
                    apiOrigin: 'https://sdk.example.invalid',
                    session: { visitor: 'synthetic' },
                    fetch: window.fetch,
                });
                client.forms.addSelectOption = async (input) => {
                    adds.push(structuredClone(input));
                    return { newChoice: { id: 'sel_gamma', name: 'Gamma' } };
                };
                client.forms.save = async (input) => {
                    saves.push(structuredClone(input));
                    return {
                        type: 'error',
                        formValidationErrors: [],
                        formErrors: {},
                    };
                };
                const ownerId = `single-select-${format}-${++formSequence}`;
                const fields = forms.createFormFieldBindings({
                    loaded,
                    client,
                    getScope: () => ({ ownerId, revision }),
                    saveOptions: {
                        captchaVal: null,
                        isComputeMode: false,
                        context: { type: 'direct-url' },
                        searchQuery: {},
                        conditionalLinkedRecordFieldIdsToFilteringValues: {},
                    },
                });
                resources.push(() => fields.destroy());
                const journal = new forms.RecoveryJournal();
                const creator = fields.selectChoice(
                    'choice',
                    {
                        journal,
                        scope: {
                            owner: ownerId,
                            parentFieldId: null,
                            tableId: null,
                            childExtensionId: loaded.extensionId,
                            context: 'direct-url',
                        },
                        loadVersion: 1,
                    },
                    { getLoaded: () => loaded, configurationRevision: () => 0 }
                );
                const binding = fields.field('choice');
                const host = ui.createFormFieldRendererHost({
                    fields,
                    fieldId: 'choice',
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                });
                resources.push(() => host.dispose());
                return {
                    loaded,
                    client,
                    fields,
                    binding,
                    host,
                    creator,
                    journal,
                    ownerId,
                    saves,
                    adds,
                    retire: () => {
                        revision++;
                        fields.refresh();
                    },
                };
            };
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            const select = () => container.querySelector('select');
            const intent = () =>
                container.querySelector('.mx-sdk-single-select-new-choice');
            const button = (name) =>
                [...container.querySelectorAll('button')].find(
                    (node) => node.textContent === name
                );
            const clear = () =>
                container.querySelector('.mx-sdk-single-select-clear');
            const choose = async (value, node = select()) =>
                act(async () => {
                    Object.getOwnPropertyDescriptor(
                        window.HTMLSelectElement.prototype,
                        'value'
                    ).set.call(node, value);
                    node.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                });
            const type = async (value, node = intent()) =>
                act(async () => {
                    Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype,
                        'value'
                    ).set.call(node, value);
                    node.dispatchEvent(
                        new window.Event('input', { bubbles: true })
                    );
                    node.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                });
            const slot = (f) =>
                h(
                    StrictMode,
                    null,
                    h(react.FieldRenderer, {
                        host: f.host,
                        renderers: {
                            renderSingleSelectField:
                                react.renderSingleSelectField,
                        },
                        fallback: () => null,
                    })
                );
            try {
                const f = makeForm();
                await act(async () => root.render(slot(f)));
                assert.equal(select().multiple, false);
                assert.equal(select().value, 'Alpha');
                assert.equal(select().disabled, false);
                assert.equal(select().options[0].textContent, 'None');
                assert.equal(f.adds.length, 0);
                assert.equal(f.saves.length, 0);
                assert.equal(network, 0);
                assert.equal(
                    f.host.getSnapshot().fields[0].capability.type,
                    'editable'
                );
                assert.ok(
                    window.document.querySelector(`label[for="${select().id}"]`)
                );
                checks++;

                await choose(choices[1].name);
                assert.equal(f.binding.getSnapshot().value, choices[1].name);
                assert.notEqual(f.binding.getSnapshot().value, choices[1].id);
                await act(async () => root.render(null));
                await act(async () => root.render(slot(f)));
                assert.equal(select().value, choices[1].name);
                await act(async () => clear().click());
                assert.equal(f.binding.getSnapshot().value, null);
                assert.equal(select().value, '');
                assert.equal(clear().disabled, true);
                assert.equal(f.saves.length, 0);
                checks++;

                await act(async () =>
                    root.render(
                        h(react.SingleSelectField, {
                            binding: f.binding,
                            className: 'single-consumer',
                            clearLabel: 'Reset choice',
                            emptyLabel: 'Choose one',
                        })
                    )
                );
                assert.ok(container.querySelector('.single-consumer'));
                assert.equal(select().options[0].textContent, 'Choose one');
                assert.equal(
                    clear().getAttribute('aria-label'),
                    'Reset choice'
                );
                await choose('Alpha');
                await act(async () =>
                    root.render(h(react.SelectField, { binding: f.binding }))
                );
                assert.ok(
                    container.querySelector('.mx-sdk-single-select-field')
                );
                assert.equal(select().value, 'Alpha');
                await act(async () =>
                    root.render(
                        h(react.SelectField, {
                            binding: f.fields.field('multi'),
                        })
                    )
                );
                assert.equal(select().multiple, true);
                assert.deepEqual(
                    [...select().selectedOptions].map((o) => o.value),
                    ['Alpha']
                );
                await act(async () =>
                    root.render(
                        h(react.SingleSelectField, {
                            binding: f.fields.field('multi'),
                            render: () =>
                                h(
                                    'span',
                                    { 'data-custom': 'yes' },
                                    'Custom owner'
                                ),
                        })
                    )
                );
                assert.equal(select(), null);
                assert.equal(
                    container.querySelector('[data-custom]').textContent,
                    'Custom owner'
                );
                checks++;

                const props = f.host.getSnapshot().fields[0];
                for (const side of ['displayConfig', 'writeConfig']) {
                    await act(async () =>
                        root.render(
                            react.renderSingleSelectField({
                                ...props,
                                [side]: { maskPasswordOnLoginScreen: true },
                                error: 'Alpha private feedback',
                            })
                        )
                    );
                    assert.equal(select(), null);
                    assert.equal(
                        container.querySelector('input').type,
                        'password'
                    );
                    assert.equal(
                        container.querySelector('input').disabled,
                        true
                    );
                    assert.equal(container.innerHTML.includes('Alpha'), false);
                    assert.equal(
                        container.innerHTML.includes(choices[1].name),
                        false
                    );
                    assert.equal(clear(), null);
                    assert.equal(button('Create choice'), undefined);
                }
                await act(async () =>
                    root.render(
                        react.renderSingleSelectField({
                            ...props,
                            pending: true,
                            displayConfig: { showTitle: false },
                            error: '<b>Pending owner</b>',
                        })
                    )
                );
                assert.equal(select().disabled, true);
                assert.equal(select().getAttribute('aria-busy'), 'true');
                assert.equal(select().getAttribute('aria-label'), 'Choice');
                assert.equal(
                    container.querySelector('label[for="' + select().id + '"]'),
                    null
                );
                assert.equal(container.querySelector('b'), null);
                await choose(choices[1].name);
                assert.equal(f.binding.getSnapshot().value, 'Alpha');
                checks++;

                for (const variant of [
                    {
                        capability: { type: 'readonly' },
                        value: 'Loaded outside current choices',
                    },
                    {
                        capability: {
                            type: 'editable',
                            setValue: () => assert.fail('No fallback setter'),
                        },
                        value: 'Alpha',
                    },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderSingleSelectField({
                                ...props,
                                ...variant,
                            })
                        )
                    );
                    assert.equal(select().disabled, true);
                    assert.equal(select().value, variant.value);
                    assert.equal(clear().disabled, true);
                    assert.equal(button('Create choice'), undefined);
                    await choose(choices[1].name);
                    assert.equal(f.binding.getSnapshot().value, 'Alpha');
                }
                await act(async () =>
                    root.render(
                        react.renderSingleSelectField({
                            ...props,
                            selectAvailability: undefined,
                            capability: { type: 'readonly' },
                        })
                    )
                );
                assert.equal(
                    container.textContent.includes('No choices available.'),
                    false
                );
                await act(async () =>
                    root.render(
                        react.renderSingleSelectField({
                            ...props,
                            selectAvailability: {
                                status: 'blocked',
                                code: 'unsupported-condition',
                            },
                            capability: { type: 'readonly' },
                        })
                    )
                );
                assert.equal(select().disabled, true);
                assert.equal(select().value, 'Alpha');
                assert.ok(
                    container.textContent.includes(
                        'Choices are unavailable for this configuration.'
                    )
                );
                const readonly = makeForm({ readOnly: true });
                await act(async () =>
                    root.render(
                        h(react.SingleSelectField, {
                            binding: readonly.binding,
                        })
                    )
                );
                assert.equal(select().disabled, true);
                await choose(choices[1].name);
                assert.equal(readonly.binding.getSnapshot().value, 'Alpha');
                assert.equal(readonly.adds.length, 0);
                checks++;

                const created = makeForm();
                await act(async () =>
                    root.render(
                        h(react.SingleSelectField, { binding: created.binding })
                    )
                );
                await type('  Requested Gamma  ');
                assert.equal(button('Create choice').disabled, false);
                await act(async () => button('Create choice').click());
                assert.equal(created.adds.length, 1);
                assert.equal(
                    created.adds[0].newChoiceText,
                    '  Requested Gamma  '
                );
                assert.equal(created.binding.getSnapshot().value, 'Gamma');
                assert.equal(created.saves.length, 0);
                assert.equal(intent().value, '');
                await act(async () => created.fields.save());
                assert.equal(created.saves.length, 1);
                assert.equal(created.saves[0].formRecord.data.choice, 'Gamma');
                assert.equal(
                    created.saves[0].formRecord.data.hidden,
                    'Preserved native'
                );
                assert.ok(
                    created.saves[0].formFieldIdsWithUnsavedChanges.includes(
                        'choice'
                    )
                );
                checks++;

                const cancelled = makeForm();
                let completeCancelled;
                let cancelledCalls = 0;
                cancelled.client.forms.addSelectOption = async () => {
                    cancelledCalls++;
                    return new Promise((resolve) => {
                        completeCancelled = resolve;
                    });
                };
                await act(async () =>
                    root.render(
                        h(react.SingleSelectField, {
                            binding: cancelled.binding,
                        })
                    )
                );
                await type('Cancelled intent');
                await act(async () => button('Create choice').click());
                assert.equal(button('Create choice').disabled, true);
                assert.equal(button('Cancel choice creation').disabled, false);
                await act(async () => button('Cancel choice creation').click());
                await act(async () =>
                    completeCancelled({
                        newChoice: {
                            id: 'sel_cancelled',
                            name: 'Cancelled intent',
                        },
                    })
                );
                assert.equal(cancelledCalls, 1);
                assert.equal(cancelled.binding.getSnapshot().value, 'Alpha');
                assert.equal(intent().value, 'Cancelled intent');
                assert.equal(cancelled.saves.length, 0);
                assert.equal(
                    cancelled.journal.unknown(cancelled.ownerId).length,
                    1
                );
                checks++;

                const first = makeForm(),
                    second = makeForm();
                let completeFirst;
                let firstCalls = 0;
                first.client.forms.addSelectOption = async () => {
                    firstCalls++;
                    return new Promise((resolve) => {
                        completeFirst = resolve;
                    });
                };
                await act(async () =>
                    root.render(
                        h(react.SingleSelectField, { binding: first.binding })
                    )
                );
                await type('Same intent');
                await act(async () => button('Create choice').click());
                await act(async () =>
                    root.render(
                        h(react.SingleSelectField, { binding: second.binding })
                    )
                );
                assert.equal(intent().value, '');
                await type('Same intent');
                await act(async () =>
                    completeFirst({
                        newChoice: { id: 'sel_first', name: 'Same intent' },
                    })
                );
                assert.equal(firstCalls, 1);
                assert.equal(first.binding.getSnapshot().value, 'Same intent');
                assert.equal(second.binding.getSnapshot().value, 'Alpha');
                assert.equal(intent().value, 'Same intent');
                assert.equal(second.adds.length, 0);
                checks++;

                const portal = fixtures.makePortal();
                const choiceSchema = schema();
                const field = choiceSchema.airtableField;
                for (const s of Object.values(
                    portal.payload.fieldIdsToSchemas
                )) {
                    s.airtableField = {
                        ...s.airtableField,
                        description: null,
                        isComputed: false,
                        isPrimaryField: false,
                    };
                    if (s.airtableField.config.type === 'singleLineText')
                        s.airtableField.config.options = null;
                }
                const linkConfig =
                    portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig;
                linkConfig.disableInlineEdit = false;
                linkConfig.customViews[0].config = {
                    ...linkConfig.customViews[0].config,
                    layout: 'grid',
                    disableInlineEdit: false,
                };
                const details = [
                    {
                        fieldId: 'choice',
                        fieldName: 'Choice',
                        titleOverride: null,
                        isHidden: false,
                        fieldIsInEditingChildForm: true,
                        childFormField: null,
                        miniExtConfig: {},
                    },
                ];
                portal.payload.linkedRecordFieldIdToDetailFields.fld_children =
                    details;
                portal.payload.initialLinkedTableStates.tbl_children.airtableFields =
                    [field];
                let reads = 0;
                const gridWrites = [];
                const portalClient = {
                    getSession: () => ({}),
                    portals: {
                        listLinkedRecords: async () => {
                            reads++;
                            return fixtures.page(
                                [
                                    {
                                        id: 'rec_one',
                                        fields: { choice: 'Alpha' },
                                    },
                                ],
                                null,
                                {
                                    customViewDetailFields: {
                                        fld_children: details,
                                    },
                                    tableIdsToLinkedTableStates: {
                                        tbl_children: {
                                            airtableFields: [field],
                                            recordIdsToAirtableRecords: {
                                                rec_one: {
                                                    id: 'rec_one',
                                                    fields: { choice: 'Alpha' },
                                                },
                                            },
                                        },
                                    },
                                }
                            );
                        },
                        updateGridCell: async (input) => {
                            gridWrites.push(structuredClone(input));
                            return {
                                record: {
                                    id: input.recordId,
                                    fields: {
                                        [input.recordFieldId]: input.value,
                                    },
                                },
                                auditTrail: null,
                                auditTrails: [],
                            };
                        },
                    },
                };
                const owner = portals.createPortalListOwner({
                    client: portalClient,
                    portal,
                    portalFieldId: 'fld_children',
                    criteria: {
                        selectedCustomViewId: 'view_example',
                        sortFieldsByEndUser: null,
                        supportsEndUserSortCleanup: true,
                        filtersByEndUser: null,
                        supportsEndUserFilterCleanup: true,
                        searchParamsMap: {},
                        searchTerm: null,
                    },
                    getScope: () => ({ ownerId: 'grid-owner', revision: 0 }),
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                });
                resources.push(() => owner.destroy());
                assert.equal(reads, 0);
                assert.equal(
                    await owner.readFirst(owner.getSnapshot().revision, {
                        pagesToFetch: 1,
                        refreshLoggedInPortalRecord: false,
                    }),
                    true
                );
                const cell = portals.createPortalCellBinding({
                    client: portalClient,
                    schema: choiceSchema,
                    value: 'Alpha',
                    input: {
                        portalExtensionAccessToken: 'portal_access_example',
                        portalFieldId: 'fld_children',
                        recordFieldId: 'choice',
                        recordId: 'rec_one',
                        selectedCustomViewId: 'view_example',
                    },
                    getScope: () => ({ ownerId: 'grid-owner', revision: 0 }),
                    isCurrent: () =>
                        owner.isCurrent(owner.getSnapshot().revision),
                    recovery: {
                        journal: new forms.RecoveryJournal(),
                        scope: {
                            owner: 'grid-owner',
                            parentFieldId: 'fld_children',
                            tableId: 'tbl_children',
                            childExtensionId: '',
                            context: 'modal',
                        },
                        loadVersion: 1,
                    },
                });
                resources.push(() => cell.destroy());
                const gridScope = ui.createPortalRenderScope({
                    owner,
                    client: portalClient,
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                    resolveCell: () => cell,
                });
                resources.push(() => gridScope.destroy());
                const compositions = (Component) =>
                    h(
                        Component,
                        {
                            scope: gridScope,
                            renderers: {
                                renderSingleSelectField:
                                    react.renderSingleSelectField,
                            },
                        },
                        (state) =>
                            state.rows.flatMap((row) =>
                                row.cells.map((entry) => entry.node)
                            )
                    );
                await act(async () =>
                    root.render(compositions(react.AirtableGrid))
                );
                assert.equal(select().disabled, false);
                await choose(choices[1].name);
                assert.equal(cell.binding.getSnapshot().value, choices[1].name);
                assert.equal(gridWrites.length, 0);
                assert.equal(reads, 1);
                await act(async () => cell.save());
                assert.equal(gridWrites.length, 1);
                assert.equal(gridWrites[0].value, choices[1].name);
                checks++;

                const detailScope = ui.createPortalRenderScope({
                    owner,
                    client: portalClient,
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                });
                resources.push(() => detailScope.destroy());
                for (const Component of [
                    react.AirtableGrid,
                    react.AirtableList,
                ]) {
                    await act(async () =>
                        root.render(
                            h(
                                Component,
                                {
                                    scope: detailScope,
                                    renderers: {
                                        renderSingleSelectField:
                                            react.renderSingleSelectField,
                                    },
                                },
                                (state) =>
                                    state.rows.flatMap((row) =>
                                        row.cells.map((entry) => entry.node)
                                    )
                            )
                        )
                    );
                    assert.equal(select().disabled, true);
                    assert.equal(select().value, 'Alpha');
                    assert.equal(button('Create choice'), undefined);
                    assert.equal(clear().disabled, true);
                    await choose(choices[1].name);
                    assert.equal(gridWrites.length, 1);
                    assert.equal(reads, 1);
                }
                checks++;

                const formScope = ui.createFormRenderScope({
                    fields: f.fields,
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                });
                resources.push(() => formScope.destroy());
                await act(async () =>
                    root.render(
                        h(
                            react.AirtableForm,
                            {
                                scope: formScope,
                                renderers: {
                                    renderSingleSelectField:
                                        react.renderSingleSelectField,
                                },
                            },
                            (state) =>
                                state.fields
                                    .filter(
                                        (field) => field.fieldId === 'choice'
                                    )
                                    .map((field) => field.node)
                        )
                    )
                );
                assert.equal(select().value, 'Alpha');
                await choose(choices[1].name);
                assert.equal(f.binding.getSnapshot().value, choices[1].name);
                assert.equal(f.saves.length, 0);
                const held = select();
                await act(async () => f.retire());
                await act(async () =>
                    root.render(
                        h(react.SingleSelectField, { binding: f.binding })
                    )
                );
                assert.equal(select(), null);
                assert.equal(f.binding.getSnapshot().retired, true);
                const retiredState = f.fields.controller.getState();
                await choose('Alpha', held);
                assert.deepEqual(f.fields.controller.getState(), retiredState);
                assert.equal(f.binding.getSnapshot().value, undefined);
                assert.equal(f.saves.length, 0);
                checks++;

                const noCreation = makeForm({ allowAddingNewOptions: false });
                await act(async () =>
                    root.render(
                        h(react.SingleSelectField, {
                            binding: noCreation.binding,
                        })
                    )
                );
                assert.equal(select().disabled, false);
                if (button('Create choice'))
                    assert.equal(button('Create choice').disabled, true);
                assert.equal(noCreation.adds.length, 0);
                await choose(choices[1].name);
                assert.equal(
                    noCreation.binding.getSnapshot().value,
                    choices[1].name
                );
                assert.equal(noCreation.adds.length, 0);
                assert.equal(noCreation.saves.length, 0);
                assert.equal(network, 0);
                checks++;
            } finally {
                await act(async () => root.unmount());
                for (const dispose of resources.reverse()) dispose();
                container.remove();
            }
        }
        return { checks };
    } finally {
        keys.forEach((key, index) => {
            if (old[index]) Object.defineProperty(globalThis, key, old[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}
