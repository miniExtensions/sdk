import {
    parsePostgresAttachmentDisplay,
    PostgresAttachmentDisplayError,
    type PostgresAttachmentDisplayFailure,
    type PostgresCreateQuery,
    type PostgresCreateResult,
    type PostgresSource,
} from '../src/runtime/index.js';
import type {
    CanonicalPostgresAttachmentDisplayFailure,
    CanonicalPostgresCreateQuery,
    CanonicalPostgresCreateResult,
} from '../src/runtime/contracts/postgres.generated.js';

type Equivalent<A, B> = [A] extends [B]
    ? [B] extends [A]
        ? true
        : false
    : false;
type Assert<T extends true> = T;
export type PostgresCreateAliases = [
    Assert<Equivalent<PostgresCreateQuery, CanonicalPostgresCreateQuery>>,
    Assert<Equivalent<PostgresCreateResult, CanonicalPostgresCreateResult>>,
    Assert<
        Equivalent<
            PostgresAttachmentDisplayFailure,
            CanonicalPostgresAttachmentDisplayFailure
        >
    >,
    Assert<
        Equivalent<
            ReturnType<typeof parsePostgresAttachmentDisplay>,
            readonly string[]
        >
    >,
];

export function postgresCreateContracts(source: PostgresSource) {
    const query: PostgresCreateQuery = {
        source,
        table: {
            connectionId: source.connectionId,
            schemaName: 'Sales Ops',
            tableName: 'Order Items',
        },
        values: [
            { columnName: 'amount', value: '12345678901234567890.1234567890' },
            { columnName: 'nullable', value: null },
        ],
        returningColumns: ['id', 'title'],
        displayColumnName: 'title',
    };
    const result: PostgresCreateResult = {
        outcome: 'committed',
        source,
        table: query.table,
        columns: [],
        fields: { id: '9007199254740993', title: 'Synthetic order' },
    };
    const wrongOutcome: PostgresCreateResult = {
        ...result,
        // @ts-expect-error A pending/count-only result cannot claim committed RETURNING values.
        outcome: 'count-only',
    };
    const wrongSource: PostgresCreateQuery = {
        ...query,
        source: {
            // @ts-expect-error Native creates cannot consume Airtable source identity.
            type: 'airtable',
            baseId: 'appSynthetic',
            tableId: 'tblSynthetic',
        },
    };
    const numeric: PostgresCreateQuery = {
        ...query,
        // @ts-expect-error Native text wire values cannot silently lose precision.
        values: [{ columnName: 'amount', value: 9007199254740993 }],
    };
    const reason: PostgresAttachmentDisplayFailure = 'URL_CREDENTIALS';
    const error = new PostgresAttachmentDisplayError(1, reason);
    const urls = parsePostgresAttachmentDisplay(
        'https://example.invalid/a%2Cb.pdf'
    );
    // @ts-expect-error Display results are read-only presentation values.
    urls.push('https://example.invalid/upload');
    // @ts-expect-error Native SQL values are text or SQL NULL.
    parsePostgresAttachmentDisplay({ url: 'https://example.invalid/a.pdf' });
    return { query, result, wrongOutcome, wrongSource, numeric, error, urls };
}
