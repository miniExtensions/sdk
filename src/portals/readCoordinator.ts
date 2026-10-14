import type {
    ListPortalLinkedRecordsInput,
    ListPortalLinkedRecordsResult,
} from '../runtime/types.js';
import type { PortalOwnerScope } from './types.js';
import { readOwnerScope, sameOwner } from './helpers.js';
import { PortalCollectionError } from './error.js';

export type PortalReadReceipt<Result> =
    | { type: 'accepted'; raw: Result; isCurrent(): boolean }
    | { type: 'retired' };

export type PortalReadCoordinatorOptions<Input extends object, Result> = {
    /** Existing canonical transport; this coordinator supplies no credentials. */
    load(input: Input, options: { signal: AbortSignal }): Promise<Result>;
    getScope(): PortalOwnerScope;
    /** App-owned token/configuration lease, never a backend authorization proof. */
    isContextCurrent?(): boolean;
    concurrency: 'reject' | 'supersede';
};
export type PortalCoordinatedReadOptions<
    Result = ListPortalLinkedRecordsResult,
> = {
    signal?: AbortSignal;
    /** Runs after ownership is established, immediately before transport dispatch. */
    onDispatch?(): void;
    /** Retire dispatched draft/page eligibility before abort callbacks run. */
    onCancelledAfterDispatch?(): void;
    /** Synchronous acceptance while abort and single-flight ownership remain held. */
    onAccepted?(
        receipt: Extract<PortalReadReceipt<Result>, { type: 'accepted' }>
    ): void;
};
export type PortalReadCoordinator<Input extends object, Result> = {
    read(
        input: Input,
        options?: PortalCoordinatedReadOptions<Result>
    ): Promise<PortalReadReceipt<Result>>;
    isCurrent(): boolean;
    hasPendingRead(): boolean;
    cancel(reason?: unknown): void;
    destroy(reason?: unknown): void;
};

/** Shared browser read-attempt ownership. No retries, storage, paging or write authority. */
export function createPortalReadCoordinator<
    Input extends object = ListPortalLinkedRecordsInput,
    Result = ListPortalLinkedRecordsResult,
>(
    options: PortalReadCoordinatorOptions<Input, Result>
): PortalReadCoordinator<Input, Result> {
    const owner = readOwnerScope(options.getScope);
    let phase: 'active' | 'stale' | 'disposed' = 'active';
    let generation = 0;
    let checking = false;
    let reason: unknown;
    type Attempt = {
        controller: AbortController;
        generation: number;
        dispatched: boolean;
        retired: boolean;
        cancelled(): void;
    };
    let active: Attempt | null = null;
    let preparing: Attempt | null = null;
    const lifecycleError = () =>
        reason ??
        new PortalCollectionError(
            phase === 'disposed' ? 'disposed' : 'scope-changed',
            phase === 'disposed'
                ? 'The Portal collection was disposed.'
                : 'The Portal owner or session changed. Create a fresh collection.'
        );
    const retire = (next: 'stale' | 'disposed', supplied?: unknown) => {
        if (phase !== 'active') return;
        const previous = active;
        const preparation = preparing;
        generation++;
        active = null;
        preparing = null;
        phase = next;
        reason = supplied;
        if (preparation) {
            preparation.retired = true;
            preparation.controller.abort(lifecycleError());
        }
        if (previous) {
            previous.retired = true;
            previous.controller.abort(lifecycleError());
        }
    };
    const isCurrent = (): boolean => {
        if (phase !== 'active' || checking) return false;
        const observed = generation;
        const unchanged = () => phase === 'active' && generation === observed;
        checking = true;
        try {
            const first = readOwnerScope(options.getScope);
            if (!unchanged()) return false;
            const context = options.isContextCurrent?.() ?? true;
            if (!unchanged()) return false;
            const last = readOwnerScope(options.getScope);
            if (!unchanged()) return false;
            if (context && sameOwner(first, owner) && sameOwner(last, owner))
                return true;
        } catch {
            // An unreadable app lease is stale, not an authorization outcome.
        } finally {
            checking = false;
        }
        if (phase === 'active' && generation === observed) retire('stale');
        return false;
    };
    const owned = (attempt: Attempt) =>
        !attempt.retired &&
        generation === attempt.generation &&
        isCurrent() &&
        !attempt.retired &&
        generation === attempt.generation;
    const cancel = (attempt: Attempt, supplied?: unknown) => {
        if (
            (active !== attempt && preparing !== attempt) ||
            attempt.controller.signal.aborted
        )
            return;
        try {
            if (attempt.dispatched) {
                generation++;
                attempt.cancelled();
            }
        } finally {
            // Reject-mode single-flight stays occupied until ignored-abort I/O settles.
            attempt.controller.abort(supplied);
        }
    };
    return {
        isCurrent,
        hasPendingRead: () => active !== null || preparing !== null,
        cancel: (supplied) => {
            const pending = preparing ?? active;
            if (pending) cancel(pending, supplied);
        },
        destroy: (supplied) => retire('disposed', supplied),
        async read(input, supplied = {}) {
            if (phase !== 'active') throw lifecycleError();
            if (
                (active !== null || preparing !== null) &&
                options.concurrency === 'reject'
            )
                throw new PortalCollectionError(
                    'read-in-progress',
                    'A Portal read is already in progress.'
                );
            const attempt: Attempt = {
                controller: new AbortController(),
                generation,
                dispatched: false,
                retired: false,
                cancelled: () => undefined,
            };
            // Reserve intent before application-owned scope, options or input getters.
            // Preparing a malformed/pre-aborted request does not retire accepted data
            // or an older transport; only a valid successor dispatch does that.
            const previousPreparation = preparing;
            preparing = attempt;
            if (previousPreparation) {
                previousPreparation.retired = true;
                previousPreparation.controller.abort();
            }
            let signal: AbortSignal | undefined;
            const forwardAbort = () => cancel(attempt, signal?.reason);
            try {
                if (!isCurrent()) throw lifecycleError();
                if (preparing !== attempt || attempt.retired)
                    return { type: 'retired' };
                const {
                    signal: capturedSignal,
                    onDispatch,
                    onCancelledAfterDispatch,
                    onAccepted,
                } = supplied;
                if (preparing !== attempt || attempt.retired)
                    return { type: 'retired' };
                signal = capturedSignal;
                attempt.cancelled = () => onCancelledAfterDispatch?.();
                signal?.throwIfAborted();
                signal?.addEventListener('abort', forwardAbort, { once: true });
                if (signal?.aborted) forwardAbort();
                attempt.controller.signal.throwIfAborted();
                const copied = structuredClone(input);
                if (!isCurrent() || preparing !== attempt || attempt.retired)
                    return { type: 'retired' };
                attempt.controller.signal.throwIfAborted();
                const previous = active;
                attempt.generation = ++generation;
                active = attempt;
                preparing = null;
                // Install dispatch ownership before synchronous old abort callbacks.
                if (previous) {
                    previous.retired = true;
                    previous.controller.abort();
                }
                attempt.controller.signal.throwIfAborted();
                if (!owned(attempt) || active !== attempt)
                    return { type: 'retired' };
                attempt.dispatched = true;
                onDispatch?.();
                attempt.controller.signal.throwIfAborted();
                if (!owned(attempt) || active !== attempt)
                    return { type: 'retired' };
                const raw = await options.load(copied, {
                    signal: attempt.controller.signal,
                });
                attempt.controller.signal.throwIfAborted();
                if (!owned(attempt) || active !== attempt)
                    return { type: 'retired' };
                const detached = structuredClone(raw);
                if (!owned(attempt) || active !== attempt)
                    return { type: 'retired' };
                const receipt: Extract<
                    PortalReadReceipt<Result>,
                    { type: 'accepted' }
                > = {
                    type: 'accepted',
                    raw: detached,
                    isCurrent: () =>
                        !signal?.aborted &&
                        !attempt.controller.signal.aborted &&
                        owned(attempt),
                };
                onAccepted?.(receipt);
                attempt.controller.signal.throwIfAborted();
                if (!owned(attempt) || active !== attempt)
                    return { type: 'retired' };
                return receipt;
            } catch (error) {
                if (attempt.retired) return { type: 'retired' };
                if (attempt.controller.signal.aborted)
                    throw attempt.controller.signal.reason ?? error;
                if (
                    !owned(attempt) ||
                    (active !== attempt && preparing !== attempt)
                )
                    return { type: 'retired' };
                throw error;
            } finally {
                signal?.removeEventListener('abort', forwardAbort);
                if (preparing === attempt) preparing = null;
                if (active === attempt) active = null;
            }
        },
    };
}
