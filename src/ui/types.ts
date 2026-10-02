export type SelectionOption = {
    value: string;
    label: string;
    disabled?: boolean;
};

export type SelectionPage = {
    options: readonly SelectionOption[];
    offset: string | null;
};

export type SelectionRequest = {
    searchTerm: string;
    offset: string | null;
    signal: AbortSignal;
};

export type SelectionLoader = ((
    request: SelectionRequest
) => Promise<SelectionPage>) & {
    /** Freshness hint only; SDK loaders bind this to their captured session. */
    isCurrent?: () => boolean;
};

/** Snapshots contain copies; mutating them never changes another control. */
export type SelectionState = {
    multiple: boolean;
    options: readonly SelectionOption[];
    selectedOptions: readonly SelectionOption[];
    value: readonly string[];
    searchTerm: string;
    offset: string | null;
    loading: boolean;
    error: string | null;
    disabled: boolean;
    readOnly: boolean;
};

export type SelectionModelOptions = {
    multiple?: boolean;
    options?: readonly SelectionOption[];
    value?: readonly string[];
    selectedOptions?: readonly SelectionOption[];
    loadOptions?: SelectionLoader;
    disabled?: boolean;
    readOnly?: boolean;
    /** User selection changes only; setValue/reset do not call this callback. */
    onChange?: (value: readonly string[]) => void;
};

export type SelectionModel = {
    getState(): SelectionState;
    /** Emits immediately; returns an unsubscribe function. */
    subscribe(listener: (state: SelectionState) => void): () => void;
    setSearchTerm(searchTerm: string): Promise<void>;
    reload(): Promise<void>;
    loadMore(): Promise<void>;
    /** Atomic user change; ignores unknown or disabled new choices. */
    choose(value: readonly string[]): void;
    toggle(value: string): void;
    clear(): void;
    setValue(
        value: readonly string[],
        labels?: readonly SelectionOption[]
    ): void;
    setOptions(options: readonly SelectionOption[]): void;
    setDisabled(disabled: boolean): void;
    setReadOnly(readOnly: boolean): void;
    /** Replace visitor/token/filter scope, discard cached labels and requests. */
    reset(options: SelectionModelOptions): void;
    cancel(): void;
    destroy(): void;
};
