import { createElement, type ReactElement } from 'react';
import { getFormattedDuration } from '../formulas/durationFormatting.js';
import { isDurationFormat, type DurationFormat } from '../ui/durationInput.js';
import {
    CompleteReadOnlyTextField,
    type CompleteReadOnlyTextFieldProps,
} from './CompleteReadOnlyTextField.js';

export type ReadOnlyDurationFieldProps = Omit<
    CompleteReadOnlyTextFieldProps,
    'value'
> & {
    /** Canonical native seconds; null/undefined retain the native empty presentation. */
    value: number | null | undefined;
    format: DurationFormat;
};

/** Native seconds presentation only; no editing owner, canonical store or Save. */
export function ReadOnlyDurationField({
    value,
    format,
    ...presentation
}: ReadOnlyDurationFieldProps): ReactElement {
    if (!isDurationFormat(format))
        throw new TypeError('Unsupported Duration format.');
    if (
        value != null &&
        (!Number.isFinite(value) || !Number.isFinite(value * 1000))
    )
        throw new TypeError('Duration requires finite native seconds.');
    return createElement(CompleteReadOnlyTextField, {
        ...presentation,
        value:
            value == null
                ? null
                : getFormattedDuration(String(value), format, true),
    });
}
