import type { PostgresBooleanColumnConfig } from '../src/runtime/index.js';
import type { CanonicalPostgresBooleanColumnConfig } from '../src/runtime/contracts/postgres.generated.js';

type Equivalent<A, B> = [A] extends [B]
    ? [B] extends [A]
        ? true
        : false
    : false;
type Assert<T extends true> = T;
export type PostgresBooleanColumnConfigAlias = Assert<
    Equivalent<
        PostgresBooleanColumnConfig,
        CanonicalPostgresBooleanColumnConfig
    >
>;

export const absent: PostgresBooleanColumnConfig = {};
export const configured: PostgresBooleanColumnConfig = {
    readOnly: false,
    required: false,
    showTitle: false,
    title: '',
    subtitle: '',
    descriptionStyle: 'tooltip',
};
export const explicitUndefined: PostgresBooleanColumnConfig = {
    readOnly: undefined,
    required: undefined,
    showTitle: undefined,
    title: undefined,
    subtitle: undefined,
    descriptionStyle: undefined,
};
export const descriptionStyles: PostgresBooleanColumnConfig[] = [
    { descriptionStyle: 'top' },
    { descriptionStyle: 'bottom' },
];
configured.title = 'A Boolean field';
delete configured.title;

export const textValue: PostgresBooleanColumnConfig = {
    // @ts-expect-error A settings boolean is not the native PostgreSQL wire value.
    readOnly: 'f',
};
export const sqlNull: PostgresBooleanColumnConfig = {
    // @ts-expect-error SQL NULL does not replace an absent optional setting.
    required: null,
};
export const textDisplay: PostgresBooleanColumnConfig = {
    // @ts-expect-error Boolean columns do not offer text/attachment display modes.
    displayAs: 'text',
};
export const placeholder: PostgresBooleanColumnConfig = {
    // @ts-expect-error Boolean columns do not have text placeholders.
    placeholderText: '',
};
export const characterLimit: PostgresBooleanColumnConfig = {
    // @ts-expect-error Boolean columns do not have character limits.
    characterLimit: 0,
};
export const whitespace: PostgresBooleanColumnConfig = {
    // @ts-expect-error Boolean columns do not have a whitespace policy.
    preserveTrailingWhitespace: false,
};
export const checkboxStyle: PostgresBooleanColumnConfig = {
    // @ts-expect-error Checkbox styles are not part of this storage checkpoint.
    checkboxStyle: 'switch',
};
