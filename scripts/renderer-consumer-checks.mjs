import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

const kinds = [
    'singleLineText',
    'number',
    'email',
    'url',
    'multilineText',
    'percent',
    'currency',
    'singleSelect',
    'multipleSelects',
    'singleCollaborator',
    'multipleCollaborators',
    'multipleRecordLinks',
    'date',
    'dateTime',
    'phoneNumber',
    'multipleAttachments',
    'checkbox',
    'formula',
    'createdTime',
    'rollup',
    'count',
    'multipleLookupValues',
    'autoNumber',
    'barcode',
    'rating',
    'richText',
    'duration',
    'lastModifiedTime',
    'createdBy',
    'lastModifiedBy',
    'button',
    'externalSyncSource',
    'aiText',
];
const nativeTypes = {
    number: 'number',
    percent: 'number',
    currency: 'number',
    duration: 'number',
    rating: 'number',
    count: 'number',
    autoNumber: 'number',
    checkbox: 'boolean',
    multipleSelects: 'readonly string[]',
    multipleRecordLinks: 'readonly string[]',
    singleCollaborator: 'AirtableCollaborator',
    multipleCollaborators: 'readonly AirtableCollaborator[]',
    createdBy: 'AirtableCollaborator',
    lastModifiedBy: 'AirtableCollaborator',
    multipleAttachments: 'readonly AirtableAttachment[]',
    barcode: 'AirtableBarcodeValue',
    button: '{url:string;label:string}',
    formula: 'AirtableValue',
    rollup: 'AirtableValue',
    multipleLookupValues: 'Extract<AirtableValue, readonly unknown[]>',
    aiText: 'Extract<AirtableValue,{state:string;value:string;isStale:boolean}>',
};
const completeField = (field) => ({
    description: null,
    isComputed: false,
    isPrimaryField: false,
    ...field,
    config: {
        ...field.config,
        ...(['singleLineText', 'button'].includes(field.config.type)
            ? { options: null }
            : {}),
    },
});
const completeTable = (table) => {
    table.airtableFields = table.airtableFields.map(completeField);
    return table;
};
const slot = (kind) => `render${kind[0].toUpperCase()}${kind.slice(1)}Field`;

// Compiled before installing React: every callback is contextually correlated by physical kind.
export const rendererTypedConsumer = `
import type { AirtableValue, AirtableCollaborator, AirtableAttachment, AirtableBarcodeValue } from '@miniextensions/sdk';
import type { FieldKind, FieldSchema, FieldMetadata, FieldConfig, FieldReadValue, FieldRendererCapability, FieldRendererProps, FieldRendererPropsUnion, FieldRendererSlots } from '@miniextensions/sdk/ui';
import { FIELD_RENDERER_SLOTS, dispatchField } from '@miniextensions/sdk/ui';
const slots: Required<FieldRendererSlots<string>> = {
${kinds
    .map(
        (kind) => `${slot(kind)}: props => {
 const kind: '${kind}' = props.physicalKind;
 const field: FieldSchema<'${kind}'>['airtableField'] = props.field;
 const value: ${nativeTypes[kind] ?? 'string'} | null | undefined = props.value;
 const config: FieldConfig<'${kind}'> | null = props.displayConfig;
 const capability: FieldRendererCapability<'${kind}'> = props.capability;
 void [field,value,config,capability]; return kind;
}`
    )
    .join(',\n')}
};
const exhaustive: Record<FieldKind, keyof typeof slots> = FIELD_RENDERER_SLOTS;
declare const props: FieldRendererPropsUnion;
const rendered: string = dispatchField(slots, props, () => 'fallback');
declare const checkbox: FieldRendererProps<'checkbox'>;
if (checkbox.capability.type === 'editable') {
 checkbox.capability.setValue(false);
 // @ts-expect-error checkbox does not accept native text
 checkbox.capability.setValue('checked');
}
declare const text: FieldRendererProps<'singleLineText'>;
// @ts-expect-error text has no Button action
text.capability.button;
declare const formula: FieldRendererProps<'formula'>;
// @ts-expect-error computed fields expose no write operation
formula.capability.setValue(1);
const absentConfig: FieldConfig<'checkbox'> = undefined;
const richTextConfig: FieldConfig<'richText'> = { addOnlyMode: true };
// @ts-expect-error addOnlyMode belongs to the generated rich-text config, not checkbox config
const checkboxWithRichTextOption: FieldConfig<'checkbox'> = { addOnlyMode: true };
// @ts-expect-error config keeps its generated optional type, not universal null
const nullConfig: FieldConfig<'checkbox'> = null;
// Grouped generated metadata remains usable for both physical kinds.
declare const number: FieldMetadata<'number'>;
declare const percent: FieldMetadata<'percent'>;
const numberMetadata: FieldMetadata<'number'> = percent;
const percentMetadata: FieldMetadata<'percent'> = number;
void [rendered,exhaustive,absentConfig,nullConfig,richTextConfig,checkboxWithRichTextOption,numberMetadata,percentMetadata];
`;
export const rendererReactTypedConsumer = `
import { createElement, type ReactNode } from 'react';
import { FieldRenderer } from '@miniextensions/sdk/react';
import type { FieldRendererHost, FieldRendererSlots } from '@miniextensions/sdk/ui';
declare const host: FieldRendererHost;
const renderers: FieldRendererSlots<ReactNode> = {
 renderSingleLineTextField: props => createElement('span', null, props.value),
 renderCheckboxField: props => createElement('span', null, String(props.value)),
};
const tree = createElement(FieldRenderer, { host, renderers, fallback: () => null });
void tree;
`;

/** Installed public entrypoints, synthetic public envelopes, no browser/backend claim. */
export async function checkRendererConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const base = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const [ui, forms, portals, reactApi] = await Promise.all(
        ['ui', 'forms', 'portals', 'react'].map(
            (name) => import(pathToFileURL(join(base, name, 'index.js')))
        )
    );
    const cjs = consumer('@miniextensions/sdk/ui');
    let checks = 0;
    for (const api of [ui, cjs]) {
        assert.deepEqual(
            Object.keys(api.FIELD_RENDERER_SLOTS).sort(),
            [...kinds].sort()
        );
        for (const kind of kinds) {
            assert.equal(api.FIELD_RENDERER_SLOTS[kind], slot(kind));
            const props = {
                physicalKind: kind,
                fieldId: `fld_${kind}`,
                title: kind,
                field: {
                    id: `fld_${kind}`,
                    name: kind,
                    config: { type: kind },
                },
                displayConfig: undefined,
                value: undefined,
                context: 'portal-detail',
                computed: false,
                dirty: false,
                pending: false,
                validation: [],
                error: null,
                capability: { type: 'readonly' },
            };
            const result = api.dispatchField(
                {
                    [slot(kind)]: (received) => {
                        assert.equal(received, props);
                        return kind;
                    },
                },
                props,
                () => assert.fail('known slot fell back')
            );
            assert.equal(result, kind);
            assert.equal(
                api.dispatchField({}, props, (received, reason) => {
                    assert.equal(received, props);
                    assert.equal(reason, 'missing-renderer');
                    return 'fallback';
                }),
                'fallback'
            );
        }
        checks++;
    }
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const previous = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        })
    );
    const react = consumer('react');
    const { createElement: h, StrictMode, act } = react;
    const { createRoot } = consumer('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    let root = createRoot(container);
    const resources = [];
    try {
        assert.equal(
            typeof consumer('@miniextensions/sdk/react').FieldRenderer,
            'function'
        );
        let io = 0,
            current = true,
            configRevision = 0;
        const loaded = fixtures.makeForm({
            childExtensionInfo: { accessType: { type: 'create' } },
        });
        loaded.payload.hasParentExtension = false;
        loaded.payload.fieldIdsInForm.push('fld_files');
        loaded.payload.fieldIdsToSchemas.fld_files = {
            fieldType: 'multipleAttachments',
            airtableField: {
                id: 'fld_files',
                name: 'Files',
                isComputed: false,
                config: {
                    type: 'multipleAttachments',
                    options: { isReversed: false },
                },
            },
            miniExtConfig: {},
        };
        loaded.payload.formRecord.data.fld_files = [];
        loaded.payload.fieldIdsInForm.push('fld_choices');
        loaded.payload.fieldIdsToSchemas.fld_choices = {
            fieldType: 'multipleSelects',
            airtableField: {
                id: 'fld_choices',
                name: 'Choices',
                isComputed: false,
                config: {
                    type: 'multipleSelects',
                    options: {
                        choices: [
                            { id: 'a', name: 'Alpha' },
                            { id: 'b', name: 'Beta' },
                        ],
                    },
                },
            },
            miniExtConfig: {},
        };
        loaded.payload.formRecord.data.fld_choices = [];
        for (const schema of Object.values(loaded.payload.fieldIdsToSchemas))
            schema.airtableField = completeField(schema.airtableField);
        const client = {
            getSession: () => ({}),
            forms: {
                save: async () => {
                    io++;
                    throw Error('Unexpected save');
                },
            },
            portals: {
                listLinkedRecords: async () => {
                    io++;
                    const page = fixtures.page([
                        fixtures.record('rec_one', 'Portal initial'),
                    ]);
                    Object.values(page.tableIdsToLinkedTableStates).forEach(
                        completeTable
                    );
                    return page;
                },
                updateGridCell: async () => {
                    io++;
                    throw Error('Unexpected cell save');
                },
            },
        };
        const fields = forms.createFormFieldBindings({
            loaded,
            client,
            getScope: () => ({ ownerId: 'visitor', revision: 0 }),
            saveOptions: {
                captchaVal: null,
                isComputeMode: false,
                context: { type: 'direct-url' },
                searchQuery: {},
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        });
        resources.push(() => fields.destroy());
        const formHost = ui.createFormFieldRendererHost({
            fields,
            fieldId: 'fld_title',
            isCurrent: () => current,
            configurationRevision: () => configRevision,
        });
        resources.push(() => formHost.dispose());
        const portal = fixtures.makePortal();
        portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig.disableInlineEdit = false;
        Object.values(portal.payload.fieldIdsToSchemas).forEach((schema) => {
            schema.airtableField = completeField(schema.airtableField);
        });
        Object.values(portal.payload.initialLinkedTableStates).forEach(
            completeTable
        );
        const custom =
            portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig
                .customViews[0].config;
        custom.layout = 'grid';
        custom.disableInlineEdit = false;
        const criteria = {
            selectedCustomViewId: 'view_example',
            sortFieldsByEndUser: null,
            supportsEndUserSortCleanup: true,
            filtersByEndUser: null,
            supportsEndUserFilterCleanup: true,
            searchParamsMap: {},
            searchTerm: null,
        };
        const owner = portals.createPortalListOwner({
            client,
            portal,
            portalFieldId: 'fld_children',
            criteria,
            getScope: () => ({ ownerId: 'visitor', revision: 0 }),
            isCurrent: () => current,
            configurationRevision: () => configRevision,
        });
        resources.push(() => owner.destroy());
        assert.equal(
            await owner.readFirst(owner.getSnapshot().revision, {
                pagesToFetch: 1,
                refreshLoggedInPortalRecord: false,
            }),
            true
        );
        assert.equal(io, 1);
        const cell = portals.createPortalCellBinding({
            client,
            schema: loaded.payload.fieldIdsToSchemas.fld_title,
            value: 'Portal initial',
            input: {
                portalExtensionAccessToken: 'portal_access_example',
                portalFieldId: 'fld_children',
                recordFieldId: 'fld_title',
                recordId: 'rec_one',
                selectedCustomViewId: 'view_example',
            },
            getScope: () => ({ ownerId: 'visitor', revision: 0 }),
            isCurrent: () => owner.isCurrent(owner.getSnapshot().revision),
            recovery: {
                journal: new forms.RecoveryJournal(),
                scope: {
                    owner: 'visitor',
                    parentFieldId: 'fld_children',
                    tableId: 'tbl_children',
                    childExtensionId: '',
                    context: 'modal',
                },
                loadVersion: 1,
            },
        });
        resources.push(() => cell.destroy());
        const cellHost = ui.createPortalCellRendererHost({
            cell,
            owner,
            client,
            recordId: 'rec_one',
            fieldId: 'fld_title',
            isCurrent: () => current,
            configurationRevision: () => configRevision,
        });
        resources.push(() => cellHost.dispose());
        const detailHost = ui.createPortalDetailRendererHost({
            owner,
            client,
            recordId: 'rec_one',
            isCurrent: () => current,
            configurationRevision: () => configRevision,
        });
        resources.push(() => detailHost.dispose());
        const retained = new Map();
        const renderers = {
            renderSingleLineTextField: (props) => {
                retained.set(props.context, props);
                return h(
                    'span',
                    { 'data-context': props.context },
                    props.value ?? ''
                );
            },
        };
        const hosts = [formHost, cellHost, detailHost];
        hosts.forEach((host) =>
            assert.equal(host.getSnapshot().status, 'ready')
        );
        const tree = () =>
            h(
                StrictMode,
                null,
                ...hosts.map((host, index) =>
                    h(reactApi.FieldRenderer, {
                        key: index,
                        host,
                        renderers,
                        fallback: () => null,
                    })
                )
            );
        await act(async () => root.render(tree()));
        assert.equal(container.querySelectorAll('span').length, 3);
        assert.equal(retained.get('form').capability.type, 'editable');
        assert.equal(retained.get('portal-cell').capability.type, 'editable');
        assert.equal(retained.get('portal-detail').capability.type, 'readonly');
        assert.equal(io, 1);
        checks++;
        await act(async () =>
            retained.get('form').capability.setValue('Form custom')
        );
        await act(async () =>
            retained.get('portal-cell').capability.setValue('Cell custom')
        );
        assert.equal(
            container.querySelector('[data-context=form]').textContent,
            'Form custom'
        );
        assert.equal(
            container.querySelector('[data-context=portal-cell]').textContent,
            'Cell custom'
        );
        assert.equal(
            container.querySelector('[data-context=portal-detail]').textContent,
            'Portal initial'
        );
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(tree()));
        assert.equal(
            fields.field('fld_title').getSnapshot().value,
            'Form custom'
        );
        assert.equal(cell.binding.getSnapshot().value, 'Cell custom');
        assert.equal(io, 1);
        checks++;
        const numberHost = ui.createFormFieldRendererHost({
            fields,
            fieldId: 'fld_quantity',
            isCurrent: () => current,
            configurationRevision: () => configRevision,
        });
        resources.push(() => numberHost.dispose());
        let numberProps;
        const numberTree = () =>
            h(
                StrictMode,
                null,
                h(reactApi.FieldRenderer, {
                    host: numberHost,
                    renderers: {
                        renderNumberField: (props) => {
                            numberProps = props;
                            return h(
                                'span',
                                null,
                                props.capability.type === 'editable'
                                    ? props.capability.scalar?.state.input
                                    : ''
                            );
                        },
                    },
                    fallback: () => null,
                })
            );
        await act(async () => root.render(numberTree()));
        assert.equal(numberProps.capability.type, 'editable');
        await act(async () => numberProps.capability.scalar.setInput('-'));
        assert.equal(container.querySelector('span').textContent, '-');
        assert.equal(fields.field('fld_quantity').getSnapshot().value, 2);
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(numberTree()));
        assert.equal(container.querySelector('span').textContent, '-');
        assert.equal(fields.field('fld_quantity').getSnapshot().value, 2);
        assert.equal(io, 1);
        checks++;
        const selectionModel = fields.field('fld_choices').selection;
        const selectHost = ui.createFormFieldRendererHost({
            fields,
            fieldId: 'fld_choices',
            isCurrent: () => current,
            configurationRevision: () => configRevision,
        });
        resources.push(() => selectHost.dispose());
        let selectProps;
        const selectTree = () =>
            h(
                StrictMode,
                null,
                h(reactApi.FieldRenderer, {
                    host: selectHost,
                    renderers: {
                        renderMultipleSelectsField: (props) => {
                            selectProps = props;
                            return h(
                                'span',
                                null,
                                props.capability.type === 'editable'
                                    ? props.capability.selection?.state
                                          .searchTerm
                                    : ''
                            );
                        },
                    },
                    fallback: () => null,
                })
            );
        await act(async () => root.render(selectTree()));
        assert.equal(selectProps.capability.type, 'editable');
        await act(async () => {
            selectProps.capability.selection.choose(['Beta']);
            selectProps.capability.selection.setSearchInput('Retained search');
        });
        assert.deepEqual(fields.field('fld_choices').getSnapshot().value, [
            'Beta',
        ]);
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(selectTree()));
        assert.equal(fields.field('fld_choices').selection, selectionModel);
        assert.deepEqual(fields.field('fld_choices').getSnapshot().value, [
            'Beta',
        ]);
        assert.equal(
            container.querySelector('span').textContent,
            'Retained search'
        );
        assert.equal(io, 1);
        checks++;
        const fileRecovery = {
            journal: new forms.RecoveryJournal(),
            loadVersion: 1,
            scope: {
                owner: 'visitor',
                parentFieldId: null,
                tableId: null,
                childExtensionId: loaded.extensionId,
                context: 'modal',
            },
        };
        const fileHost = ui.createFormFieldRendererHost({
            fields,
            fieldId: 'fld_files',
            isCurrent: () => current,
            configurationRevision: () => configRevision,
            attachmentRecovery: fileRecovery,
        });
        resources.push(() => fileHost.dispose());
        let fileProps;
        const fileTree = () =>
            h(
                StrictMode,
                null,
                h(reactApi.FieldRenderer, {
                    host: fileHost,
                    renderers: {
                        renderMultipleAttachmentsField: (props) => {
                            fileProps = props;
                            return h(
                                'span',
                                null,
                                props.capability.type === 'editable'
                                    ? String(
                                          props.capability.attachment?.state
                                              .files.length
                                      )
                                    : 'readonly'
                            );
                        },
                    },
                    fallback: () => null,
                })
            );
        await act(async () => root.render(fileTree()));
        assert.equal(fileProps.capability.type, 'editable');
        const selectedFile = new window.File(
            ['synthetic bytes'],
            'synthetic.txt',
            { type: 'text/plain' }
        );
        await act(async () =>
            fileProps.capability.attachment.select([selectedFile])
        );
        assert.equal(container.querySelector('span').textContent, '1');
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(fileTree()));
        assert.equal(
            fileProps.capability.attachment.state.files[0],
            selectedFile
        );
        assert.deepEqual(fields.field('fld_files').getSnapshot().value, []);
        assert.equal(io, 1);
        checks++;
        const buttonLoaded = structuredClone(loaded);
        buttonLoaded.payload.publicFields = {
            type: 'form',
            state: { formFields: null, tableId: 'tbl_children' },
        };
        buttonLoaded.payload.fieldIdsInForm = ['fld_button'];
        buttonLoaded.payload.fieldIdsToSchemas = {
            fld_button: {
                fieldType: 'button',
                airtableField: {
                    id: 'fld_button',
                    name: 'Action',
                    isComputed: true,
                    description: null,
                    isPrimaryField: false,
                    config: { type: 'button', options: null },
                },
                miniExtConfig: { openLinkType: 'triggerWebhookPOST' },
            },
        };
        buttonLoaded.payload.formRecord = {
            type: 'edit',
            tableId: 'tbl_children',
            recordId: 'rec_edit',
            data: {
                fld_button: {
                    url: 'https://example.invalid/action',
                    label: 'Action',
                },
            },
        };
        client.buttons = {
            triggerWebhook: async () => {
                io++;
                return { success: false };
            },
        };
        const buttonFields = forms.createFormFieldBindings({
            loaded: buttonLoaded,
            client,
            getScope: () => ({ ownerId: 'visitor', revision: 0 }),
            saveOptions: {
                captchaVal: null,
                isComputeMode: false,
                context: { type: 'direct-url' },
                searchQuery: {},
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        });
        resources.push(() => buttonFields.destroy());
        const buttonJournal = new forms.RecoveryJournal();
        const buttonHost = ui.createFormFieldRendererHost({
            fields: buttonFields,
            fieldId: 'fld_button',
            isCurrent: () => current,
            configurationRevision: () => configRevision,
            button: {
                client,
                recovery: {
                    journal: buttonJournal,
                    loadVersion: 1,
                    scope: {
                        owner: 'visitor',
                        parentFieldId: null,
                        tableId: 'tbl_children',
                        childExtensionId: buttonLoaded.extensionId,
                        context: 'modal',
                    },
                },
            },
        });
        resources.push(() => buttonHost.dispose());
        let buttonProps;
        const buttonTree = () =>
            h(
                StrictMode,
                null,
                h(reactApi.FieldRenderer, {
                    host: buttonHost,
                    renderers: {
                        renderButtonField: (props) => {
                            buttonProps = props;
                            return h(
                                'span',
                                null,
                                props.capability.type === 'button'
                                    ? props.capability.button.phase
                                    : 'readonly'
                            );
                        },
                    },
                    fallback: () => null,
                })
            );
        await act(async () => root.render(buttonTree()));
        assert.equal(buttonProps.capability.type, 'button');
        assert.equal(buttonProps.capability.button.canTrigger, true);
        await act(async () =>
            assert.equal(
                (await buttonProps.capability.button.triggerWebhook()).type,
                'uncertain'
            )
        );
        assert.equal(io, 2);
        assert.equal(buttonJournal.unknown('visitor').length, 1);
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(buttonTree()));
        assert.equal(buttonProps.capability.button.phase, 'uncertain');
        assert.equal(buttonProps.capability.button.canTrigger, false);
        assert.equal(container.querySelector('span').textContent, 'uncertain');
        await act(async () =>
            assert.equal(
                (await buttonProps.capability.button.triggerWebhook()).type,
                'refused'
            )
        );
        assert.equal(buttonJournal.unknown('visitor').length, 1);
        assert.equal(io, 2);
        checks++;
        const oldForm = retained.get('form').capability,
            oldCell = retained.get('portal-cell').capability;
        await act(async () => fileProps.capability.attachment.clear());
        assert.equal(
            fields.attachment('fld_files', fileRecovery).getSnapshot().files
                .length,
            0
        );
        assert.deepEqual(oldForm.setValue('Form custom'), { accepted: true });
        assert.equal(
            owner.setCriteria(owner.getSnapshot().revision, {
                ...criteria,
                searchTerm: 'replacement',
            }),
            true
        );
        assert.deepEqual(oldCell.setValue('stale cell'), {
            accepted: false,
            reason: 'retired',
        });
        assert.equal(cell.binding.getSnapshot().retired, true);
        assert.equal(cell.binding.getSnapshot().value, undefined);
        assert.equal(detailHost.getSnapshot().status, 'retired');
        current = false;
        configRevision++;
        assert.deepEqual(oldForm.setValue('stale form'), {
            accepted: false,
            reason: 'retired',
        });
        assert.deepEqual(oldCell.setValue('stale cell'), {
            accepted: false,
            reason: 'retired',
        });
        assert.equal(
            fields.field('fld_title').getSnapshot().value,
            'Form custom'
        );
        assert.equal(cell.binding.getSnapshot().retired, true);
        assert.equal(cell.binding.getSnapshot().value, undefined);
        assert.equal(io, 2);
        checks++;
        return {
            checks,
            reactVersion: react.version,
            proof: 'synthetic installed ESM/CommonJS dispatch and actual Form/Portal owner React StrictMode/remount; no native browser or live backend',
        };
    } finally {
        await act(async () => root.unmount());
        resources.reverse().forEach((dispose) => dispose());
        keys.forEach((key, index) =>
            previous[index]
                ? Object.defineProperty(globalThis, key, previous[index])
                : Reflect.deleteProperty(globalThis, key)
        );
        await window.happyDOM.close();
    }
}
