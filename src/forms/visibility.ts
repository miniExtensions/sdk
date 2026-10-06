import type {
    AirtableValue,
    RuntimeAirtableField,
    RuntimeFieldSchema,
} from '../runtime/types.js';
import FormulaRunner from '../formulas/runner.js';
import { extractIdentifiersFromFormula } from '../formulas/helpers/extractIdentifiersFromExpr.js';
import {
    compileRuntimeConditions,
    type CompileRuntimeConditionsInput,
    type ConditionCompileDiagnostic,
} from './conditions.js';

export type FormVisibilityDiagnostic = Pick<
    ConditionCompileDiagnostic,
    'code' | 'severity' | 'path'
>;

export type FormFieldVisibility =
    | {
          type: 'visible' | 'hidden';
          diagnostics: readonly FormVisibilityDiagnostic[];
      }
    | {
          type: 'blocked';
          code:
              | 'unsupported'
              | 'invalid'
              | 'missing-schema'
              | 'unsupported-hide-empty'
              | 'unsupported-driver'
              | 'ambiguous-reference'
              | 'invalid-native-value'
              | 'evaluation-exception'
              | 'runtime-error'
              | 'non-finite-result';
          diagnostics: readonly FormVisibilityDiagnostic[];
      };

type FormVisibilityContext = {
    /** Current physical metadata, including drivers outside the rendered list. */
    airtableFields: readonly RuntimeAirtableField[];
    /** The complete accepted native draft, including currently hidden values. */
    data: Readonly<Record<string, AirtableValue>>;
    formRecordType: 'create' | 'edit';
    evaluationMode: 'runtime' | 'preview';
    invalidConditionMode: CompileRuntimeConditionsInput['invalidConditionMode'];
};

export type EvaluateFormFieldVisibilityInput = FormVisibilityContext & {
    field: Readonly<RuntimeFieldSchema>;
};

export type ComposeFormFieldVisibilityInput = FormVisibilityContext & {
    fieldIds: readonly string[];
    fieldIdsToSchemas: Readonly<Record<string, RuntimeFieldSchema | undefined>>;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);

const nativeValueProblem = (
    field: RuntimeAirtableField,
    value: AirtableValue | undefined
): 'invalid-native-value' | 'non-finite-result' | null => {
    if (value == null) return null;
    // Preserve the engine's native error provenance; marker strings are data.
    if (
        isObject(value) &&
        ((Object.hasOwn(value, 'error') &&
            'error' in value &&
            typeof value.error === 'string') ||
            (Object.hasOwn(value, 'specialValue') &&
                'specialValue' in value &&
                ['NaN', 'Infinity', '-Infinity'].includes(
                    String(value.specialValue)
                )))
    )
        return null;
    switch (field.config.type) {
        case 'number':
        case 'percent':
        case 'currency':
        case 'rating':
            return typeof value !== 'number'
                ? 'invalid-native-value'
                : Number.isFinite(value)
                  ? null
                  : 'non-finite-result';
        case 'checkbox':
            return typeof value === 'boolean' ? null : 'invalid-native-value';
        case 'barcode':
            return isObject(value) &&
                'text' in value &&
                (value.text == null || typeof value.text === 'string') &&
                (value.type == null || typeof value.type === 'string')
                ? null
                : 'invalid-native-value';
        default:
            return typeof value === 'string' ? null : 'invalid-native-value';
    }
};

/** Conditional presentation only; this helper never changes drafts or authority. */
export function evaluateFormFieldVisibility(
    input: EvaluateFormFieldVisibilityInput
): FormFieldVisibility {
    const config = input.field.miniExtConfig;
    const hideEmpty =
        config != null && 'hideFieldIfEmpty' in config
            ? config.hideFieldIfEmpty
            : undefined;
    if (
        (input.formRecordType === 'edit' && hideEmpty === true) ||
        (input.field.airtableField.config.type === 'multipleLookupValues' &&
            hideEmpty !== false)
    )
        return {
            type: 'blocked',
            code: 'unsupported-hide-empty',
            diagnostics: [],
        };
    // Preview skips conditions, but canonical native empty hiding still applies.
    if (input.evaluationMode === 'preview')
        return { type: 'visible', diagnostics: [] };

    const compiled = compileRuntimeConditions({
        conditions:
            config != null && 'conditionalFields' in config
                ? (config.conditionalFields ?? null)
                : null,
        airtableFields: input.airtableFields,
        invalidConditionMode: input.invalidConditionMode,
    });
    const diagnostics = compiled.diagnostics.map(
        ({ code, severity, path }) => ({
            code,
            severity,
            path: [...path],
        })
    );
    if (compiled.type !== 'compiled')
        return { type: 'blocked', code: compiled.type, diagnostics };

    try {
        for (const reference of extractIdentifiersFromFormula(
            compiled.formula
        )) {
            const matches = input.airtableFields.filter(
                (field) => field.id === reference || field.name === reference
            );
            const driver = matches[0];
            if (driver == null) continue; // The compiler owns missing references.
            // The portable runner resolves both IDs and names, then prefers a
            // name-keyed value. A native draft is ID-keyed; refuse collisions
            // rather than evaluating another field's accepted value.
            if (
                (matches.some((field) => field.id === reference) &&
                    matches.some((field) => field.id !== reference)) ||
                (driver.name !== driver.id &&
                    Object.hasOwn(input.data, driver.name))
            )
                return {
                    type: 'blocked',
                    code: 'ambiguous-reference',
                    diagnostics,
                };
            if (driver.isComputed === true)
                return {
                    type: 'blocked',
                    code: 'unsupported-driver',
                    diagnostics,
                };
            const problem = nativeValueProblem(driver, input.data[driver.id]);
            if (problem != null)
                return { type: 'blocked', code: problem, diagnostics };
        }
        const runner = new FormulaRunner(compiled.formula);
        runner.context = {
            record: { id: '', fields: { ...input.data } },
            airtableFields: [...input.airtableFields],
            linkedTableLoadingStates: {},
        };
        const outcome = runner.runWithOutcome();
        if (outcome.type === 'error')
            return { type: 'blocked', code: outcome.code, diagnostics };
        return {
            type: FormulaRunner.isFalsyValue(outcome.value)
                ? 'hidden'
                : 'visible',
            diagnostics,
        };
    } catch {
        return { type: 'blocked', code: 'evaluation-exception', diagnostics };
    }
}

/** Ordered frontend sections. Every predicate reads the same unfiltered draft. */
export function composeFormFieldVisibility(
    input: ComposeFormFieldVisibilityInput
): Readonly<Record<string, FormFieldVisibility>> {
    const result: Record<string, FormFieldVisibility> = {};
    let enclosing: FormFieldVisibility | null = null;
    for (const fieldId of input.fieldIds) {
        const field = input.fieldIdsToSchemas[fieldId];
        const config = field?.miniExtConfig;
        const startsSection =
            config != null &&
            'headerSectionTitle' in config &&
            typeof config.headerSectionTitle === 'string' &&
            config.headerSectionTitle.trim() !== '' &&
            (!('enableSectionHeader' in config) ||
                config.enableSectionHeader !== false);
        if (startsSection) enclosing = null;
        const visibility: FormFieldVisibility =
            enclosing != null && enclosing.type !== 'visible'
                ? enclosing
                : field == null
                  ? {
                        type: 'blocked',
                        code: 'missing-schema',
                        diagnostics: [],
                    }
                  : evaluateFormFieldVisibility({ ...input, field });
        result[fieldId] = visibility;
        if (
            startsSection &&
            config != null &&
            'applyFieldConditionsToSection' in config &&
            config.applyFieldConditionsToSection === true
        )
            enclosing = visibility;
    }
    return result;
}
