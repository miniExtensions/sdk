import { compileRuntimeConditions } from '../forms/conditions.js';
import FormulaRunner from '../formulas/runner.js';
import { extractIdentifiersFromExpr } from '../formulas/helpers/extractIdentifiersFromExpr.js';
import type {
    AirtableRecord,
    RuntimeAirtableField,
    RuntimeFieldSchema,
} from '../runtime/types.js';
import {
    getSelectFieldPolicy,
    type SelectFieldPolicy,
} from './selectPolicy.js';

export type SelectFieldAvailabilityInput = {
    field: RuntimeFieldSchema;
    airtableFields: readonly RuntimeAirtableField[];
    /** Current native record after the caller's canonical Form projection. */
    recordForConditionEvaluation: AirtableRecord | null;
    mode: 'runtime' | 'configuration-preview';
    invalidConditionMode: 'compatibility' | 'strict';
};

export type SelectFieldAvailabilityDiagnostic = {
    code:
        | 'unavailable-record'
        | 'unsupported-condition'
        | 'invalid-condition'
        | 'evaluation-error';
};

export type SelectFieldAvailability = {
    /** Static policy retains limits, read-only and Add Choice semantics. */
    policy: SelectFieldPolicy;
    diagnostics: readonly SelectFieldAvailabilityDiagnostic[];
} & (
    | {
          status: 'ready';
          /** Eligible NEW options only; retain selected names in the model. */
          options: SelectFieldPolicy['options'];
      }
    | { status: 'blocked'; options: readonly [] }
);

/** Pure presentation only; does not project records, clear values or authorize saves. */
export function resolveSelectFieldAvailability(
    input: SelectFieldAvailabilityInput
): SelectFieldAvailability {
    const policy = getSelectFieldPolicy(input.field);
    // Existing readonly controls preserve the full current-choice presentation.
    const options = policy.readOnly
        ? policy.options
        : policy.options.filter(
              (option) =>
                  policy.allowedOptionIds === null ||
                  policy.allowedOptionIds.includes(option.id)
          );
    const ready = (
        eligible: SelectFieldPolicy['options']
    ): SelectFieldAvailability => ({
        status: 'ready',
        options: eligible,
        policy,
        diagnostics: [],
    });
    const blocked = (
        code: SelectFieldAvailabilityDiagnostic['code']
    ): SelectFieldAvailability => ({
        status: 'blocked',
        options: [],
        policy,
        diagnostics: [{ code }],
    });
    const config = input.field.miniExtConfig;
    if (
        policy.readOnly ||
        input.mode === 'configuration-preview' ||
        config == null ||
        !('enableConditionalOptions' in config) ||
        config.enableConditionalOptions !== true
    )
        return ready(options);
    if (input.mode !== 'runtime') return blocked('invalid-condition');

    try {
        const rules =
            'conditionsForOptions' in config
                ? config.conditionsForOptions
                : undefined;
        if (rules != null && !Array.isArray(rules))
            return blocked('invalid-condition');
        const definitions = options.map((option) => {
            // Match first: later duplicate rules cannot replace an earlier
            // rule whose conditions are absent or null.
            const rule = rules?.find(
                (candidate) =>
                    candidate?.config?.optionForConditions === option.id
            );
            return {
                option,
                conditions: rule?.config?.conditionsForOption ?? null,
            };
        });
        if (input.recordForConditionEvaluation == null)
            return blocked('unavailable-record');

        const eligible: SelectFieldPolicy['options'][number][] = [];
        for (const { option, conditions } of definitions) {
            if (conditions === null) {
                eligible.push(option);
                continue;
            }
            const compiled = compileRuntimeConditions({
                conditions,
                airtableFields: input.airtableFields,
                invalidConditionMode: input.invalidConditionMode,
                fieldReferenceMode: 'saved',
            });
            if (compiled.type !== 'compiled')
                return blocked(
                    compiled.type === 'unsupported'
                        ? 'unsupported-condition'
                        : 'invalid-condition'
                );
            const runner = new FormulaRunner(compiled.formula);
            // Saved tagged references become untyped formula identifiers. The
            // legacy engine also reads a field's name before its native ID.
            // Refuse ambiguous current metadata instead of reading a sibling.
            for (const identifier of extractIdentifiersFromExpr(runner.expr)) {
                const matches = input.airtableFields.filter(
                    (field) =>
                        field.id === identifier || field.name === identifier
                );
                if (new Set(matches.map((field) => field.id)).size !== 1)
                    return blocked('unsupported-condition');
                const referenced = matches[0]!;
                if (
                    input.airtableFields.some(
                        (field) =>
                            field.id !== referenced.id &&
                            field.id === referenced.name
                    )
                )
                    return blocked('unsupported-condition');
            }
            runner.context = {
                record: {
                    id: input.recordForConditionEvaluation.id,
                    fields: { ...input.recordForConditionEvaluation.fields },
                },
                airtableFields: [...input.airtableFields],
                linkedTableLoadingStates: {},
            };
            const outcome = runner.runWithOutcome();
            if (outcome.type === 'error') return blocked('evaluation-error');
            if (!FormulaRunner.isFalsyValue(outcome.value))
                eligible.push(option);
        }
        return ready(eligible);
    } catch {
        return blocked('evaluation-error');
    }
}
