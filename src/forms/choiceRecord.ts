import type {
    AirtableRecord,
    AirtableValue,
    FormLoadedResult,
    RuntimeFieldSchema,
} from '../runtime/types.js';
import { getSelectFieldPolicy } from '../ui/selectPolicy.js';
import { createScalarFormRecordProjection } from './projection.js';
import { evaluateFormFieldVisibility } from './visibility.js';
const settings = (value: Record<string, unknown>): Record<string, unknown> =>
    value.state != null &&
    typeof value.state === 'object' &&
    !Array.isArray(value.state)
        ? (value.state as Record<string, unknown>)
        : {};

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

/** Scalar choice recipe; linked/lookup projection stays unavailable. */
export function formChoiceConditionRecord(
    page: FormLoadedResult,
    field: RuntimeFieldSchema,
    data: Readonly<Record<string, AirtableValue>>
): AirtableRecord | null {
    try {
        const schemas = Object.values(page.payload.fieldIdsToSchemas);
        const configured = new Set(page.payload.fieldIdsInForm);
        const pageMode = settings(page.payload.publicFields).multiPageFormMode;
        if (pageMode != null && pageMode !== 'one-page') return null;
        const projection = createScalarFormRecordProjection({
            fieldIds: page.payload.fieldIdsInForm,
            fieldIdsToSchemas: page.payload.fieldIdsToSchemas,
            airtableFields: schemas.map((schema) => schema.airtableField),
            data,
            recordId:
                page.payload.formRecord.type === 'edit'
                    ? page.payload.formRecord.recordId
                    : '',
            invalidConditionMode: 'strict',
        });
        if (projection.type !== 'available') return null;
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
                    const drivers = schemas.filter((schema) =>
                        reference.type === 'id'
                            ? schema.airtableField.id === reference.id
                            : reference.type === 'name'
                              ? schema.airtableField.name === reference.name
                              : false
                    );
                    const driver = drivers[0];
                    if (
                        drivers.length !== 1 ||
                        driver == null ||
                        !configured.has(driver.airtableField.id) ||
                        driver.airtableField.isComputed ||
                        !scalarTypes.has(driver.airtableField.config.type)
                    )
                        return false;
                    return true;
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
            // Reuse native/error/reference guards before the existing select
            // resolver evaluates its current projected record. A hidden
            // driver's accepted value remains in the draft, but is absent
            // from this record by the canonical conditional rule.
            const outcome = evaluateFormFieldVisibility({
                field: {
                    ...field,
                    miniExtConfig: {
                        ...field.miniExtConfig,
                        conditionalFields:
                            rule?.config?.conditionsForOption ?? undefined,
                        hideFieldIfEmpty: false,
                    },
                },
                airtableFields: schemas.map((schema) => schema.airtableField),
                data: projection.record.fields,
                formRecordType: 'create',
                evaluationMode: 'runtime',
                // Match the existing starter option resolver's saved-rule
                // policy; conditional-field projection above stays strict.
                invalidConditionMode: 'compatibility',
            });
            if (outcome.type === 'blocked') return null;
        }
        return projection.record;
    } catch {
        return null;
    }
}
