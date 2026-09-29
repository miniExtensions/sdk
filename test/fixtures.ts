import {
    AirtableFieldType,
    type AirtableField,
    type AirtableRecord,
    type AirtableValue,
    type InterpreterContext,
    type TableIdsToLinkedTableLoadingStates,
} from '../src/formulas/index.js';

export const textField = {
    id: 'fld_title',
    name: 'Title',
    config: { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
} satisfies AirtableField;

export const numberField = {
    id: 'fld_quantity',
    name: 'Quantity',
    config: { type: AirtableFieldType.NUMBER, options: { precision: 2 } },
} satisfies AirtableField;

export const dateField = {
    id: 'fld_due_date',
    name: 'Due date',
    config: {
        type: AirtableFieldType.DATE,
        options: { dateFormat: { format: 'YYYY-MM-DD' } },
    },
} satisfies AirtableField;

export const dateTimeField = {
    id: 'fld_start_time',
    name: 'Start time',
    config: {
        type: AirtableFieldType.DATE_TIME,
        options: {
            dateFormat: { format: 'YYYY-MM-DD' },
            timeFormat: { format: 'HH:mm' },
            timeZone: 'utc',
        },
    },
} satisfies AirtableField;

export const selectField = {
    id: 'fld_labels',
    name: 'Labels',
    config: { type: AirtableFieldType.MULTIPLE_SELECTS, options: null },
} satisfies AirtableField;

export const linkedField = {
    id: 'fld_related_items',
    name: 'Related items',
    config: {
        type: AirtableFieldType.MULTIPLE_RECORD_LINKS,
        options: { linkedTableId: 'tbl_related_items' },
    },
} satisfies AirtableField;

export const syntheticRecordId = 'rec00000000000001';
export const syntheticLinkedRecordId = 'rec00000000000002';
export const syntheticMissingRecordId = 'rec00000000000003';

export const makeContext = (
    fields: Record<string, AirtableValue> = {},
    airtableFields: AirtableField[] = [
        textField,
        numberField,
        dateField,
        dateTimeField,
        selectField,
        linkedField,
    ],
    linkedTableLoadingStates: TableIdsToLinkedTableLoadingStates = {},
    recordId = syntheticRecordId
): InterpreterContext => ({
    record: { id: recordId, fields },
    airtableFields,
    linkedTableLoadingStates,
});

export const makeLinkedState = (
    primaryField: AirtableField = { ...textField, isPrimaryField: true },
    fields: AirtableRecord['fields'] = { [textField.id]: 'Related example' }
): TableIdsToLinkedTableLoadingStates => ({
    tbl_related_items: {
        type: 'loaded',
        data: {
            state: {
                airtableFields: [primaryField],
                recordIdsToAirtableRecords: {
                    [syntheticLinkedRecordId]: {
                        id: syntheticLinkedRecordId,
                        fields,
                    },
                },
            },
        },
    },
});
