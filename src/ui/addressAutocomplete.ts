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
    /** Existing Google-backed address reads; this presenter's attribution is Google Maps. */
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

// Unmodified official GoogleMaps_Logo_DarkGray_2x.png (196x36, 2600 bytes).
// https://developers.google.com/static/maps/documentation/images/Google_Maps_Attribution_Assets.zip
// PNG SHA-256: f542cdc1844d0e1a848455dffdc46a5cd618528576a4dba47bc4a096bfa4f60c
// ZIP SHA-256: 899e2ada2969330debb94adf6ec44290ee528fcec55ac18683485259e1bf82e8
// Google Maps attribution asset; Google policies apply, not the SDK's MIT license.
const googleMapsAttributionLogo =
    'data:image/png;base64,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';

/** Plain-text predictions from Google-backed typed reads; never dispatches a Save. */
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
    const suggestions = document.createElement('div');
    suggestions.dataset.addressSuggestions = '';
    suggestions.hidden = true;
    suggestions.style.border = '1px solid #6b7280';
    suggestions.style.borderRadius = '4px';
    suggestions.style.backgroundColor = '#fff';
    const attribution = document.createElement('div');
    attribution.dataset.addressAttribution = '';
    attribution.setAttribute('translate', 'no');
    attribution.style.padding = '10px 10px 5px';
    attribution.style.backgroundColor = '#fff';
    const logo = document.createElement('img');
    logo.src = googleMapsAttributionLogo;
    logo.alt = 'Google Maps';
    logo.setAttribute('translate', 'no');
    logo.width = 98;
    logo.height = 18;
    logo.style.width = '98px';
    logo.style.height = '18px';
    logo.style.display = 'block';
    attribution.append(logo);
    // Attribution shares the prediction border but is not a selectable option.
    suggestions.append(list, attribution);
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
    element.append(label, input, clear, suggestions, status, retry);

    let value = options.value ?? '';
    input.value = value;
    let active = true;
    let destroyed = false;
    let composing = false;
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
    const updateHighlightedOptions = (): void => {
        Array.from(list.children).forEach((child, index) => {
            const option = child as HTMLButtonElement;
            const selected = index === highlighted;
            option.setAttribute('aria-selected', String(selected));
            option.style.backgroundColor = selected ? '#1d4ed8' : '#fff';
            option.style.color = selected ? '#fff' : '#1f2937';
            option.style.outline = selected
                ? '2px solid #111827'
                : '2px solid transparent';
        });
    };
    const closeList = (): void => {
        suggestions.hidden = true;
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        highlighted = -1;
        updateHighlightedOptions();
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
        if (!current() || composing || prediction == null) return;
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
        closeList();
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
            option.style.display = 'block';
            option.style.width = '100%';
            option.style.boxSizing = 'border-box';
            option.style.padding = '8px 10px';
            option.style.margin = '0';
            option.style.border = '0';
            option.style.textAlign = 'left';
            option.style.font = 'inherit';
            option.style.cursor = 'pointer';
            option.style.outlineOffset = '-2px';
            option.addEventListener('click', () => choose(index));
            list.append(option);
        }
        list.hidden = predictions.length === 0;
        suggestions.hidden = list.hidden;
        updateHighlightedOptions();
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
    const startComposition = (): void => {
        if (!current()) return;
        composing = true;
        retire();
    };
    const typed = (event?: Event): void => {
        if (!current()) {
            composing = false;
            input.value = value;
            retire();
            return;
        }
        if ((event as InputEvent | undefined)?.isComposing) {
            startComposition();
            return;
        }
        if (composing) return;
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
    const endComposition = (): void => {
        if (!composing) return;
        composing = false;
        typed();
    };
    const keydown = (event: KeyboardEvent): void => {
        if (
            !current() ||
            composing ||
            event.isComposing ||
            event.keyCode === 229
        )
            return;
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
            updateHighlightedOptions();
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
        composing = false;
        input.value = '';
        typed();
        input.focus();
    };
    const retryRead = (): void => {
        if (!current() || composing) return;
        if (failed === 'details' && selectedPlace != null) {
            void readDetails(selectedPlace, ++intentGeneration);
        } else if (failed === 'predictions' && value.trim() !== '') {
            void readPredictions(value, ++predictionGeneration);
        }
    };
    input.addEventListener('input', typed);
    input.addEventListener('compositionstart', startComposition);
    input.addEventListener('compositionend', endComposition);
    input.addEventListener('keydown', keydown);
    clear.addEventListener('click', clearValue);
    retry.addEventListener('click', retryRead);
    return {
        element,
        input,
        getValue: () => value,
        setValue: (next) => {
            if (destroyed) return;
            composing = false;
            retire();
            value = next ?? '';
            input.value = value;
        },
        setActive: (next) => {
            if (destroyed || active === next) return;
            active = next;
            if (!active) {
                if (composing) input.value = value;
                composing = false;
                retire();
            }
            input.disabled = !active;
            clear.disabled = !active;
            retry.disabled = !active;
        },
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            composing = false;
            retire();
            input.removeEventListener('input', typed);
            input.removeEventListener('compositionstart', startComposition);
            input.removeEventListener('compositionend', endComposition);
            input.removeEventListener('keydown', keydown);
            clear.removeEventListener('click', clearValue);
            retry.removeEventListener('click', retryRead);
            input.disabled = true;
            clear.disabled = true;
            retry.disabled = true;
        },
    };
};
