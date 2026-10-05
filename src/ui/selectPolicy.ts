import { AirtableFieldType } from '../formulas/types.js';
import type { RuntimeFieldSchema } from '../runtime/types.js';
import type { SelectionOption } from './types.js';

export type SelectFieldPolicy = {
    /** IDs constrain available metadata; native values remain choice names. */
    allowedOptionIds: readonly string[] | null;
    options: readonly (SelectionOption & { id: string })[];
    readOnly: boolean;
    allowAddingNewOptions: boolean;
    maxSelections: number | null;
};

/** Static published policy only; this does not evaluate option conditions. */
export const getSelectFieldPolicy = (
    schema: RuntimeFieldSchema
): SelectFieldPolicy => {
    const field = schema?.airtableField;
    const config = field?.config;
    if (
        config == null ||
        (config.type !== AirtableFieldType.SINGLE_SELECT &&
            config.type !== AirtableFieldType.MULTIPLE_SELECTS) ||
        schema.fieldType !== config.type
    )
        throw new TypeError(
            'Expected a canonical singleSelect or multipleSelects field.'
        );
    const mini = schema.miniExtConfig;
    const readOnly =
        mini !== undefined && 'readOnly' in mini ? mini.readOnly : undefined;
    if (
        typeof field.id !== 'string' ||
        field.id === '' ||
        typeof field.name !== 'string' ||
        field.name === '' ||
        (field.isComputed !== undefined &&
            typeof field.isComputed !== 'boolean') ||
        (readOnly !== undefined && typeof readOnly !== 'boolean')
    )
        throw new TypeError(
            'Select field identity and permission flags are malformed.'
        );
    const choices = config.options == null ? [] : config.options.choices;
    if (!Array.isArray(choices))
        throw new TypeError('Select field choices must be an array.');
    const limited =
        mini !== undefined && 'singleOrMultiSelectLimitSelectionOptions' in mini
            ? mini.singleOrMultiSelectLimitSelectionOptions
            : undefined;
    if (
        limited !== undefined &&
        (!Array.isArray(limited) ||
            Array.from(limited).some(
                (id) => typeof id !== 'string' || id === ''
            ))
    )
        throw new TypeError('Select option limits must be choice IDs.');
    const maximum =
        mini !== undefined && 'maxNumberOfSelections' in mini
            ? mini.maxNumberOfSelections
            : undefined;
    if (
        maximum !== undefined &&
        (typeof maximum !== 'number' ||
            !Number.isFinite(maximum) ||
            maximum < 0)
    )
        throw new TypeError(
            'Maximum select selections must be a nonnegative number.'
        );
    const conditionalLabels =
        mini !== undefined &&
        'enableConditionalOptions' in mini &&
        mini.enableConditionalOptions === true;
    const conditions =
        mini !== undefined && 'conditionsForOptions' in mini
            ? mini.conditionsForOptions
            : undefined;
    const names = new Set<string>();
    const ids = new Set<string>();
    const presentations = choices.map((choice) => {
        if (
            choice == null ||
            typeof choice.id !== 'string' ||
            choice.id === '' ||
            typeof choice.name !== 'string' ||
            choice.name === '' ||
            ids.has(choice.id) ||
            names.has(choice.name)
        )
            throw new TypeError(
                'Select field choices must have unique IDs and names.'
            );
        ids.add(choice.id);
        names.add(choice.name);
        const configuredName =
            conditionalLabels && Array.isArray(conditions)
                ? conditions.find(
                      (option) =>
                          option.config?.optionForConditions === choice.id
                  )?.config?.name
                : undefined;
        const displayName =
            typeof configuredName === 'string' ? configuredName.trim() : '';
        return {
            id: choice.id,
            value: choice.name,
            label: displayName || choice.name,
        };
    });
    const counts = new Map<string, number>();
    for (const option of presentations)
        counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
    const canonicalReadOnly = field.isComputed === true || readOnly === true;
    const allowedOptionIds =
        limited !== undefined && limited.length !== 0 ? [...limited] : null;
    return {
        allowedOptionIds,
        options: presentations.map((option) => ({
            ...option,
            label:
                counts.get(option.label) === 1
                    ? option.label
                    : `${option.label} (${option.value})`,
        })),
        readOnly: canonicalReadOnly,
        allowAddingNewOptions:
            !canonicalReadOnly &&
            allowedOptionIds === null &&
            mini !== undefined &&
            'allowAddingNewOptions' in mini &&
            mini.allowAddingNewOptions === true,
        maxSelections: maximum ?? null,
    };
};
