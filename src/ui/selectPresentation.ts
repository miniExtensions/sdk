export type SelectOptionPresentation = {
    id: string;
    canonicalName: string;
    displayName: string;
};

export type SelectPresentationConfig = {
    enableConditionalOptions?: boolean;
    conditionsForOptions?: readonly {
        config?: {
            optionForConditions?: string;
            name?: string;
        } | null;
    }[];
};

export type SelectAddOptionPresentation = {
    kind: 'loading' | 'add' | 'no-results' | 'none';
    searchTerm: string;
    showSeparator: boolean;
};

/**
 * Hosted Add Choice compatibility only. Callers retain search, permission
 * decisions, callback execution, native option identity and persistence.
 * Object labels are supplied by the caller; no metadata is inferred or validated.
 */
export const getSelectAddOptionPresentation = <
    T extends string | object,
>(args: {
    options: readonly T[];
    searchTerm: string;
    resultCount: number;
    getOptionTextValues?: (option: T) => readonly string[];
    allowAddingNewOptions?: boolean;
    hasAddOptionCallback: boolean;
    isLoading?: boolean;
}): SelectAddOptionPresentation => {
    const searchTerm = args.searchTerm.trim();
    const comparableSearchTerm = searchTerm.toLowerCase();
    const hasEquivalentOption = args.options.some((option) => {
        const textValues =
            args.getOptionTextValues?.(option) ??
            (typeof option === 'string' ? [option] : []);
        return textValues.some(
            (text) => text.trim().toLowerCase() === comparableSearchTerm
        );
    });
    const kind = args.isLoading
        ? 'loading'
        : args.allowAddingNewOptions &&
            searchTerm.length > 0 &&
            !hasEquivalentOption &&
            args.hasAddOptionCallback
          ? 'add'
          : args.resultCount === 0
            ? 'no-results'
            : 'none';
    return {
        kind,
        searchTerm,
        showSeparator: kind === 'add' && args.resultCount !== 0,
    };
};

/** Presentation only: pending choices may share an empty native Airtable ID. */
export const makeSelectOptionPresentations = (args: {
    choices: readonly { id: string; name: string }[];
    miniExtFieldConfig?: SelectPresentationConfig;
}): SelectOptionPresentation[] => {
    const presentations = args.choices.map((choice) => {
        const configuredName =
            args.miniExtFieldConfig?.enableConditionalOptions === true
                ? args.miniExtFieldConfig.conditionsForOptions?.find(
                      (option) =>
                          option.config?.optionForConditions === choice.id
                  )?.config?.name
                : undefined;
        const trimmedName = configuredName?.trim();
        return {
            id: choice.id,
            canonicalName: choice.name,
            displayName: trimmedName || choice.name,
        };
    });
    const labels = getSelectPresentationLabels(presentations);
    return presentations.map((option, index) => ({
        ...option,
        displayName: labels[index]!,
    }));
};

/** A DOM/React key, never a native Airtable ID or a value sent to persistence. */
export const getSelectOptionPresentationKey = (
    option: SelectOptionPresentation
): string => {
    const identity = option.id || option.canonicalName;
    const encoded = Array.from({ length: identity.length }, (_, index) =>
        identity.charCodeAt(index).toString(16).padStart(4, '0')
    ).join('');
    return `${option.id ? 'id' : 'pending'}-${encoded}`;
};

export const makeUnavailableSelectOptionPresentation = (
    canonicalName: string
): SelectOptionPresentation => ({
    id: `unavailable:${canonicalName}`,
    canonicalName,
    displayName: canonicalName,
});

/** Shared collision rule; callers retain their own metadata validation. */
export const getSelectPresentationLabels = (
    presentations: readonly { canonicalName: string; displayName: string }[]
): string[] => {
    const counts = new Map<string, number>();
    for (const option of presentations)
        counts.set(
            option.displayName,
            (counts.get(option.displayName) ?? 0) + 1
        );
    return presentations.map((option) =>
        counts.get(option.displayName) === 1
            ? option.displayName
            : `${option.displayName} (${option.canonicalName})`
    );
};
