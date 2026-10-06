import type {
    GetFormattedAddressInput,
    ListAddressPredictionsInput,
    MiniExtensionsClient,
} from '../runtime/types.js';

export type AddressAutocompleteOptions = {
    input: Pick<
        ListAddressPredictionsInput,
        'extensionAccessToken' | 'fieldId'
    >;
    reads: MiniExtensionsClient['addresses'];
    isCurrent(): boolean;
    onChange(value: string): void;
    value?: string | null;
    characterLimit?: number | null;
    label: string;
    placeholder?: string;
    document?: Document;
};

export type AddressAutocompleteControl = {
    element: HTMLElement;
    input: HTMLInputElement;
    getValue(): string;
    /** Replace supplied native data without accepting an edit or applying a cap. */
    setValue(value: string | null): void;
    /** Suspending retires pending intents while preserving accepted native data. */
    setActive(active: boolean): void;
    destroy(): void;
};

export class AddressAutocompleteConfigurationError extends Error {
    readonly code = 'invalid-character-limit';
    constructor() {
        super('The address character limit must be a nonnegative integer.');
        this.name = 'AddressAutocompleteConfigurationError';
    }
}

let nextAddressControl = 0;

/** A text-only presenter over existing typed reads; never dispatches a Save. */
export const createAddressAutocompleteControl = (
    options: AddressAutocompleteOptions
): AddressAutocompleteControl => {
    const limit = options.characterLimit;
    if (limit != null && (!Number.isInteger(limit) || limit < 0))
        throw new AddressAutocompleteConfigurationError();
    const document = options.document ?? globalThis.document;
    if (document == null || typeof document.createElement !== 'function')
        throw new Error('A Document is required to create an SDK UI control.');
    const context = { ...options.input };
    const id = `me-sdk-address-${++nextAddressControl}`;
    const element = document.createElement('div');
    element.dataset.ui = 'address-autocomplete';
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = options.label;
    const input = document.createElement('input');
    input.id = id;
    input.type = 'text';
    input.autocomplete = 'off';
    input.placeholder = options.placeholder ?? '';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', `${id}-options`);
    const list = document.createElement('div');
    list.id = `${id}-options`;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', `${options.label} suggestions`);
    list.hidden = true;
    const status = document.createElement('p');
    status.id = `${id}-status`;
    status.setAttribute('role', 'status');
    input.setAttribute('aria-describedby', status.id);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.hidden = true;
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear address';
    element.append(label, input, clear, list, status, retry);

    let value = options.value ?? '';
    input.value = value;
    let active = true;
    let destroyed = false;
    let predictionGeneration = 0;
    let intentGeneration = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let predictionRequest: AbortController | undefined;
    let detailRequest: AbortController | undefined;
    let predictions: Awaited<
        ReturnType<MiniExtensionsClient['addresses']['listPredictions']>
    > = [];
    let selectedPlace: string | null = null;
    let failed: 'predictions' | 'details' | null = null;
    let highlighted = -1;

    const current = (): boolean => {
        if (destroyed || !active) return false;
        try {
            return options.isCurrent();
        } catch {
            return false;
        }
    };
    const closeList = (): void => {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        highlighted = -1;
    };
    const clearPredictions = (): void => {
        predictions = [];
        list.replaceChildren();
        closeList();
    };
    const retire = (): void => {
        predictionGeneration += 1;
        intentGeneration += 1;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        predictionRequest?.abort();
        detailRequest?.abort();
        predictionRequest = undefined;
        detailRequest = undefined;
        selectedPlace = null;
        failed = null;
        retry.hidden = true;
        status.textContent = '';
        status.setAttribute('role', 'status');
        clearPredictions();
    };
    const accept = (next: string): boolean => {
        if (!current()) return false;
        value = limit == null ? next : next.slice(0, limit);
        input.value = value;
        options.onChange(value);
        return true;
    };
    const fail = (kind: 'predictions' | 'details'): void => {
        failed = kind;
        retry.hidden = false;
        status.setAttribute('role', 'alert');
        status.textContent =
            'Address suggestions could not be loaded. You can keep typing manually or try again.';
    };
    const readDetails = async (placeId: string, generation: number) => {
        if (!current() || generation !== intentGeneration) return;
        const controller = new AbortController();
        detailRequest?.abort();
        detailRequest = controller;
        failed = null;
        retry.hidden = true;
        status.setAttribute('role', 'status');
        status.textContent = 'Loading selected address…';
        const owned = (): boolean =>
            current() &&
            !controller.signal.aborted &&
            generation === intentGeneration &&
            selectedPlace === placeId;
        try {
            const request: GetFormattedAddressInput = { ...context, placeId };
            const result = await options.reads.getFormattedAddress(request, {
                signal: controller.signal,
            });
            if (!owned()) return;
            if (typeof result !== 'string') throw new TypeError();
            if (!accept(result) || !owned()) return;
            status.textContent = '';
        } catch {
            if (owned()) fail('details');
        } finally {
            if (detailRequest === controller) detailRequest = undefined;
        }
    };
    const choose = (index: number): void => {
        const prediction = predictions[index];
        if (!current() || prediction == null) return;
        predictionGeneration += 1;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        predictionRequest?.abort();
        predictionRequest = undefined;
        detailRequest?.abort();
        const generation = ++intentGeneration;
        selectedPlace = prediction.placeId;
        clearPredictions();
        if (!accept(prediction.description)) return;
        input.focus();
        void readDetails(prediction.placeId, generation);
    };
    const renderPredictions = (): void => {
        list.replaceChildren();
        for (let index = 0; index < predictions.length; index += 1) {
            const prediction = predictions[index]!;
            const option = document.createElement('button');
            option.type = 'button';
            option.id = `${id}-option-${index}`;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', 'false');
            option.tabIndex = -1;
            option.textContent = prediction.description;
            option.addEventListener('click', () => choose(index));
            list.append(option);
        }
        list.hidden = predictions.length === 0;
        input.setAttribute('aria-expanded', String(!list.hidden));
    };
    const readPredictions = async (query: string, generation: number) => {
        if (!current() || generation !== predictionGeneration) return;
        const controller = new AbortController();
        predictionRequest?.abort();
        predictionRequest = controller;
        failed = null;
        retry.hidden = true;
        status.setAttribute('role', 'status');
        status.textContent = 'Loading address suggestions…';
        const owned = (): boolean =>
            current() &&
            !controller.signal.aborted &&
            generation === predictionGeneration;
        try {
            const result = await options.reads.listPredictions(
                { ...context, addressFieldValue: query },
                { signal: controller.signal }
            );
            if (!owned()) return;
            if (
                !Array.isArray(result) ||
                result.some(
                    (item) =>
                        item == null ||
                        typeof item.description !== 'string' ||
                        typeof item.placeId !== 'string'
                )
            )
                throw new TypeError();
            predictions = result.map((item) => ({ ...item }));
            renderPredictions();
            status.textContent =
                predictions.length === 0
                    ? 'No address suggestions. You can keep typing manually.'
                    : '';
        } catch {
            if (owned()) {
                clearPredictions();
                fail('predictions');
            }
        } finally {
            if (predictionRequest === controller) predictionRequest = undefined;
        }
    };
    const typed = (): void => {
        if (!current()) {
            input.value = value;
            retire();
            return;
        }
        const next = input.value;
        retire();
        if (!accept(next) || !current() || value.trim() === '') return;
        const generation = predictionGeneration;
        const query = value;
        timer = setTimeout(() => {
            timer = undefined;
            void readPredictions(query, generation);
        }, 800);
    };
    const keydown = (event: KeyboardEvent): void => {
        if (!current()) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            retire();
        } else if (
            !list.hidden &&
            (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        ) {
            event.preventDefault();
            const count = predictions.length;
            highlighted =
                event.key === 'ArrowDown'
                    ? (highlighted + 1) % count
                    : highlighted <= 0
                      ? count - 1
                      : highlighted - 1;
            Array.from(list.children).forEach((option, index) =>
                option.setAttribute(
                    'aria-selected',
                    String(index === highlighted)
                )
            );
            input.setAttribute(
                'aria-activedescendant',
                `${id}-option-${highlighted}`
            );
        } else if (event.key === 'Enter' && !list.hidden && highlighted >= 0) {
            event.preventDefault();
            choose(highlighted);
        }
    };
    const clearValue = (): void => {
        if (!current()) return;
        input.value = '';
        typed();
        input.focus();
    };
    const retryRead = (): void => {
        if (!current()) return;
        if (failed === 'details' && selectedPlace != null) {
            void readDetails(selectedPlace, ++intentGeneration);
        } else if (failed === 'predictions' && value.trim() !== '') {
            void readPredictions(value, ++predictionGeneration);
        }
    };
    input.addEventListener('input', typed);
    input.addEventListener('keydown', keydown);
    clear.addEventListener('click', clearValue);
    retry.addEventListener('click', retryRead);
    return {
        element,
        input,
        getValue: () => value,
        setValue: (next) => {
            if (destroyed) return;
            retire();
            value = next ?? '';
            input.value = value;
        },
        setActive: (next) => {
            if (destroyed || active === next) return;
            active = next;
            if (!active) retire();
            input.disabled = !active;
            clear.disabled = !active;
            retry.disabled = !active;
        },
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            retire();
            input.removeEventListener('input', typed);
            input.removeEventListener('keydown', keydown);
            clear.removeEventListener('click', clearValue);
            retry.removeEventListener('click', retryRead);
            input.disabled = true;
            clear.disabled = true;
            retry.disabled = true;
        },
    };
};
