/** Opaque, native-admitted presentation identity; never a token or draft. */
export type FormRecordActionsScope = object;

export type FormRecordDeleteOutcome =
    | Readonly<{
          status: 'unknown';
          operationId: object;
      }>
    | Readonly<{
          status: 'acknowledged';
          operationId: object;
          localSettlement: 'applied' | 'retired' | 'failed';
      }>;

export type FormRecordDeleteOperation = Readonly<{
    /** Local correlation only; this is not a server idempotency key. */
    id: object;
    /** A truthful native result, never inferred from a fulfilled thunk. */
    settled: Promise<FormRecordDeleteOutcome>;
}>;

export type FormRecordDeleteAdmission =
    | Readonly<{
          status: 'refused';
          reason:
              | 'unavailable'
              | 'ineligible'
              | 'pending'
              | 'retired'
              | 'acknowledged';
      }>
    | Readonly<{
          status: 'allocated';
          operation: FormRecordDeleteOperation;
      }>;

export type FormRecordActionsFrame = Readonly<{
    scope: FormRecordActionsScope;
    delete: Readonly<{
        visible: boolean;
        disabled: boolean;
        pending: boolean;
    }>;
    comments: Readonly<{ visible: boolean; disabled: boolean }>;
}>;

/**
 * The SDK owns confirmation presentation and action coordination. The native
 * host owns eligibility, canonical allocation, transport and original-owner
 * settlement. Confirmation targets the CURRENT accepted native scope when the
 * user confirms, rather than retaining a record from when the dialog opened.
 * Confirmation presentation dismisses immediately; it does not await deletion.
 */
export type FormRecordActionsPort = Readonly<{
    read(): FormRecordActionsFrame | null;
    subscribe(changed: () => void): () => void;
    /**
     * Synchronous current-scope/policy/single-flight admission. Only actual
     * transport invocation can return allocated. Rejection after invocation is
     * unknown unless independently verified otherwise. Never automatically
     * replay unknown or acknowledged operations, including after retirement.
     */
    requestCurrentDelete(): FormRecordDeleteAdmission;
    /** Open the existing native comments surface for the current scope only. */
    openCurrentComments(): 'handed-off' | 'refused';
}>;

export type FormRecordActionsSnapshot = Readonly<{
    /** Identity of this dialog opening, independent of record scope. */
    confirmation: object | null;
    showDelete: boolean;
    deleteDisabled: boolean;
    deletePending: boolean;
    showComments: boolean;
    commentsDisabled: boolean;
}>;

export type FormRecordActionsController = Readonly<{
    getSnapshot(): FormRecordActionsSnapshot;
    subscribe(changed: () => void): () => void;
    openDeleteConfirmation(): void;
    dismissDeleteConfirmation(confirmation: object): void;
    confirmDelete(confirmation: object): void;
    openComments(): void;
}>;

/** One presentation controller for a host port. Construction is inert. */
export function createFormRecordActionsController(
    port: FormRecordActionsPort
): FormRecordActionsController {
    let confirmation: object | null = null;
    let confirming = false;
    let snapshot: FormRecordActionsSnapshot | undefined;
    const pending = new Set<FormRecordActionsScope>();
    const listeners = new Set<() => void>();
    let unsubscribe: (() => void) | undefined;

    function notify() {
        for (const listener of [...listeners]) {
            try {
                listener();
            } catch {
                // A presentation subscription cannot interrupt an operation.
            }
        }
    }

    function getSnapshot(): FormRecordActionsSnapshot {
        const frame = port.read();
        const deletePending =
            frame != null && (frame.delete.pending || pending.has(frame.scope));
        const next: FormRecordActionsSnapshot = {
            confirmation,
            showDelete: frame?.delete.visible === true,
            deleteDisabled: frame?.delete.disabled !== false || deletePending,
            deletePending,
            showComments: frame?.comments.visible === true,
            commentsDisabled: frame?.comments.disabled !== false,
        };
        if (
            snapshot &&
            (Object.keys(next) as (keyof FormRecordActionsSnapshot)[]).every(
                (key) => next[key] === snapshot?.[key]
            )
        )
            return snapshot;
        snapshot = Object.freeze(next);
        return snapshot;
    }

    function readDeleteTarget(): FormRecordActionsFrame | null {
        const frame = port.read();
        return frame?.delete.visible &&
            !frame.delete.disabled &&
            !frame.delete.pending &&
            !pending.has(frame.scope)
            ? frame
            : null;
    }

    return {
        getSnapshot,
        subscribe(changed) {
            const listener = () => changed();
            listeners.add(listener);
            if (listeners.size === 1) unsubscribe = port.subscribe(notify);
            return () => {
                if (!listeners.delete(listener)) return;
                if (listeners.size === 0) {
                    confirmation = null;
                    const stop = unsubscribe;
                    unsubscribe = undefined;
                    stop?.();
                }
            };
        },
        openDeleteConfirmation() {
            if (confirmation || confirming || !readDeleteTarget()) return;
            confirmation = Object.freeze({});
            notify();
        },
        dismissDeleteConfirmation(opening) {
            if (confirmation !== opening) return;
            confirmation = null;
            notify();
        },
        confirmDelete(opening) {
            if (confirmation !== opening) return;
            confirmation = null;
            confirming = true;
            try {
                notify();
                // Read after dismissal, which can synchronously notify the host.
                const target = readDeleteTarget();
                if (!target) return;
                pending.add(target.scope);
                const release = () => {
                    pending.delete(target.scope);
                    notify();
                };
                let admission: FormRecordDeleteAdmission;
                try {
                    admission = port.requestCurrentDelete();
                } catch (error) {
                    release();
                    throw error;
                }
                if (admission.status === 'allocated') {
                    // Only the host settles. Both fulfillment and rejection
                    // end this presentation's pending state without replay.
                    void admission.operation.settled.then(release, release);
                } else {
                    release();
                }
            } finally {
                confirming = false;
                notify();
            }
        },
        openComments() {
            const frame = port.read();
            if (frame?.comments.visible && !frame.comments.disabled)
                port.openCurrentComments();
        },
    };
}
