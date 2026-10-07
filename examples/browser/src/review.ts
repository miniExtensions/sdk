import moment from 'moment-timezone';
import { getReadableStringFromAirtableValue } from '@miniextensions/sdk/formulas';
import {
    AirtableFieldType,
    type AirtableValue,
    type FormLoadedResult,
} from '@miniextensions/sdk';
import {
    getFormAttachmentPolicy,
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
        'Review is unavailable for this configuration. This starter supports one-page manual Forms with direct text, numeric, checkbox, barcode, date, dateTime, select and conservatively presented linked and attachment answers.'
    );
}

/** Browser-local presentation only; never used to normalize native Save data. */
export type PreparedDateContext = Readonly<{ clientTimeZone: string }>;
export const captureReviewDateContext = (): PreparedDateContext => ({
    clientTimeZone: moment.tz.guess(true),
});
const dateFormats = new Map([
    ['local', 'l'],
    ['friendly', 'LL'],
    ['us', 'M/D/YYYY'],
    ['european', 'D/M/YYYY'],
    ['iso', 'YYYY-MM-DD'],
]);
const timeFormats = new Map([
    ['12hour', 'h:mma'],
    ['24hour', 'HH:mm'],
]);
const isPair = (
    value: unknown,
    pairs: ReadonlyMap<string, string>
): boolean => {
    if (value == null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const pair = value as { name?: unknown; format?: unknown };
    return (
        typeof pair.name === 'string' &&
        typeof pair.format === 'string' &&
        pairs.get(pair.name) === pair.format
    );
};
const formatDateAnswer = (
    field: ReturnType<typeof describeLoadedFormFields>[number],
    value: unknown,
    context: PreparedDateContext | undefined
): string => {
    if (typeof value !== 'string') unavailable();
    const config = field.schema.airtableField.config;
    if (config.type !== 'date' && config.type !== 'dateTime') unavailable();
    const privacy = field.schema.miniExtConfig;
    if (
        privacy != null &&
        (('obscurePassword' in privacy && privacy.obscurePassword === true) ||
            ('displayAsAttachments' in privacy &&
                privacy.displayAsAttachments === true) ||
            ('displayAsButton' in privacy && privacy.displayAsButton === true))
    )
        unavailable();
    if (!isPair(config.options?.dateFormat, dateFormats)) unavailable();
    // Validate the calendar independently of local civil-time normalization.
    const calendar = value.slice(0, 10);
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(calendar) ||
        !moment.utc(calendar, 'YYYY-MM-DD', true).isValid()
    )
        unavailable();
    let detached = structuredClone(config);
    if (config.type === 'date') {
        if (
            value !== calendar ||
            moment(value, 'YYYY-MM-DD', true).format('YYYY-MM-DD') !== value
        )
            unavailable();
    } else {
        // Calendar timestamp only: explicit seconds and offset, 0–3 fractional
        // digits (the dot requires 1–3), no naive/week/ordinal/24:00 parsing.
        const match =
            /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(
                value
            );
        if (
            match == null ||
            Number(match[2]) > 23 ||
            Number(match[3]) > 59 ||
            Number(match[4]) > 59 ||
            (match[6] !== 'Z' &&
                (Number(match[7]) > 23 || Number(match[8]) > 59)) ||
            !moment.parseZone(value, moment.ISO_8601, true).isValid() ||
            !isPair(config.options.timeFormat, timeFormats)
        )
            unavailable();
        const zone =
            config.options.timeZone === 'client'
                ? context?.clientTimeZone
                : config.options.timeZone;
        if (typeof zone !== 'string' || moment.tz.zone(zone) == null)
            unavailable();
        detached = {
            ...structuredClone(config),
            options: {
                ...structuredClone(config.options),
                timeZone: zone as typeof config.options.timeZone,
            },
        };
    }
    try {
        return getReadableStringFromAirtableValue({
            value,
            airtableFieldConfig: detached,
            source: {
                type: 'airtableMock',
                linkedTableStates: {},
                dateParsing: 'local',
            },
            fieldName: 'Date answer',
        });
    } catch {
        unavailable();
    }
};

/** A presentation copy only: the complete native snapshot still goes to Save. */
export const prepareFormReviewRows = (
    page: FormLoadedResult,
    data: Readonly<Record<string, AirtableValue>>,
    linked?: LinkedReviewSnapshot,
    dateContext?: PreparedDateContext
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
                type !== AirtableFieldType.DATE &&
                type !== AirtableFieldType.DATE_TIME &&
                type !== AirtableFieldType.SINGLE_SELECT &&
                type !== AirtableFieldType.MULTIPLE_SELECTS &&
                type !== AirtableFieldType.MULTIPLE_RECORD_LINKS &&
                type !== AirtableFieldType.MULTIPLE_ATTACHMENTS &&
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
        // Canonical emptiness accepts whitespace before field-specific shapes.
        if (value == null || (typeof value === 'string' && value.trim() === ''))
            continue;
        if (
            (type === AirtableFieldType.MULTIPLE_SELECTS ||
                type === AirtableFieldType.MULTIPLE_RECORD_LINKS ||
                type === AirtableFieldType.MULTIPLE_ATTACHMENTS) &&
            Array.isArray(value) &&
            value.length === 0
        )
            continue;
        let text: string;
        if (
            type === AirtableFieldType.DATE ||
            type === AirtableFieldType.DATE_TIME
        ) {
            text = formatDateAnswer(field, value, dateContext);
        } else if (type === AirtableFieldType.MULTIPLE_ATTACHMENTS) {
            let policy;
            try {
                // Original loaded policy and complete native answer, before
                // readonly presentation. Visibility never changes Save data.
                policy = getFormAttachmentPolicy({
                    loaded: page,
                    fieldId: field.fieldId,
                    value: data[field.fieldId],
                });
            } catch {
                unavailable();
            }
            if (policy.status !== 'ready') unavailable();
            const config = field.schema.miniExtConfig;
            const names =
                config != null &&
                'hideAttachmentName' in config &&
                config.hideAttachmentName === false;
            const visible = policy.rows.filter((row) => row.visible);
            if (visible.length === 0) continue;
            text = visible
                .map(({ attachment }) =>
                    names &&
                    typeof attachment.filename === 'string' &&
                    attachment.filename.trim() !== ''
                        ? attachment.filename
                        : 'Attachment — filename unavailable'
                )
                .join('\n');
        } else if (type === AirtableFieldType.MULTIPLE_RECORD_LINKS) {
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
