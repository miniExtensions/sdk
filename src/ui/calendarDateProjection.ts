import moment from 'moment-timezone';
import type { RuntimeAirtableField } from '../runtime/types.js';
import {
    isDateInputTimeZone,
    resolveDateInputRangeTimeZone,
} from './dateInputCompatibility.js';

/** Match native one-level returned-result metadata; never evaluate a formula. */
export const getCalendarFieldResultConfig = (field: RuntimeAirtableField) =>
    field.config.options != null &&
    'result' in field.config.options &&
    field.config.options.result != null
        ? field.config.options.result
        : field.config;

export const isCalendarDateField = (field: RuntimeAirtableField): boolean => {
    const resultType = getCalendarFieldResultConfig(field).type;
    return resultType === 'date' || resultType === 'dateTime';
};

/** Picker policy: per-field DateTime zone, and UTC for computed DATE values. */
export const parseCalendarFieldDate = (args: {
    clientTimeZone?: string;
    field: RuntimeAirtableField;
    value: string;
}): moment.Moment | null => {
    const config = getCalendarFieldResultConfig(args.field);
    if (config.type === 'dateTime') {
        const value = moment.utc(args.value, moment.ISO_8601, true);
        return value.isValid()
            ? value.tz(
                  resolveDateInputRangeTimeZone({
                      airtableFieldConfig: config,
                      clientTimeZone: args.clientTimeZone,
                  })
              )
            : null;
    }
    if (config.type !== 'date') return null;
    const date = moment.utc(args.value, 'YYYY-MM-DD', true);
    if (date.isValid()) return date;
    const computed = moment.utc(args.value, moment.ISO_8601, true);
    return computed.isValid() ? computed : null;
};

/** Portal policy: viewer DateTime zone, parsed timestamp zone for DATE. */
export const getPortalCalendarDateKeys = (args: {
    clientTimeZone?: string;
    fallbackClientUtcOffset: number;
    field: RuntimeAirtableField;
    value: unknown;
}): string[] => {
    const type = getCalendarFieldResultConfig(args.field).type;
    if (type !== 'date' && type !== 'dateTime') return [];
    const values: readonly unknown[] = Array.isArray(args.value)
        ? args.value
        : [args.value];
    const keys = new Set<string>();
    for (const value of values) {
        if (typeof value !== 'string') continue;
        if (type === 'date') {
            const date = moment.utc(value, 'YYYY-MM-DD', true);
            if (date.isValid()) {
                keys.add(date.format('YYYY-MM-DD'));
                continue;
            }
            const computed = moment.parseZone(value, moment.ISO_8601, true);
            if (computed.isValid()) keys.add(computed.format('YYYY-MM-DD'));
            continue;
        }
        const date = moment.utc(value, moment.ISO_8601, true);
        if (!date.isValid()) continue;
        if (
            args.clientTimeZone != null &&
            isDateInputTimeZone(args.clientTimeZone)
        ) {
            date.tz(args.clientTimeZone);
        } else {
            date.utcOffset(args.fallbackClientUtcOffset);
        }
        keys.add(date.format('YYYY-MM-DD'));
    }
    return [...keys];
};

/** Existing host query policy needs each endpoint's offset at its own boundary. */
export const getCalendarFieldUtcOffset = (args: {
    boundaryDate: string;
    clientTimeZone?: string;
    fallbackClientUtcOffset: number;
    field: RuntimeAirtableField;
}): number => {
    const config = getCalendarFieldResultConfig(args.field);
    if (config.type !== 'dateTime') return 0;
    if (config.options.timeZone === 'client' && args.clientTimeZone == null) {
        return args.fallbackClientUtcOffset;
    }
    const zone = resolveDateInputRangeTimeZone({
        airtableFieldConfig: config,
        clientTimeZone: args.clientTimeZone,
    });
    const boundary = moment.tz(args.boundaryDate, 'YYYY-MM-DD', true, zone);
    return boundary.isValid()
        ? boundary.utcOffset()
        : args.fallbackClientUtcOffset;
};

/** Only visible accepted records are supplied; no client, store or hidden lookup. */
export type CalendarProjectionRecord = {
    readonly id: string;
    readonly fields: Readonly<Record<string, unknown>>;
};

export function projectCalendarRecordPickerDays<
    RecordType extends CalendarProjectionRecord,
>(args: {
    records: readonly RecordType[];
    startField: RuntimeAirtableField | null;
    endField: RuntimeAirtableField | null;
    queryMonth: string;
    clientTimeZone?: string;
}): ReadonlyMap<string, readonly RecordType[]> {
    const days = new Map<string, RecordType[]>();
    const first = moment.utc(`${args.queryMonth}-01`, 'YYYY-MM-DD', true);
    if (!first.isValid() || args.startField == null || args.endField == null)
        return days;
    const firstDay = first.format('YYYY-MM-DD');
    const lastDay = first.clone().endOf('month').format('YYYY-MM-DD');
    for (const record of args.records) {
        const startValue = record.fields[args.startField.id];
        const endValue = record.fields[args.endField.id];
        if (typeof startValue !== 'string' || typeof endValue !== 'string')
            continue;
        const start = parseCalendarFieldDate({
            field: args.startField,
            value: startValue,
            clientTimeZone: args.clientTimeZone,
        });
        const end = parseCalendarFieldDate({
            field: args.endField,
            value: endValue,
            clientTimeZone: args.clientTimeZone,
        });
        if (start == null || end == null) continue;
        const startDay = start.format('YYYY-MM-DD');
        const endDay = end.format('YYYY-MM-DD');
        const cursor = moment.utc(
            startDay < firstDay ? firstDay : startDay,
            'YYYY-MM-DD',
            true
        );
        const last = moment.utc(
            endDay > lastDay ? lastDay : endDay,
            'YYYY-MM-DD',
            true
        );
        for (; cursor.isSameOrBefore(last); cursor.add(1, 'days')) {
            const key = cursor.format('YYYY-MM-DD');
            const values = days.get(key);
            if (values == null) days.set(key, [record]);
            else values.push(record);
        }
    }
    return days;
}

export function projectPortalCalendarDays<
    RecordType extends CalendarProjectionRecord,
>(args: {
    records: readonly RecordType[];
    field: RuntimeAirtableField | null;
    clientTimeZone?: string;
    fallbackClientUtcOffset: number;
}): ReadonlyMap<string, readonly RecordType[]> {
    const days = new Map<string, RecordType[]>();
    if (args.field == null) return days;
    for (const record of args.records) {
        for (const key of getPortalCalendarDateKeys({
            ...args,
            field: args.field,
            value: record.fields[args.field.id],
        })) {
            const values = days.get(key);
            if (values == null) days.set(key, [record]);
            else values.push(record);
        }
    }
    return days;
}
