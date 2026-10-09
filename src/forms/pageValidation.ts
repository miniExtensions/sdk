import type { AirtableValue } from '../runtime/types.js';
import type { LoadedFormFieldDescriptor } from './helpers.js';
import { getSelectFieldPolicy } from '../ui/selectPolicy.js';

export type FormPageProblem = {
    fieldId: string | null;
    code:
        | 'required'
        | 'character-limit'
        | 'negative-number'
        | 'invalid-selection'
        | 'linked-minimum'
        | 'linked-maximum'
        | 'invalid-input'
        | 'unsupported-validation'
        | 'invalid-metadata'
        | 'blocked-visibility'
        | 'unsupported-configuration';
};
const object = (v: unknown): v is Record<string, unknown> =>
    v != null && typeof v === 'object' && !Array.isArray(v);
const ordinary = new Set([
    'singleLineText',
    'multilineText',
    'richText',
    'number',
    'currency',
    'percent',
    'duration',
    'rating',
    'checkbox',
    'barcode',
    'phoneNumber',
    'email',
    'url',
    'singleSelect',
    'multipleSelects',
    'multipleRecordLinks',
    'date',
    'dateTime',
    'multipleAttachments',
    'button',
]);
export const pageValueEmpty = (type: string, value: unknown): boolean => {
    if (value == null || (typeof value === 'string' && value.trim() === ''))
        return true;
    if (type === 'checkbox' && value === false) return true;
    if (type === 'rating' && value === 0) return true;
    if (
        Array.isArray(value) &&
        (value.length === 0 || value.every((v) => v == null))
    )
        return true;
    if (object(value) && 'text' in value)
        return (
            value.text == null ||
            (typeof value.text === 'string' && value.text.trim() === '')
        );
    return false;
};
/** Bounded canonical ordinary frontend rules. No network or backend validation. */
export const validatePageField = (
    field: LoadedFormFieldDescriptor,
    value: AirtableValue | undefined,
    stored: AirtableValue | undefined,
    hidden: boolean
): FormPageProblem | null => {
    const type = field.fieldType;
    const config: Record<string, unknown> = field.schema.miniExtConfig ?? {};
    const problem = (code: FormPageProblem['code']): FormPageProblem => ({
        fieldId: field.fieldId,
        code,
    });
    // Open-tracking is a separate unsupported requirement, even for readonly
    // or computed presentation; ordinary computed-field exemptions do not waive it.
    if (config.requireOpenLinkedRecords === true)
        return problem('unsupported-validation');
    if (field.isComputed) return null;
    for (const key of [
        'required',
        'readOnly',
        'allowNegativeNumbers',
        'allowAddingNewOptions',
    ])
        if (config[key] != null && typeof config[key] !== 'boolean')
            return problem('invalid-metadata');
    for (const key of [
        'characterLimit',
        'maxNumberOfSelections',
        'customMinimumRecordsToSelect',
        'customMaxRecordsToSelect',
    ])
        if (
            config[key] != null &&
            (typeof config[key] !== 'number' || !Number.isFinite(config[key]))
        )
            return problem('invalid-metadata');
    if (
        !hidden &&
        !field.readOnly &&
        config.fieldValidationConditionalFields != null &&
        (!object(config.fieldValidationConditionalFields) ||
            !Array.isArray(
                config.fieldValidationConditionalFields.conditions
            ) ||
            config.fieldValidationConditionalFields.conditions.length > 0)
    )
        return problem('unsupported-validation');
    if (
        config.required === true &&
        !hidden &&
        !field.readOnly &&
        pageValueEmpty(type, value)
    )
        return problem('required');
    if (
        type === 'multipleRecordLinks' &&
        !hidden &&
        typeof config.customMinimumRecordsToSelect === 'number'
    ) {
        const count = Array.isArray(value)
            ? value.length
            : value == null || value === ''
              ? 0
              : null;
        if (count != null && count < config.customMinimumRecordsToSelect)
            return problem('linked-minimum');
    }
    // Canonical ordinary rules use this exact non-null/nonempty gate, not required emptiness.
    if (value == null || value === '') return null;
    if (!ordinary.has(type)) return problem('unsupported-validation');
    if (
        (type === 'email' || type === 'url') &&
        !field.readOnly &&
        !(type === 'url' && config.allowInvalidUrls === true)
    )
        return problem('unsupported-validation');
    if (type === 'singleLineText' || type === 'multilineText') {
        if (typeof value !== 'string') return problem('invalid-input');
        if (
            !hidden &&
            !field.readOnly &&
            typeof config.characterLimit === 'number' &&
            value.length > config.characterLimit
        )
            return problem('character-limit');
    }
    if (type === 'number' || type === 'currency') {
        if (typeof value !== 'number' || !Number.isFinite(value))
            return problem('invalid-input');
        if (
            value < 0 &&
            !field.readOnly &&
            config.allowNegativeNumbers !== true
        )
            return problem('negative-number');
    }
    if (type === 'singleSelect' || type === 'multipleSelects') {
        try {
            const policy = getSelectFieldPolicy(field.schema);
            const values = Array.isArray(value) ? value : [value];
            if (
                Array.from(values).some(
                    (v, i) => !Object.hasOwn(values, i) || typeof v !== 'string'
                )
            )
                return problem('invalid-input');
            const previous = Array.isArray(stored) ? stored : [stored];
            const allowed = policy.options
                .filter(
                    (o) =>
                        policy.allowedOptionIds == null ||
                        policy.allowedOptionIds.includes(o.id)
                )
                .map((o) => o.value);
            // Readonly is not an exemption for canonical select validity/count.
            const adding =
                config.allowAddingNewOptions === true &&
                policy.allowedOptionIds == null;
            if (
                values.some(
                    (v) =>
                        !previous.includes(v) &&
                        !allowed.includes(String(v)) &&
                        !adding
                ) ||
                (policy.maxSelections != null &&
                    values.length > policy.maxSelections)
            )
                return problem('invalid-selection');
        } catch {
            return problem('invalid-metadata');
        }
    }
    if (type === 'multipleRecordLinks') {
        if (
            !Array.isArray(value) ||
            Array.from(value).some(
                (v, i) =>
                    !Object.hasOwn(value, i) ||
                    typeof v !== 'string' ||
                    v.trim() === ''
            )
        )
            return problem('invalid-input');
        const maximum =
            config.maxRecordsToSelectOrCreate === '1'
                ? 1
                : config.customMaxRecordsToSelect;
        if (typeof maximum === 'number' && value.length > maximum)
            return problem('linked-maximum');
    }
    return null;
};
