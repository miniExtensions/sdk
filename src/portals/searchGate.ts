/** Supplied qualified metadata, not permission to read a Portal or its records. */
export type PortalSearchGateField = Readonly<{
    fieldId: string;
    fieldName: string;
}>;

export function getSearchPageQueryKeys(field: PortalSearchGateField) {
    return {
        canonicalQueryKey: `search_${field.fieldName}`,
        configuredFieldIdQueryKey: `search_${field.fieldId}`,
    };
}

/** Recognition accepts either nonblank alias; native metadata admission stays outside. */
export function hasSearchPageQueryParam(args: {
    searchParams: URLSearchParams;
    searchPageField: PortalSearchGateField;
}): boolean {
    const { canonicalQueryKey, configuredFieldIdQueryKey } =
        getSearchPageQueryKeys(args.searchPageField);
    return [canonicalQueryKey, configuredFieldIdQueryKey].some(
        (key) => (args.searchParams.get(key)?.trim() ?? '') !== ''
    );
}

/** Pure URL policy. No location, navigation, read, access or storage side effect. */
export function getSearchPageSubmissionUrl(args: {
    currentUrl: string;
    searchPageField: PortalSearchGateField;
    searchTerm: string;
}): string {
    const url = new URL(args.currentUrl);
    const { canonicalQueryKey, configuredFieldIdQueryKey } =
        getSearchPageQueryKeys(args.searchPageField);
    url.searchParams.delete(configuredFieldIdQueryKey);
    url.searchParams.set(canonicalQueryKey, args.searchTerm.trim());
    return url.toString();
}
