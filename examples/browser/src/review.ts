import {
    AirtableFieldType,
    type AirtableValue,
    type FormLoadedResult,
} from '@miniextensions/sdk';
import {
    createScalarFormRecordProjection,
    describeLoadedFormFields,
} from '@miniextensions/sdk/forms';
import type { ConfirmationRow } from './confirmation.js';
import { getSelectFieldPolicy } from '@miniextensions/sdk/ui';
import { settings } from './dom.js';
import {
    unavailableLinkedAnswer,
    type LinkedReviewSnapshot,
} from './linkedReview.js';

const textTypes = new Set<string>([
    AirtableFieldType.SINGLE_LINE_TEXT,
    AirtableFieldType.MULTILINE_TEXT,
    AirtableFieldType.EMAIL,
    AirtableFieldType.URL,
    AirtableFieldType.PHONE_NUMBER,
]);
const numericTypes = new Set<string>([
    AirtableFieldType.NUMBER,
    AirtableFieldType.PERCENT,
    AirtableFieldType.CURRENCY,
    AirtableFieldType.RATING,
]);
function unavailable(): never {
    throw new Error(
        'Review is unavailable for this configuration. This starter supports one-page manual Forms with direct text, numeric, checkbox, barcode, select and conservatively presented linked answers.'
    );
}

/** A presentation copy only: the complete native snapshot still goes to Save. */
export const prepareFormReviewRows = (
    page: FormLoadedResult,
    data: Readonly<Record<string, AirtableValue>>,
    linked?: LinkedReviewSnapshot
): ConfirmationRow[] => {
    if (linked != null && !linked.forPage(page)) unavailable();
    const configuration = settings(page.payload.publicFields);
    if (
        (configuration.multiPageFormMode != null &&
            configuration.multiPageFormMode !== 'one-page') ||
        configuration.enableFormComputeMode === true ||
        configuration.autoSubmitAfterPrefill === true ||
        page.payload.fieldIdsInForm.some(
            (id) => page.payload.fieldIdsToSchemas[id] == null
        )
    )
        unavailable();
    const fields = describeLoadedFormFields(page);
    for (const field of fields) {
        const type = field.fieldType;
        if (
            field.isComputed ||
            (!textTypes.has(type) &&
                !numericTypes.has(type) &&
                type !== AirtableFieldType.SINGLE_SELECT &&
                type !== AirtableFieldType.MULTIPLE_SELECTS &&
                type !== AirtableFieldType.MULTIPLE_RECORD_LINKS &&
                type !== AirtableFieldType.CHECKBOX &&
                type !== AirtableFieldType.BARCODE)
        )
            unavailable();
    }
    const projection = createScalarFormRecordProjection({
        fieldIds: page.payload.fieldIdsInForm,
        fieldIdsToSchemas: page.payload.fieldIdsToSchemas,
        airtableFields: Object.values(page.payload.fieldIdsToSchemas).map(
            (schema) => schema.airtableField
        ),
        data,
        recordId:
            page.payload.formRecord.type === 'edit'
                ? page.payload.formRecord.recordId
                : '',
        invalidConditionMode: 'strict',
    });
    if (projection.type === 'blocked') unavailable();
    const rows: ConfirmationRow[] = [];
    for (const field of fields) {
        if (projection.hiddenFieldIds.includes(field.fieldId)) continue;
        const type = field.fieldType;
        const value = projection.record.fields[field.fieldId];
        // Linked membership always requires an array; scalar/select blank rules stay intact.
        if (
            type === AirtableFieldType.MULTIPLE_RECORD_LINKS &&
            !Array.isArray(value)
        )
            unavailable();
        // Canonical emptiness accepts whitespace before field-specific shapes.
        if (value == null || (typeof value === 'string' && value.trim() === ''))
            continue;
        if (
            (type === AirtableFieldType.MULTIPLE_SELECTS ||
                type === AirtableFieldType.MULTIPLE_RECORD_LINKS) &&
            Array.isArray(value) &&
            value.length === 0
        )
            continue;
        let text: string;
        if (type === AirtableFieldType.MULTIPLE_RECORD_LINKS) {
            if (
                !Array.isArray(value) ||
                Array.from(value).some(
                    (id, index) =>
                        !Object.hasOwn(value, index) ||
                        typeof id !== 'string' ||
                        id.trim() === ''
                )
            )
                unavailable();
            text = value
                .map(
                    (id) =>
                        linked?.label(field.fieldId, id as string) ??
                        unavailableLinkedAnswer
                )
                .join('\n');
        } else if (
            type === AirtableFieldType.SINGLE_SELECT ||
            type === AirtableFieldType.MULTIPLE_SELECTS
        ) {
            const names =
                type === AirtableFieldType.SINGLE_SELECT ? [value] : value;
            if (
                !Array.isArray(names) ||
                Array.from(names).some(
                    (name) => typeof name !== 'string' || name.length === 0
                )
            )
                unavailable();
            try {
                const options = getSelectFieldPolicy(field.schema).options;
                text = names
                    .map(
                        (name) =>
                            options.find((option) => option.value === name)
                                ?.label ?? `${name} (unavailable)`
                    )
                    .join('\n');
            } catch {
                unavailable();
            }
        } else if (textTypes.has(type)) {
            if (typeof value !== 'string') unavailable();
            const config = field.schema.miniExtConfig;
            text =
                type === AirtableFieldType.SINGLE_LINE_TEXT &&
                config != null &&
                'obscurePassword' in config &&
                config.obscurePassword === true
                    ? '••••••••'
                    : value;
        } else if (numericTypes.has(type)) {
            if (typeof value !== 'number' || !Number.isFinite(value))
                unavailable();
            if (type === AirtableFieldType.RATING && value === 0) continue;
            text = String(value);
        } else if (type === AirtableFieldType.CHECKBOX) {
            if (typeof value !== 'boolean') unavailable();
            if (!value) continue;
            text = 'Checked';
        } else {
            if (
                typeof value !== 'object' ||
                Array.isArray(value) ||
                !('text' in value) ||
                (value.text != null && typeof value.text !== 'string') ||
                ('type' in value &&
                    value.type != null &&
                    typeof value.type !== 'string')
            )
                unavailable();
            if (value.text == null || value.text.trim() === '') continue;
            text = value.text;
        }
        rows.push({
            fieldId: field.fieldId,
            title: field.title,
            value: text,
            hideTitle:
                field.schema.miniExtConfig != null &&
                'showTitle' in field.schema.miniExtConfig &&
                field.schema.miniExtConfig.showTitle === false,
        });
    }
    return rows;
};
