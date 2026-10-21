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

const removeFieldConditions = <Setting extends RuntimeConditionSetting>(
    args: Pick<
        DropdownFilterChangeInput<Setting>,
        'airtableFields' | 'fieldId'
    > & {
        conditions: DropdownFilterConditions<Setting>['conditions'];
    }
): DropdownFilterConditions<Setting>['conditions'] =>
    args.conditions.reduce<DropdownFilterConditions<Setting>['conditions']>(
        (result, condition) => {
            if (condition.type === 'groupCondition') {
                const nested = removeFieldConditions({
                    ...args,
                    conditions: condition.conditions,
                });
                if (nested.length > 0)
                    result.push({ ...condition, conditions: nested });
                return result;
            }
            const { idOrName } = condition.setting;
            const conditionFieldId =
                idOrName.type === 'id'
                    ? idOrName.id
                    : args.airtableFields.find(
                          (field) => field.name === idOrName.name
                      )?.id;
            if (conditionFieldId !== args.fieldId) result.push(condition);
            return result;
        },
        []
    );

/** Explicit dropdown replacement only; no evaluation, permission or query effects. */
export const getFiltersAfterDropdownChange = <
    Setting extends RuntimeConditionSetting = RuntimeConditionSetting,
>(
    args: DropdownFilterChangeInput<Setting>
): DropdownFilterConditions<Setting> => {
    const definition = args.conditionsDefinition ?? {
        logicalOperator: 'and',
        conditions: [],
    };
    return {
        ...definition,
        conditions: [
            ...(args.dropdownCondition == null ? [] : [args.dropdownCondition]),
            ...removeFieldConditions({
                airtableFields: args.airtableFields,
                conditions: definition.conditions,
                fieldId: args.fieldId,
            }),
        ],
    };
};
