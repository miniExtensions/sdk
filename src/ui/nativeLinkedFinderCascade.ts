import type { CompleteLinkedFinderAdmission } from './completeLinkedFinder.js';

export type NativeLinkedFinderCascadeValue = {
    readonly recordId: string;
    readonly stringValue: string;
};

/** Native router input is forwarded without string/array/empty normalization. */
export type NativeLinkedFinderCascadeUrlValue =
    | string
    | readonly string[]
    | null
    | undefined;

export type NativeLinkedFinderCascadeQuery = {
    readonly fieldId: string;
    readonly searchTerm: NativeLinkedFinderCascadeUrlValue;
    readonly urlSearchValue: NativeLinkedFinderCascadeUrlValue;
    readonly filterData: {
        readonly previousFilterFieldId: string;
        readonly previousFilterPrimaryValue: string;
    } | null;
};

export type NativeLinkedFinderCascadePage = {
    readonly primaryValues: readonly NativeLinkedFinderCascadeValue[];
    readonly prefillValue: NativeLinkedFinderCascadeValue | null;
};

export type NativeLinkedFinderCascadeHost<Owner extends object> = {
    isCurrent(owner: Owner): boolean;
    captureRead(
        owner: Owner,
        query: NativeLinkedFinderCascadeQuery
    ): {
        isCurrent(phase: 'before-publication' | 'after-publication'): boolean;
        query(): Promise<NativeLinkedFinderCascadePage>;
    } | null;
    /** Canonical driver pairs and native Save remain entirely host-owned. */
    publish(
        owner: Owner,
        fieldId: string,
        value: NativeLinkedFinderCascadeValue | null
    ): CompleteLinkedFinderAdmission;
    clear(owner: Owner, fieldId: string): CompleteLinkedFinderAdmission;
    setPrefillLoading(owner: Owner, fieldId: string, loading: boolean): void;
    reportOrdinaryError(error: unknown): void;
    errorMessage(error: unknown): string;
};

export type NativeLinkedFinderCascadeSnapshot = {
    readonly status: 'idle' | 'fetching-prefill' | 'loading' | 'retired';
    readonly options: readonly NativeLinkedFinderCascadeValue[];
    readonly error: string | undefined;
    /** Pending producer identity is separate from the native visual status. */
    readonly pending: readonly {
        readonly id: number;
        readonly kind: 'prefill' | 'ordinary';
    }[];
};

export type NativeLinkedFinderCascadeResult =
    | { readonly status: 'published' }
    | { readonly status: 'refused' | 'retired' }
    | { readonly status: 'failure'; readonly error: unknown };

export type NativeLinkedFinderCascadeDriver = {
    getSnapshot(): NativeLinkedFinderCascadeSnapshot;
    subscribe(listener: () => void): () => void;
    setUrlSearchValue(value: NativeLinkedFinderCascadeUrlValue): void;
    setPredecessor(
        fieldId: string | null,
        value: NativeLinkedFinderCascadeValue | null | undefined
    ): void;
    /** Mount/change effect; depends only on the predecessor's string value. */
    predecessorChanged(): void;
    /** Independent mount producer. Current failure rejects without visual cleanup. */
    prefillNow(): Promise<NativeLinkedFinderCascadeResult>;
    ordinaryNow(searchTerm: string): Promise<NativeLinkedFinderCascadeResult>;
    search(searchTerm: string): void;
    open(): void;
    choose(
        value: NativeLinkedFinderCascadeValue | null
    ): CompleteLinkedFinderAdmission;
    destroy(): void;
};

/**
 * Explicit native-compatible recipe, separate from createFormLinkedFilterModel.
 * It retains independent producers, arrival-order ordinary publication, retained
 * ordinary errors and the prefill rejection path. It owns no canonical driver
 * map, linked IDs, cache, transport cancellation or Save policy.
 */
export function createNativeLinkedFinderCascadeDriver<
    Owner extends object,
>(args: {
    owner: Owner;
    fieldId: string;
    previousFieldId: string | null;
    previousValue: NativeLinkedFinderCascadeValue | null | undefined;
    urlSearchValue: NativeLinkedFinderCascadeUrlValue;
    host: NativeLinkedFinderCascadeHost<Owner>;
    testing?: boolean;
}): NativeLinkedFinderCascadeDriver {
    const { owner, host, fieldId } = args;
    let active = true;
    let status: NativeLinkedFinderCascadeSnapshot['status'] =
        args.urlSearchValue ? 'fetching-prefill' : 'idle';
    let options: readonly NativeLinkedFinderCascadeValue[] = [];
    let error: string | undefined;
    let urlSearchValue = args.urlSearchValue;
    let previousFieldId = args.previousFieldId;
    let previousValue = args.previousValue;
    let observedPredecessor = false;
    let previousString: string | undefined;
    let queued: ReturnType<typeof setTimeout> | null = null;
    let queuedSequence = 0;
    let sequence = 0;
    const pending = new Map<number, 'prefill' | 'ordinary'>();
    const listeners = new Set<() => void>();
    const clearQueued = () => {
        queuedSequence++;
        if (queued !== null) clearTimeout(queued);
        queued = null;
    };
    const current = () => {
        if (!active) return false;
        let valid = false;
        try {
            valid = host.isCurrent(owner);
        } catch {
            // Unknown authority is retired, including an unobserved ABA.
        }
        if (!valid) {
            active = false;
            status = 'retired';
            options = [];
            error = undefined;
            clearQueued();
        }
        return active;
    };
    const emit = () => {
        for (const listener of [...listeners]) {
            if (!current()) break;
            if (listeners.has(listener)) {
                try {
                    listener();
                } catch {
                    // Observers cannot change a host producer's settlement.
                }
            }
        }
    };
    const filterData = () =>
        previousFieldId !== null && previousValue != null
            ? {
                  previousFilterFieldId: previousFieldId,
                  previousFilterPrimaryValue: previousValue.stringValue,
              }
            : null;
    const makeQuery = (
        searchTerm: NativeLinkedFinderCascadeUrlValue
    ): NativeLinkedFinderCascadeQuery => ({
        fieldId,
        searchTerm,
        urlSearchValue,
        filterData: filterData(),
    });
    const capture = (
        query: NativeLinkedFinderCascadeQuery,
        kind: 'prefill' | 'ordinary'
    ) => {
        if (!current()) return null;
        const read = host.captureRead(owner, query);
        if (!read || !current()) return null;
        const id = ++sequence;
        let published = false;
        const live = () => {
            if (!current()) return false;
            try {
                return (
                    read.isCurrent(
                        published ? 'after-publication' : 'before-publication'
                    ) && current()
                );
            } catch {
                return false;
            }
        };
        if (!live()) return null;
        pending.set(id, kind);
        return {
            id,
            read,
            live,
            published: () => {
                published = true;
            },
        };
    };

    async function ordinaryQueryNow(
        query: NativeLinkedFinderCascadeQuery
    ): Promise<NativeLinkedFinderCascadeResult> {
        if (!current()) return { status: 'retired' };
        status = 'loading';
        options = [];
        emit();
        let ticket: ReturnType<typeof capture> = null;
        let outcome: NativeLinkedFinderCascadeResult = { status: 'retired' };
        try {
            ticket = capture(query, 'ordinary');
            if (!ticket)
                outcome = { status: current() ? 'refused' : 'retired' };
            else {
                emit();
                if (ticket.live()) {
                    const result = await ticket.read.query();
                    if (ticket.live()) {
                        // Preserve arrival order, not latest-allocation order.
                        options = result.primaryValues;
                        ticket.published();
                        outcome = { status: 'published' };
                    }
                }
            }
        } catch (cause) {
            const live = () => (ticket ? ticket.live() : current());
            if (live()) {
                host.reportOrdinaryError(cause);
                if (live()) {
                    const message = host.errorMessage(cause);
                    if (live()) {
                        error = message;
                        outcome = { status: 'failure', error: cause };
                    }
                }
            }
        } finally {
            if (ticket) pending.delete(ticket.id);
            // Native ordinary completion idles even while another producer is
            // pending. Read fences qualify data/errors; owner fences settle UI.
            if (current()) {
                status = 'idle';
                emit();
            }
        }
        return (ticket ? ticket.live() : current())
            ? outcome
            : { status: 'retired' };
    }

    function ordinaryNow(searchTerm: string) {
        return ordinaryQueryNow(makeQuery(searchTerm));
    }

    async function prefillNow(): Promise<NativeLinkedFinderCascadeResult> {
        if (!current()) return { status: 'retired' };
        if (urlSearchValue == null) return { status: 'refused' };
        const query = makeQuery(urlSearchValue);
        host.setPrefillLoading(owner, fieldId, true);
        const ticket = capture(query, 'prefill');
        if (!ticket) return { status: current() ? 'refused' : 'retired' };
        let outcome: NativeLinkedFinderCascadeResult = { status: 'retired' };
        try {
            emit();
            if (ticket.live()) {
                const result = await ticket.read.query();
                if (ticket.live()) {
                    const admission = result.prefillValue
                        ? host.publish(owner, fieldId, result.prefillValue)
                        : host.clear(owner, fieldId);
                    ticket.published();
                    if (ticket.live()) {
                        if (admission.status !== 'admitted')
                            outcome = { status: 'refused' };
                        else {
                            host.setPrefillLoading(owner, fieldId, false);
                            if (ticket.live()) {
                                status = 'idle';
                                outcome = { status: 'published' };
                            }
                        }
                    }
                }
            }
        } catch (cause) {
            if (!ticket.live()) return { status: 'retired' };
            throw cause;
        } finally {
            // Track allocation separately; do not add prefill error UI, clear
            // the host loading flag, or impose success-reset error policy.
            pending.delete(ticket.id);
            if (current()) emit();
        }
        return ticket.live() ? outcome : { status: 'retired' };
    }

    function enqueue(
        query: NativeLinkedFinderCascadeQuery,
        immediateLoading: boolean,
        intent: number
    ) {
        if (immediateLoading) {
            status = 'loading';
            emit();
        }
        if (!current() || queuedSequence !== intent) return;
        queued = setTimeout(
            () => {
                queued = null;
                if (queuedSequence === intent) void ordinaryQueryNow(query);
            },
            args.testing ? 10 : 800
        );
    }

    function schedule(searchTerm: string, immediateLoading: boolean) {
        if (!current()) return;
        clearQueued();
        const intent = queuedSequence;
        enqueue(makeQuery(searchTerm), immediateLoading, intent);
    }

    return {
        getSnapshot() {
            current();
            return {
                status,
                options,
                error,
                pending: [...pending].map(([id, kind]) => ({ id, kind })),
            };
        },
        subscribe(listener) {
            if (!active) return () => {};
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        setUrlSearchValue(value) {
            if (urlSearchValue !== value) clearQueued();
            urlSearchValue = value;
        },
        setPredecessor(field, value) {
            previousFieldId = field;
            previousValue = value;
        },
        predecessorChanged() {
            if (!current()) return;
            const next = filterData()?.previousFilterPrimaryValue;
            if (observedPredecessor && next === previousString) return;
            observedPredecessor = true;
            previousString = next;
            clearQueued();
            const intent = queuedSequence;
            const query = makeQuery('');
            if (urlSearchValue == null) {
                host.clear(owner, fieldId);
                if (!current() || queuedSequence !== intent) return;
            }
            enqueue(query, false, intent);
        },
        prefillNow,
        ordinaryNow,
        search: (term) => schedule(term, true),
        open() {
            if (
                current() &&
                status !== 'fetching-prefill' &&
                options.length === 0
            )
                void ordinaryNow('');
        },
        choose(value) {
            if (!current() || status === 'fetching-prefill')
                return { status: 'refused' };
            return host.publish(owner, fieldId, value);
        },
        destroy() {
            active = false;
            status = 'retired';
            options = [];
            error = undefined;
            clearQueued();
            listeners.clear();
        },
    };
}
