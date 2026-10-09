import type { AirtableValue, RuntimeFieldSchema } from '../runtime/types.js';
import type { LoadedFormFieldDescriptor } from './helpers.js';
import { getSelectFieldPolicy } from '../ui/selectPolicy.js';
import emailValidator from 'email-validator';
import { checkIfPageUrlIsValid } from './pageUrlValidation.js';
import { evaluateFormFieldVisibility } from './visibility.js';

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
        | 'invalid-email'
        | 'invalid-url'
        | 'conditional-validation'
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
    'singleCollaborator',
    'multipleCollaborators',
    'multipleRecordLinks',
    'date',
    'dateTime',
    'multipleAttachments',
    'button',
]);
const collaboratorIds = (
    multiple: boolean,
    value: unknown
): string[] | null => {
    if (value == null || value === '') return [];
    const values = multiple
        ? Array.isArray(value)
            ? value
            : null
        : Array.isArray(value)
          ? null
          : [value];
    if (values === null) return null;
    const ids: string[] = [];
    for (let index = 0; index < values.length; index++) {
        const entry = values[index];
        if (!Object.hasOwn(values, index) || !object(entry)) return null;
        const id = entry.id;
        if (typeof id !== 'string') return null;
        ids.push(id);
    }
    return ids;
};
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
const validateOrdinaryPageField = (
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
    if (type === 'singleCollaborator' || type === 'multipleCollaborators') {
        const multiple = type === 'multipleCollaborators';
        // An explicit empty multiple selection needs no selectable-ID authority.
        if (multiple && Array.isArray(value) && value.length === 0) return null;
        const physical = field.schema.airtableField.config;
        if (
            (physical.type !== 'singleCollaborator' &&
                physical.type !== 'multipleCollaborators') ||
            physical.type !== type ||
            !object(physical.options) ||
            !Array.isArray(physical.options.choices)
        )
            return problem('invalid-metadata');
        const choices = collaboratorIds(true, physical.options.choices);
        if (choices === null) return problem('invalid-metadata');
        const submitted = collaboratorIds(multiple, value);
        const previous = collaboratorIds(multiple, stored) ?? [];
        const allowed = new Set([...choices, ...previous]);
        // Canonical selection validity uses IDs, not display metadata or email syntax.
        if (submitted === null || submitted.some((id) => !allowed.has(id)))
            return problem('invalid-selection');
        return null;
    }
    if (type === 'url' && !field.readOnly && config.allowInvalidUrls !== true) {
        if (typeof value !== 'string') return problem('invalid-input');
        if (!checkIfPageUrlIsValid(value)) return problem('invalid-url');
    }
    // Email syntax, unlike required/character limits, is not waived by hiding.
    // Keep the original native string: the canonical validator does not trim it.
    if (type === 'email' && !field.readOnly) {
        if (typeof value !== 'string') return problem('invalid-input');
        if (!emailValidator.validate(value)) return problem('invalid-email');
    }
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

// Canonical runtime enablement excludes these physical kinds even when a
// returned optional isComputed flag is absent. This is not write authority.
const computedTargets = new Set([
    'formula',
    'rollup',
    'count',
    'multipleLookupValues',
    'autoNumber',
    'createdTime',
    'lastModifiedTime',
    'createdBy',
    'lastModifiedBy',
    'button',
    'externalSyncSource',
    'aiText',
]);

type ConditionalPageContext = {
    data: Readonly<Record<string, AirtableValue>>;
    fieldIdsToSchemas: Readonly<Record<string, RuntimeFieldSchema | undefined>>;
};

/** Ordinary feedback precedes configured validation, as in the frontend. */
export const validatePageField = (
    field: LoadedFormFieldDescriptor,
    value: AirtableValue | undefined,
    stored: AirtableValue | undefined,
    hidden: boolean,
    context?: ConditionalPageContext
): FormPageProblem | null => {
    const ordinaryProblem = validateOrdinaryPageField(
        field,
        value,
        stored,
        hidden
    );
    if (ordinaryProblem) return ordinaryProblem;
    const config = field.schema.miniExtConfig;
    if (
        hidden ||
        field.readOnly ||
        field.isComputed ||
        computedTargets.has(field.schema.airtableField.config.type) ||
        config == null ||
        !('fieldValidationConditionalFields' in config) ||
        config.fieldValidationConditionalFields == null
    )
        return null;
    const definition = config.fieldValidationConditionalFields;
    // Empty definitions have no active advanced validation, including legacy
    // definitions whose otherwise unused group setting is malformed.
    if (
        object(definition) &&
        Array.isArray(definition.conditions) &&
        definition.conditions.length === 0
    )
        return null;
    const refused: FormPageProblem = {
        fieldId: field.fieldId,
        code: 'unsupported-validation',
    };
    if (!context) return refused;
    try {
        const schemas = Object.entries(context.fieldIdsToSchemas);
        const ids = new Set<string>();
        for (const [id, schema] of schemas) {
            const physical = schema?.airtableField;
            if (
                !schema ||
                !physical ||
                physical.id !== id ||
                typeof physical.name !== 'string' ||
                (physical.isComputed !== undefined &&
                    typeof physical.isComputed !== 'boolean') ||
                schema.fieldType !== physical.config.type ||
                ids.has(physical.id)
            )
                return refused;
            ids.add(physical.id);
        }
        // Reuse the scalar predicate evaluator without borrowing field hiding,
        // sections, filtered records or any replacement Save data.
        const result = evaluateFormFieldVisibility({
            field: {
                ...field.schema,
                miniExtConfig: { conditionalFields: definition },
            },
            airtableFields: schemas.map(([, schema]) => schema!.airtableField),
            data: context.data,
            formRecordType: 'create',
            evaluationMode: 'runtime',
            invalidConditionMode: 'strict',
        });
        if (
            result.type === 'blocked' ||
            result.diagnostics.some((d) => d.code === 'missing-field')
        )
            return refused;
        const message = config.customErrorMessageForFieldValidation;
        if (message != null && typeof message !== 'string') return refused;
        // Canonical evaluation happens before the outer caller's truthy-message
        // check. An exact empty custom message suppresses only a valid failure.
        return result.type === 'hidden' && message !== ''
            ? { fieldId: field.fieldId, code: 'conditional-validation' }
            : null;
    } catch {
        return refused;
    }
};
