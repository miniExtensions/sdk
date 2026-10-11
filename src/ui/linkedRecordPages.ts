import type { LinkedRecordSelectionPage, SelectionPage } from './types.js';
import type {
    MiniExtensionsClient,
    RuntimeAirtableField,
} from '../runtime/types.js';

type LinkedRecordTable = {
    airtableFields: readonly RuntimeAirtableField[];
} | null;

/** Internal equality for detached JSON-like metadata, including own undefined keys. */
export function sameLinkedRecordTable(
    left: LinkedRecordTable,
    right: LinkedRecordTable
): boolean {
    const ancestors = new Set<object>();
    const equal = (a: unknown, b: unknown): boolean => {
        if (a === null || b === null) return a === b;
        if (typeof a !== typeof b) return false;
        if (typeof a !== 'object')
            return (
                ['undefined', 'string', 'boolean', 'number'].includes(
                    typeof a
                ) &&
                (typeof a !== 'number' || Number.isFinite(a)) &&
                Object.is(a, b)
            );
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        if (
            (!Array.isArray(a) &&
                (Object.getPrototypeOf(a) !== Object.prototype ||
                    Object.getPrototypeOf(b) !== Object.prototype)) ||
            ancestors.has(a) ||
            ancestors.has(b as object)
        )
            return false;
        if (Array.isArray(a) && a.length !== (b as unknown[]).length)
            return false;
        const keys = Object.keys(a);
        if (
            keys.length !== Object.keys(b as object).length ||
            Reflect.ownKeys(a).some((key) => typeof key !== 'string') ||
            Reflect.ownKeys(b as object).some((key) => typeof key !== 'string')
        )
            return false;
        ancestors.add(a);
        ancestors.add(b as object);
        try {
            return keys.every(
                (key) =>
                    Object.hasOwn(b as object, key) &&
                    equal(
                        (a as Record<string, unknown>)[key],
                        (b as Record<string, unknown>)[key]
                    )
            );
        } finally {
            ancestors.delete(a);
            ancestors.delete(b as object);
        }
    };
    try {
        return equal(left, right);
    } catch {
        return false;
    }
}

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
    {
        data: LinkedRecordSelectionPage;
        origin: LinkedRecordPageOrigin;
        readStamp: number;
    }
>();
const origins = new WeakMap<
    LinkedRecordSelectionPage,
    LinkedRecordPageOrigin
>();
const retiredOrigins = new WeakSet<LinkedRecordPageOrigin>();

// Private dispatch order shared by trusted option reads, token hydration and
// accepted Edit barriers. Arrival order does not establish post-mutation data.
let readSequence = 0;
export function nextLinkedRecordReadStamp(): number {
    return ++readSequence;
}

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
    origin: LinkedRecordPageOrigin,
    readStamp: number
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
    payloads.set(page, { data: structuredClone(payload), origin, readStamp });
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
        const nextIds = new Set(next.records.map((record) => record.id));
        const previousContributes = previous.records.some(
            (record) => !nextIds.has(record.id)
        );
        const nextContributes = next.records.length !== 0;
        for (const record of next.records) records.set(record.id, record);
        next.records = structuredClone([...records.values()]);
        if (previousContributes && !nextContributes)
            next.table = structuredClone(previous.table);
        else if (
            previousContributes &&
            nextContributes &&
            !sameLinkedRecordTable(previous.table, next.table)
        )
            next.table = null;
    }
    origins.set(next, payload.origin);
    return next;
}

// Private acceptance identity; detached snapshots cannot supply provenance.
const acceptedPageTickets = new WeakMap<
    object,
    {
        ticket: number;
        records: Map<string, number>;
        readStamps: Map<string, number>;
    }
>();
let acceptedPageSequence = 0;
export function markAcceptedLinkedRecordPage(
    model: object,
    page: SelectionPage
): void {
    const payload = payloads.get(page);
    if (!payload) return;
    const ticket = ++acceptedPageSequence;
    const records = new Map(acceptedPageTickets.get(model)?.records);
    const readStamps = new Map(acceptedPageTickets.get(model)?.readStamps);
    for (const record of payload.data.records) {
        records.set(record.id, ticket);
        readStamps.set(record.id, payload.readStamp);
    }
    acceptedPageTickets.set(model, { ticket, records, readStamps });
}
export function acceptedLinkedRecordReadStamp(
    model: object | null | undefined,
    recordId: string
): number {
    return (
        (model && acceptedPageTickets.get(model)?.readStamps.get(recordId)) || 0
    );
}
export function acceptedLinkedRecordPageTicket(
    model: object | null | undefined,
    recordId?: string
): number {
    const accepted = model && acceptedPageTickets.get(model);
    return accepted
        ? recordId === undefined
            ? accepted.ticket
            : (accepted.records.get(recordId) ?? 0)
        : 0;
}
