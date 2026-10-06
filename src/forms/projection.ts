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
    evaluateFormFieldVisibility,
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
    const diagnostics: FormVisibilityDiagnostic[] = [];
    try {
        // Canonical projection recognizes retained nonblank titles regardless
        // of the frontend's enableSectionHeader flag. Refuse section contexts
        // rather than substituting composeFormFieldVisibility's screen rules.
        for (const schema of Object.values(input.fieldIdsToSchemas)) {
            const config = schema?.miniExtConfig;
            if (config == null) continue;
            if (
                ('headerSectionTitle' in config &&
                    typeof config.headerSectionTitle === 'string' &&
                    config.headerSectionTitle.trim() !== '') ||
                ('applyFieldConditionsToSection' in config &&
                    config.applyFieldConditionsToSection === true)
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
        for (const fieldId of input.fieldIds) {
            const field = input.fieldIdsToSchemas[fieldId];
            if (field == null || field.airtableField.id !== fieldId)
                return {
                    type: 'blocked',
                    code: 'missing-schema',
                    diagnostics,
                };
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
                            candidate.id === reference ||
                            candidate.name === reference
                    );
                    if (
                        new Set(matches.map((candidate) => candidate.id)).size >
                        1
                    )
                        return {
                            type: 'blocked',
                            code: 'ambiguous-reference',
                            diagnostics,
                        };
                }
            }
            const visibility = evaluateFormFieldVisibility({
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
            });
            diagnostics.push(...visibility.diagnostics);
            if (visibility.type === 'blocked')
                return { ...visibility, diagnostics };
            if (visibility.type === 'hidden') hiddenFieldIds.push(fieldId);
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
