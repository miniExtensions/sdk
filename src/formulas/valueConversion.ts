import moment from 'moment-timezone';
import 'moment-duration-format';
import {
    AirtableFieldType as EnumAirtableFieldType,
    type AirtableField,
    type AirtableValue,
    type AirtableAttachment,
    type AirtableCollaborator,
    type DateFieldConfig,
    type DateTimeFieldConfig,
    type DurationFormat,
    type CurrencyFieldConfig,
    type TableIdsToLinkedTableLoadingStates,
} from './types.js';
import { removeMarkdown } from './removeMarkdown.js';

// The same enum object with literal-valued properties lets exhaustive switches
// narrow both enum-based and canonical JSON metadata without changing values.
const AirtableFieldType: {
    [Kind in keyof typeof EnumAirtableFieldType]: `${(typeof EnumAirtableFieldType)[Kind]}`;
} = EnumAirtableFieldType;

/** Context used when resolving linked-record primary values. */
export type GetReadableStringSource = {
    type: 'airtableMock';
    linkedTableStates: TableIdsToLinkedTableLoadingStates;
    doNotReturnRecordIdsForLinkedRecords?: boolean;
    unavailableLinkedRecordPlaceholder?: string;
};

export function assertUnreachable(value: never): never {
    throw new Error(`Unexpected: ${String(value)}`);
}

export const formatDateToAirtableDateTimeString = (
    input: moment.MomentInput
): string => moment.utc(input).toISOString();

export const formatMultiSelectValue = (option: string): string => {
    const escapedOption = option.replace(/"/g, '""');
    return option.includes(',') || option.includes('"')
        ? '"' + escapedOption + '"'
        : escapedOption;
};

const isArrayOfStrings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((member) => typeof member === 'string');

const isArrayOfAirtableCollaborators = (
    value: unknown
): value is AirtableCollaborator[] =>
    Array.isArray(value) &&
    value.every(
        (member: unknown) =>
            member != null &&
            !Array.isArray(member) &&
            typeof member === 'object' &&
            'id' in member &&
            typeof member.id === 'string' &&
            'email' in member &&
            typeof member.email === 'string'
    );

const isArrayOfAirtableAttachments = (
    value: unknown
): value is AirtableAttachment[] =>
    Array.isArray(value) &&
    value.every(
        (member: unknown) =>
            member != null &&
            !Array.isArray(member) &&
            typeof member === 'object' &&
            'url' in member &&
            typeof member.url === 'string' &&
            !('label' in member)
    );

const notEmptyInArray = <T>(value: T | null | undefined): value is T =>
    value != null;

const isRecordId = (value: string): boolean =>
    value.startsWith('rec') && value.length === 17;

const getPrimaryFieldInFields = (args: {
    fields: AirtableField[];
    customPrimaryFieldName: string | null;
}): AirtableField => {
    const customPrimaryField =
        args.customPrimaryFieldName == null
            ? null
            : args.fields.find(
                  (field) => field.name === args.customPrimaryFieldName
              );
    const primaryField =
        customPrimaryField ??
        args.fields.find((field) => field.isPrimaryField) ??
        args.fields[0];
    if (primaryField != null) return primaryField;
    throw new Error('Could not find a primary field for the table.');
};

const doesFieldHaveArrayValue = (
    fieldType: AirtableField['config']['type']
): boolean => {
    switch (fieldType) {
        case AirtableFieldType.AUTO_NUMBER:
        case AirtableFieldType.BARCODE:
        case AirtableFieldType.BUTTON:
        case AirtableFieldType.CHECKBOX:
        case AirtableFieldType.COUNT:
        case AirtableFieldType.CREATED_BY:
        case AirtableFieldType.CREATED_TIME:
        case AirtableFieldType.CURRENCY:
        case AirtableFieldType.DATE:
        case AirtableFieldType.DATE_TIME:
        case AirtableFieldType.DURATION:
        case AirtableFieldType.EMAIL:
        case AirtableFieldType.EXTERNAL_SYNC_SOURCE:
        case AirtableFieldType.FORMULA:
        case AirtableFieldType.LAST_MODIFIED_BY:
        case AirtableFieldType.LAST_MODIFIED_TIME:
        case AirtableFieldType.MULTILINE_TEXT:
        case AirtableFieldType.NUMBER:
        case AirtableFieldType.PERCENT:
        case AirtableFieldType.PHONE_NUMBER:
        case AirtableFieldType.RATING:
        case AirtableFieldType.RICH_TEXT:
        case AirtableFieldType.ROLLUP:
        case AirtableFieldType.SINGLE_COLLABORATOR:
        case AirtableFieldType.SINGLE_LINE_TEXT:
        case AirtableFieldType.SINGLE_SELECT:
        case AirtableFieldType.URL:
        case AirtableFieldType.AI_TEXT:
        case AirtableFieldType.MANUAL_SORT:
            return false;
        case AirtableFieldType.MULTIPLE_ATTACHMENTS:
        case AirtableFieldType.MULTIPLE_COLLABORATORS:
        case AirtableFieldType.MULTIPLE_LOOKUP_VALUES:
        case AirtableFieldType.MULTIPLE_RECORD_LINKS:
        case AirtableFieldType.MULTIPLE_SELECTS:
            return true;
        default:
            assertUnreachable(fieldType);
    }
};

export const createUnexpectedValueError = (args: {
    fieldName: string;
    expectedType: string;
    actualType: string;
}) => {
    return new Error(
        `Expected ${args.fieldName} to be a ${args.expectedType}, but found ${args.actualType}.`
    );
};

/**
 * Values (most likely) used in Airtable's formula engine.
 */
export type AirtablePrimitive = string | number | Date | typeof NaN;

export type AirtablePrimitiveWithArrays =
    | AirtablePrimitive
    | (string | number)[];

export const arrayJoinSeparator = ', ';

export const convertAirtableValueToPrimitive = (args: {
    value: AirtableValue;
    airtableFieldConfig: AirtableField['config'];
    source: GetReadableStringSource;
    fieldName: string;
    /**
     * We take out the formatting for markdown values.
     * If you pass true here the function returns the value as it is, including the markdown formatting.
     * - true => "# h1" => "# h1"
     * - ignore => "# h1" => "h1"
     */
    doNotRemoveMarkdownFormatting?: true;
}): AirtablePrimitiveWithArrays => {
    if (args.value == null) {
        if (args.airtableFieldConfig.type === AirtableFieldType.RATING) {
            return 0;
        } else {
            return '';
        }
    }

    let validValue: NonNullable<AirtableValue> = args.value;

    // Remove null values if array
    // For the case of lookup fields with fields that have array values, see design notes
    if (Array.isArray(validValue)) {
        // We cannot use Array.filter because of TS error (ts(2349)) https://github.com/microsoft/TypeScript/issues/33591
        const newArrayWithoutNullValues = [];

        for (const val of validValue) {
            if (val != null) newArrayWithoutNullValues.push(val);
        }
        validValue = newArrayWithoutNullValues;
    }

    if (typeof validValue === 'object') {
        if ('error' in validValue) return validValue.error;

        if ('specialValue' in validValue) {
            switch (validValue.specialValue) {
                case 'NaN':
                    return NaN;
                case 'Infinity':
                    return Infinity;
                case '-Infinity':
                    return -Infinity;
                default:
                    assertUnreachable(validValue.specialValue);
            }
        }
    }

    switch (args.airtableFieldConfig.type) {
        case AirtableFieldType.DATE:
            if (typeof validValue !== 'string') {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'string',
                    actualType: typeof validValue,
                });
            }
            return moment.utc(validValue).toDate();

        case AirtableFieldType.DATE_TIME:
            if (typeof validValue !== 'string') {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'string',
                    actualType: typeof validValue,
                });
            }
            return moment.utc(validValue).toDate();

        case AirtableFieldType.CHECKBOX: {
            if (typeof validValue !== 'boolean') {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'boolean',
                    actualType: typeof validValue,
                });
            }
            return Number(validValue);
        }
        case AirtableFieldType.COUNT: {
            if (!args.airtableFieldConfig.options.isValid) return '';
            if (Number.isNaN(validValue)) return NaN;

            if (typeof validValue !== 'number') {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'number',
                    actualType: typeof validValue,
                });
            }

            return validValue;
        }
        case AirtableFieldType.AUTO_NUMBER:
        case AirtableFieldType.PERCENT:
        case AirtableFieldType.CURRENCY:
        case AirtableFieldType.DURATION:
        case AirtableFieldType.RATING:
        case AirtableFieldType.NUMBER: {
            if (Number.isNaN(validValue)) return NaN;

            if (typeof validValue !== 'number') {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'number',
                    actualType: typeof validValue,
                });
            }

            return validValue;
        }
        case AirtableFieldType.ROLLUP:
        case AirtableFieldType.FORMULA: {
            if (!args.airtableFieldConfig.options.isValid) return '';
            const resultConfig = args.airtableFieldConfig.options.result;
            if (Array.isArray(validValue)) {
                return validValue.map((value) => {
                    // A formula can return an array if the formula is returning the value of a lookup field.
                    // In that case, we want to convert each value in the array to a primitive, and then
                    // format each of those primitives, and the join them with a comma.
                    const primitive = convertAirtableValueToPrimitive({
                        value,
                        airtableFieldConfig: resultConfig,
                        source: args.source,
                        fieldName: args.fieldName,
                    });

                    // Look ups field values are flattened so the items in the
                    // look up field can never be an array
                    if (Array.isArray(primitive))
                        throw createUnexpectedValueError({
                            fieldName: args.fieldName,
                            actualType: 'array',
                            expectedType: 'AirtablePrimitive',
                        });

                    return typeof primitive === 'string'
                        ? primitive
                        : formatAirtablePrimitive({
                              value: primitive,
                              airtableFieldConfig: resultConfig,
                              fieldName: args.fieldName,
                          });
                });
            } else {
                return convertAirtableValueToPrimitive({
                    ...args,
                    airtableFieldConfig: resultConfig,
                });
            }
        }
        case AirtableFieldType.MULTIPLE_LOOKUP_VALUES: {
            const options = args.airtableFieldConfig.options;
            if (options.isValid) {
                if (!Array.isArray(validValue)) {
                    throw createUnexpectedValueError({
                        fieldName: args.fieldName,
                        expectedType: 'array',
                        actualType: typeof validValue,
                    });
                }
                if (doesFieldHaveArrayValue(options.result.type)) {
                    return convertAirtableValueToPrimitive({
                        ...args,
                        airtableFieldConfig: options.result,
                    });
                } else {
                    return validValue.map(
                        (valueInLookup: AirtableValue): string => {
                            const value = convertAirtableValueToPrimitive({
                                ...args,
                                value: valueInLookup,
                                airtableFieldConfig: options.result,
                            });
                            if (typeof value === 'string') {
                                return value;
                            }

                            // Look ups field values are flattened so the items in the
                            // look up field can never be an array
                            if (Array.isArray(value))
                                throw createUnexpectedValueError({
                                    fieldName: args.fieldName,
                                    actualType: 'array',
                                    expectedType: 'AirtablePrimitive',
                                });

                            return formatAirtablePrimitive({
                                fieldName: args.fieldName,
                                value: value,
                                airtableFieldConfig: options.result,
                            });
                        }
                    );
                }
            } else {
                return '';
            }
        }
        case AirtableFieldType.RICH_TEXT: {
            if (typeof validValue !== 'string') {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'string',
                    actualType: typeof validValue,
                });
            }
            return args.doNotRemoveMarkdownFormatting
                ? validValue
                : removeMarkdown(validValue);
        }
        case AirtableFieldType.SINGLE_SELECT:
        case AirtableFieldType.MULTILINE_TEXT:
        case AirtableFieldType.PHONE_NUMBER:
        case AirtableFieldType.URL:
        case AirtableFieldType.EMAIL:
        case AirtableFieldType.SINGLE_LINE_TEXT: {
            if (typeof validValue !== 'string') {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'string',
                    actualType: typeof validValue,
                });
            }
            return validValue;
        }
        case AirtableFieldType.MULTIPLE_SELECTS: {
            if (!isArrayOfStrings(validValue)) {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'array',
                    actualType: typeof validValue,
                });
            }
            return validValue;
        }
        case AirtableFieldType.MULTIPLE_ATTACHMENTS: {
            if (!isArrayOfAirtableAttachments(validValue)) {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'array',
                    actualType: typeof validValue,
                });
            }

            return validValue.map(
                (attachment) => `${attachment.filename} (${attachment.url})`
            );
        }
        case AirtableFieldType.MULTIPLE_COLLABORATORS: {
            if (!isArrayOfAirtableCollaborators(validValue)) {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'array',
                    actualType: typeof validValue,
                });
            }

            return validValue.map((collaborator) => collaborator.name);
        }

        case AirtableFieldType.MULTIPLE_RECORD_LINKS: {
            if (!isArrayOfStrings(validValue)) {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'array',
                    actualType: typeof validValue,
                });
            }
            const linkedTableId =
                args.airtableFieldConfig.options.linkedTableId;

            const linkedTableLoadingState =
                'linkedTableStates' in args.source
                    ? args.source.linkedTableStates[linkedTableId]
                    : null;

            const linkedTableState =
                linkedTableLoadingState?.type === 'loaded'
                    ? linkedTableLoadingState.data
                    : null;

            return validValue
                .map((idOrPrimaryValue): string | null => {
                    if (isRecordId(idOrPrimaryValue)) {
                        const record =
                            linkedTableState?.state.recordIdsToAirtableRecords[
                                idOrPrimaryValue
                            ];

                        const primaryField =
                            linkedTableState != null
                                ? getPrimaryFieldInFields({
                                      fields: linkedTableState.state
                                          .airtableFields,
                                      customPrimaryFieldName: null,
                                  })
                                : null;

                        // Prefer own field IDs, retaining nullish field-name
                        // fallback without reading inherited properties.
                        const primaryValue =
                            primaryField != null && record != null
                                ? ((Object.hasOwn(
                                      record.fields,
                                      primaryField.id
                                  )
                                      ? record.fields[primaryField.id]
                                      : undefined) ??
                                  (Object.hasOwn(
                                      record.fields,
                                      primaryField.name
                                  )
                                      ? record.fields[primaryField.name]
                                      : undefined))
                                : null;

                        if (primaryField == null || primaryValue == null) {
                            if (
                                args.source.doNotReturnRecordIdsForLinkedRecords
                            ) {
                                return (
                                    args.source
                                        .unavailableLinkedRecordPlaceholder ??
                                    null
                                );
                            }
                            return idOrPrimaryValue;
                        }

                        return getReadableStringFromAirtableValue({
                            value: primaryValue,
                            airtableFieldConfig: primaryField.config,
                            fieldName: primaryField.name,
                            source: args.source,
                        });
                    } else {
                        // It's already a primary value
                        return idOrPrimaryValue;
                    }
                })
                .filter<string>(notEmptyInArray);
        }

        case AirtableFieldType.CREATED_BY:
        case AirtableFieldType.LAST_MODIFIED_BY:
        case AirtableFieldType.SINGLE_COLLABORATOR: {
            if (typeof validValue === 'object' && 'name' in validValue) {
                return validValue.name;
            } else {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'collaborator object',
                    actualType: typeof validValue,
                });
            }
        }

        case AirtableFieldType.BARCODE: {
            if (typeof validValue === 'object' && 'text' in validValue) {
                return validValue.text || '';
            } else {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'barcode object',
                    actualType: typeof validValue,
                });
            }
        }

        case AirtableFieldType.BUTTON: {
            if (typeof validValue === 'object' && 'url' in validValue) {
                if (validValue.url == null) return '';
                return validValue.url;
            } else {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'button object',
                    actualType: typeof validValue,
                });
            }
        }

        case AirtableFieldType.EXTERNAL_SYNC_SOURCE: {
            if (typeof validValue !== 'string') {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'string',
                    actualType: typeof validValue,
                });
            }
            return validValue;
        }
        case AirtableFieldType.MANUAL_SORT: {
            if (typeof validValue !== 'string') {
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'string',
                    actualType: typeof validValue,
                });
            }
            return validValue;
        }

        case AirtableFieldType.LAST_MODIFIED_TIME: {
            if (args.airtableFieldConfig.options.isValid) {
                return convertAirtableValueToPrimitive({
                    value: validValue,
                    airtableFieldConfig:
                        args.airtableFieldConfig.options.result,
                    source: args.source,
                    fieldName: args.fieldName,
                });
            } else {
                return '';
            }
        }

        case AirtableFieldType.CREATED_TIME: {
            return convertAirtableValueToPrimitive({
                value: validValue,
                airtableFieldConfig: args.airtableFieldConfig.options.result,
                source: args.source,
                fieldName: args.fieldName,
            });
        }

        case AirtableFieldType.AI_TEXT:
            if (typeof validValue === 'object' && 'state' in validValue) {
                return validValue.value ?? '';
            }
            throw createUnexpectedValueError({
                fieldName: args.fieldName,
                expectedType: 'AI Text object',
                actualType: typeof validValue,
            });

        default:
            assertUnreachable(args.airtableFieldConfig);
    }
};

export const getReadableStringFromAirtableValue = (args: {
    value: AirtableValue;
    airtableFieldConfig: AirtableField['config'];
    source: GetReadableStringSource;
    fieldName: string;
    doNotRemoveMarkdownFormatting?: true;
}): string => {
    const primitive = convertAirtableValueToPrimitive(args);
    const result = Array.isArray(primitive)
        ? primitive.join(arrayJoinSeparator)
        : primitive;
    if (typeof result === 'string') {
        return result;
    } else {
        return formatAirtablePrimitive({
            value: result,
            airtableFieldConfig: args.airtableFieldConfig,
            fieldName: args.fieldName,
        });
    }
};
/**
 * @returns formatted string based on the field type and Airtable field configs (e.g. currency denomination, number precision, etc.)
 */
export const formatAirtablePrimitive = (args: {
    value: AirtablePrimitive;
    airtableFieldConfig: AirtableField['config'];
    fieldName: string;
}): string => {
    if (Number.isNaN(args.value) || args.value === Infinity) {
        return String(args.value);
    }
    switch (args.airtableFieldConfig.type) {
        case AirtableFieldType.COUNT:
        case AirtableFieldType.AUTO_NUMBER:
        case AirtableFieldType.RATING: {
            return args.value.toString();
        }
        case AirtableFieldType.NUMBER: {
            if (typeof args.value !== 'number')
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'number',
                    actualType: typeof args.value,
                });
            return parseNumberToPrecision({
                value: args.value,
                precision: args.airtableFieldConfig.options.precision,
            });
        }
        case AirtableFieldType.PERCENT: {
            if (typeof args.value !== 'number')
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'number',
                    actualType: typeof args.value,
                });
            const scaledValue = args.value * 100;
            return `${parseNumberToPrecision({
                value: scaledValue,
                precision: args.airtableFieldConfig.options.precision,
            })}%`;
        }
        case AirtableFieldType.DURATION: {
            if (typeof args.value !== 'number')
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'number',
                    actualType: typeof args.value,
                });
            return getFormattedDuration(
                `${args.value}`,
                args.airtableFieldConfig.options.durationFormat,
                true
            );
        }
        case AirtableFieldType.CURRENCY: {
            if (typeof args.value !== 'number')
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'number',
                    actualType: typeof args.value,
                });
            const formattedValue = getFormattedValue(
                `${args.value}`,
                args.airtableFieldConfig
            );

            return addCurrencySign(
                formattedValue,
                args.airtableFieldConfig.options.symbol
            );
        }

        case AirtableFieldType.ROLLUP:
        case AirtableFieldType.FORMULA: {
            const resultConfig = args.airtableFieldConfig.options.result;
            return formatAirtablePrimitive({
                ...args,
                airtableFieldConfig: resultConfig ?? {
                    type: AirtableFieldType.SINGLE_LINE_TEXT,
                    options: null,
                },
            });
        }

        case AirtableFieldType.CHECKBOX:
            // Airtable returns an empty string for false values
            return args.value === 1 ? 'true' : '';
        case AirtableFieldType.DATE:
            if (!(args.value instanceof Date))
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'date',
                    actualType: typeof args.value,
                });

            return getFormattedTimeFieldValue({
                airtableValue: args.value,
                airtableFieldConfig: args.airtableFieldConfig,
            });

        case AirtableFieldType.DATE_TIME: {
            if (!(args.value instanceof Date))
                throw createUnexpectedValueError({
                    fieldName: args.fieldName,
                    expectedType: 'date',
                    actualType: typeof args.value,
                });

            return getFormattedTimeFieldValue({
                airtableValue: args.value,
                airtableFieldConfig: args.airtableFieldConfig,
            });
        }

        case AirtableFieldType.LAST_MODIFIED_TIME: {
            if (args.airtableFieldConfig.options.isValid) {
                return formatAirtablePrimitive({
                    value: args.value,
                    airtableFieldConfig:
                        args.airtableFieldConfig.options.result,
                    fieldName: args.fieldName,
                });
            } else {
                return '';
            }
        }

        case AirtableFieldType.CREATED_TIME: {
            return formatAirtablePrimitive({
                value: args.value,
                airtableFieldConfig: args.airtableFieldConfig.options.result,
                fieldName: args.fieldName,
            });
        }

        case AirtableFieldType.MULTIPLE_SELECTS:
        case AirtableFieldType.MULTIPLE_ATTACHMENTS:
        case AirtableFieldType.MULTIPLE_COLLABORATORS:
        case AirtableFieldType.MULTIPLE_RECORD_LINKS:
        case AirtableFieldType.CREATED_BY:
        case AirtableFieldType.LAST_MODIFIED_BY:
        case AirtableFieldType.SINGLE_COLLABORATOR:
        case AirtableFieldType.BARCODE:
        case AirtableFieldType.BUTTON:
        case AirtableFieldType.EXTERNAL_SYNC_SOURCE:
        case AirtableFieldType.MULTIPLE_LOOKUP_VALUES:
        case AirtableFieldType.RICH_TEXT:
        case AirtableFieldType.SINGLE_SELECT:
        case AirtableFieldType.MULTILINE_TEXT:
        case AirtableFieldType.PHONE_NUMBER:
        case AirtableFieldType.URL:
        case AirtableFieldType.EMAIL:
        case AirtableFieldType.SINGLE_LINE_TEXT:
        case AirtableFieldType.AI_TEXT:
        case AirtableFieldType.MANUAL_SORT:
            throw new Error(
                `Unexpectedly found a non-primitive value for field type ${args.airtableFieldConfig.type}`
            );

        default:
            assertUnreachable(args.airtableFieldConfig);
    }
};

export function addCurrencySign(formattedValue: string, symbol: string) {
    const isNegative = formattedValue.startsWith('-');
    return `${isNegative ? '-' : ''}${
        symbol
    }${isNegative ? formattedValue.substring(1) : formattedValue}`;
}

const parseNumberToPrecision = (args: {
    value: number;
    precision: number;
}): string => {
    return parseFloat(`${args.value}`).toFixed(args.precision);
};

const getFormattedTimeFieldValue = (args: {
    airtableValue: string | Date | null;
    airtableFieldConfig: DateFieldConfig | DateTimeFieldConfig;
}): string => {
    if (args.airtableValue == null) return '';
    const config = args.airtableFieldConfig;
    const value =
        config.type === AirtableFieldType.DATE
            ? moment(args.airtableValue)
            : moment(args.airtableValue).tz(
                  config.options.timeZone === 'client'
                      ? moment.tz.guess()
                      : config.options.timeZone
              );
    value.locale('en');
    return value.format(
        config.type === AirtableFieldType.DATE
            ? config.options.dateFormat.format
            : `${config.options.dateFormat.format} ${config.options.timeFormat.format}`
    );
};

const getFormattedValue = (
    unformattedValue: string | number,
    config: CurrencyFieldConfig
): string => {
    if (unformattedValue === '' || unformattedValue === '-') return '';
    return Number(unformattedValue).toLocaleString('en-US', {
        minimumFractionDigits: config.options.precision,
        maximumFractionDigits: config.options.precision,
        useGrouping: true,
    });
};

const getFormattedDuration = (
    unformattedString: string,
    durationFormat: DurationFormat,
    isSeconds = false
): string => {
    if (unformattedString === '') return '';
    const duration = moment.duration(
        unformattedString,
        !isSeconds && durationFormat === 'h:mm' ? 'minutes' : 'seconds'
    );
    const milliseconds = duration.asMilliseconds();
    const isNegative = milliseconds < 0;
    let roundingPrecision: number;
    switch (durationFormat) {
        case 'h:mm':
        case 'h:mm:ss':
        case 'h:mm:ss.S':
        case 'h:mm:ss.SS':
            roundingPrecision = 0;
            break;
        case 'h:mm:ss.SSS':
            roundingPrecision = 1;
            break;
        default:
            return assertUnreachable(durationFormat);
    }
    const roundedMilliseconds =
        Math.abs(Number((milliseconds / 10).toFixed(roundingPrecision))) * 10;
    const formattedDuration = moment
        .duration(roundedMilliseconds)
        .format(durationFormat, {
            useGrouping: false,
            stopTrim: durationFormat === 'h:mm' ? 'h' : 'm',
        });
    const finalDurationWithSign = `${isNegative ? '-' : ''}${formattedDuration}`;
    if (durationFormat === 'h:mm:ss.S') {
        return (
            finalDurationWithSign.substring(
                0,
                finalDurationWithSign.indexOf('.') + 1
            ) +
            Math.round(
                Number(
                    finalDurationWithSign.substring(
                        finalDurationWithSign.indexOf('.') + 1
                    )
                ) / 100
            )
        );
    }
    return finalDurationWithSign;
};
