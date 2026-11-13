import { compileRuntimeConditions } from './conditions.js';
import { compileSelectCompatibilityConditions } from './selectCompatibilityConditions.js';

type NativeArguments = Parameters<typeof compileSelectCompatibilityConditions>;
type NativeConditions = NativeArguments[0];
type NativeFields = NativeArguments[1];
type NativeOptions = NativeArguments[2];
type ConditionGroup = NonNullable<NativeConditions>;

type NativeFallbackReason =
    | 'unqualified'
    | 'unsupported'
    | 'invalid'
    | 'diagnostics'
    | 'exception';

export type SelectConditionCompilation =
    | { type: 'sdk'; formula: string }
    | { type: 'native'; formula: string; reason: NativeFallbackReason };

// Native consumer parity qualifies these finite pairs with saved ID references.
// Other pairs, regex and name output use the portable whole-AST compatibility compiler.
const singleSelectOperators = new Set<string>([
    'is',
    'isNot',
    'isAnyOf',
    'isNoneOf',
    'isEmpty',
    'isNotEmpty',
]);
const multipleSelectOperators = new Set<string>([
    'hasAllOf',
    'hasAnyOf',
    'hasNoneOf',
    'isExactly',
    'isEmpty',
    'isNotEmpty',
]);
const numericOperators = new Set<string>([
    'equals',
    'notEquals',
    'greaterThan',
    'lessThan',
    'greaterThanOrEqualsTo',
    'lessThanOrEqualsTo',
    'isEmpty',
    'isNotEmpty',
]);

function isParityQualified(
    conditions: NativeConditions,
    fields: NativeFields,
    options: NativeOptions
): boolean {
    if (conditions == null || options?.fieldReferenceMode === 'name')
        return false;

    const activeGroups = new WeakSet<object>();
    const qualifiesGroup = (group: ConditionGroup): boolean => {
        if (
            activeGroups.has(group) ||
            (group.logicalOperator !== 'and' &&
                group.logicalOperator !== 'or') ||
            group.conditions.length === 0
        )
            return false;
        activeGroups.add(group);
        const qualified = group.conditions.every((condition) => {
            if (condition.type === 'groupCondition')
                return qualifiesGroup(condition);
            if (condition.type !== 'singleCondition') return false;

            const { setting } = condition;
            const reference = setting.idOrName;
            if (reference.type !== 'id') return false;
            const operators =
                setting.fieldType === 'singleSelect'
                    ? singleSelectOperators
                    : setting.fieldType === 'multipleSelects'
                      ? multipleSelectOperators
                      : setting.fieldType === 'number' ||
                          setting.fieldType === 'currency' ||
                          setting.fieldType === 'percent' ||
                          setting.fieldType === 'rating'
                        ? numericOperators
                        : null;
            if (operators == null || !operators.has(setting.type)) return false;

            const matches = fields.filter((field) => field.id === reference.id);
            return (
                matches.length === 1 &&
                matches[0].config.type === setting.fieldType &&
                matches[0].isComputed === false
            );
        });
        activeGroups.delete(group);
        return qualified;
    };
    return qualifiesGroup(conditions);
}

/** Preserve the qualified cohort; compatibility fallback compiles the whole original AST. */
export function compileSelectConditions(
    conditions: NativeConditions,
    fields: NativeFields,
    options?: NativeOptions
): SelectConditionCompilation {
    let reason: NativeFallbackReason = 'unqualified';
    try {
        if (isParityQualified(conditions, fields, options)) {
            const result = compileRuntimeConditions({
                conditions,
                airtableFields: fields,
                invalidConditionMode:
                    options?.failClosedOnInvalidCondition === true
                        ? 'strict'
                        : 'compatibility',
                fieldReferenceMode: 'saved',
            });
            if (result.type === 'compiled') {
                if (result.diagnostics.length === 0)
                    return { type: 'sdk', formula: result.formula };
                reason = 'diagnostics';
            } else {
                reason = result.type;
            }
        }
    } catch {
        reason = 'exception';
    }

    // Keep compatibility exceptions outside the cohort catch and preserve caller policy.
    return {
        type: 'native',
        reason,
        formula: compileSelectCompatibilityConditions(
            conditions,
            fields,
            options
        ),
    };
}
