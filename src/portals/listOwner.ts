import type {
    AirtableRecord,
    ListPortalLinkedRecordsResult,
    MiniExtensionsClient,
    PortalLoadedResult,
    RuntimeAirtableField,
    RuntimeLinkedRecordDetailField,
} from '../runtime/types.js';
import { createPortalCollection, PortalCollectionError } from './collection.js';
import { AirtableFieldType } from '../formulas/types.js';
import {
    captureCriteria,
    getPortalLinkedRecordFieldConfig,
    isObject,
} from './helpers.js';
import type {
    PortalCollection,
    PortalCollectionOptions,
    PortalCollectionCriteria,
    PortalCollectionSnapshot,
    PortalReadOptions,
    PortalChildRequestOptions,
    PortalChildFormRequest,
} from './types.js';

export type PortalListPhase =
    | 'idle'
    | 'loading'
    | 'ready'
    | 'empty'
    | 'cleanup'
    | 'error'
    | 'retired';
export type PortalListSnapshot = {
    /** Bind retained controls, cleanup confirmations and cell guards to this revision. */
    revision: number;
    phase: PortalListPhase;
    portalFieldId: string | null;
    criteria: PortalCollectionCriteria | null;
    page: PortalCollectionSnapshot | null;
    cleanup: ListPortalLinkedRecordsResult | null;
    pending: boolean;
    error: string | null;
    hasNext: boolean;
    readRequired: boolean;
};
export type PortalListOwnerOptions = PortalCollectionOptions & {
    /** Accepted Portal/configuration lease; does not grant backend access. */
    isCurrent?(): boolean;
    /** Advance on accepted configuration replacement, including observed A→B→A. */
    configurationRevision?(): string | number;
};
/** Detached presentation of one accepted outer Portal field; never a read owner. */
export type PortalRecordPresentation = {
    portalFieldId: string;
    linkedTableId: string;
    records: AirtableRecord[];
    table: { airtableFields: RuntimeAirtableField[] };
    detailFields: RuntimeLinkedRecordDetailField[];
    detailProjection: 'missing' | 'null' | 'present';
};
export type PortalListOwner = {
    getSnapshot(): PortalListSnapshot;
    getRecords(revision: number): PortalRecordPresentation | null;
    subscribe(listener: (snapshot: PortalListSnapshot) => void): () => void;
    isCurrent(revision: number): boolean;
    readFirst(revision: number, options: PortalReadOptions): Promise<boolean>;
    readNext(revision: number, options: PortalReadOptions): Promise<boolean>;
    /** Complete criteria replacement; retire rows/paging/child eligibility without reading. */
    setCriteria(revision: number, criteria: PortalCollectionCriteria): boolean;
    /** Select another returned outer Portal field using an explicit complete criteria snapshot. */
    setField(
        revision: number,
        fieldId: string,
        criteria: PortalCollectionCriteria
    ): boolean;
    /** Apply only server-returned replacement properties; never automatically read. */
    acceptCleanup(revision: number): boolean;
    dismissCleanup(revision: number): boolean;
    childFormRequest(
        revision: number,
        options: PortalChildRequestOptions
    ): PortalChildFormRequest;
    cancel(revision: number): void;
    destroy(): void;
};

// Internal host-adapter provenance. Credentials stay out of renderer snapshots
// and this reader is deliberately not exported by the public /portals entry.
const ownerContexts = new WeakMap<
    PortalListOwner,
    {
        client: MiniExtensionsClient;
        portal: PortalLoadedResult;
        isCurrent(revision: number): boolean;
    }
>();
export function readPortalListOwnerContext(
    owner: PortalListOwner,
    revision: number,
    client: MiniExtensionsClient
): PortalLoadedResult | null {
    const context = ownerContexts.get(owner);
    if (!context || context.client !== client || !context.isCurrent(revision))
        return null;
    return structuredClone(context.portal);
}

/** Read-only list/table ownership. Rendering, mutations and visitor storage remain separate. */
export function createPortalListOwner(
    options: PortalListOwnerOptions
): PortalListOwner {
    const portal = structuredClone(options.portal);
    let fieldId = options.portalFieldId;
    let criteria = captureCriteria(options.criteria);
    const configuration = options.configurationRevision?.();
    let collection: PortalCollection = createPortalCollection({
        ...options,
        portal,
        criteria,
    });
    let revision = 0;
    let generation = 0;
    let delivery = 0;
    let retired = false;
    let phase: PortalListPhase = 'idle';
    let error: string | null = null;
    let page: PortalCollectionSnapshot | null = null;
    let cleanup: ListPortalLinkedRecordsResult | null = null;
    let active: {
        abort: AbortController;
        collection: PortalCollection;
        generation: number;
    } | null = null;
    const listeners = new Set<(snapshot: PortalListSnapshot) => void>();
    const snapshot = (): PortalListSnapshot => ({
        revision,
        phase,
        portalFieldId: retired ? null : fieldId,
        criteria: retired ? null : structuredClone(criteria),
        page: retired || page == null ? null : structuredClone(page),
        cleanup: retired || cleanup == null ? null : structuredClone(cleanup),
        pending: active !== null,
        error: retired ? null : error,
        hasNext:
            !retired &&
            (phase === 'ready' || phase === 'empty') &&
            page?.airtableOffset != null,
        readRequired: phase !== 'ready' && phase !== 'empty',
    });
    const emit = () => {
        const id = ++delivery;
        const state = snapshot();
        for (const listener of [...listeners]) {
            if (
                (!retired && !current()) ||
                id !== delivery ||
                revision !== state.revision
            )
                break;
            if (listeners.has(listener)) {
                try {
                    listener(structuredClone(state));
                } catch {}
            }
        }
        if (!retired) current();
    };
    const retire = () => {
        if (retired) return;
        retired = true;
        generation++;
        revision++;
        const previous = active;
        active = null;
        phase = 'retired';
        page = null;
        cleanup = null;
        error = null;
        // Retire old actions before abort callbacks can reenter a newer owner.
        collection.destroy();
        previous?.abort.abort();
        emit();
    };
    const current = () => {
        if (retired) return false;
        try {
            const live =
                collection.isCurrent() &&
                (options.isCurrent?.() ?? true) &&
                options.configurationRevision?.() === configuration &&
                options.portal.extensionId === portal.extensionId &&
                options.portal.payload.extensionAccessToken ===
                    portal.payload.extensionAccessToken &&
                options.portal.payload.formRecord.recordId ===
                    portal.payload.formRecord.recordId &&
                options.portal.payload.formRecord.tableId ===
                    portal.payload.formRecord.tableId;
            if (!live) retire();
            return !retired && live;
        } catch {
            retire();
            return false;
        }
    };
    const owned = (expected: number) => current() && revision === expected;
    const replace = (
        expected: number,
        nextField: string,
        supplied: PortalCollectionCriteria,
        nextPhase: 'idle' | 'error' = 'idle'
    ): boolean => {
        if (!owned(expected)) return false;
        let next: PortalCollection;
        let copied: PortalCollectionCriteria;
        try {
            copied = captureCriteria(supplied);
            next = createPortalCollection({
                ...options,
                portal,
                portalFieldId: nextField,
                criteria: copied,
            });
        } catch {
            return false;
        }
        if (!owned(expected)) {
            next.destroy();
            return false;
        }
        const old = collection;
        const previous = active;
        generation++;
        revision++;
        const accepted = generation;
        active = null;
        collection = next;
        fieldId = nextField;
        criteria = copied;
        phase = nextPhase;
        page = null;
        cleanup = null;
        error =
            nextPhase === 'error'
                ? 'The Portal read was cancelled. Use an explicit fresh Load.'
                : null;
        old.destroy();
        previous?.abort.abort();
        if (generation === accepted && current()) emit();
        return generation === accepted && !retired;
    };
    const read = async (
        expected: number,
        supplied: PortalReadOptions,
        more: boolean
    ): Promise<boolean> => {
        if (
            !owned(expected) ||
            active !== null ||
            phase === 'cleanup' ||
            (more &&
                ((phase !== 'ready' && phase !== 'empty') ||
                    page?.airtableOffset == null))
        )
            return false;
        const abort = new AbortController();
        const entry = { abort, collection, generation: ++generation };
        active = entry;
        revision++;
        phase = 'loading';
        error = null;
        // Old accepted rows cannot authorize actions while this read is pending.
        page = null;
        cleanup = null;
        const lease = () =>
            current() &&
            active === entry &&
            generation === entry.generation &&
            collection === entry.collection &&
            !abort.signal.aborted;
        const cancelled = () => {
            if (
                current() &&
                active === entry &&
                generation === entry.generation
            )
                replace(revision, fieldId, criteria, 'error');
        };
        supplied.signal?.addEventListener('abort', cancelled, { once: true });
        if (supplied.signal?.aborted) cancelled();
        emit();
        try {
            if (!lease()) return false;
            const outcome = await (more
                ? entry.collection.readNext({
                      ...supplied,
                      signal: abort.signal,
                  })
                : entry.collection.readFirst({
                      ...supplied,
                      signal: abort.signal,
                  }));
            if (!lease()) return false;
            if (outcome == null) {
                phase = 'empty';
                return false;
            }
            if (outcome.type === 'criteria-cleanup-required') {
                phase = 'cleanup';
                cleanup = structuredClone(outcome.raw);
                page = null;
            } else {
                page = structuredClone(outcome.snapshot);
                phase = page.recordIds.length === 0 ? 'empty' : 'ready';
            }
            active = null;
            revision++;
            emit();
            return current() && generation === entry.generation;
        } catch {
            if (
                current() &&
                active === entry &&
                generation === entry.generation
            ) {
                phase = 'error';
                page = null;
                cleanup = null;
                error =
                    'The Portal read did not complete. Use an explicit fresh Load.';
            }
            return false;
        } finally {
            supplied.signal?.removeEventListener('abort', cancelled);
            if (active === entry && generation === entry.generation) {
                active = null;
                revision++;
                if (phase === 'loading') {
                    phase = 'error';
                    error =
                        'The Portal read was cancelled. Use an explicit fresh Load.';
                }
                emit();
            }
        }
    };
    const owner: PortalListOwner = {
        getSnapshot: () => {
            current();
            return snapshot();
        },
        getRecords(expected) {
            if (
                !owned(expected) ||
                active !== null ||
                !page ||
                (phase !== 'ready' && phase !== 'empty')
            )
                return null;
            try {
                if (
                    portal.payload.fieldIdsInPortal.filter(
                        (id) => id === fieldId
                    ).length !== 1
                )
                    return null;
                const schema = portal.payload.fieldIdsToSchemas[fieldId];
                if (
                    !schema ||
                    schema.airtableField.id !== fieldId ||
                    schema.fieldType !== schema.airtableField.config.type
                )
                    return null;
                const linked = getPortalLinkedRecordFieldConfig(
                    schema.airtableField
                );
                if (!linked) return null;
                const linkedTableId = linked.options.linkedTableId;
                const table = page.tableIdsToLinkedTableStates[linkedTableId];
                if (
                    !table ||
                    !Array.isArray(table.airtableFields) ||
                    !isObject(table.recordIdsToAirtableRecords)
                )
                    return null;
                const ids = new Set<string>();
                for (const field of table.airtableFields) {
                    if (
                        !isObject(field) ||
                        typeof field.id !== 'string' ||
                        field.id.trim() === '' ||
                        ids.has(field.id) ||
                        typeof field.name !== 'string' ||
                        (field.description !== null &&
                            typeof field.description !== 'string') ||
                        typeof field.isComputed !== 'boolean' ||
                        typeof field.isPrimaryField !== 'boolean' ||
                        !isObject(field.config) ||
                        typeof field.config.type !== 'string' ||
                        !Object.values(AirtableFieldType).includes(
                            field.config.type as AirtableFieldType
                        ) ||
                        ([
                            'singleLineText',
                            'email',
                            'url',
                            'multilineText',
                            'richText',
                            'phoneNumber',
                            'barcode',
                            'button',
                            'autoNumber',
                        ].includes(field.config.type)
                            ? field.config.options !== null
                            : !isObject(field.config.options))
                    )
                        return null;
                    ids.add(field.id);
                }
                const records: AirtableRecord[] = [];
                const seen = new Set<string>();
                for (const id of page.recordIds) {
                    if (
                        typeof id !== 'string' ||
                        id.trim() === '' ||
                        seen.has(id) ||
                        !Object.hasOwn(table.recordIdsToAirtableRecords, id)
                    )
                        return null;
                    seen.add(id);
                    const record = table.recordIdsToAirtableRecords[id];
                    if (
                        !isObject(record) ||
                        record.id !== id ||
                        !isObject(record.fields)
                    )
                        return null;
                    if (
                        Object.values(page.tableIdsToLinkedTableStates).filter(
                            (t) =>
                                Object.hasOwn(t.recordIdsToAirtableRecords, id)
                        ).length !== 1
                    )
                        return null;
                    // Only physical fields returned for this table enter the facet.
                    records.push({
                        id,
                        fields: Object.fromEntries(
                            Object.entries(record.fields).filter(([key]) =>
                                ids.has(key)
                            )
                        ),
                    });
                }
                const detailIds = new Set<string>();
                for (const detail of page.detailFields) {
                    if (
                        !isObject(detail) ||
                        typeof detail.fieldId !== 'string' ||
                        detail.fieldId.trim() === '' ||
                        detailIds.has(detail.fieldId) ||
                        typeof detail.isHidden !== 'boolean' ||
                        !ids.has(detail.fieldId)
                    )
                        return null;
                    detailIds.add(detail.fieldId);
                }
                const result: PortalRecordPresentation = structuredClone({
                    portalFieldId: fieldId,
                    linkedTableId,
                    records,
                    table: { airtableFields: table.airtableFields },
                    detailFields: page.detailFields,
                    detailProjection:
                        page.customViewDetailFields === null
                            ? 'null'
                            : Object.hasOwn(
                                    page.customViewDetailFields,
                                    fieldId
                                )
                              ? 'present'
                              : 'missing',
                });
                return owned(expected) && active === null ? result : null;
            } catch {
                return null;
            }
        },
        subscribe(listener) {
            current();
            listeners.add(listener);
            try {
                listener(snapshot());
            } catch {
                /* Renderer exceptions do not own list state. */
            }
            if (!retired) current();
            return () => listeners.delete(listener);
        },
        isCurrent: (expected) =>
            owned(expected) &&
            active === null &&
            (phase === 'ready' || phase === 'empty'),
        readFirst: (expected, readOptions) =>
            read(expected, readOptions, false),
        readNext: (expected, readOptions) => read(expected, readOptions, true),
        setCriteria: (expected, next) => replace(expected, fieldId, next),
        setField: replace,
        acceptCleanup(expected) {
            if (
                !owned(expected) ||
                phase !== 'cleanup' ||
                cleanup == null ||
                active !== null
            )
                return false;
            const next = {
                ...criteria,
                ...(cleanup.endUserSortCleanup === undefined
                    ? {}
                    : {
                          sortFieldsByEndUser: structuredClone(
                              cleanup.endUserSortCleanup.sortFields
                          ),
                      }),
                ...(cleanup.endUserFilterCleanup === undefined
                    ? {}
                    : {
                          filtersByEndUser: structuredClone(
                              cleanup.endUserFilterCleanup.filters
                          ),
                      }),
            };
            return replace(expected, fieldId, next);
        },
        dismissCleanup(expected) {
            return (
                owned(expected) &&
                phase === 'cleanup' &&
                replace(expected, fieldId, criteria)
            );
        },
        childFormRequest(expected, supplied) {
            if (
                !owned(expected) ||
                active !== null ||
                (phase !== 'ready' && phase !== 'empty')
            )
                throw new PortalCollectionError(
                    'read-required',
                    'A current accepted Portal page is required.'
                );
            const plan = collection.childFormRequest(supplied);
            const checked = plan.isCurrent;
            return {
                ...plan,
                isCurrent: () =>
                    owned(expected) &&
                    active === null &&
                    (phase === 'ready' || phase === 'empty') &&
                    checked(),
            };
        },
        cancel(expected) {
            if (!owned(expected) || active === null) return;
            // Replacement detaches the old request before synchronous abort callbacks.
            replace(expected, fieldId, criteria, 'error');
        },
        destroy() {
            retire();
            listeners.clear();
        },
    };
    ownerContexts.set(owner, {
        client: options.client,
        portal,
        isCurrent: (expected) =>
            owned(expected) &&
            active === null &&
            (phase === 'ready' || phase === 'empty'),
    });
    return owner;
}
