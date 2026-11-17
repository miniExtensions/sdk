import {
    projectLookupValues,
    type LookupResultConfig,
    type LookupValueOccurrence,
    type LookupValueProjection,
} from './lookupProjection.js';
import type { FieldMetadata } from './rendererRegistry.js';

/** A result descriptor preserves physical computed identity and provenance. */
export type ComputedLookupResultField = Omit<
    FieldMetadata<'multipleLookupValues'>,
    'config'
> & { readonly config: LookupResultConfig };

export type ComputedLookupDisplayConfig<C extends object> =
    | C
    | (Omit<C, 'readOnly'> & { readonly readOnly: true });

export type ComputedLookupOccurrence = LookupValueOccurrence & {
    /** Original occurrence index, never a deduplicated value or record ID. */
    readonly key: string;
};

export type ComputedLookupProjection<C extends object> =
    | Exclude<LookupValueProjection, { status: 'ready' }>
    | {
          readonly status: 'ready';
          readonly shape: 'scalar-occurrences' | 'whole-array';
          readonly sourceField: FieldMetadata<'multipleLookupValues'>;
          readonly resultField: ComputedLookupResultField;
          readonly resultConfig: LookupResultConfig;
          readonly displayConfig: ComputedLookupDisplayConfig<C>;
          readonly occurrences: readonly ComputedLookupOccurrence[];
      };

/**
 * Project a physical Lookup into immutable result descriptors and occurrences.
 * Formatting, host schema types and actual captured authority stay with the host.
 * No binding, renderer callback, metadata publisher or action is manufactured.
 */
export function projectComputedLookup<C extends object>(input: {
    readonly masked?: boolean;
    readonly field: unknown;
    readonly value: unknown;
    readonly displayConfig: C;
    readonly forceReadOnly?: boolean;
    readonly keyPrefix?: string;
}): ComputedLookupProjection<C> {
    try {
        const masked = input.masked;
        if (masked !== undefined && typeof masked !== 'boolean')
            return { status: 'unavailable' };
        if (masked === true) return { status: 'masked' };
        // Capture once, before delegating to the existing metadata/value gate.
        const field = input.field;
        const projected = projectLookupValues({
            field,
            get value() {
                return input.value;
            },
        });
        if (projected.status !== 'ready') return projected;
        const forceReadOnly = input.forceReadOnly;
        const keyPrefix = input.keyPrefix;
        if (
            (forceReadOnly !== undefined &&
                typeof forceReadOnly !== 'boolean') ||
            (keyPrefix !== undefined && typeof keyPrefix !== 'string')
        )
            return { status: 'unavailable' };
        const config = input.displayConfig;
        if (
            config === null ||
            typeof config !== 'object' ||
            Array.isArray(config)
        )
            return { status: 'unavailable' };
        const sourceField = field as FieldMetadata<'multipleLookupValues'>;
        return {
            status: 'ready',
            shape: projected.shape,
            sourceField,
            resultField: { ...sourceField, config: projected.resultConfig },
            resultConfig: projected.resultConfig,
            displayConfig: forceReadOnly
                ? { ...config, readOnly: true }
                : config,
            occurrences: projected.occurrences.map(({ index, value }) => ({
                key: `${keyPrefix ?? sourceField.id}:${index}`,
                index,
                value,
            })),
        };
    } catch {
        return { status: 'unavailable' };
    }
}
