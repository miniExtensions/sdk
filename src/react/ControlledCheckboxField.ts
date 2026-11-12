import { createElement as h, type ReactNode } from 'react';
import {
    CompleteCheckboxField,
    type CompleteCheckboxFieldProps,
} from './CompleteCheckboxField.js';
import {
    CompleteCalendlyWidget,
    type CompleteCalendlyWidgetProps,
} from './CompleteCalendlyWidget.js';

/** Explicit caller-owned provider configuration and completion admission. */
export type CheckboxCalendlyOptions = Omit<
    CompleteCalendlyWidgetProps,
    'booked'
>;
export type ControlledCheckboxFieldProps = Omit<
    CompleteCheckboxFieldProps,
    'calendlyPresenter'
> & {
    binding?: never;
    render?: never;
    /** Configured scheduling replaces the ordinary editable checkbox modes. */
    calendly?: CheckboxCalendlyOptions;
};

/** Reuse the complete field and qualified widget without a native renderer slot. */
export function ControlledCheckboxField({
    calendly,
    ...props
}: ControlledCheckboxFieldProps): ReactNode {
    return h(CompleteCheckboxField, {
        ...props,
        calendlyPresenter:
            calendly && !props.readOnly
                ? h(CompleteCalendlyWidget, {
                      ...calendly,
                      booked: props.value === true,
                  })
                : undefined,
    });
}
