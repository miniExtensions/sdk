import type {
    AirtableRecord,
    AirtableValue,
    FormLoadedResult,
    LoadSelectedRecordsResult,
    MiniExtensionsClient,
    RuntimeAirtableField,
} from '../runtime/types.js';
import type { FormFieldBinding } from './bindings.js';
import { sameLinkedRecordTable } from '../ui/linkedRecordPages.js';
import {
    projectSelectedRecordsPolicy,
    type FormSelectedRecordPolicy,
} from './selectedRecordPolicy.js';
export type { FormSelectedRecordPolicy } from './selectedRecordPolicy.js';

export type FormLinkedRecordDetailFields =
    FormLoadedResult['payload']['linkedRecordFieldIdToDetailFields'][string];
export type FormLinkedRecordsSnapshot = {
    phase: 'idle' | 'loading' | 'ready' | 'error' | 'retired' | 'unavailable';
    pending: boolean;
    error: string | null;
    linkedTableId: string | null;
    selectedRecords: readonly AirtableRecord[];
    /** Native order and duplicate occurrences are preserved. */
    unresolvedSelectedIds: readonly string[];
    candidateRecords: readonly AirtableRecord[];
    table: { airtableFields: readonly RuntimeAirtableField[] } | null;
    detailFields: FormLinkedRecordDetailFields | null;
    detailProjection: 'missing' | 'null' | 'present';
    selectedPolicy: FormSelectedRecordPolicy;
};
export type FormLinkedRecordsFacet = {
    getSnapshot(): FormLinkedRecordsSnapshot;
    subscribe(
        listener: (snapshot: FormLinkedRecordsSnapshot) => void
    ): () => void;
    /** One explicit token-only hydration read, shared by this accepted Form owner. */
    readSelected(): Promise<boolean>;
};

const object = (value: unknown): value is Record<string, unknown> =>
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
const ids = (value: AirtableValue | undefined): string[] | null => {
    if (value == null || (typeof value === 'string' && value.trim() === ''))
        return [];
    return Array.isArray(value) &&
        Array.from(value).every(
            (id, index) =>
                Object.hasOwn(value, index) &&
                typeof id === 'string' &&
                id.trim() !== ''
        )
        ? ([...value] as string[])
        : null;
};
const sameSession = (
    a: ReturnType<MiniExtensionsClient['getSession']>,
    b: ReturnType<MiniExtensionsClient['getSession']>
) =>
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
const validate = (value: unknown): value is LoadSelectedRecordsResult => {
    if (!object(value)) return false;
    const recordIds = new Set<string>();
    return Object.values(value).every((table) => {
        if (
            !object(table) ||
            !Array.isArray(table.airtableFields) ||
            !object(table.recordIdsToAirtableRecords)
        )
            return false;
        const fields = table.airtableFields;
        const seen = new Set<string>();
        if (
            !Array.from(fields).every((field, index) => {
                if (
                    !Object.hasOwn(fields, index) ||
                    !object(field) ||
                    typeof field.id !== 'string' ||
                    !field.id ||
                    seen.has(field.id) ||
                    typeof field.name !== 'string' ||
                    !object(field.config) ||
                    typeof field.config.type !== 'string'
                )
                    return false;
                seen.add(field.id);
                return true;
            })
        )
            return false;
        return Object.entries(table.recordIdsToAirtableRecords).every(
            ([id, record]) => {
                if (
                    recordIds.has(id) ||
                    !object(record) ||
                    record.id !== id ||
                    !object(record.fields)
                )
                    return false;
                recordIds.add(id);
                return true;
            }
        );
    });
};

/** Internal owner composition; never exported from the public Forms entry. */
export function createFormLinkedRecordsOwner(options: {
    client: MiniExtensionsClient;
    loaded: FormLoadedResult;
    originalRecordData: FormLoadedResult['payload']['formRecord']['data'];
    field(fieldId: string): FormFieldBinding;
    isCurrent(): boolean;
    configurationRevision?(): string | number;
}) {
    const loaded = structuredClone(options.loaded);
    const originalRecordData = structuredClone(options.originalRecordData);
    const session = { ...options.client.getSession() };
    const configuration = options.configurationRevision?.();
    let retired = false;
    let generation = 0;
    let accepted: LoadSelectedRecordsResult | null = null;
    let phase: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
    let error: string | null = null;
    let active: { abort: AbortController; promise: Promise<boolean> } | null =
        null;
    const facets = new Map<
        string,
        {
            facet: FormLinkedRecordsFacet;
            destroy(): void;
            emit(): void;
            prepareCreated(
                record: AirtableRecord,
                childTable: FormLinkedRecordsSnapshot['table']
            ): (() => void) | null;
        }
    >();
    const current = () => {
        if (retired) return false;
        const observed = generation;
        try {
            if (
                options.isCurrent() &&
                options.configurationRevision?.() === configuration &&
                sameSession(session, options.client.getSession()) &&
                options.isCurrent() &&
                options.configurationRevision?.() === configuration &&
                sameSession(session, options.client.getSession()) &&
                !retired &&
                generation === observed
            )
                return true;
        } catch {
            /* Unreadable owner state cannot establish accepted provenance. */
        }
        destroy();
        return false;
    };
    const emit = () => {
        for (const entry of [...facets.values()]) entry.emit();
    };
    function destroy() {
        if (retired) return;
        retired = true;
        generation++;
        accepted = null;
        const previous = active;
        active = null;
        for (const entry of [...facets.values()]) entry.destroy();
        facets.clear();
        previous?.abort.abort();
    }
    const readSelected = (): Promise<boolean> => {
        if (!current()) return Promise.resolve(false);
        if (active) return active.promise;
        if (phase === 'ready' && accepted) return Promise.resolve(true);
        const ticket = ++generation;
        const abort = new AbortController();
        phase = 'loading';
        error = null;
        accepted = null;
        const entry = { abort, promise: Promise.resolve(false) };
        active = entry;
        const owns = () =>
            current() &&
            active === entry &&
            generation === ticket &&
            !abort.signal.aborted;
        entry.promise = Promise.resolve().then(async () => {
            let installed = false;
            try {
                if (!owns()) return false;
                const result =
                    await options.client.linkedRecords.loadSelectedRecords(
                        {
                            extensionAccessToken:
                                loaded.payload.extensionAccessToken,
                        },
                        { session: { ...session }, signal: abort.signal }
                    );
                if (!owns()) return false;
                if (!validate(result))
                    throw new Error('Malformed linked records.');
                const detached = structuredClone(result);
                if (!owns()) return false;
                accepted = detached;
                phase = 'ready';
                installed = true;
            } catch {
                if (owns()) {
                    phase = 'error';
                    error =
                        'Selected linked records could not be loaded. Retry explicitly.';
                }
                return false;
            } finally {
                if (active === entry) {
                    active = null;
                    if (current()) emit();
                }
            }
            return installed && current() && generation === ticket;
        });
        emit();
        return entry.promise;
    };
    const field = (fieldId: string): FormLinkedRecordsFacet => {
        const existing = facets.get(fieldId);
        if (existing) return existing.facet;
        const binding = options.field(fieldId);
        const schema = loaded.payload.fieldIdsToSchemas[fieldId];
        if (
            !schema ||
            schema.fieldType !== 'multipleRecordLinks' ||
            schema.airtableField.id !== fieldId ||
            schema.airtableField.config.type !== 'multipleRecordLinks'
        )
            throw new TypeError('A linked field is required.');
        const linkedTableId = schema.airtableField.config.options.linkedTableId;
        const originalIds = new Set(ids(originalRecordData[fieldId]) ?? []);
        const projection = loaded.payload.linkedRecordFieldIdToDetailFields;
        const detailProjection =
            projection == null
                ? Object.hasOwn(
                      loaded.payload,
                      'linkedRecordFieldIdToDetailFields'
                  ) && projection === null
                    ? 'null'
                    : 'missing'
                : !Object.hasOwn(projection, fieldId)
                  ? 'missing'
                  : projection[fieldId] == null
                    ? 'null'
                    : 'present';
        const detailFields =
            detailProjection === 'present' ? projection[fieldId] : null;
        const config = schema.miniExtConfig;
        let stopped = false;
        let stop = () => {};
        type Table = FormLinkedRecordsSnapshot['table'];
        const selectedOptions = new Map<
            string,
            { record: AirtableRecord; table: Table }
        >();
        const createdOptions = new Map<
            string,
            { record: AirtableRecord; table: Table }
        >();
        const listeners = new Set<
            (snapshot: FormLinkedRecordsSnapshot) => void
        >();
        const empty = (
            status: 'retired' | 'unavailable'
        ): FormLinkedRecordsSnapshot => ({
            phase: status,
            pending: false,
            error: null,
            linkedTableId: null,
            selectedRecords: [],
            unresolvedSelectedIds: [],
            candidateRecords: [],
            table: null,
            detailFields: null,
            detailProjection: 'missing',
            selectedPolicy: {
                supported: false,
                reasons: [],
                state: 'unsupported',
                diagnostics: [{ code: 'missing-dependency' }],
            },
        });
        const captureSelection = () => {
            if (stopped || !current()) return;
            const state = binding.getSnapshot();
            if (state.retired || !current()) return;
            const nativeIds = ids(state.value);
            if (!nativeIds) return;
            const rich = binding.selection?.getState().linkedRecords;
            if (!current() || stopped) return;
            const selected = new Set(nativeIds);
            for (const id of selectedOptions.keys())
                if (!selected.has(id)) selectedOptions.delete(id);
            for (const id of createdOptions.keys())
                if (!selected.has(id)) createdOptions.delete(id);
            if (rich?.linkedTableId === linkedTableId)
                for (const record of rich.records)
                    if (selected.has(record.id))
                        selectedOptions.set(
                            record.id,
                            structuredClone({ record, table: rich.table })
                        );
        };
        const snapshot = (): FormLinkedRecordsSnapshot => {
            if (stopped || !current()) return empty('retired');
            const state = binding.getSnapshot();
            if (state.retired || !current()) return empty('retired');
            const nativeIds = ids(state.value);
            if (
                !nativeIds ||
                !state.field ||
                state.visibility.type !== 'visible'
            )
                return empty('unavailable');
            const rich = binding.selection?.getState().linkedRecords;
            const candidates =
                rich?.linkedTableId === linkedTableId ? rich.records : [];
            if (!current() || stopped) return empty('retired');
            const hydrated = accepted?.[linkedTableId];
            const selectedRecords: AirtableRecord[] = [];
            const unresolvedSelectedIds: string[] = [];
            const contributingTables: Table[] = [];
            if (candidates.length !== 0)
                contributingTables.push(rich?.table ?? null);
            for (const id of nativeIds) {
                const option =
                    createdOptions.get(id) ?? selectedOptions.get(id);
                const record =
                    option?.record ??
                    (originalIds.has(id)
                        ? hydrated?.recordIdsToAirtableRecords[id]
                        : undefined);
                if (!record) unresolvedSelectedIds.push(id);
                else {
                    selectedRecords.push(record);
                    contributingTables.push(
                        option
                            ? option.table
                            : hydrated
                              ? { airtableFields: hydrated.airtableFields }
                              : null
                    );
                }
            }
            const commonTable =
                contributingTables.length === 0
                    ? rich?.linkedTableId === linkedTableId && rich.table
                        ? rich.table
                        : hydrated
                          ? { airtableFields: hydrated.airtableFields }
                          : null
                    : contributingTables[0] &&
                        contributingTables.every(
                            (table) =>
                                table !== null &&
                                sameLinkedRecordTable(
                                    contributingTables[0],
                                    table
                                )
                        )
                      ? contributingTables[0]
                      : null;
            const projected = projectSelectedRecordsPolicy({
                config,
                records: selectedRecords,
                airtableFields: commonTable?.airtableFields ?? null,
                waitingData: !accepted && !rich && selectedOptions.size === 0,
                createdRecordIds: new Set(
                    nativeIds.filter((id) => createdOptions.has(id))
                ),
            });
            if (!current() || stopped) return empty('retired');
            return structuredClone({
                phase,
                pending: phase === 'loading',
                error,
                linkedTableId,
                selectedRecords: projected.records,
                unresolvedSelectedIds,
                candidateRecords: candidates,
                table: commonTable,
                detailFields,
                detailProjection,
                selectedPolicy: projected.policy,
            });
        };
        const notify = () => {
            // Accepted selection changes update owner-held data even when no
            // renderer is mounted or reading this facet.
            captureSelection();
            for (const listener of [...listeners])
                if (listeners.has(listener)) {
                    try {
                        listener(snapshot());
                    } catch {
                        /* Renderer is not the read owner. */
                    }
                }
        };
        const facet: FormLinkedRecordsFacet = {
            getSnapshot: snapshot,
            subscribe(listener) {
                listeners.add(listener);
                try {
                    listener(snapshot());
                } catch {
                    /* Subscriber isolation. */
                }
                return () => listeners.delete(listener);
            },
            readSelected: () =>
                stopped ? Promise.resolve(false) : readSelected(),
        };
        const entry = {
            facet,
            emit: notify,
            prepareCreated(
                source: AirtableRecord,
                childTable: Table
            ): (() => void) | null {
                if (stopped || !current()) return null;
                try {
                    if (
                        !object(source) ||
                        typeof source.id !== 'string' ||
                        source.id.trim() === '' ||
                        !object(source.fields)
                    )
                        return null;
                    const record = structuredClone(source);
                    const child = childTable && structuredClone(childTable);
                    if (
                        child &&
                        !validate({
                            [linkedTableId]: {
                                airtableFields: [...child.airtableFields],
                                recordIdsToAirtableRecords: {
                                    [record.id]: record,
                                },
                            },
                        })
                    )
                        return null;
                    // Child public metadata is not a parent detail policy. Only
                    // an already accepted parent table may supply that policy.
                    const hydrated = accepted?.[linkedTableId];
                    const tables: Table[] = hydrated
                        ? [{ airtableFields: hydrated.airtableFields }]
                        : [...selectedOptions.values()].map(
                              (value) => value.table
                          );
                    const parent = tables[0];
                    let prepared: {
                        record: AirtableRecord;
                        table: Table;
                    } | null = null;
                    if (
                        child &&
                        parent &&
                        detailFields &&
                        tables.every(
                            (table) =>
                                table && sameLinkedRecordTable(parent, table)
                        )
                    ) {
                        const allowed = new Set<string>();
                        const resolve = (reference: unknown): boolean => {
                            if (!object(reference)) return false;
                            const matches = parent.airtableFields.filter(
                                (field) =>
                                    reference.type === 'id'
                                        ? field.id === reference.id
                                        : reference.type === 'name' &&
                                          field.name === reference.name
                            );
                            if (matches.length !== 1) return false;
                            allowed.add(matches[0]!.id);
                            return true;
                        };
                        let supported = detailFields.every(
                            (detail) =>
                                detail.isHidden === true ||
                                resolve({ type: 'id', id: detail.fieldId })
                        );
                        const policy = config as
                            | Record<string, unknown>
                            | undefined;
                        const conditions =
                            policy?.filterLinkedRecordsToggle === false ||
                            policy?.filterApplicationMode ===
                                'record-finder-only'
                                ? null
                                : policy?.filterLinkedRecordsConditionFields;
                        const active = new Set<object>();
                        const dependencies = (group: unknown): boolean => {
                            if (group == null) return true;
                            if (
                                !object(group) ||
                                !Array.isArray(group.conditions) ||
                                active.has(group)
                            )
                                return false;
                            active.add(group);
                            const valid = group.conditions.every(
                                (condition: unknown) =>
                                    object(condition) &&
                                    (condition.type === 'groupCondition'
                                        ? dependencies(condition)
                                        : condition.type ===
                                              'singleCondition' &&
                                          object(condition.setting) &&
                                          resolve(condition.setting.idOrName))
                            );
                            active.delete(group);
                            return valid;
                        };
                        supported &&= dependencies(conditions);
                        if (policy?.sortFields != null) {
                            supported &&=
                                Array.isArray(policy.sortFields) &&
                                policy.sortFields.every(
                                    (sort: unknown) =>
                                        object(sort) && resolve(sort.idOrName)
                                );
                        }
                        supported &&= [...allowed].every((id) => {
                            const parentField = parent.airtableFields.filter(
                                (field) => field.id === id
                            );
                            const childField = child.airtableFields.filter(
                                (field) => field.id === id
                            );
                            return (
                                parentField.length === 1 &&
                                childField.length === 1 &&
                                sameLinkedRecordTable(
                                    { airtableFields: parentField },
                                    { airtableFields: childField }
                                )
                            );
                        });
                        const projected = {
                            id: record.id,
                            fields: Object.fromEntries(
                                Object.entries(record.fields).filter(([id]) =>
                                    allowed.has(id)
                                )
                            ),
                        };
                        if (
                            supported &&
                            projectSelectedRecordsPolicy({
                                config,
                                records: [projected],
                                airtableFields: parent.airtableFields,
                                waitingData: false,
                                createdRecordIds: new Set([record.id]),
                            }).policy.supported
                        )
                            prepared = structuredClone({
                                record: projected,
                                table: parent,
                            });
                    }
                    let used = false;
                    return () => {
                        if (used) return;
                        used = true;
                        // afterCommit must not re-enter application callbacks.
                        // Native membership is checked by every snapshot and
                        // pruned by the accepted binding publication below.
                        if (stopped || retired || !prepared) return;
                        const latestHydrated = accepted?.[linkedTableId];
                        const latestTables: Table[] = latestHydrated
                            ? [
                                  {
                                      airtableFields:
                                          latestHydrated.airtableFields,
                                  },
                              ]
                            : [...selectedOptions.values()].map(
                                  (value) => value.table
                              );
                        if (
                            !latestTables.length ||
                            latestTables.some(
                                (table) =>
                                    !table ||
                                    !sameLinkedRecordTable(
                                        prepared.table,
                                        table
                                    )
                            )
                        )
                            return;
                        createdOptions.set(record.id, prepared);
                    };
                } catch {
                    return null;
                }
            },
            destroy() {
                if (stopped) return;
                stopped = true;
                selectedOptions.clear();
                createdOptions.clear();
                stop();
                notify();
                listeners.clear();
            },
        };
        facets.set(fieldId, entry);
        stop = binding.subscribe(notify);
        return facet;
    };
    return {
        field,
        /** Private trusted coordinator channel; never exposed on a field facet. */
        prepareCreated(
            fieldId: string,
            record: AirtableRecord,
            childTable: FormLinkedRecordsSnapshot['table']
        ): (() => void) | null {
            if (!current()) return null;
            field(fieldId);
            return (
                facets.get(fieldId)?.prepareCreated(record, childTable) ?? null
            );
        },
        clearOptions(fieldId: string) {
            const entry = facets.get(fieldId);
            facets.delete(fieldId);
            entry?.destroy();
        },
        destroy,
    };
}
