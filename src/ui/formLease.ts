import type { FormLoadedResult, RuntimeFieldSchema } from '../runtime/types.js';
import type { LoadedFormFieldDescriptor } from '../forms/helpers.js';

// The accepted Form owner alone installs successful Add Choice metadata. Its
// context revision fences reload/reset. Exclude only those native choice arrays
// from renderer configuration leases; retain all options and property presence.
function normalizeChoices(schema: RuntimeFieldSchema): void {
    const config = schema.airtableField.config;
    if (
        (schema.fieldType !== 'singleSelect' &&
            schema.fieldType !== 'multipleSelects') ||
        config.type !== schema.fieldType
    )
        return;
    if (
        config.options != null &&
        Object.hasOwn(config.options, 'choices') &&
        Array.isArray(config.options.choices)
    )
        config.options.choices = [];
}
export function normalizeFormLeaseLoaded(
    loaded: FormLoadedResult
): FormLoadedResult {
    const copy = structuredClone(loaded);
    for (const schemas of [
        copy.payload.fieldIdsToSchemas,
        copy.payload.fieldNamesToSchemas,
    ])
        for (const schema of Object.values(schemas)) normalizeChoices(schema);
    return copy;
}
export function normalizeFormLeaseField(
    field: LoadedFormFieldDescriptor
): LoadedFormFieldDescriptor {
    const copy = structuredClone(field);
    normalizeChoices(copy.schema);
    return copy;
}
