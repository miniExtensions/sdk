import type { AddressPrediction } from '../runtime/types.js';

export type AddressAutocompleteRequestState = Readonly<{
    phase:
        | 'idle'
        | 'loading-predictions'
        | 'predictions'
        | 'loading-details'
        | 'details'
        | 'failed-predictions'
        | 'failed-details';
    predictions: readonly Readonly<AddressPrediction>[];
    selectedPlaceId: string | null;
}>;

export type AddressAutocompleteRequestOptions = {
    /** Capture authorization, field identity and transport in these closures. */
    reads: {
        listPredictions(
            query: string,
            options: { signal: AbortSignal }
        ): Promise<readonly AddressPrediction[]>;
        getFormattedAddress(
            placeId: string,
            options: { signal: AbortSignal }
        ): Promise<string>;
    };
    isCurrent(): boolean;
    /** Synchronous caller acceptance; false declines the value. Never saves. */
    onValue(value: string, source: 'selection' | 'detail'): boolean | void;
    onStateChange?(state: AddressAutocompleteRequestState): void;
};

export type AddressAutocompleteRequests = {
    getState(): AddressAutocompleteRequestState;
    /** Retires prior work and schedules this exact caller-approved query. */
    schedulePredictions(query: string): void;
    /** Only a prediction object from the current snapshot may be selected. */
    select(prediction: Readonly<AddressPrediction>): void;
    /** Uses the failed kind; the caller supplies its current prediction query. */
    retry(query: string): void;
    retire(): void;
    destroy(): void;
};

const emptyPredictions = Object.freeze([]);
const idleState: AddressAutocompleteRequestState = Object.freeze({
    phase: 'idle',
    predictions: emptyPredictions,
    selectedPlaceId: null,
});

/** Request ordering only. No DOM, query normalization, draft store or transport. */
export const createAddressAutocompleteRequests = (
    options: AddressAutocompleteRequestOptions
): AddressAutocompleteRequests => {
    let state = idleState;
    let destroyed = false;
    let predictionGeneration = 0;
    let intentGeneration = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let predictionRequest: AbortController | undefined;
    let detailRequest: AbortController | undefined;

    const current = (): boolean => {
        if (destroyed) return false;
        try {
            return options.isCurrent();
        } catch {
            return false;
        }
    };
    const publish = (next: AddressAutocompleteRequestState): void => {
        state = Object.freeze(next);
        if (!destroyed) options.onStateChange?.(state);
    };
    const cancelPredictions = (): void => {
        predictionGeneration += 1;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        predictionRequest?.abort();
        predictionRequest = undefined;
    };
    const retire = (): void => {
        cancelPredictions();
        intentGeneration += 1;
        detailRequest?.abort();
        detailRequest = undefined;
        if (state !== idleState) publish(idleState);
    };
    const readPredictions = async (query: string, generation: number) => {
        if (!current() || generation !== predictionGeneration) return;
        const controller = new AbortController();
        predictionRequest?.abort();
        predictionRequest = controller;
        const owned = (): boolean =>
            current() &&
            !controller.signal.aborted &&
            generation === predictionGeneration;
        publish({
            phase: 'loading-predictions',
            predictions: emptyPredictions,
            selectedPlaceId: null,
        });
        if (!owned()) return;
        try {
            const result = await options.reads.listPredictions(query, {
                signal: controller.signal,
            });
            if (!owned()) return;
            if (
                !Array.isArray(result) ||
                result.some(
                    (item) =>
                        item == null ||
                        typeof item.description !== 'string' ||
                        typeof item.placeId !== 'string'
                )
            )
                throw new TypeError();
            publish({
                phase: 'predictions',
                predictions: Object.freeze(
                    result.map((item) => Object.freeze({ ...item }))
                ),
                selectedPlaceId: null,
            });
        } catch {
            if (owned())
                publish({
                    phase: 'failed-predictions',
                    predictions: emptyPredictions,
                    selectedPlaceId: null,
                });
        } finally {
            if (predictionRequest === controller) predictionRequest = undefined;
        }
    };
    const readDetails = async (placeId: string, generation: number) => {
        if (!current() || generation !== intentGeneration) return;
        const controller = new AbortController();
        detailRequest?.abort();
        detailRequest = controller;
        const owned = (): boolean =>
            current() &&
            !controller.signal.aborted &&
            generation === intentGeneration &&
            state.selectedPlaceId === placeId;
        publish({
            phase: 'loading-details',
            predictions: emptyPredictions,
            selectedPlaceId: placeId,
        });
        if (!owned()) return;
        try {
            const result = await options.reads.getFormattedAddress(placeId, {
                signal: controller.signal,
            });
            if (!owned()) return;
            if (typeof result !== 'string') throw new TypeError();
            if (options.onValue(result, 'detail') === false) {
                if (owned()) retire();
                return;
            }
            if (!owned()) return;
            publish({
                phase: 'details',
                predictions: emptyPredictions,
                selectedPlaceId: placeId,
            });
        } catch {
            if (owned())
                publish({
                    phase: 'failed-details',
                    predictions: emptyPredictions,
                    selectedPlaceId: placeId,
                });
        } finally {
            if (detailRequest === controller) detailRequest = undefined;
        }
    };

    return {
        getState: () => state,
        schedulePredictions: (query) => {
            if (!current()) return;
            retire();
            if (!current()) return;
            const generation = predictionGeneration;
            timer = setTimeout(() => {
                timer = undefined;
                void readPredictions(query, generation);
            }, 800);
        },
        select: (prediction) => {
            if (!current() || !state.predictions.includes(prediction)) return;
            cancelPredictions();
            detailRequest?.abort();
            const generation = ++intentGeneration;
            const placeId = prediction.placeId;
            publish({
                phase: 'idle',
                predictions: emptyPredictions,
                selectedPlaceId: placeId,
            });
            const owned = (): boolean =>
                current() &&
                generation === intentGeneration &&
                state.selectedPlaceId === placeId;
            if (!owned()) return;
            if (
                options.onValue(prediction.description, 'selection') === false
            ) {
                if (owned()) retire();
                return;
            }
            if (owned()) void readDetails(placeId, generation);
        },
        retry: (query) => {
            if (!current()) return;
            if (
                state.phase === 'failed-details' &&
                state.selectedPlaceId != null
            )
                void readDetails(state.selectedPlaceId, ++intentGeneration);
            else if (state.phase === 'failed-predictions')
                void readPredictions(query, ++predictionGeneration);
        },
        retire,
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            retire();
        },
    };
};
