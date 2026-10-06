import type {
    AirtableRecord,
    AirtableValue,
    FormLoadedResult,
    RuntimeFieldSchema,
} from '@miniextensions/sdk';
import { getSelectFieldPolicy } from '@miniextensions/sdk/ui';
import { settings } from './dom.js';

const scalarTypes = new Set([
    'singleLineText',
    'email',
    'url',
    'multilineText',
    'phoneNumber',
    'barcode',
    'richText',
    'number',
    'percent',
    'currency',
    'rating',
    'checkbox',
]);
const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/** Narrow starter recipe, not the canonical linked/hidden Form projector. */
export function flatChoiceConditionRecord(
    page: FormLoadedResult,
    field: RuntimeFieldSchema,
    data: Readonly<Record<string, AirtableValue>>
): AirtableRecord | null {
    try {
        const schemas = Object.values(page.payload.fieldIdsToSchemas);
        const visible = new Set(page.payload.fieldIdsInForm);
        if (settings(page.payload.publicFields).multiPageFormMode != null)
            return null;
        // Inspect all published schemas: a section rule can prune another
        // driver's value even when that driver's own config has no condition.
        for (const schema of schemas) {
            const config = schema.miniExtConfig;
            if (config == null) continue;
            if (
                ('conditionalFields' in config &&
                    config.conditionalFields != null) ||
                ('applyFieldConditionsToSection' in config &&
                    config.applyFieldConditionsToSection === true) ||
                ('enableSectionHeader' in config &&
                    config.enableSectionHeader === true) ||
                ('headerSectionTitle' in config &&
                    typeof config.headerSectionTitle === 'string' &&
                    config.headerSectionTitle.trim() !== '') ||
                ('conditionalLinkedRecordFilterFields' in config &&
                    config.conditionalLinkedRecordFilterFields != null &&
                    (!Array.isArray(
                        config.conditionalLinkedRecordFilterFields
                    ) ||
                        config.conditionalLinkedRecordFilterFields.length !==
                            0))
            )
                return null;
        }
        const config = field.miniExtConfig;
        const rules =
            config && 'conditionsForOptions' in config
                ? config.conditionsForOptions
                : undefined;
        const policy = getSelectFieldPolicy(field);
        const active = new WeakSet<object>();
        const inspect = (definition: unknown): boolean => {
            if (definition == null) return true;
            if (
                !object(definition) ||
                !Array.isArray(definition.conditions) ||
                active.has(definition)
            )
                return false;
            active.add(definition);
            try {
                return definition.conditions.every((condition: unknown) => {
                    if (!object(condition)) return false;
                    if (condition.type === 'groupCondition')
                        return inspect(condition);
                    if (
                        condition.type !== 'singleCondition' ||
                        !object(condition.setting)
                    )
                        return false;
                    const reference = condition.setting.idOrName;
                    if (!object(reference)) return false;
                    const driver = schemas.find((schema) =>
                        reference.type === 'id'
                            ? schema.airtableField.id === reference.id
                            : reference.type === 'name'
                              ? schema.airtableField.name === reference.name
                              : false
                    );
                    if (
                        driver == null ||
                        !visible.has(driver.airtableField.id) ||
                        driver.airtableField.isComputed ||
                        !scalarTypes.has(driver.airtableField.config.type)
                    )
                        return false;
                    const driverConfig = driver.miniExtConfig;
                    return !(
                        driverConfig &&
                        'hideFieldIfEmpty' in driverConfig &&
                        driverConfig.hideFieldIfEmpty === true
                    );
                });
            } finally {
                active.delete(definition);
            }
        };
        for (const option of policy.options) {
            if (
                policy.allowedOptionIds !== null &&
                !policy.allowedOptionIds.includes(option.id)
            )
                continue;
            const rule = rules?.find(
                (candidate) =>
                    candidate.config?.optionForConditions === option.id
            );
            if (!inspect(rule?.config?.conditionsForOption ?? null))
                return null;
        }
        // Only these flat, visible direct scalar dependencies are supported.
        // Keep native bytes; the helper never reads links or computes values.
        return {
            id:
                page.payload.formRecord.type === 'edit'
                    ? page.payload.formRecord.recordId
                    : '',
            fields: { ...data },
        };
    } catch {
        return null;
    }
}
