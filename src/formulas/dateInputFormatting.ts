import moment from 'moment-timezone';
import type { DateFieldConfig, DateTimeFieldConfig } from './types.js';
import type { RuntimeLanguage } from '../runtime/types.js';
export type DateInputCompatibilityConfig =
    | DateFieldConfig
    | DateTimeFieldConfig;
function assertUnreachable(value: never): never {
    throw new Error(`Unexpected: ${String(value)}`);
}
/**
 * @param language The language code.
 * @returns The moment locale code for the language.
 * @see https://momentjs.com/docs/#/i18n/
 */
export function getDateInputMomentLocale(
    language: RuntimeLanguage
): string | null {
    switch (language) {
        case 'en':
            return null;

        case 'es':
        case 'fr':
        case 'vi':
        case 'nl':
        case 'de':
        case 'ja':
        case 'ko':
        case 'pt':
        case 'cs':
        case 'he':
        case 'it':
        case 'ka':
        case 'ca':
            return language;

        case 'zh-Hans':
            return 'zh-cn';

        default:
            assertUnreachable(language);
    }
}

/** Preserve the host's client display-zone lookup separately from range provenance. */
export const getDateInputTimeZone = (config: DateTimeFieldConfig): string =>
    config.options.timeZone === 'client'
        ? moment.tz.guess()
        : config.options.timeZone;

export const getDateInputFormat = (
    config: DateInputCompatibilityConfig
): string =>
    config.type === 'date'
        ? config.options.dateFormat.format
        : `${config.options.dateFormat.format} ${config.options.timeFormat.format}`;

/** Display formatting only; locale data is loaded by the caller as before. */
export const formatDateInputValue = (args: {
    airtableValue: string | Date | null;
    airtableFieldConfig: DateInputCompatibilityConfig;
    language?: RuntimeLanguage;
}): string => {
    if (args.airtableValue == null) return '';
    const value =
        args.airtableFieldConfig.type === 'date'
            ? moment(args.airtableValue)
            : moment(args.airtableValue).tz(
                  getDateInputTimeZone(args.airtableFieldConfig)
              );
    value.locale(
        args.language ? (getDateInputMomentLocale(args.language) ?? 'en') : 'en'
    );
    return value.format(getDateInputFormat(args.airtableFieldConfig));
};
