import type { LinkedRecordSelectionPage, SelectionPage } from './types.js';
import type { MiniExtensionsClient } from '../runtime/types.js';

// Request-local payloads are not presentation state. Only SelectionModel may
// promote this data after its generation, abort and loader scope checks pass.
export type LinkedRecordPageOrigin = {
    client: MiniExtensionsClient;
    kind: 'form' | 'portal';
    fieldId: string;
    token: string;
    isCurrent(): boolean;
};
const payloads = new WeakMap<
    SelectionPage,
    { data: LinkedRecordSelectionPage; origin: LinkedRecordPageOrigin }
>();
const origins = new WeakMap<
    LinkedRecordSelectionPage,
    LinkedRecordPageOrigin
>();
const retiredOrigins = new WeakSet<LinkedRecordPageOrigin>();

function observeCurrent(origin: LinkedRecordPageOrigin): boolean {
    if (retiredOrigins.has(origin)) return false;
    let live = false;
    try {
        live = origin.isCurrent();
    } catch {
        /* Unreadable source is stale. */
    }
    if (!live) retiredOrigins.add(origin);
    return live;
}

function requireCurrent(origin: LinkedRecordPageOrigin): void {
    if (!observeCurrent(origin))
        throw new Error(
            'The linked record page context changed. Read again in the current scope.'
        );
}

/** Keep existing custom option behavior, but do not promote a foreign SDK rich page. */
export function guardFormLinkedRecordPage(
    page: SelectionPage,
    client: MiniExtensionsClient,
    token: string,
    fieldId: string,
    linkedTableId: string
): SelectionPage {
    const payload = payloads.get(page);
    if (!payload) return page;
    requireCurrent(payload.origin);
    return payload.origin.client === client &&
        payload.origin.kind === 'form' &&
        payload.origin.token === token &&
        payload.origin.fieldId === fieldId &&
        payload.data.linkedTableId === linkedTableId
        ? page
        : { options: structuredClone(page.options), offset: page.offset };
}

export function linkedRecordPageIsCurrent(
    page: LinkedRecordSelectionPage
): boolean {
    const origin = origins.get(page);
    if (!origin) return false;
    return observeCurrent(origin);
}

export function attachLinkedRecordPage(
    page: SelectionPage,
    payload: LinkedRecordSelectionPage,
    origin: LinkedRecordPageOrigin
): void {
    const fields = new Set<string>();
    for (const field of payload.table?.airtableFields ?? []) {
        if (fields.has(field.id))
            throw new TypeError(
                'The linked record page has duplicate field metadata.'
            );
        fields.add(field.id);
    }
    const ids = new Set<string>();
    for (const record of payload.records) {
        if (ids.has(record.id))
            throw new TypeError(
                'The linked record page has duplicate identities.'
            );
        ids.add(record.id);
    }
    payloads.set(page, { data: structuredClone(payload), origin });
}

export function acceptedLinkedRecordPage(
    page: SelectionPage,
    previous: LinkedRecordSelectionPage | null,
    append: boolean
): LinkedRecordSelectionPage | null {
    const payload = payloads.get(page);
    if (!payload) return null;
    requireCurrent(payload.origin);
    const next = structuredClone(payload.data);
    if (
        append &&
        previous?.linkedTableId === next.linkedTableId &&
        origins.get(previous) === payload.origin
    ) {
        const records = new Map(
            previous.records.map((record) => [record.id, record])
        );
        for (const record of next.records) records.set(record.id, record);
        next.records = structuredClone([...records.values()]);
    }
    origins.set(next, payload.origin);
    return next;
}
