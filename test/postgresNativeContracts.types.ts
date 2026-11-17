import type {
    AirtableRecord,
    AirtableValue,
    PostgresConnection,
    PostgresDatabase,
    PostgresField,
    PostgresRecord,
    PostgresRecordIdentity,
    PostgresRelationship,
    PostgresSchema,
    PostgresTable,
    PostgresTableReference,
    PostgresType,
    PostgresValue,
} from '../src/runtime/index.js';
import type {
    CanonicalAirtableRecord,
    CanonicalAirtableValue,
} from '../src/runtime/contracts/generated.js';
import type {
    CanonicalPostgresConnection,
    CanonicalPostgresDatabase,
    CanonicalPostgresField,
    CanonicalPostgresRecord,
    CanonicalPostgresRecordIdentity,
    CanonicalPostgresRelationship,
    CanonicalPostgresSchema,
    CanonicalPostgresTable,
    CanonicalPostgresTableReference,
    CanonicalPostgresType,
    CanonicalPostgresValue,
} from '../src/runtime/contracts/postgres.generated.js';

// Compile-only public package witnesses. Native metadata exports do not change
// the existing Form/Portal operations or promise PostgreSQL runtime support.
type Equal<Left, Right> =
    (<Value>() => Value extends Left ? 1 : 2) extends <
        Value,
    >() => Value extends Right ? 1 : 2
        ? true
        : false;
type Assert<Value extends true> = Value;

export type PostgresPublicAliasContracts = Assert<
    Equal<
        {
            connection: PostgresConnection;
            database: PostgresDatabase;
            schema: PostgresSchema;
            table: PostgresTable;
            tableReference: PostgresTableReference;
            field: PostgresField;
            type: PostgresType;
            relationship: PostgresRelationship;
            record: PostgresRecord;
            value: PostgresValue;
            identity: PostgresRecordIdentity;
            airtableRecord: AirtableRecord;
            airtableValue: AirtableValue;
        },
        {
            connection: CanonicalPostgresConnection;
            database: CanonicalPostgresDatabase;
            schema: CanonicalPostgresSchema;
            table: CanonicalPostgresTable;
            tableReference: CanonicalPostgresTableReference;
            field: CanonicalPostgresField;
            type: CanonicalPostgresType;
            relationship: CanonicalPostgresRelationship;
            record: CanonicalPostgresRecord;
            value: CanonicalPostgresValue;
            identity: CanonicalPostgresRecordIdentity;
            airtableRecord: CanonicalAirtableRecord;
            airtableValue: CanonicalAirtableValue;
        }
    >
>;

export type PostgresNativeValueContracts = [
    Assert<Equal<PostgresValue, string | null>>,
    Assert<Equal<PostgresField['collationOid'], number | null>>,
    Assert<Equal<PostgresRecord['identity'], PostgresRecordIdentity | null>>,
    Assert<
        Equal<
            keyof PostgresTableReference,
            'connectionId' | 'schemaName' | 'tableName'
        >
    >,
];

export function acceptedPostgresNativeContracts() {
    const connection: PostgresConnection = {
        id: 'connection_example',
        workspaceId: 'workspace_example',
        name: 'Synthetic database',
        host: 'localhost',
        port: 5432,
        database: 'synthetic',
        username: 'synthetic_reader',
        tls: 'disable',
    };
    const reference: PostgresTableReference = {
        connectionId: connection.id,
        schemaName: 'sales',
        tableName: 'orders',
    };
    const field: PostgresField = {
        name: 'amount',
        ordinal: 3,
        typeOid: 1700,
        formattedType: 'numeric(30,10)',
        collationOid: null,
        notNull: false,
        hasDefault: false,
        identity: null,
        generated: null,
        description: null,
        privileges: { select: true, insert: false, update: false },
    };
    const relationship: PostgresRelationship = {
        name: 'orders_customer_fkey',
        columns: ['tenant_id', 'customer_id'],
        referencedTable: { ...reference, tableName: 'customers' },
        referencedColumns: ['tenant_id', 'id'],
        onUpdate: 'cascade',
        onDelete: 'restrict',
        onDeleteColumns: null,
        match: 'full',
        deferrable: true,
        initiallyDeferred: false,
        validated: true,
    };
    const table: PostgresTable = {
        reference,
        oid: 16400,
        kind: 'partitioned-table',
        isPartition: false,
        description: null,
        fields: [
            {
                ...field,
                name: 'tenant_id',
                ordinal: 1,
                typeOid: 25,
                formattedType: 'text',
                collationOid: 16422,
                notNull: true,
            },
            {
                ...field,
                name: 'id',
                ordinal: 2,
                typeOid: 20,
                formattedType: 'bigint',
                notNull: true,
            },
            field,
        ],
        primaryKey: {
            name: 'orders_pkey',
            columns: ['tenant_id', 'id'],
        },
        uniqueKeys: [],
        relationships: [relationship],
        privileges: {
            select: true,
            insert: false,
            update: false,
            delete: false,
        },
        rowSecurity: { enabled: true, forced: true },
        updatable: { insert: true, update: true, delete: true },
    };
    const schema: PostgresSchema = { name: 'sales', tables: [table] };
    const type: PostgresType = {
        oid: 16401,
        schemaName: 'sales',
        name: 'amount_domain',
        kind: 'domain',
        category: 'N',
        elementTypeOid: null,
        baseTypeOid: 1700,
        domainNotNull: false,
        enumLabels: [],
    };
    const database: PostgresDatabase = {
        connectionId: connection.id,
        name: connection.database,
        serverVersion: 170000,
        schemas: [schema],
        types: [
            type,
            {
                ...type,
                oid: 1700,
                schemaName: 'pg_catalog',
                name: 'numeric',
                kind: 'base',
                baseTypeOid: null,
            },
            {
                ...type,
                oid: 25,
                schemaName: 'pg_catalog',
                name: 'text',
                kind: 'base',
                category: 'S',
                baseTypeOid: null,
            },
            {
                ...type,
                oid: 20,
                schemaName: 'pg_catalog',
                name: 'int8',
                kind: 'base',
                baseTypeOid: null,
            },
        ],
    };
    const identity: PostgresRecordIdentity = {
        formatVersion: 1 as const,
        type: 'primary-key',
        values: [
            { columnName: 'tenant_id', value: 'tenant_example' },
            { columnName: 'id', value: '9007199254740993' },
        ],
    };
    const record: PostgresRecord = {
        table: reference,
        identity,
        fields: {
            amount: '12345678901234567890.1234567890',
            native_array: '{"first","second"}',
            native_json: '{"amount":9007199254740993}',
            native_timestamp: '2026-11-15 21:00:00+00',
            empty: '',
            text_null: 'NULL',
            sql_null: null,
        },
    };
    const keylessRecord: PostgresRecord = {
        table: { ...reference, tableName: 'order_summary' },
        identity: null,
        fields: { amount: '1.0000000000' },
    };
    return { connection, database, record, keylessRecord };
}

export function rejectedPostgresFieldCollationContracts(field: PostgresField) {
    const { collationOid, ...legacyField } = field;
    // @ts-expect-error Fresh field metadata must distinguish known SQL NULL from missing metadata.
    const missingCollation: PostgresField = legacyField;
    const undefinedCollation: PostgresField = {
        ...field,
        // @ts-expect-error Undefined is not a known noncollatable field.
        collationOid: undefined,
    };
    const stringCollation: PostgresField = {
        ...field,
        // @ts-expect-error Catalog OIDs are native metadata numbers, not coerced strings.
        collationOid: '16422',
    };
    return {
        collationOid,
        missingCollation,
        undefinedCollation,
        stringCollation,
    };
}

export function rejectedPostgresNativeContracts() {
    // @ts-expect-error Native numeric values retain their lossless server text.
    const number: PostgresValue = 9007199254740992;
    // @ts-expect-error Native booleans are text-protocol values too.
    const boolean: PostgresValue = true;
    // @ts-expect-error JSON is native server text, not an implicitly parsed object.
    const json: PostgresValue = { amount: '1.00' };
    // @ts-expect-error SQL arrays preserve their native representation.
    const array: PostgresValue = ['first', 'second'];
    // @ts-expect-error A timestamp must not become a JavaScript Date.
    const date: PostgresValue = new Date(0);
    const identity: PostgresRecordIdentity = {
        formatVersion: 1 as const,
        type: 'primary-key',
        values: [
            {
                columnName: 'id',
                // @ts-expect-error Primary-key parts also retain server text.
                value: 42,
            },
        ],
    };
    const inventedIdentity: PostgresRecordIdentity = {
        formatVersion: 1 as const,
        // @ts-expect-error Row numbers and ctid are not stable record identities.
        type: 'ctid',
        values: [],
    };
    const crossedReference: PostgresTableReference = {
        connectionId: 'connection_example',
        schemaName: 'sales',
        tableName: 'orders',
        // @ts-expect-error A native reference does not carry an Airtable base ID.
        baseId: 'app_example',
    };
    return {
        number,
        boolean,
        json,
        array,
        date,
        identity,
        inventedIdentity,
        crossedReference,
    };
}
