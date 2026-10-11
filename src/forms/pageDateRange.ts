import moment from 'moment-timezone';
import type { LoadedFormFieldDescriptor } from './helpers.js';

const ranges = [
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
type DateRange = (typeof ranges)[number];
const isRange = (value: unknown): value is DateRange =>
    ranges.some((range) => range === value);

// Portable canonical range arithmetic. Preserve strict end-of-day bounds,
// inclusive ISO-week bounds, calendar arithmetic and timezone conversion.
const withinRange = (date: moment.Moment, range: DateRange, zone: string) => {
    const value = date.clone().tz(zone);
    const now = moment().tz(zone);
    switch (range) {
        case 'the past year':
            return (
                value.isBefore(now.clone().endOf('day')) &&
                value.isAfter(
                    now.clone().add({ years: -1, days: -1 }).endOf('day')
                )
            );
        case 'the past month':
            return (
                value.isBefore(now.clone().endOf('day')) &&
                value.isAfter(
                    now.clone().add({ months: -1, days: -1 }).endOf('day')
                )
            );
        case 'the past week':
            return (
                value.isBefore(now.clone().endOf('day')) &&
                value.isAfter(
                    now.clone().add({ weeks: -1, days: -1 }).endOf('day')
                )
            );
        case 'the next week':
            return (
                value.isAfter(now.clone().add(-1, 'days').endOf('day')) &&
                value.isBefore(now.clone().add(1, 'weeks').endOf('day'))
            );
        case 'the next month':
            return (
                value.isAfter(now.clone().add(-1, 'days').endOf('day')) &&
                value.isBefore(now.clone().add(1, 'months').endOf('day'))
            );
        case 'the next year':
            return (
                value.isAfter(now.clone().add(-1, 'days').endOf('day')) &&
                value.isBefore(now.clone().add(1, 'years').endOf('day'))
            );
        case 'this week':
            return value.isBetween(
                now.clone().startOf('isoWeek'),
                now.clone().endOf('day'),
                undefined,
                '[]'
            );
        case 'today or in the past':
            return value.isBefore(now.clone().add(1, 'days').startOf('day'));
        case 'today or in the future':
            return value.isAfter(now.clone().subtract(1, 'days').endOf('day'));
    }
};

/** Local feedback only; backend validation remains authoritative. */
export const validatePageDateRange = (
    field: LoadedFormFieldDescriptor,
    value: unknown,
    stored: unknown,
    hidden: boolean
): 'invalid-input' | 'invalid-metadata' | null => {
    const config = field.schema.airtableField.config;
    const mini = field.schema.miniExtConfig;
    if (
        (field.fieldType !== 'date' && field.fieldType !== 'dateTime') ||
        hidden ||
        field.readOnly ||
        value == null ||
        value === '' ||
        value === stored ||
        mini == null ||
        !('dateRange' in mini) ||
        mini.dateRange == null
    )
        return null;
    if (config.type !== field.fieldType) return 'invalid-metadata';
    // The accepted response does not expose the token-bound client zone.
    // A current browser/presentation zone is not that provenance. Preserve
    // backend-only validation for client ranges rather than guess or deny.
    if (config.type === 'dateTime' && config.options?.timeZone === 'client')
        return null;
    if (!isRange(mini.dateRange)) return 'invalid-metadata';
    const zone = config.type === 'date' ? 'UTC' : config.options?.timeZone;
    if (typeof zone !== 'string' || moment.tz.zone(zone) === null)
        return 'invalid-metadata';
    if (typeof value !== 'string') return 'invalid-input';
    const date = moment.utc(
        value,
        config.type === 'date' ? 'YYYY-MM-DD' : moment.ISO_8601,
        true
    );
    return date.isValid() && withinRange(date, mini.dateRange, zone)
        ? null
        : 'invalid-input';
};
