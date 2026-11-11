import { createElement, type ReactElement } from 'react';
import {
    CompleteDateField,
    type CompleteDateFieldProps,
} from '../CompleteDateField.js';
import { CompleteReadOnlyTextField } from '../CompleteReadOnlyTextField.js';
import { formatDateInputValue } from '../../ui/dateInputCompatibility.js';

type DateProps = Omit<
    CompleteDateFieldProps,
    'airtableDateConfig' | 'setValue'
> & {
    airtableDateConfig: Extract<
        CompleteDateFieldProps['airtableDateConfig'],
        { type: 'date' }
    >;
    /** The binding API is available separately from the /react entry. */
    binding?: never;
};

export type ControlledDateFieldProps = DateProps &
    (
        | { mode?: 'input'; setValue: CompleteDateFieldProps['setValue'] }
        | { mode: 'readOnly'; setValue?: never }
    );

/** The complete calendar-date field; no host renderer or Form provider needed. */
export function DateField(props: ControlledDateFieldProps): ReactElement {
    if (props.mode !== 'readOnly')
        return createElement(CompleteDateField, props);
    const describedBy =
        [
            props.ariaDescribedBy,
            props.description != null && `${props.id}-description`,
            props.error && `${props.id}-error`,
        ]
            .filter(Boolean)
            .join(' ') || undefined;
    return createElement(
        'div',
        {
            id: props.id,
            className: props.className,
            'aria-describedby': describedBy,
            'aria-invalid': props.ariaInvalid || !!props.error || undefined,
        },
        props.title ? createElement('span', null, props.title) : null,
        createElement(CompleteReadOnlyTextField, {
            value: formatDateInputValue({
                airtableValue: props.value,
                airtableFieldConfig: props.airtableDateConfig,
            }),
            language: props.language,
        }),
        props.description != null
            ? createElement(
                  'div',
                  { id: `${props.id}-description` },
                  props.description
              )
            : null,
        props.error
            ? createElement(
                  'div',
                  { id: `${props.id}-error`, role: 'alert' },
                  props.error
              )
            : null
    );
}

export type DateFieldProps = ControlledDateFieldProps;
