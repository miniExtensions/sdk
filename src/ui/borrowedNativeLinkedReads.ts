/** An opaque native page. It has no accepted SDK linked-page provenance. */
export type BorrowedNativeLinkedPage<Record, Metadata> = {
    records: readonly Record[];
    metadata: Metadata;
};

/** A host-selected snapshot, including duplicate and unresolved native positions. */
export type BorrowedNativeLinkedSelection<Projection> = {
    nativeValue: readonly string[] | null | undefined;
    rows: readonly { recordId: string; data: Projection }[];
    unresolved: readonly { nativeIndex: number; recordId: string }[];
};

export type BorrowedNativeLinkedReadResult<Page> =
    | { status: 'published'; page: Page }
    | { status: 'retired' };

/**
 * Host-owned read authority, transport and canonical cache publication only.
 * A stamp must cover native instance/field/configuration/privacy/filter changes,
 * including ABA. isCurrent and publishIfCurrent must check authoritative state.
 */
export interface BorrowedNativeLinkedReadPort<
    Record,
    Filter,
    Projection,
    Stamp,
    Metadata,
> {
    readonly source: 'host-native';
    readonly fieldId: string;
    readonly linkedTableId: string;
    capture(): { stamp: Stamp; readable: boolean } | null;
    isCurrent(stamp: Stamp): boolean;
    selected(stamp: Stamp): BorrowedNativeLinkedSelection<Projection>;
    query(
        stamp: Stamp,
        request: { filter: Filter; offset: string | null; signal: AbortSignal }
    ): Promise<BorrowedNativeLinkedPage<Record, Metadata>>;
    hydrateSelected(
        stamp: Stamp,
        signal: AbortSignal
    ): Promise<BorrowedNativeLinkedPage<Record, Metadata>>;
    /** Final synchronous host fence before its cache merge; not an SDK writer. */
    publishIfCurrent(
        stamp: Stamp,
        kind: 'query' | 'selected',
        page: BorrowedNativeLinkedPage<Record, Metadata>
    ): boolean;
    /** Notify relevant read-authority changes; unchanged stamps stay active. */
    subscribe(listener: () => void): () => void;
}

export type BorrowedNativeLinkedReadLease<
    Record,
    Filter,
    Projection,
    Metadata,
> = {
    readonly source: 'host-native';
    isCurrent(): boolean;
    /** Returns the exact borrowed snapshot. Callers must not mutate it. */
    selected(): BorrowedNativeLinkedSelection<Projection> | null;
    query(request: {
        filter: Filter;
        offset: string | null;
        signal?: AbortSignal;
    }): Promise<
        BorrowedNativeLinkedReadResult<
            BorrowedNativeLinkedPage<Record, Metadata>
        >
    >;
    hydrateSelected(
        signal?: AbortSignal
    ): Promise<
        BorrowedNativeLinkedReadResult<
            BorrowedNativeLinkedPage<Record, Metadata>
        >
    >;
    /** Read cancellation only. Never cancels an allocated mutation. */
    retire(): void;
};

export type BorrowedNativeLinkedReadSource<
    Record,
    Filter,
    Projection,
    Metadata,
> = {
    readonly source: 'host-native';
    readonly fieldId: string;
    readonly linkedTableId: string;
    capture(): BorrowedNativeLinkedReadLease<
        Record,
        Filter,
        Projection,
        Metadata
    > | null;
    destroy(): void;
};

/**
 * Coordinate borrowed reads without a client, draft, selection normalization or
 * second cache. Query and hydration each use latest-read-wins within a lease.
 * Current failures retain their original identity; retired reads return retired.
 */
export function createBorrowedNativeLinkedReadSource<
    Record,
    Filter,
    Projection,
    Stamp,
    Metadata,
>(
    port: BorrowedNativeLinkedReadPort<
        Record,
        Filter,
        Projection,
        Stamp,
        Metadata
    >
): BorrowedNativeLinkedReadSource<Record, Filter, Projection, Metadata> {
    if (
        port.source !== 'host-native' ||
        typeof port.fieldId !== 'string' ||
        port.fieldId.trim() === '' ||
        typeof port.linkedTableId !== 'string' ||
        port.linkedTableId.trim() === ''
    )
        throw new TypeError(
            'A borrowed native read source needs a field and table.'
        );
    type Lease = BorrowedNativeLinkedReadLease<
        Record,
        Filter,
        Projection,
        Metadata
    >;
    type Page = BorrowedNativeLinkedPage<Record, Metadata>;
    type Result = BorrowedNativeLinkedReadResult<Page>;
    type Kind = 'query' | 'selected';
    let destroyed = false;
    const leases = new Set<Lease>();
    const unsubscribe = port.subscribe(() => {
        for (const lease of [...leases]) lease.isCurrent();
    });

    function capture(): Lease | null {
        if (destroyed) return null;
        const captured = port.capture();
        if (captured?.readable !== true || destroyed) return null;
        const stamp = captured.stamp;
        let active = true;
        const requests = new Map<Kind, AbortController>();
        const retire = () => {
            if (!active) return;
            active = false;
            leases.delete(lease);
            const pending = [...requests.values()];
            requests.clear();
            for (const controller of pending) controller.abort();
        };
        const current = () => {
            if (!active || destroyed) return false;
            let admitted = false;
            try {
                admitted = port.isCurrent(stamp) === true;
            } catch {
                // A failed freshness check cannot establish read authority.
            }
            if (!admitted || destroyed || !active) {
                retire();
                return false;
            }
            return true;
        };
        const read = async (
            kind: Kind,
            dispatch: (signal: AbortSignal) => Promise<Page>,
            signal?: AbortSignal
        ): Promise<Result> => {
            if (!active || destroyed || signal?.aborted)
                return { status: 'retired' };
            const controller = new AbortController();
            const prior = requests.get(kind);
            // Install before abort notification so a reentrant newer read wins.
            requests.set(kind, controller);
            prior?.abort();
            const abort = () => controller.abort();
            signal?.addEventListener('abort', abort, { once: true });
            const admitted = () =>
                requests.get(kind) === controller &&
                !controller.signal.aborted &&
                !signal?.aborted &&
                current() &&
                requests.get(kind) === controller &&
                !controller.signal.aborted &&
                !signal?.aborted;
            try {
                // Retirement in the initiating turn must precede allocation.
                await Promise.resolve();
                if (!admitted()) return { status: 'retired' };
                const page = await dispatch(controller.signal);
                if (!admitted()) return { status: 'retired' };
                if (port.publishIfCurrent(stamp, kind, page) !== true)
                    return { status: 'retired' };
                // An accepted publication may itself notify a new native revision.
                return { status: 'published', page };
            } catch (error) {
                if (!admitted()) return { status: 'retired' };
                throw error;
            } finally {
                signal?.removeEventListener('abort', abort);
                if (requests.get(kind) === controller) requests.delete(kind);
            }
        };
        const lease: Lease = {
            source: 'host-native',
            isCurrent: current,
            selected() {
                if (!current()) return null;
                const selected = port.selected(stamp);
                return current() ? selected : null;
            },
            query: ({ filter, offset, signal }) =>
                read(
                    'query',
                    (readSignal) =>
                        port.query(stamp, {
                            filter,
                            offset,
                            signal: readSignal,
                        }),
                    signal
                ),
            hydrateSelected: (signal) =>
                read(
                    'selected',
                    (readSignal) => port.hydrateSelected(stamp, readSignal),
                    signal
                ),
            retire,
        };
        if (!current()) return null;
        leases.add(lease);
        return lease;
    }

    return {
        source: 'host-native',
        fieldId: port.fieldId,
        linkedTableId: port.linkedTableId,
        capture,
        destroy() {
            if (destroyed) return;
            destroyed = true;
            try {
                unsubscribe();
            } finally {
                for (const lease of [...leases]) lease.retire();
            }
        },
    };
}
