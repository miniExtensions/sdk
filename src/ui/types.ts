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
    /** Present only after an SDK linked-record loader page is accepted. */
    linkedRecords?: LinkedRecordSelectionPage;
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
    /** Update the owned query and retire prior paging without dispatching a read. */
    setSearchInput(searchTerm: string): void;
    reload(): Promise<void>;
    loadMore(): Promise<void>;
    /** Atomic user change; ignores unknown or disabled new choices. */
    choose(value: readonly string[]): void;
    /** Validate the whole proposed set against model authority, not decorated UI flags. */
    canChoose(value: readonly string[]): boolean;
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
import type { AirtableRecord, RuntimeAirtableField } from '../runtime/types.js';

/** Detached data from an accepted SDK linked-option page, scoped to one field/table. */
export type LinkedRecordSelectionPage = {
    linkedTableId: string;
    records: AirtableRecord[];
    /** Physical metadata only; never a table-wide record cache. */
    table: { airtableFields: RuntimeAirtableField[] } | null;
};
