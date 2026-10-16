import type { AirtableValue } from '../runtime/types.js';

export type ReconcileFormComputeResultInput = {
    /** Actual eligible frontend values this accepted request can acknowledge.
     * Own enumerable defined values only; exclude computed/read-only,
     * conditionally omitted and otherwise uncertain fields. Never use the full draft. */
    submittedData: Readonly<Record<string, AirtableValue>>;
    /** The complete current own-enumerable native draft, including blank append inputs. */
    latestData: Readonly<Record<string, AirtableValue | undefined>>;
    /** Accurate current dirty IDs; retained order and duplicates are preserved. */
    latestDirtyFieldIds: readonly string[];
    /** Current dirty fields with a newer edit generation or uncertain acknowledgment.
     * The host must include A → B → A edits even when their final bytes match. */
    retainDirtyFieldIds: ReadonlySet<string>;
    /** Native fields from the accepted, identity-normalized compute response. */
    serverData: Readonly<Record<string, AirtableValue>>;
    addOnlyTextFieldIds: ReadonlySet<string>;
    /** Explicit host policy for rich/native values; equality is not an edit receipt. */
    areValuesEquivalent: (
        latestValue: AirtableValue | undefined,
        submittedValue: AirtableValue | undefined
    ) => boolean;
};

export type FormComputeReconciliationResult = {
    data: Record<string, AirtableValue | undefined>;
    dirtyFieldIds: string[];
};

/**
 * Reconcile an accepted compute response into application-owned draft data.
 * This pure function supplies no request, identity, persistence or write authority.
 * Recheck owner/request/native revision after getters and comparison callbacks,
 * then apply atomically only while that captured application state remains current.
 * Top-level snapshots preserve native value references; inputs are never mutated.
 */
export function reconcileFormComputeResult(
    input: ReconcileFormComputeResultInput
): FormComputeReconciliationResult {
    const submittedData = { ...input.submittedData };
    const latestData = { ...input.latestData };
    const data = { ...input.serverData };
    const latestDirtyFieldIds = [...input.latestDirtyFieldIds];
    const retainDirtyFieldIds = new Set(input.retainDirtyFieldIds);
    const addOnlyTextFieldIds = new Set(input.addOnlyTextFieldIds);
    const areValuesEquivalent = input.areValuesEquivalent;
    const acknowledged = new Set<string>();
    for (const fieldId of Object.keys(submittedData)) {
        // JSON omits undefined fields; inherited/nonenumerable fields were not
        // captured. A matching value cannot acknowledge a newer edit intent.
        if (
            submittedData[fieldId] === undefined ||
            retainDirtyFieldIds.has(fieldId) ||
            !Object.hasOwn(latestData, fieldId)
        )
            continue;
        if (areValuesEquivalent(latestData[fieldId], submittedData[fieldId]))
            acknowledged.add(fieldId);
    }
    const dirtyFieldIds = latestDirtyFieldIds.filter(
        (fieldId) => !acknowledged.has(fieldId)
    );
    const setValue = (
        fieldId: string,
        value: AirtableValue | undefined
    ): void => {
        // A native field key must not invoke Object.prototype.__proto__.
        Object.defineProperty(data, fieldId, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
        });
    };
    const restoreLatest = (fieldId: string): void => {
        if (Object.hasOwn(latestData, fieldId))
            setValue(fieldId, latestData[fieldId]);
        else delete data[fieldId];
    };

    for (const fieldId of dirtyFieldIds) restoreLatest(fieldId);
    // Keep the acknowledged frontend bytes, not cosmetic server spelling.
    for (const fieldId of acknowledged)
        setValue(
            fieldId,
            addOnlyTextFieldIds.has(fieldId) ? '' : submittedData[fieldId]
        );
    // Server history is not the current append input, including when that
    // input is blank, absent or not dirty. Never revive history in the editor.
    for (const fieldId of addOnlyTextFieldIds)
        if (!acknowledged.has(fieldId)) restoreLatest(fieldId);
    return { data, dirtyFieldIds };
}
