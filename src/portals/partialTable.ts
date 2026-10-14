import type { AirtableValue, RuntimeAirtableField } from '../runtime/types.js';

/** Structural field identity for an already accepted partial cache response. */
export type PortalPartialField = { id: string; name: string };

export type PortalPartialRecord<Value = AirtableValue> = {
    id: string;
    fields: Record<string, Value>;
};

export type PortalPartialRecords<Value = AirtableValue> = Record<
    string,
    PortalPartialRecord<Value>
>;

export type PortalPartialTableState<
    Field extends PortalPartialField = RuntimeAirtableField,
    Value = AirtableValue,
> = {
    airtableFields: Field[];
    recordIdsToAirtableRecords: PortalPartialRecords<Value>;
};

/**
 * Opt-in hosted partial-cache policy. Incoming cells overwrite earlier cells;
 * omitted non-boolean cells remain because a table schema can be a union of
 * several partial record fetches. Only a fetched, earlier boolean is removed
 * when the incoming record omits it or explicitly supplies null/undefined.
 * Missing incoming records never clear earlier cells.
 *
 * Callers must accept and scope responses before merging. This transform does
 * not authorize a read/action or establish current view/schema provenance.
 */
export const mergePortalPartialRecords = <Value>(
    previous: {
        recordIdsToAirtableRecords: Readonly<PortalPartialRecords<Value>>;
    },
    incoming: {
        fieldKeysIncludedInRecords?: readonly string[];
        recordIdsToAirtableRecords: Readonly<PortalPartialRecords<Value>>;
    }
): PortalPartialRecords<Value> => {
    const includedKeys = incoming.fieldKeysIncludedInRecords ?? [];
    const result: PortalPartialRecords<Value> = {};
    const recordIds = new Set([
        ...Object.keys(previous.recordIdsToAirtableRecords),
        ...Object.keys(incoming.recordIdsToAirtableRecords),
    ]);

    for (const recordId of recordIds) {
        const previousRecord = Object.hasOwn(
            previous.recordIdsToAirtableRecords,
            recordId
        )
            ? previous.recordIdsToAirtableRecords[recordId]
            : undefined;
        const incomingRecord = Object.hasOwn(
            incoming.recordIdsToAirtableRecords,
            recordId
        )
            ? incoming.recordIdsToAirtableRecords[recordId]
            : undefined;
        const previousFields = previousRecord?.fields ?? {};
        const incomingFields = incomingRecord?.fields ?? {};
        const record: PortalPartialRecord<Value> = {
            id: recordId,
            fields: { ...previousFields, ...incomingFields },
        };

        if (incomingRecord != null) {
            for (const key of includedKeys) {
                if (
                    Object.hasOwn(previousFields, key) &&
                    typeof previousFields[key] === 'boolean' &&
                    (!Object.hasOwn(incomingFields, key) ||
                        incomingFields[key] == null)
                ) {
                    delete record.fields[key];
                }
            }
        }

        // A field/record name such as __proto__ is data, never a setter.
        Object.defineProperty(result, recordId, {
            value: record,
            enumerable: true,
            configurable: true,
            writable: true,
        });
    }

    return result;
};

/**
 * Retain earlier metadata for matching field IDs and append incoming fields
 * whose IDs were absent from the earlier array. Repeated new incoming IDs are
 * intentionally retained, matching the hosted cache policy.
 */
export const mergePortalPartialFields = <Field extends { id: string }>(
    previous: readonly Field[],
    incoming: readonly Field[]
): Field[] => {
    const result = [...previous];
    for (const field of incoming) {
        if (!previous.some((earlier) => earlier.id === field.id)) {
            result.push(field);
        }
    }
    return result;
};

/**
 * Merge already accepted states within one caller-owned cache scope. Detect
 * ID-keyed records by matching any own cell key in either state against an
 * incoming field ID; otherwise use incoming field names. Metadata union is
 * cache completeness only: do not use it to admit actions or view projections.
 */
export const mergePortalPartialTableState = <
    Field extends PortalPartialField,
    Value,
>(
    previous: PortalPartialTableState<Field, Value>,
    incoming: PortalPartialTableState<Field, Value>
): PortalPartialTableState<Field, Value> => {
    // The final occurrence of a repeated incoming ID supplies its fetched name.
    const incomingFieldsById = new Map(
        incoming.airtableFields.map((field) => [field.id, field])
    );
    const recordFieldKeys = new Set(
        [
            ...Object.values(previous.recordIdsToAirtableRecords),
            ...Object.values(incoming.recordIdsToAirtableRecords),
        ].flatMap((record) => Object.keys(record.fields))
    );
    const recordsAreFieldIdKeyed = [...incomingFieldsById.values()].some(
        (field) => recordFieldKeys.has(field.id)
    );
    const includedKeys = [...incomingFieldsById.values()].map((field) =>
        recordsAreFieldIdKeyed ? field.id : field.name
    );

    return {
        airtableFields: mergePortalPartialFields(
            previous.airtableFields,
            incoming.airtableFields
        ),
        recordIdsToAirtableRecords: mergePortalPartialRecords(previous, {
            fieldKeysIncludedInRecords: includedKeys,
            recordIdsToAirtableRecords: incoming.recordIdsToAirtableRecords,
        }),
    };
};
