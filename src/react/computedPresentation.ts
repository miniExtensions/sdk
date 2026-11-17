import type {
    ControlledLookupFieldProps,
    LookupPresentationOwner,
    LookupPresentationState,
    LookupResultPresentation,
} from './lookupFieldTypes.js';
import { isLookupResultPresentation } from './lookupPresentationValidation.js';

/** Metadata/value admission precedes this data-only composition boundary. */
export type ComputedPresentationProjection =
    | { readonly status: 'masked' | 'empty' | 'invalid-result' | 'unavailable' }
    | { readonly status: 'native-error'; readonly message: string }
    | {
          readonly status: 'ready';
          readonly occurrences: readonly { readonly key: string }[];
      };

export type ComputedPresentationEntry =
    | { readonly kind: 'result'; readonly result: LookupResultPresentation }
    | {
          readonly kind: 'nested';
          readonly projection: ComputedPresentationProjection;
      };

/**
 * Assemble ordered computed results from already-admitted display facts.
 * A missing leaf never falls back to raw values or inferred action authority.
 * This accepts no renderer, formatter, setter, resource producer or controller.
 */
export function composeComputedPresentation(input: {
    readonly projection: ComputedPresentationProjection;
    readonly entries: ReadonlyMap<string, ComputedPresentationEntry>;
    readonly owner: LookupPresentationOwner;
    readonly language?: ControlledLookupFieldProps['language'];
}): LookupPresentationState {
    try {
        const root = input.projection;
        switch (root.status) {
            case 'masked':
            case 'empty':
            case 'invalid-result':
            case 'unavailable':
                return { status: root.status };
            case 'native-error':
                return typeof root.message === 'string'
                    ? { status: 'native-error', message: root.message }
                    : { status: 'unavailable' };
            case 'ready':
                break;
            default:
                return { status: 'unavailable' };
        }
        const owner = input.owner;
        if (!owner.isCurrent()) return { status: 'unavailable' };
        let entries: ReadonlyMap<string, ComputedPresentationEntry> | undefined;
        const active = new Set<object>();
        const visit = (
            projection: ComputedPresentationProjection
        ): LookupResultPresentation | null => {
            if (!owner.isCurrent()) return null;
            if (projection.status === 'native-error')
                return { kind: 'error', message: projection.message };
            if (projection.status === 'empty')
                return {
                    kind: 'text',
                    display: { value: null, language: input.language ?? 'en' },
                };
            if (projection.status !== 'ready' || active.has(projection))
                return null;
            if (!Array.isArray(projection.occurrences)) return null;
            active.add(projection);
            try {
                const keys = new Set<string>();
                const leaves: {
                    key: string;
                    result: LookupResultPresentation;
                }[] = [];
                for (
                    let index = 0;
                    index < projection.occurrences.length;
                    index++
                ) {
                    if (!Object.hasOwn(projection.occurrences, index))
                        return null;
                    const key = projection.occurrences[index].key;
                    if (typeof key !== 'string' || !key.trim() || keys.has(key))
                        return null;
                    keys.add(key);
                    if (!owner.isCurrent()) return null;
                    entries ??= input.entries;
                    const entry = entries.get(key);
                    const result =
                        entry?.kind === 'result'
                            ? entry.result
                            : entry?.kind === 'nested'
                              ? visit(entry.projection)
                              : null;
                    if (!result) return null;
                    leaves.push({ key, result });
                }
                return { kind: 'sequence', leaves, layout: 'wrap' };
            } finally {
                active.delete(projection);
            }
        };
        const result = visit(root);
        return result && isLookupResultPresentation(result) && owner.isCurrent()
            ? { status: 'ready', result }
            : { status: 'unavailable' };
    } catch {
        return { status: 'unavailable' };
    }
}
