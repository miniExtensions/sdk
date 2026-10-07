import type {
    AirtableRecord,
    FormLoadedResult,
    ListLinkedRecordOptionsResult,
    RuntimeTableStates,
} from '@miniextensions/sdk';
import { getReadableStringFromAirtableValue } from '@miniextensions/sdk/formulas';

export const unavailableLinkedAnswer = 'Selected record — details unavailable';
const object = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);
const plainTypes = new Set([
    'singleLineText',
    'multilineText',
    'email',
    'phoneNumber',
    'number',
    'currency',
    'percent',
    'rating',
    'checkbox',
]);

/** One render lifetime only. Reads are accepted by the adapter before this call. */
export function createLinkedReviewPresentation(
    page: FormLoadedResult,
    current: () => boolean
) {
    const policies = new Map<
        string,
        {
            tableId: string;
            config: Record<string, unknown>;
            details: unknown;
            original: Set<string>;
        }
    >();
    for (const fieldId of page.payload.fieldIdsInForm) {
        const schema = page.payload.fieldIdsToSchemas[fieldId];
        if (
            schema?.fieldType !== 'multipleRecordLinks' ||
            schema.airtableField.config.type !== 'multipleRecordLinks'
        )
            continue;
        const value = page.payload.formRecord.data[fieldId];
        policies.set(fieldId, {
            tableId: schema.airtableField.config.options.linkedTableId,
            config: structuredClone(schema.miniExtConfig ?? {}) as Record<
                string,
                unknown
            >,
            details: structuredClone(
                page.payload.linkedRecordFieldIdToDetailFields?.[fieldId]
            ),
            original: new Set(
                Array.isArray(value)
                    ? value.filter(
                          (id): id is string =>
                              typeof id === 'string' && id.trim() !== ''
                      )
                    : []
            ),
        });
    }
    const policyBytes = (): string =>
        JSON.stringify([
            page.payload.linkedRecordFieldIdToDetailFields,
            [...policies.keys()].map(
                (id) => page.payload.fieldIdsToSchemas[id]
            ),
        ]);
    const capturedPolicy = policyBytes();
    const labels = new Map<string, Map<string, string>>();
    let epoch = 0,
        retired = false;
    const active = (): boolean => {
        if (!retired && policyBytes() !== capturedPolicy) retire();
        return !retired && current();
    };
    const retire = () => {
        retired = true;
        labels.clear();
        epoch++;
    };
    const replace = (fieldId: string, next: Map<string, string>) => {
        labels.set(fieldId, next);
        epoch++;
    };
    const build = (
        fieldId: string,
        records: readonly AirtableRecord[],
        table: Pick<RuntimeTableStates[string], 'airtableFields'> | undefined
    ) => {
        const next = new Map<string, string>();
        const policy = policies.get(fieldId);
        if (
            !policy ||
            !object(table) ||
            !Array.isArray(table.airtableFields) ||
            !Array.isArray(records) ||
            !Array.isArray(policy.details)
        )
            return next;
        const fields = table.airtableFields;
        const fieldIds = new Set<string>();
        for (const field of fields) {
            if (
                !object(field) ||
                typeof field.id !== 'string' ||
                field.id.trim() === '' ||
                fieldIds.has(field.id) ||
                typeof field.name !== 'string' ||
                !object(field.config) ||
                (field.isComputed !== undefined &&
                    typeof field.isComputed !== 'boolean') ||
                (field.isPrimaryField !== undefined &&
                    typeof field.isPrimaryField !== 'boolean')
            )
                return next;
            fieldIds.add(field.id);
        }
        const detailIds = new Set<string>();
        for (const detail of policy.details) {
            if (
                !object(detail) ||
                typeof detail.fieldId !== 'string' ||
                detail.fieldId.trim() === '' ||
                detailIds.has(detail.fieldId)
            )
                return next;
            detailIds.add(detail.fieldId);
        }
        const configured = policy.config.customPrimaryField;
        if (
            configured != null &&
            (typeof configured !== 'string' || configured.trim() === '')
        )
            return next;
        const primaries = fields.filter((field) =>
            configured == null
                ? field.isPrimaryField === true
                : field.id === configured
        );
        if (primaries.length !== 1) return next;
        const primary = primaries[0];
        const detail = policy.details.find(
            (detail) => detail.fieldId === primary.id
        );
        if (
            !object(detail) ||
            detail.fieldName !== primary.name ||
            detail.isHidden !== false ||
            (detail.miniExtConfig != null && !object(detail.miniExtConfig))
        )
            return next;
        const config = detail.miniExtConfig ?? {};
        if (
            config.obscurePassword !== undefined &&
            typeof config.obscurePassword !== 'boolean'
        )
            return next;
        if (primary.isComputed === true || !plainTypes.has(primary.config.type))
            return next;
        const recordIds = new Set<string>();
        for (const record of records) {
            if (
                !object(record) ||
                typeof record.id !== 'string' ||
                record.id.trim() === '' ||
                recordIds.has(record.id) ||
                !object(record.fields)
            )
                return new Map<string, string>();
            recordIds.add(record.id);
            // Never retain raw values; privacy decisions precede value access.
            if (
                primary.config.type === 'singleLineText' &&
                config.obscurePassword === true
            ) {
                next.set(record.id, '••••••••');
                continue;
            }
            const value = record.fields[primary.id];
            if (
                value == null ||
                (typeof value === 'string' && value.trim() === '') ||
                typeof value === 'object'
            )
                continue;
            const numeric = [
                'number',
                'currency',
                'percent',
                'rating',
            ].includes(primary.config.type);
            if (
                numeric
                    ? typeof value !== 'number' || !Number.isFinite(value)
                    : primary.config.type === 'checkbox'
                      ? typeof value !== 'boolean'
                      : typeof value !== 'string'
            )
                continue;
            try {
                const text = getReadableStringFromAirtableValue({
                    value,
                    airtableFieldConfig: primary.config,
                    source: { type: 'airtableMock', linkedTableStates: {} },
                    fieldName: '',
                    doNotRemoveMarkdownFormatting: true,
                });
                if (typeof text === 'string' && text.trim() !== '')
                    next.set(record.id, text);
            } catch {
                /* Generic fallback, without raw diagnostic content. */
            }
        }
        return next;
    };
    return {
        retire,
        revision: () => epoch,
        acceptHydration(result: RuntimeTableStates) {
            if (!active()) return;
            for (const [fieldId, policy] of policies) {
                const table = result?.[policy.tableId];
                const records = object(table?.recordIdsToAirtableRecords)
                    ? [...policy.original].flatMap((id) => {
                          const record = table.recordIdsToAirtableRecords[id];
                          return record?.id === id ? [record] : [];
                      })
                    : [];
                replace(fieldId, build(fieldId, records, table));
            }
        },
        acceptOptions(fieldId: string, result: ListLinkedRecordOptionsResult) {
            if (!active()) return;
            const policy = policies.get(fieldId);
            if (!policy) return;
            replace(
                fieldId,
                build(
                    fieldId,
                    result.records,
                    result.tableIdsToLinkedTableStates?.[policy.tableId]
                )
            );
        },
        snapshot() {
            const revision = epoch;
            const copy = active()
                ? new Map(
                      [...labels].map(([id, values]) => [id, new Map(values)])
                  )
                : new Map<string, Map<string, string>>();
            return {
                forPage: (loaded: FormLoadedResult) => loaded === page,
                current: () => active() && epoch === revision,
                label: (fieldId: string, recordId: string) =>
                    active() && epoch === revision
                        ? (copy.get(fieldId)?.get(recordId) ??
                          unavailableLinkedAnswer)
                        : unavailableLinkedAnswer,
            };
        },
    };
}
export type LinkedReviewSnapshot = ReturnType<
    ReturnType<typeof createLinkedReviewPresentation>['snapshot']
>;
