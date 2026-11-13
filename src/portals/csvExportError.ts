export type CSVExportFailureReason =
    | 'denied'
    | 'failed'
    | 'loading'
    | 'schema'
    | 'unexpected';

function errorType(error: unknown): string {
    if (error instanceof TypeError) return 'TypeError';
    if (error instanceof RangeError) return 'RangeError';
    if (error instanceof Error) return 'Error';
    return typeof error;
}

/** Classified metadata only: no source error, field/row values or identifiers. */
export class CSVExportFailure extends Error {
    readonly errorType: string | undefined;
    constructor(
        readonly reason: CSVExportFailureReason,
        readonly recordCount: number,
        readonly visibleFieldCount: number,
        error?: unknown
    ) {
        super(`CSV export failed: ${reason}`);
        this.name = 'CSVExportFailure';
        this.errorType = reason === 'unexpected' ? errorType(error) : undefined;
    }
}
