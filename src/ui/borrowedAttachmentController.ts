import type { OrderedAttachmentUpload } from './orderedAttachmentUploads.js';

export type BorrowedAttachmentBatchScope = {
    /** Stable host state source shared by every mount of this Form. */
    source: object;
    sessionId: string;
    fieldId: string;
};

type BatchClaim = { isRetained(): boolean; checking: boolean };
const batchClaims = new WeakMap<object, Map<string, BatchClaim>>();

/** Reserve one native field batch across mounts until its captured owner retires or releases. */
export function claimBorrowedAttachmentBatch(
    { source, sessionId, fieldId }: BorrowedAttachmentBatchScope,
    isRetained: () => boolean
): (() => void) | null {
    let claims = batchClaims.get(source);
    if (claims == null) {
        claims = new Map();
        batchClaims.set(source, claims);
    }
    const key = JSON.stringify([sessionId, fieldId]);
    const incumbent = claims.get(key);
    if (incumbent != null) {
        if (incumbent.checking) return null;
        incumbent.checking = true;
        try {
            if (incumbent.isRetained()) return null;
        } finally {
            incumbent.checking = false;
        }
        // A host callback can release the old claim and admit a new one.
        const latest = claims.get(key);
        if (latest != null && latest !== incumbent) return null;
    }
    const batch = { isRetained, checking: false };
    claims.set(key, batch);
    return () => {
        if (claims.get(key) === batch) claims.delete(key);
    };
}

/** Host-private identity, never server authorization or a loaded SDK Form. */
export type BorrowedAttachmentField<T> = {
    owner: object | string | number;
    revision: string | number;
    visible: boolean;
    editable: boolean;
    /** Host confirms only the presentation detached. Owner and edit policy still apply. */
    presentation?: 'detached';
    /** Actual host privacy gate, separate from editability. */
    valueReadable: boolean;
    /** Borrowed native objects. Read only in visible, attached snapshots. */
    value: readonly T[];
};
export type BorrowedAttachmentProgress = {
    bytesTransferred: number;
    totalBytes: number;
};
export type BorrowedAttachmentAllocation<T> = {
    completion: Promise<T>;
    /** Explicit cancellation request only; a late completion still settles. */
    cancel?(): void;
};
export type BorrowedAttachmentAdmission<T, Receipt> = {
    /** Host-held allocated-batch settlement ownership, opaque to this model. */
    receipt: Receipt;
    /** New allocation only; include actual owner history, policy and capacity. */
    canAllocate(
        file: File,
        originalIndex: number,
        completed: readonly OrderedAttachmentUpload<T>[]
    ): boolean;
};
export type BorrowedAttachmentFailure = {
    phase: 'read' | 'capture' | 'admission' | 'allocation' | 'completion';
    error: unknown;
};
export type BorrowedAttachmentBatchResult<T> = {
    outcome: 'not-started' | 'completed' | 'cancelled' | 'retired' | 'failed';
    completed: readonly OrderedAttachmentUpload<T>[];
    allocatedCount: number;
    failure: BorrowedAttachmentFailure | null;
    settlementFailure: { error: unknown } | null;
};
export type BorrowedAttachmentSnapshot<T> = {
    phase:
        | 'idle'
        | 'admitting'
        | 'uploading'
        | 'settling'
        | 'completed'
        | 'cancelled'
        | 'retired'
        | 'failed'
        | 'disposed';
    busy: boolean;
    /** Uncompleted native Files; retry is a fresh explicit host-admitted start. */
    files: readonly File[];
    value: readonly T[] | null;
    fieldRevision: string | number | null;
    progress: BorrowedAttachmentProgress | null;
    result: BorrowedAttachmentBatchResult<T> | null;
};
export type BorrowedAttachmentControllerOptions<T, Receipt> = {
    readField(): BorrowedAttachmentField<T> | null;
    subscribe(changed: () => void): () => void;
    /** Synchronous admission only: no transport or canonical write here. */
    captureBatch(
        files: readonly File[]
    ): BorrowedAttachmentAdmission<T, Receipt> | null;
    allocate(
        file: File,
        originalIndex: number,
        progress: (value: BorrowedAttachmentProgress) => void
    ): BorrowedAttachmentAllocation<T>;
    /** Exactly once after any allocator invocation, including throw/rejection.
     * Host owns current-native append, partial recovery and cleanup. Retirement
     * of presentation/new allocation never vetoes this allocated settlement.
     */
    settleCompleted(
        receipt: Receipt,
        result: Readonly<BorrowedAttachmentBatchResult<T>>
    ): void | Promise<void>;
};
export type BorrowedAttachmentController<T> = {
    getSnapshot(): BorrowedAttachmentSnapshot<T>;
    subscribe(
        listener: (snapshot: BorrowedAttachmentSnapshot<T>) => void
    ): () => void;
    /** Serial batch; no implicit retry, native draft, client or recovery journal. */
    start(files: readonly File[]): Promise<BorrowedAttachmentBatchResult<T>>;
    cancel(): void;
    /** Prevent new dispatch and release presentation; never abort allocated work. */
    dispose(): void;
};

type Flight<T, Receipt> = {
    files: readonly File[];
    owner: BorrowedAttachmentField<T>['owner'] | null;
    admission: BorrowedAttachmentAdmission<T, Receipt> | null;
    receipt: { value: Receipt } | null;
    completed: OrderedAttachmentUpload<T>[];
    allocatedCount: number;
    cancelled: boolean;
    retired: boolean;
    allocation: BorrowedAttachmentAllocation<T> | null;
    cancelRequested: boolean;
};

const result = <T>(
    outcome: BorrowedAttachmentBatchResult<T>['outcome'],
    completed: readonly OrderedAttachmentUpload<T>[] = [],
    allocatedCount = 0,
    failure: BorrowedAttachmentFailure | null = null
): BorrowedAttachmentBatchResult<T> => ({
    outcome,
    completed: Object.freeze(
        completed.map((entry) => Object.freeze({ ...entry }))
    ),
    allocatedCount,
    failure: failure == null ? null : Object.freeze({ ...failure }),
    settlementFailure: null,
});

/** Borrow actual host state and settlement, without constructing accepted authority. */
export function createBorrowedAttachmentController<T, Receipt>(
    options: BorrowedAttachmentControllerOptions<T, Receipt>
): BorrowedAttachmentController<T> {
    let disposed = false;
    let reading = false;
    let active: Flight<T, Receipt> | null = null;
    let phase: BorrowedAttachmentSnapshot<T>['phase'] = 'idle';
    let files: readonly File[] = [];
    let progress: BorrowedAttachmentProgress | null = null;
    let last: BorrowedAttachmentBatchResult<T> | null = null;
    let lastOwner: BorrowedAttachmentField<T>['owner'] | null = null;
    let notification = 0;
    let hostNotifications = 0;
    let stop = () => {};
    const listeners = new Set<
        (snapshot: BorrowedAttachmentSnapshot<T>) => void
    >();
    const read = (onDetached?: () => void) => {
        if (disposed || reading) return null;
        reading = true;
        try {
            const field = options.readField();
            const detached = field?.presentation === 'detached';
            if (detached) onDetached?.();
            if (
                active?.owner != null &&
                (field == null ||
                    !Object.is(field.owner, active.owner) ||
                    (detached ? active.allocatedCount === 0 : !field.visible) ||
                    !field.editable)
            )
                active.retired = true;
            return field == null ? null : { field, detached };
        } finally {
            reading = false;
        }
    };
    const unavailable = (
        unavailablePhase: BorrowedAttachmentSnapshot<T>['phase'] = disposed
            ? 'disposed'
            : phase,
        busy = active !== null
    ): BorrowedAttachmentSnapshot<T> => ({
        phase: unavailablePhase,
        busy,
        files: [],
        value: null,
        fieldRevision: null,
        progress: null,
        result: null,
    });
    const masked = () => unavailable('idle', false);
    const snapshot = (): BorrowedAttachmentSnapshot<T> => {
        // A host read can reenter before it has returned the detach marker.
        if (reading) return disposed ? unavailable() : masked();
        const observedNotifications = hostNotifications;
        const expired = () => observedNotifications !== hostNotifications;
        let detached = false;
        try {
            const observation = read(() => {
                detached = true;
            });
            if (detached || expired()) return masked();
            if (observation == null) return unavailable();
            const { field } = observation;
            // Every host-owned metadata/native getter belongs to this guarded
            // presentation projection. Nothing outside it may veto settlement.
            const visible = field.visible === true;
            if (!visible) return expired() ? masked() : unavailable();
            const readable = field.valueReadable === true;
            const owner = readable ? field.owner : null;
            const fieldRevision = visible ? field.revision : null;
            const ownerMatches =
                (active?.owner == null || Object.is(active.owner, owner)) &&
                (last == null ||
                    lastOwner == null ||
                    Object.is(lastOwner, owner));
            if (expired()) return masked();
            const value = readable && ownerMatches ? field.value : null;
            const activityVisible =
                readable &&
                (active == null ||
                    (!active.retired && Object.is(active.owner, owner))) &&
                (last == null ||
                    (last.outcome !== 'retired' &&
                        Object.is(lastOwner, owner)));
            if (disposed) return unavailable();
            if (expired()) return masked();
            return {
                phase,
                busy: active !== null,
                files: activityVisible ? [...files] : [],
                value,
                fieldRevision,
                progress:
                    !activityVisible || progress == null
                        ? null
                        : { ...progress },
                result: !activityVisible || last == null ? null : { ...last },
            };
        } catch {
            // Includes revision/visibility/owner metadata, not just field.value.
            return detached || expired() ? masked() : unavailable();
        }
    };
    const emit = () => {
        if (disposed) return;
        const emission = ++notification;
        const value = snapshot();
        for (const listener of [...listeners]) {
            if (disposed || notification !== emission) break;
            if (listeners.has(listener)) {
                try {
                    listener({ ...value, files: [...value.files] });
                } catch {
                    /* Presentation cannot veto allocation settlement. */
                }
            }
        }
    };
    const requestCancel = (flight: Flight<T, Receipt>) => {
        if (flight.allocation == null || flight.cancelRequested) return;
        flight.cancelRequested = true;
        try {
            flight.allocation.cancel?.();
        } catch {
            /* Host completion, not cancel feedback, determines settlement. */
        }
    };
    const run = async (flight: Flight<T, Receipt>, input: readonly File[]) => {
        let failure: BorrowedAttachmentFailure | null = null;
        let failurePhase: BorrowedAttachmentFailure['phase'] = 'read';
        let answer: BorrowedAttachmentBatchResult<T>;
        try {
            // Own singleflight before reading caller arrays or invoking any port.
            flight.files = Object.freeze([...input]);
            files = flight.files;
            const first = read();
            if (
                first == null ||
                first.detached ||
                !first.field.visible ||
                !first.field.editable ||
                flight.files.length === 0
            )
                flight.retired = true;
            else {
                flight.owner = first.field.owner;
                failurePhase = 'capture';
                flight.admission = options.captureBatch(flight.files);
                if (flight.admission == null) flight.retired = true;
                else flight.receipt = { value: flight.admission.receipt };
            }
            for (let index = 0; index < flight.files.length; index++) {
                if (disposed || flight.cancelled || flight.retired) break;
                phase = 'uploading';
                progress = null;
                emit();
                failurePhase = 'read';
                const observedNotifications = hostNotifications;
                const observation = read();
                if (observation == null) {
                    flight.retired = true;
                    break;
                }
                if (flight.retired || flight.cancelled || disposed) break;
                const file = flight.files[index];
                failurePhase = 'admission';
                if (
                    !flight.admission?.canAllocate(
                        file,
                        index,
                        Object.freeze(
                            flight.completed.map((entry) =>
                                Object.freeze({ ...entry })
                            )
                        )
                    )
                )
                    flight.retired = true;
                // Admission/notifications can synchronously replace policy or cancel.
                failurePhase = 'read';
                const latest = read();
                if (
                    latest == null ||
                    observation.detached !== latest.detached ||
                    observedNotifications !== hostNotifications
                )
                    flight.retired = true;
                if (flight.retired || flight.cancelled || disposed) break;
                failurePhase = 'allocation';
                flight.allocatedCount++;
                flight.cancelRequested = false;
                let acceptingProgress = true;
                const allocation = options.allocate(file, index, (next) => {
                    if (
                        !acceptingProgress ||
                        active !== flight ||
                        disposed ||
                        phase !== 'uploading'
                    )
                        return;
                    progress = { ...next };
                    emit();
                });
                flight.allocation = allocation;
                if (flight.cancelled) requestCancel(flight);
                failurePhase = 'completion';
                let attachment: T;
                try {
                    attachment = await allocation.completion;
                } finally {
                    acceptingProgress = false;
                    flight.allocation = null;
                }
                // Never reapply new-allocation admission to an allocated result.
                flight.completed.push({ file, index, attachment });
                files = flight.files.slice(index + 1);
                emit();
            }
        } catch (error) {
            failure = { phase: failurePhase, error };
        }
        answer = result(
            failure
                ? 'failed'
                : flight.cancelled
                  ? 'cancelled'
                  : disposed || flight.retired
                    ? 'retired'
                    : 'completed',
            flight.completed,
            flight.allocatedCount,
            failure
        );
        phase = 'settling';
        try {
            if (flight.allocatedCount > 0 && flight.receipt != null) {
                emit();
                await options.settleCompleted(
                    flight.receipt.value,
                    Object.freeze({ ...answer })
                );
            }
        } catch (error) {
            answer.settlementFailure = { error };
        } finally {
            if (active === flight) active = null;
            last = { ...answer };
            lastOwner = flight.owner;
            phase =
                answer.settlementFailure != null
                    ? 'failed'
                    : answer.outcome === 'not-started'
                      ? 'idle'
                      : answer.outcome;
            progress = null;
            emit();
        }
        return answer;
    };
    const controller: BorrowedAttachmentController<T> = {
        getSnapshot: snapshot,
        subscribe(listener) {
            if (disposed) return () => {};
            listeners.add(listener);
            try {
                listener(snapshot());
            } catch {
                /* Observers cannot veto host work. */
            }
            return () => {
                listeners.delete(listener);
            };
        },
        start(input) {
            if (disposed || active !== null)
                return Promise.resolve(result('not-started'));
            const flight: Flight<T, Receipt> = {
                files: [],
                owner: null,
                admission: null,
                receipt: null,
                completed: [],
                allocatedCount: 0,
                cancelled: false,
                retired: false,
                allocation: null,
                cancelRequested: false,
            };
            active = flight;
            phase = 'admitting';
            last = null;
            lastOwner = null;
            return run(flight, input);
        },
        cancel() {
            if (active == null || active.cancelled) return;
            active.cancelled = true;
            requestCancel(active);
            emit();
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            notification++;
            if (active != null) active.retired = true;
            files = [];
            progress = null;
            last = null;
            listeners.clear();
            stop();
        },
    };
    stop = options.subscribe(() => {
        hostNotifications++;
        try {
            read();
        } catch {
            if (active != null) active.retired = true;
        }
        emit();
    });
    if (disposed) stop();
    return controller;
}
