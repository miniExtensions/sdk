import moment from 'moment-timezone';
import type { LoadedFormFieldDescriptor } from './helpers.js';
import {
    isDateInputRange,
    isDateInputWithinRange,
} from '../ui/dateInputCompatibility.js';
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
    if (!isDateInputRange(mini.dateRange)) return 'invalid-metadata';
    const zone = config.type === 'date' ? 'UTC' : config.options?.timeZone;
    if (typeof zone !== 'string' || moment.tz.zone(zone) === null)
        return 'invalid-metadata';
    if (typeof value !== 'string') return 'invalid-input';
    const date = moment.utc(
        value,
        config.type === 'date' ? 'YYYY-MM-DD' : moment.ISO_8601,
        true
    );
    return date.isValid() &&
        isDateInputWithinRange(date, mini.dateRange, { timeZone: zone })
        ? null
        : 'invalid-input';
};
