import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AddressPrediction } from '../runtime/types.js';
import {
    createAddressAutocompleteRequests,
    type AddressAutocompleteRequestOptions,
    type AddressAutocompleteRequests,
    type AddressAutocompleteRequestState,
} from '../ui/addressAutocompleteRequests.js';

/** Replace any authority-bearing member when its authorized read scope changes. */
export type AddressAutocompleteIdentity = Readonly<{
    session: unknown;
    field: unknown;
    readScope: unknown;
}>;

export type AddressAutocompleteLifecycleProps = {
    identity: AddressAutocompleteIdentity;
    reads: AddressAutocompleteRequestOptions['reads'];
    /** The caller remains the sole canonical value owner. No Save is performed. */
    value: string | null;
    onChange(value: string): void;
    /** Recognize the native writer's capped echo; never cap external values. */
    maxLength?: number;
    disabled?: boolean;
    readOnly?: boolean;
};

/** React lifetime/committed-value bridge around the unchanged request engine. */
export function useAddressAutocomplete(
    props: AddressAutocompleteLifecycleProps
) {
    // Server render installs no request owner; client commits retain layout timing.
    const ownerEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    const { session, field, readScope } = props.identity;
    const blocked = props.disabled === true || props.readOnly === true;
    const scope = useMemo(() => ({}), [session, field, readScope, blocked]);
    const [state, setState] = useState<AddressAutocompleteRequestState>({
        phase: 'idle',
        predictions: [],
        selectedPlaceId: null,
    });
    const active = useRef<{
        scope: typeof scope;
        requests: AddressAutocompleteRequests;
    } | null>(null);
    const committed = useRef(props);
    const committedValue = useRef(props.value ?? '');
    const ownEcho = useRef<string | null>(null);
    ownerEffect(() => {
        committed.current = props;
    });
    const emit = (value: string) => {
        const owner = committed.current;
        ownEcho.current =
            owner.maxLength == null ? value : value.slice(0, owner.maxLength);
        owner.onChange(value);
    };
    ownerEffect(() => {
        let requests: AddressAutocompleteRequests | undefined;
        const ownsScope = () =>
            active.current?.scope === scope &&
            active.current.requests === requests;
        const isCurrent = () => ownsScope() && !blocked;
        requests = createAddressAutocompleteRequests({
            reads: {
                listPredictions: (query, options) =>
                    committed.current.reads.listPredictions(query, options),
                getFormattedAddress: (placeId, options) =>
                    committed.current.reads.getFormattedAddress(
                        placeId,
                        options
                    ),
            },
            isCurrent,
            onValue: (value) => {
                if (!isCurrent()) return false;
                emit(value);
                return true;
            },
            onStateChange: (next) => {
                if (isCurrent()) setState(next);
            },
        });
        active.current = { scope, requests };
        setState(requests.getState());
        return () => {
            if (ownsScope()) active.current = null;
            requests?.destroy();
            ownEcho.current = null;
        };
    }, [scope]);
    ownerEffect(() => {
        const value = props.value ?? '';
        const changed = value !== committedValue.current;
        const isOwnEcho = value === ownEcho.current;
        committedValue.current = value;
        if (changed && !isOwnEcho) {
            const owner = active.current;
            if (owner != null) {
                // A reentrant same-scope external replacement also supersedes
                // any manual edit currently inside an abort notification.
                active.current = { ...owner };
                owner.requests.retire();
            }
        }
    }, [props.value]);
    ownerEffect(() => {
        // Even an unchanged capped echo is a one-commit receipt.
        ownEcho.current = null;
    });

    return {
        state,
        change(value: string) {
            const owner = active.current;
            if (owner == null || owner.scope !== scope || blocked) return;
            // Abort listeners may synchronously edit again, replace the owner,
            // or unmount. A fresh bridge receipt fences both sides of emission.
            const intent = { ...owner };
            active.current = intent;
            owner.requests.retire();
            if (active.current !== intent) return;
            emit(value);
            if (value !== '' && active.current === intent)
                owner.requests.schedulePredictions(value);
        },
        select(prediction: Readonly<AddressPrediction> | null) {
            const owner = active.current;
            if (prediction == null || owner?.scope !== scope || blocked) return;
            owner.requests.select(prediction);
        },
        retry() {
            const owner = active.current;
            // A retained Retry from an earlier failure grants no current intent.
            if (
                blocked ||
                owner?.scope !== scope ||
                owner.requests.getState() !== state
            )
                return;
            const value = committed.current.value ?? '';
            if (state.phase !== 'failed-details' && value.length === 0) return;
            owner.requests.retry(value);
        },
    };
}
