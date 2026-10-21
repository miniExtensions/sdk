import moment from 'moment';
import type { DurationFormat } from './types.js';

/** Hosted clock editing grammar, including empty/negative/colon drafts. */
export const isDurationInputText = (input: string): boolean => {
    if (input === '' || input === '-') return true;
    return /^-?[\d:]+(\.)?\d{0,3}$/.test(input);
};

/**
 * Existing permissive clock-to-seconds conversion. Validate editor drafts with
 * isDurationInputText first; this converter deliberately retains Moment's legacy
 * normalization (including zero for some partial or unvalidated strings).
 * Bare h:mm input is minutes; other supported formats use seconds.
 */
export const parseDurationInputSeconds = (
    input: string,
    durationFormat: DurationFormat
): number | null => {
    if (input === '') return null;
    if (durationFormat !== 'h:mm') {
        input = input.replace(/^(-?)(\d+:\d+(\.\d{0,3})?)$/, '$100:$2');
    }
    return moment
        .duration(input, durationFormat === 'h:mm' ? 'minutes' : 'seconds')
        .asSeconds();
};
