/** Host-owned inputs for one explicit Save invocation. */
export type FormSaveInvocation<Key, Snapshot> = {
    sessionKey: Key;
    /** Read current state again after waiting; snapshots are retained, not cloned. */
    readSnapshot: () => Snapshot;
    /**
     * The original guarded operation. Called synchronously before registration.
     * A final host gate may fulfill without allocating. Once allocated, the host
     * owns transport and settlement; the coordinator never vetoes or replays it.
     */
    allocate: () => Promise<unknown>;
};

export type FormSaveCoordinator<Key, Snapshot> = {
    /**
     * Equal pending intent completes immediately with void, without joining its
     * outcome. Changed explicit intent waits, then rereads and reevaluates.
     * Fulfillment does not establish that a record was saved.
     */
    run: (invocation: FormSaveInvocation<Key, Snapshot>) => Promise<void>;
};

export type FormSaveCoordinatorOptions<Snapshot> = {
    /** Exact host equality, including null and any ordered dirty identifiers. */
    isEqual: (previous: Snapshot, current: Snapshot) => boolean;
};

/**
 * Portable active-Save coordination. Reuse one instance across invocations that
 * share session keys; distinct instances and keys coordinate independently.
 * This is separate from FormController and borrowed Submit admission.
 */
export const createFormSaveCoordinator = <Key, Snapshot>(
    options: FormSaveCoordinatorOptions<Snapshot>
): FormSaveCoordinator<Key, Snapshot> => {
    const active = new Map<
        Key,
        { promise: Promise<unknown>; snapshot: Snapshot }
    >();
    const run = async (
        invocation: FormSaveInvocation<Key, Snapshot>
    ): Promise<void> => {
        const snapshot = invocation.readSnapshot();
        const activeSave = active.get(invocation.sessionKey);
        if (activeSave != null) {
            if (options.isEqual(activeSave.snapshot, snapshot)) return;
            try {
                await activeSave.promise;
            } catch {
                // Only an already-explicit changed invocation may reevaluate.
                // The original caller still receives its own escaped error.
            }
            await run(invocation);
            return;
        }

        const promise = invocation.allocate();
        active.set(invocation.sessionKey, { promise, snapshot });
        try {
            await promise;
        } finally {
            if (active.get(invocation.sessionKey)?.promise === promise) {
                active.delete(invocation.sessionKey);
            }
        }
    };
    return { run };
};
