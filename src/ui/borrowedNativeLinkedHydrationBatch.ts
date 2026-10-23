/** Actual host fields in one native hydration batch; not SDK accepted-page authority. */
export type BorrowedNativeLinkedBatchField = {
    readonly fieldId: string;
    readonly linkedTableId: string;
};

/** Selection is opaque: direct and nested lookup native values are never normalized. */
export type BorrowedNativeLinkedBatchSelection<Selection> =
    | {
          readonly field: BorrowedNativeLinkedBatchField;
          readonly status: 'available';
          readonly selection: Selection;
      }
    | {
          readonly field: BorrowedNativeLinkedBatchField;
          readonly status: 'unavailable';
      };

export type BorrowedNativeLinkedBatchResult<Page> =
    | { status: 'published'; page: Page }
    | { status: 'retired' };

/** The host owns real field/dependency/privacy/cache generations and the final merge. */
export interface BorrowedNativeLinkedBatchPort<Stamp, Selection, Page> {
    readonly source: 'host-native';
    readonly fields: readonly BorrowedNativeLinkedBatchField[];
    capture(): { stamp: Stamp; readable: boolean } | null;
    isCurrent(stamp: Stamp): boolean;
    isFieldReadable(stamp: Stamp, fieldId: string): boolean;
    selected(stamp: Stamp, fieldId: string): Selection;
    hydrateSelected(stamp: Stamp, signal: AbortSignal): Promise<Page>;
    /** Synchronous explicit-true admission and publication; never an SDK writer. */
    publishIfCurrent(stamp: Stamp, page: Page): boolean;
    subscribe(listener: () => void): () => void;
}

export type BorrowedNativeLinkedBatchLease<Selection, Page> = {
    readonly source: 'host-native';
    isCurrent(): boolean;
    selected(): readonly BorrowedNativeLinkedBatchSelection<Selection>[] | null;
    hydrateSelected(
        signal?: AbortSignal
    ): Promise<BorrowedNativeLinkedBatchResult<Page>>;
    retire(): void;
};

export type BorrowedNativeLinkedBatch<Selection, Page> = {
    readonly source: 'host-native';
    readonly fields: readonly BorrowedNativeLinkedBatchField[];
    capture(): BorrowedNativeLinkedBatchLease<Selection, Page> | null;
    destroy(): void;
};

/**
 * Borrow one real native multi-field/lookup hydration request and cache publication.
 * No per-field requests, selection traversal, second cache, client, draft or mutation.
 * The host stamp must include observed ABA, field/dependency/privacy and publication
 * ownership. Current errors and native pages retain their exact identities.
 */
export function createBorrowedNativeLinkedHydrationBatch<
    Stamp,
    Selection,
    Page,
>(
    port: BorrowedNativeLinkedBatchPort<Stamp, Selection, Page>
): BorrowedNativeLinkedBatch<Selection, Page> {
    if (
        port.source !== 'host-native' ||
        !Array.isArray(port.fields) ||
        port.fields.length === 0
    )
        throw new TypeError('A native hydration batch needs its real fields.');
    const fields = Object.freeze(
        Array.from(port.fields, (field) => {
            if (
                field == null ||
                typeof field.fieldId !== 'string' ||
                field.fieldId.trim() === '' ||
                typeof field.linkedTableId !== 'string' ||
                field.linkedTableId.trim() === ''
            )
                throw new TypeError(
                    'A native hydration field needs field and table IDs.'
                );
            return Object.freeze({
                fieldId: field.fieldId,
                linkedTableId: field.linkedTableId,
            });
        })
    );
    if (new Set(fields.map((field) => field.fieldId)).size !== fields.length)
        throw new TypeError(
            'Native hydration fields must have distinct field IDs.'
        );
    const fieldsCurrent = () => {
        const current = port.fields;
        return (
            port.source === 'host-native' &&
            Array.isArray(current) &&
            current.length === fields.length &&
            fields.every(
                (field, index) =>
                    current[index]?.fieldId === field.fieldId &&
                    current[index]?.linkedTableId === field.linkedTableId
            )
        );
    };
    type Lease = BorrowedNativeLinkedBatchLease<Selection, Page>;
    let destroyed = false;
    const leases = new Set<Lease>();
    const unsubscribe = port.subscribe(() => {
        for (const lease of [...leases]) lease.isCurrent();
    });

    function capture(): Lease | null {
        if (destroyed || !fieldsCurrent()) return null;
        const captured = port.capture();
        if (captured?.readable !== true || destroyed) return null;
        const stamp = captured.stamp;
        let active = true;
        let pending: AbortController | null = null;
        const retire = () => {
            if (!active) return;
            active = false;
            leases.delete(lease);
            const previous = pending;
            pending = null;
            previous?.abort();
        };
        const current = () => {
            if (!active || destroyed) return false;
            let admitted = false;
            try {
                admitted =
                    fieldsCurrent() &&
                    port.isCurrent(stamp) === true &&
                    fieldsCurrent();
            } catch {
                /* Failed ownership proof retires admission. */
            }
            if (!admitted || !active || destroyed) {
                retire();
                return false;
            }
            return true;
        };
        const lease: Lease = {
            source: 'host-native',
            isCurrent: current,
            retire,
            selected() {
                if (!current()) return null;
                const result: BorrowedNativeLinkedBatchSelection<Selection>[] =
                    [];
                for (const field of fields) {
                    let readable = false;
                    try {
                        readable =
                            port.isFieldReadable(stamp, field.fieldId) === true;
                    } catch {
                        /* Unproven field readability never admits a native read. */
                    }
                    if (!current()) return null;
                    if (!readable) {
                        result.push({ field, status: 'unavailable' });
                        continue;
                    }
                    const selection = port.selected(stamp, field.fieldId);
                    if (!current()) return null;
                    result.push({ field, status: 'available', selection });
                }
                return Object.freeze(result);
            },
            async hydrateSelected(signal) {
                if (!active || destroyed || signal?.aborted)
                    return { status: 'retired' };
                const controller = new AbortController();
                const previous = pending;
                pending = controller;
                previous?.abort();
                const abort = () => controller.abort();
                signal?.addEventListener('abort', abort, { once: true });
                const admitted = () =>
                    pending === controller &&
                    !controller.signal.aborted &&
                    !signal?.aborted &&
                    current() &&
                    pending === controller &&
                    !controller.signal.aborted &&
                    !signal?.aborted;
                try {
                    // Cleanup/replacement in the initiating turn precedes allocation.
                    await Promise.resolve();
                    if (!admitted()) return { status: 'retired' };
                    const page = await port.hydrateSelected(
                        stamp,
                        controller.signal
                    );
                    if (!admitted()) return { status: 'retired' };
                    if (port.publishIfCurrent(stamp, page) !== true)
                        return { status: 'retired' };
                    // Its own accepted publication may retire the old cache stamp.
                    return { status: 'published', page };
                } catch (error) {
                    if (!admitted()) return { status: 'retired' };
                    throw error;
                } finally {
                    signal?.removeEventListener('abort', abort);
                    if (pending === controller) pending = null;
                }
            },
        };
        if (!current()) return null;
        leases.add(lease);
        return lease;
    }
    return {
        source: 'host-native',
        fields,
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
