import type { AirtableValue } from '../runtime/types.js';

type Immutable<T> = T extends readonly (infer Item)[]
    ? readonly Immutable<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: Immutable<T[Key]> }
      : T;

export type CanonicalFormValue = Immutable<AirtableValue>;
export type CanonicalFormValues = Readonly<
    Partial<Record<string, CanonicalFormValue>>
>;
export type CanonicalFormErrors = Readonly<Record<string, string | undefined>>;

/** Fixed at an accepted installation, never inferred from current dirty state. */
export type CanonicalFormOwner = Readonly<{
    cohort: 'public-direct-root-non-compute';
    installation: string;
}>;

export type CanonicalFormRecord =
    | Readonly<{ type: 'create' }>
    | Readonly<{ type: 'edit'; recordId: string; tableId: string }>;

export type CanonicalFormEditProvenance = Readonly<{
    instanceGeneration: number;
    policyGeneration?: number;
    /** Missing history is uncertain, rather than an implicit zero baseline. */
    fieldGenerations?: Readonly<Record<string, number>>;
    complete: boolean;
}>;

export type CanonicalFormRenderLease = Readonly<{
    ownerGeneration: number;
    policyGeneration?: number;
}>;

/** Presentation evidence only. None of these fields grants a write or Save. */
export type CanonicalFormReadonlyReceipt = Readonly<{
    requestId: string;
    phase: 'pending' | 'settled';
    candidateFieldIds: readonly string[];
    settledFieldIds: readonly string[];
}>;

export type CanonicalFormReadonlyOrigin = Readonly<{
    ownerGeneration: number;
    fieldIds: readonly string[];
    values: CanonicalFormValues;
    activeRequestId?: string;
    activeOriginBinding?: string;
    createPolicyRequestId?: string;
    createPolicyOriginalReadOnly?: boolean;
}>;

/**
 * One application-owned immutable canonical state. The host stores and publishes
 * this frame atomically; compatibility views must not become a second draft.
 * Compute, config-preview, child Forms and Portal remain separate native owners.
 */
export type CanonicalFormFrame = Readonly<{
    owner: CanonicalFormOwner;
    record: CanonicalFormRecord;
    values: CanonicalFormValues;
    dirtyFieldIds: readonly string[];
    errors: CanonicalFormErrors;
    /** Load/validation policy baseline, not an automatically refreshed Save. */
    loadedPolicyBaseline: CanonicalFormValues;
    isFormReadOnly: boolean;
    provenance: CanonicalFormEditProvenance | null;
    renderLease: CanonicalFormRenderLease | null;
    manualReadonlyCompute?: CanonicalFormReadonlyReceipt;
    manualReadonlyOrigin?: CanonicalFormReadonlyOrigin;
    manualReadonlyRetiredUrlFieldIds?: readonly string[];
}>;

export type CanonicalFormSaveSettlement<Authority, Allocation> = Readonly<{
    type: 'settleSave';
    authority: Authority;
    /** Actual allocated request capture, never queued intent or plain receipt. */
    allocation: Allocation;
    record: Extract<CanonicalFormRecord, { type: 'edit' }>;
    values: CanonicalFormValues;
    dirtyFieldIdsToKeep: readonly string[];
}>;

export type CanonicalFormEvent<Authority, Allocation, Failure = unknown> =
    | Readonly<{
          type: 'install';
          authority: Authority;
          /** Accepted loaded state, including its authoritative load baseline. */
          frame: CanonicalFormFrame;
      }>
    | Readonly<{ type: 'preserve'; authority: Authority }>
    | Readonly<{
          /** Replace edit authority without reinstalling loaded Form data. */
          type: 'replaceEditInstance';
          authority: Authority;
      }>
    | Readonly<{
          type: 'edit';
          authority: Authority;
          fieldId: string;
          /** UI writes cannot invent an undefined-value write operation. */
          value: CanonicalFormValue;
          dirty: 'append' | 'preserve';
      }>
    | Readonly<{
          type: 'replaceErrors';
          authority: Authority;
          errors: CanonicalFormErrors;
      }>
    | Readonly<{
          type: 'setLoadedBaseline';
          authority: Authority;
          /** The host must qualify this against the same accepted installation. */
          values: CanonicalFormValues;
      }>
    | Readonly<{
          type: 'setReadOnly';
          authority: Authority;
          readOnly: boolean;
      }>
    | CanonicalFormSaveSettlement<Authority, Allocation>
    | Readonly<{
          type: 'saveFailed';
          authority: Authority;
          allocation: Allocation;
          failure: Failure;
          /** Only an accepted native validation failure replaces field errors. */
          errors?: CanonicalFormErrors;
      }>
    | Readonly<{ type: 'retire'; authority: Authority }>;

export type CanonicalFormTransitionPorts<
    Authority,
    Allocation,
    Failure = unknown,
> = Readonly<{
    /**
     * Qualify actual action/read/request authority against the captured frame.
     * This is mandatory even when an event carries a matching-looking owner or
     * allocation. Throw the existing host error for invalid loaded/schema state.
     * Repeated calls must be safe: the kernel rechecks after host callbacks.
     */
    admit: (
        frame: CanonicalFormFrame | null,
        event: CanonicalFormEvent<Authority, Allocation, Failure>
    ) => boolean;
    /** Existing deep/native RichText equivalence, not an edit receipt. */
    areValuesEquivalent: (
        fieldId: string,
        previous: CanonicalFormValue | undefined,
        next: CanonicalFormValue,
        frame: CanonicalFormFrame
    ) => boolean;
    /** Current accepted schema and URL-prefill policy remain host-owned. */
    isReadonlyUrlPrefill: (
        frame: CanonicalFormFrame,
        fieldId: string
    ) => boolean;
    /**
     * Use the actual host allocator, including restoration across sessions and
     * exhaustion. A returned generation must be a nonnegative safe integer.
     * The operation describes its use, not a new independent counter.
     */
    allocateGeneration: (
        operation: 'instance' | 'policy' | 'field'
    ) => number | null;
    /**
     * Run existing changed/dependent validation against the updated values and
     * unchanged load baseline. Return the complete resulting error projection;
     * return next.errors itself when no error entry changed.
     */
    validateEdit: (
        previous: CanonicalFormFrame,
        next: CanonicalFormFrame,
        fieldId: string,
        value: CanonicalFormValue
    ) => CanonicalFormErrors;
    /** Only the matching allocated operation may retain its render lease. */
    retainRenderLease: (
        frame: CanonicalFormFrame,
        event: CanonicalFormSaveSettlement<Authority, Allocation>
    ) => boolean;
}>;

export type CanonicalFormTransitionDisposition =
    | 'stale'
    | 'unsupportedCohort'
    | 'unavailable'
    | 'installed'
    | 'preserved'
    | 'editInstanceReplaced'
    | 'unchanged'
    | 'edited'
    | 'errorsReplaced'
    | 'baselineReplaced'
    | 'policyChanged'
    | 'saveSettled'
    | 'retired';

export type CanonicalFormTransitionResult<Failure = unknown> =
    | Readonly<{
          disposition: CanonicalFormTransitionDisposition;
          frame: CanonicalFormFrame | null;
      }>
    | Readonly<{
          disposition: 'saveFailed';
          frame: CanonicalFormFrame;
          /** Publish host failure UI only after accepting this disposition. */
          failure: Failure;
      }>;

function freeze(value: unknown): void {
    if (value == null || typeof value !== 'object' || Object.isFrozen(value))
        return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
}

function snapshot<Value>(value: Value): Value {
    const copy = structuredClone(value);
    freeze(copy);
    return copy;
}

/**
 * Detach a host snapshot; this function admits no action and creates no lease,
 * request, controller or store. Only a qualified transition may be published.
 */
export function createCanonicalFormFrame(
    frame: CanonicalFormFrame
): CanonicalFormFrame {
    return snapshot(frame);
}

const validGeneration = (value: number | undefined): value is number =>
    value != null && Number.isSafeInteger(value) && value >= 0;

function allocateGeneration<Authority, Allocation, Failure>(
    ports: CanonicalFormTransitionPorts<Authority, Allocation, Failure>,
    operation: 'instance' | 'policy' | 'field'
): number | null {
    const generation = ports.allocateGeneration(operation);
    if (generation !== null && !validGeneration(generation))
        throw new RangeError(
            'Canonical Form allocator returned an invalid generation'
        );
    return generation;
}

function initializeProvenance<Authority, Allocation, Failure>(
    frame: CanonicalFormFrame,
    ports: CanonicalFormTransitionPorts<Authority, Allocation, Failure>
): CanonicalFormFrame {
    const generation = allocateGeneration(ports, 'instance');
    const next = {
        ...frame,
        provenance:
            generation == null
                ? null
                : Object.freeze({
                      instanceGeneration: generation,
                      fieldGenerations: Object.freeze({}),
                      complete: true,
                  }),
        renderLease:
            generation == null
                ? null
                : Object.freeze({ ownerGeneration: generation }),
    };
    delete next.manualReadonlyCompute;
    delete next.manualReadonlyOrigin;
    return Object.freeze(next);
}

function advanceField<Authority, Allocation, Failure>(
    frame: CanonicalFormFrame,
    fieldId: string,
    ports: CanonicalFormTransitionPorts<Authority, Allocation, Failure>
): CanonicalFormFrame {
    const initialized = validGeneration(frame.provenance?.instanceGeneration)
        ? frame
        : initializeProvenance(frame, ports);
    const generation = allocateGeneration(ports, 'field');
    // Native field-history exhaustion does not retire the separate render lease.
    if (generation == null || initialized.provenance == null)
        return Object.freeze({ ...initialized, provenance: null });
    return Object.freeze({
        ...initialized,
        provenance: Object.freeze({
            ...initialized.provenance,
            fieldGenerations: Object.freeze({
                ...initialized.provenance.fieldGenerations,
                [fieldId]: generation,
            }),
            complete:
                initialized.provenance.fieldGenerations == null
                    ? false
                    : initialized.provenance.complete,
        }),
    });
}

function advancePolicy<Authority, Allocation, Failure>(
    frame: CanonicalFormFrame,
    ports: CanonicalFormTransitionPorts<Authority, Allocation, Failure>
): CanonicalFormFrame {
    const initialized = validGeneration(frame.provenance?.instanceGeneration)
        ? frame
        : initializeProvenance(frame, ports);
    const generation = allocateGeneration(ports, 'policy');
    // Native policy exhaustion retires both provenance and the render lease.
    if (generation == null || initialized.provenance == null)
        return Object.freeze({
            ...initialized,
            provenance: null,
            renderLease: null,
        });
    return Object.freeze({
        ...initialized,
        provenance: Object.freeze({
            ...initialized.provenance,
            policyGeneration: generation,
        }),
        renderLease: Object.freeze({
            ...(initialized.renderLease ?? {
                ownerGeneration: initialized.provenance.instanceGeneration,
            }),
            policyGeneration: generation,
        }),
    });
}

function retireIntent<Authority, Allocation, Failure>(
    frame: CanonicalFormFrame,
    fieldId: string,
    ports: CanonicalFormTransitionPorts<Authority, Allocation, Failure>
): CanonicalFormFrame {
    const retireOrigin = frame.manualReadonlyOrigin?.fieldIds.includes(fieldId);
    const retireUrl = ports.isReadonlyUrlPrefill(frame, fieldId);
    if (
        !Object.hasOwn(frame, 'manualReadonlyCompute') &&
        !retireOrigin &&
        !retireUrl
    )
        return frame;
    const next = { ...frame };
    delete next.manualReadonlyCompute;
    if (retireOrigin) delete next.manualReadonlyOrigin;
    if (retireUrl)
        next.manualReadonlyRetiredUrlFieldIds = Object.freeze([
            ...new Set([
                ...(frame.manualReadonlyRetiredUrlFieldIds ?? []),
                fieldId,
            ]),
        ]);
    return Object.freeze(next);
}

/**
 * Pure native-compatible state transitions. The host keeps accepted action
 * authority, validation, allocator state, allocation capture and transport.
 * Inputs are never mutated; every changed published node is frozen. A stale
 * result must never be installed over whatever successor the host now owns.
 */
export function transitionCanonicalFormFrame<Authority, Allocation, Failure>(
    frame: CanonicalFormFrame | null,
    event: CanonicalFormEvent<Authority, Allocation, Failure>,
    ports: CanonicalFormTransitionPorts<Authority, Allocation, Failure>
): CanonicalFormTransitionResult<Failure> {
    if (
        (event.type === 'install' ? event.frame : frame)?.owner.cohort !==
            'public-direct-root-non-compute' &&
        (event.type === 'install' || frame != null)
    )
        return { disposition: 'unsupportedCohort', frame };
    if (!ports.admit(frame, event)) return { disposition: 'stale', frame };
    const finish = (
        next: CanonicalFormFrame | null,
        disposition: CanonicalFormTransitionDisposition
    ): CanonicalFormTransitionResult<Failure> => {
        if (!ports.admit(frame, event)) return { disposition: 'stale', frame };
        if (next != null && next !== frame) Object.freeze(next);
        return { disposition, frame: next };
    };
    if (event.type === 'install') {
        // A genuine public-root load starts fresh URL-intent history. Save and
        // missing-provenance repair do not reset that separate load history.
        const loaded = { ...createCanonicalFormFrame(event.frame) };
        delete loaded.manualReadonlyRetiredUrlFieldIds;
        const installed = initializeProvenance(loaded, ports);
        return finish(installed, 'installed');
    }
    if (event.type === 'preserve') return finish(frame, 'preserved');
    if (event.type === 'retire') return finish(null, 'retired');
    if (frame == null) return { disposition: 'unavailable', frame };

    switch (event.type) {
        case 'replaceEditInstance':
            // Native context replacement initializes with capture=false: keep
            // loaded data/baseline and URL-retirement history for this cohort.
            return finish(
                initializeProvenance(frame, ports),
                'editInstanceReplaced'
            );
        case 'edit': {
            const retired = retireIntent(frame, event.fieldId, ports);
            if (
                ports.areValuesEquivalent(
                    event.fieldId,
                    frame.values[event.fieldId],
                    event.value,
                    retired
                )
            )
                return finish(retired, 'unchanged');
            const value = snapshot(event.value);
            const written = advanceField(
                {
                    ...retired,
                    values: Object.freeze({
                        ...retired.values,
                        [event.fieldId]: value,
                    }),
                },
                event.fieldId,
                ports
            );
            const errors = ports.validateEdit(
                frame,
                written,
                event.fieldId,
                value
            );
            return finish(
                {
                    ...written,
                    errors:
                        errors === written.errors ? errors : snapshot(errors),
                    dirtyFieldIds:
                        event.dirty === 'append' &&
                        !written.dirtyFieldIds.includes(event.fieldId)
                            ? Object.freeze([
                                  ...written.dirtyFieldIds,
                                  event.fieldId,
                              ])
                            : written.dirtyFieldIds,
                },
                'edited'
            );
        }
        case 'replaceErrors':
            return finish(
                event.errors === frame.errors
                    ? frame
                    : { ...frame, errors: snapshot(event.errors) },
                'errorsReplaced'
            );
        case 'setLoadedBaseline':
            return finish(
                event.values === frame.loadedPolicyBaseline
                    ? frame
                    : {
                          ...frame,
                          loadedPolicyBaseline: snapshot(event.values),
                      },
                'baselineReplaced'
            );
        case 'setReadOnly':
            return event.readOnly === frame.isFormReadOnly
                ? finish(frame, 'unchanged')
                : finish(
                      {
                          ...advancePolicy(frame, ports),
                          isFormReadOnly: event.readOnly,
                      },
                      'policyChanged'
                  );
        case 'settleSave': {
            const retainedLease = ports.retainRenderLease(frame, event)
                ? frame.renderLease
                : null;
            const settled = initializeProvenance(
                {
                    ...frame,
                    record: snapshot(event.record),
                    values: snapshot(event.values),
                    dirtyFieldIds: Object.freeze([
                        ...new Set(event.dirtyFieldIdsToKeep),
                    ]),
                },
                ports
            );
            return finish(
                retainedLease == null
                    ? settled
                    : { ...settled, renderLease: retainedLease },
                'saveSettled'
            );
        }
        case 'saveFailed': {
            const next =
                event.errors == null || event.errors === frame.errors
                    ? frame
                    : { ...frame, errors: snapshot(event.errors) };
            if (!ports.admit(frame, event))
                return { disposition: 'stale', frame };
            if (next !== frame) Object.freeze(next);
            return {
                disposition: 'saveFailed',
                frame: next,
                failure: event.failure,
            };
        }
    }
}
