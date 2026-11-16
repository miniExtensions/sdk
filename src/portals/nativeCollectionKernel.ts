/**
 * Native-compatible transitions, with no transport, subscriptions or stored collection.
 * The host owns the one canonical snapshot and commits each returned plan atomically.
 */
export interface NativePortalCollectionScope {
    readonly sessionId: string;
    readonly fieldId: string;
    readonly linkedTableId: string;
    /** Observed token/config/field/query identity; observe every change, including ABA. */
    readonly bindingKey: string;
    readonly fetchOwnerKey: string;
    /** Reset/replacement identity, never a benign cache-enrichment counter. */
    readonly cacheOwnerEpoch: number;
}

export interface NativePortalCollectionPaging {
    readonly type: 'notLoaded' | 'loading' | 'loaded' | 'failed';
    readonly recordIds: readonly string[];
    readonly nextOffset: string | null;
    readonly isPaginating: boolean;
    readonly isReloading: boolean;
    readonly acceptedFetchOwnerKey?: string;
    readonly errorMessage?: string;
}

export interface NativePortalCollectionReadReceipt {
    readonly requestId: string;
    readonly scope: NativePortalCollectionScope;
    readonly generation: number;
    readonly mode: 'replace' | 'append';
    readonly parentFrameId: string | null;
    readonly cursor: string | null;
    readonly retainNextOnFailure: boolean;
}

export interface NativePortalCollectionCleanupReceipt {
    readonly read: NativePortalCollectionReadReceipt;
    readonly scope: NativePortalCollectionScope;
    readonly generation: number;
}

export interface NativePortalCollectionFrame<Row, Schema, Detail> {
    readonly id: string;
    readonly linkedTableId: string;
    readonly recordIds: readonly string[];
    readonly records: readonly Row[];
    readonly schema: readonly Schema[];
    readonly details: {
        readonly presence: 'missing' | 'null' | 'present';
        readonly fields: readonly Detail[];
    };
    readonly primary: Detail | null;
    readonly nextOffset: string | null;
}

export interface NativePortalCollectionState<Row, Schema, Detail> {
    readonly scope: NativePortalCollectionScope;
    readonly generation: number;
    readonly active: NativePortalCollectionReadReceipt | null;
    readonly cleanup: NativePortalCollectionCleanupReceipt | null;
    readonly paging: NativePortalCollectionPaging;
    readonly frame: NativePortalCollectionFrame<Row, Schema, Detail> | null;
    readonly disposed: boolean;
}

/** Qualified by native authorization from this response alone, never global cache. */
export interface NativePortalCollectionResponse<
    Row,
    Schema,
    Detail,
    Projection,
> {
    readonly recordIds: readonly string[];
    readonly recordsById: Readonly<Record<string, Row | undefined>>;
    readonly schema: readonly Schema[] | null;
    readonly linkedTableId: string;
    readonly details: NativePortalCollectionFrame<
        Row,
        Schema,
        Detail
    >['details'];
    readonly primary: Detail | null;
    readonly nextOffset: string | null;
    /** Response-only cache/detail effects; the host applies them in the same commit. */
    readonly projection: Projection;
    /** Authorized response metadata echo after the host applies detail projections. */
    readonly scopeAfter?: NativePortalCollectionScope;
}

export interface NativePortalCollectionBegin {
    readonly requestId: string;
    readonly mode: 'first' | 'next' | 'reload';
    readonly onlyIfNotFetched?: boolean;
    readonly retainNextOnFailure?: boolean;
}

export interface NativePortalCollectionTransition<
    Row,
    Schema,
    Detail,
    Projection,
> {
    readonly state: NativePortalCollectionState<Row, Schema, Detail>;
    readonly compatibility?: {
        readonly mode: 'replace' | 'append';
        readonly recordIds: readonly string[];
        readonly nextOffset: string | null;
        readonly projection: Projection;
    };
    readonly cleanup?: {
        readonly receipt: NativePortalCollectionCleanupReceipt;
        readonly kind: 'sort' | 'filter';
        readonly criteria: unknown;
    };
}

export interface NativePortalCollectionKernel<Row, Schema, Detail, Projection> {
    createState(
        scope: NativePortalCollectionScope
    ): NativePortalCollectionState<Row, Schema, Detail>;
    observe(
        state: NativePortalCollectionState<Row, Schema, Detail>,
        scope: NativePortalCollectionScope,
        options?: {
            readonly idsOnly?: boolean;
            readonly paging?: NativePortalCollectionPaging;
        }
    ): NativePortalCollectionState<Row, Schema, Detail>;
    begin(
        state: NativePortalCollectionState<Row, Schema, Detail>,
        input: NativePortalCollectionBegin
    ): {
        readonly state: NativePortalCollectionState<Row, Schema, Detail>;
        readonly receipt: NativePortalCollectionReadReceipt;
        readonly plan: {
            readonly mode: 'first' | 'next' | 'reload';
            readonly cursor: string | null;
            readonly parentFrameId: string | null;
        };
    } | null;
    isCurrent(
        state: NativePortalCollectionState<Row, Schema, Detail>,
        receipt: NativePortalCollectionReadReceipt
    ): boolean;
    succeed(
        state: NativePortalCollectionState<Row, Schema, Detail>,
        receipt: NativePortalCollectionReadReceipt,
        response: NativePortalCollectionResponse<
            Row,
            Schema,
            Detail,
            Projection
        >
    ): NativePortalCollectionTransition<Row, Schema, Detail, Projection> | null;
    fail(
        state: NativePortalCollectionState<Row, Schema, Detail>,
        receipt: NativePortalCollectionReadReceipt,
        message: string
    ): NativePortalCollectionTransition<Row, Schema, Detail, Projection> | null;
    cleanup(
        state: NativePortalCollectionState<Row, Schema, Detail>,
        receipt: NativePortalCollectionReadReceipt,
        kind: 'sort' | 'filter',
        criteria: unknown,
        scopeAfter?: NativePortalCollectionScope
    ): NativePortalCollectionTransition<Row, Schema, Detail, Projection> | null;
    isCleanupCurrent(
        state: NativePortalCollectionState<Row, Schema, Detail>,
        receipt: NativePortalCollectionCleanupReceipt
    ): boolean;
    completeCleanup(
        state: NativePortalCollectionState<Row, Schema, Detail>,
        receipt: NativePortalCollectionCleanupReceipt
    ): {
        readonly state: NativePortalCollectionState<Row, Schema, Detail>;
        readonly read: {
            readonly mode: 'first';
            readonly onlyIfNotFetched: false;
        };
    } | null;
    retire(
        state: NativePortalCollectionState<Row, Schema, Detail>
    ): NativePortalCollectionState<Row, Schema, Detail>;
}

function freeze<T>(value: T, seen = new WeakSet<object>()): T {
    if (value !== null && typeof value === 'object' && !seen.has(value)) {
        seen.add(value);
        for (const child of Object.values(value)) freeze(child, seen);
        Object.freeze(value);
    }
    return value;
}
function detached<T>(value: T): T {
    const ancestors = new WeakSet<object>();
    const check = (item: unknown): void => {
        if (
            typeof item === 'function' ||
            typeof item === 'symbol' ||
            typeof item === 'bigint'
        )
            throw new TypeError('Portal response must contain plain data');
        if (item === null || typeof item !== 'object') return;
        if (
            ancestors.has(item) ||
            (!Array.isArray(item) &&
                Object.getPrototypeOf(item) !== Object.prototype &&
                Object.getPrototypeOf(item) !== null)
        )
            throw new TypeError(
                'Portal response must contain acyclic plain data'
            );
        ancestors.add(item);
        for (const child of Object.values(item)) check(child);
        ancestors.delete(item);
    };
    check(value);
    return freeze(structuredClone(value));
}
function sameScope(
    a: NativePortalCollectionScope,
    b: NativePortalCollectionScope
): boolean {
    return (
        a.sessionId === b.sessionId &&
        a.fieldId === b.fieldId &&
        a.linkedTableId === b.linkedTableId &&
        a.bindingKey === b.bindingKey &&
        a.fetchOwnerKey === b.fetchOwnerKey &&
        a.cacheOwnerEpoch === b.cacheOwnerEpoch
    );
}
function metadataEcho(
    a: NativePortalCollectionScope,
    b: NativePortalCollectionScope
): boolean {
    return sameScope({ ...a, bindingKey: b.bindingKey }, b);
}

/**
 * Receipt capabilities are instance-local WeakSets, not a cache or canonical store.
 * Cloning/serializing a receipt loses issuance authority. The host must still verify
 * current authorization and commit against its actual current snapshot.
 */
export function createNativePortalCollectionKernel<
    Row extends { readonly id: string },
    Schema,
    Detail,
    Projection = unknown,
>(): NativePortalCollectionKernel<Row, Schema, Detail, Projection> {
    type State = NativePortalCollectionState<Row, Schema, Detail>;
    const reads = new WeakSet<NativePortalCollectionReadReceipt>();
    const cleanups = new WeakSet<NativePortalCollectionCleanupReceipt>();
    const emptyPaging = (): NativePortalCollectionPaging => ({
        type: 'notLoaded',
        recordIds: [],
        nextOffset: null,
        isPaginating: false,
        isReloading: false,
    });
    const isCurrent = (
        state: State,
        receipt: NativePortalCollectionReadReceipt
    ): boolean => {
        if (
            state.disposed ||
            !reads.has(receipt) ||
            state.active !== receipt ||
            state.generation !== receipt.generation ||
            !sameScope(state.scope, receipt.scope)
        )
            return false;
        return (
            receipt.mode !== 'append' ||
            (receipt.cursor !== null &&
                (receipt.parentFrameId !== null
                    ? state.frame?.id === receipt.parentFrameId &&
                      state.frame.nextOffset === receipt.cursor
                    : state.frame === null &&
                      state.paging.type === 'loaded' &&
                      state.paging.nextOffset === receipt.cursor))
        );
    };
    const isCleanupCurrent = (
        state: State,
        receipt: NativePortalCollectionCleanupReceipt
    ): boolean =>
        !state.disposed &&
        cleanups.has(receipt) &&
        state.cleanup === receipt &&
        state.generation === receipt.generation &&
        sameScope(state.scope, receipt.scope);
    const increment = (generation: number): number => {
        if (!Number.isSafeInteger(generation + 1))
            throw new RangeError('Portal collection generation exhausted');
        return generation + 1;
    };
    const kernel: NativePortalCollectionKernel<
        Row,
        Schema,
        Detail,
        Projection
    > = {
        createState(scope) {
            if (
                !Number.isSafeInteger(scope.cacheOwnerEpoch) ||
                scope.cacheOwnerEpoch < 0
            )
                throw new RangeError('Invalid Portal cache owner epoch');
            return freeze({
                scope: detached(scope),
                generation: 0,
                active: null,
                cleanup: null,
                paging: emptyPaging(),
                frame: null,
                disposed: false,
            });
        },
        observe(state, scope, options = {}) {
            if (
                state.disposed ||
                (sameScope(state.scope, scope) &&
                    !options.idsOnly &&
                    !options.paging)
            )
                return state;
            if (
                !Number.isSafeInteger(scope.cacheOwnerEpoch) ||
                scope.cacheOwnerEpoch < 0
            )
                throw new RangeError('Invalid Portal cache owner epoch');
            let paging = options.paging
                ? detached(options.paging)
                : state.paging;
            if (
                state.scope.sessionId !== scope.sessionId ||
                state.scope.fieldId !== scope.fieldId ||
                state.scope.linkedTableId !== scope.linkedTableId ||
                state.scope.fetchOwnerKey !== scope.fetchOwnerKey ||
                state.scope.cacheOwnerEpoch !== scope.cacheOwnerEpoch
            ) {
                const { acceptedFetchOwnerKey: _previousOwner, ...unowned } =
                    paging;
                paging = unowned;
            }
            return freeze({
                ...state,
                scope: detached(scope),
                generation: increment(state.generation),
                active: null,
                cleanup: null,
                frame: null,
                paging,
            });
        },
        begin(state, input) {
            if (state.disposed) return null;
            const loaded = state.paging.type === 'loaded';
            const fetched =
                state.paging.acceptedFetchOwnerKey ===
                state.scope.fetchOwnerKey;
            if (
                input.mode === 'first' &&
                input.onlyIfNotFetched &&
                ((loaded && fetched) ||
                    (state.active?.mode === 'replace' &&
                        isCurrent(state, state.active)))
            )
                return null;
            const mode =
                loaded &&
                !fetched &&
                (input.mode === 'next' ||
                    (input.mode === 'first' && input.onlyIfNotFetched))
                    ? 'reload'
                    : input.mode;
            const cursor =
                loaded && mode === 'next' ? state.paging.nextOffset : null;
            if (mode === 'next' && cursor === null) return null;
            const receipt: NativePortalCollectionReadReceipt = freeze({
                requestId: input.requestId,
                scope: state.scope,
                generation: state.generation,
                mode: mode === 'next' ? 'append' : 'replace',
                parentFrameId: state.frame?.id ?? null,
                cursor,
                retainNextOnFailure:
                    mode === 'next' && input.retainNextOnFailure === true,
            });
            reads.add(receipt);
            const paging: NativePortalCollectionPaging = loaded
                ? {
                      ...state.paging,
                      isPaginating: mode === 'next',
                      isReloading: mode !== 'next',
                  }
                : { ...emptyPaging(), type: 'loading' };
            return freeze({
                state: { ...state, active: receipt, cleanup: null, paging },
                receipt,
                plan: { mode, cursor, parentFrameId: receipt.parentFrameId },
            });
        },
        isCurrent,
        succeed(state, receipt, response) {
            if (!isCurrent(state, receipt)) return null;
            const scope = response.scopeAfter ?? state.scope;
            if (!metadataEcho(state.scope, scope)) return null;
            const ids = [...new Set(response.recordIds)];
            let frame: NativePortalCollectionFrame<Row, Schema, Detail> | null =
                null;
            if (
                response.linkedTableId === state.scope.linkedTableId &&
                response.schema !== null &&
                ids.every((id) => response.recordsById[id]?.id === id)
            ) {
                frame = detached({
                    id: receipt.requestId,
                    linkedTableId: response.linkedTableId,
                    recordIds: ids,
                    records: ids.map((id) => response.recordsById[id]!),
                    schema: response.schema,
                    details: response.details,
                    primary: response.primary,
                    nextOffset: response.nextOffset,
                });
                if (receipt.mode === 'append') {
                    const parent = state.frame;
                    if (
                        !parent ||
                        JSON.stringify([
                            parent.schema,
                            parent.details,
                            parent.primary,
                        ]) !==
                            JSON.stringify([
                                frame.schema,
                                frame.details,
                                frame.primary,
                            ])
                    )
                        frame = null;
                    else {
                        const incoming = new Map(
                            frame.records.map((row) => [row.id, row])
                        );
                        const prior = new Map(
                            parent.records.map((row) => [row.id, row])
                        );
                        const combinedIds = [
                            ...parent.recordIds,
                            ...ids.filter((id) => !prior.has(id)),
                        ];
                        frame = freeze({
                            ...frame,
                            recordIds: combinedIds,
                            records: combinedIds.map(
                                (id) => incoming.get(id) ?? prior.get(id)!
                            ),
                        });
                    }
                }
            }
            const recordIds =
                receipt.mode === 'append' && state.paging.type === 'loaded'
                    ? [...state.paging.recordIds, ...response.recordIds]
                    : [...response.recordIds];
            const keepOwner =
                receipt.mode === 'replace' ||
                state.paging.acceptedFetchOwnerKey ===
                    state.scope.fetchOwnerKey;
            return freeze({
                state: {
                    ...state,
                    scope: detached(scope),
                    active: null,
                    cleanup: null,
                    frame,
                    paging: {
                        type: 'loaded',
                        recordIds,
                        nextOffset: response.nextOffset,
                        isPaginating: false,
                        isReloading: false,
                        ...(keepOwner
                            ? {
                                  acceptedFetchOwnerKey:
                                      state.scope.fetchOwnerKey,
                              }
                            : {}),
                    },
                },
                compatibility: {
                    mode: receipt.mode,
                    recordIds,
                    nextOffset: response.nextOffset,
                    projection: detached(response.projection),
                },
            });
        },
        fail(state, receipt, message) {
            if (!isCurrent(state, receipt)) return null;
            const retain =
                receipt.mode === 'append' &&
                receipt.retainNextOnFailure &&
                state.paging.type === 'loaded' &&
                state.paging.isPaginating;
            const paging: NativePortalCollectionPaging = retain
                ? {
                      ...state.paging,
                      isPaginating: false,
                      errorMessage: message,
                  }
                : { ...emptyPaging(), type: 'failed', errorMessage: message };
            return freeze({
                state: { ...state, active: null, cleanup: null, paging },
            });
        },
        cleanup(state, receipt, kind, criteria, scopeAfter = state.scope) {
            if (
                !isCurrent(state, receipt) ||
                !metadataEcho(state.scope, scopeAfter)
            )
                return null;
            const generation = increment(state.generation);
            const cleanupReceipt = freeze({
                read: receipt,
                scope: detached(scopeAfter),
                generation,
            });
            cleanups.add(cleanupReceipt);
            return freeze({
                state: {
                    ...state,
                    scope: cleanupReceipt.scope,
                    generation,
                    active: null,
                    cleanup: cleanupReceipt,
                    frame: sameScope(state.scope, scopeAfter)
                        ? state.frame
                        : null,
                    paging: {
                        ...state.paging,
                        isPaginating: false,
                        isReloading: false,
                    },
                },
                cleanup: {
                    receipt: cleanupReceipt,
                    kind,
                    criteria: detached(criteria),
                },
            });
        },
        isCleanupCurrent,
        completeCleanup(state, receipt) {
            if (!isCleanupCurrent(state, receipt)) return null;
            return freeze({
                state: { ...state, cleanup: null },
                read: { mode: 'first', onlyIfNotFetched: false },
            });
        },
        retire(state) {
            if (state.disposed) return state;
            return freeze({
                ...state,
                generation: increment(state.generation),
                active: null,
                cleanup: null,
                frame: null,
                disposed: true,
            });
        },
    };
    return Object.freeze(kernel);
}
