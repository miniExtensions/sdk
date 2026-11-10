import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
    createDurationInputAdapter,
    type DurationInputAdapter,
    type DurationInputOwner,
} from '../ui/durationInputCompatibility.js';

export type DurationInputOwnership = {
    /** Actual committed owner/configuration generation; not a value hash. */
    token: unknown;
    isCurrent(): boolean;
};

export type DurationInputAdapterProps = DurationInputOwner & {
    fieldId: string;
    sessionId: string;
    owner: DurationInputOwnership;
};

/** Controlled-host bridge. Only committed props may authorize a canonical edit. */
export function useDurationInputAdapter(
    props: DurationInputAdapterProps
): DurationInputAdapter {
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    const accepted = useRef<{
        lease: object;
        props: DurationInputAdapterProps;
    } | null>(null);
    const lease = useMemo(
        () => ({}),
        [props.fieldId, props.sessionId, props.format, props.owner.token]
    );
    const adapter = useMemo(
        () =>
            createDurationInputAdapter({
                read: () => accepted.current?.props ?? null,
                isCurrent: () =>
                    accepted.current?.lease === lease &&
                    accepted.current.props.owner.isCurrent(),
            }),
        [lease]
    );
    useCommitEffect(() => {
        accepted.current = { lease, props };
        return () => {
            if (accepted.current?.lease === lease) accepted.current = null;
        };
    });
    return adapter;
}
