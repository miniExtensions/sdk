import type {
    PostgresIdentifierConfiguration,
    PostgresRecordDisplayConfiguration,
    PostgresRecordEditingConfiguration,
    PostgresRecordEditingValidation,
} from '../src/runtime/index.js';
import type {
    CanonicalPostgresIdentifierConfiguration,
    CanonicalPostgresRecordDisplayConfiguration,
    CanonicalPostgresRecordEditingConfiguration,
    CanonicalPostgresRecordEditingValidation,
} from '../src/runtime/contracts/postgres.generated.js';

type Equal<Left, Right> =
    (<Value>() => Value extends Left ? 1 : 2) extends <
        Value,
    >() => Value extends Right ? 1 : 2
        ? true
        : false;
type Assert<Value extends true> = Value;

export type PostgresRecordSettingsAliasContracts = [
    Assert<
        Equal<
            PostgresIdentifierConfiguration,
            CanonicalPostgresIdentifierConfiguration
        >
    >,
    Assert<
        Equal<
            PostgresRecordDisplayConfiguration,
            CanonicalPostgresRecordDisplayConfiguration
        >
    >,
    Assert<
        Equal<
            PostgresRecordEditingConfiguration,
            CanonicalPostgresRecordEditingConfiguration
        >
    >,
    Assert<
        Equal<
            PostgresRecordEditingValidation,
            CanonicalPostgresRecordEditingValidation
        >
    >,
    Assert<
        Equal<
            PostgresRecordEditingValidation['uniquenessScope'],
            'current-visible-snapshot'
        >
    >,
];

export function acceptedPostgresRecordSettings() {
    const display: PostgresRecordDisplayConfiguration = {
        source: {
            type: 'postgres',
            connectionId: 'connection_example',
            databaseName: 'synthetic',
        },
        table: {
            connectionId: 'connection_example',
            schemaName: 'sales',
            tableName: 'customers',
        },
        displayColumnName: 'customer_name',
    };
    const primaryKey: PostgresRecordEditingConfiguration = {
        ...display,
        identifier: { type: 'primary-key' },
    };
    const configuredKey: PostgresIdentifierConfiguration = {
        type: 'configured-key',
        columnNames: ['tenant_id', 'external_id'],
        stabilityConfirmed: true,
    };
    const customerConfigured: PostgresRecordEditingConfiguration = {
        ...display,
        identifier: configuredKey,
    };
    const observation: PostgresRecordEditingValidation = {
        configuration: customerConfigured,
        relationOid: 16400,
        identifierColumnNames: ['tenant_id', 'external_id'],
        hasVisibleRows: true,
        uniquenessScope: 'current-visible-snapshot',
        stabilityBasis: 'customer-confirmed',
    };
    return { display, primaryKey, customerConfigured, observation };
}

export function rejectedPostgresRecordSettings(
    configuration: PostgresRecordEditingConfiguration,
    validation: PostgresRecordEditingValidation
) {
    // @ts-expect-error Editing still requires an explicit display column with a native PK.
    const missingDisplay: PostgresRecordEditingConfiguration = {
        source: configuration.source,
        table: configuration.table,
        identifier: { type: 'primary-key' },
    };
    // @ts-expect-error Configured keys require the customer's explicit stability confirmation.
    const unconfirmed: PostgresIdentifierConfiguration = {
        type: 'configured-key',
        columnNames: ['external_id'],
    };
    const refusedConfirmation: PostgresIdentifierConfiguration = {
        type: 'configured-key',
        columnNames: ['external_id'],
        // @ts-expect-error A false confirmation is not an editing configuration.
        stabilityConfirmed: false,
    };
    const globalUniqueness: PostgresRecordEditingValidation = {
        ...validation,
        // @ts-expect-error A visible snapshot cannot establish permanent global uniqueness.
        uniquenessScope: 'all-rows-forever',
    };
    const fabricatedAuthority: PostgresRecordEditingValidation = {
        ...validation,
        // @ts-expect-error Validation does not issue a persistent mutation capability.
        mutationToken: 'synthetic-token',
    };
    return {
        missingDisplay,
        unconfirmed,
        refusedConfirmation,
        globalUniqueness,
        fabricatedAuthority,
    };
}
