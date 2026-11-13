import emailValidator from 'email-validator';
import { checkIfPageUrlIsValid } from './pageUrlValidation.js';

/** Host localization owns the message. Only character-limit takes an argument. */
export type OrdinaryFormFieldDiagnostic =
    | { code: 'character-limit'; limit: number }
    | {
          code:
              | 'required'
              | 'invalid-email'
              | 'invalid-url'
              | 'negative-number'
              | 'invalid-selection'
              | 'linked-minimum'
              | 'linked-maximum';
      };
export type OrdinaryFormFieldFallbackReason =
    | 'unsupported-kind'
    | 'noncanonical-schema'
    | 'malformed-metadata'
    | 'unproven-value';
export type OrdinaryFormFieldValidationResult =
    | { status: 'supported'; diagnostic: OrdinaryFormFieldDiagnostic | null }
    | { status: 'native-fallback'; reason: OrdinaryFormFieldFallbackReason };
export type ValidateOrdinaryFormFieldInput = {
    /** Expected physical kind, not a computed field's presentation kind. */
    fieldType: string;
    airtableFieldConfig: unknown;
    miniExtConfig: unknown;
    value: unknown;
    storedValue: unknown;
    isConditionallyHidden: boolean;
    isComputeMode: boolean;
};
const object = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);
const dense = (value: unknown[]): boolean =>
    Array.from(value).every((_, index) => Object.hasOwn(value, index));
const strings = (value: unknown): value is string[] =>
    Array.isArray(value) &&
    dense(value) &&
    value.every((v) => typeof v === 'string');
const computed = new Set([
    'formula',
    'createdTime',
    'rollup',
    'count',
    'multipleLookupValues',
    'autoNumber',
    'lastModifiedTime',
    'createdBy',
    'lastModifiedBy',
    'button',
    'externalSyncSource',
    'aiText',
]);
const kinds = new Set([
    ...computed,
    'singleLineText',
    'multilineText',
    'richText',
    'email',
    'url',
    'number',
    'currency',
    'percent',
    'duration',
    'rating',
    'checkbox',
    'barcode',
    'phoneNumber',
    'manualSort',
    'singleSelect',
    'multipleSelects',
    'singleCollaborator',
    'multipleCollaborators',
    'multipleRecordLinks',
    'date',
    'dateTime',
    'multipleAttachments',
]);
const ids = (multiple: boolean, value: unknown): string[] | null => {
    if (value == null || value === '') return [];
    if (multiple ? !Array.isArray(value) : Array.isArray(value)) return null;
    const entries: unknown[] =
        multiple && Array.isArray(value) ? value : [value];
    if (!dense(entries)) return null;
    const result: string[] = [];
    for (const entry of entries) {
        if (!object(entry) || typeof entry.id !== 'string') return null;
        result.push(entry.id);
    }
    return result;
};
const empty = (kind: string, value: unknown): boolean => {
    if (value == null || (typeof value === 'string' && value.trim() === ''))
        return true;
    if (kind === 'checkbox' && value === false) return true;
    if (kind === 'rating' && value === 0) return true;
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
const supported = (
    diagnostic: OrdinaryFormFieldDiagnostic | null
): OrdinaryFormFieldValidationResult => ({ status: 'supported', diagnostic });
const fallback = (
    reason: OrdinaryFormFieldFallbackReason
): OrdinaryFormFieldValidationResult => ({ status: 'native-fallback', reason });

/** Pure ordinary frontend rules. Fallback must call the unchanged native helper.
 * Does not evaluate conditional rules, dates, linked review debt, or Save policy.
 */
export const validateOrdinaryFormField = (
    input: ValidateOrdinaryFormFieldInput
): OrdinaryFormFieldValidationResult => {
    const {
        fieldType: kind,
        value,
        storedValue: stored,
        isConditionallyHidden: hidden,
    } = input;
    if (!kinds.has(kind)) return fallback('unsupported-kind');
    const physical = input.airtableFieldConfig;
    if (!object(physical) || physical.type !== kind)
        return fallback('noncanonical-schema');
    if (input.miniExtConfig != null && !object(input.miniExtConfig))
        return fallback('malformed-metadata');
    const config = input.miniExtConfig ?? {};
    if (!object(config)) return fallback('malformed-metadata');
    for (const key of [
        'required',
        'readOnly',
        'allowNegativeNumbers',
        'allowAddingNewOptions',
    ])
        if (config[key] != null && typeof config[key] !== 'boolean')
            return fallback('malformed-metadata');
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
            return fallback('malformed-metadata');
    const readOnly = config.readOnly === true;
    // Physical computed kinds waive Required; a presentation/computed flag does not
    // waive ordinary rules for a writable physical kind.
    if (
        !input.isComputeMode &&
        config.required === true &&
        !readOnly &&
        !computed.has(kind) &&
        !hidden &&
        empty(kind, value)
    )
        return supported({ code: 'required' });
    if (
        kind === 'multipleRecordLinks' &&
        !hidden &&
        typeof config.customMinimumRecordsToSelect === 'number'
    ) {
        if (value != null && value !== '' && !strings(value))
            return fallback('unproven-value');
        const count = Array.isArray(value) ? value.length : 0;
        if (count < config.customMinimumRecordsToSelect)
            return supported({ code: 'linked-minimum' });
    }
    if (value == null || value === '') return supported(null);
    if (kind === 'singleCollaborator' || kind === 'multipleCollaborators') {
        // Native's loose nonempty gate skips these shapes; do not turn the page
        // validator's strict refusal into a new native error.
        if (
            value === false ||
            value === 0 ||
            (Array.isArray(value) &&
                (value.length === 0 ||
                    (value.length === 1 && value[0] == null)))
        ) {
            if (
                kind === 'multipleCollaborators' &&
                Array.isArray(value) &&
                value.length === 0
            )
                return supported(null);
            return fallback('unproven-value');
        }
        const options = physical.options;
        if (!object(options) || !Array.isArray(options.choices))
            return fallback('malformed-metadata');
        const choices = ids(true, options.choices);
        if (choices === null) return fallback('malformed-metadata');
        const multiple = kind === 'multipleCollaborators';
        const submitted = ids(multiple, value);
        const allowed = new Set([...choices, ...(ids(multiple, stored) ?? [])]);
        return supported(
            submitted === null || submitted.some((id) => !allowed.has(id))
                ? { code: 'invalid-selection' }
                : null
        );
    }
    if (
        kind === 'singleLineText' ||
        kind === 'multilineText' ||
        kind === 'email' ||
        kind === 'url'
    ) {
        if (typeof value !== 'string') return fallback('unproven-value');
        if (readOnly) return supported(null);
        if (kind === 'email' && !emailValidator.validate(value))
            return supported({ code: 'invalid-email' });
        if (
            kind === 'url' &&
            config.allowInvalidUrls !== true &&
            !checkIfPageUrlIsValid(value)
        )
            return supported({ code: 'invalid-url' });
        if (
            (kind === 'singleLineText' || kind === 'multilineText') &&
            !hidden &&
            typeof config.characterLimit === 'number' &&
            value.length > config.characterLimit
        )
            return supported({
                code: 'character-limit',
                limit: config.characterLimit,
            });
    }
    if (kind === 'number' || kind === 'currency') {
        if (typeof value !== 'number' || !Number.isFinite(value))
            return fallback('unproven-value');
        if (value < 0 && !readOnly && config.allowNegativeNumbers !== true)
            return supported({ code: 'negative-number' });
    }
    if (kind === 'singleSelect' || kind === 'multipleSelects') {
        if (Array.isArray(value) && value.length === 0) return supported(null);
        if (
            Array.isArray(value) &&
            value.length === 1 &&
            (value[0] == null || value[0] === '')
        )
            return fallback('unproven-value');
        const options = physical.options;
        if (
            !object(options) ||
            !Array.isArray(options.choices) ||
            !dense(options.choices)
        )
            return fallback('malformed-metadata');
        const choices: { id: string; name: string }[] = [];
        for (const choice of options.choices) {
            if (
                !object(choice) ||
                typeof choice.id !== 'string' ||
                typeof choice.name !== 'string'
            )
                return fallback('malformed-metadata');
            choices.push({ id: choice.id, name: choice.name });
        }
        const limit = config.singleOrMultiSelectLimitSelectionOptions;
        if (limit != null && !strings(limit))
            return fallback('malformed-metadata');
        const limited =
            Array.isArray(limit) && limit.length !== 0 ? limit : null;
        const offered = choices
            .filter((c) => limited === null || limited.includes(c.id))
            .map((c) => c.name);
        const values = typeof value === 'string' ? [value] : value;
        if (!strings(values)) return fallback('unproven-value');
        const previous =
            stored == null || stored === ''
                ? []
                : typeof stored === 'string'
                  ? [stored]
                  : stored;
        if (!strings(previous)) return fallback('unproven-value');
        const allowNew =
            config.allowAddingNewOptions === true && limited === null;
        if (
            values.some(
                (v) =>
                    !previous.includes(v) && !offered.includes(v) && !allowNew
            ) ||
            (typeof config.maxNumberOfSelections === 'number' &&
                values.length > config.maxNumberOfSelections)
        )
            return supported({ code: 'invalid-selection' });
    }
    if (kind === 'multipleRecordLinks') {
        if (Array.isArray(value) && value.length === 0) return supported(null);
        if (!strings(value)) return fallback('unproven-value');
        if (value.some((id) => id.trim() === ''))
            return fallback('unproven-value');
        const max =
            config.maxRecordsToSelectOrCreate === '1'
                ? 1
                : config.customMaxRecordsToSelect;
        if (typeof max === 'number' && value.length > max)
            return supported({ code: 'linked-maximum' });
    }
    if (
        ['richText', 'phoneNumber', 'manualSort', 'date', 'dateTime'].includes(
            kind
        ) &&
        typeof value !== 'string'
    )
        return fallback('unproven-value');
    if (
        ['percent', 'duration', 'rating'].includes(kind) &&
        (typeof value !== 'number' || !Number.isFinite(value))
    )
        return fallback('unproven-value');
    if (kind === 'checkbox' && typeof value !== 'boolean')
        return fallback('unproven-value');
    if (
        kind === 'barcode' &&
        (!object(value) ||
            (value.text != null && typeof value.text !== 'string'))
    )
        return fallback('unproven-value');
    if (
        kind === 'multipleAttachments' &&
        (!Array.isArray(value) ||
            !dense(value) ||
            value.some((v) => v != null && !object(v)))
    )
        return fallback('unproven-value');
    // Known pass-through physical kinds have no ordinary kind rule. In
    // particular, date ranges and linked-open review belong to the page adapter.
    return supported(null);
};
