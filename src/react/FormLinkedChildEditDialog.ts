import { createElement as h, type ReactElement } from 'react';
import type { FormFieldBindings } from '../forms/bindings.js';
import {
    LinkedChildDialogPresentation,
    type FormLinkedChildCreateDialogProps,
} from './FormLinkedChildCreateDialog.js';

export type FormLinkedChildEditOpening = Readonly<{
    /** The exact button that opened this Edit. */
    opener: HTMLButtonElement;
    /** The child returned by the owner's accepted Edit snapshot. */
    child: FormFieldBindings;
    recordId: string;
    /** Retire the opening when the parent owner or opener changes. */
    isCurrent(): boolean;
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
