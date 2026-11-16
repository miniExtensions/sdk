import {
    evaluateAutomaticPrefill,
    type AutomaticPrefillFacts,
} from './automaticPrefill.js';

/** Interned opaque host stamps, never serialized native configuration/token data. */
export type AutomaticPrefillScope = Readonly<{
    owner: unknown;
    configuration: unknown;
}>;
export type AutomaticPrefillFrame = Readonly<{
    scope: AutomaticPrefillScope;
    read: unknown;
    facts: AutomaticPrefillFacts;
    saveState:
        | { type: 'idle' | 'pending' | 'complete' }
        | { type: 'error'; message?: string };
}>;
export type AutomaticPrefillIntent = Readonly<{
    scope: AutomaticPrefillScope;
    token: object;
    reason: 'automatic-prefill';
    action: 'save';
}>;
declare const allocationBrand: unique symbol;
export type AutomaticPrefillAllocation = Readonly<{
    [allocationBrand]: true;
}>;
export type AutomaticPrefillAllocationAdmission =
    | {
          status: 'admitted';
          allocation: AutomaticPrefillAllocation;
          read: unknown;
      }
    | { status: 'refused' };
export type AutomaticPrefillOutcome =
    | { status: 'refused'; message?: string }
    | { status: 'coalesced'; message?: string }
    | {
          status: 'saved' | 'failed' | 'unknown';
          allocation: AutomaticPrefillAllocation;
          message?: string;
      };
export type AutomaticPrefillRequest = Readonly<{
    intent: AutomaticPrefillIntent;
    /** Call at canonical allocation, after native Compute/coalescing waits. */
    admitAllocation(): AutomaticPrefillAllocationAdmission;
    /** Report actual native allocation; a permit alone is not an outcome. */
    didAllocate(allocation: AutomaticPrefillAllocation): void;
    /** A tagged canonical result, never inferred from thunk fulfillment. */
    didSettle(outcome: AutomaticPrefillOutcome): void;
}>;
export type AutomaticPrefillRequestReceipt =
    | { status: 'accepted' }
    | { status: 'coalesced' }
    | { status: 'refused'; message?: string };
export type AutomaticPrefillHost = {
    read(expected: AutomaticPrefillScope): AutomaticPrefillFrame | null;
    isCurrent(frame: AutomaticPrefillFrame): boolean;
    subscribe(changed: () => void): () => void;
    /** Synchronous request admission; void/Promise is not an admission receipt. */
    requestFinalSave(
        request: AutomaticPrefillRequest
    ): AutomaticPrefillRequestReceipt;
};
export type AutomaticPrefillState = Readonly<{
    phase:
        | 'idle'
        | 'inactive'
        | 'submitting'
        | 'observing'
        | 'error'
        | 'saved'
        | 'unknown'
        | 'retired';
    requested: boolean;
    allocated: boolean;
    outcome: 'saved' | 'failed' | 'unknown' | null;
    error?: 'no-prefills' | 'host-refused' | 'save-failed';
    /** Host-admitted display text, not raw transport/debug errors. */
    message?: string;
}>;
export type AutomaticPrefillConnection = {
    refresh(): void;
    disconnect(): void;
};
export type AutomaticPrefillCoordinator = {
    getSnapshot(): AutomaticPrefillState;
    /** Commit-only: constructing/importing/SSR-rendering a coordinator is inert. */
    connect(changed: () => void): AutomaticPrefillConnection;
    /** Terminal owner retirement; allocated host effects still settle normally. */
    retire(): void;
};

/**
 * One automatic intent for one genuine logical Form/config lifetime. Native
 * retains canonical Save scheduling, equality, transport and settlement. A view
 * may disconnect/reconnect (React StrictMode) without consuming another intent.
 */
export function createAutomaticPrefillCoordinator(
    host: AutomaticPrefillHost,
    expected: AutomaticPrefillScope
): AutomaticPrefillCoordinator {
    const scope = Object.freeze({
        owner: expected.owner,
        configuration: expected.configuration,
    });
    let state: AutomaticPrefillState = Object.freeze({
        phase: 'idle',
        requested: false,
        allocated: false,
        outcome: null,
    });
    const connections = new Set<{ changed(): void; active: boolean }>();
    let unsubscribe: (() => void) | null = null;
    let retired = false;
    type Attempt = {
        intent: AutomaticPrefillIntent;
        receipt:
            | 'pending'
            | AutomaticPrefillRequestReceipt['status']
            | 'invalid';
        permit: AutomaticPrefillAllocation | null;
        admitting: boolean;
        allocated: boolean;
        settled: boolean;
        observing: boolean;
    };
    let attempt: Attempt | null = null;
    const publish = (change: Partial<AutomaticPrefillState>) => {
        const next = Object.freeze({ ...state, ...change });
        if (
            (Object.keys(next) as (keyof AutomaticPrefillState)[]).every(
                (key) => Object.is(next[key], state[key])
            )
        )
            return;
        state = next;
        for (const connection of [...connections]) {
            if (!connection.active) continue;
            try {
                connection.changed();
            } catch {
                /* A view cannot replay an intent. */
            }
        }
    };
    const retire = () => {
        if (retired) return;
        retired = true;
        const stop = unsubscribe;
        unsubscribe = null;
        try {
            stop?.();
        } catch {
            /* Host cleanup cannot undo allocated effects. */
        }
        publish({ phase: 'retired' });
    };
    const current = () => {
        if (retired) return null;
        try {
            const frame = host.read(scope);
            if (
                !frame ||
                !Object.is(frame.scope.owner, scope.owner) ||
                !Object.is(frame.scope.configuration, scope.configuration) ||
                !host.isCurrent(frame)
            ) {
                retire();
                return null;
            }
            return retired ? null : frame;
        } catch {
            retire();
            return null;
        }
    };
    const active = () => !retired && connections.size > 0;
    const fail = (message?: string) =>
        publish({
            phase: retired ? 'retired' : 'unknown',
            outcome: 'unknown',
            message,
        });
    const refresh = () => {
        if (!active()) return;
        const frame = current();
        if (!frame || !active()) return;
        const decision = evaluateAutomaticPrefill(frame.facts);
        if (decision.mode === 'manual') {
            publish({ phase: 'inactive' });
            return;
        }
        if (attempt) {
            if (attempt.observing) {
                publish(
                    frame.saveState.type === 'error'
                        ? {
                              phase: 'error',
                              error: 'save-failed',
                              message: frame.saveState.message,
                          }
                        : {
                              phase: 'observing',
                              error: undefined,
                              message: undefined,
                          }
                );
                return;
            }
            if (!attempt.settled && frame.saveState.type === 'error')
                publish({
                    phase: 'error',
                    error: 'save-failed',
                    message: frame.saveState.message,
                });
            return;
        }
        // Consume before publication: subscriptions/reentry cannot request twice.
        const intent = Object.freeze({
            scope,
            token: Object.freeze({}),
            reason: 'automatic-prefill' as const,
            action: 'save' as const,
        });
        const own: Attempt = {
            intent,
            receipt: 'pending',
            permit: null,
            admitting: false,
            allocated: false,
            settled: false,
            observing: frame.saveState.type !== 'idle',
        };
        attempt = own;
        if (frame.saveState.type === 'error') {
            publish({
                phase: 'error',
                error: 'save-failed',
                message: frame.saveState.message,
            });
            return;
        }
        if (frame.saveState.type !== 'idle') {
            publish({ phase: 'observing' });
            return;
        }
        if (!decision.eligible) {
            publish({ phase: 'error', error: 'no-prefills' });
            return;
        }
        publish({ phase: 'submitting' });
        const afterPublication = active() ? current() : null;
        if (!afterPublication) return;
        const stillEligible = evaluateAutomaticPrefill(afterPublication.facts);
        if (stillEligible.mode !== 'automatic' || !stillEligible.eligible) {
            publish({ phase: 'error', error: 'no-prefills' });
            return;
        }
        const request: AutomaticPrefillRequest = Object.freeze({
            intent,
            admitAllocation() {
                if (
                    !active() ||
                    own.admitting ||
                    own.permit ||
                    own.allocated ||
                    own.settled ||
                    (own.receipt !== 'pending' && own.receipt !== 'accepted')
                )
                    return { status: 'refused' };
                own.admitting = true;
                try {
                    const latest = current();
                    if (!latest) return { status: 'refused' };
                    const read = latest.read;
                    const eligibility = evaluateAutomaticPrefill(latest.facts);
                    if (
                        eligibility.mode !== 'automatic' ||
                        !eligibility.eligible ||
                        !active() ||
                        !host.isCurrent(latest)
                    )
                        return { status: 'refused' };
                    // Every foreign callback can settle, retire, or reenter.
                    if (
                        !active() ||
                        own.permit ||
                        own.allocated ||
                        own.settled ||
                        (own.receipt !== 'pending' &&
                            own.receipt !== 'accepted')
                    )
                        return { status: 'refused' };
                    const allocation = Object.freeze(
                        {}
                    ) as AutomaticPrefillAllocation;
                    own.permit = allocation;
                    return { status: 'admitted', allocation, read };
                } catch {
                    retire();
                    return { status: 'refused' };
                } finally {
                    own.admitting = false;
                }
            },
            didAllocate(allocation) {
                if (own.settled || own.allocated) return;
                if (!own.permit || allocation !== own.permit) {
                    fail();
                    return;
                }
                // Actual allocation is a fact even if the request wrapper later
                // throws or returns a contradictory admission result.
                own.allocated = true;
                publish({ allocated: true });
            },
            didSettle(outcome) {
                if (own.settled) return;
                own.settled = true;
                if (outcome.status === 'coalesced' && !own.allocated) {
                    own.observing = true;
                    publish({
                        phase: retired ? 'retired' : 'observing',
                        error: undefined,
                        message: undefined,
                    });
                    return;
                }
                if (outcome.status === 'refused' && !own.allocated) {
                    publish({
                        phase: retired ? 'retired' : 'error',
                        error: 'host-refused',
                        message: outcome.message,
                    });
                    return;
                }
                if (
                    outcome.status === 'refused' ||
                    outcome.status === 'coalesced' ||
                    !own.permit ||
                    !own.allocated ||
                    outcome.allocation !== own.permit
                ) {
                    fail();
                    return;
                }
                publish({
                    phase: retired
                        ? 'retired'
                        : outcome.status === 'failed'
                          ? 'error'
                          : outcome.status,
                    outcome: outcome.status,
                    error:
                        outcome.status === 'failed' ? 'save-failed' : undefined,
                    message: outcome.message,
                });
            },
        });
        try {
            const receipt = host.requestFinalSave(request);
            publish({ requested: true });
            if (
                !receipt ||
                typeof (receipt as { then?: unknown }).then === 'function' ||
                !['accepted', 'coalesced', 'refused'].includes(receipt.status)
            ) {
                own.receipt = 'invalid';
                if (!own.settled) fail();
            } else {
                own.receipt = receipt.status;
                if (own.settled) return;
                if (own.allocated && receipt.status !== 'accepted') fail();
                else if (receipt.status === 'coalesced') {
                    own.observing = true;
                    publish({ phase: retired ? 'retired' : 'observing' });
                } else if (receipt.status === 'refused')
                    publish({
                        phase: retired ? 'retired' : 'error',
                        error: 'host-refused',
                        message: receipt.message,
                    });
            }
        } catch {
            publish({ requested: true });
            own.receipt = 'invalid';
            if (!own.settled) fail();
        }
    };
    return {
        getSnapshot: () => state,
        retire,
        connect(changed) {
            const connection = { changed, active: true };
            connections.add(connection);
            if (!retired && connections.size === 1) {
                try {
                    const stop = host.subscribe(refresh);
                    if (!active()) stop();
                    else unsubscribe = stop;
                } catch {
                    retire();
                }
            }
            refresh();
            return {
                refresh() {
                    if (connection.active) refresh();
                },
                disconnect() {
                    if (!connection.active) return;
                    connection.active = false;
                    connections.delete(connection);
                    if (connections.size === 0) {
                        const stop = unsubscribe;
                        unsubscribe = null;
                        try {
                            stop?.();
                        } catch {
                            /* No transport cancellation. */
                        }
                    }
                },
            };
        },
    };
}
