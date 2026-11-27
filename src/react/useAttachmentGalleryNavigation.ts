import {
    useId,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';

export type AttachmentGalleryRowIdentity = {
    readonly id?: string | null;
    readonly url: string;
};

export type AttachmentGalleryNavigation = {
    navigationOwner: string | null;
    currentSliderIndex: number;
    setCurrentSliderIndex: Dispatch<SetStateAction<number>>;
    handleAttachmentThumbnailClick(index: number): void;
    dismissSlider(): void;
};

/** Track selection in an immutable, host-owned attachment collection. */
export function useAttachmentGalleryNavigation(
    rows: readonly AttachmentGalleryRowIdentity[]
): AttachmentGalleryNavigation {
    const navigationScope = useId();
    const navigationSequence = useRef(0);
    const [navigationOwner, setNavigationOwner] = useState<string | null>(null);
    const [selection, setSelection] = useState({ rows, index: 0 });
    let currentSliderIndex = selection.index;

    if (selection.rows !== rows) {
        const selected = selection.rows[selection.index];
        const matchesSelected = (row: AttachmentGalleryRowIdentity) =>
            selected != null &&
            row.url === selected.url &&
            (row.id ?? null) === (selected.id ?? null);
        const occurrence = selection.rows
            .slice(0, selection.index)
            .filter(matchesSelected).length;
        const matchingIndices = rows.flatMap((row, index) =>
            matchesSelected(row) ? [index] : []
        );
        // The same identity can occur more than once, including in Lookups.
        let retainedIndex =
            matchingIndices[Math.min(occurrence, matchingIndices.length - 1)] ??
            -1;
        if (retainedIndex < 0 && selected != null) {
            // A unique saved row can receive a new URL, and a unique prefill
            // can receive an ID. A shared URL alone cannot resolve either.
            const matchesFallback = (row: AttachmentGalleryRowIdentity) =>
                selected.id == null
                    ? row.url === selected.url
                    : row.id === selected.id;
            if (selection.rows.filter(matchesFallback).length === 1) {
                const fallbackIndices = rows.flatMap((row, index) =>
                    matchesFallback(row) ? [index] : []
                );
                if (fallbackIndices.length === 1)
                    retainedIndex = fallbackIndices[0];
            }
        }

        currentSliderIndex =
            retainedIndex >= 0
                ? retainedIndex
                : Math.max(0, Math.min(selection.index, rows.length - 1));
        // Reconcile during render so the host never receives a stale row index.
        setSelection({ rows, index: currentSliderIndex });
        if (rows.length === 0 && navigationOwner != null)
            setNavigationOwner(null);
    }

    const setCurrentSliderIndex: Dispatch<SetStateAction<number>> = (next) => {
        setSelection((previous) => ({
            ...previous,
            index: typeof next === 'function' ? next(previous.index) : next,
        }));
    };

    const handleAttachmentThumbnailClick = (index: number) => {
        setCurrentSliderIndex(index);
        // Refreshing rows keeps the owner. An explicit open replaces it.
        setNavigationOwner(
            `${navigationScope}:${++navigationSequence.current}`
        );
    };

    const dismissSlider = () => {
        setNavigationOwner((owner) =>
            owner === navigationOwner ? null : owner
        );
    };

    return {
        navigationOwner,
        dismissSlider,
        currentSliderIndex,
        setCurrentSliderIndex,
        handleAttachmentThumbnailClick,
    };
}
