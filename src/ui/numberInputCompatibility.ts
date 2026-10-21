/** Native host compatibility; intentionally separate from scalarModels grammar.
 * Validation gates editor drafts; parsing alone retains parseFloat coercion.
 * Keep Intl and toFixed rounding distinct for their established separators.
 */
export type NumberInputSeparator =
    | 'comma-period'
    | 'period-comma'
    | 'space-comma'
    | 'space-period';

export type NumberInputCompatibilityConfig = {
    type: 'number' | 'percent' | 'currency';
    options: { precision: number };
};

export type NumberInputCompatibilityPolicy = {
    numberSeparator?: NumberInputSeparator;
    allowNegativeNumbers?: boolean;
};

/**
 * Formats a (string | number), according to fieldConfig.options.precision and formatterOptions
 * 12345 => 12,345.00
 * -12.345 => -12.34
 */
export const formatNumberInputCompatibility = (
    unformattedValue: string | number,
    fieldConfig: NumberInputCompatibilityConfig,
    separator?: NumberInputSeparator | 'none',
    useGrouping = separator !== 'none'
): string => {
    if (unformattedValue === '' || unformattedValue === '-') {
        return '';
    }

    const defaultOptions = {
        minimumFractionDigits: fieldConfig.options.precision,
        maximumFractionDigits: fieldConfig.options.precision,
        useGrouping,
    };

    switch (separator) {
        case 'period-comma':
            return Number(unformattedValue).toLocaleString(
                'de-DE',
                defaultOptions
            );

        case 'space-comma':
        case 'space-period': {
            // Custom implementation
            const parts = Number(unformattedValue)
                .toFixed(fieldConfig.options.precision)
                .split('.');
            const integerPart = useGrouping
                ? parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
                : parts[0];
            const decimalPart =
                parts.length > 1
                    ? (separator === 'space-comma' ? ',' : '.') + parts[1]
                    : '';
            return integerPart + decimalPart;
        }

        default:
            return Number(unformattedValue).toLocaleString(
                'en-US',
                defaultOptions
            );
    }
};

/**
 * Coerces a string to a valid number, return null if it can't be coerced
 * '12345' => 12345
 * '' | '-' => null
 * For percent fields airtable uses base 1 notation.
 * The value is parsed using the right precision on airtable
 * 13% = 0.13
 */

export const parseNumberInputCompatibility = (
    stringValue: string,
    fieldConfig: NumberInputCompatibilityConfig
): number | null => {
    const parsedNumber = parseFloat(stringValue.replace(',', '.'));
    const number = Number(
        fieldConfig.type === 'percent'
            ? parsedNumber / 100
            : parsedNumber.toFixed(fieldConfig.options.precision)
    );
    return Number.isNaN(number) ? null : number;
};

/**
 * Checks if a sting is acceptable as and input value, according fieldConfig.type
 * '.' | ' ' => false
 * '' | '-' | '0.' => true
 */

export const isNumberInputCompatible = (
    value: string,
    fieldConfigType: NumberInputCompatibilityConfig['type'],
    miniExtConfig: NumberInputCompatibilityPolicy | undefined
): boolean => {
    if (value === '') {
        return true;
    }

    switch (fieldConfigType) {
        case 'number':
        case 'percent':
        case 'currency': {
            const parsedFloat = parseFloat(value);
            if (value === '-' && !miniExtConfig?.allowNegativeNumbers)
                return false;
            else if (
                !Number.isNaN(parsedFloat) &&
                parsedFloat < 0 &&
                !miniExtConfig?.allowNegativeNumbers
            )
                return false;

            if (value === '-') return true;

            const regex =
                miniExtConfig?.numberSeparator === 'space-comma' ||
                miniExtConfig?.numberSeparator === 'period-comma'
                    ? /^-?\d+(,)?\d*$/
                    : /^-?\d+(\.)?\d*$/;

            if (!regex.test(value)) return false;

            if (fieldConfigType !== 'percent') return true;

            return !Number.isNaN(parsedFloat);
        }
        default:
            throw new Error(`Unexpected: ${String(fieldConfigType)}`);
    }
};
