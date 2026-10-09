import moment from 'moment-timezone';
import 'moment-duration-format';
import type { DurationFormat } from './types.js';

const assertUnreachable = (value: never): never => {
    throw new Error(`Unexpected: ${String(value)}`);
};

/** Existing canonical duration presentation; always pass true for native seconds. */
export const getFormattedDuration = (
    unformattedString: string,
    durationFormat: DurationFormat,
    isSeconds = false
): string => {
    if (unformattedString === '') return '';
    const duration = moment.duration(
        unformattedString,
        !isSeconds && durationFormat === 'h:mm' ? 'minutes' : 'seconds'
    );
    const milliseconds = duration.asMilliseconds();
    const isNegative = milliseconds < 0;
    let roundingPrecision: number;
    switch (durationFormat) {
        case 'h:mm':
        case 'h:mm:ss':
        case 'h:mm:ss.S':
        case 'h:mm:ss.SS':
            roundingPrecision = 0;
            break;
        case 'h:mm:ss.SSS':
            roundingPrecision = 1;
            break;
        default:
            return assertUnreachable(durationFormat);
    }
    const roundedMilliseconds =
        Math.abs(Number((milliseconds / 10).toFixed(roundingPrecision))) * 10;
    const formattedDuration = moment
        .duration(roundedMilliseconds)
        .format(durationFormat, {
            useGrouping: false,
            stopTrim: durationFormat === 'h:mm' ? 'h' : 'm',
        });
    const finalDurationWithSign = `${isNegative ? '-' : ''}${formattedDuration}`;
    if (durationFormat === 'h:mm:ss.S') {
        return (
            finalDurationWithSign.substring(
                0,
                finalDurationWithSign.indexOf('.') + 1
            ) +
            Math.round(
                Number(
                    finalDurationWithSign.substring(
                        finalDurationWithSign.indexOf('.') + 1
                    )
                ) / 100
            )
        );
    }
    return finalDurationWithSign;
};
