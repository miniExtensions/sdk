import {
    CSVExportFailure,
    type CSVExportFailureReason,
} from './csvExportError.js';
import {
    getReadableStringFromAirtableValue,
    type GetReadableStringSource,
} from '../formulas/valueConversion.js';
import type { AirtableField, AirtableValue } from '../formulas/types.js';
import { serializeCSVExportDocument } from './csvSerialization.js';

export type CSVExportColumn = Readonly<{
    key: string;
    title: string;
    isHidden?: boolean;
}>;
export type CSVExportFieldValue = Readonly<{
    field: Pick<AirtableField, 'id' | 'name' | 'config'>;
    value: AirtableValue;
}>;
export type CSVExportRow = Readonly<
    | { status: 'loading' | 'failed' }
    | {
          status: 'loaded';
          hasError?: boolean;
          isPaginating?: boolean;
          isReloading?: boolean;
          viewType: string;
          fields: readonly CSVExportFieldValue[];
      }
>;
export type CSVExportInput = Readonly<{
    /** Current native host admission, never inferred from render/open access. */
    admission: Readonly<{
        cohort: 'portal-grid' | 'form-linked-grid';
        allowed: boolean;
        borrowedRecords: boolean;
    }>;
    rows: readonly CSVExportRow[];
    columns: readonly CSVExportColumn[];
    unavailableLinkedRecordPlaceholder?: string;
    /** Synchronous formatting of only the already-admitted field/value. */
    formatField?: (field: CSVExportFieldValue) => string;
}>;
export type CSVExportDocument = Readonly<{
    columns: readonly Readonly<{ key: string; title: string }>[];
    rows: readonly (readonly Readonly<{
        readableValue: string;
        rawWasNumber: boolean;
    }>[])[];
}>;
export {
    CSVExportFailure,
    type CSVExportFailureReason,
} from './csvExportError.js';

export type CSVExportProjection =
    | Readonly<{ status: 'empty' }>
    | Readonly<{ status: 'blocked'; failure: CSVExportFailure }>
    | Readonly<{ status: 'ready'; document: CSVExportDocument }>;

/** Detach formatting before any asynchronous serializer or browser operation. */
function isAdmitted(input: CSVExportInput): boolean {
    return (
        input.admission.allowed === true &&
        input.admission.borrowedRecords === false &&
        ['portal-grid', 'form-linked-grid'].includes(input.admission.cohort)
    );
}

export function projectCSVExport(input: CSVExportInput): CSVExportProjection {
    if (input.rows.length === 0) return { status: 'empty' };
    const columns = input.columns.filter((column) => !column.isHidden);
    const failure = (reason: CSVExportFailureReason, error?: unknown) => ({
        status: 'blocked' as const,
        failure: new CSVExportFailure(
            reason,
            input.rows.length,
            columns.length,
            error
        ),
    });
    if (!isAdmitted(input)) return failure('denied');
    if (
        input.rows.some(
            (row) =>
                row.status === 'failed' ||
                (row.status === 'loaded' && row.hasError)
        )
    )
        return failure('failed');
    if (
        input.rows.some(
            (row) =>
                row.status !== 'loaded' || row.isPaginating || row.isReloading
        )
    )
        return failure('loading');

    try {
        const schema = new Map<string, CSVExportFieldValue['field']>();
        const records: Map<string, CSVExportFieldValue>[] = [];
        for (const row of input.rows) {
            if (row.status !== 'loaded' || row.viewType !== 'list')
                return failure('schema');
            const fields = new Map<string, CSVExportFieldValue>();
            for (const descriptor of row.fields) {
                const prior = schema.get(descriptor.field.name);
                if (prior && prior.id !== descriptor.field.id)
                    return failure('schema');
                schema.set(descriptor.field.name, descriptor.field);
                fields.set(descriptor.field.name, descriptor);
            }
            records.push(fields);
        }
        if (columns.some((column) => !schema.has(column.key)))
            return failure('schema');
        const source: GetReadableStringSource = {
            type: 'airtableMock',
            linkedTableStates: {},
            doNotReturnRecordIdsForLinkedRecords: true,
            unavailableLinkedRecordPlaceholder:
                input.unavailableLinkedRecordPlaceholder ?? '',
        };
        const format =
            input.formatField ??
            ((descriptor: CSVExportFieldValue) =>
                getReadableStringFromAirtableValue({
                    value: descriptor.value,
                    airtableFieldConfig: descriptor.field.config,
                    fieldName: descriptor.field.name,
                    source,
                }));
        const rows = records.map((record) => {
            const cells = new Map<
                string,
                Readonly<{ readableValue: string; rawWasNumber: boolean }>
            >();
            for (const column of columns) {
                if (cells.has(column.key)) continue;
                const descriptor = record.get(column.key);
                // Native formatting resolves the union's current schema.
                const field = schema.get(column.key);
                const readableValue =
                    descriptor && field
                        ? format({ field, value: descriptor.value })
                        : '';
                if (typeof readableValue !== 'string')
                    throw new TypeError('CSV formatter must be synchronous');
                cells.set(
                    column.key,
                    Object.freeze({
                        readableValue,
                        rawWasNumber:
                            descriptor != null &&
                            typeof descriptor.value === 'number',
                    })
                );
            }
            return Object.freeze(
                columns.map((column) => {
                    const cell = cells.get(column.key);
                    if (!cell) throw new TypeError('Missing projected cell');
                    return cell;
                })
            );
        });
        return {
            status: 'ready',
            document: Object.freeze({
                columns: Object.freeze(
                    columns.map(({ key, title }) =>
                        Object.freeze({ key, title })
                    )
                ),
                rows: Object.freeze(rows),
            }),
        };
    } catch (error) {
        return failure('unexpected', error);
    }
}

export type CSVExportPlatform = Readonly<{
    createBlob: (csv: string) => object;
    createObjectURL: (blob: object) => string;
    revokeObjectURL: (url: string) => void;
    createAnchor: () => {
        setAttribute(name: string, value: string): void;
        click(): void;
    };
}>;

/** Resolves globals only after successful serialization, never at import/render. */
function browserPlatform(): CSVExportPlatform {
    return {
        createBlob: (csv) => new Blob([csv], { type: 'text/csv' }),
        createObjectURL: (blob) => {
            if (!(blob instanceof Blob)) throw new TypeError('Invalid Blob');
            return URL.createObjectURL(blob);
        },
        revokeObjectURL: (url) => URL.revokeObjectURL(url),
        createAnchor: () => document.createElement('a'),
    };
}

export type CSVExportRequest = Readonly<{
    input: CSVExportInput;
    filename: string;
    /** Browser/platform boundary only; never a replacement CSV implementation. */
    platform?: CSVExportPlatform;
}>;
export type CSVExportOutcome =
    | Readonly<{ status: 'empty' | 'confirmation' | 'delivered' }>
    | Readonly<{ status: 'blocked'; failure: CSVExportFailure }>;
export type CSVExportSnapshot = Readonly<{
    confirmationOpen: boolean;
    pendingCount: number;
    failure: CSVExportFailure | null;
}>;

export function createCSVExportController(options: {
    /** Must read the host's current committed data/policy at each invocation. */
    readCurrent(): CSVExportRequest;
    onFailure?: (failure: CSVExportFailure) => void;
}) {
    let snapshot: CSVExportSnapshot = {
        confirmationOpen: false,
        pendingCount: 0,
        failure: null,
    };
    const listeners = new Set<() => void>();
    const update = (patch: Partial<CSVExportSnapshot>) => {
        snapshot = { ...snapshot, ...patch };
        for (const listener of listeners) {
            try {
                listener();
            } catch {
                /* Observers do not own attempts. */
            }
        }
    };
    const blocked = (failure: CSVExportFailure): CSVExportOutcome => {
        update({ failure });
        try {
            options.onFailure?.(failure);
        } catch {
            // Telemetry cannot expose raw errors or change an allocated result.
        }
        return { status: 'blocked', failure };
    };
    const run = async (
        request: CSVExportRequest
    ): Promise<CSVExportOutcome> => {
        const projected = projectCSVExport(request.input);
        if (projected.status === 'empty') return projected;
        if (projected.status === 'blocked') return blocked(projected.failure);
        // Capture filename/platform with the detached document before first await.
        const { document: captured } = projected;
        const filename = request.filename;
        const platform = request.platform ?? browserPlatform();
        update({ pendingCount: snapshot.pendingCount + 1, failure: null });
        try {
            const csv = await serializeCSVExportDocument(captured);
            const blob = platform.createBlob(csv);
            const url = platform.createObjectURL(blob);
            try {
                const anchor = platform.createAnchor();
                anchor.setAttribute('href', url);
                anchor.setAttribute('download', filename);
                anchor.click();
            } finally {
                platform.revokeObjectURL(url);
            }
            return { status: 'delivered' };
        } catch (error) {
            return blocked(
                new CSVExportFailure(
                    'unexpected',
                    captured.rows.length,
                    captured.columns.length,
                    error
                )
            );
        } finally {
            update({ pendingCount: snapshot.pendingCount - 1 });
        }
    };
    return {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        request(): Promise<CSVExportOutcome> {
            const current = options.readCurrent();
            if (current.input.rows.length === 0)
                return Promise.resolve({ status: 'empty' });
            if (!isAdmitted(current.input)) {
                const result = projectCSVExport(current.input);
                if (result.status === 'blocked')
                    return Promise.resolve(blocked(result.failure));
            }
            if (current.input.rows.length >= 100) {
                update({ confirmationOpen: !snapshot.confirmationOpen });
                return Promise.resolve({ status: 'confirmation' });
            }
            return run(current);
        },
        confirm(): Promise<CSVExportOutcome> {
            update({ confirmationOpen: false });
            return run(options.readCurrent());
        },
        dismiss() {
            update({ confirmationOpen: false });
        },
    };
}
export type CSVExportController = ReturnType<typeof createCSVExportController>;
