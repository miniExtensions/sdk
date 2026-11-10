import { useEffect, useState } from 'react';
import {
    getSearchPageSubmissionUrl,
    type PortalSearchGateField,
} from '../portals/searchGate.js';

export type PortalSearchGateOptions = {
    searchPageField: PortalSearchGateField;
    title?: string | null;
    description?: string | null;
    noResultsMessage?: string | null;
    hasNoResults?: boolean;
    /** Called only by an explicit valid submit, never at import/render/mount. */
    getCurrentUrl(): string;
    /** Native hosts may retain full location assignment; this hook never navigates. */
    onNavigate(url: string): void;
    /** Host owns clearing its search parameters and selecting the next screen. */
    onClearSearch?(): void;
};

/** The native gate's local draft/error state; no Portal, draft-store or read owner. */
export function usePortalSearchGate(props: PortalSearchGateOptions) {
    const [searchTerm, setSearchTerm] = useState('');
    const [showError, setShowError] = useState(false);
    useEffect(() => {
        if (props.hasNoResults) setShowError(true);
    }, [props.hasNoResults]);

    const fieldName = props.searchPageField.fieldName;
    return {
        searchTerm,
        setSearchTerm,
        showError: showError && props.hasNoResults === true,
        title: props.title ?? 'Search',
        description: props.description
            ? props.description.replace(/{fieldName}/g, fieldName)
            : `Please enter a value for ${fieldName} to continue to this interface. This step is required before records are shown.`,
        noResultsMessage:
            props.noResultsMessage ??
            'No records found matching your search. Please try a different value.',
        placeholder: `Enter ${fieldName.toLowerCase()}`,
        disabled: !searchTerm.trim(),
        submit(): boolean {
            if (!fieldName || !searchTerm.trim()) return false;
            setShowError(false);
            props.onNavigate(
                getSearchPageSubmissionUrl({
                    currentUrl: props.getCurrentUrl(),
                    searchPageField: props.searchPageField,
                    searchTerm,
                })
            );
            return true;
        },
        clear(): void {
            setSearchTerm('');
            setShowError(false);
            props.onClearSearch?.();
        },
    };
}
