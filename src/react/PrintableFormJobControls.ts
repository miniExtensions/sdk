import {
    createElement as h,
    useSyncExternalStore,
    type ReactElement,
} from 'react';
import type { PrintableFormJob } from '../ui/printableForm.js';

export type PrintableFormJobLabels = {
    invoked: string;
    unknown: string;
    /** Explicit acknowledgement that the user has closed the print dialog. */
    done: string;
};

/** These controls can outlive the parent Form. A notification never presses Done. */
export function PrintableFormJobControls({
    job,
    labels,
}: {
    job: PrintableFormJob;
    labels: PrintableFormJobLabels;
}): ReactElement | null {
    const state = useSyncExternalStore(
        job.subscribe,
        job.getSnapshot,
        job.getSnapshot
    );
    if (
        state.cleaned ||
        (state.phase !== 'invoked' && state.phase !== 'unknown')
    )
        return null;
    return h(
        'div',
        { className: 'mx-sdk-print-job-controls', role: 'status' },
        h(
            'span',
            null,
            state.phase === 'invoked' ? labels.invoked : labels.unknown
        ),
        h(
            'button',
            {
                type: 'button',
                onClick: () => {
                    void job.finish('explicit-dialog-closed');
                },
            },
            labels.done
        )
    );
}
