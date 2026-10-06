import type { FormLoadedResult, RuntimeQuery } from '@miniextensions/sdk';

/** Starter-owned snapshots; these neither authorize a child nor change its data. */
export type ChildQuerySnapshots = {
    cascade: RuntimeQuery;
    save: RuntimeQuery;
    diagnostic: string | null;
};

const repeatedQuery = (text: string): RuntimeQuery => {
    const entries = new Map<string, string | string[]>();
    for (const [key, value] of new URLSearchParams(text)) {
        const prior = entries.get(key);
        entries.set(
            key,
            prior === undefined
                ? value
                : typeof prior === 'string'
                  ? [prior, value]
                  : [...prior, value]
        );
    }
    return Object.fromEntries(entries);
};

/** Capture the dispatched context string and accepted child settings once. */
export function childQuerySnapshots(
    dynamic: unknown,
    child: FormLoadedResult
): ChildQuerySnapshots {
    if (child.payload.formRecord.type === 'edit')
        return { cascade: {}, save: {}, diagnostic: null };
    const publicFields = child.payload.publicFields;
    const malformedPublicFields =
        publicFields != null &&
        (typeof publicFields !== 'object' || Array.isArray(publicFields));
    const state =
        publicFields != null &&
        typeof publicFields === 'object' &&
        !Array.isArray(publicFields)
            ? publicFields.state
            : undefined;
    const malformedState =
        state != null && (typeof state !== 'object' || Array.isArray(state));
    const staticText =
        !malformedState && state != null && typeof state === 'object'
            ? state.prefillURLParamsForAddingRecords
            : undefined;
    const malformedDynamic = dynamic != null && typeof dynamic !== 'string';
    const malformedStatic =
        malformedPublicFields ||
        malformedState ||
        (staticText != null && typeof staticText !== 'string');
    const save =
        typeof dynamic === 'string'
            ? Object.fromEntries(new URLSearchParams(dynamic).entries())
            : {};
    if (malformedDynamic || malformedStatic)
        return {
            cascade: {},
            save,
            diagnostic:
                'The child conditional-filter prefills could not be reconstructed from its accepted configuration. Ordinary draft editing remains available; reopen after correcting the published configuration.',
        };
    return {
        // Duplicate arrays are a conservative cascade refusal, not canonical
        // last-value parity. Static keys replace whole dynamic values.
        cascade: {
            ...repeatedQuery(typeof dynamic === 'string' ? dynamic : ''),
            ...repeatedQuery(typeof staticText === 'string' ? staticText : ''),
        },
        // Canonical frontend Save sends dynamic-only, last duplicate wins.
        save,
        diagnostic: null,
    };
}
