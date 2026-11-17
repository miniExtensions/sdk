import type {
    PostgresConfiguredColumn,
    PostgresTimestampColumnConfig,
    PostgresTimestamptzColumnConfig,
} from '../src/runtime/index.js';

export const nativeLocalTimestampConfig: PostgresTimestampColumnConfig = {};
export const nativeInstantConfig: PostgresTimestamptzColumnConfig = {
    required: true,
    readOnly: false,
    title: 'Native instant',
    descriptionStyle: 'tooltip',
};
export const localTimestampColumn: PostgresConfiguredColumn = {
    kind: 'timestamp',
    columnName: 'local_value',
    config: nativeLocalTimestampConfig,
};
export const instantColumn: PostgresConfiguredColumn = {
    kind: 'timestamptz',
    columnName: 'moment',
    config: nativeInstantConfig,
};
export const localTimezoneSetting: PostgresTimestampColumnConfig = {
    // @ts-expect-error Native column settings do not change the database timezone.
    timeZone: 'UTC',
};
export const instantPrecisionSetting: PostgresTimestamptzColumnConfig = {
    // @ts-expect-error Native typmod precision is not an extension storage setting.
    precision: 3,
};
export const temporalEpochSetting: PostgresTimestampColumnConfig = {
    // @ts-expect-error Native timestamp settings do not select epoch/JavaScript Date conversion.
    dateFormat: 'epoch-milliseconds',
};
export const temporalAttachmentSetting: PostgresConfiguredColumn = {
    kind: 'timestamptz',
    columnName: 'moment',
    // @ts-expect-error Attachment presentation belongs to configured text columns.
    config: { displayAs: 'attachments-public-urls' },
};
