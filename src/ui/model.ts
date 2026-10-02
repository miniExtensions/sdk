import type {
    SelectionModel,
    SelectionModelOptions,
    SelectionOption,
    SelectionState,
} from './types.js';

function uniqueOptions(options: readonly SelectionOption[]): SelectionOption[] {
    const unique = new Map<string, SelectionOption>();
    for (const option of options) unique.set(option.value, { ...option });
    return [...unique.values()];
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isCancellation(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'AbortError'
    );
}

export function createSelectionModel(
    initial: SelectionModelOptions
): SelectionModel {
    let configuration: SelectionModelOptions;
    let options: SelectionOption[];
    let value: string[];
    let multiple: boolean;
    let disabled: boolean;
    let readOnly: boolean;
    let searchTerm = '';
    let offset: string | null = null;
    let loading = false;
    let error: string | null = null;
    let generation = 0;
    let controller: AbortController | null = null;
    let pending: Promise<void> | null = null;
    let destroyed = false;
    let stale = false;
    const labels = new Map<string, SelectionOption>();
    const listeners = new Set<(state: SelectionState) => void>();

    function cache(next: readonly SelectionOption[]) {
        for (const option of next) labels.set(option.value, { ...option });
    }

    function normalize(next: readonly string[]) {
        const unique = [...new Set(next)];
        return multiple ? unique : unique.slice(0, 1);
    }

    function replace(next: SelectionModelOptions) {
        configuration = { ...next };
        multiple = next.multiple ?? false;
        disabled = next.disabled ?? false;
        readOnly = next.readOnly ?? false;
        options = uniqueOptions(next.options ?? []);
        labels.clear();
        cache(next.selectedOptions ?? []);
        cache(options);
        value = normalize(next.value ?? []);
        searchTerm = '';
        offset = null;
        loading = false;
        error = null;
        stale = false;
    }

    function getState(): SelectionState {
        current();
        const term = searchTerm.toLowerCase();
        const visible = configuration.loadOptions
            ? options
            : options.filter(
                  (option) =>
                      option.label.toLowerCase().includes(term) ||
                      option.value.toLowerCase().includes(term)
              );
        return {
            multiple,
            options: visible.map((option) => ({ ...option })),
            selectedOptions: value.map((id) => ({
                ...(labels.get(id) ?? { value: id, label: id }),
            })),
            value: [...value],
            searchTerm,
            offset,
            loading,
            error,
            disabled,
            readOnly,
        };
    }

    function emit() {
        const emissionGeneration = generation;
        for (const listener of [...listeners]) {
            if (destroyed || generation !== emissionGeneration) break;
            if (!listeners.has(listener)) continue;
            try {
                const state = getState();
                if (generation !== emissionGeneration) break;
                listener(state);
            } catch (cause) {
                // Isolate consumer callbacks so a loader never rejects through
                // an observer. The failure remains available in getState().
                if (!destroyed && !stale && generation === emissionGeneration) {
                    error = message(cause);
                }
            }
        }
    }

    function abort() {
        generation++;
        const previous = controller;
        controller = null;
        pending = null;
        loading = false;
        previous?.abort();
    }

    function current() {
        if (destroyed || stale) return false;
        let matches = false;
        try {
            matches = configuration.loadOptions?.isCurrent?.() ?? true;
        } catch {
            // A failed freshness predicate cannot establish the old scope.
        }
        if (matches) return true;
        stale = true;
        options = [];
        value = [];
        labels.clear();
        searchTerm = '';
        offset = null;
        error =
            'Selection context changed. Reset the control before continuing.';
        const invalidationGeneration = generation + 1;
        abort();
        if (destroyed || generation !== invalidationGeneration) return false;
        emit();
        return false;
    }

    function loadPage(append: boolean): Promise<void> {
        const loader = configuration.loadOptions;
        if (!current() || !loader) return Promise.resolve();
        const requestGeneration = generation + 1;
        abort();
        if (destroyed || generation !== requestGeneration)
            return Promise.resolve();
        const requestController = new AbortController();
        const requestSearch = searchTerm;
        const requestOffset = append ? offset : null;
        controller = requestController;
        loading = true;
        error = null;
        if (!append) {
            options = [];
            offset = null;
        }
        const active = () =>
            !destroyed &&
            generation === requestGeneration &&
            controller === requestController &&
            !requestController.signal.aborted;
        const request = Promise.resolve().then(async () => {
            if (!active() || !current()) return;
            try {
                const page = await loader({
                    searchTerm: requestSearch,
                    offset: requestOffset,
                    signal: requestController.signal,
                });
                if (!active() || !current()) return;
                options = uniqueOptions(
                    append ? [...options, ...page.options] : page.options
                );
                cache(options);
                offset = page.offset;
            } catch (cause) {
                if (active() && current() && !isCancellation(cause)) {
                    error = message(cause);
                }
            } finally {
                if (active() && current()) {
                    loading = false;
                    controller = null;
                    pending = null;
                    emit();
                }
            }
        });
        pending = request;
        emit();
        return request;
    }

    function choose(next: readonly string[]) {
        if (!current() || disabled || readOnly) return;
        const selectedIds = new Set(value);
        const available = new Map(
            options.map((option) => [option.value, option])
        );
        const accepted = normalize(
            next.filter(
                (id) =>
                    selectedIds.has(id) ||
                    (available.has(id) && !available.get(id)?.disabled)
            )
        );
        if (next.length > 0 && accepted.length === 0) return;
        if (
            accepted.length === value.length &&
            accepted.every((id, index) => value[index] === id)
        ) {
            return;
        }
        value = accepted;
        const changeGeneration = generation;
        try {
            configuration.onChange?.([...value]);
        } catch (cause) {
            if (!destroyed && generation === changeGeneration) {
                error = message(cause);
            }
        }
        if (!destroyed && generation === changeGeneration) emit();
    }

    replace(initial);
    return {
        getState,
        subscribe(listener) {
            if (destroyed) return () => {};
            current();
            if (destroyed) return () => {};
            listeners.add(listener);
            const subscriptionGeneration = generation;
            try {
                listener(getState());
            } catch (cause) {
                if (
                    !destroyed &&
                    !stale &&
                    generation === subscriptionGeneration
                ) {
                    error = message(cause);
                }
            }
            return () => listeners.delete(listener);
        },
        setSearchTerm(next) {
            if (!current()) return Promise.resolve();
            searchTerm = next;
            if (configuration.loadOptions) return loadPage(false);
            error = null;
            emit();
            return Promise.resolve();
        },
        reload() {
            if (!current()) return Promise.resolve();
            if (configuration.loadOptions) return loadPage(false);
            error = null;
            emit();
            return Promise.resolve();
        },
        loadMore() {
            if (!current()) return Promise.resolve();
            if (loading) return pending ?? Promise.resolve();
            if (!configuration.loadOptions || offset === null) {
                return Promise.resolve();
            }
            return loadPage(true);
        },
        choose,
        toggle(id) {
            if (value.includes(id))
                choose(value.filter((selected) => selected !== id));
            else choose(multiple ? [...value, id] : [id]);
        },
        clear() {
            choose([]);
        },
        setValue(next, selectedLabels = []) {
            if (!current()) return;
            cache(selectedLabels);
            value = normalize(next);
            emit();
        },
        setOptions(next) {
            if (!current()) return;
            options = uniqueOptions(next);
            cache(options);
            emit();
        },
        setDisabled(next) {
            if (destroyed) return;
            disabled = next;
            emit();
        },
        setReadOnly(next) {
            if (destroyed) return;
            readOnly = next;
            emit();
        },
        reset(next) {
            if (destroyed) return;
            const resetGeneration = generation + 1;
            abort();
            if (destroyed || generation !== resetGeneration) return;
            replace(next);
            emit();
        },
        cancel() {
            if (destroyed) return;
            const cancelGeneration = generation + 1;
            abort();
            if (destroyed || generation !== cancelGeneration) return;
            if (!stale) error = null;
            emit();
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            replace({});
            abort();
            listeners.clear();
        },
    };
}
