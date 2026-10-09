import moment from 'moment-timezone';
import type { RuntimeAirtableField } from '../runtime/types.js';

export type DurationFormat = Extract<
    RuntimeAirtableField['config'],
    { type: 'duration' }
>['options']['durationFormat'];

export const isDurationFormat = (value: unknown): value is DurationFormat =>
    ['h:mm', 'h:mm:ss', 'h:mm:ss.S', 'h:mm:ss.SS', 'h:mm:ss.SSS'].includes(
        value as string
    );

/** Complete editor input only; canonical Moment coercion is not an admission rule. */
export const parseDurationInput = (
    input: string,
    format: DurationFormat
): number | null | undefined => {
    if (input === '') return null;
    const complete =
        /^-?\d+(?:\.\d{0,3})?$/.test(input) ||
        (format === 'h:mm'
            ? /^-?\d+:\d+$/.test(input)
            : /^-?\d+:\d+(?:\.\d{0,3})?$/.test(input)) ||
        /^-?\d+:\d+:\d+(?:\.\d{0,3})?$/.test(input);
    if (!complete) return undefined;
    // The canonical parser shifts a two-component seconds clock to m:ss.
    const adjusted =
        format === 'h:mm'
            ? input
            : input.replace(/^(-?)(\d+:\d+(\.\d{0,3})?)$/, '$100:$2');
    const seconds = moment
        .duration(adjusted, format === 'h:mm' ? 'minutes' : 'seconds')
        .asSeconds();
    return Number.isFinite(seconds) && Number.isFinite(seconds * 1000)
        ? seconds
        : undefined;
};
