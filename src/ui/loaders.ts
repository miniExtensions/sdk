import type { AirtableRecord } from '../formulas/types.js';
import type {
    ListFormLinkedRecordOptionsInput,
    ListLinkedRecordOptionsResult,
    ListPortalLinkedRecordOptionsInput,
    MiniExtensionsClient,
    RuntimeSession,
    RuntimeTableState,
} from '../runtime/types.js';
import type { SelectionLoader, SelectionOption } from './types.js';

/** Dispose/reset the control and create a loader for the new visitor context. */
export class SelectionScopeChangedError extends Error {
    constructor() {
        super('The visitor session changed. Reset the selection control.');
        this.name = 'SelectionScopeChangedError';
    }
}

type RecordLabelFormatter = (
    record: AirtableRecord,
    table: RuntimeTableState | undefined
) => string;

type LoaderOptions<Input> = {
    client: MiniExtensionsClient;
    input: Input;
    linkedTableId: string;
    formatRecordLabel?: RecordLabelFormatter;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);

const requireIdentifier = (value: unknown, description: string): void => {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`${description} must be a nonempty string.`);
    }
};

const validateRecord = (record: AirtableRecord): void => {
    if (!isObject(record) || !isObject(record.fields)) {
        throw new TypeError('Linked records must have an ID and field values.');
    }
    requireIdentifier(record.id, 'Linked record ID');
};

const validateTable = (table: RuntimeTableState | undefined): void => {
    if (table === undefined) return;
    if (
        !isObject(table) ||
        !Array.isArray(table.airtableFields) ||
        !isObject(table.recordIdsToAirtableRecords)
    ) {
        throw new TypeError('The linked table metadata is malformed.');
    }
    let primaryCount = 0;
    for (const field of table.airtableFields) {
        if (!isObject(field)) {
            throw new TypeError(
                'The linked table field metadata is malformed.'
            );
        }
        requireIdentifier(field.id, 'Linked table field ID');
        requireIdentifier(field.name, 'Linked table field name');
        if (
            field.isPrimaryField !== undefined &&
            typeof field.isPrimaryField !== 'boolean'
        ) {
            throw new TypeError(
                'The linked table primary metadata is malformed.'
            );
        }
        if (field.isPrimaryField === true) primaryCount += 1;
    }
    if (primaryCount > 1) {
        throw new TypeError('The linked table has multiple primary fields.');
    }
};

/** Keep JSON labels stable without guessing an object's display semantics. */
const jsonLabel = (value: unknown, ancestors = new Set<object>()): unknown => {
    if (value === undefined || value === null) return value;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || ancestors.has(value)) {
        throw new TypeError(
            'The linked record primary value is not JSON data.'
        );
    }
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map((entry) => jsonLabel(entry, ancestors));
        }
        if (Object.getPrototypeOf(value) !== Object.prototype) {
            throw new TypeError(
                'The linked record primary value is not JSON data.'
            );
        }
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [
                    key,
                    jsonLabel(
                        (value as Record<string, unknown>)[key],
                        ancestors
                    ),
                ])
        );
    } finally {
        ancestors.delete(value);
    }
};

const defaultRecordLabel = (
    record: AirtableRecord,
    table: RuntimeTableState | undefined
): string => {
    const primary = table?.airtableFields.find(
        (field) => field.isPrimaryField === true
    );
    if (primary === undefined) return record.id;
    const value = Object.hasOwn(record.fields, primary.id)
        ? record.fields[primary.id]
        : Object.hasOwn(record.fields, primary.name)
          ? record.fields[primary.name]
          : undefined;
    if (value === null || value === undefined) return record.id;
    if (typeof value === 'string') {
        return value.trim() === '' ? record.id : value;
    }
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    if (typeof value === 'boolean') return String(value);
    return JSON.stringify(jsonLabel(value));
};

/** Also maps records returned by linkedRecords.loadSelectedRecords. */
export const selectionOptionsFromRecords = (
    records: readonly AirtableRecord[],
    table: RuntimeTableState | undefined,
    formatRecordLabel?: RecordLabelFormatter
): SelectionOption[] => {
    if (!Array.isArray(records)) {
        throw new TypeError('Linked records must be an array.');
    }
    validateTable(table);
    if (
        formatRecordLabel !== undefined &&
        typeof formatRecordLabel !== 'function'
    ) {
        throw new TypeError('formatRecordLabel must be a function.');
    }
    return records.map((record) => {
        validateRecord(record);
        const label = (formatRecordLabel ?? defaultRecordLabel)(record, table);
        if (typeof label !== 'string') {
            throw new TypeError('A linked record label must be a string.');
        }
        return {
            value: record.id,
            label: label.trim() === '' ? record.id : label,
        };
    });
};

const sessionsMatch = (
    current: RuntimeSession,
    captured: RuntimeSession
): boolean => {
    const keys = Object.keys(captured);
    return (
        Object.keys(current).length === keys.length &&
        keys.every(
            (key) =>
                Object.hasOwn(current, key) && current[key] === captured[key]
        )
    );
};

const createLoader = <Input>(
    options: LoaderOptions<Input>,
    list: (
        input: Input,
        searchTerm: string,
        offset: string | null,
        signal: AbortSignal,
        session: RuntimeSession
    ) => Promise<ListLinkedRecordOptionsResult>
): SelectionLoader => {
    const { client, linkedTableId, formatRecordLabel } = options;
    requireIdentifier(linkedTableId, 'Linked table ID');
    if (
        formatRecordLabel !== undefined &&
        typeof formatRecordLabel !== 'function'
    ) {
        throw new TypeError('formatRecordLabel must be a function.');
    }
    const input = structuredClone(options.input);
    const session = { ...client.getSession() };
    const isCurrent = () => {
        try {
            return sessionsMatch(client.getSession(), session);
        } catch {
            return false;
        }
    };
    const requireScope = () => {
        if (!isCurrent()) {
            throw new SelectionScopeChangedError();
        }
    };
    const loader: SelectionLoader = async (request) => {
        requireScope();
        request.signal.throwIfAborted();
        if (
            typeof request.searchTerm !== 'string' ||
            (request.offset !== null && typeof request.offset !== 'string')
        ) {
            throw new TypeError(
                'The linked record selection request is malformed.'
            );
        }
        const result = await list(
            structuredClone(input),
            request.searchTerm,
            request.offset,
            request.signal,
            { ...session }
        );
        requireScope();
        request.signal.throwIfAborted();
        if (
            !isObject(result) ||
            !Array.isArray(result.records) ||
            (result.offset !== null && typeof result.offset !== 'string') ||
            !isObject(result.tableIdsToLinkedTableStates)
        ) {
            throw new TypeError(
                'The linked record selection response is malformed.'
            );
        }
        const table = Object.hasOwn(
            result.tableIdsToLinkedTableStates,
            linkedTableId
        )
            ? result.tableIdsToLinkedTableStates[linkedTableId]
            : undefined;
        const page = {
            options: selectionOptionsFromRecords(
                result.records,
                table,
                formatRecordLabel
            ),
            offset: result.offset,
        };
        // A custom formatter can synchronously change the client's session.
        requireScope();
        request.signal.throwIfAborted();
        return page;
    };
    loader.isCurrent = isCurrent;
    return loader;
};

/** Conditional filtering values are caller-known; this does not discover them. */
export const createFormLinkedRecordLoader = (
    options: LoaderOptions<
        Omit<ListFormLinkedRecordOptionsInput, 'filter' | 'offset'>
    >
): SelectionLoader => {
    requireIdentifier(
        options.input.extensionAccessToken,
        'Extension access token'
    );
    requireIdentifier(
        options.input.linkedRecordFieldId,
        'Linked record field ID'
    );
    const { client } = options;
    return createLoader(options, (input, searchTerm, offset, signal, session) =>
        client.linkedRecords.listFormOptions(
            { ...input, filter: { viewType: 'list', searchTerm }, offset },
            { signal, session }
        )
    );
};

export const createPortalLinkedRecordLoader = (
    options: LoaderOptions<
        Omit<ListPortalLinkedRecordOptionsInput, 'filter' | 'offset'>
    >
): SelectionLoader => {
    requireIdentifier(
        options.input.extensionAccessToken,
        'Extension access token'
    );
    requireIdentifier(
        options.input.linkedRecordFieldId,
        'Linked record field ID'
    );
    requireIdentifier(options.input.portalTableId, 'Portal table ID');
    requireIdentifier(options.input.portalFieldId, 'Portal field ID');
    const { client } = options;
    return createLoader(options, (input, searchTerm, offset, signal, session) =>
        client.linkedRecords.listPortalOptions(
            { ...input, filter: { viewType: 'list', searchTerm }, offset },
            { signal, session }
        )
    );
};
