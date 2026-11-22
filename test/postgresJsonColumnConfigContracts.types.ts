import type {
    PostgresConfiguredColumn,
    PostgresJsonColumnConfig,
    PostgresJsonbColumnConfig,
    PostgresValue,
} from '../src/runtime/index.js';
export const jsonSettings: PostgresJsonColumnConfig = {};
export const jsonbSettings: PostgresJsonbColumnConfig = {
    required: false,
    readOnly: false,
    showTitle: false,
};
export const jsonColumn: PostgresConfiguredColumn = {
    kind: 'json',
    columnName: 'document',
    config: jsonSettings,
};
export const jsonbColumn: PostgresConfiguredColumn = {
    kind: 'jsonb',
    columnName: 'normalized',
    config: jsonbSettings,
};
export const jsonNullDocument: PostgresValue = 'null';
export const sqlNullDocument: PostgresValue = null;
export const exactLargeJsonDocument: PostgresValue = '{"n":9007199254740993}';
// @ts-expect-error Native document values are raw strings, never parsed JavaScript objects.
export const parsedNativeJson: PostgresValue = { n: 1 };
// @ts-expect-error Native numeric JSON values are not JavaScript numbers.
export const numericNativeJson: PostgresValue = 1;
export const jsonSchemaSetting: PostgresJsonColumnConfig = {
    // @ts-expect-error Database/domain constraints are not copied into field settings.
    jsonSchema: { type: 'object' },
};
export const jsonbCoercion: PostgresJsonbColumnConfig = {
    // @ts-expect-error Native parsing must not coerce numeric document values in JavaScript.
    coerceNumbers: true,
};
export const jsonTextNormalization: PostgresJsonColumnConfig = {
    // @ts-expect-error Native JSON is not a text-column transformation.
    preserveTrailingWhitespace: true,
};
export const jsonAttachmentDisplay: PostgresJsonbColumnConfig = {
    // @ts-expect-error Public URL attachment display applies only to configured text columns.
    displayAs: 'attachments-public-urls',
};
