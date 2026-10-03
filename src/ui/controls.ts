import { AirtableFieldType } from '../formulas/types.js';
import type { AirtableValue, RuntimeFieldSchema } from '../runtime/types.js';
import { createSelectionModel } from './model.js';
import type {
    SelectionModel,
    SelectionOption,
    SelectionState,
} from './types.js';

export type SelectControlOptions = {
    field: RuntimeFieldSchema;
    value?: AirtableValue;
    onChange?: (value: AirtableValue) => void;
    label?: string;
    disabled?: boolean;
    readOnly?: boolean;
    document?: Document;
    placeholder?: string;
};

export type SelectControl = {
    element: HTMLElement;
    model: SelectionModel;
    destroy(): void;
};

export type SelectionControlMessages = {
    searchLabel: string;
    loading: string;
    empty: string;
    errorPrefix: string;
    retry: string;
    more: string;
    clear: string;
    selectedLabel: string;
};

export type SelectionControlOptions = {
    label: string;
    document?: Document;
    description?: string;
    search?: boolean;
    messages?: Partial<SelectionControlMessages>;
    formatLabel?: (option: SelectionOption) => string;
};

export type MountedSelectionControl = {
    element: HTMLElement;
    destroy(): void;
};

let nextControlId = 0;

const resolveDocument = (provided?: Document): Document => {
    const document = provided ?? globalThis.document;
    if (document == null || typeof document.createElement !== 'function') {
        throw new Error('A Document is required to create an SDK UI control.');
    }
    return document;
};

const node = <Tag extends keyof HTMLElementTagNameMap>(
    document: Document,
    tag: Tag,
    part: string
): HTMLElementTagNameMap[Tag] => {
    const element = document.createElement(tag);
    element.dataset.ui = part;
    element.className = `me-sdk-${part}`;
    return element;
};

/** Reconcile without detaching unchanged nodes, preserving keyboard focus. */
const orderChildren = (
    parent: HTMLElement,
    children: readonly HTMLElement[]
): void => {
    const document = parent.ownerDocument;
    const active = document.activeElement;
    const focused = parent.contains(active) ? (active as HTMLElement) : null;
    const wanted = new Set(children);
    for (const child of Array.from(parent.children)) {
        if (!wanted.has(child as HTMLElement)) child.remove();
    }
    for (let index = 0; index < children.length; index += 1) {
        const child = children[index]!;
        const existing = parent.children[index];
        if (existing !== child) parent.insertBefore(child, existing ?? null);
    }
    if (
        focused?.isConnected &&
        parent.contains(focused) &&
        document.activeElement !== focused &&
        !('disabled' in focused && focused.disabled === true) &&
        typeof focused.focus === 'function'
    ) {
        focused.focus({ preventScroll: true });
    }
};

const selectValues = (
    value: SelectControlOptions['value'],
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

/** Native select bound to one field schema; values are choice names, never IDs. */
export const createSelectControl = (
    options: SelectControlOptions
): SelectControl => {
    const config = options.field?.airtableField?.config;
    if (
        config == null ||
        (config.type !== AirtableFieldType.SINGLE_SELECT &&
            config.type !== AirtableFieldType.MULTIPLE_SELECTS) ||
        options.field.fieldType !== config.type
    ) {
        throw new TypeError(
            'Expected a canonical singleSelect or multipleSelects field.'
        );
    }
    const field = options.field.airtableField;
    const miniExtConfig = options.field.miniExtConfig;
    const readOnly =
        miniExtConfig !== undefined && 'readOnly' in miniExtConfig
            ? miniExtConfig.readOnly
            : undefined;
    if (
        typeof field.id !== 'string' ||
        field.id === '' ||
        typeof field.name !== 'string' ||
        field.name === '' ||
        (field.isComputed !== undefined &&
            typeof field.isComputed !== 'boolean') ||
        (readOnly !== undefined && typeof readOnly !== 'boolean')
    ) {
        throw new TypeError(
            'Select field identity and permission flags are malformed.'
        );
    }
    const choices = config.options == null ? [] : config.options.choices;
    if (!Array.isArray(choices)) {
        throw new TypeError('Select field choices must be an array.');
    }
    const names = new Set<string>();
    const ids = new Set<string>();
    const modelOptions: SelectionOption[] = [];
    for (const choice of choices) {
        if (
            choice == null ||
            typeof choice.id !== 'string' ||
            choice.id === '' ||
            typeof choice.name !== 'string' ||
            choice.name === '' ||
            ids.has(choice.id) ||
            names.has(choice.name)
        ) {
            throw new TypeError(
                'Select field choices must have unique IDs and names.'
            );
        }
        ids.add(choice.id);
        names.add(choice.name);
        modelOptions.push({ value: choice.name, label: choice.name });
    }
    const multiple = config.type === AirtableFieldType.MULTIPLE_SELECTS;
    const canonicalReadOnly = field.isComputed === true || readOnly === true;
    const document = resolveDocument(options.document);
    const id = `me-sdk-select-${++nextControlId}`;
    const element = node(document, 'div', 'select-control');
    const label = node(document, 'label', 'label');
    label.htmlFor = id;
    label.textContent = options.label ?? options.field.airtableField.name;
    const select = node(document, 'select', 'select');
    select.id = id;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = options.placeholder ?? '—';
    const optionNodes = new Map<string, HTMLOptionElement>();
    element.append(label, select);
    let destroyed = false;
    let renderRevision = 0;
    const callback = options.onChange;
    const onChange = (value: readonly string[]): void => {
        if (!canonicalReadOnly) {
            callback?.(multiple ? [...value] : (value[0] ?? null));
        }
    };
    const model = createSelectionModel({
        multiple,
        options: modelOptions,
        value: selectValues(options.value, multiple),
        disabled: options.disabled,
        readOnly: options.readOnly === true || canonicalReadOnly,
        onChange,
    });
    const reset = model.reset;
    const setReadOnly = model.setReadOnly;
    model.setReadOnly = (next): void => setReadOnly(canonicalReadOnly || next);
    model.reset = (next): void => {
        if (destroyed) return;
        if (next.multiple !== undefined && next.multiple !== multiple) {
            throw new TypeError(
                'Recreate the select control to change its field mode.'
            );
        }
        if (next.loadOptions !== undefined) {
            throw new TypeError(
                'Use mountSelectionControl for an async selection model.'
            );
        }
        reset({
            ...next,
            multiple,
            options: next.options ?? modelOptions,
            readOnly: canonicalReadOnly || next.readOnly === true,
            onChange,
        });
    };
    const render = (state: SelectionState): void => {
        if (destroyed) return;
        const revision = ++renderRevision;
        select.multiple = state.multiple;
        select.disabled = state.disabled || state.readOnly || canonicalReadOnly;
        const available = new Map(
            state.options.map((option) => [option.value, option])
        );
        for (const option of state.selectedOptions) {
            if (!available.has(option.value))
                available.set(option.value, option);
        }
        const children: HTMLOptionElement[] = state.multiple
            ? []
            : [placeholder];
        for (const option of available.values()) {
            let optionNode = optionNodes.get(option.value);
            if (optionNode == null) {
                optionNode = document.createElement('option');
                optionNode.value = option.value;
                optionNodes.set(option.value, optionNode);
            }
            optionNode.textContent = option.label;
            optionNode.disabled = option.disabled === true;
            children.push(optionNode);
        }
        orderChildren(select, children);
        if (destroyed || revision !== renderRevision) return;
        for (const [value, optionNode] of optionNodes) {
            if (!available.has(value)) optionNodes.delete(value);
            optionNode.selected = state.value.includes(value);
        }
        if (!state.multiple) placeholder.selected = state.value.length === 0;
    };
    const unsubscribe = model.subscribe(render);
    const change = (): void => {
        if (destroyed) return;
        const state = model.getState();
        if (state.disabled || state.readOnly || canonicalReadOnly) {
            render(state);
            return;
        }
        const selected = Array.from(select.options)
            .filter((option) => option.selected && option.value !== '')
            .map((option) => option.value);
        const value = state.multiple
            ? [
                  ...state.value.filter((value) => selected.includes(value)),
                  ...selected.filter((value) => !state.value.includes(value)),
              ]
            : selected;
        model.choose(value);
        if (!destroyed) render(model.getState());
    };
    select.addEventListener('change', change);
    return {
        element,
        model,
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            unsubscribe();
            select.removeEventListener('change', change);
            model.destroy();
        },
    };
};

const defaultMessages: SelectionControlMessages = {
    searchLabel: 'Search options',
    loading: 'Loading options…',
    empty: 'No options found.',
    errorPrefix: 'Could not load options:',
    retry: 'Retry',
    more: 'More',
    clear: 'Clear selection',
    selectedLabel: 'Selected',
};

/** Accessible native inputs for an existing async model; the caller owns it. */
export const mountSelectionControl = (
    model: SelectionModel,
    options: SelectionControlOptions
): MountedSelectionControl => {
    const document = resolveDocument(options.document);
    const id = `me-sdk-selection-${++nextControlId}`;
    const messages = { ...defaultMessages, ...options.messages };
    const formatLabel = options.formatLabel ?? ((option) => option.label);
    const element = node(document, 'div', 'selection-control');
    const description = node(document, 'p', 'description');
    description.id = `${id}-description`;
    description.textContent = options.description ?? '';
    description.hidden = options.description == null;
    const searchLabel = node(document, 'label', 'search-label');
    const search = node(document, 'input', 'search');
    search.type = 'search';
    search.id = `${id}-search`;
    searchLabel.htmlFor = search.id;
    searchLabel.textContent = messages.searchLabel;
    searchLabel.hidden = options.search === false;
    search.hidden = options.search === false;
    const selected = node(document, 'div', 'selected');
    const selectedLabel = node(document, 'span', 'selected-label');
    selectedLabel.id = `${id}-selected`;
    selectedLabel.textContent = messages.selectedLabel;
    selected.setAttribute('role', 'group');
    selected.setAttribute('aria-labelledby', selectedLabel.id);
    const selectedRows = node(document, 'div', 'selected-options');
    selected.append(selectedLabel, selectedRows);
    const choices = node(document, 'fieldset', 'choices');
    const legend = document.createElement('legend');
    legend.textContent = options.label;
    choices.append(legend);
    if (options.description != null) {
        choices.setAttribute('aria-describedby', description.id);
        search.setAttribute('aria-describedby', description.id);
    }
    const choiceRows = node(document, 'div', 'choice-options');
    choices.append(choiceRows);
    const status = node(document, 'p', 'status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const error = node(document, 'p', 'error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const retry = node(document, 'button', 'retry');
    retry.type = 'button';
    retry.textContent = messages.retry;
    const more = node(document, 'button', 'more');
    more.type = 'button';
    more.textContent = messages.more;
    const clear = node(document, 'button', 'clear');
    clear.type = 'button';
    clear.textContent = messages.clear;
    element.append(
        description,
        searchLabel,
        search,
        selected,
        choices,
        status,
        error,
        retry,
        more,
        clear
    );

    const listeners: Array<() => void> = [];
    const listen = (
        target: HTMLElement,
        type: string,
        handler: () => void
    ): void => {
        target.addEventListener(type, handler);
        listeners.push(() => target.removeEventListener(type, handler));
    };
    const canChoose = (): boolean => {
        const state = model.getState();
        return !state.disabled && !state.readOnly;
    };
    const choiceNodes = new Map<
        string,
        {
            row: HTMLElement;
            input: HTMLInputElement;
            label: HTMLLabelElement;
            option: SelectionOption;
            dispose: () => void;
        }
    >();
    const selectedNodes = new Map<
        string,
        {
            row: HTMLElement;
            text: HTMLElement;
            remove: HTMLButtonElement;
            dispose: () => void;
        }
    >();
    let destroyed = false;
    let renderRevision = 0;
    const render = (state: SelectionState): void => {
        if (destroyed) return;
        const revision = ++renderRevision;
        const active = (): boolean => {
            if (destroyed || revision !== renderRevision) return false;
            // Freshness is checked lazily by the model. A formatter or focus
            // callback may replace the session without calling reset itself.
            model.getState();
            return !destroyed && revision === renderRevision;
        };
        // Format before changing rows or listeners: user callbacks can replace
        // the visitor scope or dispose this mount synchronously.
        const displayedOptions =
            state.loading && state.options.length === 0
                ? [...choiceNodes.values()].map((entry) => entry.option)
                : state.options;
        const formattedOptions: Array<{
            option: SelectionOption;
            label: string;
        }> = [];
        for (const option of displayedOptions) {
            const label = formatLabel(option);
            if (!active()) return;
            formattedOptions.push({ option, label });
        }
        const formattedSelections: Array<{
            option: SelectionOption;
            label: string;
        }> = [];
        for (const option of state.selectedOptions) {
            const label = formatLabel(option);
            if (!active()) return;
            formattedSelections.push({ option, label });
        }
        if (search.value !== state.searchTerm) search.value = state.searchTerm;
        search.disabled = state.disabled;
        choices.disabled = state.disabled || state.readOnly;
        status.textContent = state.loading
            ? messages.loading
            : state.options.length === 0 && state.error == null
              ? messages.empty
              : '';
        choices.setAttribute('aria-busy', String(state.loading));
        error.hidden = state.error == null;
        error.textContent =
            state.error == null ? '' : `${messages.errorPrefix} ${state.error}`;
        retry.hidden = state.error == null;
        retry.disabled = state.disabled || state.loading;
        more.hidden = state.offset == null;
        more.disabled = state.disabled || state.loading || state.offset == null;
        clear.disabled =
            state.disabled || state.readOnly || state.value.length === 0;
        selected.hidden = state.selectedOptions.length === 0;

        // A replacement request temporarily clears model options. Keep the
        // prior nodes mounted until it settles so keyboard focus is retained;
        // the model still rejects adding choices absent from its current page.
        const activeOptions = new Set(
            displayedOptions.map((option) => option.value)
        );
        for (const [value, entry] of choiceNodes) {
            if (!activeOptions.has(value)) {
                entry.dispose();
                choiceNodes.delete(value);
            }
        }
        const rows: HTMLElement[] = [];
        for (const { option, label } of formattedOptions) {
            let entry = choiceNodes.get(option.value);
            if (entry == null) {
                const row = node(document, 'div', 'choice');
                const input = node(document, 'input', 'choice-input');
                input.id = `${id}-option-${++nextControlId}`;
                input.name = `${id}-options`;
                input.value = option.value;
                const label = node(document, 'label', 'choice-label');
                label.htmlFor = input.id;
                row.append(input, label);
                const change = (): void => {
                    if (!canChoose()) {
                        render(model.getState());
                        return;
                    }
                    if (model.getState().multiple) model.toggle(option.value);
                    else if (input.checked) model.choose([option.value]);
                    render(model.getState());
                };
                input.addEventListener('change', change);
                entry = {
                    row,
                    input,
                    label,
                    option,
                    dispose: () => input.removeEventListener('change', change),
                };
                choiceNodes.set(option.value, entry);
            }
            entry.option = option;
            entry.input.type = state.multiple ? 'checkbox' : 'radio';
            entry.input.value = option.value;
            entry.input.checked = state.value.includes(option.value);
            entry.input.disabled =
                state.disabled || state.readOnly || option.disabled === true;
            entry.label.textContent = label;
            rows.push(entry.row);
        }
        orderChildren(choiceRows, rows);
        if (!active()) return;

        const activeSelections = new Set(
            state.selectedOptions.map((option) => option.value)
        );
        for (const [value, entry] of selectedNodes) {
            if (!activeSelections.has(value)) {
                entry.dispose();
                selectedNodes.delete(value);
            }
        }
        const selectionRows: HTMLElement[] = [];
        for (const { option, label } of formattedSelections) {
            let entry = selectedNodes.get(option.value);
            if (entry == null) {
                const row = node(document, 'div', 'selected-option');
                const text = node(document, 'span', 'selected-text');
                const remove = node(document, 'button', 'remove');
                remove.type = 'button';
                remove.textContent = '×';
                row.append(text, remove);
                const click = (): void => {
                    if (!canChoose()) return;
                    model.choose(
                        model
                            .getState()
                            .value.filter((value) => value !== option.value)
                    );
                };
                remove.addEventListener('click', click);
                entry = {
                    row,
                    text,
                    remove,
                    dispose: () => remove.removeEventListener('click', click),
                };
                selectedNodes.set(option.value, entry);
            }
            entry.text.textContent = label;
            entry.remove.setAttribute(
                'aria-label',
                `${messages.clear}: ${label}`
            );
            entry.remove.disabled = state.disabled || state.readOnly;
            selectionRows.push(entry.row);
        }
        orderChildren(selectedRows, selectionRows);
    };
    listen(search, 'input', () => {
        if (model.getState().disabled) return;
        void model.setSearchTerm(search.value);
    });
    listen(retry, 'click', () => {
        const state = model.getState();
        if (!state.disabled && !state.loading && state.error != null)
            void model.reload();
    });
    listen(more, 'click', () => {
        const state = model.getState();
        if (!state.disabled && !state.loading && state.offset != null)
            void model.loadMore();
    });
    listen(clear, 'click', () => {
        if (canChoose()) model.clear();
    });
    const unsubscribe = model.subscribe(render);
    return {
        element,
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            unsubscribe();
            for (const dispose of listeners) dispose();
            for (const entry of choiceNodes.values()) entry.dispose();
            for (const entry of selectedNodes.values()) entry.dispose();
            choiceNodes.clear();
            selectedNodes.clear();
        },
    };
};
