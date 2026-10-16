import type { AirtableValue } from '../runtime/types.js';

export type ReconcileFormComputeResultInput = {
    /** Tracked unfiltered request-start values, including conditionally omitted values. */
    requestStartData: Readonly<Record<string, AirtableValue>>;
    /** The complete native browser draft when the response is accepted. */
    latestData: Readonly<Record<string, AirtableValue>>;
    latestDirtyFieldIds: readonly string[];
    /** Native fields returned by the successful compute response. */
    serverData: Readonly<Record<string, AirtableValue>>;
    /** Dirty values deliberately omitted from this request's conditional write. */
    conditionallyHiddenDirtyFieldIds: ReadonlySet<string>;
    addOnlyTextFieldIds: ReadonlySet<string>;
    /** Retain the host's rich-text/native-value comparison policy explicitly. */
    areValuesEquivalent: (
        latestValue: AirtableValue | undefined,
        requestStartValue: AirtableValue | undefined
    ) => boolean;
};

export type FormComputeReconciliationResult = {
    data: Record<string, AirtableValue>;
    dirtyFieldIds: string[];
};

/**
 * Reconcile one current successful compute response without dispatching a write.
 * The caller owns request/record/session identity and must recheck ownership
 * after this call: getters and the required comparison callback may have effects.
 * Records are copied; native value references and dirty-ID order are retained.
 */
export function reconcileFormComputeResult(
    input: ReconcileFormComputeResultInput
): FormComputeReconciliationResult {
    const dirtyFieldIds = input.latestDirtyFieldIds.filter((fieldId) => {
        if (input.conditionallyHiddenDirtyFieldIds.has(fieldId)) return true;
        // Preserve the hosted presence rule, including inherited keys. Only
        // own submitted keys are copied back in the committed-value pass below.
        if (!(fieldId in input.requestStartData)) return true;
        return !input.areValuesEquivalent(
            input.latestData[fieldId],
            input.requestStartData[fieldId]
        );
    });
    const data = { ...input.serverData };
    const retained = new Set(dirtyFieldIds);
    const setValue = (fieldId: string, value: AirtableValue): void => {
        // A native field key must not invoke Object.prototype.__proto__.
        Object.defineProperty(data, fieldId, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
        });
    };

    for (const fieldId of dirtyFieldIds)
        setValue(fieldId, input.latestData[fieldId]);
    for (const fieldId of Object.keys(input.requestStartData)) {
        if (retained.has(fieldId)) continue;
        // Preserve the frontend bytes that committed successfully. Cosmetic
        // server normalization must not remount an editor and compute again.
        setValue(
            fieldId,
            input.addOnlyTextFieldIds.has(fieldId)
                ? ''
                : input.requestStartData[fieldId]
        );
    }
    return { data, dirtyFieldIds };
}
