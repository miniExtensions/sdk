import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useState,
    type ReactNode,
} from 'react';
import type {
    AutomaticPrefillCoordinator,
    AutomaticPrefillState,
} from '../forms/automaticPrefillCoordinator.js';

export type AutomaticPrefillStatusLabels = {
    submitting?: string;
    saved?: string;
    noPrefills?: string;
    failedToSave?: string;
    unknown?: string;
};
export type AutomaticPrefillStatusProps = {
    coordinator: AutomaticPrefillCoordinator;
    labels?: AutomaticPrefillStatusLabels;
    className?: string;
};

/** SDK-owned status and committed connection; SSR/import never request Save. */
export function AutomaticPrefillStatus(
    props: AutomaticPrefillStatusProps
): ReactNode {
    const [accepted, setAccepted] = useState<{
        coordinator: AutomaticPrefillCoordinator;
        state: AutomaticPrefillState;
    }>(() => ({
        coordinator: props.coordinator,
        state: props.coordinator.getSnapshot(),
    }));
    const committedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    committedEffect(() => {
        let active = true;
        const changed = () => {
            if (active)
                setAccepted({
                    coordinator: props.coordinator,
                    state: props.coordinator.getSnapshot(),
                });
        };
        const connection = props.coordinator.connect(changed);
        changed();
        return () => {
            active = false;
            connection.disconnect();
        };
    }, [props.coordinator]);
    const state =
        accepted.coordinator === props.coordinator
            ? accepted.state
            : props.coordinator.getSnapshot();
    if (state.phase === 'inactive' || state.phase === 'retired') return null;
    const pending =
        state.phase === 'idle' ||
        state.phase === 'submitting' ||
        state.phase === 'observing';
    const error = state.phase === 'error' || state.phase === 'unknown';
    const labels = props.labels;
    const text = pending
        ? (labels?.submitting ?? 'Automatically submitting…')
        : state.phase === 'saved'
          ? (labels?.saved ?? 'Form submitted.')
          : state.phase === 'unknown'
            ? (state.message ??
              labels?.unknown ??
              'Submission status is unknown.')
            : state.error === 'no-prefills'
              ? (labels?.noPrefills ?? 'No prefills were detected.')
              : (state.message ?? labels?.failedToSave ?? 'Failed to save.');
    return h(
        'section',
        {
            className: ['mx-sdk-automatic-prefill-status', props.className]
                .filter(Boolean)
                .join(' '),
            role: error ? 'alert' : 'status',
            'aria-live': error ? 'assertive' : 'polite',
            'aria-busy': pending || undefined,
            'data-state': state.phase,
        },
        h('p', null, text),
        pending
            ? h('span', {
                  className: 'mx-sdk-automatic-prefill-spinner',
                  'aria-hidden': true,
              })
            : null
    );
}
