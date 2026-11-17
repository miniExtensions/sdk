import type {
    PostgresRelationshipBinding,
    PostgresRelationshipColumn,
    PostgresRelationshipOperator,
    PostgresRelationshipCollation,
    PostgresRelationshipConfig,
    PostgresRelationshipSelection,
    PostgresRelationshipChange,
    PostgresRelationshipClear,
    PostgresRelationshipCandidate,
    PostgresRelationshipCandidatePage,
    PostgresFormDraftState,
    PostgresPortalTab,
    PostgresReadableRelationConfiguration,
    FormLoadedResult,
} from '../src/runtime/index.js';

declare const binding: PostgresRelationshipBinding;
declare const column: PostgresRelationshipColumn;
declare const page: PostgresRelationshipCandidatePage;
declare const form: PostgresFormDraftState;
declare const tab: PostgresPortalTab;
declare const readable: PostgresReadableRelationConfiguration;
export const operator: PostgresRelationshipOperator = {
    oid: 98,
    schemaName: 'pg_catalog',
    name: '=',
    leftTypeOid: 25,
    rightTypeOid: 25,
};
export const collation: PostgresRelationshipCollation = {
    oid: 100,
    schemaName: 'pg_catalog',
    name: 'default',
};
export const config: PostgresRelationshipConfig = {
    readOnly: false,
    required: false,
    clearColumnNames: ['contact_id'],
};
export const selection: PostgresRelationshipSelection = {
    formatVersion: 1,
    relationshipName: 'customer_fk',
    values: [
        { columnName: 'tenant', value: ' Exact ' },
        { columnName: 'code', value: '9007199254740993' },
    ],
};
export const change: PostgresRelationshipChange = {
    selection,
    expected: [
        { columnName: 'tenant_id', value: ' Exact ' },
        { columnName: 'contact_id', value: null },
    ],
};
export const clear: PostgresRelationshipClear = {
    relationshipName: 'customer_fk',
    expected: change.expected,
};
export const createClear: PostgresRelationshipClear = {
    relationshipName: 'customer_fk',
};
export const choosing: PostgresRelationshipBinding = {
    ...binding,
    config,
    selection: { enabled: true, displayColumn: column },
};
export const clearOnly: PostgresRelationshipBinding = {
    ...binding,
    config,
    selection: { enabled: false },
};
export const candidates: PostgresRelationshipCandidate[] = [
    { selection, label: 'Duplicate' },
    { selection, label: 'Duplicate' },
    { selection, label: null },
    { selection, label: '' },
];
export const returned: PostgresRelationshipCandidatePage = {
    ...page,
    candidates,
};
export const formWithRelationships: PostgresFormDraftState = {
    ...form,
    relationships: [choosing, clearOnly],
};
export const tabWithRelationships: PostgresPortalTab = {
    ...tab,
    relationships: [choosing],
};
export const readWithRelationships: PostgresReadableRelationConfiguration = {
    ...readable,
    relationships: [clearOnly],
};
export const missingRelationshipDisplay: PostgresRelationshipBinding = {
    ...binding,
    // @ts-expect-error Enabled selection requires an explicit display column.
    selection: { enabled: true },
};
export const requestOwnedClear: PostgresRelationshipClear = {
    ...clear,
    // @ts-expect-error Clear intent cannot supply server-owned columns to empty.
    clearColumnNames: ['tenant_id'],
};
export const requestOwnedWrite: PostgresRelationshipSelection = {
    ...selection,
    // @ts-expect-error Selection cannot supply server-owned assignment columns.
    writeColumnNames: ['tenant_id'],
};
export const numericKey: PostgresRelationshipSelection = {
    ...selection,
    // @ts-expect-error Native key inputs stay lossless strings, never JavaScript numbers.
    values: [{ columnName: 'code', value: 9007199254740993 }],
};
export const publicSource: FormLoadedResult['source'] = {
    // @ts-expect-error Relationship authoring does not admit the existing public Airtable Form protocol.
    type: 'postgres',
    connectionId: 'native',
    databaseName: 'database',
};
