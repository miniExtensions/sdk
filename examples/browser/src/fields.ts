import {
    AirtableFieldType,
    type AirtableValue,
    type RuntimeAirtableField,
    type RuntimeFieldSchema,
    type SelectFieldChoice,
} from '@miniextensions/sdk';
import { createSelectControl } from '@miniextensions/sdk/ui';
import { element, labeled } from './dom.js';

export type FieldControl = {
    node: HTMLDivElement;
    read(): AirtableValue;
    write(value: AirtableValue): void;
    editable: boolean;
    updateSelectChoices?(choices: readonly SelectFieldChoice[]): void;
    destroy(): void;
};

const selectNames = (
    value: AirtableValue | undefined,
    multiple: boolean
): string[] => {
    if (value == null) return [];
    if (!multiple) {
        if (typeof value !== 'string')
            throw new TypeError(
                'A single select value must be a name or null.'
            );
        return value === '' ? [] : [value];
    }
    if (
        !Array.isArray(value) ||
        value.some((entry) => typeof entry !== 'string' || entry === '')
    )
        throw new TypeError(
            'A multiple select value must be an array of names.'
        );
    return [
        ...new Set(
            value.filter((entry): entry is string => typeof entry === 'string')
        ),
    ];
};

/** Use the returned Form schema directly instead of reconstructing its union. */
export const formFieldControl = (
    schema: RuntimeFieldSchema,
    initialValue: AirtableValue | undefined,
    onChange: () => void,
    forceReadOnly = false
): FieldControl => {
    if (
        schema.fieldType !== AirtableFieldType.SINGLE_SELECT &&
        schema.fieldType !== AirtableFieldType.MULTIPLE_SELECTS
    )
        return fieldControl(
            schema.airtableField,
            schema.miniExtConfig,
            initialValue,
            onChange,
            forceReadOnly
        );
    const config = schema.miniExtConfig;
    const title =
        typeof config?.title === 'string' && config.title.trim() !== ''
            ? config.title
            : schema.airtableField.name;
    const readOnly =
        forceReadOnly ||
        (config !== undefined &&
            'readOnly' in config &&
            config.readOnly === true) ||
        schema.airtableField.isComputed === true;
    const multiple = schema.fieldType === AirtableFieldType.MULTIPLE_SELECTS;
    let destroyed = false;
    const select = createSelectControl({
        field: schema,
        value: initialValue,
        label: title,
        readOnly,
        onChange: () => {
            if (!destroyed) onChange();
        },
    });
    const input = select.element.querySelector('select');
    if (input != null) input.dataset.fieldId = schema.airtableField.id;
    const node = element('div');
    node.append(
        select.element,
        element('span', schema.airtableField.id, 'field-hint')
    );
    return {
        node,
        editable: !readOnly,
        read: () => {
            const value = select.model.getState().value;
            return multiple ? [...value] : (value[0] ?? null);
        },
        write: (value) => {
            if (!destroyed) select.model.setValue(selectNames(value, multiple));
        },
        updateSelectChoices: (choices) => {
            if (!destroyed)
                select.model.setOptions(
                    choices.map((choice) => ({
                        value: choice.name,
                        label: choice.name,
                    }))
                );
        },
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            select.destroy();
        },
    };
};

const numericTypes = new Set<string>([
    AirtableFieldType.NUMBER,
    AirtableFieldType.CURRENCY,
    AirtableFieldType.PERCENT,
    AirtableFieldType.DURATION,
    AirtableFieldType.RATING,
]);
const textTypes = new Set<string>([
    AirtableFieldType.SINGLE_LINE_TEXT,
    AirtableFieldType.EMAIL,
    AirtableFieldType.URL,
    AirtableFieldType.MULTILINE_TEXT,
    AirtableFieldType.PHONE_NUMBER,
    AirtableFieldType.DATE,
    AirtableFieldType.DATE_TIME,
    AirtableFieldType.RICH_TEXT,
]);

/** Keep native values intact; custom presentation belongs to the application. */
export const displayValue = (value: AirtableValue | undefined): string => {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return JSON.stringify(value, null, 2);
};

export const recordTitle = (
    fields: RuntimeAirtableField[],
    values: Record<string, AirtableValue>,
    fallback: string
): string => {
    const primary = fields.find((field) => field.isPrimaryField) ?? fields[0];
    return primary == null
        ? fallback
        : displayValue(values[primary.id]) || fallback;
};

export const fieldControl = (
    field: RuntimeAirtableField,
    config: RuntimeFieldSchema['miniExtConfig'],
    initialValue: AirtableValue | undefined,
    onChange: () => void,
    forceReadOnly = false
): FieldControl => {
    const title =
        typeof config?.title === 'string' && config.title.trim() !== ''
            ? config.title
            : field.name;
    const readOnly =
        forceReadOnly ||
        (config !== undefined &&
            'readOnly' in config &&
            config.readOnly === true) ||
        field.isComputed === true;
    let value: AirtableValue = initialValue ?? null;
    let control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    let read: () => AirtableValue;
    let write: (next: AirtableValue) => void;
    let editable = !readOnly;
    let destroyed = false;
    let reconcileSelect: (() => void) | undefined;

    if (field.config.type === AirtableFieldType.CHECKBOX) {
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.checked = value === true;
        control = checkbox;
        read = () => checkbox.checked;
        write = (next) => {
            checkbox.checked = next === true;
        };
    } else if (
        field.config.type === AirtableFieldType.SINGLE_SELECT ||
        field.config.type === AirtableFieldType.MULTIPLE_SELECTS
    ) {
        const select = element('select');
        select.multiple =
            field.config.type === AirtableFieldType.MULTIPLE_SELECTS;
        if (!select.multiple) select.append(new Option('—', ''));
        for (const choice of field.config.options?.choices ?? []) {
            select.append(new Option(choice.name, choice.name));
        }
        control = select;
        read = () => {
            if (!select.multiple) return select.value || null;
            const remaining = new Set(
                Array.from(select.options)
                    .filter((option) => option.selected)
                    .map((option) => option.value)
            );
            // Keep returned/native order when saving an unchanged cell, then
            // append any newly selected names in their displayed order.
            const retained = selectNames(value, true).filter((name) =>
                remaining.delete(name)
            );
            return [...retained, ...remaining];
        };
        write = (next) => {
            const selected = new Set(selectNames(next, select.multiple));
            value = next;
            // Persisted names missing from current metadata remain visible and
            // selected. They are removed once deliberately deselected.
            for (const name of selected) {
                if (
                    !Array.from(select.options).some(
                        (option) => option.value === name
                    )
                ) {
                    const option = new Option(name, name);
                    option.dataset.persistedChoice = 'true';
                    select.append(option);
                }
            }
            for (const option of select.options)
                option.selected = selected.has(option.value);
            for (const option of Array.from(select.options))
                if (
                    option.dataset.persistedChoice === 'true' &&
                    !option.selected
                )
                    option.remove();
        };
        reconcileSelect = () => {
            if (readOnly) write(value);
            else write(read());
        };
        write(value);
    } else if (numericTypes.has(field.config.type)) {
        const input = element('input');
        input.type = 'number';
        input.step = 'any';
        input.value = initialValue == null ? '' : String(initialValue);
        control = input;
        read = () => {
            if (input.validity.badInput || !input.checkValidity())
                throw new Error(`${title} must be a valid number.`);
            if (input.value === '') return null;
            const numeric = input.valueAsNumber;
            if (!Number.isFinite(numeric))
                throw new Error(`${title} must be a number.`);
            return numeric;
        };
        write = (next) => {
            input.value = next == null ? '' : String(next);
        };
    } else if (textTypes.has(field.config.type)) {
        const input =
            field.config.type === AirtableFieldType.MULTILINE_TEXT ||
            field.config.type === AirtableFieldType.RICH_TEXT
                ? element('textarea')
                : element('input');
        if (input instanceof HTMLInputElement) {
            input.type =
                config !== undefined &&
                'obscurePassword' in config &&
                config.obscurePassword === true
                    ? 'password'
                    : field.config.type === AirtableFieldType.EMAIL
                      ? 'email'
                      : field.config.type === AirtableFieldType.URL
                        ? 'url'
                        : field.config.type === AirtableFieldType.DATE
                          ? 'date'
                          : 'text';
        }
        input.value = displayValue(value);
        if (
            config !== undefined &&
            'placeholderText' in config &&
            typeof config.placeholderText === 'string'
        )
            input.placeholder = config.placeholderText;
        control = input;
        read = () => input.value || null;
        write = (next) => {
            input.value = displayValue(next);
        };
    } else {
        // Links and attachments have separate authorized picker/upload controls.
        // Other complex/computed types are displayed without coercion.
        const output = element('textarea');
        output.value = displayValue(value);
        output.readOnly = true;
        control = output;
        editable = false;
        read = () => value;
        write = (next) => {
            value = next;
            output.value = displayValue(next);
        };
    }
    control.disabled = readOnly;
    control.dataset.fieldId = field.id;
    const notify = (): void => {
        if (destroyed) return;
        reconcileSelect?.();
        if (!readOnly) onChange();
    };
    if (!(control instanceof HTMLSelectElement))
        control.addEventListener('input', notify);
    control.addEventListener('change', notify);
    const node = element('div');
    node.append(labeled(title, control));
    node.append(element('span', field.id, 'field-hint'));
    return {
        node,
        read,
        editable,
        write: (next) => {
            if (!destroyed) write(next);
        },
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            control.removeEventListener('input', notify);
            control.removeEventListener('change', notify);
        },
    };
};
