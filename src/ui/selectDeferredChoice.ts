/** Local pending metadata, never a saved provider option or an immediate request. */
export type PendingSelectChoice = {
    id: '';
    name: string;
    newOption: true;
};

export type DeferredSelectChoiceResult =
    | { status: 'empty' | 'stale' | 'already-selected' | 'refused' }
    | { status: 'selected'; name: string; metadataPublished: boolean }
    | { status: 'metadata-published'; name: string };

/**
 * Publish native pending metadata before the selected canonical name. The host
 * supplies one captured authority for both operations. Exceptions propagate;
 * partial publication is never rolled back or retried against a new owner.
 */
export function publishDeferredSelectChoice(args: {
    input: string;
    choices: readonly { name: string }[];
    selectedNames: readonly string[];
    multiple: boolean;
    isCurrent(): boolean;
    publishMetadata(choice: PendingSelectChoice): boolean | void;
    selectName(name: string): boolean | void;
}): DeferredSelectChoiceResult {
    if (!args.isCurrent()) return { status: 'stale' };
    const name = args.input.trim();
    if (name.length === 0) return { status: 'empty' };
    const equivalent = (candidate: string) =>
        candidate.trim().toLowerCase() === name.toLowerCase();
    const existing = args.choices.find((choice) => equivalent(choice.name));
    const canonicalName = existing?.name ?? name;
    if (
        args.multiple &&
        existing != null &&
        args.selectedNames.some(
            (selected) =>
                selected.trim().toLowerCase() ===
                canonicalName.trim().toLowerCase()
        )
    )
        return { status: 'already-selected' };
    const metadataPublished = existing == null;
    if (metadataPublished) {
        if (args.publishMetadata({ id: '', name, newOption: true }) === false)
            return { status: 'refused' };
        if (!args.isCurrent())
            return { status: 'metadata-published', name: canonicalName };
    }
    if (args.selectName(canonicalName) === false)
        return metadataPublished
            ? { status: 'metadata-published', name: canonicalName }
            : { status: 'refused' };
    return { status: 'selected', name: canonicalName, metadataPublished };
}
