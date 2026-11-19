import { createElement as h, type ReactElement } from 'react';
import {
    LinkedChildDialogPresentation,
    type FormLinkedChildCreateDialogProps,
    type FormLinkedChildCreateOpening,
} from './FormLinkedChildCreateDialog.js';

export type FormLinkedChildEditOpening = FormLinkedChildCreateOpening &
    Readonly<{
        /** The selected record from the accepted Edit snapshot. */
        recordId: string;
    }>;

export type FormLinkedChildEditDialogProps = Omit<
    FormLinkedChildCreateDialogProps,
    'opening'
> &
    Readonly<{ opening: FormLinkedChildEditOpening }>;

/** Presents a single-page accepted Edit using the linked child's existing owner. */
export function FormLinkedChildEditDialog(
    props: FormLinkedChildEditDialogProps
): ReactElement | null {
    return h(LinkedChildDialogPresentation, {
        ...props,
        editRecordId: props.opening.recordId,
        labels: {
            title: 'Edit linked record',
            discardQuestion:
                'Close without saving? Reopen this record to continue editing.',
            ...props.labels,
        },
    });
}
