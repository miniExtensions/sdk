import type {
    AirtableRecord,
    AirtableValue,
    FormLoadedResult,
    LoadSelectedRecordsResult,
    MiniExtensionsClient,
    RuntimeAirtableField,
} from '../runtime/types.js';
import type { FormFieldBinding } from './bindings.js';

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
    selectedPolicy: {
        supported: boolean;
        reasons: readonly ('selected-condition' | 'selected-sort')[];
    };
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
        { facet: FormLinkedRecordsFacet; destroy(): void; emit(): void }
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
        const reasons: ('selected-condition' | 'selected-sort')[] = [];
        if (
            config &&
            'filterLinkedRecordsConditionFields' in config &&
            config.filterLinkedRecordsConditionFields != null &&
            config.filterLinkedRecordsConditionFields.conditions.length !== 0 &&
            (!('filterLinkedRecordsToggle' in config) ||
                config.filterLinkedRecordsToggle !== false) &&
            (!('filterApplicationMode' in config) ||
                config.filterApplicationMode !== 'record-finder-only')
        )
            reasons.push('selected-condition');
        if (
            config &&
            'sortFields' in config &&
            (config.sortFields?.length ?? 0) !== 0
        )
            reasons.push('selected-sort');
        let stopped = false;
        let stop = () => {};
        const selectedOptions = new Map<string, AirtableRecord>();
        let selectedOptionFields: readonly RuntimeAirtableField[] | null = null;
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
                supported: reasons.length === 0,
                reasons: [...reasons],
            },
        });
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
            const selected = new Set(nativeIds);
            for (const id of selectedOptions.keys())
                if (!selected.has(id)) selectedOptions.delete(id);
            for (const record of candidates)
                if (selected.has(record.id))
                    selectedOptions.set(record.id, structuredClone(record));
            if (rich?.linkedTableId === linkedTableId && rich.table)
                selectedOptionFields = structuredClone(
                    rich.table.airtableFields
                );
            const hydrated = accepted?.[linkedTableId];
            const selectedRecords: AirtableRecord[] = [];
            const unresolvedSelectedIds: string[] = [];
            for (const id of nativeIds) {
                const record =
                    selectedOptions.get(id) ??
                    (originalIds.has(id)
                        ? hydrated?.recordIdsToAirtableRecords[id]
                        : undefined);
                if (!record) unresolvedSelectedIds.push(id);
                else if (reasons.length === 0) selectedRecords.push(record);
            }
            return structuredClone({
                phase,
                pending: phase === 'loading',
                error,
                linkedTableId,
                selectedRecords,
                unresolvedSelectedIds,
                candidateRecords: candidates,
                table: hydrated
                    ? { airtableFields: hydrated.airtableFields }
                    : selectedOptionFields
                      ? { airtableFields: selectedOptionFields }
                      : null,
                detailFields,
                detailProjection,
                selectedPolicy: { supported: reasons.length === 0, reasons },
            });
        };
        const notify = () => {
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
            destroy() {
                if (stopped) return;
                stopped = true;
                selectedOptions.clear();
                selectedOptionFields = null;
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
        clearOptions(fieldId: string) {
            const entry = facets.get(fieldId);
            facets.delete(fieldId);
            entry?.destroy();
        },
        destroy,
    };
}
