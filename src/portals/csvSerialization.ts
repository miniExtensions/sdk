import { CSVExportFailure } from './csvExportError.js';
import type { CSVExportDocument } from './csvExport.js';

/** Exact #7926 cell/header rule; raw numeric classification predates formatting. */
const neutralize = (readableValue: string, rawWasNumber: boolean) =>
    !rawWasNumber && /^[=+\-@\t\r]/.test(readableValue)
        ? `'${readableValue}`
        : readableValue;

/** The package browser map selects csv-stringify's explicit async browser entry. */
export async function serializeCSVExportDocument(
    document: CSVExportDocument
): Promise<string> {
    try {
        const records = document.rows.map((row) =>
            row.map((cell) => neutralize(cell.readableValue, cell.rawWasNumber))
        );
        const columns = document.columns.map((column, index) => ({
            key: String(index),
            header: neutralize(column.title, false),
        }));
        const { stringify } = await import('csv-stringify');
        return await new Promise<string>((resolve, reject) => {
            stringify(records, { columns, header: true }, (error, output) => {
                if (error) reject(error);
                else resolve(output);
            });
        });
    } catch (error) {
        throw new CSVExportFailure(
            'unexpected',
            document.rows.length,
            document.columns.length,
            error
        );
    }
}
