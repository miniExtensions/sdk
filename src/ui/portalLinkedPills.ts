import type { RuntimeAirtableField } from '../runtime/types.js';
import type { PortalCollectionSnapshot } from '../portals/types.js';
import type {
    AirtableFieldConfig,
    AirtableValue as ReadableValue,
} from '../formulas/types.js';
import { getReadableStringFromAirtableValue } from '../formulas/valueConversion.js';
import {
    createRendererProps,
    type PortalLinkedPillsRendererProps,
} from './rendererRegistry.js';

const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const ids = (value: unknown): value is readonly string[] =>
    Array.isArray(value) &&
    Array.from(value).every(
        (id, index) => Object.hasOwn(value, index) && typeof id === 'string'
    );
const needsRichPresentation = (config: unknown): boolean => {
    if (!object(config) || typeof config.type !== 'string') return true;
    if (
        ['multipleRecordLinks', 'multipleAttachments', 'button'].includes(
            config.type
        )
    )
        return true;
    if (
        [
            'formula',
            'rollup',
            'multipleLookupValues',
            'createdTime',
            'lastModifiedTime',
        ].includes(config.type)
    )
        return (
            !object(config.options) ||
            needsRichPresentation(config.options.result)
        );
    return false;
};

/** Pure presentation of original row/field occurrences; never a record resolver. */
export function portalLinkedPills(input: {
    field: RuntimeAirtableField;
    originalValue: unknown;
    value: unknown;
    tables: PortalCollectionSnapshot['tableIdsToLinkedTableStates'];
}): PortalLinkedPillsRendererProps {
    const original = new Set(
        ids(input.originalValue) ? input.originalValue : []
    );
    const values = ids(input.value) ? input.value : [];
    return {
        source: 'portal-pills',
        items: values.map((id, nativeIndex) => {
            const unavailable = {
                nativeIndex,
                state: 'unavailable' as const,
                label: null,
            };
            try {
                if (
                    id.trim() === '' ||
                    !original.has(id) ||
                    input.field.config.type !== 'multipleRecordLinks'
                )
                    return unavailable;
                const tableId = input.field.config.options.linkedTableId;
                if (!Object.hasOwn(input.tables, tableId)) return unavailable;
                const table = input.tables[tableId];
                if (
                    !table ||
                    !Array.isArray(table.airtableFields) ||
                    table.airtableFields.some(
                        (field) =>
                            !object(field) ||
                            typeof field.isPrimaryField !== 'boolean'
                    )
                )
                    return unavailable;
                const primaryFields = table.airtableFields.filter(
                    (field) => field.isPrimaryField === true
                );
                if (primaryFields.length !== 1) return unavailable;
                const primary = primaryFields[0];
                if (
                    typeof primary.id !== 'string' ||
                    primary.id.trim() === '' ||
                    table.airtableFields.filter(
                        (field) => field.id === primary.id
                    ).length !== 1 ||
                    table.airtableFields.filter(
                        (field) => field.name === primary.name
                    ).length !== 1 ||
                    !Object.hasOwn(table.recordIdsToAirtableRecords, id)
                )
                    return unavailable;
                const record = table.recordIdsToAirtableRecords[id];
                if (
                    !record ||
                    record.id !== id ||
                    !object(record.fields) ||
                    !Object.hasOwn(record.fields, primary.id)
                )
                    return unavailable;
                const value = record.fields[primary.id];
                // Ambiguous name aliases cannot change the declared ID value.
                if (
                    primary.name !== primary.id &&
                    Object.hasOwn(record.fields, primary.name) &&
                    JSON.stringify(record.fields[primary.name]) !==
                        JSON.stringify(value)
                )
                    return unavailable;
                if (
                    !createRendererProps({
                        physicalKind: primary.config.type,
                        fieldId: primary.id,
                        title: '',
                        field: primary,
                        displayConfig: undefined,
                        value,
                        context: 'portal-detail',
                        computed: primary.isComputed,
                        dirty: false,
                        pending: false,
                        validation: [],
                        error: null,
                        capability: { type: 'readonly' },
                    }) ||
                    needsRichPresentation(primary.config)
                )
                    return unavailable;
                const label = getReadableStringFromAirtableValue({
                    value: value as ReadableValue,
                    airtableFieldConfig: primary.config as AirtableFieldConfig,
                    fieldName: primary.name,
                    source: {
                        type: 'airtableMock',
                        linkedTableStates: {},
                        dateParsing: 'local',
                        doNotReturnRecordIdsForLinkedRecords: true,
                    },
                });
                return label.trim() === ''
                    ? { nativeIndex, state: 'blank' as const, label: null }
                    : { nativeIndex, state: 'resolved' as const, label };
            } catch {
                return unavailable;
            }
        }),
    };
}
