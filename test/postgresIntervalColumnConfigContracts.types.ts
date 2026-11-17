import type {
    PostgresConfiguredColumn,
    PostgresIntervalColumnConfig,
} from '../src/runtime/index.js';
export const nativeIntervalConfig: PostgresIntervalColumnConfig = {};
export const explicitFalseInterval: PostgresIntervalColumnConfig = {
    required: false,
    readOnly: false,
    showTitle: false,
};
export const intervalColumn: PostgresConfiguredColumn = {
    kind: 'interval',
    columnName: 'span',
    config: explicitFalseInterval,
};
export const intervalSessionFormat: PostgresIntervalColumnConfig = {
    // @ts-expect-error Session input rules are not per-field configuration.
    intervalStyle: 'iso_8601',
};
export const intervalUnitConversion: PostgresIntervalColumnConfig = {
    // @ts-expect-error Native components are not JavaScript milliseconds.
    durationUnit: 'milliseconds',
};
export const intervalPrecision: PostgresIntervalColumnConfig = {
    // @ts-expect-error Precision belongs to the native column typmod.
    precision: 3,
};
export const intervalTextNormalization: PostgresIntervalColumnConfig = {
    // @ts-expect-error Text settings do not configure interval values.
    preserveTrailingWhitespace: true,
};
export const intervalAttachments: PostgresIntervalColumnConfig = {
    // @ts-expect-error Public URL attachment display belongs to text columns.
    displayAs: 'attachments-public-urls',
};
