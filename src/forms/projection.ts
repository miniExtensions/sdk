import { AirtableFieldType } from '../formulas/types.js';
import type {
    AirtableRecord,
    AirtableValue,
    RuntimeAirtableField,
    RuntimeFieldSchema,
} from '../runtime/types.js';
import { extractIdentifiersFromFormula } from '../formulas/helpers/extractIdentifiersFromExpr.js';
import {
    compileRuntimeConditions,
    type CompileRuntimeConditionsInput,
} from './conditions.js';
import {
    evaluateFormFieldVisibilityWithPolicy,
    type FormFieldVisibility,
    type FormVisibilityDiagnostic,
} from './visibility.js';

export type CreateFlatScalarFormRecordProjectionInput = {
    fieldIds: readonly string[];
    fieldIdsToSchemas: Readonly<Record<string, RuntimeFieldSchema | undefined>>;
    airtableFields: readonly RuntimeAirtableField[];
    /** The complete accepted ID-keyed native draft, never screen visibility. */
    data: Readonly<Record<string, AirtableValue>>;
    /** The current edit record ID, or the empty string for a create record. */
    recordId: string;
    invalidConditionMode: CompileRuntimeConditionsInput['invalidConditionMode'];
};

export type FlatScalarFormRecordProjection =
    | {
          type: 'available';
          record: AirtableRecord;
          hiddenFieldIds: readonly string[];
          diagnostics: readonly FormVisibilityDiagnostic[];
      }
    | {
          type: 'blocked';
          code:
              | Extract<FormFieldVisibility, { type: 'blocked' }>['code']
              | 'unsupported-sections'
              | 'unsupported-linked-filter';
          diagnostics: readonly FormVisibilityDiagnostic[];
      };

/**
 * Flat conditional projection for direct scalar dependencies. Unreferenced
 * native values are copied unchanged; this does not filter links or lookups,
 * render review rows, change accepted drafts, or authorize a Save.
 */
export function createFlatScalarFormRecordProjection(
    input: CreateFlatScalarFormRecordProjectionInput
): FlatScalarFormRecordProjection {
    return project(input, 'flat');
}

/** Pass fieldIdsInForm verbatim: this input cannot establish order completeness. */
export type CreateScalarFormRecordProjectionInput =
    CreateFlatScalarFormRecordProjectionInput;

export type ScalarFormRecordProjection =
    | Extract<FlatScalarFormRecordProjection, { type: 'available' }>
    | {
          type: 'blocked';
          code:
              | Exclude<
                    Extract<
                        FlatScalarFormRecordProjection,
                        { type: 'blocked' }
                    >['code'],
                    'unsupported-sections'
                >
              | 'invalid-field-order'
              | 'invalid-metadata';
          diagnostics: readonly FormVisibilityDiagnostic[];
      };

/**
 * Canonical ordered sections, with direct scalar predicates only. Returns a
 * detached deep copy, not a frozen record or a replacement native Save draft.
 * One-page suitability remains a consumer check.
 */
export function createScalarFormRecordProjection(
    input: CreateScalarFormRecordProjectionInput
): ScalarFormRecordProjection {
    return project(input, 'sections');
}

/** Internal Form consumer: shares ordered projection with the Form driver policy. */
export function createFormConditionRecordProjection(
    input: CreateScalarFormRecordProjectionInput
): ScalarFormRecordProjection {
    return project(input, 'sections', 'form');
}

function project(
    input: CreateFlatScalarFormRecordProjectionInput,
    mode: 'flat',
    policy?: 'legacy-flat' | 'form'
): FlatScalarFormRecordProjection;
function project(
    input: CreateScalarFormRecordProjectionInput,
    mode: 'sections',
    policy?: 'legacy-flat' | 'form'
): ScalarFormRecordProjection;
function project(
    input: CreateScalarFormRecordProjectionInput,
    mode: 'flat' | 'sections',
    policy: 'legacy-flat' | 'form' = 'legacy-flat'
): FlatScalarFormRecordProjection | ScalarFormRecordProjection {
    const diagnostics: FormVisibilityDiagnostic[] = [];
    try {
        if (mode === 'sections') {
            if (!Array.isArray(input.fieldIds))
                return {
                    type: 'blocked',
                    code: 'invalid-field-order',
                    diagnostics,
                };
            if (
                input.fieldIdsToSchemas == null ||
                typeof input.fieldIdsToSchemas !== 'object' ||
                Array.isArray(input.fieldIdsToSchemas) ||
                !Array.isArray(input.airtableFields)
            )
                return {
                    type: 'blocked',
                    code: 'invalid-metadata',
                    diagnostics,
                };
            const validPhysical = (field: RuntimeAirtableField): boolean =>
                field != null &&
                typeof field === 'object' &&
                !Array.isArray(field) &&
                typeof field.id === 'string' &&
                typeof field.name === 'string' &&
                (field.isComputed === undefined ||
                    typeof field.isComputed === 'boolean') &&
                field.config != null &&
                typeof field.config === 'object' &&
                !Array.isArray(field.config) &&
                Object.values(AirtableFieldType).some(
                    (type) => type === field.config.type
                );
            const seen = new Set<string>();
            for (let index = 0; index < input.fieldIds.length; index++) {
                const id = input.fieldIds[index];
                if (
                    !Object.hasOwn(input.fieldIds, index) ||
                    typeof id !== 'string' ||
                    seen.has(id)
                )
                    return {
                        type: 'blocked',
                        code: 'invalid-field-order',
                        diagnostics,
                    };
                seen.add(id);
            }
            const physicalIds = new Set<string>();
            for (const field of input.airtableFields) {
                if (!validPhysical(field) || physicalIds.has(field.id))
                    return {
                        type: 'blocked',
                        code: 'invalid-metadata',
                        diagnostics,
                    };
                physicalIds.add(field.id);
            }
            for (const [id, field] of Object.entries(input.fieldIdsToSchemas)) {
                if (field == null) continue;
                const physical = input.airtableFields.find(
                    (candidate) => candidate.id === id
                );
                if (
                    !validPhysical(field.airtableField) ||
                    field.airtableField.id !== id ||
                    field.fieldType !== field.airtableField.config.type ||
                    physical == null ||
                    physical.name !== field.airtableField.name ||
                    physical.config.type !== field.airtableField.config.type ||
                    physical.isComputed !== field.airtableField.isComputed
                )
                    return {
                        type: 'blocked',
                        code: 'invalid-metadata',
                        diagnostics,
                    };
                const config = field.miniExtConfig;
                if (config == null) continue;
                if (
                    typeof config !== 'object' ||
                    Array.isArray(config) ||
                    ('headerSectionTitle' in config &&
                        config.headerSectionTitle != null &&
                        typeof config.headerSectionTitle !== 'string') ||
                    ('enableSectionHeader' in config &&
                        config.enableSectionHeader != null &&
                        typeof config.enableSectionHeader !== 'boolean') ||
                    ('applyFieldConditionsToSection' in config &&
                        config.applyFieldConditionsToSection != null &&
                        typeof config.applyFieldConditionsToSection !==
                            'boolean')
                )
                    return {
                        type: 'blocked',
                        code: 'invalid-metadata',
                        diagnostics,
                    };
            }
        }
        // Canonical projection recognizes retained nonblank titles regardless
        // of the frontend's enableSectionHeader flag. The legacy flat path
        // keeps its all-schema rejection scan; neither path uses screen rules.
        for (const schema of Object.values(input.fieldIdsToSchemas)) {
            const config = schema?.miniExtConfig;
            if (config == null) continue;
            if (
                mode === 'flat' &&
                (('headerSectionTitle' in config &&
                    typeof config.headerSectionTitle === 'string' &&
                    config.headerSectionTitle.trim() !== '') ||
                    ('applyFieldConditionsToSection' in config &&
                        config.applyFieldConditionsToSection === true))
            )
                return {
                    type: 'blocked',
                    code: 'unsupported-sections',
                    diagnostics,
                };
            if (
                ('filterLinkedRecordsConditionFields' in config &&
                    config.filterLinkedRecordsConditionFields != null &&
                    (!('filterLinkedRecordsToggle' in config) ||
                        config.filterLinkedRecordsToggle !== false) &&
                    (!('filterApplicationMode' in config) ||
                        config.filterApplicationMode !==
                            'record-finder-only')) ||
                ('conditionalLinkedRecordFilterFields' in config &&
                    config.conditionalLinkedRecordFilterFields != null &&
                    (!Array.isArray(
                        config.conditionalLinkedRecordFilterFields
                    ) ||
                        config.conditionalLinkedRecordFilterFields.length !==
                            0))
            )
                return {
                    type: 'blocked',
                    code: 'unsupported-linked-filter',
                    diagnostics,
                };
        }

        const hiddenFieldIds: string[] = [];
        let section: FormFieldVisibility | null = null;
        for (const fieldId of input.fieldIds) {
            const field = input.fieldIdsToSchemas[fieldId];
            if (field == null || field.airtableField.id !== fieldId)
                return {
                    type: 'blocked',
                    code: 'missing-schema',
                    diagnostics,
                };
            if (mode === 'sections') {
                const config = field.miniExtConfig;
                if (
                    config != null &&
                    'headerSectionTitle' in config &&
                    typeof config.headerSectionTitle === 'string' &&
                    config.headerSectionTitle.trim() !== ''
                ) {
                    // Projection recognizes retained titles even when display is disabled.
                    section =
                        config.applyFieldConditionsToSection === true &&
                        config.conditionalFields != null
                            ? predicate(field, input, diagnostics, policy)
                            : null;
                    if (section?.type === 'blocked')
                        return { ...section, diagnostics };
                }
            }
            // Validate own predicates even beneath a hidden section.
            const visibility = predicate(field, input, diagnostics, policy);
            if (visibility.type === 'blocked')
                return { ...visibility, diagnostics };
            if (section?.type === 'hidden' || visibility.type === 'hidden')
                hiddenFieldIds.push(fieldId);
        }

        // Collect decisions first: deleting a hidden driver must never change
        // the predicate of a later field. Preserve nested native values too.
        const fields: Record<string, AirtableValue> = structuredClone(
            input.data
        );
        for (const fieldId of hiddenFieldIds) delete fields[fieldId];
        return {
            type: 'available',
            record: { id: input.recordId, fields },
            hiddenFieldIds,
            diagnostics,
        };
    } catch {
        return { type: 'blocked', code: 'evaluation-exception', diagnostics };
    }
}

function predicate(
    field: RuntimeFieldSchema,
    input: CreateScalarFormRecordProjectionInput,
    diagnostics: FormVisibilityDiagnostic[],
    policy: 'legacy-flat' | 'form'
): FormFieldVisibility {
    const compiled = compileRuntimeConditions({
        conditions:
            field.miniExtConfig != null &&
            'conditionalFields' in field.miniExtConfig
                ? (field.miniExtConfig.conditionalFields ?? null)
                : null,
        airtableFields: input.airtableFields,
        invalidConditionMode: input.invalidConditionMode,
    });
    if (compiled.type === 'compiled') {
        for (const reference of extractIdentifiersFromFormula(
            compiled.formula
        )) {
            const matches = input.airtableFields.filter(
                (candidate) =>
                    candidate.id === reference || candidate.name === reference
            );
            if (new Set(matches.map((candidate) => candidate.id)).size > 1)
                return {
                    type: 'blocked',
                    code: 'ambiguous-reference',
                    diagnostics,
                };
        }
    }
    const visibility = evaluateFormFieldVisibilityWithPolicy(
        {
            field: {
                ...field,
                miniExtConfig: {
                    ...field.miniExtConfig,
                    // Native empty hiding belongs to presentation, not
                    // canonical conditional-record pruning.
                    hideFieldIfEmpty: false,
                },
            },
            airtableFields: input.airtableFields,
            data: input.data,
            formRecordType: 'create',
            evaluationMode: 'runtime',
            invalidConditionMode: input.invalidConditionMode,
        },
        policy
    );
    diagnostics.push(...visibility.diagnostics);
    if (visibility.type === 'blocked') return { ...visibility, diagnostics };
    return visibility;
}
