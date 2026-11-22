import type {
    PostgresField,
    PostgresFilter,
    PostgresSelectQuery,
    PostgresSelectResult,
    PostgresSort,
    PostgresSource,
    PostgresValue,
} from '../src/runtime/index.js';
import type {
    CanonicalPostgresFilter,
    CanonicalPostgresSelectQuery,
    CanonicalPostgresSelectResult,
    CanonicalPostgresSort,
    CanonicalPostgresSource,
} from '../src/runtime/contracts/postgres.generated.js';

type Equal<Left, Right> =
    (<Value>() => Value extends Left ? 1 : 2) extends <
        Value,
    >() => Value extends Right ? 1 : 2
        ? true
        : false;
type Assert<Value extends true> = Value;

// Compile-only witnesses for canonical native reads, separate from current
// public Form/Portal API operations and mutable record identity decisions.
export type PostgresQueryAliasContracts = [
    Assert<Equal<PostgresSource, CanonicalPostgresSource>>,
    Assert<Equal<PostgresFilter, CanonicalPostgresFilter>>,
    Assert<Equal<PostgresSort, CanonicalPostgresSort>>,
    Assert<Equal<PostgresSelectQuery, CanonicalPostgresSelectQuery>>,
    Assert<Equal<PostgresSelectResult, CanonicalPostgresSelectResult>>,
    Assert<
        Equal<
            PostgresSelectResult['rows'][number],
            Record<string, PostgresValue>
        >
    >,
];

export function acceptedPostgresQueryContracts(columns: PostgresField[]) {
    const source: PostgresSource = {
        type: 'postgres',
        connectionId: 'connection_example',
        databaseName: 'synthetic',
    };
    const where: PostgresFilter = {
        type: 'and',
        filters: [
            {
                type: 'comparison',
                columnName: 'amount',
                operator: 'gte',
                value: '12345678901234567890.1234567890',
            },
            {
                type: 'or',
                filters: [
                    {
                        type: 'null',
                        columnName: 'status',
                        operator: 'is-null',
                    },
                    {
                        type: 'not',
                        filter: {
                            type: 'membership',
                            columnName: 'status',
                            operator: 'in',
                            values: ['closed', 'archived'],
                        },
                    },
                ],
            },
            {
                type: 'text',
                columnName: 'title',
                operator: 'contains',
                caseSensitive: false,
                value: 'literal_%',
            },
        ],
    };
    const sort: PostgresSort = {
        columnName: 'amount',
        direction: 'desc',
        nulls: 'last',
    };
    const query: PostgresSelectQuery = {
        source,
        table: {
            connectionId: source.connectionId,
            schemaName: 'sales',
            tableName: 'order_summary',
        },
        columns: ['amount', 'status', 'title'],
        where,
        orderBy: [sort],
        limit: 25,
        offset: 0,
    };
    const unfilteredQuery: PostgresSelectQuery = { ...query };
    delete unfilteredQuery.where;
    const result: PostgresSelectResult = {
        source,
        table: query.table,
        columns,
        rows: [
            {
                amount: '12345678901234567890.1234567890',
                status: null,
                title: '',
            },
        ],
        page: { limit: 25, offset: 0, hasMore: true, nextOffset: 25 },
    };
    return { query, unfilteredQuery, result };
}

export function rejectedPostgresQueryContracts(
    query: PostgresSelectQuery,
    result: PostgresSelectResult
) {
    const wrongSource: PostgresSource = {
        // @ts-expect-error Native PostgreSQL reads cannot select an Airtable source.
        type: 'airtable',
        connectionId: 'connection_example',
        databaseName: 'synthetic',
    };
    const crossedSource: PostgresSource = {
        type: 'postgres',
        connectionId: 'connection_example',
        databaseName: 'synthetic',
        // @ts-expect-error PostgreSQL sources do not carry Airtable base IDs.
        baseId: 'app_example',
    };
    const numericOperand: PostgresFilter = {
        type: 'comparison',
        columnName: 'amount',
        operator: 'eq',
        // @ts-expect-error Native operands preserve their PostgreSQL text value.
        value: 123.45,
    };
    const implicitNull: PostgresFilter = {
        type: 'comparison',
        columnName: 'amount',
        operator: 'eq',
        // @ts-expect-error SQL NULL requires the explicit null filter operators.
        value: null,
    };
    const rawSql: PostgresSelectQuery = {
        ...query,
        // @ts-expect-error A filter is structured data, not an SQL fragment.
        where: 'amount > 0',
    };
    const inventedIdentity: PostgresSelectResult = {
        ...result,
        // @ts-expect-error Read results do not acquire mutable record identity.
        identity: { type: 'primary-key', values: [] },
    };
    return {
        wrongSource,
        crossedSource,
        numericOperand,
        implicitNull,
        rawSql,
        inventedIdentity,
    };
}
