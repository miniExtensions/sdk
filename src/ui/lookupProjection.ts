import type { AirtableValue } from '../runtime/types.js';
import { createRendererProps, type FieldMetadata } from './rendererRegistry.js';

export type LookupResultConfig = NonNullable<
    FieldMetadata<'multipleLookupValues'>['config']['options']['result']
>;

/** The index identifies an occurrence, never a deduplicated record or value. */
export type LookupValueOccurrence = {
    readonly index: number;
    readonly value: AirtableValue | undefined;
};

export type LookupValueProjection =
    | { readonly status: 'masked' }
    | { readonly status: 'unavailable' }
    | { readonly status: 'invalid-result' }
    | { readonly status: 'native-error'; readonly message: string }
    | {
          readonly status: 'empty';
          readonly resultConfig: LookupResultConfig;
      }
    | {
          readonly status: 'ready';
          readonly resultConfig: LookupResultConfig;
          readonly shape: 'scalar-occurrences' | 'whole-array';
          readonly occurrences: readonly LookupValueOccurrence[];
      };

const arrayResults = new Set<LookupResultConfig['type']>([
    'multipleAttachments',
    'multipleCollaborators',
    'multipleLookupValues',
    'multipleRecordLinks',
    'multipleSelects',
]);

// These are the native computed-member omission rules. They do not coerce,
// flatten, format, evaluate a formula, or change the canonical Lookup answer.
function emptyMember(value: AirtableValue, kind: LookupResultConfig['type']) {
    if (value == null || (typeof value === 'string' && !value.trim()))
        return true;
    if (kind === 'checkbox' && value === false) return true;
    if (kind === 'rating' && value === 0) return true;
    if (kind === 'button')
        return typeof value !== 'object' || !('url' in value) || !value.url;
    if (typeof value === 'object' && !Array.isArray(value) && 'text' in value)
        return value.text == null || !value.text.trim();
    return false;
}

/**
 * Admit already-flat native data and project its ordered occurrence boundary.
 * Presentation and captured resource/action authority are supplied separately.
 * Valid occurrences and result metadata retain their original references.
 */
export function projectLookupValues(input: {
    readonly masked?: boolean;
    readonly field: unknown;
    readonly value: unknown;
}): LookupValueProjection {
    // Concealment precedes metadata or raw-value inspection, including getters.
    if (input.masked === true) return { status: 'masked' };
    try {
        const field = input.field as FieldMetadata<'multipleLookupValues'>;
        const boundary = {
            physicalKind: 'multipleLookupValues',
            fieldId: field?.id,
            title: field?.name,
            field,
            displayConfig: null,
            context: 'form',
            computed: true,
            dirty: false,
            pending: false,
            validation: [],
            error: null,
            capability: { type: 'readonly' },
        } as const;
        const metadata = createRendererProps({ ...boundary, value: null });
        if (!metadata || metadata.physicalKind !== 'multipleLookupValues')
            return { status: 'unavailable' };
        const options = field.config.options;
        if (!options.isValid) return { status: 'invalid-result' };
        const resultConfig = options.result;
        const value = input.value;
        const accepted = createRendererProps({ ...boundary, value });
        if (!accepted || accepted.physicalKind !== 'multipleLookupValues')
            return { status: 'unavailable' };
        if (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            'error' in value &&
            typeof value.error === 'string'
        )
            return { status: 'native-error', message: value.error };
        if (arrayResults.has(resultConfig.type))
            return {
                status: 'ready',
                shape: 'whole-array',
                resultConfig,
                occurrences: [
                    { index: 0, value: value as AirtableValue | undefined },
                ],
            };
        if (value == null || (Array.isArray(value) && value.length === 0))
            return { status: 'empty', resultConfig };
        // The renderer admission above has verified a dense, flat native array.
        const values = value as readonly AirtableValue[];
        return {
            status: 'ready',
            shape: 'scalar-occurrences',
            resultConfig,
            occurrences: values.flatMap((member, index) =>
                emptyMember(member, resultConfig.type)
                    ? []
                    : [{ index, value: member }]
            ),
        };
    } catch {
        return { status: 'unavailable' };
    }
}
