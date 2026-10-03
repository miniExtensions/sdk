import { AirtableFieldType } from '../formulas/types.js';
import type {
    AirtableValue,
    FormLoadedResult,
    RuntimeFieldSchema,
    RuntimeFormErrors,
    SaveFormInput,
    SaveFormResult,
} from '../runtime/types.js';
import {
    type FormDraftHandle,
    type FormDraftSnapshot,
    FormDraftStore,
    type ParentFormDraftScope,
} from './drafts.js';

/** Every remaining SaveFormInput property is supplied by the application. */
export type FormSaveOptions = Omit<
    SaveFormInput,
    'extensionAccessToken' | 'formRecord' | 'formFieldIdsWithUnsavedChanges'
>;

export type LoadedFormFieldDescriptor = {
    fieldId: string;
    title: string;
    fieldType: RuntimeFieldSchema['fieldType'];
    isComputed: boolean;
    readOnly: boolean;
    /** Returned configuration, copied intact; visibility rules are not evaluated. */
    schema: RuntimeFieldSchema;
};

export type FormValidationMessage = {
    fieldId: string;
    fieldTitle: string;
    errorMessage: string;
};

type SavedResult = Extract<SaveFormResult, { type: 'saved' }>;
type ErrorResult = Extract<SaveFormResult, { type: 'error' }>;
export type NormalizedFormSaveResult =
    | {
          type: 'saved';
          raw: SavedResult;
          validationErrors: FormValidationMessage[];
          concurrentEditErrorMessage: null;
          postSubmissionWarnings: NonNullable<
              SavedResult['postSubmissionWarnings']
          >;
          postSubmissionNotifications: NonNullable<
              SavedResult['postSubmissionNotifications']
          >;
      }
    | {
          type: 'error';
          raw: ErrorResult;
          validationErrors: FormValidationMessage[];
          concurrentEditErrorMessage: string | null;
          postSubmissionWarnings: [];
          postSubmissionNotifications: [];
      };

const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const fieldTypes = new Set<string>(Object.values(AirtableFieldType));
const computedFieldTypes = new Set<string>([
    AirtableFieldType.FORMULA,
    AirtableFieldType.ROLLUP,
    AirtableFieldType.COUNT,
    AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
    AirtableFieldType.AUTO_NUMBER,
    AirtableFieldType.CREATED_TIME,
    AirtableFieldType.LAST_MODIFIED_TIME,
    AirtableFieldType.CREATED_BY,
    AirtableFieldType.LAST_MODIFIED_BY,
]);

const requireString = (value: unknown, description: string): void => {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`${description} must be a nonempty string.`);
    }
};

const requireStringArray = (value: unknown, description: string): void => {
    if (!Array.isArray(value)) {
        throw new TypeError(`${description} must be an array.`);
    }
    for (const entry of value) requireString(entry, description);
};

const requireLoadedForm = (loaded: FormLoadedResult): void => {
    if (
        loaded.extensionScreen !== 'form_loaded' ||
        loaded.payload?.extensionType !== 'form'
    ) {
        throw new TypeError('A loaded Form result is required.');
    }
    requireString(loaded.extensionId, 'Extension ID');
    requireString(
        loaded.payload.extensionAccessToken,
        'Extension access token'
    );
    const record = loaded.payload.formRecord;
    if (
        !isObject(record) ||
        (record.type !== 'create' && record.type !== 'edit') ||
        !isObject(record.data)
    ) {
        throw new TypeError('The loaded Form record is malformed.');
    }
    if (record.type === 'edit') {
        requireString(record.recordId, 'Record ID');
        requireString(record.tableId, 'Table ID');
    }
    requireStringArray(
        loaded.payload.formFieldIdsWithUnsavedChanges,
        'Dirty Form field IDs'
    );
    if (loaded.payload.urlPrefilledFieldIds !== undefined) {
        requireStringArray(
            loaded.payload.urlPrefilledFieldIds,
            'URL-prefilled Form field IDs'
        );
    }
};

const fieldTitle = (fieldId: string, loaded?: FormLoadedResult): string => {
    const schemas = loaded?.payload.fieldIdsToSchemas;
    const schema =
        schemas !== undefined && Object.hasOwn(schemas, fieldId)
            ? schemas[fieldId]
            : undefined;
    const configured = schema?.miniExtConfig?.title;
    return typeof configured === 'string' && configured.trim() !== ''
        ? configured
        : (schema?.airtableField?.name ?? fieldId);
};

/** Ordered returned fields only; hidden native values remain in the draft. */
export const describeLoadedFormFields = (
    loaded: FormLoadedResult
): LoadedFormFieldDescriptor[] => {
    requireLoadedForm(loaded);
    requireStringArray(loaded.payload.fieldIdsInForm, 'Form field IDs');
    if (!isObject(loaded.payload.fieldIdsToSchemas)) {
        throw new TypeError('The loaded Form schemas are malformed.');
    }
    const seen = new Set<string>();
    const descriptors: LoadedFormFieldDescriptor[] = [];
    for (const fieldId of loaded.payload.fieldIdsInForm) {
        if (seen.has(fieldId)) continue;
        seen.add(fieldId);
        if (!Object.hasOwn(loaded.payload.fieldIdsToSchemas, fieldId)) continue;
        const schema = loaded.payload.fieldIdsToSchemas[fieldId];
        if (
            !isObject(schema) ||
            !isObject(schema.airtableField) ||
            !isObject(schema.airtableField.config) ||
            schema.airtableField.id !== fieldId ||
            typeof schema.fieldType !== 'string' ||
            !fieldTypes.has(schema.fieldType) ||
            schema.fieldType !== schema.airtableField.config.type ||
            (schema.airtableField.isComputed !== undefined &&
                typeof schema.airtableField.isComputed !== 'boolean') ||
            (schema.miniExtConfig !== undefined &&
                !isObject(schema.miniExtConfig)) ||
            (schema.miniExtConfig !== undefined &&
                'readOnly' in schema.miniExtConfig &&
                schema.miniExtConfig.readOnly !== undefined &&
                typeof schema.miniExtConfig.readOnly !== 'boolean')
        ) {
            throw new TypeError(`The Form schema is malformed: ${fieldId}`);
        }
        requireString(schema.airtableField.name, 'Form field name');
        const isComputed =
            schema.airtableField.isComputed === true ||
            computedFieldTypes.has(schema.fieldType);
        descriptors.push({
            fieldId,
            title: fieldTitle(fieldId, loaded),
            fieldType: schema.fieldType,
            isComputed,
            readOnly:
                isComputed ||
                (schema.miniExtConfig !== undefined &&
                    'readOnly' in schema.miniExtConfig &&
                    schema.miniExtConfig.readOnly === true),
            schema: structuredClone(schema),
        });
    }
    return descriptors;
};

export const openLoadedFormDraft = (options: {
    store: FormDraftStore<AirtableValue>;
    loaded: FormLoadedResult;
    parent?: ParentFormDraftScope | null;
}): FormDraftHandle => {
    const { store, loaded } = options;
    requireLoadedForm(loaded);
    return store.open(
        {
            extensionId: loaded.extensionId,
            recordId:
                loaded.payload.formRecord.type === 'edit'
                    ? loaded.payload.formRecord.recordId
                    : null,
            parent: options.parent ?? null,
        },
        loaded.payload.formRecord.data,
        [
            ...loaded.payload.formFieldIdsWithUnsavedChanges,
            ...(loaded.payload.urlPrefilledFieldIds ?? []),
        ]
    );
};

export const createFormSaveInput = (options: {
    loaded: FormLoadedResult;
    draft: FormDraftSnapshot<AirtableValue>;
    options: FormSaveOptions;
}): SaveFormInput => {
    requireLoadedForm(options.loaded);
    if (!isObject(options.draft.data)) {
        throw new TypeError('The Form draft values are malformed.');
    }
    requireStringArray(options.draft.dirtyFieldIds, 'Dirty Form field IDs');
    const remaining = options.options;
    if (
        (remaining.captchaVal !== null &&
            typeof remaining.captchaVal !== 'string') ||
        typeof remaining.isComputeMode !== 'boolean' ||
        !isObject(remaining.searchQuery) ||
        !isObject(remaining.context) ||
        !['direct-url', 'modal', 'side-panel', 'form-layout'].includes(
            remaining.context.type
        ) ||
        (remaining.context.type !== 'direct-url' &&
            remaining.context.prefillData !== null &&
            !isObject(remaining.context.prefillData)) ||
        !isObject(remaining.conditionalLinkedRecordFieldIdsToFilteringValues)
    ) {
        throw new TypeError('Complete Form save options are required.');
    }
    return structuredClone({
        ...remaining,
        extensionAccessToken: options.loaded.payload.extensionAccessToken,
        formRecord: {
            ...options.loaded.payload.formRecord,
            data: {
                ...options.loaded.payload.formRecord.data,
                ...options.draft.data,
            },
        },
        formFieldIdsWithUnsavedChanges: [
            ...new Set([
                ...options.loaded.payload.formFieldIdsWithUnsavedChanges,
                ...(options.loaded.payload.urlPrefilledFieldIds ?? []),
                ...options.draft.dirtyFieldIds,
            ]),
        ],
    });
};

/** Combine duplicate inline messages without losing separate global failures. */
export const formValidationMessages = (
    formErrors: RuntimeFormErrors,
    validationErrors: readonly FormValidationMessage[],
    loaded?: FormLoadedResult
): FormValidationMessage[] => {
    const messages: FormValidationMessage[] = [];
    const seen = new Set<string>();
    const add = (message: FormValidationMessage) => {
        if (
            !isObject(message) ||
            typeof message.fieldTitle !== 'string' ||
            typeof message.errorMessage !== 'string'
        ) {
            throw new TypeError('The Form validation message is malformed.');
        }
        requireString(message.fieldId, 'Validation field ID');
        const key = JSON.stringify([message.fieldId, message.errorMessage]);
        if (seen.has(key)) return;
        seen.add(key);
        messages.push(structuredClone(message));
    };
    if (!isObject(formErrors) || !Array.isArray(validationErrors)) {
        throw new TypeError('The Form validation errors are malformed.');
    }
    for (const error of validationErrors) add(error);
    for (const [fieldId, errorMessage] of Object.entries(formErrors)) {
        if (errorMessage !== undefined) {
            if (typeof errorMessage !== 'string') {
                throw new TypeError(
                    'The Form validation message is malformed.'
                );
            }
            add({
                fieldId,
                fieldTitle: fieldTitle(fieldId, loaded),
                errorMessage,
            });
        }
    }
    return messages;
};

export const normalizeFormSaveResult = (
    result: SaveFormResult,
    loaded?: FormLoadedResult
): NormalizedFormSaveResult => {
    if (!isObject(result)) {
        throw new TypeError('The Form save result is malformed.');
    }
    if (result.type === 'saved') {
        const validRecord = (record: unknown) =>
            isObject(record) &&
            typeof record.id === 'string' &&
            record.id.trim() !== '' &&
            isObject(record.fields);
        if (
            !validRecord(result.record) ||
            (result.loggedInUserRecord !== null &&
                !validRecord(result.loggedInUserRecord)) ||
            typeof result.tableId !== 'string' ||
            result.tableId.trim() === '' ||
            !isObject(result.context) ||
            !['direct-url', 'modal', 'side-panel', 'form-layout'].includes(
                result.context.type
            ) ||
            (result.context.type !== 'direct-url' &&
                !isObject(result.context.newTableIdsToLinkedTableStates)) ||
            (result.postSubmissionWarnings !== undefined &&
                !Array.isArray(result.postSubmissionWarnings)) ||
            (result.postSubmissionNotifications !== undefined &&
                !Array.isArray(result.postSubmissionNotifications))
        ) {
            throw new TypeError('The Form save result is malformed.');
        }
        return {
            type: 'saved',
            raw: structuredClone(result),
            validationErrors: [],
            concurrentEditErrorMessage: null,
            postSubmissionWarnings: structuredClone(
                result.postSubmissionWarnings ?? []
            ),
            postSubmissionNotifications: structuredClone(
                result.postSubmissionNotifications ?? []
            ),
        };
    }
    if (result.type !== 'error') {
        throw new TypeError('The Form save result is malformed.');
    }
    if (
        result.concurrentEditErrorMessage !== undefined &&
        typeof result.concurrentEditErrorMessage !== 'string'
    ) {
        throw new TypeError('The Form concurrent edit error is malformed.');
    }
    return {
        type: 'error',
        raw: structuredClone(result),
        validationErrors: formValidationMessages(
            result.formErrors,
            result.formValidationErrors,
            loaded
        ),
        concurrentEditErrorMessage: result.concurrentEditErrorMessage ?? null,
        postSubmissionWarnings: [],
        postSubmissionNotifications: [],
    };
};
