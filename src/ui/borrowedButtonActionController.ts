export type BorrowedButtonContext = {
    /** Real host lifetime identity; never an SDK accepted-client/context brand. */
    owner: object | string | number;
    /** Host-observed source/mode/context epoch, including observed ABA. */
    revision: string | number;
    visible: boolean;
    available: boolean;
};
export type BorrowedButtonIntent<Request, Receipt> = {
    /** Opaque native transport input; never included in public snapshots. */
    request: Request;
    /** Private host outcome/feedback/recovery ownership, not a second draft. */
    receipt: Receipt;
};
export type BorrowedButtonTransportOutcome<Result> =
    | { type: 'resolved'; value: Result }
    | { type: 'rejected'; phase: 'allocation' | 'completion'; error: unknown };
export type BorrowedButtonActionOptions<Request, Result, Receipt> = {
    readContext(): BorrowedButtonContext | null;
    subscribe(contextChanged: () => void): () => void;
    /** Actual existing host retry/recovery policy. Native next-click retry returns true. */
    mayStartNewIntent(): boolean;
    /** Read native input only after current visibility/availability/recovery admission. */
    captureIntent(): BorrowedButtonIntent<Request, Receipt> | null;
    /** Exact host transport. Calling this is the allocation boundary, even if it throws. */
    allocate(request: Request): Promise<Result>;
    /**
     * Exactly once after allocate invocation, including sync throw, rejection,
     * retirement/disposal or metadata/presentation faults. Host keeps original
     * result/error, persistence, feedback and recovery. Snapshot retirement cannot
     * veto it. This callback's failure never replaces the native outcome.
     */
    settleAllocated(
        receipt: Receipt,
        outcome: BorrowedButtonTransportOutcome<Result>,
        feedback: {
            /** Presentation ownership only; host authorization is unchanged. */
            isCurrent(): boolean;
        }
    ): void | Promise<void>;
};
export type BorrowedButtonActionSnapshot = {
    revision: number;
    phase: 'idle' | 'pending' | 'settling' | 'settled' | 'retired';
    busy: boolean;
    canTrigger: boolean;
};
export type BorrowedButtonActionResult<Result> =
    | {
          type: 'refused';
          reason: 'retired' | 'busy' | 'unavailable' | 'recovery' | 'capture';
          error?: unknown;
      }
    | {
          type: 'settled';
          /** Resolution is not a webhook business-success claim. */
          outcome: BorrowedButtonTransportOutcome<Result>;
          settlementFailure: { error: unknown } | null;
      };
export type BorrowedButtonActionController<Result> = {
    getSnapshot(): BorrowedButtonActionSnapshot;
    subscribe(
        changed: (snapshot: BorrowedButtonActionSnapshot) => void
    ): () => void;
    /** Explicit user intent only; no dispatch on construction, refresh or subscription. */
    trigger(): Promise<BorrowedButtonActionResult<Result>>;
    /** Stops new actions/presentation; never aborts or discards allocated host work. */
    dispose(): void;
};

/** Borrow native activity, never a client, canonical draft or recovery journal. */
export function createBorrowedButtonActionController<Request, Result, Receipt>(
    options: BorrowedButtonActionOptions<Request, Result, Receipt>
): BorrowedButtonActionController<Result> {
    // Capture ports before allocation: later option-property getters cannot veto settlement.
    const {
        readContext,
        subscribe,
        mayStartNewIntent,
        captureIntent,
        allocate,
        settleAllocated,
    } = options;
    let observing = 0;
    const call = <T>(callback: () => T): T => {
        observing++;
        try {
            return callback();
        } finally {
            observing--;
        }
    };
    const read = (): BorrowedButtonContext | null => {
        try {
            return call(() => {
                const raw = readContext();
                if (raw == null) return null;
                const owner = raw.owner,
                    revision = raw.revision,
                    visible = raw.visible,
                    available = raw.available;
                const ownerType = typeof owner;
                if (
                    !(
                        (ownerType === 'object' && owner !== null) ||
                        ownerType === 'function' ||
                        (ownerType === 'string' && owner !== '') ||
                        (ownerType === 'number' && Number.isFinite(owner))
                    ) ||
                    !(
                        typeof revision === 'string' ||
                        (typeof revision === 'number' &&
                            Number.isFinite(revision))
                    ) ||
                    typeof visible !== 'boolean' ||
                    typeof available !== 'boolean'
                )
                    return null;
                return { owner, revision, visible, available };
            });
        } catch {
            return null;
        }
    };
    const ignoreNotificationResult = (result: unknown) => {
        void Promise.resolve(result).catch(() => {});
    };
    const origin = read();
    let retired = origin === null,
        disposed = false,
        revision = 0;
    let phase: BorrowedButtonActionSnapshot['phase'] = retired
        ? 'retired'
        : 'idle';
    let flight: object | null = null,
        finishing = false,
        notifying = false;
    let stop: (() => void) | null = null;
    const listeners = new Set<
        (snapshot: BorrowedButtonActionSnapshot) => void
    >();
    const retire = () => {
        if (retired) return;
        retired = true;
        phase = 'retired';
        revision++;
        const release = stop;
        stop = null;
        try {
            ignoreNotificationResult(release?.());
        } catch {
            /* Observation cleanup is not native settlement. */
        }
    };
    const current = (): BorrowedButtonContext | null => {
        if (retired || observing !== 0) return null;
        const scope = read();
        if (
            scope == null ||
            scope.owner !== origin?.owner ||
            scope.revision !== origin.revision
        ) {
            retire();
            return null;
        }
        return scope;
    };
    const admission = (): 'retired' | 'unavailable' | 'recovery' | null => {
        for (let pass = 0; pass < 2; pass++) {
            const scope = current();
            if (!scope) return 'retired';
            if (!scope.visible || !scope.available) return 'unavailable';
            let allowed = false;
            try {
                allowed = call(mayStartNewIntent) === true;
            } catch {
                return 'recovery';
            }
            const after = current();
            if (!after) return 'retired';
            if (!after.visible || !after.available) return 'unavailable';
            if (!allowed) return 'recovery';
        }
        return null;
    };
    const snapshot = (): BorrowedButtonActionSnapshot => {
        const busy = !retired && flight !== null && !finishing;
        const scope = current();
        const canTrigger =
            !!scope && !busy && observing === 0 && admission() === null;
        return {
            revision,
            phase,
            busy: !retired && busy,
            canTrigger: !retired && canTrigger,
        };
    };
    const notify = () => {
        if (notifying || disposed) return;
        notifying = true;
        try {
            for (const listener of [...listeners]) {
                if (disposed) break;
                try {
                    ignoreNotificationResult(listener(snapshot()));
                } catch {
                    /* Presentation cannot alter allocated work. */
                }
            }
        } finally {
            notifying = false;
        }
    };
    const observe = () => {
        if (retired || observing !== 0) return;
        current();
        revision++;
        notify();
    };
    const model: BorrowedButtonActionController<Result> = {
        getSnapshot: snapshot,
        subscribe(listener) {
            if (disposed) return () => {};
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        async trigger() {
            if (flight !== null) return { type: 'refused', reason: 'busy' };
            if (retired) return { type: 'refused', reason: 'retired' };
            if (observing !== 0 || notifying)
                return { type: 'refused', reason: 'unavailable' };
            const ticket = {};
            flight = ticket;
            let allocated = false,
                published = false;
            try {
                const refusal = admission();
                if (refusal) return { type: 'refused', reason: refusal };
                let intent: BorrowedButtonIntent<Request, Receipt> | null;
                try {
                    intent = call(() => {
                        const raw = captureIntent();
                        if (raw == null) return null;
                        return { request: raw.request, receipt: raw.receipt };
                    });
                } catch (error) {
                    return { type: 'refused', reason: 'capture', error };
                }
                if (!intent) return { type: 'refused', reason: 'capture' };
                const afterCapture = admission();
                if (afterCapture)
                    return { type: 'refused', reason: afterCapture };
                phase = 'pending';
                revision++;
                published = true;
                notify();
                const afterPresentation = admission();
                if (afterPresentation)
                    return { type: 'refused', reason: afterPresentation };
                allocated = true;
                const outcome = await (async (): Promise<
                    BorrowedButtonTransportOutcome<Result>
                > => {
                    let completion: Promise<Result>;
                    try {
                        completion = allocate(intent.request);
                    } catch (error) {
                        return { type: 'rejected', phase: 'allocation', error };
                    }
                    try {
                        return { type: 'resolved', value: await completion };
                    } catch (error) {
                        return { type: 'rejected', phase: 'completion', error };
                    }
                })();
                if (!retired) phase = 'settling';
                revision++;
                notify();
                let settlementFailure: { error: unknown } | null = null;
                try {
                    await settleAllocated(intent.receipt, outcome, {
                        isCurrent() {
                            const scope = current();
                            return (
                                scope?.visible === true &&
                                scope.available === true
                            );
                        },
                    });
                } catch (error) {
                    settlementFailure = { error };
                }
                if (!retired) phase = 'settled';
                finishing = true;
                revision++;
                notify();
                return { type: 'settled', outcome, settlementFailure };
            } finally {
                if (!allocated && published) {
                    if (!retired) phase = 'idle';
                    finishing = true;
                    revision++;
                    notify();
                }
                if (flight === ticket) flight = null;
                finishing = false;
            }
        },
        dispose() {
            if (disposed) return;
            retire();
            disposed = true;
            listeners.clear();
        },
    };
    if (!retired) {
        try {
            const unsubscribe = call(() => subscribe(observe));
            if (typeof unsubscribe !== 'function') retire();
            else stop = unsubscribe;
            observe();
        } catch {
            retire();
        }
    }
    return model;
}
