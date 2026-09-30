import {
    AirtableFieldType,
    type AirtableValue,
    type AirtableField,
} from '@miniextensions/sdk/formulas';
import type { RuntimeFieldSchema } from '@miniextensions/sdk';
import { element, labeled } from './dom.js';

export type FieldControl = {
    node: HTMLDivElement;
    read(): AirtableValue;
    write(value: AirtableValue): void;
    editable: boolean;
};

const numericTypes = new Set([
    AirtableFieldType.NUMBER,
    AirtableFieldType.CURRENCY,
    AirtableFieldType.PERCENT,
    AirtableFieldType.DURATION,
    AirtableFieldType.RATING,
]);
const textTypes = new Set([
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
export const displayValue = (value: AirtableValue): string => {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return JSON.stringify(value, null, 2);
};

export const recordTitle = (
    fields: AirtableField[],
    values: Record<string, AirtableValue>,
    fallback: string
): string => {
    const primary = fields.find((field) => field.isPrimaryField) ?? fields[0];
    return primary == null
        ? fallback
        : displayValue(values[primary.id]) || fallback;
};

export const fieldControl = (
    schema: RuntimeFieldSchema,
    initialValue: AirtableValue,
    onChange: () => void,
    forceReadOnly = false
): FieldControl => {
    const field = schema.airtableField;
    const config = schema.miniExtConfig;
    const title =
        typeof config?.title === 'string' && config.title.trim() !== ''
            ? config.title
            : field.name;
    const readOnly =
        forceReadOnly || config?.readOnly === true || field.isComputed === true;
    let value = initialValue;
    let control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    let read: () => AirtableValue;
    let write: (next: AirtableValue) => void;
    let editable = !readOnly;

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
        read = () =>
            select.multiple
                ? Array.from(select.selectedOptions, (option) => option.value)
                : select.value || null;
        write = (next) => {
            const selected = new Set(Array.isArray(next) ? next : [next]);
            for (const option of select.options)
                option.selected = selected.has(option.value);
        };
        write(value);
    } else if (numericTypes.has(field.config.type)) {
        const input = element('input');
        input.type = 'number';
        input.step = 'any';
        input.value = initialValue == null ? '' : String(initialValue);
        control = input;
        read = () => {
            if (input.value === '') return null;
            const numeric = Number(input.value);
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
                config?.obscurePassword === true
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
        if (typeof config?.placeholderText === 'string')
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
    control.addEventListener('input', onChange);
    control.addEventListener('change', onChange);
    const node = element('div');
    node.append(labeled(title, control));
    node.append(element('span', field.id, 'field-hint'));
    return { node, read, write, editable };
};
