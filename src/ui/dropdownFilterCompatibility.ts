import type {
    RuntimeConditionsDefinition,
    RuntimeConditionSetting,
} from '../runtime/types.js';

// Preserve caller-owned nominal enum/settings types while sharing only tree
// reconciliation. The helper never creates or converts a predicate setting.
type DropdownFilterConditions<Setting extends RuntimeConditionSetting> = {
    logicalOperator: RuntimeConditionsDefinition['logicalOperator'];
    conditions: (
        | { id: string; type: 'singleCondition'; setting: Setting }
        | ({
              id: string;
              type: 'groupCondition';
          } & DropdownFilterConditions<Setting>)
    )[];
};

export type DropdownFilterChangeInput<
    Setting extends RuntimeConditionSetting = RuntimeConditionSetting,
> = {
    airtableFields: readonly { id: string; name: string }[];
    conditionsDefinition: DropdownFilterConditions<Setting> | null;
    dropdownCondition: Extract<
        DropdownFilterConditions<Setting>['conditions'][number],
        { type: 'singleCondition' }
    > | null;
    fieldId: string;
};

type ReconciliationPolicy<Setting extends RuntimeConditionSetting> = {
    maximumGroupLevel: number;
    settingForMatch(id: string, raw: Setting): Setting;
};

export function matchDropdownFieldId(
    fields: DropdownFilterChangeInput['airtableFields'],
    reference: RuntimeConditionSetting['idOrName'],
    uniqueNames = false
) {
    if (reference.type === 'id') return reference.id;
    const matching = (field: (typeof fields)[number]) =>
        field.name === reference.name;
    if (!uniqueNames) return fields.find(matching)?.id;
    const matches = fields.filter(matching);
    return matches.length === 1 ? matches[0].id : undefined;
}

const removeFieldConditions = <Setting extends RuntimeConditionSetting>(
    args: Pick<
        DropdownFilterChangeInput<Setting>,
        'airtableFields' | 'fieldId'
    > & {
        conditions: DropdownFilterConditions<Setting>['conditions'];
    },
    policy?: ReconciliationPolicy<Setting>,
    level = 0
): DropdownFilterConditions<Setting>['conditions'] =>
    args.conditions.reduce<DropdownFilterConditions<Setting>['conditions']>(
        (result, condition) => {
            if (condition.type === 'groupCondition') {
                if (policy && level >= policy.maximumGroupLevel) {
                    result.push(condition);
                    return result;
                }
                const nested = removeFieldConditions(
                    { ...args, conditions: condition.conditions },
                    policy,
                    level + 1
                );
                if (
                    nested.length > 0 ||
                    (policy && !condition.conditions.length)
                )
                    result.push({ ...condition, conditions: nested });
                return result;
            }
            const { idOrName } = policy
                ? policy.settingForMatch(condition.id, condition.setting)
                : condition.setting;
            const conditionFieldId = matchDropdownFieldId(
                args.airtableFields,
                idOrName,
                Boolean(policy)
            );
            if (conditionFieldId !== args.fieldId) result.push(condition);
            return result;
        },
        []
    );

/** Explicit dropdown replacement only; no evaluation, permission or query effects. */
export function reconcileDropdownFilterChange<
    Setting extends RuntimeConditionSetting = RuntimeConditionSetting,
>(
    args: DropdownFilterChangeInput<Setting>,
    policy?: ReconciliationPolicy<Setting>
): DropdownFilterConditions<Setting> {
    const definition = args.conditionsDefinition ?? {
        logicalOperator: 'and',
        conditions: [],
    };
    return {
        ...definition,
        conditions: [
            ...(args.dropdownCondition == null ? [] : [args.dropdownCondition]),
            ...removeFieldConditions(
                {
                    airtableFields: args.airtableFields,
                    conditions: definition.conditions,
                    fieldId: args.fieldId,
                },
                policy
            ),
        ],
    };
}

export const getFiltersAfterDropdownChange = <
    Setting extends RuntimeConditionSetting = RuntimeConditionSetting,
>(
    args: DropdownFilterChangeInput<Setting>
): DropdownFilterConditions<Setting> => reconcileDropdownFilterChange(args);
