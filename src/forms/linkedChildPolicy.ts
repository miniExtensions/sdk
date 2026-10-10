import { getReadableStringFromAirtableValue } from '../formulas/valueConversion.js';
import type {
    AirtableFieldConfig as ReadableFieldConfig,
    AirtableValue as ReadableAirtableValue,
} from '../formulas/types.js';
import type {
    AirtableRecord,
    AirtableValue,
    FormLoadedResult,
    LinkedRecordPrefill,
    RuntimeFieldSchema,
} from '../runtime/types.js';
import type { FormLinkedRecordsSnapshot } from './linkedRecords.js';

export type LinkedChildPolicyUnavailableReason =
    | 'invalid-metadata'
    | 'unsupported-configuration'
    | 'create-disabled'
    | 'edit-disabled'
    | 'unavailable-edit-record'
    | 'invalid-native-value'
    | 'unavailable-selected-policy'
    | 'capacity-reached'
    | 'unavailable-inverse';
type Unavailable = {
    type: 'unavailable';
    reason: LinkedChildPolicyUnavailableReason;
};
export type LinkedChildCreatePolicy = {
    type: 'available';
    childExtensionId: string;
    parentFieldId: string;
    linkedTableId: string;
    parentInverseFieldId: string | null;
    maximum: number | null;
    selectedCount: number;
    nativeIds: string[];
    prefill: LinkedRecordPrefill;
};
const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
    typeof value === 'string' && value.trim() !== '';
const optionalEnum = (value: unknown, allowed: readonly string[]): boolean =>
    value == null || (typeof value === 'string' && allowed.includes(value));
const unavailable = (
    reason: LinkedChildPolicyUnavailableReason
): Unavailable => ({ type: 'unavailable', reason });
const recordIds = (value: unknown): string[] | null => {
    if (value == null || (typeof value === 'string' && value.trim() === ''))
        return [];
    if (!Array.isArray(value)) return null;
    return Array.from(value).every(
        (entry, index) => Object.hasOwn(value, index) && nonempty(entry)
    )
        ? [...value]
        : null;
};

/** Exact physical schema only; lookup/computed aliases are not child authority. */
const physicalLink = (loaded: FormLoadedResult, fieldId: string) => {
    const schemas = loaded.payload.fieldIdsToSchemas;
    if (!Object.hasOwn(schemas, fieldId)) return null;
    const matches = Object.values(schemas).filter(
        (schema) => schema?.airtableField?.id === fieldId
    );
    const schema = schemas[fieldId];
    if (
        matches.length !== 1 ||
        schema.fieldType !== 'multipleRecordLinks' ||
        schema.airtableField.config.type !== 'multipleRecordLinks' ||
        schema.airtableField.isComputed !== false ||
        !nonempty(schema.airtableField.name) ||
        !nonempty(schema.airtableField.config.options.linkedTableId) ||
        typeof schema.airtableField.config.options.prefersSingleRecordLink !==
            'boolean'
    )
        return null;
    return schema;
};
const readableScalar = (schema: RuntimeFieldSchema): boolean =>
    schema.airtableField.isComputed === false &&
    schema.fieldType === schema.airtableField.config.type &&
    [
        'singleLineText',
        'email',
        'url',
        'multilineText',
        'phoneNumber',
        'richText',
        'barcode',
        'singleSelect',
        'date',
        'dateTime',
    ].includes(schema.airtableField.config.type);

/** Pure configured modal-create plan. Visibility and owner leases belong to bindings. */
export function resolveLinkedChildCreatePolicy(input: {
    loaded: FormLoadedResult;
    fieldId: string;
    data: Readonly<Record<string, AirtableValue>>;
    linkedRecords?: FormLinkedRecordsSnapshot;
}): LinkedChildCreatePolicy | Unavailable {
    try {
        const { loaded, fieldId, data } = input;
        if (!object(data)) return unavailable('invalid-native-value');
        const schema = physicalLink(loaded, fieldId);
        if (!schema || !loaded.payload.fieldIdsInForm.includes(fieldId))
            return unavailable('invalid-metadata');
        if (schema.miniExtConfig != null && !object(schema.miniExtConfig))
            return unavailable('invalid-metadata');
        const config: Record<string, unknown> = schema.miniExtConfig ?? {};
        for (const key of [
            'allowCreatingRecords',
            'allowEditingRecords',
            'filterLinkedRecordsToggle',
            'dynamicFilteringToggle',
            'prefillChildFormForCreatingRecords',
            'readOnly',
        ]) {
            if (config[key] != null && typeof config[key] !== 'boolean')
                return unavailable('invalid-metadata');
        }
        if (config.allowCreatingRecords !== true || config.readOnly === true)
            return unavailable('create-disabled');
        if (
            !optionalEnum(config.layout, ['list', 'grid', 'gallery']) ||
            (Object.hasOwn(config, 'openRecordsAs') &&
                config.openRecordsAs !== 'modal') ||
            config.recordFinderMode === 'calendar' ||
            !optionalEnum(config.recordFinderMode, ['list', 'hide-finder']) ||
            config.dynamicFilteringToggle === true ||
            !optionalEnum(config.formsForEditingAndCreating, [
                'same-form',
                'different-forms',
            ]) ||
            !optionalEnum(config.filterApplicationMode, [
                'selected-records',
                'record-finder-only',
            ])
        )
            return unavailable('unsupported-configuration');
        const shared =
            config.allowEditingRecords === true &&
            (config.formsForEditingAndCreating == null ||
                config.formsForEditingAndCreating === 'same-form');
        const childExtensionId = shared
            ? config.extensionIdForCreatingAndEditing
            : config.extensionIdForCreating;
        if (!nonempty(childExtensionId)) return unavailable('invalid-metadata');
        const nativeIds = recordIds(data[fieldId]);
        if (!nativeIds) return unavailable('invalid-native-value');
        const physical = schema.airtableField.config;
        const inverse = physical.options.inverseLinkFieldId;
        if (inverse != null && !nonempty(inverse))
            return unavailable('invalid-metadata');
        const single = Object.hasOwn(config, 'maxRecordsToSelectOrCreate')
            ? config.maxRecordsToSelectOrCreate === '1'
            : physical.options.prefersSingleRecordLink;
        if (
            !optionalEnum(config.maxRecordsToSelectOrCreate, ['1', 'unlimited'])
        )
            return unavailable('invalid-metadata');
        const custom = config.customMaxRecordsToSelect;
        if (
            custom != null &&
            (typeof custom !== 'number' ||
                !Number.isFinite(custom) ||
                custom < 0)
        )
            return unavailable('invalid-metadata');
        const maximum = single ? 1 : typeof custom === 'number' ? custom : null;
        let selectedCount = nativeIds.length;
        const filtering =
            config.filterLinkedRecordsToggle !== false &&
            config.filterApplicationMode !== 'record-finder-only' &&
            config.filterLinkedRecordsConditionFields != null;
        if (filtering) {
            const snapshot = input.linkedRecords;
            if (
                !snapshot ||
                snapshot.phase !== 'ready' ||
                snapshot.linkedTableId !== physical.options.linkedTableId ||
                snapshot.selectedPolicy.state !== 'applied' ||
                !snapshot.selectedPolicy.supported ||
                snapshot.unresolvedSelectedIds.length !== 0 ||
                !snapshot.table ||
                !Array.isArray(snapshot.table.airtableFields)
            )
                return unavailable('unavailable-selected-policy');
            // The owner captures this facet from the same current native draft.
            // Unresolved membership is recorded before selected-policy filtering;
            // resolved denied rows need not appear in the detached display list.
            const metadataIds = new Set<string>();
            const metadataNames = new Set<string>();
            for (const field of snapshot.table.airtableFields) {
                if (
                    !nonempty(field.id) ||
                    !nonempty(field.name) ||
                    !object(field.config) ||
                    !nonempty(field.config.type) ||
                    metadataIds.has(field.id) ||
                    metadataNames.has(field.name)
                )
                    return unavailable('unavailable-selected-policy');
                metadataIds.add(field.id);
                metadataNames.add(field.name);
            }
            if (
                snapshot.table.airtableFields.some(
                    (field) =>
                        field.id !== field.name && metadataIds.has(field.name)
                )
            )
                return unavailable('unavailable-selected-policy');
            const remaining = new Map<string, number>();
            for (const id of nativeIds)
                remaining.set(id, (remaining.get(id) ?? 0) + 1);
            for (const record of snapshot.selectedRecords) {
                const count = remaining.get(record.id) ?? 0;
                if (count === 0 || !object(record.fields))
                    return unavailable('unavailable-selected-policy');
                remaining.set(record.id, count - 1);
            }
            selectedCount = snapshot.selectedRecords.length;
        }
        if (maximum !== null && selectedCount >= maximum)
            return unavailable('capacity-reached');
        let prefillQueryForChildExtension: string | null = null;
        if (config.prefillChildFormForCreatingRecords === true) {
            const id = config.prefillFieldForCreatingChildExtension;
            if (id != null && !nonempty(id))
                return unavailable('invalid-metadata');
            if (
                typeof id === 'string' &&
                Object.hasOwn(loaded.payload.fieldIdsToSchemas, id)
            ) {
                const driver = loaded.payload.fieldIdsToSchemas[id];
                if (
                    driver.airtableField.id !== id ||
                    Object.values(loaded.payload.fieldIdsToSchemas).filter(
                        (field) => field.airtableField.id === id
                    ).length !== 1
                )
                    return unavailable('invalid-metadata');
                if (!readableScalar(driver))
                    return unavailable('unsupported-configuration');
                const value = data[id];
                if (value != null) {
                    const query = getReadableStringFromAirtableValue({
                        value: value as ReadableAirtableValue,
                        airtableFieldConfig: driver.airtableField
                            .config as ReadableFieldConfig,
                        fieldName: driver.airtableField.name,
                        source: {
                            type: 'airtableMock',
                            linkedTableStates: {},
                            dateParsing: 'local',
                        },
                    });
                    if (query.trim() !== '')
                        prefillQueryForChildExtension = query;
                }
            }
        }
        const parent = loaded.payload.formRecord;
        return {
            type: 'available',
            childExtensionId,
            parentFieldId: fieldId,
            linkedTableId: physical.options.linkedTableId,
            parentInverseFieldId: inverse ?? null,
            maximum,
            selectedCount,
            nativeIds,
            prefill: {
                toLinkToParent:
                    parent.type === 'edit' && inverse != null
                        ? {
                              reversedFieldIdToPrefill: inverse,
                              parentFormRecordId: parent.recordId,
                          }
                        : null,
                prefillQueryForChildExtension,
            },
        };
    } catch {
        return unavailable('invalid-metadata');
    }
}

/** Internal accepted-create reconciliation, never a receipt or bypass-ID API. */
export function reconcileLinkedChildCreate(input: {
    parent: FormLoadedResult;
    fieldId: string;
    data: Readonly<Record<string, AirtableValue>>;
    child: FormLoadedResult;
    savedRecord: AirtableRecord;
}):
    | {
          type: 'available';
          nativeIds: string[];
          changed: boolean;
          exemptCreatedRecord: boolean;
      }
    | Unavailable {
    try {
        const field = physicalLink(input.parent, input.fieldId);
        const nativeIds = recordIds(input.data[input.fieldId]);
        if (
            !field ||
            !nativeIds ||
            !nonempty(input.savedRecord.id) ||
            !object(input.savedRecord.fields) ||
            input.child.payload.formRecord.type !== 'create'
        )
            return unavailable('invalid-metadata');
        let add = true;
        const parent = input.parent.payload.formRecord;
        if (parent.type === 'edit') {
            const inverseId =
                field.airtableField.config.options.inverseLinkFieldId;
            const matches = Object.values(
                input.child.payload.fieldIdsToSchemas
            ).filter(
                (schema) =>
                    schema.airtableField.config.type ===
                        'multipleRecordLinks' &&
                    schema.airtableField.config.options.inverseLinkFieldId ===
                        input.fieldId
            );
            const inverse = matches[0];
            if (
                !nonempty(inverseId) ||
                matches.length !== 1 ||
                !inverse ||
                inverse.airtableField.id !== inverseId ||
                !Object.hasOwn(
                    input.child.payload.fieldIdsToSchemas,
                    inverseId
                ) ||
                input.child.payload.fieldIdsToSchemas[inverseId] !== inverse ||
                Object.values(input.child.payload.fieldIdsToSchemas).filter(
                    (schema) => schema.airtableField.id === inverseId
                ).length !== 1 ||
                inverse.fieldType !== 'multipleRecordLinks' ||
                inverse.airtableField.isComputed !== false ||
                inverse.airtableField.config.type !== 'multipleRecordLinks' ||
                inverse.airtableField.config.options.linkedTableId !==
                    parent.tableId ||
                !Object.hasOwn(input.savedRecord.fields, inverseId)
            )
                return unavailable('unavailable-inverse');
            const linked = recordIds(input.savedRecord.fields[inverseId]);
            // A returned explicit array is required; null/missing is not unlink evidence.
            if (!Array.isArray(input.savedRecord.fields[inverseId]) || !linked)
                return unavailable('unavailable-inverse');
            add = linked.includes(parent.recordId);
        }
        const alreadyPresent = nativeIds.includes(input.savedRecord.id);
        const next = add
            ? alreadyPresent
                ? nativeIds
                : [...nativeIds, input.savedRecord.id]
            : nativeIds.filter((id) => id !== input.savedRecord.id);
        const changed = next.length !== nativeIds.length;
        return {
            type: 'available',
            nativeIds: next,
            changed,
            exemptCreatedRecord: add && changed,
        };
    } catch {
        return unavailable('invalid-metadata');
    }
}

export type LinkedChildEditPolicy = Omit<LinkedChildCreatePolicy, 'prefill'> & {
    recordId: string;
    displayedRecordIds: string[];
    prefill: LinkedRecordPrefill;
};

/** Displayed native Form rows only; finder candidates are outside this SDK subset. */
export function resolveLinkedChildEditPolicy(input: {
    loaded: FormLoadedResult;
    fieldId: string;
    recordId: string;
    data: Readonly<Record<string, AirtableValue>>;
    linkedRecords?: FormLinkedRecordsSnapshot;
}): LinkedChildEditPolicy | Unavailable {
    try {
        const { loaded, fieldId, data } = input;
        const schema = physicalLink(loaded, fieldId);
        if (!schema || !loaded.payload.fieldIdsInForm.includes(fieldId))
            return unavailable('invalid-metadata');
        if (schema.miniExtConfig != null && !object(schema.miniExtConfig))
            return unavailable('invalid-metadata');
        const config: Record<string, unknown> = schema.miniExtConfig ?? {};
        for (const key of [
            'allowCreatingRecords',
            'allowEditingRecords',
            'readOnly',
            'dynamicFilteringToggle',
        ]) {
            if (config[key] != null && typeof config[key] !== 'boolean')
                return unavailable('invalid-metadata');
        }
        if (config.allowEditingRecords !== true)
            return unavailable('edit-disabled');
        if (
            !optionalEnum(config.layout, ['list', 'grid', 'gallery']) ||
            (Object.hasOwn(config, 'openRecordsAs') &&
                config.openRecordsAs !== 'modal') ||
            config.dynamicFilteringToggle === true ||
            !optionalEnum(config.formsForEditingAndCreating, [
                'same-form',
                'different-forms',
            ]) ||
            !optionalEnum(config.loggedInUserRecordsViewMode, [
                'only-record-linked-to-user',
                'all-records',
            ])
        )
            return unavailable('unsupported-configuration');
        const shared =
            config.allowCreatingRecords === true &&
            (config.formsForEditingAndCreating == null ||
                config.formsForEditingAndCreating === 'same-form');
        const childExtensionId = shared
            ? config.extensionIdForCreatingAndEditing
            : config.extensionIdForEditing;
        if (!nonempty(childExtensionId)) return unavailable('invalid-metadata');
        if (!object(data)) return unavailable('invalid-native-value');
        const nativeIds = recordIds(data[fieldId]);
        if (!nativeIds) return unavailable('invalid-native-value');
        const snapshot = input.linkedRecords;
        if (
            !snapshot ||
            !['idle', 'ready'].includes(snapshot.phase) ||
            snapshot.pending ||
            snapshot.linkedTableId !==
                schema.airtableField.config.options.linkedTableId ||
            !snapshot.selectedPolicy.supported ||
            !['applied', 'not-configured'].includes(
                snapshot.selectedPolicy.state
            ) ||
            snapshot.unresolvedSelectedIds.includes(input.recordId) ||
            !snapshot.table
        )
            return unavailable('unavailable-selected-policy');
        const remaining = new Map<string, number>();
        for (const id of nativeIds)
            remaining.set(id, (remaining.get(id) ?? 0) + 1);
        for (const record of snapshot.selectedRecords) {
            const count = remaining.get(record.id) ?? 0;
            if (!nonempty(record.id) || count === 0 || !object(record.fields))
                return unavailable('unavailable-selected-policy');
            remaining.set(record.id, count - 1);
        }
        const displayedRecordIds = [
            ...new Set(snapshot.selectedRecords.map((record) => record.id)),
        ];
        if (
            !nonempty(input.recordId) ||
            !nativeIds.includes(input.recordId) ||
            !displayedRecordIds.includes(input.recordId)
        )
            return unavailable('unavailable-edit-record');
        const physical = schema.airtableField.config;
        const inverse = physical.options.inverseLinkFieldId;
        if (inverse != null && !nonempty(inverse))
            return unavailable('invalid-metadata');
        if (
            !optionalEnum(config.maxRecordsToSelectOrCreate, ['1', 'unlimited'])
        )
            return unavailable('invalid-metadata');
        const single = Object.hasOwn(config, 'maxRecordsToSelectOrCreate')
            ? config.maxRecordsToSelectOrCreate === '1'
            : physical.options.prefersSingleRecordLink;
        const custom = config.customMaxRecordsToSelect;
        if (
            custom != null &&
            (typeof custom !== 'number' ||
                !Number.isFinite(custom) ||
                custom < 0)
        )
            return unavailable('invalid-metadata');
        const parent = loaded.payload.formRecord;
        return {
            type: 'available',
            childExtensionId,
            parentFieldId: fieldId,
            linkedTableId: physical.options.linkedTableId,
            parentInverseFieldId: inverse ?? null,
            maximum: single ? 1 : typeof custom === 'number' ? custom : null,
            selectedCount: snapshot.selectedRecords.length,
            nativeIds,
            recordId: input.recordId,
            displayedRecordIds,
            prefill: {
                prefillQueryForChildExtension: null,
                toLinkToParent:
                    parent.type === 'edit' &&
                    inverse != null &&
                    config.loggedInUserRecordsViewMode ===
                        'only-record-linked-to-user'
                        ? {
                              reversedFieldIdToPrefill: inverse,
                              parentFormRecordId: parent.recordId,
                          }
                        : null,
            },
        };
    } catch {
        return unavailable('invalid-metadata');
    }
}

/** Exact EDIT receipt only. Explicit inverse arrays are a conservative SDK subset;
 * canonical reconciliation also accepts missing inverse metadata. */
export function reconcileLinkedChildEdit(input: {
    parent: FormLoadedResult;
    fieldId: string;
    data: Readonly<Record<string, AirtableValue>>;
    child: FormLoadedResult;
    savedRecord: AirtableRecord;
    recordId: string;
    maximum: number | null;
    selectedCount: number;
}):
    | {
          type: 'available';
          nativeIds: string[];
          changed: boolean;
          exemptCreatedRecord: boolean;
      }
    | Unavailable {
    try {
        const field = physicalLink(input.parent, input.fieldId);
        const nativeIds = recordIds(input.data[input.fieldId]);
        if (
            !field ||
            !nativeIds ||
            !nonempty(input.savedRecord.id) ||
            !object(input.savedRecord.fields) ||
            input.child.payload.formRecord.type !== 'edit' ||
            input.child.payload.formRecord.recordId !== input.recordId ||
            input.savedRecord.id !== input.recordId
        )
            return unavailable('invalid-metadata');
        let add = true;
        const parent = input.parent.payload.formRecord;
        if (parent.type === 'edit') {
            const inverseId =
                field.airtableField.config.options.inverseLinkFieldId;
            const matches = Object.values(
                input.child.payload.fieldIdsToSchemas
            ).filter(
                (schema) =>
                    schema.airtableField.config.type ===
                        'multipleRecordLinks' &&
                    schema.airtableField.config.options.inverseLinkFieldId ===
                        input.fieldId
            );
            const inverse = matches[0];
            if (
                !nonempty(inverseId) ||
                matches.length !== 1 ||
                !inverse ||
                inverse.airtableField.id !== inverseId ||
                !Object.hasOwn(
                    input.child.payload.fieldIdsToSchemas,
                    inverseId
                ) ||
                input.child.payload.fieldIdsToSchemas[inverseId] !== inverse ||
                Object.values(input.child.payload.fieldIdsToSchemas).filter(
                    (schema) => schema.airtableField.id === inverseId
                ).length !== 1 ||
                inverse.fieldType !== 'multipleRecordLinks' ||
                inverse.airtableField.isComputed !== false ||
                inverse.airtableField.config.type !== 'multipleRecordLinks' ||
                inverse.airtableField.config.options.linkedTableId !==
                    parent.tableId ||
                !Object.hasOwn(input.savedRecord.fields, inverseId)
            )
                return unavailable('unavailable-inverse');
            const linked = recordIds(input.savedRecord.fields[inverseId]);
            // A returned explicit array is required; null/missing is not unlink evidence.
            if (!Array.isArray(input.savedRecord.fields[inverseId]) || !linked)
                return unavailable('unavailable-inverse');
            add = linked.includes(parent.recordId);
        }
        const alreadyPresent = nativeIds.includes(input.savedRecord.id);
        // Capacity limits only an append; retain, remove and no-op stay admissible.
        if (
            add &&
            !alreadyPresent &&
            input.maximum !== null &&
            (!Number.isFinite(input.selectedCount) ||
                input.selectedCount >= input.maximum)
        )
            return unavailable('capacity-reached');
        const next = add
            ? alreadyPresent
                ? nativeIds
                : [...nativeIds, input.savedRecord.id]
            : nativeIds.filter((id) => id !== input.savedRecord.id);
        const changed = next.length !== nativeIds.length;
        return {
            type: 'available',
            nativeIds: next,
            changed,
            exemptCreatedRecord: false,
        };
    } catch {
        return unavailable('invalid-metadata');
    }
}
