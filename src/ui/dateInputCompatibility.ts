import moment from 'moment-timezone';
import {
    getDateInputFormat,
    getDateInputTimeZone,
} from '../formulas/dateInputFormatting.js';
export {
    formatDateInputValue,
    getDateInputFormat,
    getDateInputMomentLocale,
    getDateInputTimeZone,
} from '../formulas/dateInputFormatting.js';
export type { DateInputCompatibilityConfig } from '../formulas/dateInputFormatting.js';
import type {
    DateFieldConfig,
    DateTimeFieldConfig,
} from '../formulas/types.js';

const dateInputRanges = [
    'the past year',
    'the past month',
    'the past week',
    'the next week',
    'the next month',
    'the next year',
    'this week',
    'today or in the past',
    'today or in the future',
] as const;
export type DateInputRange = (typeof dateInputRanges)[number];
export const isDateInputRange = (value: unknown): value is DateInputRange =>
    dateInputRanges.some((range) => range === value);
function assertUnreachable(value: never): never {
    throw new Error(`Unexpected: ${String(value)}`);
}

/**
 * @param airtableValue Airtable date field or date time value (YYYY-MM-DD | YYYY-MM-DDTHH:mm:ss.SSS[Z] | null)
 * @returns A moment object to use as the value of the picker, or an empty string if the value is null.
 */
export const getDateInputPickerValue = (
    airtableValue: string | null
): moment.Moment | string => {
    if (!airtableValue) {
        return '';
    }
    const value = moment(airtableValue);
    return value.isValid() ? value : '';
};

/**
 *
 * @param pickerValue The value of the picker when its changed.
 * @param configType 'dateTime' | 'date'.
 * @returns An Airtable date field or date time value (YYYY-MM-DD | YYYY-MM-DDTHH:mm:ss.SSS[Z] | null)
 */
export const getDateInputValueOnChange = (
    pickerValue: moment.Moment,
    configType: DateTimeFieldConfig['type'] | DateFieldConfig['type']
): string => {
    const isDateField = configType === 'date';

    // Airtable date fields are stored as UTC dates.
    const adjustedMomentValue = isDateField
        ? pickerValue.clone()
        : pickerValue.clone().utc().second(0).millisecond(0);

    const formattedValue = adjustedMomentValue.format(
        isDateField ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm:ss.SSS[Z]'
    );

    return formattedValue;
};

export type DateInputBlurResult =
    | {
          isValid: true;
          value: string | null;
      }
    | {
          isValid: false;
      };

/**
 *
 * @param args.inputValue The value of the input when its blurred.
 * @param args.config Airtable date field or date time config
 * @param args.dateRange Optional date range to validate against.
 * @returns An Airtable date field or date time value (YYYY-MM-DD | YYYY-MM-DDTHH:mm:ss.SSS[Z] | null)
 */
export const getDateInputValueOnBlur = (args: {
    inputValue: string;
    config: DateTimeFieldConfig | DateFieldConfig;
    dateRange?: DateInputRange;
    clientTimeZone?: string;
}): DateInputBlurResult => {
    // User cleared the input.
    if (args.inputValue === '') {
        return {
            isValid: true,
            value: null,
        };
    }

    const adjustedMomentValue =
        // The Airtable value is exactly the value of the picker if it's a date field.
        args.config.type === 'date'
            ? moment(args.inputValue, getDateInputFormat(args.config), true)
            : // Otherwise the picker value should be converted from the timezone to UTC to get the Airtable value.
              moment
                  .tz(
                      args.inputValue,
                      getDateInputFormat(args.config),
                      true,
                      getDateInputTimeZone(args.config)
                  )
                  .utc();

    const formattedValue = adjustedMomentValue.format(
        getAirtableValueFormat(args.config.type)
    );

    if (
        adjustedMomentValue.isValid() &&
        isDateInputValueWithinRange({
            airtableFieldConfig: args.config,
            airtableValue: formattedValue,
            clientTimeZone: args.clientTimeZone,
            dateRange: args.dateRange,
        })
    ) {
        return {
            isValid: true,
            value: formattedValue,
        };
    } else {
        return {
            isValid: false,
        };
    }
};

/**
 *
 * @param configType 'date' | 'dateTime'.
 * @returns The format for the Airtable value ('YYYY-MM-DD' | 'YYYY-MM-DDTHH:mm:ss.SSS[Z]').
 */
const getAirtableValueFormat = (
    configType: DateTimeFieldConfig['type'] | DateFieldConfig['type']
) => {
    const isDateField = configType === 'date';

    const format = isDateField ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm:ss.SSS[Z]';

    return format;
};

/**
 *
 * @param date The date to validate.
 * @param dateRange Optional date range to validate against.
 * @returns True if the date is valid. False otherwise.
 */
export const isDateInputWithinRange = (
    date: moment.Moment,
    dateRange?: DateInputRange,
    options?: {
        now?: moment.Moment;
        timeZone?: string;
    }
): boolean => {
    if (dateRange == null) return true;

    const rangeDate =
        options?.timeZone == null
            ? date.clone()
            : date.clone().tz(options.timeZone);
    const rangeNow = (options?.now ?? moment()).clone();
    if (options?.timeZone != null) rangeNow.tz(options.timeZone);

    switch (dateRange) {
        case 'the past year':
            return (
                rangeDate.isBefore(rangeNow.clone().endOf('day')) &&
                rangeDate.isAfter(
                    rangeNow.clone().add({ years: -1, days: -1 }).endOf('day')
                )
            );
        case 'the past month':
            return (
                rangeDate.isBefore(rangeNow.clone().endOf('day')) &&
                rangeDate.isAfter(
                    rangeNow.clone().add({ months: -1, days: -1 }).endOf('day')
                )
            );
        case 'the past week':
            return (
                rangeDate.isBefore(rangeNow.clone().endOf('day')) &&
                rangeDate.isAfter(
                    rangeNow.clone().add({ weeks: -1, days: -1 }).endOf('day')
                )
            );
        case 'the next week':
            return (
                rangeDate.isAfter(
                    rangeNow.clone().add(-1, 'days').endOf('day')
                ) &&
                rangeDate.isBefore(
                    rangeNow.clone().add(1, 'weeks').endOf('day')
                )
            );
        case 'the next month':
            return (
                rangeDate.isAfter(
                    rangeNow.clone().add(-1, 'days').endOf('day')
                ) &&
                rangeDate.isBefore(
                    rangeNow.clone().add(1, 'months').endOf('day')
                )
            );
        case 'the next year':
            return (
                rangeDate.isAfter(
                    rangeNow.clone().add(-1, 'days').endOf('day')
                ) &&
                rangeDate.isBefore(
                    rangeNow.clone().add(1, 'years').endOf('day')
                )
            );
        case 'this week':
            return rangeDate.isBetween(
                rangeNow.clone().startOf('isoWeek'),
                rangeNow.clone().endOf('day'),
                undefined,
                '[]'
            );
        case 'today or in the past':
            return rangeDate.isBefore(
                rangeNow.clone().add(1, 'days').startOf('day')
            );
        case 'today or in the future':
            return rangeDate.isAfter(
                rangeNow.clone().subtract(1, 'days').endOf('day')
            );

        default:
            assertUnreachable(dateRange);
    }
};

export const isDateInputTimeZone = (timeZone: string | undefined): boolean =>
    timeZone != null && moment.tz.zone(timeZone) != null;

export const resolveDateInputRangeTimeZone = (args: {
    airtableFieldConfig: DateTimeFieldConfig | DateFieldConfig;
    clientTimeZone?: string;
}): string => {
    if (args.airtableFieldConfig.type === 'date') return 'UTC';

    const configuredTimeZone = args.airtableFieldConfig.options.timeZone;
    if (configuredTimeZone !== 'client') return configuredTimeZone;

    const clientTimeZone = args.clientTimeZone;
    return clientTimeZone != null && isDateInputTimeZone(clientTimeZone)
        ? clientTimeZone
        : 'UTC';
};

export const isDateInputValueWithinRange = (args: {
    airtableFieldConfig: DateTimeFieldConfig | DateFieldConfig;
    airtableValue: string;
    clientTimeZone?: string;
    dateRange?: DateInputRange;
    now?: moment.Moment;
}): boolean => {
    const value =
        args.airtableFieldConfig.type === 'date'
            ? moment.utc(args.airtableValue, 'YYYY-MM-DD', true)
            : moment.utc(args.airtableValue, moment.ISO_8601, true);
    if (!value.isValid()) return false;

    return isDateInputWithinRange(value, args.dateRange, {
        now: args.now,
        timeZone: resolveDateInputRangeTimeZone(args),
    });
};
