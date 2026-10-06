import type {
    ConditionalFilterPrimaryValue,
    ConditionalLinkedRecordFilteringValues,
    MiniExtensionsClient,
    RuntimeFieldSchema,
    RuntimeQuery,
    RuntimeTableStates,
} from '@miniextensions/sdk';
import { button, element, labeled } from './dom.js';

type RequestContext = {
    client: MiniExtensionsClient;
    signal: AbortSignal;
    current(): boolean;
};

type Rule = {
    id: string;
    title: string | null;
    disableAdding: boolean;
    disableRemoving: boolean;
};

type Filter = Rule & {
    name: string;
    search: HTMLInputElement;
    select: HTMLSelectElement;
    candidates: Map<string, ConditionalFilterPrimaryValue>;
};

export type ConditionalLinkedFilters = {
    node: HTMLDivElement;
    snapshot(): ConditionalLinkedRecordFilteringValues;
    revision(): number;
    canChange(adding: boolean): boolean;
    destroy(): void;
};

const sessionKey = (client: MiniExtensionsClient) =>
    JSON.stringify(
        Object.entries(client.getSession()).sort(([a], [b]) =>
            a.localeCompare(b)
        )
    );
const isObject = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);
const pair = (value: unknown): value is ConditionalFilterPrimaryValue =>
    isObject(value) &&
    typeof value.recordId === 'string' &&
    value.recordId !== '' &&
    typeof value.stringValue === 'string';

/** Example-local cascade: reads existing configured Form filters only. */
export function createConditionalLinkedFilters(options: {
    schema: Extract<RuntimeFieldSchema, { fieldType: 'multipleRecordLinks' }>;
    extensionAccessToken: string;
    query: RuntimeQuery;
    current(): boolean;
    readMetadata(context: RequestContext): Promise<RuntimeTableStates>;
    request(
        description: string,
        work: (context: RequestContext) => Promise<void>
    ): void;
    changed(): void;
    status(message: string, error?: boolean): void;
}): ConditionalLinkedFilters | null {
    const config = options.schema.miniExtConfig;
    const configured =
        config != null && 'conditionalLinkedRecordFilterFields' in config
            ? config.conditionalLinkedRecordFilterFields
            : undefined;
    if (
        configured == null ||
        (Array.isArray(configured) && configured.length === 0)
    )
        return null;
    const node = element('div', undefined, 'conditional-linked-filters');
    node.dataset.linkedFilterFieldId = options.schema.airtableField.id;
    const fields = element('div');
    const values = new Map<string, ConditionalFilterPrimaryValue | null>();
    const pending = new Set<AbortController>();
    let filters: Filter[] = [];
    let rules: Rule[] = [];
    let ready = false;
    let destroyed = false;
    let revision = 0;
    let validConfiguration = true;
    // Presentation can be unsupported while the original policy still permits
    // ordinary linked choices. Never turn a skipped descriptor into permission.
    const policyRules: Array<{
        id: string | null;
        disableAdding: boolean;
        disableRemoving: boolean;
    }> = [];
    let validPolicy = true;
    try {
        if (!Array.isArray(configured)) throw new Error();
        for (const entry of configured) {
            const config = entry.config.config;
            if (
                (config?.disableAddingIfConditionalFilterIsEmpty !==
                    undefined &&
                    typeof config.disableAddingIfConditionalFilterIsEmpty !==
                        'boolean') ||
                (config?.disableRemovingIfConditionalFilterIsEmpty !==
                    undefined &&
                    typeof config.disableRemovingIfConditionalFilterIsEmpty !==
                        'boolean')
            )
                throw new Error();
            policyRules.push({
                id: entry.idOrName.type === 'id' ? entry.idOrName.id : null,
                disableAdding:
                    config?.disableAddingIfConditionalFilterIsEmpty === true,
                disableRemoving:
                    config?.disableRemovingIfConditionalFilterIsEmpty === true,
            });
        }
    } catch {
        validPolicy = false;
    }

    const current = () => !destroyed && node.isConnected && options.current();
    const invalidate = () => {
        revision += 1;
        for (const controller of pending) controller.abort();
        pending.clear();
        options.changed();
    };
    const unavailable = (message: string) => {
        ready = false;
        options.status(`Conditional filters unavailable: ${message}`, true);
    };

    // No schema/name guesses, name-to-ID conversion or permissive flag coercion.
    // A malformed/unresolvable rule keeps this selector unavailable.
    try {
        if (!Array.isArray(configured)) throw new Error();
        const ids = new Set<string>();
        rules = configured.map((entry) => {
            if (
                entry.idOrName.type !== 'id' ||
                entry.idOrName.id === '' ||
                ids.has(entry.idOrName.id) ||
                (entry.config.type !== 'multipleRecordLinks' &&
                    entry.config.type !== 'multipleLookupValues')
            )
                throw new Error();
            const config = entry.config.config;
            if (
                (config?.title != null && typeof config.title !== 'string') ||
                (config?.disableAddingIfConditionalFilterIsEmpty !==
                    undefined &&
                    typeof config.disableAddingIfConditionalFilterIsEmpty !==
                        'boolean') ||
                (config?.disableRemovingIfConditionalFilterIsEmpty !==
                    undefined &&
                    typeof config.disableRemovingIfConditionalFilterIsEmpty !==
                        'boolean')
            )
                throw new Error();
            const id = entry.idOrName.id;
            ids.add(id);
            values.set(id, null);
            return {
                id,
                title: config?.title ?? null,
                disableAdding:
                    config?.disableAddingIfConditionalFilterIsEmpty === true,
                disableRemoving:
                    config?.disableRemovingIfConditionalFilterIsEmpty === true,
            };
        });
    } catch {
        validConfiguration = false;
    }

    const renderChoices = (filter: Filter) => {
        filter.select.replaceChildren();
        const blank = element('option', '—');
        blank.value = '';
        filter.select.append(blank);
        const accepted = values.get(filter.id);
        const candidates = new Map(filter.candidates);
        if (accepted != null) candidates.set(accepted.recordId, accepted);
        const labelCounts = new Map<string, number>();
        for (const choice of candidates.values())
            labelCounts.set(
                choice.stringValue,
                (labelCounts.get(choice.stringValue) ?? 0) + 1
            );
        for (const choice of candidates.values()) {
            const label =
                labelCounts.get(choice.stringValue) === 1
                    ? choice.stringValue
                    : `${choice.stringValue} (${choice.recordId})`;
            const option = element('option', label);
            option.value = choice.recordId;
            filter.select.append(option);
        }
        filter.select.value = accepted?.recordId ?? '';
    };

    const load = async (
        index: number,
        context: RequestContext,
        usePrefill = false
    ) => {
        if (!current() || !context.current() || !ready) return;
        const filter = filters[index];
        if (filter == null || !filter.select.isConnected) return;
        const previous = index === 0 ? null : values.get(filters[index - 1].id);
        const url = options.query[`prefill_${filter.name}`];
        if (usePrefill && url != null && typeof url !== 'string') {
            options.status(
                'Repeated conditional filter URL values are unsupported.',
                true
            );
            return;
        }
        const controller = new AbortController();
        const abort = () => controller.abort();
        context.signal.addEventListener('abort', abort, { once: true });
        if (context.signal.aborted) controller.abort();
        pending.add(controller);
        const capturedRevision = revision;
        const capturedSession = context.client.getSession();
        const capturedSessionKey = sessionKey(context.client);
        const accepts = () =>
            current() &&
            context.current() &&
            !controller.signal.aborted &&
            revision === capturedRevision &&
            filters[index] === filter &&
            sessionKey(context.client) === capturedSessionKey;
        try {
            controller.signal.throwIfAborted();
            const result =
                await context.client.linkedRecords.listConditionalFilterPrimaryValues(
                    {
                        extensionAccessToken: options.extensionAccessToken,
                        mainTableLinkedRecordsFieldId:
                            options.schema.airtableField.id,
                        linkedRecordsFilterFieldId: filter.id,
                        searchTerm:
                            usePrefill && typeof url === 'string'
                                ? url
                                : filter.search.value,
                        filterData:
                            previous == null
                                ? null
                                : {
                                      previousFilterFieldId:
                                          filters[index - 1].id,
                                      previousFilterPrimaryValue:
                                          previous.stringValue,
                                  },
                        urlSearchValue:
                            usePrefill && typeof url === 'string' ? url : null,
                    },
                    { signal: controller.signal, session: capturedSession }
                );
            if (!accepts()) return;
            if (
                !Array.isArray(result.primaryValues) ||
                result.primaryValues.some((value) => !pair(value))
            )
                throw new Error(
                    'The filter response contains malformed choices.'
                );
            const candidates = new Map<string, ConditionalFilterPrimaryValue>();
            for (const choice of result.primaryValues) {
                if (candidates.has(choice.recordId))
                    throw new Error(
                        'The filter response repeats a record identity.'
                    );
                candidates.set(choice.recordId, { ...choice });
            }
            if (usePrefill && typeof url === 'string') {
                const prefill = result.prefillValue;
                if (
                    prefill != null &&
                    (!pair(prefill) ||
                        candidates.get(prefill.recordId)?.stringValue !==
                            prefill.stringValue)
                )
                    throw new Error(
                        'The filter response contains an unresolved prefill.'
                    );
                const earlier = values.get(filter.id);
                values.set(filter.id, prefill == null ? null : { ...prefill });
                if (
                    earlier?.recordId !== prefill?.recordId ||
                    earlier?.stringValue !== prefill?.stringValue
                ) {
                    for (const later of filters.slice(index + 1)) {
                        values.set(later.id, null);
                        later.candidates.clear();
                        later.search.value = '';
                        renderChoices(later);
                    }
                }
                options.changed();
            }
            filter.candidates = candidates;
            renderChoices(filter);
            options.status(
                `Loaded ${candidates.size} filter choices. Search to refine; this read has no paging cursor.`
            );
        } catch (error) {
            if (accepts()) throw error;
        } finally {
            context.signal.removeEventListener('abort', abort);
            pending.delete(controller);
        }
    };

    const initialize = async (context: RequestContext) => {
        if (!current() || !context.current()) return;
        if (!validConfiguration) {
            unavailable(
                'only unique configured field IDs and valid flags are supported.'
            );
            return;
        }
        const capturedRevision = revision;
        const capturedSession = sessionKey(context.client);
        const states = await options.readMetadata(context);
        if (
            !current() ||
            !context.current() ||
            revision !== capturedRevision ||
            sessionKey(context.client) !== capturedSession
        )
            return;
        const table =
            states[options.schema.airtableField.config.options.linkedTableId];
        if (table == null || !Array.isArray(table.airtableFields)) {
            unavailable(
                'the authorized read did not return this linked table.'
            );
            return;
        }
        if (
            table.airtableFields.some(
                (field) =>
                    field == null ||
                    typeof field.id !== 'string' ||
                    field.id === ''
            )
        ) {
            unavailable(
                'the authorized metadata contains a malformed field identity.'
            );
            return;
        }
        const metadataIds = table.airtableFields.map((field) => field.id);
        if (new Set(metadataIds).size !== metadataIds.length) {
            unavailable('the authorized metadata repeats a field identity.');
            return;
        }
        const resolved = rules.map((rule) => ({
            rule,
            field: table.airtableFields.find((field) => field.id === rule.id),
        }));
        if (
            resolved.some(
                ({ field }) =>
                    field == null ||
                    typeof field.name !== 'string' ||
                    field.name === ''
            )
        ) {
            unavailable(
                'a configured filter field/name is absent from the authorized metadata.'
            );
            return;
        }
        invalidate();
        // Hidden controls stay hidden while their server prefills resolve.
        const currentConfig = options.schema.miniExtConfig;
        fields.hidden =
            currentConfig != null &&
            'conditionalLinkedRecordFilteringFieldsType' in currentConfig &&
            currentConfig.conditionalLinkedRecordFilteringFieldsType === 'hide';
        fields.replaceChildren();
        filters = resolved.map(({ rule, field }) => {
            if (field == null) throw new Error('Missing resolved filter.');
            const search = element('input');
            search.dataset.filterSearchFieldId = rule.id;
            const select = element('select');
            select.dataset.filterFieldId = rule.id;
            const filter: Filter = {
                ...rule,
                name: field.name,
                search,
                select,
                candidates: new Map(),
            };
            renderChoices(filter);
            search.addEventListener('input', () => {
                if (
                    !current() ||
                    !filters.includes(filter) ||
                    !search.isConnected
                )
                    return;
                invalidate();
                filter.candidates.clear();
                renderChoices(filter);
            });
            select.addEventListener('change', () => {
                if (
                    !current() ||
                    !ready ||
                    !filters.includes(filter) ||
                    !select.isConnected
                )
                    return;
                const accepted = values.get(rule.id);
                const next =
                    select.value === ''
                        ? null
                        : (filter.candidates.get(select.value) ??
                          (accepted?.recordId === select.value
                              ? accepted
                              : undefined));
                if (next === undefined) {
                    renderChoices(filter);
                    options.status('Choose a returned filter record.', true);
                    return;
                }
                const previous = values.get(rule.id);
                if (
                    previous?.recordId === next?.recordId &&
                    previous?.stringValue === next?.stringValue
                )
                    return;
                invalidate();
                values.set(rule.id, next == null ? null : { ...next });
                const index = filters.indexOf(filter);
                for (const later of filters.slice(index + 1)) {
                    values.set(later.id, null);
                    later.candidates.clear();
                    later.search.value = '';
                    renderChoices(later);
                }
                renderChoices(filter);
                options.changed();
            });
            const title = rule.title ?? field.name;
            fields.append(
                labeled(`Search ${title}`, search),
                button(`Search ${title}`, () => {
                    if (
                        current() &&
                        filters.includes(filter) &&
                        search.isConnected
                    )
                        options.request(
                            'Loading configured filter choices…',
                            (request) => load(filters.indexOf(filter), request)
                        );
                }),
                labeled(title, select)
            );
            return filter;
        });
        ready = true;
        for (let index = 0; index < filters.length; index++) {
            if (!current() || !context.current() || !ready) return;
            const url = options.query[`prefill_${filters[index].name}`];
            if (url != null) await load(index, context, true);
        }
    };

    node.append(
        button('Load conditional filters', () => {
            if (current())
                options.request(
                    'Loading authorized filter metadata…',
                    initialize
                );
        }),
        fields
    );
    return {
        node,
        snapshot: () =>
            ready
                ? Object.fromEntries(
                      Array.from(values, ([id, value]) => [
                          id,
                          value == null ? null : { ...value },
                      ])
                  )
                : {},
        revision: () => revision,
        canChange: (adding) =>
            current() &&
            validPolicy &&
            policyRules.every(
                (rule) =>
                    !(adding ? rule.disableAdding : rule.disableRemoving) ||
                    (ready &&
                        rule.id != null &&
                        values.get(rule.id)?.stringValue != null &&
                        values.get(rule.id)?.stringValue !== '')
            ),
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            invalidate();
            filters = [];
            fields.replaceChildren();
        },
    };
}
