import { createDateFieldModel } from '../ui/dateModel.js';
import type { AirtableValue } from '../runtime/types.js';
import {
    createNumberFieldModel,
    createCheckboxFieldModel,
} from '../ui/scalarModels.js';
import type { SelectionModel } from '../ui/types.js';
import type {
    FieldActionResult,
    FormFieldBinding,
    FormFieldSnapshot,
} from './bindings.js';

/** Shared renderer actions. Owner adapters supply snapshots and native commits. */
export const createFieldBinding = (options: {
    fieldType: string;
    getClientTimeZone?(): string;
    model: SelectionModel | null;
    snapshot(): FormFieldSnapshot;
    write(value: AirtableValue): FieldActionResult;
    subscribe(listener: (state: FormFieldSnapshot) => void): () => void;
}): FormFieldBinding => {
    const scalarOptions = {
        getValue: () => options.snapshot().value,
        isCurrent: () => !options.snapshot().retired,
        canEdit: () => options.snapshot().canEdit,
        write: (value: number | boolean | null) =>
            options.write(value).accepted,
    };
    const scalar =
        options.fieldType === 'checkbox'
            ? createCheckboxFieldModel(scalarOptions)
            : ['number', 'currency', 'percent', 'duration', 'rating'].includes(
                    options.fieldType
                )
              ? createNumberFieldModel(scalarOptions)
              : null;
    const date =
        options.fieldType === 'date' || options.fieldType === 'dateTime'
            ? createDateFieldModel({
                  kind: options.fieldType,
                  getValue: () => options.snapshot().value,
                  getConfig: () => {
                      const field = options.snapshot().field;
                      if (!field) throw Error('retired');
                      return field.schema.airtableField.config;
                  },
                  getClientTimeZone: options.getClientTimeZone,
                  isCurrent: () => !options.snapshot().retired,
                  canEdit: () => options.snapshot().canEdit,
                  write: (value) => options.write(value).accepted,
              })
            : null;
    const snapshot = () => ({
        ...structuredClone(options.snapshot()),
        scalar: scalar?.getState() ?? null,
        date: date?.getState() ?? null,
    });
    return {
        selection: options.model,
        scalar,
        date,
        getSnapshot: snapshot,
        subscribe(listener) {
            const stop = options.subscribe(() => listener(snapshot()));
            const stopScalar = scalar?.subscribe(() => listener(snapshot()));
            const stopDate = date?.subscribe(() => listener(snapshot()));
            return () => {
                stopDate?.();
                stop();
                stopScalar?.();
            };
        },
        setValue: (value) => {
            const state = options.snapshot();
            if (state.retired) return { accepted: false, reason: 'retired' };
            if (!state.canEdit) return { accepted: false, reason: 'blocked' };
            const model = options.model;
            if (model === null) {
                if (date && !date.accepts(value))
                    return { accepted: false, reason: 'invalid-value' };
                if (
                    scalar &&
                    value !== null &&
                    (options.fieldType === 'checkbox'
                        ? typeof value !== 'boolean'
                        : typeof value !== 'number' || !Number.isFinite(value))
                )
                    return { accepted: false, reason: 'invalid-value' };
                const scalarRevision = scalar?.getState().revision;
                const dateRevision = date?.getState().revision;
                const result = options.write(value);
                if (result.accepted) {
                    scalar?.refresh(scalarRevision);
                    date?.refresh(dateRevision);
                }
                return result;
            }
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
    };
};
