import type {
    PostgresConfiguredColumn,
    PostgresByteaColumnConfig,
    PostgresValue,
} from '../src/runtime/index.js';
export const byteaSettings: PostgresByteaColumnConfig = {};
export const byteaRequired: PostgresByteaColumnConfig = {
    required: true,
    readOnly: false,
    title: 'Bytes',
};
export const byteaColumn: PostgresConfiguredColumn = {
    kind: 'bytea',
    columnName: 'payload',
    config: byteaSettings,
};
export const byteaHex: PostgresValue = String.raw`\x0080ff`;
export const byteaEscape: PostgresValue = String.raw`\000\200\377`;
export const byteaSqlNull: PostgresValue = null;
export const byteaEmptyInput: PostgresValue = '';
// @ts-expect-error Native values remain lossless wire strings, not JavaScript buffers.
export const byteaBuffer: PostgresValue = new Uint8Array([0, 255]);
export const byteaTextTransformation: PostgresByteaColumnConfig = {
    // @ts-expect-error BYTEA is not a text column.
    preserveTrailingWhitespace: true,
};
export const byteaAttachment: PostgresByteaColumnConfig = {
    // @ts-expect-error URL attachment display applies only to text.
    displayAs: 'attachments-public-urls',
};
export const byteaUpload: PostgresByteaColumnConfig = {
    // @ts-expect-error Native BYTEA is not a file upload service.
    upload: true,
};
export const byteaEncoding: PostgresByteaColumnConfig = {
    // @ts-expect-error Parsing belongs to PostgreSQL, with no copied encoding policy.
    encoding: 'base64',
};

export const byteaCanonicalZeroBytes: PostgresValue = String.raw`\x`;
