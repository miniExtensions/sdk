import { AirtableFieldType } from '../formulas/types.js';
import type { AirtableValue, RuntimeFieldSchema } from '../runtime/types.js';
import { createSelectionModel } from './model.js';
import { getSelectFieldPolicy } from './selectPolicy.js';
import type {
    SelectionModel,
    SelectionOption,
    SelectionState,
} from './types.js';

export type SelectFieldModelOptions = {
    field: RuntimeFieldSchema;
    value?: AirtableValue;
    onChange?: (value: AirtableValue) => void;
    disabled?: boolean;
    readOnly?: boolean;
};

const selectValues = (
    value: SelectFieldModelOptions['value'],
    multiple: boolean
): string[] => {
    if (value == null) return [];
    if (multiple) {
        const entries = Array.isArray(value) ? Array.from(value) : null;
        if (
            entries == null ||
            entries.some((entry) => typeof entry !== 'string' || entry === '')
        ) {
            throw new TypeError(
                'A multiple select value must be an array of names.'
            );
        }
        return [...new Set(entries as string[])];
    }
    if (typeof value !== 'string') {
        throw new TypeError('A single select value must be a name or null.');
    }
    return value === '' ? [] : [value];
};

/** Published select behavior without a Document or renderer. */
export const createSelectFieldModel = (
    options: SelectFieldModelOptions
): SelectionModel => {
    const policy = getSelectFieldPolicy(options.field);
    const multiple =
        options.field.fieldType === AirtableFieldType.MULTIPLE_SELECTS;
    const canonicalReadOnly = policy.readOnly;
    const allOptions = policy.options.map(({ value, label }) => ({
        value,
        label,
    }));
    const configuredLabels = new Map(
        allOptions
            .filter((option) => option.label !== option.value)
            .map((option) => [option.value, option.label])
    );
    const allowedNames = new Set(
        policy.options
            .filter(
                (option) =>
                    policy.allowedOptionIds === null ||
                    policy.allowedOptionIds.includes(option.id)
            )
            .map((option) => option.value)
    );
    const filterOptions = (
        next: readonly SelectionOption[]
    ): readonly SelectionOption[] =>
        (canonicalReadOnly || policy.allowedOptionIds === null
            ? next
            : next.filter((option) => allowedNames.has(option.value))
        ).map((option) => ({
            ...option,
            label: configuredLabels.get(option.value) ?? option.label,
        }));
    const modelOptions = filterOptions(allOptions);
    // Search filters the public snapshot, not the model's selectable options.
    let currentOptions = modelOptions.map((option) => ({ ...option }));
    let destroyed = false;
    const callback = options.onChange;
    const onChange = (value: readonly string[]): void => {
        if (!canonicalReadOnly) {
            callback?.(multiple ? [...value] : (value[0] ?? null));
        }
    };
    const model = createSelectionModel({
        multiple,
        options: modelOptions,
        selectedOptions: allOptions,
        value: selectValues(options.value, multiple),
        disabled: options.disabled,
        readOnly: options.readOnly === true || canonicalReadOnly,
        onChange,
    });
    const reset = model.reset;
    const setOptions = model.setOptions;
    const setReadOnly = model.setReadOnly;
    const choose = model.choose;
    model.choose = (next): void => {
        const state = model.getState();
        const available = new Map(
            currentOptions.map((option) => [option.value, option])
        );
        const accepted = [
            ...new Set(
                next.filter(
                    (value) =>
                        state.value.includes(value) ||
                        (available.has(value) &&
                            available.get(value)?.disabled !== true)
                )
            ),
        ];
        if (
            multiple &&
            policy.maxSelections !== null &&
            accepted.length > policy.maxSelections &&
            accepted.some((value) => !state.value.includes(value))
        )
            return;
        choose(next);
    };
    model.toggle = (value): void => {
        const state = model.getState();
        model.choose(
            state.value.includes(value)
                ? state.value.filter((selected) => selected !== value)
                : multiple
                  ? [...state.value, value]
                  : [value]
        );
    };
    model.setOptions = (next): void => {
        if (destroyed) return;
        currentOptions = filterOptions(next).map((option) => ({ ...option }));
        setOptions(currentOptions);
    };
    model.setReadOnly = (next): void => setReadOnly(canonicalReadOnly || next);
    model.reset = (next): void => {
        if (destroyed) return;
        if (next.multiple !== undefined && next.multiple !== multiple) {
            throw new TypeError(
                'Recreate the select model to change its field mode.'
            );
        }
        if (next.loadOptions !== undefined) {
            throw new TypeError(
                'Use mountSelectionControl for an async selection model.'
            );
        }
        currentOptions = filterOptions(next.options ?? modelOptions).map(
            (option) => ({ ...option })
        );
        reset({
            ...next,
            multiple,
            options: currentOptions,
            selectedOptions: next.selectedOptions ?? allOptions,
            readOnly: canonicalReadOnly || next.readOnly === true,
            onChange,
        });
    };
    const decorate = (state: SelectionState): SelectionState => ({
        ...state,
        options: state.options.map((option) => ({
            ...option,
            disabled:
                option.disabled === true ||
                (multiple &&
                    policy.maxSelections !== null &&
                    state.value.length >= policy.maxSelections &&
                    !state.value.includes(option.value)),
        })),
    });
    const getState = model.getState;
    const subscribe = model.subscribe;
    model.getState = () => decorate(getState());
    model.subscribe = (listener) =>
        subscribe((state) => listener(decorate(state)));
    const destroy = model.destroy;
    model.destroy = () => {
        if (destroyed) return;
        destroyed = true;
        destroy();
    };
    return model;
};
