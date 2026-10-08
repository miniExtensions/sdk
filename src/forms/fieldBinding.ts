import type { AirtableValue } from '../runtime/types.js';
import type { SelectionModel } from '../ui/types.js';
import type {
    FieldActionResult,
    FormFieldBinding,
    FormFieldSnapshot,
} from './bindings.js';

/** Shared renderer actions. Owner adapters supply snapshots and native commits. */
export const createFieldBinding = (options: {
    fieldType: string;
    model: SelectionModel | null;
    snapshot(): FormFieldSnapshot;
    write(value: AirtableValue): FieldActionResult;
    subscribe(listener: (state: FormFieldSnapshot) => void): () => void;
}): FormFieldBinding => ({
    selection: options.model,
    getSnapshot: () => structuredClone(options.snapshot()),
    subscribe: options.subscribe,
    setValue: (value) => {
        const state = options.snapshot();
        if (state.retired) return { accepted: false, reason: 'retired' };
        if (!state.canEdit) return { accepted: false, reason: 'blocked' };
        const model = options.model;
        if (model === null) return options.write(value);
        let values: string[] | null;
        if (options.fieldType === 'singleSelect')
            values =
                value == null
                    ? []
                    : typeof value === 'string'
                      ? value === ''
                          ? []
                          : [value]
                      : null;
        else if (
            value == null ||
            (options.fieldType === 'multipleRecordLinks' &&
                typeof value === 'string' &&
                value.trim() === '')
        )
            values = [];
        else
            values =
                Array.isArray(value) &&
                Array.from(value).every(
                    (item, index) =>
                        Object.hasOwn(value, index) &&
                        typeof item === 'string' &&
                        (options.fieldType === 'multipleRecordLinks'
                            ? item.trim() !== ''
                            : item !== '')
                )
                    ? ([...value] as string[])
                    : null;
        if (values === null || !model.canChoose(values))
            return { accepted: false, reason: 'invalid-value' };
        model.choose(values);
        const next = model.getState().value;
        return next.length === new Set(values).size &&
            values.every((item) => next.includes(item))
            ? { accepted: true }
            : { accepted: false, reason: 'invalid-value' };
    },
});
