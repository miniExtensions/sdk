import type {
    ConditionalFilterPrimaryValue,
    ConditionalLinkedRecordFilteringValues,
    ListConditionalFilterPrimaryValuesInput,
    ListConditionalFilterPrimaryValuesResult,
    RuntimeFieldSchema,
    RuntimeQuery,
    RuntimeTableStates,
} from '../runtime/types.js';

type Schema = Extract<RuntimeFieldSchema, { fieldType: 'multipleRecordLinks' }>;
export type FormLinkedFilterTicket = Readonly<{
    fieldId: string;
    generation: number;
    request: number;
}>;
export type FormLinkedFilterState = {
    status: 'ready' | 'unavailable';
    diagnostics: string[];
    hidden: boolean;
    generation: number;
    filters: {
        id: string;
        name: string;
        title: string | null;
        search: string;
        selected: ConditionalFilterPrimaryValue | null;
        candidates: ConditionalFilterPrimaryValue[];
    }[];
};
export type FormLinkedFilterRead =
    | { status: 'unavailable' | 'resolved'; diagnostic: string }
    | {
          status: 'ready';
          ticket: FormLinkedFilterTicket;
          input: Omit<
              ListConditionalFilterPrimaryValuesInput,
              'extensionAccessToken'
          >;
      };
export type FormLinkedFilterAcceptance =
    | { status: 'stale' }
    | { status: 'invalid'; diagnostic: string }
    | { status: 'accepted'; changed: boolean };
export type FormLinkedFilterModel = {
    initialize(metadata: RuntimeTableStates): FormLinkedFilterState;
    state(): FormLinkedFilterState;
    prepareRead(
        fieldId: string,
        options?: { usePrefill?: boolean }
    ): FormLinkedFilterRead;
    isCurrent(ticket: FormLinkedFilterTicket): boolean;
    accept(
        ticket: FormLinkedFilterTicket,
        result: ListConditionalFilterPrimaryValuesResult
    ): FormLinkedFilterAcceptance;
    discard(ticket: FormLinkedFilterTicket): void;
    search(fieldId: string, value: string): boolean;
    choose(fieldId: string, recordId: string | null): boolean;
    snapshot(): ConditionalLinkedRecordFilteringValues;
    canChange(adding: boolean): boolean;
    dispose(): void;
};
const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const pair = (value: unknown): value is ConditionalFilterPrimaryValue =>
    object(value) &&
    typeof value.recordId === 'string' &&
    value.recordId !== '' &&
    typeof value.stringValue === 'string';
const equal = (
    a: ConditionalFilterPrimaryValue | null,
    b: ConditionalFilterPrimaryValue | null
) => a?.recordId === b?.recordId && a?.stringValue === b?.stringValue;

/** One network-free model per outer Form linked field. The caller owns authority. */
export function createFormLinkedFilterModel(input: {
    schema: Schema;
    query: RuntimeQuery;
}): FormLinkedFilterModel {
    const schema = structuredClone(input.schema);
    const query = structuredClone(input.query);
    const rawConfig = schema.miniExtConfig;
    const malformedConfiguration = rawConfig != null && !object(rawConfig);
    const config = object(rawConfig) ? rawConfig : undefined;
    const configured =
        config && 'conditionalLinkedRecordFilterFields' in config
            ? config.conditionalLinkedRecordFilterFields
            : undefined;
    const hidden =
        config &&
        'conditionalLinkedRecordFilteringFieldsType' in config &&
        config.conditionalLinkedRecordFilteringFieldsType === 'hide';
    type Rule = { id: string; title: string | null };
    const rules: Rule[] = [];
    const policy: { id: string | null; adding: boolean; removing: boolean }[] =
        [];
    let validPolicy = !malformedConfiguration;
    const diagnostics: string[] = malformedConfiguration
        ? ['The filter configuration is malformed.']
        : [];
    const linkedTableId = schema.airtableField?.config?.options?.linkedTableId;
    if (typeof linkedTableId !== 'string' || linkedTableId === '')
        diagnostics.push('The linked table identity is unavailable.');
    if (!object(query)) diagnostics.push('The configured query is malformed.');
    try {
        if (configured != null && !Array.isArray(configured)) throw new Error();
        for (const entry of configured ?? []) {
            const flags = entry.config.config;
            if (flags != null && !object(flags)) throw new Error();
            for (const flag of [
                flags?.disableAddingIfConditionalFilterIsEmpty,
                flags?.disableRemovingIfConditionalFilterIsEmpty,
            ])
                if (flag !== undefined && typeof flag !== 'boolean')
                    throw new Error();
            policy.push({
                id: entry.idOrName.type === 'id' ? entry.idOrName.id : null,
                adding: flags?.disableAddingIfConditionalFilterIsEmpty === true,
                removing:
                    flags?.disableRemovingIfConditionalFilterIsEmpty === true,
            });
        }
    } catch {
        validPolicy = false;
    }
    try {
        if (!validPolicy || (configured != null && !Array.isArray(configured)))
            throw new Error();
        const ids = new Set<string>();
        for (const entry of configured ?? []) {
            if (
                entry.idOrName.type !== 'id' ||
                typeof entry.idOrName.id !== 'string' ||
                entry.idOrName.id === '' ||
                ids.has(entry.idOrName.id) ||
                !['multipleRecordLinks', 'multipleLookupValues'].includes(
                    entry.config.type
                )
            )
                throw new Error();
            const title = entry.config.config?.title;
            if (title != null && typeof title !== 'string') throw new Error();
            ids.add(entry.idOrName.id);
            rules.push({ id: entry.idOrName.id, title: title ?? null });
        }
    } catch {
        diagnostics.push(
            'Only ordered unique configured field IDs and valid descriptors/flags are supported.'
        );
    }
    let generation = 0;
    let request = 0;
    let disposed = false;
    let edited = false;
    let ready = false;
    let filters: FormLinkedFilterState['filters'] = [];
    const tickets = new Map<FormLinkedFilterTicket, { prefill: boolean }>();
    const latest = new Map<string, FormLinkedFilterTicket>();
    const prefilled = new Set<string>();
    const invalidate = () => {
        generation++;
        tickets.clear();
        latest.clear();
    };
    const state = (): FormLinkedFilterState =>
        structuredClone({
            status: ready && !disposed ? 'ready' : 'unavailable',
            diagnostics: disposed ? ['The model is disposed.'] : diagnostics,
            hidden: hidden === true,
            generation,
            filters,
        });
    const current = (ticket: FormLinkedFilterTicket) =>
        !disposed &&
        ready &&
        tickets.has(ticket) &&
        latest.get(ticket.fieldId) === ticket &&
        ticket.generation === generation;
    const discard = (ticket: FormLinkedFilterTicket) => {
        tickets.delete(ticket);
        if (latest.get(ticket.fieldId) === ticket)
            latest.delete(ticket.fieldId);
    };
    const clearLater = (index: number) => {
        for (const filter of filters.slice(index + 1)) {
            filter.selected = null;
            filter.search = '';
            filter.candidates = [];
        }
    };
    const model: FormLinkedFilterModel = {
        state,
        initialize(metadata) {
            if (disposed || ready || diagnostics.length !== 0) return state();
            const states = structuredClone(metadata);
            if (!object(states)) {
                diagnostics.push('The authorized metadata is malformed.');
                return state();
            }
            const table = states[linkedTableId];
            if (!table || !Array.isArray(table.airtableFields)) {
                diagnostics.push(
                    'The authorized metadata did not return the linked table.'
                );
                return state();
            }
            const fields = Array.from(table.airtableFields);
            const ids = fields.map((field) => field?.id);
            if (
                ids.some((id) => typeof id !== 'string' || id === '') ||
                new Set(ids).size !== ids.length
            ) {
                diagnostics.push(
                    'The authorized metadata contains malformed or duplicate field identities.'
                );
                return state();
            }
            const resolved = rules.map((rule) => ({
                rule,
                field: fields.find((field) => field.id === rule.id),
            }));
            if (
                resolved.some(
                    ({ field }) =>
                        !field ||
                        typeof field.name !== 'string' ||
                        field.name === ''
                )
            ) {
                diagnostics.push(
                    'A configured field/name is absent from authorized metadata.'
                );
                return state();
            }
            filters = resolved.map(({ rule, field }) => ({
                ...rule,
                name: field!.name,
                search: '',
                selected: null,
                candidates: [],
            }));
            ready = true;
            invalidate();
            return state();
        },
        prepareRead(fieldId, options = {}) {
            const index = filters.findIndex((filter) => filter.id === fieldId);
            if (disposed || !ready || index < 0)
                return {
                    status: 'unavailable',
                    diagnostic: 'The configured filter is unavailable.',
                };
            const filter = filters[index]!;
            const url = query[`prefill_${filter.name}`];
            if (
                options.usePrefill === true &&
                url != null &&
                typeof url !== 'string'
            )
                return {
                    status: 'unavailable',
                    diagnostic:
                        'Repeated conditional filter URL values are unsupported.',
                };
            const prefill =
                options.usePrefill === true && typeof url === 'string';
            if (prefill && edited)
                return {
                    status: 'unavailable',
                    diagnostic:
                        'URL prefills are not replayed after a user edit.',
                };
            if (prefill && prefilled.has(fieldId))
                return {
                    status: 'resolved',
                    diagnostic: 'This URL prefill has already resolved.',
                };
            const previous = index === 0 ? null : filters[index - 1]!;
            const old = latest.get(fieldId);
            if (old) discard(old);
            const ticket = Object.freeze({
                fieldId,
                generation,
                request: ++request,
            });
            tickets.set(ticket, { prefill });
            latest.set(fieldId, ticket);
            return {
                status: 'ready',
                ticket,
                input: {
                    mainTableLinkedRecordsFieldId: schema.airtableField.id,
                    linkedRecordsFilterFieldId: fieldId,
                    searchTerm: prefill ? url : filter.search,
                    filterData:
                        previous?.selected == null
                            ? null
                            : {
                                  previousFilterFieldId: previous.id,
                                  previousFilterPrimaryValue:
                                      previous.selected.stringValue,
                              },
                    urlSearchValue: prefill ? url : null,
                },
            };
        },
        isCurrent: current,
        discard,
        accept(ticket, result) {
            if (!current(ticket)) return { status: 'stale' };
            const usePrefill = tickets.get(ticket)!.prefill;
            discard(ticket);
            if (
                !object(result) ||
                !Array.isArray(result.primaryValues) ||
                Array.from(result.primaryValues).some((value) => !pair(value))
            )
                return {
                    status: 'invalid',
                    diagnostic:
                        'The filter response contains malformed choices.',
                };
            const values = result.primaryValues;
            if (
                new Set(values.map((value) => value.recordId)).size !==
                values.length
            )
                return {
                    status: 'invalid',
                    diagnostic:
                        'The filter response repeats a record identity.',
                };
            const returnedPrefill = result.prefillValue ?? null;
            const selected = usePrefill ? returnedPrefill : null;
            if (
                returnedPrefill !== null &&
                (!pair(returnedPrefill) ||
                    !values.some(
                        (value) =>
                            value.recordId === returnedPrefill.recordId &&
                            value.stringValue === returnedPrefill.stringValue
                    ))
            )
                return {
                    status: 'invalid',
                    diagnostic:
                        'The filter response contains an unresolved prefill.',
                };
            if (usePrefill) prefilled.add(ticket.fieldId);
            const index = filters.findIndex(
                (filter) => filter.id === ticket.fieldId
            );
            const filter = filters[index]!;
            const changed = usePrefill && !equal(filter.selected, selected);
            if (changed) {
                invalidate();
                clearLater(index);
                filter.selected = structuredClone(selected);
            }
            filter.candidates = structuredClone(values);
            return { status: 'accepted', changed };
        },
        search(fieldId, value) {
            const filter = filters.find((filter) => filter.id === fieldId);
            if (
                disposed ||
                !ready ||
                !filter ||
                typeof value !== 'string' ||
                filter.search === value
            )
                return false;
            edited = true;
            invalidate();
            filter.search = value;
            filter.candidates = [];
            return true;
        },
        choose(fieldId, recordId) {
            const index = filters.findIndex((filter) => filter.id === fieldId);
            if (disposed || !ready || index < 0) return false;
            const filter = filters[index]!;
            const choice =
                recordId === null
                    ? null
                    : (filter.candidates.find(
                          (value) => value.recordId === recordId
                      ) ??
                      (filter.selected?.recordId === recordId
                          ? filter.selected
                          : undefined));
            if (choice === undefined) return false;
            if (equal(filter.selected, choice)) return true;
            edited = true;
            invalidate();
            filter.selected = structuredClone(choice);
            clearLater(index);
            return true;
        },
        snapshot: () =>
            ready && !disposed
                ? structuredClone(
                      Object.fromEntries(
                          filters.map((filter) => [filter.id, filter.selected])
                      )
                  )
                : {},
        canChange: (adding) =>
            !disposed &&
            validPolicy &&
            policy.every(
                (rule) =>
                    !(adding ? rule.adding : rule.removing) ||
                    (ready &&
                        rule.id !== null &&
                        filters.some(
                            (filter) =>
                                filter.id === rule.id &&
                                filter.selected?.stringValue != null &&
                                filter.selected.stringValue !== ''
                        ))
            ),
        dispose() {
            if (!disposed) {
                disposed = true;
                invalidate();
                filters = [];
            }
        },
    };
    return model;
}
