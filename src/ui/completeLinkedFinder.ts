import { createSelectionModel } from './model.js';
import type { SelectionModel } from './types.js';

/** Exact host transport page. This is not an accepted SDK linked-record page. */
export type CompleteLinkedFinderPage<Row> = {
    readonly records: readonly Row[];
    readonly offset: string | null;
};

export type CompleteLinkedFinderRequest<Filter> = {
    readonly filter: Filter;
    readonly resetOffset: boolean;
};

export type CompleteLinkedFinderAdmission =
    | { readonly status: 'admitted' }
    | { readonly status: 'refused' };

/**
 * Captured host authority. A cache merge may replace a row without replacing
 * its owner: the host must separately qualify the post-publication identity.
 * No cancellation signal is supplied to an allocated host transport.
 */
export type CompleteLinkedFinderRead<Row> = {
    readonly mode: 'public' | 'authenticated-preview';
    isCurrent(phase: 'before-publication' | 'after-publication'): boolean;
    query(): Promise<CompleteLinkedFinderPage<Row>>;
    publish(page: CompleteLinkedFinderPage<Row>): CompleteLinkedFinderAdmission;
    /** One-time host presentation receipt after accepted model/read publication. */
    didAccept?(page: CompleteLinkedFinderPage<Row>): void;
};

export type CompleteLinkedFinderScheduleAdmission<Owner extends object> =
    | {
          readonly status: 'admitted';
          readonly owner: Owner;
          /** Opaque identity of this scheduled intent, never a page/result. */
          readonly nonce: object;
          isCurrent(): boolean;
      }
    | { readonly status: 'refused' };

export type CompleteLinkedFinderSelection = {
    /** Exact canonical host membership; may contain hidden IDs and duplicates. */
    readonly ids: readonly string[];
    readonly enabled: boolean;
    readonly autoSelectScannedRecord: boolean;
};

export type CompleteLinkedFinderHost<Row, Filter, Owner extends object> = {
    /** Fresh committed opaque owner for every authority replacement, including ABA. */
    captureOwner(): Owner | null;
    isOwnerCurrent(owner: Owner): boolean;
    subscribe(listener: () => void): () => void;
    captureRead(
        owner: Owner,
        request: { readonly filter: Filter; readonly offset: string | null }
    ): CompleteLinkedFinderRead<Row> | null;
    selection(owner: Owner): CompleteLinkedFinderSelection | null;
    recordId(row: Row): string;
    isOptionEnabled(owner: Owner, id: string): boolean;
    /** Reads current canonical membership and applies native add/remove itself. */
    toggle(
        owner: Owner,
        id: string
    ): CompleteLinkedFinderAdmission | Promise<CompleteLinkedFinderAdmission>;
    /** A separately fenced host action; toggle admission never grants close. */
    close(owner: Owner): CompleteLinkedFinderAdmission;
    errorMessage(error: unknown): string;
};

export type CompleteLinkedFinderQueryResult<Row, Owner extends object> =
    | {
          readonly status: 'accepted';
          readonly owner: Owner;
          readonly page: CompleteLinkedFinderPage<Row>;
          readonly preview: boolean;
      }
    | {
          readonly status: 'refused';
          readonly reason: 'unavailable' | 'throttled' | 'publication';
      }
    | { readonly status: 'retired' }
    | { readonly status: 'failure'; readonly error: unknown };

export type CompleteLinkedFinderSnapshot<Row, Owner extends object> = {
    readonly owner: Owner | null;
    /** Opaque latest-read identity for fencing retained presentation callbacks. */
    readonly readIdentity: object | null;
    readonly phase: 'idle' | 'loading' | 'ready' | 'error' | 'retired';
    readonly loadingMore: boolean;
    /** Ordered accepted raw occurrences, never deduplicated for scan authority. */
    readonly rawRecords: readonly Row[];
    readonly selectedIds: readonly string[];
    readonly selectionEnabled: boolean;
    readonly offset: string | null;
    readonly error: string | null;
};

export type CompleteLinkedFinderCoordinator<
    Row,
    Filter,
    Owner extends object,
> = {
    /** Candidate identity projection only; never canonical selected membership. */
    readonly model: Pick<SelectionModel, 'getState' | 'subscribe'>;
    getSnapshot(): CompleteLinkedFinderSnapshot<Row, Owner>;
    subscribe(listener: () => void): () => void;
    queryNow(
        request: CompleteLinkedFinderRequest<Filter>
    ): Promise<CompleteLinkedFinderQueryResult<Row, Owner>>;
    /** Scheduling is intentionally not a direct-query receipt. */
    scheduleSearch(request: CompleteLinkedFinderRequest<Filter>): void;
    /** Synchronous intent admission using the same scheduler and offset cursor. */
    admitScheduledSearch(
        expectedOwner: Owner,
        request: CompleteLinkedFinderRequest<Filter>
    ): CompleteLinkedFinderScheduleAdmission<Owner>;
    toggle(
        expectedOwner: Owner,
        id: string,
        /** Single-link UI preference; close remains a separately fenced host action. */
        behavior?: { readonly closeAfterAddition?: boolean }
    ): Promise<CompleteLinkedFinderAdmission>;
    scan(
        request: CompleteLinkedFinderRequest<Filter>
    ): Promise<
        | { readonly status: 'selected'; readonly id: string }
        | { readonly status: 'unchanged' }
        | { readonly status: 'failure'; readonly error: unknown }
    >;
    destroy(): void;
};

/**
 * Portable candidate coordinator, with no client, hydration, selected-record
 * store, cache, schema authority or transport rollback. The existing borrowed
 * read APIs retain their separate cancellation and lifetime contracts.
 */
export function createCompleteLinkedFinderCoordinator<
    Row,
    Filter,
    Owner extends object,
>(
    host: CompleteLinkedFinderHost<Row, Filter, Owner>,
    options: { readonly testing?: boolean } = {}
): CompleteLinkedFinderCoordinator<Row, Filter, Owner> {
    type Snapshot = CompleteLinkedFinderSnapshot<Row, Owner>;
    type Result = CompleteLinkedFinderQueryResult<Row, Owner>;
    type Ticket = {
        owner: Owner;
        identity: object;
        read: CompleteLinkedFinderRead<Row>;
        append: boolean;
        resetOffset: boolean;
        published: boolean;
        intent: number;
    };
    const model = createSelectionModel({ multiple: true, readOnly: true });
    const listeners = new Set<() => void>();
    const retiredOwners = new WeakSet<Owner>();
    const acceptedReads = new WeakMap<object, Ticket>();
    let owner: Owner | null = null;
    let phase: Snapshot['phase'] = 'idle';
    let loadingMore = false;
    let rawRecords: readonly Row[] = [];
    let offset: string | null = null;
    // Request metadata only. Preview can page without creating a candidate
    // model, exposing raw records or emitting a loading transition.
    let readOffset: string | null = null;
    let error: string | null = null;
    let latest: Ticket | null = null;
    let queued: ReturnType<typeof setTimeout> | null = null;
    let lastPublicAllocation: number | null = null;
    let destroyed = false;
    let intentSequence = 0;
    let ownerRevision = 0;

    function clearQueued() {
        if (queued !== null) clearTimeout(queued);
        queued = null;
    }

    function clearPresentation(nextPhase: Snapshot['phase']) {
        latest = null;
        clearQueued();
        rawRecords = [];
        offset = null;
        readOffset = null;
        phase = nextPhase;
        loadingMore = false;
        error = null;
        model.reset({ multiple: true, readOnly: true });
    }

    function owns(expected: Owner): boolean {
        if (destroyed || owner !== expected || retiredOwners.has(expected))
            return false;
        let admitted = false;
        try {
            admitted = host.isOwnerCurrent(expected);
        } catch {
            // An unreadable host cannot establish authority.
        }
        if (!admitted || destroyed || owner !== expected) {
            retiredOwners.add(expected);
            if (owner === expected) {
                owner = null;
                ownerRevision++;
                clearPresentation('retired');
            }
            return false;
        }
        return true;
    }

    function reconcileOwner(): Owner | null {
        if (destroyed) return null;
        const captureRevision = ownerRevision;
        let next: Owner | null = null;
        try {
            next = host.captureOwner();
        } catch {
            // Capture refusal is not permission to retain a previous owner.
        }
        if (destroyed) return null;
        // A capture callback may itself commit a different owner. Its newer
        // reconciliation must not be retired by the older callback's return.
        if (ownerRevision !== captureRevision)
            return owner && owns(owner) ? owner : null;
        if (next !== owner) {
            if (owner) retiredOwners.add(owner);
            owner = next && !retiredOwners.has(next) ? next : null;
            ownerRevision++;
            lastPublicAllocation = null;
            clearPresentation(owner ? 'idle' : 'retired');
        }
        return owner && owns(owner) ? owner : null;
    }

    function emit() {
        const expected = owner;
        for (const listener of [...listeners]) {
            if (destroyed || owner !== expected) break;
            if (listeners.has(listener)) {
                try {
                    listener();
                } catch {
                    // An observer cannot turn a settled host read into failure.
                }
            }
        }
    }

    function selection(expected: Owner): CompleteLinkedFinderSelection | null {
        if (!owns(expected)) return null;
        try {
            const result = host.selection(expected);
            return owns(expected) ? result : null;
        } catch {
            return null;
        }
    }

    function getSnapshot(): Snapshot {
        const expected = reconcileOwner();
        const selected = expected ? selection(expected) : null;
        const currentOwner = expected && owns(expected) ? expected : null;
        return {
            owner: currentOwner,
            readIdentity: latest?.identity ?? null,
            phase,
            loadingMore,
            rawRecords,
            selectedIds: currentOwner ? (selected?.ids ?? []) : [],
            selectionEnabled: currentOwner
                ? (selected?.enabled ?? false)
                : false,
            offset,
            error,
        };
    }

    function current(ticket: Ticket): boolean {
        if (
            latest !== ticket ||
            ticket.intent !== intentSequence ||
            !owns(ticket.owner)
        )
            return false;
        let valid = false;
        try {
            valid = ticket.read.isCurrent(
                ticket.published ? 'after-publication' : 'before-publication'
            );
        } catch {
            // A failed read fence cannot qualify data or error publication.
        }
        if (!valid && latest === ticket) {
            if (ticket.read.mode === 'authenticated-preview') latest = null;
            else {
                clearPresentation('retired');
                emit();
            }
        }
        return (
            valid &&
            latest === ticket &&
            ticket.intent === intentSequence &&
            owns(ticket.owner) &&
            ticket.intent === intentSequence
        );
    }

    function prepare(
        request: CompleteLinkedFinderRequest<Filter>,
        intent: number,
        requestedOwner?: Owner
    ): Ticket | Result {
        const expected = reconcileOwner();
        if (intent !== intentSequence) return { status: 'retired' };
        if (!expected) return { status: 'refused', reason: 'unavailable' };
        if (requestedOwner !== undefined && requestedOwner !== expected)
            return { status: 'refused', reason: 'unavailable' };
        try {
            const read = host.captureRead(expected, {
                filter: request.filter,
                offset: request.resetOffset ? null : readOffset,
            });
            if (intent !== intentSequence) return { status: 'retired' };
            if (!read) return { status: 'refused', reason: 'unavailable' };
            const ownerCurrent = owns(expected);
            if (intent !== intentSequence) return { status: 'retired' };
            if (!ownerCurrent)
                return { status: 'refused', reason: 'unavailable' };
            const ticket = {
                owner: expected,
                identity: Object.freeze({}),
                read,
                append: !request.resetOffset && readOffset !== null,
                resetOffset: request.resetOffset,
                published: false,
                intent,
            };
            const valid =
                read.isCurrent('before-publication') && owns(expected);
            if (intent !== intentSequence) return { status: 'retired' };
            if (!valid) return { status: 'refused', reason: 'unavailable' };
            if (intent !== intentSequence) return { status: 'retired' };
            return ticket;
        } catch (cause) {
            return intent === intentSequence &&
                owns(expected) &&
                intent === intentSequence
                ? { status: 'failure', error: cause }
                : { status: 'retired' };
        }
    }

    function nextIntent() {
        const intent = ++intentSequence;
        // A newer attempted request retires the previous allocation/publication
        // rights even if its own host preparation refuses or throws.
        clearQueued();
        latest = null;
        if (phase === 'loading') {
            phase = rawRecords.length ? 'ready' : 'idle';
            loadingMore = false;
        }
        return intent;
    }

    function presentError(cause: unknown): string {
        try {
            return host.errorMessage(cause);
        } catch {
            return 'Unable to load linked records. Please try again.';
        }
    }

    function start(ticket: Ticket): boolean {
        if (ticket.intent !== intentSequence || !owns(ticket.owner))
            return false;
        if (ticket.intent !== intentSequence) return false;
        clearQueued();
        latest = ticket;
        if (ticket.read.mode !== 'authenticated-preview') {
            phase = 'loading';
            loadingMore = ticket.append;
            error = null;
            emit();
        }
        return current(ticket);
    }

    async function execute(ticket: Ticket): Promise<Result> {
        try {
            if (!current(ticket)) return { status: 'retired' };
            if (ticket.read.mode === 'public') {
                const now = Date.now();
                if (
                    !options.testing &&
                    !ticket.resetOffset &&
                    lastPublicAllocation !== null &&
                    lastPublicAllocation > now - 1000
                ) {
                    phase = rawRecords.length ? 'ready' : 'idle';
                    loadingMore = false;
                    emit();
                    return current(ticket)
                        ? { status: 'refused', reason: 'throttled' }
                        : { status: 'retired' };
                }
            }
            // Retirement before allocation must not start host work. Once
            // allocated, supersession/destroy never aborts that transport.
            if (!current(ticket)) return { status: 'retired' };
            if (ticket.read.mode === 'public')
                lastPublicAllocation = Date.now();
            const page = await ticket.read.query();
            if (!current(ticket)) return { status: 'retired' };
            const publication = ticket.read.publish(page);
            ticket.published = true;
            if (!current(ticket)) return { status: 'retired' };
            if (publication.status !== 'admitted') {
                if (ticket.read.mode !== 'authenticated-preview') {
                    phase = rawRecords.length ? 'ready' : 'idle';
                    loadingMore = false;
                    emit();
                }
                return current(ticket)
                    ? { status: 'refused', reason: 'publication' }
                    : { status: 'retired' };
            }
            const preview = ticket.read.mode === 'authenticated-preview';
            const pageOffset = page.offset;
            if (!current(ticket)) return { status: 'retired' };
            if (preview) readOffset = pageOffset;
            if (!preview) {
                const next = ticket.append
                    ? [...rawRecords, ...page.records]
                    : page.records;
                // Identity only. Labels/cards are separate admitted host
                // projections; never recover hidden labels from raw records.
                const projected = next.map((row) => ({
                    value: host.recordId(row),
                    label: '',
                }));
                if (!current(ticket)) return { status: 'retired' };
                rawRecords = next;
                offset = pageOffset;
                readOffset = pageOffset;
                phase = 'ready';
                loadingMore = false;
                error = null;
                model.reset({
                    multiple: true,
                    readOnly: true,
                    options: projected,
                });
                if (!current(ticket)) return { status: 'retired' };
                emit();
            }
            // Cache/model/local publication may synchronously replace owner or
            // allocate a later read. Only this exact still-current page wins.
            if (!current(ticket)) return { status: 'retired' };
            const result: Result = {
                status: 'accepted',
                owner: ticket.owner,
                page,
                preview,
            };
            acceptedReads.set(result, ticket);
            ticket.read.didAccept?.(page);
            if (!current(ticket)) return { status: 'retired' };
            return result;
        } catch (cause) {
            let live = false;
            try {
                live = current(ticket);
            } catch {
                // A failed identity predicate cannot qualify a failure either.
            }
            if (!live) return { status: 'retired' };
            if (ticket.read.mode !== 'authenticated-preview') {
                const message = presentError(cause);
                if (!current(ticket)) return { status: 'retired' };
                error = message;
                phase = 'error';
                loadingMore = false;
                emit();
            }
            return current(ticket)
                ? { status: 'failure', error: cause }
                : { status: 'retired' };
        }
    }

    async function queryNow(
        request: CompleteLinkedFinderRequest<Filter>
    ): Promise<Result> {
        const intent = nextIntent();
        const ticket = prepare(request, intent);
        if ('status' in ticket) {
            if (intent === intentSequence) emit();
            return ticket;
        }
        if (!start(ticket)) return { status: 'retired' };
        return execute(ticket);
    }

    function schedule(
        request: CompleteLinkedFinderRequest<Filter>,
        requestedOwner?: Owner
    ): Ticket | null {
        const entryIntent = intentSequence;
        if (requestedOwner !== undefined && !owns(requestedOwner)) return null;
        if (entryIntent !== intentSequence) return null;
        const intent = nextIntent();
        const ticket = prepare(request, intent, requestedOwner);
        if ('status' in ticket) {
            if (intent === intentSequence) emit();
            return null;
        }
        if (!start(ticket)) return null;
        if (ticket.read.mode === 'authenticated-preview') {
            void execute(ticket);
            return current(ticket) ? ticket : null;
        }
        queued = setTimeout(
            () => {
                queued = null;
                void execute(ticket);
            },
            options.testing ? 10 : 800
        );
        return current(ticket) ? ticket : null;
    }
    function scheduleSearch(
        request: CompleteLinkedFinderRequest<Filter>
    ): void {
        schedule(request);
    }
    function admitScheduledSearch(
        expectedOwner: Owner,
        request: CompleteLinkedFinderRequest<Filter>
    ): CompleteLinkedFinderScheduleAdmission<Owner> {
        const ticket = schedule(request, expectedOwner);
        return ticket
            ? {
                  status: 'admitted',
                  owner: expectedOwner,
                  nonce: Object.freeze({}),
                  isCurrent: () => current(ticket),
              }
            : { status: 'refused' };
    }

    async function toggle(
        expected: Owner,
        id: string,
        behavior?: { readonly closeAfterAddition?: boolean }
    ): Promise<CompleteLinkedFinderAdmission> {
        const intent = intentSequence;
        const selected = selection(expected);
        if (!selected?.enabled || !owns(expected)) return { status: 'refused' };
        const wasSelected = selected.ids.includes(id);
        const result = await host.toggle(expected, id);
        if (
            result.status === 'admitted' &&
            behavior?.closeAfterAddition &&
            !wasSelected
        ) {
            const sameIntent = () =>
                intent === intentSequence &&
                owns(expected) &&
                intent === intentSequence;
            try {
                // The admitted write can advance its read's selected-value
                // stamp. Close instead retains the captured search intent and
                // owner, including reentrant host selection/publication calls.
                if (
                    sameIntent() &&
                    selection(expected)?.ids.includes(id) &&
                    sameIntent()
                )
                    host.close(expected);
            } catch {
                // Close refusal/failure does not undo an admitted toggle.
            }
        }
        return result;
    }

    async function scan(request: CompleteLinkedFinderRequest<Filter>) {
        const result = await queryNow(request);
        if (result.status === 'failure') return result;
        if (result.status !== 'accepted' || result.preview)
            return { status: 'unchanged' } as const;
        const ticket = acceptedReads.get(result);
        const expected = result.owner;
        if (!ticket || !current(ticket) || result.page.records.length !== 1)
            return { status: 'unchanged' } as const;
        try {
            const id = host.recordId(result.page.records[0]);
            const selected = selection(expected);
            if (
                !selected?.enabled ||
                !selected.autoSelectScannedRecord ||
                selected.ids.includes(id) ||
                !host.isOptionEnabled(expected, id) ||
                !current(ticket)
            )
                return { status: 'unchanged' } as const;
            const toggled = await host.toggle(expected, id);
            // An admitted canonical toggle can advance the selected-value
            // stamp of the consumed read. Close has independent owner authority;
            // preserve latest-search and owner fences without treating our own
            // admitted write as a replacement finder context.
            if (
                toggled.status !== 'admitted' ||
                latest !== ticket ||
                !owns(expected) ||
                latest !== ticket ||
                ticket.intent !== intentSequence
            )
                return { status: 'unchanged' } as const;
            const closed = host.close(expected);
            return closed.status === 'admitted'
                ? ({ status: 'selected', id } as const)
                : ({ status: 'unchanged' } as const);
        } catch (cause) {
            return { status: 'failure', error: cause } as const;
        }
    }

    const unsubscribe = host.subscribe(() => {
        reconcileOwner();
        emit();
    });
    reconcileOwner();
    return {
        model: {
            getState() {
                reconcileOwner();
                return model.getState();
            },
            subscribe(listener) {
                reconcileOwner();
                return model.subscribe(listener);
            },
        },
        getSnapshot,
        subscribe(listener) {
            if (destroyed) return () => {};
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        queryNow,
        scheduleSearch,
        admitScheduledSearch,
        toggle,
        scan,
        destroy() {
            if (destroyed) return;
            destroyed = true;
            if (owner) retiredOwners.add(owner);
            owner = null;
            clearPresentation('retired');
            unsubscribe();
            model.destroy();
            listeners.clear();
        },
    };
}
