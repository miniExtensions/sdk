import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
    createLocalizedNumericInputAdapter,
    type LocalizedNumericInputOwner,
} from '../ui/localizedNumericInput.js';

export type LocalizedNumericInputAdapterProps = LocalizedNumericInputOwner & {
    /** Native presentation session identity, when the caller has one. */
    extensionSessionId?: string;
    owner?: { token: unknown; isCurrent(): boolean };
};

/** Compatibility hook for controlled hosts; canonical state and Save stay outside. */
export function useLocalizedNumericInputAdapter(
    props: LocalizedNumericInputAdapterProps
) {
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    const accepted = useRef<{
        lease: object;
        owner: LocalizedNumericInputAdapterProps;
    } | null>(null);
    const lease = useMemo(
        () => ({}),
        [
            props.extensionSessionId,
            props.owner?.token,
            props.airtableField.id,
            props.airtableField.config.type,
        ]
    );
    const adapter = useMemo(
        () =>
            createLocalizedNumericInputAdapter({
                read: () => accepted.current?.owner ?? null,
                isCurrent: () =>
                    accepted.current?.lease === lease &&
                    (accepted.current.owner.owner?.isCurrent() ?? true),
            }),
        [lease]
    );
    useCommitEffect(() => {
        accepted.current = { lease, owner: props };
    });
    // No asynchronous/subscription resource exists. Preserve the original
    // deferred host's deliberate final unmount commit before UI retirement.
    return adapter;
}
