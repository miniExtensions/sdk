import type { PostgresUuidColumnConfig } from '../src/runtime/index.js';

export const uuidSettings: PostgresUuidColumnConfig = {
    readOnly: false,
    required: true,
    showTitle: false,
    title: 'Native UUID',
    subtitle: 'Database value',
    descriptionStyle: 'bottom',
};
export const absentUuidSettings: PostgresUuidColumnConfig = {};
export const uuidTextSettings: PostgresUuidColumnConfig = {
    // @ts-expect-error UUID settings do not enable text normalization.
    preserveTrailingWhitespace: true,
};
export const uuidAttachmentSettings: PostgresUuidColumnConfig = {
    // @ts-expect-error UUID is a native value, not an attachment display source.
    displayAs: 'attachments-public-urls',
};
export const uuidGenerationSettings: PostgresUuidColumnConfig = {
    // @ts-expect-error Native database defaults do not become a UUID generator setting.
    generateUuid: true,
};
