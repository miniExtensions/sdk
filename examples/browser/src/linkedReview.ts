import type {
    FormLoadedResult,
    ListLinkedRecordOptionsResult,
    RuntimeTableStates,
} from '@miniextensions/sdk';
import { getReadableStringFromAirtableValue } from '@miniextensions/sdk/formulas';
import { hasMaskedValuePolicy } from './privacy.js';

export const unavailableLinkedAnswer = 'Selected record — details unavailable';
const object = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);
// Cloning and JSON erase prototypes and invoke accessors. Accept policy data
// only before either operation, and repeat this check for live invalidation.
const plainData = (value: unknown, seen = new Set<object>()): boolean => {
    if (value === null || value === undefined) return true;
    if (typeof value !== 'object')
        return ['string', 'number', 'boolean'].includes(typeof value);
    if (seen.has(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (
        Array.isArray(value)
            ? prototype !== Array.prototype
            : prototype !== Object.prototype && prototype !== null
    )
        return false;
    seen.add(value);
    const valid = Reflect.ownKeys(value).every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        return (
            typeof key === 'string' &&
            (descriptor.enumerable ||
                (Array.isArray(value) && key === 'length')) &&
            'value' in descriptor &&
            plainData(descriptor.value, seen)
        );
    });
    seen.delete(value);
    return valid;
};

const invalidData = Symbol('invalid policy data');
const ownData = (owner: unknown, key: string): unknown => {
    if (!object(owner)) return invalidData;
    const prototype = Object.getPrototypeOf(owner);
    if (prototype !== Object.prototype && prototype !== null)
        return invalidData;
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (!descriptor) return undefined;
    return descriptor.enumerable && 'value' in descriptor
        ? descriptor.value
        : invalidData;
};

// Snapshot array slots without invoking a custom iterator or indexed getter.
// Raw field values are deliberately not traversed before masking decisions.
const ownArray = (value: unknown): unknown[] | undefined => {
    if (
        !Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Array.prototype
    )
        return undefined;
    const length = Object.getOwnPropertyDescriptor(value, 'length')!
        .value as number;
    if (Reflect.ownKeys(value).length !== length + 1) return undefined;
    const result: unknown[] = [];
    for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(
            value,
            String(index)
        );
        if (!descriptor?.enumerable || !('value' in descriptor))
            return undefined;
        result.push(descriptor.value);
    }
    return result;
};

const plainTypes = new Set([
    'singleLineText',
    'multilineText',
    'email',
    'phoneNumber',
    'number',
    'currency',
    'percent',
    'rating',
    'checkbox',
]);

/** One render lifetime only. Reads are accepted by the adapter before this call. */
export function createLinkedReviewPresentation(
    page: FormLoadedResult,
    current: () => boolean
) {
    const policies = new Map<
        string,
        {
            tableId: string;
            config: Record<string, unknown>;
            details: unknown;
            original: Set<string>;
        }
    >();
    const readPolicy = () => {
        const payload = ownData(page, 'payload');
        const ids = ownData(payload, 'fieldIdsInForm');
        const schemas = ownData(payload, 'fieldIdsToSchemas');
        const details = ownData(payload, 'linkedRecordFieldIdToDetailFields');
        if (
            !object(payload) ||
            !Array.isArray(ids) ||
            !plainData(ids) ||
            !ids.every((id) => typeof id === 'string') ||
            !object(schemas) ||
            !plainData([ids, schemas, details])
        )
            return undefined;
        return {
            payload: payload as unknown as FormLoadedResult['payload'],
            ids,
            schemas,
            details,
        };
    };
    const initial = readPolicy();
    for (const fieldId of initial?.ids ?? []) {
        const schema = initial!.schemas[
            fieldId
        ] as FormLoadedResult['payload']['fieldIdsToSchemas'][string];
        if (
            !plainData(schema) ||
            schema?.fieldType !== 'multipleRecordLinks' ||
            !object(schema.airtableField) ||
            !object(schema.airtableField.config) ||
            schema.airtableField.config.type !== 'multipleRecordLinks' ||
            !object(schema.airtableField.config.options) ||
            typeof schema.airtableField.config.options.linkedTableId !==
                'string'
        )
            continue;
        const value = ownArray(
            ownData(
                ownData(ownData(initial!.payload, 'formRecord'), 'data'),
                fieldId
            )
        );
        const config = schema.miniExtConfig ?? {};
        const details = object(initial!.details)
            ? ownData(initial!.details, fieldId)
            : undefined;
        policies.set(fieldId, {
            tableId: schema.airtableField.config.options.linkedTableId,
            config: plainData(config)
                ? (structuredClone(config) as Record<string, unknown>)
                : {},
            details: plainData(config) ? structuredClone(details) : undefined,
            original: new Set(
                Array.isArray(value)
                    ? value.filter(
                          (id): id is string =>
                              typeof id === 'string' && id.trim() !== ''
                      )
                    : []
            ),
        });
    }
    const policyBytes = (): string | undefined => {
        const policy = readPolicy();
        if (!policy) return undefined;
        return JSON.stringify([
            policy.details,
            policy.ids,
            [...policies.keys()].map((id) => policy.schemas[id]),
        ]);
    };
    const capturedPolicy = policyBytes();
    const labels = new Map<string, Map<string, string>>();
    let invalidation = new AbortController();
    let epoch = 0,
        retired = false;
    const active = (): boolean => {
        if (
            !retired &&
            (capturedPolicy === undefined || policyBytes() !== capturedPolicy)
        )
            retire();
        return !retired && current();
    };
    const retire = () => {
        retired = true;
        labels.clear();
        epoch++;
        invalidation.abort();
    };
    const replace = (fieldId: string, next: Map<string, string>) => {
        if (retired) return;
        labels.set(fieldId, next);
        epoch++;
        const previous = invalidation;
        invalidation = new AbortController();
        previous.abort();
    };
    const build = (fieldId: string, inputRecords: unknown, table: unknown) => {
        const next = new Map<string, string>();
        const policy = policies.get(fieldId);
        const metadata = ownData(table, 'airtableFields');
        const records = ownArray(inputRecords);
        if (
            !policy ||
            !Array.isArray(metadata) ||
            !plainData(metadata) ||
            !records ||
            !Array.isArray(policy.details)
        )
            return next;
        // Capture validated own metadata once; later record access cannot change
        // the authorized field identity or redirect its name fallback.
        const fields = structuredClone(
            metadata
        ) as RuntimeTableStates[string]['airtableFields'];
        const fieldIds = new Set<string>();
        for (const field of fields) {
            if (
                !object(field) ||
                typeof field.id !== 'string' ||
                field.id.trim() === '' ||
                fieldIds.has(field.id) ||
                typeof field.name !== 'string' ||
                !object(field.config) ||
                (field.isComputed !== undefined &&
                    typeof field.isComputed !== 'boolean') ||
                (field.isPrimaryField !== undefined &&
                    typeof field.isPrimaryField !== 'boolean')
            )
                return next;
            fieldIds.add(field.id);
        }
        const detailIds = new Set<string>();
        for (const detail of policy.details) {
            if (
                !object(detail) ||
                typeof detail.fieldId !== 'string' ||
                detail.fieldId.trim() === '' ||
                detailIds.has(detail.fieldId)
            )
                return next;
            detailIds.add(detail.fieldId);
        }
        const configured = policy.config.customPrimaryField;
        if (
            configured != null &&
            (typeof configured !== 'string' || configured.trim() === '')
        )
            return next;
        const primaries = fields.filter((field) =>
            configured == null
                ? field.isPrimaryField === true
                : field.id === configured
        );
        if (primaries.length !== 1) return next;
        const primary = primaries[0];
        const detail = policy.details.find(
            (detail) => detail.fieldId === primary.id
        );
        if (
            !object(detail) ||
            detail.fieldName !== primary.name ||
            detail.isHidden !== false ||
            (detail.miniExtConfig != null && !object(detail.miniExtConfig))
        )
            return next;
        const config = detail.miniExtConfig ?? {};
        for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen'])
            if (config[flag] !== undefined && typeof config[flag] !== 'boolean')
                return next;
        if (primary.isComputed === true || !plainTypes.has(primary.config.type))
            return next;
        const recordIds = new Set<string>();
        for (const record of records) {
            const recordId = ownData(record, 'id');
            const recordFields = ownData(record, 'fields');
            if (
                typeof recordId !== 'string' ||
                recordId.trim() === '' ||
                recordIds.has(recordId) ||
                !object(recordFields)
            )
                return new Map<string, string>();
            recordIds.add(recordId);
            // Never retain raw values; privacy decisions precede value access.
            if (hasMaskedValuePolicy(config)) {
                next.set(recordId, '••••••••');
                continue;
            }
            // Masking has priority; rich presentation never reads a raw URL.
            if (
                config.displayAsAttachments === true ||
                config.displayAsButton === true
            )
                continue;
            // An own ID is authoritative even when its value is unavailable.
            // Name fallback is permitted only for a unique, non-colliding name.
            const idValue = Object.getOwnPropertyDescriptor(
                recordFields,
                primary.id
            );
            const nameIsUnique =
                fields.filter((field) => field.name === primary.name).length ===
                1;
            const nameCollides = fields.some(
                (field) => field.id !== primary.id && field.id === primary.name
            );
            const selected =
                idValue ??
                (nameIsUnique && !nameCollides
                    ? Object.getOwnPropertyDescriptor(
                          recordFields,
                          primary.name
                      )
                    : undefined);
            if (!selected || !('value' in selected)) continue;
            const value = selected.value;
            if (
                value == null ||
                (typeof value === 'string' && value.trim() === '') ||
                typeof value === 'object'
            )
                continue;
            const numeric = [
                'number',
                'currency',
                'percent',
                'rating',
            ].includes(primary.config.type);
            if (
                numeric
                    ? typeof value !== 'number' || !Number.isFinite(value)
                    : primary.config.type === 'checkbox'
                      ? typeof value !== 'boolean'
                      : typeof value !== 'string'
            )
                continue;
            try {
                const text = getReadableStringFromAirtableValue({
                    value,
                    airtableFieldConfig: primary.config,
                    source: { type: 'airtableMock', linkedTableStates: {} },
                    fieldName: '',
                    doNotRemoveMarkdownFormatting: true,
                });
                if (typeof text === 'string' && text.trim() !== '')
                    next.set(recordId, text);
            } catch {
                /* Generic fallback, without raw diagnostic content. */
            }
        }
        return next;
    };
    return {
        retire,
        revision: () => epoch,
        acceptHydration(result: RuntimeTableStates) {
            if (!active()) return;
            for (const [fieldId, policy] of policies) {
                if (retired) return;
                const table = ownData(result, policy.tableId);
                const recordMap = ownData(table, 'recordIdsToAirtableRecords');
                const records = [...policy.original].flatMap((id) => {
                    const record = ownData(recordMap, id);
                    return ownData(record, 'id') === id ? [record] : [];
                });
                replace(fieldId, build(fieldId, records, table));
            }
        },
        acceptOptions(fieldId: string, result: ListLinkedRecordOptionsResult) {
            if (!active()) return;
            const policy = policies.get(fieldId);
            if (!policy) return;
            replace(
                fieldId,
                build(
                    fieldId,
                    ownData(result, 'records'),
                    ownData(
                        ownData(result, 'tableIdsToLinkedTableStates'),
                        policy.tableId
                    )
                )
            );
        },
        snapshot() {
            const revision = epoch;
            const signal = invalidation.signal;
            const copy = active()
                ? new Map(
                      [...labels].map(([id, values]) => [id, new Map(values)])
                  )
                : new Map<string, Map<string, string>>();
            return {
                signal,
                forPage: (loaded: FormLoadedResult) => loaded === page,
                current: () => active() && epoch === revision,
                label: (fieldId: string, recordId: string) =>
                    active() && epoch === revision
                        ? (copy.get(fieldId)?.get(recordId) ??
                          unavailableLinkedAnswer)
                        : unavailableLinkedAnswer,
            };
        },
    };
}
export type LinkedReviewSnapshot = ReturnType<
    ReturnType<typeof createLinkedReviewPresentation>['snapshot']
>;
