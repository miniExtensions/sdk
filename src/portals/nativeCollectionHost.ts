import type {
    NativePortalCollectionBegin,
    NativePortalCollectionKernel,
    NativePortalCollectionReadReceipt,
    NativePortalCollectionResponse,
    NativePortalCollectionScope,
    NativePortalCollectionState,
    NativePortalCollectionTransition,
} from './nativeCollectionKernel.js';

export type NativePortalCollectionReadOutcome<Row, Schema, Detail, Projection> =

        | {
              readonly type: 'response';
              readonly response: NativePortalCollectionResponse<
                  Row,
                  Schema,
                  Detail,
                  Projection
              >;
          }
        | { readonly type: 'failure'; readonly message: string }
        | {
              readonly type: 'cleanup';
              readonly sort?: unknown;
              readonly filter?: unknown;
          };

/**
 * Implement this on the existing canonical host owner (for native, Redux).
 * commit is a synchronous compare-and-swap of the exact expected snapshot,
 * atomically applying state and compatibility/correction effects before observers.
 * The host isolates observer exceptions; notification errors must not escape
 * commit after publication or leave its outcome ambiguous to the caller.
 */
export interface NativePortalCollectionHostPort<
    Row,
    Schema,
    Detail,
    Projection,
> {
    snapshot(): NativePortalCollectionState<Row, Schema, Detail>;
    commit(
        expected: NativePortalCollectionState<Row, Schema, Detail>,
        transition: NativePortalCollectionTransition<
            Row,
            Schema,
            Detail,
            Projection
        >
    ): boolean;
    allocate(
        receipt: NativePortalCollectionReadReceipt,
        plan: {
            readonly mode: 'first' | 'next' | 'reload';
            readonly cursor: string | null;
            readonly parentFrameId: string | null;
        }
    ): Promise<
        NativePortalCollectionReadOutcome<Row, Schema, Detail, Projection>
    >;
    /** Pure binding calculation for the correction that commit will apply. */
    cleanupScope(
        state: NativePortalCollectionState<Row, Schema, Detail>,
        kind: 'sort' | 'filter',
        criteria: unknown
    ): NativePortalCollectionScope;
    /** Check isCurrent again when a deferred notice is delivered. */
    scheduleNotice(kind: 'sort' | 'filter', isCurrent: () => boolean): void;
    nextRequestId(): string;
}

/**
 * Orchestrates allocated work, not collection storage. A rejected/reentrant begin
 * sends nothing. Unmount has no cancellation semantics. Explicit retirement is
 * observed at every settlement and cleanup continuation boundary.
 */
export async function runNativePortalCollectionRead<
    Row,
    Schema,
    Detail,
    Projection,
>(
    kernel: NativePortalCollectionKernel<Row, Schema, Detail, Projection>,
    host: NativePortalCollectionHostPort<Row, Schema, Detail, Projection>,
    input: NativePortalCollectionBegin
): Promise<'skipped' | 'stale' | 'committed'> {
    const commit = (
        expected: NativePortalCollectionState<Row, Schema, Detail>,
        transition: NativePortalCollectionTransition<
            Row,
            Schema,
            Detail,
            Projection
        >
    ): boolean => {
        try {
            return host.commit(expected, transition);
        } catch {
            // A host observer may throw after the transaction committed. Inspect
            // the canonical owner before allocating or issuing any next effect.
            return host.snapshot() === transition.state;
        }
    };
    let command = input;
    for (;;) {
        const initial = host.snapshot();
        const begin = kernel.begin(initial, command);
        if (!begin) return 'skipped';
        if (!commit(initial, { state: begin.state }))
            return host.snapshot() === initial ? 'skipped' : 'stale';
        if (!kernel.isCurrent(host.snapshot(), begin.receipt)) return 'stale';
        let outcome: NativePortalCollectionReadOutcome<
            Row,
            Schema,
            Detail,
            Projection
        >;
        try {
            outcome = await host.allocate(begin.receipt, begin.plan);
        } catch (error) {
            outcome = {
                type: 'failure',
                message: error instanceof Error ? error.message : String(error),
            };
        }
        const current = host.snapshot();
        if (!kernel.isCurrent(current, begin.receipt)) return 'stale';
        if (outcome.type === 'cleanup') {
            const kind =
                outcome.sort != null
                    ? 'sort'
                    : outcome.filter != null
                      ? 'filter'
                      : null;
            if (kind === null) {
                const failed = kernel.fail(
                    current,
                    begin.receipt,
                    'Invalid Portal response'
                );
                return failed && commit(current, failed)
                    ? 'committed'
                    : 'stale';
            }
            const criteria = kind === 'sort' ? outcome.sort : outcome.filter;
            let cleanup: NativePortalCollectionTransition<
                Row,
                Schema,
                Detail,
                Projection
            > | null;
            try {
                cleanup = kernel.cleanup(
                    current,
                    begin.receipt,
                    kind,
                    criteria,
                    host.cleanupScope(current, kind, criteria)
                );
            } catch {
                const failed = kernel.fail(
                    current,
                    begin.receipt,
                    'Invalid Portal response'
                );
                return failed && commit(current, failed)
                    ? 'committed'
                    : 'stale';
            }
            if (!cleanup?.cleanup || !commit(current, cleanup)) return 'stale';
            const receipt = cleanup.cleanup.receipt;
            if (!kernel.isCleanupCurrent(host.snapshot(), receipt))
                return 'stale';
            host.scheduleNotice(kind, () => {
                const snapshot = host.snapshot();
                return (
                    !snapshot.disposed &&
                    snapshot.generation === receipt.generation &&
                    (
                        Object.keys(
                            receipt.scope
                        ) as (keyof NativePortalCollectionScope)[]
                    ).every(
                        (key) =>
                            key === 'bindingKey' ||
                            snapshot.scope[key] === receipt.scope[key]
                    )
                );
            });
            const afterNotice = host.snapshot();
            const continuation = kernel.completeCleanup(afterNotice, receipt);
            if (
                !continuation ||
                !commit(afterNotice, { state: continuation.state })
            )
                return 'stale';
            // A listener can replace the correction while continuation is published.
            if (host.snapshot() !== continuation.state) return 'stale';
            command = { ...continuation.read, requestId: host.nextRequestId() };
            continue;
        }
        let transition: NativePortalCollectionTransition<
            Row,
            Schema,
            Detail,
            Projection
        > | null;
        try {
            transition =
                outcome.type === 'response'
                    ? kernel.succeed(current, begin.receipt, outcome.response)
                    : kernel.fail(current, begin.receipt, outcome.message);
        } catch {
            transition = kernel.fail(
                current,
                begin.receipt,
                'Invalid Portal response'
            );
        }
        return transition && commit(current, transition)
            ? 'committed'
            : 'stale';
    }
}
