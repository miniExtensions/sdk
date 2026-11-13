import { compileSelectConditions } from '../forms/selectConditions.js';
import FormulaRunner from '../formulas/runner.js';
import { extractIdentifiersFromExpr } from '../formulas/helpers/extractIdentifiersFromExpr.js';
import type {
    FormulaInterpreterOptions,
    InterpreterContext,
} from '../formulas/interpreter/interpreter.js';
import type { SelectChoiceEvaluation } from './selectChoiceProjection.js';

/** Explicit owner-matched context. No global store, lookup or remote loading. */
export type SelectFormulaEvaluationInput<T> = {
    enabled: boolean;
    readOnly?: boolean;
    context: InterpreterContext | null;
    /** Compilation remains lazy, including errors in unvisited option rules. */
    formulaForChoice(choice: T): string;
    /** Existing conversion/date adapters can be supplied without replacing execution. */
    interpreterOptions?: FormulaInterpreterOptions;
};

/**
 * Portable Select formula execution. Choice projection owns error fallback;
 * this boundary must not eagerly evaluate rules or turn exceptions into false.
 * The supplied compiler owns its complete AST fallback until that compiler is
 * independently migrated. This function does not certify compiler migration.
 */
export function createSelectFormulaEvaluation<T>(
    input: SelectFormulaEvaluationInput<T>
): SelectChoiceEvaluation<T> {
    if (!input.enabled || input.readOnly) return { type: 'skip' };
    const context = input.context;
    if (context == null) return { type: 'unavailable' };
    return {
        type: 'evaluate',
        matches(choice) {
            const runner = new FormulaRunner(
                input.formulaForChoice(choice),
                false,
                {
                    ...input.interpreterOptions,
                    legacyRuntime: true,
                }
            );
            const byId = new Map(
                context.airtableFields.map((field) => [field.id, field])
            );
            const byName = new Map(
                context.airtableFields.map((field) => [field.name, field])
            );
            let needsLinkedState = false;
            for (const identifier of new Set(
                extractIdentifiersFromExpr(runner.expr)
            )) {
                const field = byId.get(identifier) ?? byName.get(identifier);
                if (field == null)
                    throw new Error(`Unknown field ${identifier}`);
                if (field.config.type === 'multipleRecordLinks')
                    needsLinkedState = true;
            }
            const linkedStates = Object.values(
                context.linkedTableLoadingStates
            );
            // Empty means no loads are pending. Lookup values are already inline.
            if (
                needsLinkedState &&
                linkedStates.length > 0 &&
                linkedStates.every((state) => state.type === 'loading')
            )
                return false;
            runner.context = context;
            return !FormulaRunner.isFalsyValue(runner.run());
        },
    };
}

/** Complete condition compilation and execution with no host evaluator callback. */
export type SelectConditionEvaluationInput<T extends { id: string }> = Omit<
    SelectFormulaEvaluationInput<T>,
    'formulaForChoice'
> & {
    conditionFields: import('../runtime/types.js').RuntimeAirtableField[];
    rules: readonly {
        optionId: string | null | undefined;
        conditions:
            | import('../runtime/types.js').RuntimeConditionsDefinition
            | null;
    }[];
};

export function createSelectConditionEvaluation<T extends { id: string }>(
    input: SelectConditionEvaluationInput<T>
): SelectChoiceEvaluation<T> {
    return createSelectFormulaEvaluation({
        ...input,
        formulaForChoice: (choice) =>
            compileSelectConditions(
                input.rules.find((rule) => rule.optionId === choice.id)
                    ?.conditions ?? null,
                input.conditionFields
            ).formula,
    });
}
