import {
    AirtableFieldType,
    type AirtableValue,
    type RuntimeAirtableField,
    type RuntimeFieldSchema,
    type SelectFieldChoice,
    type MiniExtensionsClient,
} from '@miniextensions/sdk';
import {
    createSelectControl,
    mountSelectControl,
    type SelectionModel,
    createAddressAutocompleteControl,
    AddressAutocompleteConfigurationError,
    type SelectFieldAvailability,
} from '@miniextensions/sdk/ui';
import { element, labeled } from './dom.js';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';

export type FieldControl = {
    node: HTMLDivElement;
    read(): AirtableValue;
    write(value: AirtableValue): void;
    editable: boolean;
    updateSelectChoices?(choices: readonly SelectFieldChoice[]): void;
    updateSelectAvailability?(availability: SelectFieldAvailability): void;
    selectAvailabilityReady?(): boolean;
    isSelectOptionAvailable?(choice: SelectFieldChoice): boolean;
    setActive?(active: boolean): void;
    destroy(): void;
};

export type AddressFieldContext = {
    extensionAccessToken: string;
    reads: MiniExtensionsClient['addresses'];
    isCurrent(): boolean;
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
    forceReadOnly = false,
    address?: AddressFieldContext,
    binding?: FormFieldBinding
): FieldControl => {
    const config = schema.miniExtConfig;
    if (
        address != null &&
        schema.fieldType === AirtableFieldType.SINGLE_LINE_TEXT &&
        schema.airtableField.config.type ===
            AirtableFieldType.SINGLE_LINE_TEXT &&
        schema.airtableField.isComputed !== true &&
        !forceReadOnly &&
        config != null &&
        'enableAddressAutocomplete' in config &&
        config.enableAddressAutocomplete === true &&
        config.readOnly !== true &&
        config.obscurePassword !== true &&
        (initialValue == null || typeof initialValue === 'string')
    ) {
        try {
            const title =
                typeof config.title === 'string' && config.title.trim() !== ''
                    ? config.title
                    : schema.airtableField.name;
            const autocomplete = createAddressAutocompleteControl({
                input: {
                    extensionAccessToken: address.extensionAccessToken,
                    fieldId: schema.airtableField.id,
                },
                reads: address.reads,
                isCurrent: address.isCurrent,
                onChange,
                value: initialValue,
                label: title,
                characterLimit: config.characterLimit,
                placeholder: config.placeholderText ?? undefined,
            });
            autocomplete.input.dataset.fieldId = schema.airtableField.id;
            const node = element('div');
            node.append(
                autocomplete.element,
                element('span', schema.airtableField.id, 'field-hint')
            );
            return {
                node,
                editable: true,
                read: () => autocomplete.getValue() || null,
                write: (value) => {
                    if (value == null || typeof value === 'string')
                        autocomplete.setValue(value);
                },
                setActive: autocomplete.setActive,
                destroy: autocomplete.destroy,
            };
        } catch (error) {
            if (!(error instanceof AddressAutocompleteConfigurationError))
                throw error;
            const fallback = fieldControl(
                schema.airtableField,
                config,
                initialValue,
                onChange
            );
            const message = element(
                'p',
                'Address suggestions are unavailable for this character limit. You can enter an address manually.',
                'field-hint'
            );
            message.dataset.addressAutocompleteCode = error.code;
            message.setAttribute('role', 'status');
            fallback.node.append(message);
            return fallback;
        }
    }
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
    return selectFieldControl(
        schema,
        initialValue,
        onChange,
        forceReadOnly,
        binding?.selection ?? undefined
    );
};

const selectFieldControl = (
    schema: RuntimeFieldSchema,
    initialValue: AirtableValue | undefined,
    onChange: () => void,
    forceReadOnly = false,
    boundModel?: SelectionModel
): FieldControl => {
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
    let availabilityReady = true;
    let eligibleOptions: SelectFieldAvailability['options'] = [];
    const select = boundModel
        ? mountSelectControl(boundModel, { label: title })
        : createSelectControl({
              field: schema,
              value: initialValue,
              label: title,
              readOnly,
              onChange: () => {
                  if (!destroyed) onChange();
              },
          });
    const change = () => {
        if (!destroyed) onChange();
    };
    if (boundModel) select.element.addEventListener('change', change);
    const input = select.element.querySelector('select');
    if (input != null) input.dataset.fieldId = schema.airtableField.id;
    const node = element('div');
    const availabilityStatus = element('span', '', 'field-hint');
    availabilityStatus.dataset.choiceAvailabilityFieldId =
        schema.airtableField.id;
    availabilityStatus.setAttribute('role', 'status');
    node.append(
        select.element,
        element('span', schema.airtableField.id, 'field-hint'),
        availabilityStatus
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
        updateSelectAvailability: (availability) => {
            if (destroyed) return;
            availabilityReady = availability.status === 'ready';
            eligibleOptions = availability.options;
            select.model.setOptions(availability.options);
            availabilityStatus.dataset.choiceAvailability = availability.status;
            availabilityStatus.dataset.choiceAvailabilityCode =
                availability.diagnostics[0]?.code ?? '';
            availabilityStatus.textContent = availabilityReady
                ? ''
                : 'New choices are unavailable for this configuration. Existing selections can still be removed.';
        },
        selectAvailabilityReady: () => availabilityReady,
        isSelectOptionAvailable: (choice) =>
            !destroyed &&
            availabilityReady &&
            eligibleOptions.some(
                (option) =>
                    option.id === choice.id && option.value === choice.name
            ),
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            select.element.removeEventListener('change', change);
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
    if (
        field.config.type === AirtableFieldType.SINGLE_SELECT ||
        field.config.type === AirtableFieldType.MULTIPLE_SELECTS
    )
        return selectFieldControl(
            {
                fieldType: field.config.type,
                airtableField: { ...field, config: field.config },
                miniExtConfig: config,
            },
            initialValue,
            onChange,
            forceReadOnly
        );
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

    if (field.config.type === AirtableFieldType.CHECKBOX) {
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.checked = value === true;
        control = checkbox;
        read = () => checkbox.checked;
        write = (next) => {
            checkbox.checked = next === true;
        };
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

/** Stock renderer for a caller-owned binding; unmount leaves draft/model ownership intact. */
export function mountBoundFormField(
    binding: FormFieldBinding,
    schema: RuntimeFieldSchema,
    changed: () => void,
    address?: AddressFieldContext,
    beforeChange?: () => void,
    onError?: (error: unknown) => void
): FieldControl {
    const initial = binding.getSnapshot();
    if (binding.scalar) {
        const node = element('div');
        const input = element('input');
        const status = element('p', '', 'field-hint');
        status.setAttribute('role', 'status');
        input.type = initial.scalar?.kind === 'checkbox' ? 'checkbox' : 'text';
        input.dataset.fieldId = initial.field?.fieldId ?? '';
        if (input.type === 'text') input.inputMode = 'decimal';
        node.append(labeled(initial.field?.title ?? '', input), status);
        let destroyed = false;
        const change = () => {
            if (destroyed || !binding.getSnapshot().canEdit) return;
            beforeChange?.();
            const accepted =
                input.type === 'checkbox'
                    ? binding.scalar!.setChecked(input.checked)
                    : binding.scalar!.setInput(input.value);
            if (accepted) changed();
        };
        input.addEventListener('input', change);
        input.addEventListener('change', change);
        const render = () => {
            const state = binding.getSnapshot();
            node.hidden = state.visibility.type !== 'visible';
            node.inert = !state.canEdit;
            input.disabled = !state.canEdit;
            input.checked = state.scalar?.checked ?? false;
            input.value = state.scalar?.input ?? '';
            input.setAttribute(
                'aria-invalid',
                String(state.scalar?.valid === false)
            );
            node.setAttribute('aria-busy', String(state.pending));
            status.textContent =
                state.scalar?.error ??
                state.error ??
                state.validation.map((error) => error.errorMessage).join('\n');
        };
        const stop = binding.subscribe(render);
        return {
            node,
            editable: !initial.readOnly,
            read() {
                const state = binding.getSnapshot();
                if (state.scalar?.valid === false)
                    throw new Error(
                        'This field needs a valid value before saving.'
                    );
                return state.value ?? null;
            },
            write() {
                if (!destroyed) render();
            },
            destroy() {
                if (destroyed) return;
                destroyed = true;
                stop();
                input.removeEventListener('input', change);
                input.removeEventListener('change', change);
            },
        };
    }
    let control: FieldControl;
    let writingFromControl = false;
    control = formFieldControl(
        schema,
        initial.value,
        () => {
            if (binding.getSnapshot().retired) return;
            beforeChange?.();
            writingFromControl = true;
            try {
                const result = binding.setValue(control.read());
                if (result.accepted) changed();
                else control.write(binding.getSnapshot().value ?? null);
            } catch (error) {
                status.textContent =
                    'This field needs a valid value before saving.';
                onError?.(error);
            } finally {
                writingFromControl = false;
            }
        },
        false,
        address,
        binding
    );
    const status = element('p', '', 'field-hint');
    status.setAttribute('role', 'status');
    control.node.append(status);
    let revision = initial.revision;
    const stop = binding.subscribe((state) => {
        control.node.setAttribute('aria-busy', String(state.pending));
        status.textContent = state.retired
            ? ''
            : (state.error ??
              state.validation.map((error) => error.errorMessage).join('\n'));
        control.node.hidden = state.visibility.type !== 'visible';
        control.node.inert = !state.canEdit;
        if (!state.retired && state.revision !== revision) {
            revision = state.revision;
            if (!writingFromControl) control.write(state.value ?? null);
        }
    });
    const destroy = control.destroy;
    control.destroy = () => {
        stop();
        destroy();
    };
    return control;
}
