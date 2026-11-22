import type {
    PostgresConfiguredColumn,
    PostgresTimeColumnConfig,
    PostgresTimetzColumnConfig,
} from '../src/runtime/index.js';

export const nativeLocalTimeConfig: PostgresTimeColumnConfig = {};
export const nativeOffsetClockConfig: PostgresTimetzColumnConfig = {
    required: false,
    readOnly: false,
    title: 'Native clock with offset',
    descriptionStyle: 'tooltip',
};
export const localTimeColumn: PostgresConfiguredColumn = {
    kind: 'time',
    columnName: 'local_value',
    config: nativeLocalTimeConfig,
};
export const offsetClockColumn: PostgresConfiguredColumn = {
    kind: 'timetz',
    columnName: 'moment',
    config: nativeOffsetClockConfig,
};
export const clockTimezoneSetting: PostgresTimeColumnConfig = {
    // @ts-expect-error Native column settings do not change the database timezone.
    timeZone: 'UTC',
};
export const offsetPrecisionSetting: PostgresTimetzColumnConfig = {
    // @ts-expect-error Native typmod precision is not an extension storage setting.
    precision: 3,
};
export const clockEpochSetting: PostgresTimeColumnConfig = {
    // @ts-expect-error Native time settings do not select epoch/JavaScript Date conversion.
    dateFormat: 'epoch-milliseconds',
};
export const clockAttachmentSetting: PostgresConfiguredColumn = {
    kind: 'timetz',
    columnName: 'moment',
    // @ts-expect-error Attachment presentation belongs to configured text columns.
    config: { displayAs: 'attachments-public-urls' },
};

export const clockTextNormalization: PostgresTimeColumnConfig = {
    // @ts-expect-error Native time columns have no text-normalization setting.
    trimWhitespace: true,
};
