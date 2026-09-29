/** Field kinds understood by the formula evaluator. */
export enum AirtableFieldType {
    SINGLE_LINE_TEXT = 'singleLineText',
    EMAIL = 'email',
    URL = 'url',
    MULTILINE_TEXT = 'multilineText',
    NUMBER = 'number',
    PERCENT = 'percent',
    CURRENCY = 'currency',
    SINGLE_SELECT = 'singleSelect',
    MULTIPLE_SELECTS = 'multipleSelects',
    SINGLE_COLLABORATOR = 'singleCollaborator',
    MULTIPLE_COLLABORATORS = 'multipleCollaborators',
    MULTIPLE_RECORD_LINKS = 'multipleRecordLinks',
    DATE = 'date',
    DATE_TIME = 'dateTime',
    PHONE_NUMBER = 'phoneNumber',
    MULTIPLE_ATTACHMENTS = 'multipleAttachments',
    CHECKBOX = 'checkbox',
    FORMULA = 'formula',
    CREATED_TIME = 'createdTime',
    ROLLUP = 'rollup',
    COUNT = 'count',
    MULTIPLE_LOOKUP_VALUES = 'multipleLookupValues',
    AUTO_NUMBER = 'autoNumber',
    BARCODE = 'barcode',
    RATING = 'rating',
    RICH_TEXT = 'richText',
    DURATION = 'duration',
    LAST_MODIFIED_TIME = 'lastModifiedTime',
    CREATED_BY = 'createdBy',
    LAST_MODIFIED_BY = 'lastModifiedBy',
    BUTTON = 'button',
    EXTERNAL_SYNC_SOURCE = 'externalSyncSource',
    AI_TEXT = 'aiText',
    MANUAL_SORT = 'manualSort',
}

export const AIRTABLE_FORMULA_ERROR_VALUE = '#ERROR!';

export type NumericFieldConfig = {
    type: AirtableFieldType.NUMBER | AirtableFieldType.PERCENT;
    options: { precision: number };
};

export type CurrencyFieldConfig = {
    type: AirtableFieldType.CURRENCY;
    options: { precision: number; symbol: string };
};

export type DurationFormat =
    | 'h:mm'
    | 'h:mm:ss'
    | 'h:mm:ss.S'
    | 'h:mm:ss.SS'
    | 'h:mm:ss.SSS';

export type DurationFieldConfig = {
    type: AirtableFieldType.DURATION;
    options: { durationFormat: DurationFormat };
};

export type DateFieldConfig = {
    type: AirtableFieldType.DATE;
    options: {
        dateFormat: { format: string };
    };
};

export type DateTimeFieldConfig = {
    type: AirtableFieldType.DATE_TIME;
    options: {
        dateFormat: { format: string };
        timeFormat: { format: string };
        timeZone: string;
    };
};

export type LinkedRecordFieldConfig = {
    type: AirtableFieldType.MULTIPLE_RECORD_LINKS;
    options: { linkedTableId: string };
};

type ComputedFieldOptions =
    | { isValid: true; result: AirtableFieldConfig }
    | { isValid?: false; result?: AirtableFieldConfig | null };

export type ComputedFieldConfig = {
    type:
        | AirtableFieldType.FORMULA
        | AirtableFieldType.ROLLUP
        | AirtableFieldType.MULTIPLE_LOOKUP_VALUES;
    options: ComputedFieldOptions;
};

export type CreatedTimeFieldConfig = {
    type: AirtableFieldType.CREATED_TIME;
    options: {
        result: DateFieldConfig | DateTimeFieldConfig;
    };
};

export type LastModifiedTimeFieldConfig = {
    type: AirtableFieldType.LAST_MODIFIED_TIME;
    options: {
        isValid: boolean;
        result: DateFieldConfig | DateTimeFieldConfig;
    };
};

export type CountFieldConfig = {
    type: AirtableFieldType.COUNT;
    options: { isValid: boolean };
};

type UnformattedFieldType = Exclude<
    AirtableFieldType,
    | AirtableFieldType.NUMBER
    | AirtableFieldType.PERCENT
    | AirtableFieldType.CURRENCY
    | AirtableFieldType.DURATION
    | AirtableFieldType.DATE
    | AirtableFieldType.DATE_TIME
    | AirtableFieldType.MULTIPLE_RECORD_LINKS
    | AirtableFieldType.FORMULA
    | AirtableFieldType.ROLLUP
    | AirtableFieldType.MULTIPLE_LOOKUP_VALUES
    | AirtableFieldType.CREATED_TIME
    | AirtableFieldType.LAST_MODIFIED_TIME
    | AirtableFieldType.COUNT
>;

export type UnformattedFieldConfig = {
    type: UnformattedFieldType;
    options?: object | null;
};

/** Only formatting and conversion options needed by formulas are required. */
export type AirtableFieldConfig =
    | NumericFieldConfig
    | CurrencyFieldConfig
    | DurationFieldConfig
    | DateFieldConfig
    | DateTimeFieldConfig
    | LinkedRecordFieldConfig
    | ComputedFieldConfig
    | CreatedTimeFieldConfig
    | LastModifiedTimeFieldConfig
    | CountFieldConfig
    | UnformattedFieldConfig;

export type AirtableField = {
    id: string;
    name: string;
    config: AirtableFieldConfig;
    isPrimaryField?: boolean;
    isComputed?: boolean;
    description?: string | null;
};

export type AirtableCollaborator = {
    id: string;
    email: string;
    name: string;
    profilePicUrl?: string;
};

export type AirtableAttachment = {
    id?: string | null;
    url: string;
    filename?: string;
    size?: number;
    type?: string;
};

export type AirtableBarcodeValue = { text?: string; type?: string };
export type AirtableButtonValue = { url: string | null; label: string };
export type AirtableComputedErrorValue = { error: string };
export type AirtableSpecialValue = {
    specialValue: 'NaN' | 'Infinity' | '-Infinity';
};
export type AirtableAiTextValue = {
    state: 'empty' | 'loading' | 'generated' | 'error';
    value: string;
    isStale?: boolean;
    errorType?: string;
};

export type NonArrayAirtableValue =
    | string
    | number
    | boolean
    | AirtableBarcodeValue
    | AirtableButtonValue
    | AirtableComputedErrorValue
    | AirtableSpecialValue
    | AirtableCollaborator
    | AirtableAiTextValue
    | null
    | undefined;

export type AirtableValue =
    | NonArrayAirtableValue
    | ReadonlyArray<NonArrayAirtableValue | AirtableAttachment>;

export type AirtableRecord = {
    id: string;
    /** Values may be keyed by field ID or field name; absent cells are blank. */
    fields: { [fieldIdOrName: string]: AirtableValue };
};

export type LinkedTableState = {
    airtableFields: AirtableField[];
    recordIdsToAirtableRecords: { [recordId: string]: AirtableRecord };
};

export type LinkedTableLoadingState =
    | { type: 'notLoaded' }
    | { type: 'loading' }
    | { type: 'failed'; errorMessage: string }
    | {
          type: 'loaded';
          data: { state: LinkedTableState };
          isPaginating?: boolean;
          isReloading?: boolean;
          errorMessage?: string;
      };

export type TableIdsToLinkedTableLoadingStates = {
    [tableId: string]: LinkedTableLoadingState;
};
