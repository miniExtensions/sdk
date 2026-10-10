import type {
    FormLoadedResult,
    LoadExtensionInput,
    RuntimeFieldSchema,
    SaveFormResult,
} from '../src/runtime/types.js';
import type { FormSaveOptions } from '../src/forms/helpers.js';
import { formResult } from './runtimeFixtures.js';

// All identifiers, credentials and values are synthetic; transport is never used.
const link = (
    id: string,
    targetTable: string,
    inverseField: string,
    config: Extract<
        RuntimeFieldSchema,
        { fieldType: 'multipleRecordLinks' }
    >['miniExtConfig'] = {}
): Extract<RuntimeFieldSchema, { fieldType: 'multipleRecordLinks' }> => ({
    fieldType: 'multipleRecordLinks',
    airtableField: {
        id,
        name: id,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type: 'multipleRecordLinks',
            options: {
                linkedTableId: targetTable,
                inverseLinkFieldId: inverseField,
                isReversed: false,
                prefersSingleRecordLink: false,
            },
        },
    },
    miniExtConfig: structuredClone(config),
});
const title: RuntimeFieldSchema = {
    fieldType: 'singleLineText',
    airtableField: {
        id: 'fld_title',
        name: 'Title',
        description: null,
        isComputed: false,
        isPrimaryField: true,
        config: { type: 'singleLineText', options: null },
    },
    miniExtConfig: {},
};
const configuredCreation = {
    allowCreatingRecords: true,
    allowEditingRecords: true,
    formsForEditingAndCreating: 'same-form',
    extensionIdForCreatingAndEditing: 'form_child_synthetic',
    prefillChildFormForCreatingRecords: false,
    maxRecordsToSelectOrCreate: 'unlimited',
    layout: 'list',
} as const;

export function parentForm(
    mode: 'create' | 'edit' = 'create'
): FormLoadedResult {
    const page = structuredClone(formResult);
    page.extensionId = 'form_parent_synthetic';
    page.workspaceId = 'workspace_synthetic';
    page.payload.baseId = 'base_synthetic';
    page.payload.extensionAccessToken = 'synthetic_parent_token';
    page.payload.publicFields.state.tableId = 'tbl_parent';
    page.payload.publicFields.state.multiPageFormMode = 'one-page';
    page.payload.publicFields.state.promptUserBeforeSubmission = false;
    page.payload.publicFields.state.enableFormComputeMode = false;
    page.payload.formRecord =
        mode === 'create'
            ? { type: 'create', data: {} }
            : {
                  type: 'edit',
                  recordId: 'rec_parent',
                  tableId: 'tbl_parent',
                  data: {},
              };
    page.payload.formRecord.data = {
        fld_title: 'Parent native title',
        fld_children_a: ['rec_existing', 'rec_existing', 'rec_sibling'],
        fld_children_b: ['rec_other_field'],
        fld_unrendered: 'Unrendered synthetic value',
    };
    page.payload.fieldIdsInForm = [
        'fld_title',
        'fld_children_a',
        'fld_children_b',
    ];
    page.payload.fieldIdsToSchemas = {
        fld_title: structuredClone(title),
        fld_children_a: link(
            'fld_children_a',
            'tbl_child',
            'fld_parent_a',
            configuredCreation
        ),
        fld_children_b: link(
            'fld_children_b',
            'tbl_child',
            'fld_parent_b',
            configuredCreation
        ),
    };
    page.payload.fieldNamesToSchemas = Object.fromEntries(
        Object.values(page.payload.fieldIdsToSchemas).map((schema) => [
            schema.airtableField.name,
            structuredClone(schema),
        ])
    );
    page.payload.formFieldIdsWithUnsavedChanges = ['fld_title'];
    page.payload.urlPrefilledFieldIds = [];
    page.payload.linkedRecordFieldIdToDetailFields = {};
    return page;
}

export function childForm(
    parentMode: 'create' | 'edit' = 'create'
): FormLoadedResult {
    const page = structuredClone(formResult);
    page.extensionId = 'form_child_synthetic';
    page.workspaceId = 'workspace_synthetic';
    page.payload.baseId = 'base_synthetic';
    page.payload.hasParentExtension = true;
    page.payload.extensionAccessToken = 'synthetic_child_token';
    page.payload.publicFields.state.tableId = 'tbl_child';
    page.payload.publicFields.state.multiPageFormMode = 'one-page';
    page.payload.publicFields.state.promptUserBeforeSubmission = false;
    page.payload.publicFields.state.enableFormComputeMode = false;
    page.payload.formRecord = {
        type: 'create',
        data: {
            fld_title: 'Child native title',
            fld_parent_a: parentMode === 'edit' ? ['rec_parent'] : [],
            fld_parent_b: [],
            fld_unrendered: 'Unrendered child synthetic value',
        },
    };
    page.payload.fieldIdsInForm = ['fld_title', 'fld_parent_a', 'fld_parent_b'];
    page.payload.fieldIdsToSchemas = {
        fld_title: structuredClone(title),
        fld_parent_a: link('fld_parent_a', 'tbl_parent', 'fld_children_a'),
        fld_parent_b: link('fld_parent_b', 'tbl_parent', 'fld_children_b'),
    };
    page.payload.fieldNamesToSchemas = Object.fromEntries(
        Object.values(page.payload.fieldIdsToSchemas).map((schema) => [
            schema.airtableField.name,
            structuredClone(schema),
        ])
    );
    page.payload.formFieldIdsWithUnsavedChanges = ['fld_title'];
    page.payload.urlPrefilledFieldIds = [];
    page.payload.linkedRecordFieldIdToDetailFields = {};
    return page;
}

export function childLoadInput(
    parentMode: 'create' | 'edit' = 'create'
): LoadExtensionInput {
    return {
        childExtensionAccessData: {
            parentExtensionAccessToken: 'synthetic_parent_token',
            fieldIdUsedToAccessExtension: 'fld_children_a',
        },
        childExtensionInfo: {
            childExtensionId: 'form_child_synthetic',
            accessType: { type: 'create' },
        },
        context: {
            type: 'modal',
            linkedTableIdOfLinkedRecordField: 'tbl_child',
            prefillDataForLinkedRecordsForm:
                parentMode === 'edit'
                    ? {
                          toLinkToParent: {
                              reversedFieldIdToPrefill: 'fld_parent_a',
                              parentFormRecordId: 'rec_parent',
                          },
                          prefillQueryForChildExtension: null,
                      }
                    : {
                          toLinkToParent: null,
                          prefillQueryForChildExtension: null,
                      },
        },
        query: {},
    };
}

export function childSaveOptions(
    parentMode: 'create' | 'edit' = 'create'
): FormSaveOptions {
    const input = childLoadInput(parentMode);
    if (input.context.type !== 'modal')
        throw Error('Synthetic modal fixture required');
    return {
        captchaVal: null,
        isComputeMode: false,
        searchQuery: {},
        context: {
            type: 'modal',
            prefillData: input.context.prefillDataForLinkedRecordsForm,
        },
        conditionalLinkedRecordFieldIdsToFilteringValues: {},
    };
}

export function childSaved(
    parentMode: 'create' | 'edit' = 'create'
): Extract<SaveFormResult, { type: 'saved' }> {
    const page = childForm(parentMode);
    const fields = structuredClone(page.payload.formRecord.data);
    return {
        type: 'saved',
        record: { id: 'rec_created', fields },
        loggedInUserRecord: null,
        context: {
            type: 'modal',
            newTableIdsToLinkedTableStates: {
                tbl_child: {
                    airtableFields: Object.values(
                        page.payload.fieldIdsToSchemas
                    ).map((schema) => structuredClone(schema.airtableField)),
                    recordIdsToAirtableRecords: {
                        rec_created: {
                            id: 'rec_created',
                            fields: structuredClone(fields),
                        },
                    },
                },
            },
        },
        tableId: 'tbl_child',
    };
}

export const validationError: Extract<SaveFormResult, { type: 'error' }> = {
    type: 'error',
    formValidationErrors: [
        {
            fieldId: 'fld_title',
            fieldTitle: 'Title',
            errorMessage: 'Synthetic validation error',
        },
    ],
    formErrors: { fld_title: 'Synthetic validation error' },
};
