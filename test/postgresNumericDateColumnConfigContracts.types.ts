import type {
    PostgresDateColumnConfig,
    PostgresNumericColumnConfig,
} from '../src/runtime/index.js';
import type {
    CanonicalPostgresDateColumnConfig,
    CanonicalPostgresNumericColumnConfig,
} from '../src/runtime/contracts/postgres.generated.js';

type Equivalent<A, B> = [A] extends [B]
    ? [B] extends [A]
        ? true
        : false
    : false;
type Assert<T extends true> = T;
export type PostgresNumericColumnConfigAlias = Assert<
    Equivalent<
        PostgresNumericColumnConfig,
        CanonicalPostgresNumericColumnConfig
    >
>;
export type PostgresDateColumnConfigAlias = Assert<
    Equivalent<PostgresDateColumnConfig, CanonicalPostgresDateColumnConfig>
>;

export const absentNumeric: PostgresNumericColumnConfig = {};
export const numeric: PostgresNumericColumnConfig = {
    readOnly: false,
    required: false,
    showTitle: false,
    title: '',
    subtitle: '',
    descriptionStyle: 'tooltip',
};
export const undefinedNumeric: PostgresNumericColumnConfig = {
    readOnly: undefined,
    required: undefined,
    showTitle: undefined,
    title: undefined,
    subtitle: undefined,
    descriptionStyle: undefined,
};
export const numericDescriptionStyles: PostgresNumericColumnConfig[] = [
    { descriptionStyle: 'top' },
    { descriptionStyle: 'bottom' },
];
numeric.title = 'A native numeric field';
delete numeric.title;
export const numericBooleanCoercion: PostgresNumericColumnConfig = {
    // @ts-expect-error Native numeric text does not coerce a settings boolean.
    required: '0',
};
export const numericSqlNull: PostgresNumericColumnConfig = {
    // @ts-expect-error SQL NULL is not an absent optional setting.
    title: null,
};
export const numericTextDisplay: PostgresNumericColumnConfig = {
    // @ts-expect-error Text/attachment display belongs to text-column settings.
    displayAs: 'attachments-public-urls',
};
export const numericPrecision: PostgresNumericColumnConfig = {
    // @ts-expect-error This common-settings slice adds no numeric formatting.
    decimalPlaces: 2,
};
export const numericCheckbox: PostgresNumericColumnConfig = {
    // @ts-expect-error Numeric settings do not define checkbox styles.
    checkboxStyle: 'switch',
};

export const absentDate: PostgresDateColumnConfig = {};
export const date: PostgresDateColumnConfig = {
    readOnly: false,
    required: false,
    showTitle: false,
    title: '',
    subtitle: '',
    descriptionStyle: 'tooltip',
};
export const undefinedDate: PostgresDateColumnConfig = {
    readOnly: undefined,
    required: undefined,
    showTitle: undefined,
    title: undefined,
    subtitle: undefined,
    descriptionStyle: undefined,
};
export const dateDescriptionStyles: PostgresDateColumnConfig[] = [
    { descriptionStyle: 'top' },
    { descriptionStyle: 'bottom' },
];
date.title = 'A native SQL DATE field';
delete date.title;
export const dateBooleanCoercion: PostgresDateColumnConfig = {
    // @ts-expect-error A stored boolean setting has no string coercion.
    readOnly: 'false',
};
export const dateSqlNull: PostgresDateColumnConfig = {
    // @ts-expect-error SQL NULL is not an absent optional setting.
    required: null,
};
export const dateTextPlaceholder: PostgresDateColumnConfig = {
    // @ts-expect-error Text placeholders are not common SQL DATE settings.
    placeholderText: '',
};
export const dateFormat: PostgresDateColumnConfig = {
    // @ts-expect-error This checkpoint adds no date-format setting or parser.
    dateFormat: 'YYYY-MM-DD',
};
export const dateTimeZone: PostgresDateColumnConfig = {
    // @ts-expect-error SQL DATE settings do not introduce a time zone.
    timeZone: 'UTC',
};
