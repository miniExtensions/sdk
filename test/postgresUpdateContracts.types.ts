import type {
    PostgresField,
    PostgresRowObservation,
    PostgresUpdateQuery,
    PostgresUpdateResult,
} from '../src/runtime/index.js';
import type {
    CanonicalPostgresRowObservation,
    CanonicalPostgresUpdateQuery,
    CanonicalPostgresUpdateResult,
} from '../src/runtime/contracts/postgres.generated.js';

type Equivalent<A, B> = [A] extends [B]
    ? [B] extends [A]
        ? true
        : false
    : false;
type Assert<T extends true> = T;
export type PostgresUpdateAliases = [
    Assert<Equivalent<PostgresRowObservation, CanonicalPostgresRowObservation>>,
    Assert<Equivalent<PostgresUpdateQuery, CanonicalPostgresUpdateQuery>>,
    Assert<Equivalent<PostgresUpdateResult, CanonicalPostgresUpdateResult>>,
];

export function postgresUpdateContracts() {
    const field: PostgresField = {
        name: 'id',
        ordinal: 1,
        typeOid: 20,
        formattedType: 'bigint',
        notNull: true,
        hasDefault: false,
        identity: null,
        generated: null,
        description: null,
        privileges: { select: true, insert: false, update: true },
    };
    const observation: PostgresRowObservation = {
        source: {
            type: 'postgres',
            connectionId: 'synthetic-connection',
            databaseName: 'synthetic',
        },
        table: {
            connectionId: 'synthetic-connection',
            schemaName: 'Sales Ops',
            tableName: 'Order Items',
        },
        relationOid: 16400,
        identifier: {
            configuration: { type: 'primary-key' },
            columns: [
                {
                    name: 'id',
                    ordinal: 1,
                    typeOid: 20,
                    formattedType: 'bigint',
                },
            ],
        },
        identity: {
            type: 'primary-key',
            values: [{ columnName: 'id', value: '9007199254740993' }],
        },
        columns: [
            field,
            {
                ...field,
                name: 'title',
                ordinal: 2,
                typeOid: 25,
                formattedType: 'text',
                notNull: false,
            },
        ],
        fields: { id: '9007199254740993', title: null },
    };
    const query: PostgresUpdateQuery = {
        source: observation.source,
        table: observation.table,
        identifier: observation.identifier,
        identity: observation.identity,
        changes: [
            {
                columnName: 'id',
                expected: '9007199254740993',
                value: '9007199254740995',
            },
            { columnName: 'title', expected: null, value: '' },
        ],
        criteria: { orderBy: [] },
        returningColumns: ['id', 'title'],
        displayColumnName: 'title',
    };
    const changedTitleOnly: PostgresUpdateQuery = {
        ...query,
        // A column omitted from this array has neither an assignment nor a CAS baseline.
        changes: [{ columnName: 'title', expected: '', value: null }],
    };
    const result: PostgresUpdateResult = {
        outcome: 'committed',
        source: query.source,
        table: query.table,
        observation: {
            ...observation,
            identity: {
                type: 'primary-key',
                values: [{ columnName: 'id', value: '9007199254740995' }],
            },
            fields: { id: '9007199254740995', title: '' },
        },
    };
    const configured: PostgresRowObservation = {
        ...observation,
        identifier: {
            ...observation.identifier,
            configuration: {
                type: 'configured-key',
                columnNames: ['id'],
                stabilityConfirmed: true,
            },
        },
        identity: { ...observation.identity, type: 'configured-key' },
    };
    const configuredQuery: PostgresUpdateQuery = {
        ...changedTitleOnly,
        identifier: configured.identifier,
        identity: configured.identity,
    };
    const unconfirmed: PostgresRowObservation['identifier']['configuration'] = {
        type: 'configured-key',
        columnNames: ['id'],
        // @ts-expect-error Configured stable keys require explicit confirmation.
        stabilityConfirmed: false,
    };
    const wrongOutcome: PostgresUpdateResult = {
        ...result,
        // @ts-expect-error Conflict or uncertain outcomes cannot claim committed returned data.
        outcome: 'unknown',
    };
    const missingBaseline: PostgresUpdateQuery = {
        ...query,
        // @ts-expect-error Every submitted field requires its loaded baseline.
        changes: [{ columnName: 'title', value: '' }],
    };
    const undefinedBaseline: PostgresUpdateQuery = {
        ...query,
        // @ts-expect-error Undefined is neither an omitted assignment nor SQL NULL.
        changes: [{ columnName: 'title', expected: undefined, value: '' }],
    };
    const numericCoercion: PostgresUpdateQuery = {
        ...query,
        // @ts-expect-error Native values stay strings even above the safe integer range.
        changes: [{ columnName: 'id', expected: '9007199254740993', value: 1 }],
    };
    const wrongSource: PostgresUpdateQuery = {
        ...query,
        source: {
            // @ts-expect-error Native updates cannot consume an Airtable source.
            type: 'airtable',
            baseId: 'appSynthetic',
            tableId: 'tblSynthetic',
        },
    };
    const nullIdentity: PostgresRowObservation = {
        ...observation,
        // @ts-expect-error An editing observation has a real native/configured key.
        identity: null,
    };
    return {
        observation,
        query,
        changedTitleOnly,
        result,
        configured,
        configuredQuery,
        unconfirmed,
        wrongOutcome,
        missingBaseline,
        undefinedBaseline,
        numericCoercion,
        wrongSource,
        nullIdentity,
    };
}
