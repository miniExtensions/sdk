import {
    AirtableFieldType,
    type FormLoadedResult,
    type SaveFormResult,
} from '../src/runtime/index.js';
import type { FormSaveOptions } from '../src/forms/index.js';
import { formResult } from './runtimeFixtures.js';

/** Synthetic, local-only examples: no API credentials or staging fixtures. */
export const loadedForm = (): FormLoadedResult => {
    const loaded = structuredClone(formResult);
    loaded.payload.formRecord = {
        type: 'create',
        data: {
            fld_title: 'Initial title',
            fld_parent: ['record_parent'],
            fld_prefill: false,
            fld_computed: 'Server formula value',
            fld_readonly: 'Locked value',
            fld_files: [
                {
                    url: 'https://files.example.test/prefill.txt',
                    filename: 'prefill.txt',
                },
            ],
        },
    };
    loaded.payload.formFieldIdsWithUnsavedChanges = ['fld_parent'];
    loaded.payload.urlPrefilledFieldIds = ['fld_prefill', 'fld_parent'];
    loaded.payload.fieldIdsInForm = [
        'fld_title',
        'fld_computed',
        'fld_readonly',
        'fld_missing',
        'fld_files',
    ];
    loaded.payload.fieldIdsToSchemas = {
        fld_title: {
            fieldType: AirtableFieldType.SINGLE_LINE_TEXT,
            airtableField: {
                id: 'fld_title',
                name: 'Title',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: AirtableFieldType.SINGLE_LINE_TEXT,
                    options: null,
                },
            },
            miniExtConfig: {
                title: 'Request title',
                conditionalFields: {
                    logicalOperator: 'and',
                    conditions: [],
                },
            },
        },
        fld_computed: {
            fieldType: AirtableFieldType.FORMULA,
            airtableField: {
                id: 'fld_computed',
                name: 'Computed',
                description: null,
                isComputed: true,
                isPrimaryField: false,
                config: {
                    type: AirtableFieldType.FORMULA,
                    options: {
                        isValid: true,
                        result: {
                            type: AirtableFieldType.SINGLE_LINE_TEXT,
                            options: null,
                        },
                    },
                },
            },
        },
        fld_readonly: {
            fieldType: AirtableFieldType.SINGLE_LINE_TEXT,
            airtableField: {
                id: 'fld_readonly',
                name: 'Read only',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: AirtableFieldType.SINGLE_LINE_TEXT,
                    options: null,
                },
            },
            miniExtConfig: { readOnly: true },
        },
        fld_files: {
            fieldType: AirtableFieldType.MULTIPLE_ATTACHMENTS,
            airtableField: {
                id: 'fld_files',
                name: 'Files',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: AirtableFieldType.MULTIPLE_ATTACHMENTS,
                    options: { isReversed: false },
                },
            },
        },
    };
    return loaded;
};

export const formSaveOptions = (): FormSaveOptions => ({
    captchaVal: 'captcha_example',
    isComputeMode: false,
    searchQuery: { prefill_Title: 'Initial title', repeated: ['One', 'Two'] },
    context: {
        type: 'modal',
        prefillData: {
            toLinkToParent: {
                reversedFieldIdToPrefill: 'fld_parent',
                parentFormRecordId: 'record_parent',
            },
            prefillQueryForChildExtension: null,
        },
    },
    conditionalLinkedRecordFieldIdsToFilteringValues: {
        fld_projects: { fld_region: null },
    },
    longitude: 1,
    latitude: 2,
    deviceFingerprint: { version: 1, visitorId: 'visitor_example' },
});

export const savedForm = (): Extract<SaveFormResult, { type: 'saved' }> => ({
    type: 'saved',
    record: { id: 'record_saved', fields: { fld_title: 'Saved title' } },
    loggedInUserRecord: {
        id: 'record_user',
        fields: { fld_projects: ['record_saved'] },
    },
    context: {
        type: 'modal',
        newTableIdsToLinkedTableStates: {
            table_projects: {
                airtableFields: [],
                recordIdsToAirtableRecords: {},
            },
        },
    },
    tableId: 'table_projects',
    postSubmissionWarnings: [{ type: 'adminNotificationEmailFailed' }],
    postSubmissionNotifications: [
        { type: 'saveAndContinueUpdateLinkEmailSent' },
    ],
});

export const invalidForm = (): Extract<SaveFormResult, { type: 'error' }> => ({
    type: 'error',
    formValidationErrors: [
        {
            fieldId: 'fld_title',
            fieldTitle: 'Request title',
            errorMessage: 'A title is required.',
        },
    ],
    formErrors: {
        fld_title: 'A title is required.',
        fld_files: 'Choose a supported attachment.',
        fld_other: 'Review this field.',
        fld_undefined: undefined,
    },
    concurrentEditErrorMessage: 'The record changed. Reload and review.',
});
