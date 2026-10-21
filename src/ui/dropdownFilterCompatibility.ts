import type {
    RuntimeConditionsDefinition,
    RuntimeConditionItem,
} from '../runtime/types.js';

export type DropdownFilterChangeInput = {
    airtableFields: readonly { id: string; name: string }[];
    conditionsDefinition: RuntimeConditionsDefinition | null;
    dropdownCondition: Extract<
        RuntimeConditionItem,
        { type: 'singleCondition' }
    > | null;
    fieldId: string;
};

const removeFieldConditions = (
    args: Pick<DropdownFilterChangeInput, 'airtableFields' | 'fieldId'> & {
        conditions: RuntimeConditionsDefinition['conditions'];
    }
): RuntimeConditionsDefinition['conditions'] =>
    args.conditions.reduce<RuntimeConditionsDefinition['conditions']>(
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
export const getFiltersAfterDropdownChange = (
    args: DropdownFilterChangeInput
): RuntimeConditionsDefinition => {
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
