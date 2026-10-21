export type CollaboratorSelectionPresentation = {
    showSelector: boolean;
    showEmpty: boolean;
    canRemove: boolean;
};

/** Hosted picker presentation only; the caller owns choices, permissions and writes. */
export function getCollaboratorSelectionPresentation(options: {
    selectedCount: number;
    readOnly: boolean;
    limitToOneSelection?: boolean;
}): CollaboratorSelectionPresentation {
    return {
        showSelector:
            !options.readOnly &&
            !(options.limitToOneSelection && options.selectedCount === 1),
        showEmpty: options.readOnly && options.selectedCount === 0,
        canRemove: !options.readOnly,
    };
}

/** Remove matching native IDs without deduplicating, cloning or resolving collaborators. */
export function removeCollaboratorSelection<T extends { id: string }>(
    selected: readonly T[],
    collaboratorId: string
): T[] {
    return selected.filter(
        (collaborator) => collaborator.id !== collaboratorId
    );
}
