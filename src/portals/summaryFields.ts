/** Current identity and label of one configured parent-record summary field. */
export type PortalSummaryField = Readonly<{
    fieldId: string;
    fieldName: string;
}>;

export type PortalSummaryFieldsProjectionInput = Readonly<{
    summaryFieldIds?: readonly string[] | null;
    /** The accepted parent record's schema, not a Grid page or row schema. */
    fieldIdsToSchemas: Readonly<
        Record<
            string,
            Readonly<{ airtableField: Readonly<{ name: string }> }> | undefined
        >
    >;
}>;

/**
 * Pure ordered selection: first configured occurrence wins; deleted fields are
 * omitted and labels come from the current schema. Does not read or format
 * values, retain the schema, or allocate any host/read/refresh authority.
 */
export function projectPortalSummaryFields({
    summaryFieldIds,
    fieldIdsToSchemas,
}: PortalSummaryFieldsProjectionInput): readonly PortalSummaryField[] {
    const seen = new Set<string>();
    const fields: PortalSummaryField[] = [];
    for (const fieldId of summaryFieldIds ?? []) {
        if (seen.has(fieldId)) continue;
        seen.add(fieldId);
        if (!Object.hasOwn(fieldIdsToSchemas, fieldId)) continue;
        const schema = fieldIdsToSchemas[fieldId];
        if (!schema) continue;
        fields.push({ fieldId, fieldName: schema.airtableField.name });
    }
    return fields;
}
