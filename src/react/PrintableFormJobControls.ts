import {
    createElement as h,
    useSyncExternalStore,
    type ReactElement,
} from 'react';
import type {
    PrintableFormController,
    PrintableFormControllerSnapshot,
    PrintableFormJob,
} from '../ui/printableForm.js';

const idle: PrintableFormControllerSnapshot = Object.freeze({
    job: null,
    outcome: null,
});
const noopSubscribe = () => () => {};

/** Shared bounded preparation/failure UI for either complete print recipe. */
export function PrintableFormPreparationControls({
    controller,
    labels,
}: {
    controller: PrintableFormController | null;
    labels: { preparing: string; cancel: string; failed: string };
}): ReactElement | null {
    const state = useSyncExternalStore(
        controller?.subscribe ?? noopSubscribe,
        controller?.getSnapshot ?? (() => idle),
        () => idle
    );
    const job = state.job;
    const status = useSyncExternalStore(
        job?.subscribe ?? noopSubscribe,
        job?.getSnapshot ?? (() => null),
        () => null
    );
    const phase = status?.phase;
    if (
        job &&
        (phase === 'capturing' || phase === 'preparing' || phase === 'invoking')
    )
        return h(
            'div',
            { className: 'mx-sdk-print-preparation-controls', role: 'status' },
            h('span', null, labels.preparing),
            phase !== 'invoking'
                ? h(
                      'button',
                      {
                          type: 'button',
                          onClick: () => job.cancelBeforeInvocation(),
                      },
                      labels.cancel
                  )
                : null
        );
    return state.outcome === 'failed-before-invoke'
        ? h('span', { role: 'status' }, labels.failed)
        : null;
}

export type PrintableFormJobLabels = {
    invoked: string;
    unknown: string;
    /** Explicit acknowledgement that the user has closed the print dialog. */
    done: string;
    preparing?: string;
    cancel?: string;
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
    if (state.cleaned) return null;
    if (
        state.phase === 'preparing' ||
        state.phase === 'capturing' ||
        state.phase === 'invoking'
    ) {
        return labels.preparing
            ? h(
                  'div',
                  { className: 'mx-sdk-print-job-controls', role: 'status' },
                  h('span', null, labels.preparing),
                  labels.cancel && state.phase !== 'invoking'
                      ? h(
                            'button',
                            {
                                type: 'button',
                                onClick: () => job.cancelBeforeInvocation(),
                            },
                            labels.cancel
                        )
                      : null
              )
            : null;
    }
    if (state.phase !== 'invoked' && state.phase !== 'unknown') return null;
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
