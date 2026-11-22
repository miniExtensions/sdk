import type { PostgresTextColumnConfig } from '../src/runtime/index.js';
import type { CanonicalPostgresTextColumnConfig } from '../src/runtime/contracts/postgres.generated.js';

type Equivalent<A, B> = [A] extends [B]
    ? [B] extends [A]
        ? true
        : false
    : false;
type Assert<T extends true> = T;
export type PostgresTextColumnConfigAlias = Assert<
    Equivalent<PostgresTextColumnConfig, CanonicalPostgresTextColumnConfig>
>;

export const absent: PostgresTextColumnConfig = {};
export const configured: PostgresTextColumnConfig = {
    readOnly: false,
    required: false,
    showTitle: false,
    title: '',
    subtitle: '',
    descriptionStyle: 'tooltip',
    displayAs: 'attachments-public-urls',
    placeholderText: '',
    characterLimit: 0,
    preserveTrailingWhitespace: false,
};
export const literalOptions: PostgresTextColumnConfig[] = [
    { descriptionStyle: 'top', displayAs: 'text' },
    { descriptionStyle: 'bottom' },
];
export const explicitUndefined: PostgresTextColumnConfig = {
    readOnly: undefined,
    required: undefined,
    showTitle: undefined,
    title: undefined,
    subtitle: undefined,
    descriptionStyle: undefined,
    displayAs: undefined,
    placeholderText: undefined,
    characterLimit: undefined,
    preserveTrailingWhitespace: undefined,
};
configured.title = 'A changed title';
delete configured.title;

export const wrongBoolean: PostgresTextColumnConfig = {
    // @ts-expect-error Settings values are not coerced from strings.
    readOnly: 'false',
};
export const wrongNumber: PostgresTextColumnConfig = {
    // @ts-expect-error Numeric settings preserve their canonical primitive.
    characterLimit: '0',
};
export const wrongDisplay: PostgresTextColumnConfig = {
    // @ts-expect-error Read-only URL display does not admit uploads.
    displayAs: 'upload',
};
export const wrongDescription: PostgresTextColumnConfig = {
    // @ts-expect-error Only authored description placements are stored.
    descriptionStyle: 'side',
};
export const sqlNull: PostgresTextColumnConfig = {
    // @ts-expect-error SQL NULL does not replace an absent optional setting.
    title: null,
};
export const unknown: PostgresTextColumnConfig = {
    // @ts-expect-error A fresh config literal cannot invent unauthored settings.
    uploadFile: false,
};
