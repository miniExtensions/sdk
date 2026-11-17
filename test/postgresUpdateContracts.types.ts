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
        collationOid: null,
        notNull: true,
        hasDefault: false,
        identity: null,
        generated: null,
        description: null,
        privileges: { select: true, insert: false, update: true },
    };
    const observation: PostgresRowObservation = {
        formatVersion: 1 as const,
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
                    collationOid: null,
                },
            ],
        },
        identity: {
            formatVersion: 1 as const,
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
                collationOid: 16422,
                notNull: false,
            },
        ],
        fields: { id: '9007199254740993', title: null },
    };
    const query: PostgresUpdateQuery = {
        formatVersion: 1 as const,
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
                formatVersion: 1 as const,
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
    // Older saved authoring bindings remain loadable; these values must be
    // explicitly refreshed/rebound before any preview or mutation is admitted.
    const legacyPrimaryBindingForRebind: PostgresRowObservation['identifier'] =
        {
            configuration: { type: 'primary-key' },
            columns: [
                {
                    name: 'id',
                    ordinal: 1,
                    typeOid: 20,
                    formattedType: 'bigint',
                },
            ],
        };
    const legacyConfiguredBindingForRebind: PostgresRowObservation['identifier'] =
        {
            ...legacyPrimaryBindingForRebind,
            configuration: {
                type: 'configured-key',
                columnNames: ['id'],
                stabilityConfirmed: true,
            },
        };
    const stringBindingCollation: PostgresRowObservation['identifier']['columns'][number] =
        {
            name: 'id',
            ordinal: 1,
            typeOid: 20,
            formattedType: 'bigint',
            // @ts-expect-error A known collation remains a database-local OID or explicit SQL NULL.
            collationOid: '16422',
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
        legacyPrimaryBindingForRebind,
        legacyConfiguredBindingForRebind,
        stringBindingCollation,
        unconfirmed,
        wrongOutcome,
        missingBaseline,
        undefinedBaseline,
        numericCoercion,
        wrongSource,
        nullIdentity,
    };
}

// Ephemeral observations cannot silently upgrade previously formatted values.
type VersionAssert<T extends true> = T;
type InvalidObservedVersion<T, V> = Omit<T, 'formatVersion'> & {
    formatVersion: V;
} extends T
    ? false
    : true;
export type PostgresObservedValueVersions = [
    VersionAssert<
        Omit<
            PostgresRowObservation,
            'formatVersion'
        > extends PostgresRowObservation
            ? false
            : true
    >,
    VersionAssert<InvalidObservedVersion<PostgresRowObservation, undefined>>,
    VersionAssert<InvalidObservedVersion<PostgresRowObservation, 0>>,
    VersionAssert<InvalidObservedVersion<PostgresRowObservation, 2>>,
    VersionAssert<InvalidObservedVersion<PostgresRowObservation, '1'>>,
    VersionAssert<
        Omit<PostgresUpdateQuery, 'formatVersion'> extends PostgresUpdateQuery
            ? false
            : true
    >,
    VersionAssert<InvalidObservedVersion<PostgresUpdateQuery, undefined>>,
    VersionAssert<InvalidObservedVersion<PostgresUpdateQuery, 0>>,
    VersionAssert<InvalidObservedVersion<PostgresUpdateQuery, 2>>,
    VersionAssert<InvalidObservedVersion<PostgresUpdateQuery, '1'>>,
    VersionAssert<
        Omit<
            PostgresRowObservation['identity'],
            'formatVersion'
        > extends PostgresRowObservation['identity']
            ? false
            : true
    >,
    VersionAssert<
        InvalidObservedVersion<PostgresRowObservation['identity'], undefined>
    >,
    VersionAssert<
        InvalidObservedVersion<PostgresRowObservation['identity'], 0>
    >,
    VersionAssert<
        InvalidObservedVersion<PostgresRowObservation['identity'], 2>
    >,
    VersionAssert<
        InvalidObservedVersion<PostgresRowObservation['identity'], '1'>
    >,
];
