import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { transform } from 'esbuild';
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
    multipleLookupValues:
        'Extract<AirtableValue, readonly unknown[] | {error:string}>',
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
import type { AirtableValue, AirtableCollaborator, AirtableAttachment, AirtableBarcodeValue, UploadFileResult } from '@miniextensions/sdk';
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
declare const attachment: FieldRendererProps<'multipleAttachments'>;
if(attachment.capability.type==='editable' && attachment.capability.attachment){
 const selected:boolean=attachment.capability.attachment.select([] as readonly File[]);
 const uploading:Promise<boolean>=attachment.capability.attachment.upload();
 attachment.capability.attachment.cancel();
 void [selected,uploading];
}
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
const lookupError: FieldReadValue<'multipleLookupValues'> = {error:'#REF!'};
// @ts-expect-error top-level lookup errors carry native string errors
const malformedLookupError: FieldReadValue<'multipleLookupValues'> = {error:1};
const upload: UploadFileResult = {id:null,url:'https://files.example.invalid/upload',filename:'synthetic.txt',size:15,type:'text/plain'};
const uploadedNative: FieldReadValue<'multipleAttachments'> = [upload];
// @ts-expect-error attachment filenames may be omitted but cannot be null
const nullAttachmentFilename: FieldReadValue<'multipleAttachments'> = [{url:'https://files.example.invalid',filename:null}];
// @ts-expect-error attachment media types may be omitted but cannot be null
const nullAttachmentType: FieldReadValue<'multipleAttachments'> = [{url:'https://files.example.invalid',type:null}];
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
void [lookupError,malformedLookupError,upload,uploadedNative,nullAttachmentFilename,nullAttachmentType,rendered,exhaustive,absentConfig,nullConfig,richTextConfig,checkboxWithRichTextOption,numberMetadata,percentMetadata];
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
        const rendererGuide = readFileSync(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/docs/field-bindings.md'
            ),
            'utf8'
        );
        const recipeBlocks = [
            ...rendererGuide.matchAll(/```tsx\n([\s\S]*?)\n```/g),
        ]
            .map(([, code]) => code)
            .filter((code) => code.includes('export function CustomFields('));
        assert.equal(
            recipeBlocks.length,
            1,
            'Missing unique installed CustomFields recipe'
        );
        const recipe = await transform(recipeBlocks[0], {
            loader: 'tsx',
            jsx: 'automatic',
            format: 'esm',
            target: 'es2022',
            sourcefile: 'installed-custom-fields.tsx',
        });
        const recipePath = join(
            consumerDirectory,
            'installed-custom-fields.mjs'
        );
        writeFileSync(recipePath, recipe.code);
        const { CustomFields } = await import(pathToFileURL(recipePath));
        let recipeSubscriptions = 0,
            recipeUnsubscriptions = 0,
            recipeDisposals = 0;
        const documentedField = {
            physicalKind: 'singleLineText',
            fieldId: 'fld_doc',
            title: 'Documented field',
            field: {
                id: 'fld_doc',
                name: 'Documented field',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: { type: 'singleLineText', options: null },
            },
            displayConfig: undefined,
            value: 'Documented native leaf',
            context: 'form',
            computed: false,
            dirty: false,
            pending: false,
            validation: [],
            error: null,
            capability: { type: 'readonly' },
        };
        const documentedHost = (snapshot) => ({
            getSnapshot: () => snapshot,
            subscribe: () => {
                recipeSubscriptions++;
                return () => recipeUnsubscriptions++;
            },
            dispose: () => recipeDisposals++,
        });
        for (const status of [
            'ready',
            'hidden',
            'retired',
            'unavailable',
            'blocked',
            'missing-renderer',
        ]) {
            const snapshot =
                status === 'ready'
                    ? { status: 'ready', fields: [documentedField] }
                    : status === 'missing-renderer'
                      ? {
                            status: 'ready',
                            fields: [
                                {
                                    ...documentedField,
                                    physicalKind: 'number',
                                    value: 0,
                                    field: {
                                        ...documentedField.field,
                                        config: {
                                            type: 'number',
                                            options: { precision: 0 },
                                        },
                                    },
                                },
                            ],
                        }
                      : { status, reason: 'Synthetic documented status' };
            await act(async () =>
                root.render(
                    h(
                        StrictMode,
                        null,
                        h(CustomFields, { host: documentedHost(snapshot) })
                    )
                )
            );
            if (status === 'hidden' || status === 'retired') {
                assert.equal(
                    container.textContent,
                    '',
                    `Documented ${status} must stay silent`
                );
                assert.equal(container.innerHTML, '', 'No placeholder DOM');
            } else if (status === 'ready')
                assert.equal(container.textContent, 'Documented native leaf');
            else
                assert.equal(
                    container.textContent,
                    'Field unavailable.',
                    `Documented ${status} must show a visible refusal`
                );
            assert.equal(recipeDisposals, 0);
        }
        await act(async () => root.render(null));
        assert.equal(recipeSubscriptions, recipeUnsubscriptions);
        assert.equal(recipeDisposals, 0);
        checks++;
        let uploadCalls = 0,
            buttonCalls = 0;
        const uploaded = {
            id: null,
            url: 'https://files.example.invalid/upload',
            filename: 'synthetic.txt',
            size: 15,
            type: 'text/plain',
        };
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
            attachments: {
                uploadFile: async (input) => {
                    io++;
                    uploadCalls++;
                    assert.equal(input.fieldId, 'fld_files');
                    assert.equal(input.filename, 'synthetic.txt');
                    return { ...uploaded };
                },
            },
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
        assert.equal(uploadCalls, 0);
        await act(async () =>
            assert.equal(await fileProps.capability.attachment.upload(), true)
        );
        assert.equal(uploadCalls, 1);
        assert.equal(io, 2);
        assert.equal(fileHost.getSnapshot().status, 'ready');
        assert.equal(fileProps.capability.type, 'editable');
        assert.deepEqual(fileProps.value, [uploaded]);
        assert.equal(fileProps.value[0].id, null);
        assert.equal(typeof fileProps.capability.attachment.select, 'function');
        assert.equal(fileProps.capability.attachment.state.files.length, 0);
        assert.deepEqual(fields.field('fld_files').getSnapshot().value, [
            uploaded,
        ]);
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
                buttonCalls++;
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
        assert.equal(io, 3);
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
        assert.equal(buttonCalls, 1);
        assert.equal(io, 3);
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
        assert.equal(io, 3);
        checks++;
        const choiceLoaded = structuredClone(loaded);
        choiceLoaded.payload.fieldIdsInForm = ['fld_title', 'fld_choices'];
        choiceLoaded.payload.fieldIdsToSchemas = {
            fld_title: choiceLoaded.payload.fieldIdsToSchemas.fld_title,
            fld_choices: choiceLoaded.payload.fieldIdsToSchemas.fld_choices,
        };
        choiceLoaded.payload.fieldIdsToSchemas.fld_choices.airtableField.config.options.choices =
            [{ id: 'a', name: 'Alpha' }];
        choiceLoaded.payload.fieldIdsToSchemas.fld_choices.miniExtConfig = {
            allowAddingNewOptions: true,
        };
        choiceLoaded.payload.formRecord = {
            type: 'create',
            data: { fld_title: 'Choice owner text', fld_choices: ['Alpha'] },
        };
        let choiceCalls = 0,
            choiceSaves = 0;
        const choiceClient = {
            getSession: () => ({}),
            forms: {
                addSelectOption: async () => {
                    choiceCalls++;
                    return { newChoice: { id: 'b', name: 'Beta' } };
                },
                save: async () => {
                    choiceSaves++;
                    throw Error('No automatic choice Save');
                },
            },
        };
        const choiceFields = forms.createFormFieldBindings({
            loaded: choiceLoaded,
            client: choiceClient,
            getScope: () => ({ ownerId: 'choice-visitor', revision: 0 }),
            saveOptions: {
                captchaVal: null,
                isComputeMode: false,
                context: { type: 'direct-url' },
                searchQuery: {},
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        });
        resources.push(() => choiceFields.destroy());
        choiceFields.selectChoice('fld_choices', {
            journal: new forms.RecoveryJournal(),
            loadVersion: 1,
            scope: {
                owner: 'choice-visitor',
                parentFieldId: null,
                tableId: null,
                childExtensionId: choiceLoaded.extensionId,
                context: 'direct-url',
            },
        });
        const choiceTextHost = ui.createFormFieldRendererHost({
            fields: choiceFields,
            fieldId: 'fld_title',
            isCurrent: () => true,
            configurationRevision: () => 0,
        });
        resources.push(() => choiceTextHost.dispose());
        const choiceSelectHost = ui.createFormFieldRendererHost({
            fields: choiceFields,
            fieldId: 'fld_choices',
            isCurrent: () => true,
            configurationRevision: () => 0,
        });
        resources.push(() => choiceSelectHost.dispose());
        let ownedChoiceProps, ownedTextProps;
        const choiceRenderers = {
            renderSingleLineTextField: (props) => {
                ownedTextProps = props;
                return h('span', { 'data-choice-text': true }, props.value);
            },
            renderMultipleSelectsField: (props) => {
                ownedChoiceProps = props;
                return h(
                    'span',
                    { 'data-choice-options': true },
                    props.field.config.options.choices
                        .map((choice) => choice.name)
                        .join(',')
                );
            },
        };
        const choiceTree = () =>
            h(
                StrictMode,
                null,
                h(reactApi.FieldRenderer, {
                    host: choiceTextHost,
                    renderers: choiceRenderers,
                    fallback: () => null,
                }),
                h(reactApi.FieldRenderer, {
                    host: choiceSelectHost,
                    renderers: choiceRenderers,
                    fallback: () => null,
                })
            );
        await act(async () => root.render(choiceTree()));
        assert.equal(choiceCalls, 0);
        assert.equal(choiceSaves, 0);
        assert.equal(ownedChoiceProps.capability.type, 'editable');
        const retainedTextAction = ownedTextProps.capability.setValue;
        await act(async () =>
            assert.equal(
                await ownedChoiceProps.capability.choice.create('Beta'),
                true
            )
        );
        assert.equal(choiceCalls, 1);
        assert.equal(choiceSaves, 0);
        assert.deepEqual(
            choiceFields.field('fld_choices').getSnapshot().value,
            ['Alpha', 'Beta']
        );
        assert.equal(choiceSelectHost.getSnapshot().status, 'ready');
        assert.equal(choiceTextHost.getSnapshot().status, 'ready');
        assert.deepEqual(
            ownedChoiceProps.field.config.options.choices.map(
                (choice) => choice.name
            ),
            ['Alpha', 'Beta']
        );
        await act(async () =>
            assert.deepEqual(retainedTextAction('Still editable'), {
                accepted: true,
            })
        );
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(choiceTree()));
        assert.equal(
            container.querySelector('[data-choice-options]').textContent,
            'Alpha,Beta'
        );
        assert.equal(
            container.querySelector('[data-choice-text]').textContent,
            'Still editable'
        );
        assert.deepEqual(ownedChoiceProps.value, ['Alpha', 'Beta']);
        assert.deepEqual(ownedChoiceProps.capability.selection.state.value, [
            'Alpha',
            'Beta',
        ]);
        assert.equal(choiceCalls, 1);
        assert.equal(choiceSaves, 0);
        checks++;
        const acceptedPortal = async (fields, values, portalApi) => {
            const accepted = fixtures.makePortal();
            Object.values(accepted.payload.fieldIdsToSchemas).forEach(
                (schema) => {
                    schema.airtableField = completeField(schema.airtableField);
                }
            );
            const linkConfig =
                accepted.payload.fieldIdsToSchemas.fld_children.miniExtConfig;
            linkConfig.disableInlineEdit = false;
            linkConfig.customViews[0].config = {
                ...linkConfig.customViews[0].config,
                layout: 'grid',
                disableInlineEdit: false,
            };
            accepted.payload.initialLinkedTableStates.tbl_children.airtableFields =
                fields;
            accepted.payload.linkedRecordFieldIdToDetailFields.fld_children =
                fields.map((field) => ({
                    fieldId: field.id,
                    fieldName: field.name,
                    titleOverride: null,
                    isHidden: false,
                    fieldIsInEditingChildForm: true,
                    childFormField: null,
                }));
            let reads = 0,
                writes = 0;
            const acceptedClient = {
                getSession: () => ({}),
                portals: {
                    listLinkedRecords: async () => {
                        reads++;
                        const page = fixtures.page([
                            { id: 'rec_one', fields: values },
                        ]);
                        page.tableIdsToLinkedTableStates.tbl_children.airtableFields =
                            fields;
                        return page;
                    },
                    updateGridCell: async () => {
                        writes++;
                        throw Error('Readonly native cells cannot Save');
                    },
                },
            };
            const acceptedOwner = portalApi.createPortalListOwner({
                client: acceptedClient,
                portal: accepted,
                portalFieldId: 'fld_children',
                criteria,
                getScope: () => ({ ownerId: 'native-owner', revision: 0 }),
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            resources.push(() => acceptedOwner.destroy());
            assert.equal(reads, 0);
            assert.equal(
                await acceptedOwner.readFirst(
                    acceptedOwner.getSnapshot().revision,
                    { pagesToFetch: 1, refreshLoggedInPortalRecord: false }
                ),
                true
            );
            return {
                owner: acceptedOwner,
                client: acceptedClient,
                counts: () => ({ reads, writes }),
            };
        };
        for (const [portalApi, uiApi] of [
            [portals, ui],
            [consumer('@miniextensions/sdk/portals'), cjs],
        ]) {
            const lookupField = completeField({
                id: 'fld_lookup',
                name: 'Lookup',
                isComputed: true,
                config: {
                    type: 'multipleLookupValues',
                    options: {
                        isValid: false,
                        recordLinkFieldId: 'fld_parent',
                        fieldIdInLinkedTable: 'fld_title',
                        result: null,
                    },
                },
            });
            const nativeError = { error: '#REF!' };
            const accepted = await acceptedPortal(
                [lookupField],
                { fld_lookup: nativeError },
                portalApi
            );
            const lookupHost = uiApi.createPortalDetailRendererHost({
                owner: accepted.owner,
                client: accepted.client,
                recordId: 'rec_one',
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            resources.push(() => lookupHost.dispose());
            const snapshot = lookupHost.getSnapshot();
            assert.equal(snapshot.status, 'ready');
            assert.equal(snapshot.fields.length, 1);
            const props = snapshot.fields[0];
            assert.equal(props.physicalKind, 'multipleLookupValues');
            assert.deepEqual(props.value, nativeError);
            assert.equal(Array.isArray(props.value), false);
            assert.equal(props.capability.type, 'readonly');
            assert.equal('setValue' in props.capability, false);
            assert.equal(
                uiApi.dispatchField(
                    {
                        renderMultipleLookupValuesField: (received) =>
                            received.value,
                    },
                    props,
                    () => assert.fail('lookup errored')
                ),
                props.value
            );
            assert.deepEqual(accepted.counts(), { reads: 1, writes: 0 });
        }
        checks++;
        const nativePerson = {
            id: 'usr_alpha',
            name: 'Alpha',
            email: 'alpha@example.invalid',
        };
        const nativeCases = [
            [
                'barcode',
                { text: '012345', type: 'code128' },
                { type: 'barcode', options: null },
            ],
            [
                'singleCollaborator',
                nativePerson,
                {
                    type: 'singleCollaborator',
                    options: { choices: [nativePerson] },
                },
            ],
            [
                'multipleCollaborators',
                [nativePerson],
                {
                    type: 'multipleCollaborators',
                    options: { choices: [nativePerson] },
                },
            ],
        ];
        const nativeFields = nativeCases.map(([kind, , config]) =>
            completeField({ id: 'fld_' + kind, name: kind, config })
        );
        const nativeValues = Object.fromEntries(
            nativeCases.map(([kind, value]) => ['fld_' + kind, value])
        );
        const nativeAccepted = await acceptedPortal(
            nativeFields,
            nativeValues,
            portals
        );
        for (const [index, [kind, value]] of nativeCases.entries()) {
            const nativeCell = portals.createPortalCellBinding({
                client: nativeAccepted.client,
                schema: { fieldType: kind, airtableField: nativeFields[index] },
                value,
                input: {
                    portalExtensionAccessToken: 'portal_access_example',
                    portalFieldId: 'fld_children',
                    recordFieldId: 'fld_' + kind,
                    recordId: 'rec_one',
                    selectedCustomViewId: 'view_example',
                },
                getScope: () => ({ ownerId: 'native-owner', revision: 0 }),
                isCurrent: () => true,
                recovery: {
                    journal: new forms.RecoveryJournal(),
                    scope: {
                        owner: 'native-owner',
                        parentFieldId: 'fld_children',
                        tableId: 'tbl_children',
                        childExtensionId: '',
                        context: 'modal',
                    },
                    loadVersion: 1,
                },
            });
            resources.push(() => nativeCell.destroy());
            const nativeHost = ui.createPortalCellRendererHost({
                cell: nativeCell,
                owner: nativeAccepted.owner,
                client: nativeAccepted.client,
                recordId: 'rec_one',
                fieldId: 'fld_' + kind,
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            resources.push(() => nativeHost.dispose());
            const snapshot = nativeHost.getSnapshot();
            assert.equal(snapshot.status, 'ready');
            assert.equal(snapshot.fields[0].capability.type, 'readonly');
            assert.equal('setValue' in snapshot.fields[0].capability, false);
            assert.deepEqual(snapshot.fields[0].value, value);
            assert.deepEqual(nativeCell.binding.getSnapshot().value, value);
        }
        assert.deepEqual(nativeAccepted.counts(), { reads: 1, writes: 0 });
        checks++;
        let disposeOnCheck = false,
            disposalHost;
        disposalHost = ui.createFormFieldRendererHost({
            fields: choiceFields,
            fieldId: 'fld_title',
            isCurrent: () => {
                if (disposeOnCheck) disposalHost.dispose();
                return true;
            },
            configurationRevision: () => 0,
        });
        resources.push(() => disposalHost.dispose());
        let disposalProps;
        await act(async () =>
            root.render(
                h(reactApi.FieldRenderer, {
                    host: disposalHost,
                    renderers: {
                        renderSingleLineTextField: (props) => {
                            disposalProps = props;
                            return h('span', null, props.value);
                        },
                    },
                    fallback: () => null,
                })
            )
        );
        const beforeDisposal = choiceFields
            .field('fld_title')
            .getSnapshot().value;
        const retainedDisposalAction = disposalProps.capability.setValue;
        disposeOnCheck = true;
        assert.deepEqual(
            retainedDisposalAction('Must not write after disposal'),
            { accepted: false, reason: 'retired' }
        );
        assert.equal(
            choiceFields.field('fld_title').getSnapshot().value,
            beforeDisposal
        );
        assert.equal(disposalHost.getSnapshot().status, 'retired');
        assert.equal(choiceCalls, 1);
        assert.equal(choiceSaves, 0);
        checks++;
        const busyLoaded = structuredClone(loaded);
        busyLoaded.payload.fieldIdsInForm = ['fld_files'];
        busyLoaded.payload.fieldIdsToSchemas = {
            fld_files: busyLoaded.payload.fieldIdsToSchemas.fld_files,
        };
        busyLoaded.payload.formRecord = {
            type: 'create',
            data: { fld_files: [] },
        };
        let busyCalls = 0,
            busySaves = 0;
        const uploadResolvers = [];
        const busyClient = {
            getSession: () => ({}),
            forms: {
                save: async () => {
                    busySaves++;
                    throw Error('No automatic busy Save');
                },
            },
            attachments: {
                uploadFile: (input) => {
                    busyCalls++;
                    return new Promise((resolve) =>
                        uploadResolvers.push(() =>
                            resolve({
                                id: null,
                                url:
                                    'https://files.example.invalid/' +
                                    input.filename,
                                filename: input.filename,
                                size: input.file.size,
                                type: input.file.type,
                            })
                        )
                    );
                },
            },
        };
        const busyFields = forms.createFormFieldBindings({
            loaded: busyLoaded,
            client: busyClient,
            getScope: () => ({ ownerId: 'busy-owner', revision: 0 }),
            saveOptions: {
                captchaVal: null,
                isComputeMode: false,
                context: { type: 'direct-url' },
                searchQuery: {},
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        });
        resources.push(() => busyFields.destroy());
        const busyJournal = new forms.RecoveryJournal();
        const busyRecovery = {
            journal: busyJournal,
            loadVersion: 1,
            scope: {
                owner: 'busy-owner',
                parentFieldId: null,
                tableId: null,
                childExtensionId: busyLoaded.extensionId,
                context: 'direct-url',
            },
        };
        const busyHost = ui.createFormFieldRendererHost({
            fields: busyFields,
            fieldId: 'fld_files',
            isCurrent: () => true,
            configurationRevision: () => 0,
            attachmentRecovery: busyRecovery,
        });
        resources.push(() => busyHost.dispose());
        let busyProps;
        const busyTree = () =>
            h(
                StrictMode,
                null,
                h(reactApi.FieldRenderer, {
                    host: busyHost,
                    renderers: {
                        renderMultipleAttachmentsField: (props) => {
                            busyProps = props;
                            return h(
                                'span',
                                null,
                                props.capability.type === 'editable'
                                    ? String(
                                          props.capability.attachment.state
                                              .files.length
                                      )
                                    : 'readonly'
                            );
                        },
                    },
                    fallback: () => null,
                })
            );
        await act(async () => root.render(busyTree()));
        assert.equal(busyCalls, 0);
        const fileA = new window.File(['A'], 'A.txt', { type: 'text/plain' }),
            fileB = new window.File(['B'], 'B.txt', { type: 'text/plain' });
        await act(async () =>
            assert.equal(busyProps.capability.attachment.select([fileA]), true)
        );
        let flightA;
        await act(async () => {
            flightA = busyProps.capability.attachment.upload();
        });
        assert.equal(busyCalls, 1);
        await act(async () =>
            assert.equal(busyProps.capability.attachment.select([fileB]), true)
        );
        assert.equal(busyProps.capability.attachment.state.files[0], fileB);
        await act(async () => {
            uploadResolvers[0]();
            assert.equal(await flightA, true);
        });
        assert.equal(busyHost.getSnapshot().status, 'ready');
        assert.equal(busyProps.capability.attachment.state.files[0], fileB);
        assert.equal(busyProps.capability.attachment.state.files.length, 1);
        assert.equal(
            busyFields.field('fld_files').getSnapshot().value[0].filename,
            'A.txt'
        );
        assert.equal(
            busyFields.field('fld_files').getSnapshot().value.length,
            1
        );
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(busyTree()));
        assert.equal(busyProps.capability.attachment.state.files[0], fileB);
        assert.equal(busyCalls, 1);
        assert.equal(busySaves, 0);
        let flightB;
        await act(async () => {
            flightB = busyProps.capability.attachment.upload();
        });
        assert.equal(busyCalls, 2);
        await act(async () => busyProps.capability.attachment.cancel());
        assert.equal(busyJournal.unknown('busy-owner').length, 1);
        assert.equal(busyProps.capability.attachment.state.files[0], fileB);
        await act(async () => {
            uploadResolvers[1]();
            assert.equal(await flightB, false);
        });
        await act(async () =>
            assert.equal(await busyProps.capability.attachment.upload(), false)
        );
        assert.equal(busyCalls, 2);
        assert.equal(busySaves, 0);
        assert.equal(busyProps.capability.attachment.state.files[0], fileB);
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
