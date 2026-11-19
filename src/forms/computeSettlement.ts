import type { AirtableValue } from '../runtime/types.js';
import type {
    CanonicalFormEditProvenance,
    CanonicalFormErrors,
    CanonicalFormFrame,
    CanonicalFormReadonlyOrigin,
    CanonicalFormReadonlyReceipt,
    CanonicalFormRecord,
    CanonicalFormValue,
    CanonicalFormValues,
} from './canonicalFrame.js';
import { reconcileFormComputeResult } from './computeReconciliation.js';

export type CanonicalFormComputeFrame = Readonly<
    Omit<CanonicalFormFrame, 'owner'> & {
        owner: Readonly<{
            cohort: 'public-direct-root-compute';
            installation: string;
        }>;
    }
>;

export type CanonicalFormComputeRequest<Allocation> = Readonly<{
    /** An actual host allocation, with snapshots taken when transport starts. */
    allocation: Allocation;
    requestId: string;
    owner: CanonicalFormComputeFrame['owner'];
    record: CanonicalFormRecord;
    provenance: CanonicalFormEditProvenance;
    /** Only eligible, included inputs that the response may acknowledge. */
    submittedValues: CanonicalFormValues;
    /** Original dirty values compared before publishing native validation errors. */
    validationValues: CanonicalFormValues;
    addOnlyTextFieldIds: readonly string[];
    /** Actual manual readonly inputs, including fields excluded from acknowledgment. */
    readonlyEchoValues?: CanonicalFormValues;
}>;

export type CanonicalFormComputeOutcome<Failure> =
    | Readonly<{
          type: 'returned';
          record: Extract<CanonicalFormRecord, { type: 'edit' }>;
          values: CanonicalFormValues;
      }>
    | Readonly<{
          type: 'failed';
          failure: Failure;
      }>
    | Readonly<{
          type: 'validationFailed';
          failure: Failure;
          errors: CanonicalFormErrors;
      }>;

type Equivalent = (
    current: CanonicalFormValue | undefined,
    submitted: CanonicalFormValue | undefined
) => boolean;

export type CanonicalFormComputePorts<Allocation> = Readonly<{
    /** Check current owner, request version, and the exact native frame snapshot. */
    isCurrent: (
        frame: CanonicalFormComputeFrame,
        request: CanonicalFormComputeRequest<Allocation>
    ) => boolean;
    areValuesEquivalent: Equivalent;
    allocateInstanceGeneration: () => number | null;
    retainRenderLease: (
        frame: CanonicalFormComputeFrame,
        request: CanonicalFormComputeRequest<Allocation>
    ) => boolean;
    /** Native exact value equality, independent of normalization for acknowledgment. */
    areReadonlyValuesEqual?: Equivalent;
    /** Check still-current context and visibility/schema/link policy before settlement. */
    admitsReadonlyReceipt?: (
        before: CanonicalFormComputeFrame,
        after: CanonicalFormComputeFrame,
        request: CanonicalFormComputeRequest<Allocation>
    ) => boolean;
    /** Check the active binding and owner for an intact origin across publication. */
    retainsReadonlyOrigin?: (
        before: CanonicalFormComputeFrame,
        after: CanonicalFormComputeFrame,
        request: CanonicalFormComputeRequest<Allocation>
    ) => boolean;
}>;

export type CanonicalFormComputeSettlement<Failure> =
    | Readonly<{
          disposition:
              | 'unsupportedCohort'
              | 'stale'
              | 'computeSettled'
              | 'computeValidationSuperseded';
          frame: CanonicalFormComputeFrame;
      }>
    | Readonly<{
          disposition: 'computeFailed';
          frame: CanonicalFormComputeFrame;
          failure: Failure;
      }>;

function sameRecord(before: CanonicalFormRecord, after: CanonicalFormRecord) {
    return before.type === 'create'
        ? after.type === 'create'
        : after.type === 'edit' &&
              before.recordId === after.recordId &&
              before.tableId === after.tableId;
}

const validGeneration = (value: number | undefined): value is number =>
    value != null && Number.isSafeInteger(value) && value >= 0;

function fieldGeneration(provenance: CanonicalFormEditProvenance, id: string) {
    const generations = provenance.fieldGenerations;
    if (generations && Object.hasOwn(generations, id)) return generations[id];
    return provenance.complete && generations ? 0 : undefined;
}

function frozenCopy<Value>(value: Value): Value {
    const copy = structuredClone(value);
    function freeze(item: unknown) {
        if (item == null || typeof item !== 'object' || Object.isFrozen(item))
            return;
        Object.freeze(item);
        for (const child of Object.values(item)) freeze(child);
    }
    freeze(copy);
    return copy;
}

function clearOriginRequest(origin: CanonicalFormReadonlyOrigin) {
    const next = { ...origin };
    delete next.activeRequestId;
    delete next.activeOriginBinding;
    return next;
}

function retireReadonlyRequest(
    frame: CanonicalFormComputeFrame,
    requestId: string
): CanonicalFormComputeFrame {
    const receipt = frame.manualReadonlyCompute;
    const origin = frame.manualReadonlyOrigin;
    const retireReceipt =
        receipt?.phase === 'pending' && receipt.requestId === requestId;
    const retireOrigin = origin?.activeRequestId === requestId;
    if (!retireReceipt && !retireOrigin) return frame;
    const next = { ...frame };
    if (retireReceipt) delete next.manualReadonlyCompute;
    if (retireOrigin && origin) {
        if (origin.createPolicyRequestId === requestId)
            delete next.manualReadonlyOrigin;
        else
            next.manualReadonlyOrigin = Object.freeze(
                clearOriginRequest(origin)
            );
    }
    return Object.freeze(next);
}

function settleReadonlyReceipt<Allocation>(
    before: CanonicalFormComputeFrame,
    after: CanonicalFormComputeFrame,
    request: CanonicalFormComputeRequest<Allocation>,
    returnedValues: CanonicalFormValues,
    ports: CanonicalFormComputePorts<Allocation>
): CanonicalFormReadonlyReceipt | undefined {
    const pending = before.manualReadonlyCompute;
    const expectedEcho = request.readonlyEchoValues;
    const equal = ports.areReadonlyValuesEqual;
    if (
        pending?.phase !== 'pending' ||
        pending.requestId !== request.requestId ||
        !expectedEcho ||
        !equal ||
        before.renderLease == null ||
        after.renderLease !== before.renderLease ||
        after.dirtyFieldIds.length === 0 ||
        pending.candidateFieldIds.length === 0 ||
        !after.dirtyFieldIds.every(
            (id) =>
                pending.candidateFieldIds.includes(id) &&
                equal(before.values[id], after.values[id])
        ) ||
        !pending.candidateFieldIds.every(
            (id) =>
                Object.hasOwn(expectedEcho, id) &&
                Object.hasOwn(returnedValues, id) &&
                equal(returnedValues[id], expectedEcho[id])
        ) ||
        ports.admitsReadonlyReceipt?.(before, after, request) !== true
    )
        return undefined;
    return frozenCopy({
        ...pending,
        phase: 'settled',
        settledFieldIds: after.dirtyFieldIds,
    });
}

function settleReadonlyOrigin<Allocation>(
    before: CanonicalFormComputeFrame,
    after: CanonicalFormComputeFrame,
    request: CanonicalFormComputeRequest<Allocation>,
    ports: CanonicalFormComputePorts<Allocation>
): CanonicalFormReadonlyOrigin | undefined {
    const origin = before.manualReadonlyOrigin;
    if (origin?.activeRequestId && origin.activeRequestId !== request.requestId)
        return origin;
    const equal = ports.areReadonlyValuesEqual;
    if (
        !origin ||
        origin.activeRequestId !== request.requestId ||
        origin.activeOriginBinding == null ||
        (origin.createPolicyRequestId != null &&
            (origin.createPolicyRequestId !== request.requestId ||
                before.record.type !== 'create' ||
                before.isFormReadOnly !==
                    origin.createPolicyOriginalReadOnly)) ||
        after.renderLease == null ||
        !equal ||
        !origin.fieldIds.every(
            (id) =>
                Object.hasOwn(origin.values, id) &&
                Object.hasOwn(before.values, id) &&
                Object.hasOwn(after.values, id) &&
                equal(origin.values[id], before.values[id]) &&
                equal(origin.values[id], after.values[id])
        ) ||
        ports.retainsReadonlyOrigin?.(before, after, request) !== true
    )
        return undefined;
    const next = {
        ...clearOriginRequest(origin),
        ownerGeneration: after.renderLease.ownerGeneration,
    };
    delete next.createPolicyRequestId;
    delete next.createPolicyOriginalReadOnly;
    return Object.freeze(next);
}

/**
 * Settle one host-allocated, direct-root Compute. The host owns transport and
 * must check the original frame and request again when publishing atomically.
 */
export function transitionCanonicalFormCompute<Allocation, Failure>(
    frame: CanonicalFormComputeFrame,
    request: CanonicalFormComputeRequest<Allocation>,
    outcome: CanonicalFormComputeOutcome<Failure>,
    ports: CanonicalFormComputePorts<Allocation>
): CanonicalFormComputeSettlement<Failure> {
    if (frame.owner.cohort !== 'public-direct-root-compute')
        return { disposition: 'unsupportedCohort', frame };

    const current = frame.provenance;
    const stale = { disposition: 'stale', frame } as const;
    if (
        request.owner.cohort !== frame.owner.cohort ||
        request.owner.installation !== frame.owner.installation ||
        !sameRecord(request.record, frame.record) ||
        current == null ||
        !validGeneration(current.instanceGeneration) ||
        current.instanceGeneration !== request.provenance.instanceGeneration ||
        !ports.isCurrent(frame, request)
    )
        return stale;

    const retired = retireReadonlyRequest(frame, request.requestId);
    if (outcome.type !== 'returned') {
        if (
            outcome.type === 'validationFailed' &&
            Object.entries(request.validationValues).some(
                ([id, original]) =>
                    !ports.areValuesEquivalent(frame.values[id], original)
            )
        ) {
            return ports.isCurrent(frame, request)
                ? { disposition: 'computeValidationSuperseded', frame: retired }
                : stale;
        }
        const next =
            outcome.type === 'validationFailed'
                ? Object.freeze({
                      ...retired,
                      errors: frozenCopy(outcome.errors),
                  })
                : retired;
        return ports.isCurrent(frame, request)
            ? {
                  disposition: 'computeFailed',
                  frame: next,
                  failure: outcome.failure,
              }
            : stale;
    }

    if (
        frame.record.type === 'edit' &&
        !sameRecord(frame.record, outcome.record)
    )
        return stale;

    const retainDirtyFieldIds = new Set(
        Object.keys(request.submittedValues).filter((id) => {
            const previous = fieldGeneration(request.provenance, id);
            const latest = fieldGeneration(current, id);
            return (
                !validGeneration(previous) ||
                !validGeneration(latest) ||
                previous !== latest
            );
        })
    );
    // The existing reconciler reads native values without mutating them.
    const result = reconcileFormComputeResult({
        submittedData: request.submittedValues as Readonly<
            Record<string, AirtableValue>
        >,
        latestData: frame.values as Readonly<
            Record<string, AirtableValue | undefined>
        >,
        latestDirtyFieldIds: frame.dirtyFieldIds,
        retainDirtyFieldIds,
        serverData: outcome.values as Readonly<Record<string, AirtableValue>>,
        addOnlyTextFieldIds: new Set(request.addOnlyTextFieldIds),
        areValuesEquivalent: ports.areValuesEquivalent,
    });
    if (!ports.isCurrent(frame, request)) return stale;

    const generation = ports.allocateInstanceGeneration();
    if (generation !== null && !validGeneration(generation))
        throw new RangeError(
            'Canonical Form allocator returned an invalid generation'
        );
    const next = {
        ...retired,
        record: frozenCopy(outcome.record),
        values: frozenCopy(result.data),
        dirtyFieldIds: Object.freeze([...new Set(result.dirtyFieldIds)]),
        provenance:
            generation == null
                ? null
                : frozenCopy({
                      instanceGeneration: generation,
                      fieldGenerations: {},
                      complete: true,
                  }),
        renderLease:
            (ports.retainRenderLease(frame, request) && frame.renderLease) ||
            (generation == null
                ? null
                : Object.freeze({ ownerGeneration: generation })),
    } satisfies CanonicalFormComputeFrame;
    const receipt = settleReadonlyReceipt(
        frame,
        next,
        request,
        outcome.values,
        ports
    );
    if (receipt) next.manualReadonlyCompute = receipt;
    const origin = settleReadonlyOrigin(frame, next, request, ports);
    if (origin) next.manualReadonlyOrigin = origin;
    else delete next.manualReadonlyOrigin;
    return ports.isCurrent(frame, request)
        ? { disposition: 'computeSettled', frame: Object.freeze(next) }
        : stale;
}
