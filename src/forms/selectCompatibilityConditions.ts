import type {
    RuntimeAirtableField as AirtableField,
    RuntimeConditionsDefinition as ConditionsDefinition,
    RuntimeConditionItem as ConditionDefItemType,
    RuntimeDateRange,
} from '../runtime/types.js';
import {
    formatMultiSelectValue,
    assertUnreachable,
} from '../formulas/valueConversion.js';

type SingleConditionItem = Extract<
    ConditionDefItemType,
    { type: 'singleCondition' }
>;
type LogicalOperator = ConditionsDefinition['logicalOperator'];

// Exact escape-string-regexp 4.x semantics used by the native condition compiler.
const escapeStringForRegex = (value: string): string =>
    value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');

const getResultAirtableConfigForAirtableConfig = (args: {
    fieldConfig: AirtableField['config'];
    doNotUseResultConfig: boolean;
}): AirtableField['config'] =>
    !args.doNotUseResultConfig &&
    args.fieldConfig.options != null &&
    'result' in args.fieldConfig.options &&
    args.fieldConfig.options.result != null
        ? args.fieldConfig.options.result
        : args.fieldConfig;

const selectDateRanges: readonly string[] = [
    'the past week',
    'the past month',
    'the past year',
    'the next week',
    'the next month',
    'the next year',
    'this week',
    'today or in the past',
    'today or in the future',
];

const DateOrDateTimeLikeFields: readonly string[] = [
    'date',
    'dateTime',
    'createdTime',
    'lastModifiedTime',
];

const FAIL_CLOSED_CONDITION_FORMULA = 'FALSE()';

/**
 * For values that can be inputted by the user directly or indirectly,
 * we need to make sure the value has any single quotes inside the string escaped
 * because that is what we use to wrap the string value for the formula.
 * Hence ' => \'
 */
export const escapeValueSingleQuotes = (val: string) =>
    val.replace(/'/g, "\\'");

/**
 * Field names need to have any closing curly braces escaped so they affect the formula
 * lexer
 * Hence } => \}
 */
export const escapeClosingCurlyBraces = (val: string) =>
    `${val.replace(/}/g, '\\}')}`;

export type SelectConditionCompilationOptions = {
    failClosedOnInvalidCondition?: boolean;
    fieldReferenceMode?: 'saved' | 'name';
};

const createConditionalFieldFormula = (
    condition: SingleConditionItem,
    airtableFields: AirtableField[],
    options: SelectConditionCompilationOptions
) => {
    const setting = condition.setting;
    const field =
        airtableFields.find((field) =>
            setting.idOrName.type === 'id'
                ? field.id === setting.idOrName.id
                : field.name === setting.idOrName.name
        ) ?? null;
    if (field == null) {
        return FAIL_CLOSED_CONDITION_FORMULA;
    }

    const fieldReference =
        options.fieldReferenceMode === 'name'
            ? escapeClosingCurlyBraces(field.name)
            : setting.idOrName.type === 'id'
              ? setting.idOrName.id
              : escapeClosingCurlyBraces(setting.idOrName.name);
    /**
     * Some functions return an error in Airtable if the value is empty.
     *
     * This will run the formula only if the value is not empty. Otherwise, it will return false.
     */
    const checkIfValidValueFirst = (formula: string) =>
        `IF(LEN('' & {${fieldReference}}) > 0, ${formula}, FALSE())`;

    const resultFieldConfig = getResultAirtableConfigForAirtableConfig({
        fieldConfig: field.config,
        doNotUseResultConfig: field.config.type === 'multipleLookupValues',
    });

    switch (setting.type) {
        case 'matchesRegex': {
            if (setting.value == null) return;
            return `REGEX_MATCH({${fieldReference}}, '${escapeValueSingleQuotes(
                setting.value
            )}')`;
        }
        case 'is':
        case 'isNot': {
            const value = setting.value;
            if (value == null || value === '') return;
            const sign = setting.type === 'is' ? '=' : '!=';
            // NOTE(Damilola): Date and Date time like fields need to treated specially.
            // In their, case we should only check if the date portions of
            // values match.
            if (DateOrDateTimeLikeFields.includes(setting.fieldType)) {
                if (typeof value !== 'string') return;
                return checkIfValidValueFirst(
                    `DATESTR({${fieldReference}}) ${sign} DATESTR('${escapeValueSingleQuotes(
                        value
                    )}')`
                );
            }

            if (
                condition.setting.fieldType === 'singleSelect' &&
                resultFieldConfig.type === 'singleSelect'
            ) {
                const option = resultFieldConfig.options.choices.find(
                    (choice) => choice.id === value
                );
                if (option == null) return FAIL_CLOSED_CONDITION_FORMULA;
                return `{${fieldReference}} ${sign} '${escapeValueSingleQuotes(
                    option.name
                )}'`;
            }

            const effectiveValue =
                typeof value === 'boolean'
                    ? Number(Boolean(value))
                    : `'${escapeValueSingleQuotes(value)}'`;

            return `{${fieldReference}} ${sign} ${effectiveValue}`;
        }
        case 'isOfLength': {
            const value = setting.value;
            if (value == null) return;
            return `LEN({${fieldReference}}) = ${value}`;
        }
        case 'contains':
        case 'doesNotContain': {
            const value = setting.value;
            if (value == null) return;
            const baseFormula = `FIND(LOWER('${escapeValueSingleQuotes(
                value
            )}'), LOWER({${fieldReference}} & ''))`;
            return setting.type === 'contains'
                ? baseFormula
                : `NOT(${baseFormula})`;
        }
        case 'isAnyOf':
        case 'isNoneOf': {
            const value = setting.value;
            if (!Array.isArray(value) || value.length === 0) return;

            if (resultFieldConfig.type !== 'singleSelect') {
                return FAIL_CLOSED_CONDITION_FORMULA;
            }

            // Make sure the value is matched exactly so we don't get
            // false positives like damilola = damilola1
            const findConditions = [...new Set(value)]
                .map((val) => {
                    const option = resultFieldConfig.options.choices.find(
                        (choice) => choice.id === val
                    );
                    if (option == null) return null;
                    return `{${fieldReference}} = '${escapeValueSingleQuotes(
                        option.name
                    )}'`;
                })
                .filter((formula): formula is string => formula != null)
                .join(',');

            if (findConditions.length === 0) {
                return FAIL_CLOSED_CONDITION_FORMULA;
            }

            return setting.type === 'isAnyOf'
                ? `OR(${findConditions})`
                : `NOT(OR(${findConditions}))`;
        }
        case 'isEmpty':
        case 'isNotEmpty': {
            const sign = setting.type === 'isEmpty' ? '=' : '!=';
            if (setting.fieldType === 'rating') {
                return `{${fieldReference}} ${sign} 0`;
            }
            return `LEN('' & {${fieldReference}}) ${sign} 0`;
        }
        case 'equals':
        case 'notEquals':
        case 'greaterThan':
        case 'lessThan':
        case 'lessThanOrEqualsTo':
        case 'greaterThanOrEqualsTo': {
            if (typeof setting.value !== 'number') return;
            const value =
                resultFieldConfig.type === 'percent'
                    ? Number(setting.value) / 100
                    : Number(setting.value);
            const sign =
                setting.type === 'equals'
                    ? '='
                    : setting.type === 'notEquals'
                      ? '!='
                      : setting.type === 'greaterThan'
                        ? '>'
                        : setting.type === 'lessThan'
                          ? '<'
                          : setting.type === 'greaterThanOrEqualsTo'
                            ? '>='
                            : '<=';
            return `{${fieldReference}} ${sign} ${value}`;
        }
        case 'hasAllOf':
        case 'hasAnyOf':
        case 'hasNoneOf':
        case 'isExactly': {
            const value = setting.value;
            if (!Array.isArray(value) || value.length === 0) return;

            if (field.config.type !== 'multipleSelects') {
                return FAIL_CLOSED_CONDITION_FORMULA;
            }

            const choices = field.config.options.choices;
            const readableValues = [...new Set(value)].map((val) => {
                const option = choices.find((choice) => choice.id === val);
                return option?.name ?? null;
            });

            if (
                readableValues.some((value) => value == null) &&
                (setting.type === 'hasAllOf' || setting.type === 'isExactly')
            ) {
                return FAIL_CLOSED_CONDITION_FORMULA;
            }

            const validReadableValues = readableValues.filter(
                (value): value is string => value != null
            );

            if (validReadableValues.length === 0) {
                return FAIL_CLOSED_CONDITION_FORMULA;
            }

            // Use regex to make sure an exact match is found.
            const findConditions = validReadableValues
                .map((val) => {
                    return `REGEX_MATCH({${fieldReference}}, '(^|, )${escapeStringForRegex(
                        escapeValueSingleQuotes(formatMultiSelectValue(val))
                    )}(,|$)')`;
                })
                .join(',');
            if ('hasAllOf' === setting.type) return `AND(${findConditions})`;
            else if ('hasAnyOf' === setting.type)
                return `OR(${findConditions})`;
            else if ('hasNoneOf' === setting.type)
                return `NOT(OR(${findConditions}))`;
            else {
                return `AND(LEN({${fieldReference}}) = ${
                    validReadableValues.map(formatMultiSelectValue).join(', ')
                        .length
                }, ${findConditions})`;
            }
        }

        case 'isAfter':
        case 'isBefore':
        case 'isOnOrAfter':
        case 'isOnOrBefore': {
            const value = setting.value;
            // Always compare only the date portions using the DATESTR function
            if (typeof value !== 'string') return;
            const functionName =
                setting.type === 'isOnOrAfter' || setting.type === 'isAfter'
                    ? 'IS_AFTER'
                    : 'IS_BEFORE';
            const baseFormula = `${functionName}(DATESTR({${fieldReference}}), DATESTR('${value}'))`;

            if (setting.type === 'isAfter' || setting.type === 'isBefore')
                return checkIfValidValueFirst(baseFormula);

            const checkIfOnSameDayFormula = `DATESTR({${fieldReference}}) = DATESTR('${value}')`;
            return checkIfValidValueFirst(
                `OR(${checkIfOnSameDayFormula}, ${baseFormula})`
            );
        }
        case 'IsWithin': {
            const value = setting.value;

            if (!isIsWithinConditionalFieldOptions(value)) return;

            switch (value) {
                case 'the past year':
                    return checkIfValidValueFirst(
                        `AND(IS_BEFORE(DATESTR({${fieldReference}}), DATEADD(TODAY(), 1, "days")), IS_AFTER(DATESTR({${fieldReference}}), DATEADD(DATEADD(TODAY(), -1, "years"), -1, "days")))`
                    );
                case 'the past month':
                    return checkIfValidValueFirst(
                        `AND(IS_BEFORE(DATESTR({${fieldReference}}), DATEADD(TODAY(), 1, "days")), IS_AFTER(DATESTR({${fieldReference}}), DATEADD(DATEADD(TODAY(), -1, "months"), -1, "days")))`
                    );
                case 'the past week':
                    return checkIfValidValueFirst(
                        `AND(IS_BEFORE(DATESTR({${fieldReference}}), DATEADD(TODAY(), 1, "days")), IS_AFTER(DATESTR({${fieldReference}}), DATEADD(DATEADD(TODAY(), -1, "weeks"), -1, "days")))`
                    );
                case 'the next week':
                    return checkIfValidValueFirst(
                        `AND(IS_AFTER(DATESTR({${fieldReference}}), DATEADD(TODAY(), -1, "days")), IS_BEFORE(DATESTR({${fieldReference}}), DATEADD(DATEADD(TODAY(), 1, "weeks"), 1, "days")))`
                    );
                case 'the next month':
                    return checkIfValidValueFirst(
                        `AND(IS_AFTER(DATESTR({${fieldReference}}), DATEADD(TODAY(), -1, "days")), IS_BEFORE(DATESTR({${fieldReference}}), DATEADD(DATEADD(TODAY(), 1, "months"), 1, "days")))`
                    );
                case 'the next year':
                    return checkIfValidValueFirst(
                        `AND(IS_AFTER(DATESTR({${fieldReference}}), DATEADD(TODAY(), -1, "days")), IS_BEFORE(DATESTR({${fieldReference}}), DATEADD(DATEADD(TODAY(), 1, "years"), 1, "days")))`
                    );
                case 'this week':
                    return checkIfValidValueFirst(
                        `AND(
                            IS_AFTER(
                                DATESTR({${fieldReference}}),
                                DATEADD(
                                    TODAY(),
                                    -1 * IF(WEEKDAY(TODAY()) = 0, 7, WEEKDAY(TODAY())),
                                    "days"
                                )
                            ),
                            IS_BEFORE(
                                DATESTR({${fieldReference}}),
                                DATEADD(TODAY(), 1, "days"))
                        )`
                    );
                case 'today or in the past':
                    return checkIfValidValueFirst(
                        `AND(IS_BEFORE(DATESTR({${fieldReference}}), DATEADD(TODAY(), 1, "days")))`
                    );
                case 'today or in the future':
                    return checkIfValidValueFirst(
                        `AND(IS_AFTER(DATESTR({${fieldReference}}), DATEADD(TODAY(), -1, "days")))`
                    );

                default:
                    return assertUnreachable(value);
            }
        }
        case 'isToday':
        case 'isTomorrow':
        case 'isYesterday': {
            const numDaysToAdd =
                setting.type === 'isToday'
                    ? 0
                    : setting.type === 'isTomorrow'
                      ? 1
                      : -1;

            return checkIfValidValueFirst(
                `DATESTR({${fieldReference}}) = DATESTR(DATEADD(TODAY(), ${numDaysToAdd}, "days"))`
            );
        }
        case 'isBeforeToday':
            return checkIfValidValueFirst(
                `IS_BEFORE(DATESTR({${fieldReference}}), DATESTR(TODAY()))`
            );
        case 'isAfterToday':
            return checkIfValidValueFirst(
                `IS_AFTER(DATESTR({${fieldReference}}), DATESTR(TODAY()))`
            );
        case 'filenamesContains': {
            const value = setting.value;
            if (value == null) return;
            // Attachments are transformed to <attachment name>.<extension> (https://<airtable link to image>)
            // They're joined by a comma if there are multiple attachments.
            const baseFormula = `FIND(LOWER('${escapeValueSingleQuotes(
                value
            )}'), LOWER({${fieldReference}}))`;
            return baseFormula;
        }
        default:
            assertUnreachable(setting);
    }
};

export const compileSelectCompatibilityConditions = (
    conditionsDefinition: ConditionsDefinition | null,
    airtableFields: AirtableField[],
    options: SelectConditionCompilationOptions = {}
) => {
    if (
        conditionsDefinition == null ||
        conditionsDefinition.conditions.length === 0
    )
        return '1';

    let encounteredInvalidCondition = false;
    const mapper = (
        conditions: ConditionDefItemType[],
        operator: LogicalOperator
    ) => {
        if (conditions.length === 0) {
            if (options.failClosedOnInvalidCondition === true) {
                encounteredInvalidCondition = true;
                return FAIL_CLOSED_CONDITION_FORMULA;
            }
            return conditionsDefinition.conditions.length === 0 ? '1' : '';
        }
        const sections: string[] = [];

        for (const condField of conditions) {
            let formula: string | undefined;
            try {
                formula =
                    condField.type === 'groupCondition'
                        ? mapper(
                              condField.conditions,
                              condField.logicalOperator
                          )
                        : createConditionalFieldFormula(
                              condField,
                              airtableFields,
                              options
                          );
            } catch (error) {
                if (options.failClosedOnInvalidCondition !== true) {
                    throw error;
                }
                encounteredInvalidCondition = true;
                continue;
            }
            if (formula) {
                sections.push(formula);
            } else {
                encounteredInvalidCondition = true;
            }
        }

        if (sections.length === 1) {
            return sections[0];
        }

        const joinedSections = sections.join(', ');

        switch (operator) {
            case 'and':
                return `AND(${joinedSections})`;
            case 'or':
                return `OR(${joinedSections})`;
            default:
                assertUnreachable(operator);
        }
    };

    const formula = mapper(
        conditionsDefinition.conditions,
        conditionsDefinition.logicalOperator
    );
    return options.failClosedOnInvalidCondition === true &&
        encounteredInvalidCondition
        ? FAIL_CLOSED_CONDITION_FORMULA
        : formula;
};

const isIsWithinConditionalFieldOptions = (
    testedValue: unknown
): testedValue is RuntimeDateRange => {
    return (
        testedValue != null &&
        typeof testedValue === 'string' &&
        selectDateRanges.includes(testedValue)
    );
};
