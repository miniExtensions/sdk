import moment from 'moment-timezone';
import { getReadableStringFromAirtableValue } from '../formulas/valueConversion.js';
import type { RuntimeAirtableField } from '../runtime/types.js';

export type DateFieldState = {
    kind: 'date' | 'dateTime';
    input: string;
    valid: boolean;
    error: string | null;
    display: string | null;
    timeZone: string | null;
    canEdit: boolean;
    retired: boolean;
    revision: number;
};
export type DateFieldModel = {
    getState(): DateFieldState;
    subscribe(listener: () => void): () => void;
    setInput(input: string): boolean;
    clear(): boolean;
    accepts(value: unknown): boolean;
    refresh(expectedRevision?: number): void;
    destroy(): void;
};
export type DateFieldModelOptions = {
    kind: 'date' | 'dateTime';
    getValue(): unknown;
    getConfig(): RuntimeAirtableField['config'];
    getClientTimeZone?(): string;
    canEdit(): boolean;
    isCurrent(): boolean;
    write(value: string | null): boolean;
};
const formats = new Map([
    ['local', 'l'],
    ['friendly', 'LL'],
    ['us', 'M/D/YYYY'],
    ['european', 'D/M/YYYY'],
    ['iso', 'YYYY-MM-DD'],
]);
const times = new Map([
    ['12hour', 'h:mma'],
    ['24hour', 'HH:mm'],
]);
const pair = (value: unknown, allowed: ReadonlyMap<string, string>) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const entry = value as { name?: unknown; format?: unknown };
    return (
        typeof entry.name === 'string' &&
        typeof entry.format === 'string' &&
        allowed.get(entry.name) === entry.format
    );
};
const calendar = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    moment.utc(value, 'YYYY-MM-DD', true).isValid();
/** Calendar-only dates and explicit-offset instants; no local-time/DST inference. */
export const isDateFieldNativeValue = (
    kind: DateFieldState['kind'],
    value: unknown
): value is string | null => {
    if (value === null) return true;
    if (typeof value !== 'string') return false;
    if (kind === 'date') return calendar(value);
    const match =
        /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(
            value
        );
    return (
        match !== null &&
        calendar(match[1]!) &&
        match[6] !== '-00:00' &&
        Number(match[2]) <= 23 &&
        Number(match[3]) <= 59 &&
        Number(match[4]) <= 59 &&
        (match[6] === 'Z' ||
            (Number(match[7]) <= 23 && Number(match[8]) <= 59)) &&
        moment.parseZone(value, moment.ISO_8601, true).isValid()
    );
};
export function createDateFieldModel(
    options: DateFieldModelOptions
): DateFieldModel {
    let retired = false,
        revision = 0,
        initialized = false;
    let seen: unknown,
        input = '',
        error: string | null = null;
    const listeners = new Set<() => void>();
    const context = () => {
        const config = structuredClone(options.getConfig());
        if (
            config.type !== options.kind ||
            (config.type !== 'date' && config.type !== 'dateTime') ||
            !pair(config.options?.dateFormat, formats)
        )
            throw Error('configuration');
        const zone =
            config.type === 'dateTime'
                ? config.options.timeZone === 'client'
                    ? (options.getClientTimeZone?.() ??
                      Intl.DateTimeFormat().resolvedOptions().timeZone)
                    : config.options.timeZone
                : null;
        if (
            config.type === 'dateTime' &&
            (!pair(config.options?.timeFormat, times) ||
                typeof zone !== 'string' ||
                moment.tz.zone(zone) === null)
        )
            throw Error('configuration');
        return { config, zone, key: JSON.stringify([config, zone]) };
    };
    let captured: ReturnType<typeof context> | null = null;
    let contextInitialized = false;
    const current = () => {
        if (retired) return false;
        if (!options.isCurrent()) {
            retired = true;
            revision++;
            return false;
        }
        if (!contextInitialized) {
            contextInitialized = true;
            try {
                captured = context();
            } catch {
                /* Unsupported metadata does not guess policy. */
            }
        }
        try {
            if (captured && context().key !== captured.key) {
                retired = true;
                revision++;
            }
        } catch {
            if (captured) {
                retired = true;
                revision++;
            }
        }
        return !retired;
    };
    const sync = () => {
        if (!current()) return;
        const ticket = revision,
            native = options.getValue();
        if (!current() || ticket !== revision) return;
        if (!initialized || !Object.is(seen, native)) {
            initialized = true;
            seen = native;
            const empty =
                native == null ||
                (typeof native === 'string' && native.trim() === '');
            input = empty ? '' : typeof native === 'string' ? native : '';
            error =
                captured === null
                    ? 'Date editing is unavailable for this configuration.'
                    : empty || isDateFieldNativeValue(options.kind, native)
                      ? null
                      : 'This field has an unsupported native value.';
        }
    };
    const notify = () => {
        for (const listener of [...listeners]) {
            try {
                listener();
            } catch {}
        }
    };
    const edit = (value: string | null, text: string) => {
        sync();
        if (!current() || captured === null || !options.canEdit() || !current())
            return false;
        const ticket = ++revision;
        if (!options.write(value) || !current() || revision !== ticket)
            return false;
        seen = options.getValue();
        initialized = true;
        input = text;
        error = null;
        notify();
        return true;
    };
    return {
        getState() {
            sync();
            const live = current();
            let display: string | null = null;
            if (
                live &&
                error === null &&
                captured &&
                seen != null &&
                isDateFieldNativeValue(options.kind, seen)
            ) {
                try {
                    const config = captured.config;
                    display =
                        config.type === 'date'
                            ? moment
                                  .utc(seen, 'YYYY-MM-DD', true)
                                  .format(config.options.dateFormat.format)
                            : getReadableStringFromAirtableValue({
                                  value: seen,
                                  airtableFieldConfig:
                                      config.type === 'dateTime'
                                          ? {
                                                ...config,
                                                options: {
                                                    ...config.options,
                                                    timeZone:
                                                        captured.zone as typeof config.options.timeZone,
                                                },
                                            }
                                          : config,
                                  source: {
                                      type: 'airtableMock',
                                      linkedTableStates: {},
                                      dateParsing: 'utc',
                                  },
                                  fieldName: 'Date',
                              });
                } catch {
                    display = null;
                }
            }
            const canEdit =
                live && captured !== null && options.canEdit() && current();
            return {
                kind: options.kind,
                input: current() ? input : '',
                valid: current() && error === null,
                error: current() ? error : null,
                display: current() ? display : null,
                timeZone: current() ? (captured?.zone ?? null) : null,
                canEdit,
                retired: !current(),
                revision,
            };
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        setInput(value) {
            sync();
            if (
                typeof value !== 'string' ||
                !current() ||
                captured === null ||
                !options.canEdit() ||
                !current()
            )
                return false;
            if (value === '') return edit(null, '');
            if (!isDateFieldNativeValue(options.kind, value)) {
                revision++;
                input = value;
                error =
                    options.kind === 'date'
                        ? 'Enter a calendar date as YYYY-MM-DD.'
                        : 'Enter a dateTime with seconds and an explicit offset.';
                notify();
                return false;
            }
            return edit(value, value);
        },
        clear: () => edit(null, ''),
        accepts: (value) =>
            current() &&
            captured !== null &&
            isDateFieldNativeValue(options.kind, value),
        refresh(expected) {
            if (!current() || (expected !== undefined && expected !== revision))
                return;
            revision++;
            initialized = false;
            sync();
            notify();
        },
        destroy() {
            if (retired) {
                listeners.clear();
                return;
            }
            retired = true;
            revision++;
            notify();
            listeners.clear();
        },
    };
}
