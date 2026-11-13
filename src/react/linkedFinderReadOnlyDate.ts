import { createElement as h, type ReactElement } from 'react';
import 'moment/min/locales.js';
import type {
    ControlledDateFieldProps,
    ControlledDateTimeFieldProps,
} from './date/DateField.js';
import { CompleteReadOnlyTextField } from './CompleteReadOnlyTextField.js';
import { formatDateInputValue } from '../ui/dateInputCompatibility.js';

type Props = Pick<
    ControlledDateFieldProps | ControlledDateTimeFieldProps,
    'airtableDateConfig' | 'value' | 'language'
> & { id: string };
/** Exact readonly subset admitted by Card; no picker/DOM peer or write capability. */
export function LinkedFinderReadOnlyDate(props: Props): ReactElement {
    return h(
        'div',
        { id: props.id },
        h(CompleteReadOnlyTextField, {
            value: formatDateInputValue({
                airtableValue: props.value,
                airtableFieldConfig: props.airtableDateConfig,
            }),
            language: props.language,
        })
    );
}
