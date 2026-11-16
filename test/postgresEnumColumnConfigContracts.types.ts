import type { PostgresEnumColumnConfig } from '../src/runtime/index.js';
import type { CanonicalPostgresEnumColumnConfig } from '../src/runtime/contracts/postgres.generated.js';

type Equivalent<A, B> = [A] extends [B]
    ? [B] extends [A]
        ? true
        : false
    : false;
type Assert<T extends true> = T;
export type PostgresEnumColumnConfigAlias = Assert<
    Equivalent<PostgresEnumColumnConfig, CanonicalPostgresEnumColumnConfig>
>;

export const absent: PostgresEnumColumnConfig = {};
export const configured: PostgresEnumColumnConfig = {
    readOnly: false,
    required: false,
    showTitle: false,
    title: '',
    subtitle: '',
    descriptionStyle: 'tooltip',
};
export const explicitUndefined: PostgresEnumColumnConfig = {
    readOnly: undefined,
    required: undefined,
    showTitle: undefined,
    title: undefined,
    subtitle: undefined,
    descriptionStyle: undefined,
};
export const descriptionStyles: PostgresEnumColumnConfig[] = [
    { descriptionStyle: 'top' },
    { descriptionStyle: 'bottom' },
];
configured.title = 'A Enum field';
delete configured.title;

export const textValue: PostgresEnumColumnConfig = {
    // @ts-expect-error A settings boolean is not the native PostgreSQL enum value.
    readOnly: 'f',
};
export const sqlNull: PostgresEnumColumnConfig = {
    // @ts-expect-error SQL NULL does not replace an absent optional setting.
    required: null,
};
export const textDisplay: PostgresEnumColumnConfig = {
    // @ts-expect-error Enum columns do not offer text/attachment display modes.
    displayAs: 'text',
};
export const placeholder: PostgresEnumColumnConfig = {
    // @ts-expect-error Enum columns do not have text placeholders.
    placeholderText: '',
};
export const characterLimit: PostgresEnumColumnConfig = {
    // @ts-expect-error Enum columns do not have character limits.
    characterLimit: 0,
};
export const whitespace: PostgresEnumColumnConfig = {
    // @ts-expect-error Enum columns do not have a whitespace policy.
    preserveTrailingWhitespace: false,
};
export const checkboxStyle: PostgresEnumColumnConfig = {
    // @ts-expect-error Checkbox styles are not part of this storage checkpoint.
    checkboxStyle: 'switch',
};

export const storedChoices: PostgresEnumColumnConfig = {
    // @ts-expect-error Enum choices belong to current database metadata.
    enumLabels: ['copied label'],
};
