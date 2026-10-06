import type {
    ConditionalLinkedRecordFilteringValues,
    MiniExtensionsClient,
    RuntimeFieldSchema,
    RuntimeQuery,
    RuntimeTableStates,
} from '@miniextensions/sdk';
import { createFormLinkedFilterModel } from '@miniextensions/sdk/forms';
import { button, element, labeled } from './dom.js';

type RequestContext = {
    client: MiniExtensionsClient;
    signal: AbortSignal;
    current(): boolean;
};
type Filter = {
    id: string;
    search: HTMLInputElement;
    select: HTMLSelectElement;
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

/** DOM/network adapter for the single SDK cascade model. */
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
        config && 'conditionalLinkedRecordFilterFields' in config
            ? config.conditionalLinkedRecordFilterFields
            : undefined;
    if (
        configured == null ||
        (Array.isArray(configured) && configured.length === 0)
    )
        return null;
    const query = structuredClone(options.query);
    const model = createFormLinkedFilterModel({
        schema: options.schema,
        query,
    });
    const node = element('div', undefined, 'conditional-linked-filters');
    node.dataset.linkedFilterFieldId = options.schema.airtableField.id;
    const fields = element('div');
    const pending = new Set<AbortController>();
    let filters: Filter[] = [];
    let destroyed = false;
    let initialization = 0;
    const current = () => !destroyed && node.isConnected && options.current();
    const changed = () => {
        for (const controller of pending) controller.abort();
        pending.clear();
        options.changed();
    };
    const render = () => {
        const state = model.state();
        for (const filter of filters) {
            const value = state.filters.find((value) => value.id === filter.id);
            if (!value) continue;
            filter.search.value = value.search;
            filter.select.replaceChildren();
            const blank = element('option', '—');
            blank.value = '';
            filter.select.append(blank);
            const candidates = new Map(
                value.candidates.map((pair) => [pair.recordId, pair])
            );
            if (value.selected)
                candidates.set(value.selected.recordId, value.selected);
            const counts = new Map<string, number>();
            for (const pair of candidates.values())
                counts.set(
                    pair.stringValue,
                    (counts.get(pair.stringValue) ?? 0) + 1
                );
            for (const pair of candidates.values()) {
                const option = element(
                    'option',
                    counts.get(pair.stringValue) === 1
                        ? pair.stringValue
                        : `${pair.stringValue} (${pair.recordId})`
                );
                option.value = pair.recordId;
                filter.select.append(option);
            }
            filter.select.value = value.selected?.recordId ?? '';
        }
    };
    const load = async (
        filter: Filter,
        context: RequestContext,
        usePrefill = false
    ) => {
        if (
            !current() ||
            !context.current() ||
            !filters.includes(filter) ||
            !filter.select.isConnected
        )
            return;
        const plan = model.prepareRead(filter.id, { usePrefill });
        if (plan.status !== 'ready') {
            options.status(plan.diagnostic, true);
            return;
        }
        const controller = new AbortController();
        const abort = () => controller.abort();
        context.signal.addEventListener('abort', abort, { once: true });
        if (context.signal.aborted) controller.abort();
        pending.add(controller);
        const session = context.client.getSession();
        const key = sessionKey(context.client);
        const owned = () =>
            current() &&
            context.current() &&
            !controller.signal.aborted &&
            sessionKey(context.client) === key;
        const accepts = () => owned() && model.isCurrent(plan.ticket);
        try {
            controller.signal.throwIfAborted();
            const result =
                await context.client.linkedRecords.listConditionalFilterPrimaryValues(
                    {
                        extensionAccessToken: options.extensionAccessToken,
                        ...plan.input,
                    },
                    { signal: controller.signal, session }
                );
            if (!accepts()) return;
            const accepted = model.accept(plan.ticket, result);
            if (accepted.status === 'invalid') {
                options.status(accepted.diagnostic, true);
                return;
            }
            if (accepted.status !== 'accepted') return;
            render();
            if (accepted.changed) changed();
            options.status(
                `Loaded ${result.primaryValues.length} filter choices. Search to refine; this read has no paging cursor.`
            );
        } catch (error) {
            if (accepts()) throw error;
        } finally {
            model.discard(plan.ticket);
            context.signal.removeEventListener('abort', abort);
            pending.delete(controller);
        }
    };
    const initialize = async (context: RequestContext) => {
        if (
            !current() ||
            !context.current() ||
            model.state().status === 'ready'
        )
            return;
        if (model.state().diagnostics.length !== 0) {
            options.status(
                `Conditional filters unavailable: ${model.state().diagnostics.join(' ')}`,
                true
            );
            return;
        }
        const version = ++initialization;
        const generation = model.state().generation;
        const key = sessionKey(context.client);
        const accepts = () =>
            current() &&
            context.current() &&
            version === initialization &&
            generation === model.state().generation &&
            sessionKey(context.client) === key;
        let states: RuntimeTableStates;
        try {
            states = await options.readMetadata(context);
        } catch (error) {
            if (accepts()) throw error;
            return;
        }
        if (!accepts()) return;
        const state = model.initialize(states);
        if (state.status !== 'ready') {
            options.status(
                `Conditional filters unavailable: ${state.diagnostics.join(' ')}`,
                true
            );
            return;
        }
        changed();
        fields.hidden = state.hidden;
        fields.replaceChildren();
        filters = state.filters.map((value) => {
            const search = element('input');
            search.dataset.filterSearchFieldId = value.id;
            const select = element('select');
            select.dataset.filterFieldId = value.id;
            const filter = { id: value.id, search, select };
            search.addEventListener('input', () => {
                if (
                    current() &&
                    filters.includes(filter) &&
                    search.isConnected &&
                    model.search(value.id, search.value)
                ) {
                    changed();
                    render();
                }
            });
            select.addEventListener('change', () => {
                if (
                    !current() ||
                    !filters.includes(filter) ||
                    !select.isConnected
                )
                    return;
                const generation = model.state().generation;
                if (
                    !model.choose(
                        value.id,
                        select.value === '' ? null : select.value
                    )
                )
                    options.status('Choose a returned filter record.', true);
                else if (generation !== model.state().generation) changed();
                render();
            });
            const title = value.title ?? value.name;
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
                            (context) => load(filter, context)
                        );
                }),
                labeled(title, select)
            );
            return filter;
        });
        render();
        for (const filter of filters) {
            if (!current() || !context.current()) return;
            const name = model
                .state()
                .filters.find((value) => value.id === filter.id)!.name;
            if (query[`prefill_${name}`] != null)
                await load(filter, context, true);
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
        snapshot: () => model.snapshot(),
        revision: () => model.state().generation,
        canChange: (adding) => current() && model.canChange(adding),
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            initialization++;
            model.dispose();
            changed();
            filters = [];
            fields.replaceChildren();
        },
    };
}
