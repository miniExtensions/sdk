import type { AirtableField, AirtableValue } from '../formulas/types.js';
import { getReadableStringFromAirtableValue } from '../formulas/valueConversion.js';
import { hasRenderableHTMLContent } from '../react/html/sanitizeHTML.js';
import { removeMarkdown } from '../formulas/removeMarkdown.js';

/** One current, condition-filtered field; never a record store or linked cache. */
export type FormDisplayField =
    | { status: 'missing' }
    | {
          status: 'resolved';
          field: AirtableField;
          value: AirtableValue | undefined;
          /** Readable labels only for linked IDs in this admitted value. */
          linkedRecordLabels?: Readonly<Record<string, string | null>>;
      };
export type FormDisplaySource =
    | { type: 'none' }
    | { type: 'static'; value?: string | null }
    | { type: 'field'; field: FormDisplayField };
export type FormPresentationIdentity = {
    owner: string;
    configuration: string;
    /** Actual table:record identity, or create. A–B–A is a new transition. */
    record: string;
};

function readable(
    field: Extract<FormDisplayField, { status: 'resolved' }>
): string {
    return getReadableStringFromAirtableValue({
        value: field.value ?? null,
        airtableFieldConfig: field.field.config,
        fieldName: field.field.name,
        source: {
            type: 'airtableMock',
            dateParsing: 'local',
            linkedTableStates: {},
            linkedRecordLabels: field.linkedRecordLabels,
            doNotReturnRecordIdsForLinkedRecords: true,
        },
    });
}

/** Source selection precedes formatting; retained inactive sources grant no data. */
export function resolveFormDisplayText(
    source: FormDisplaySource
): string | null {
    if (source.type === 'none') return null;
    if (source.type === 'static') return source.value ?? null;
    const field = source.field;
    if (field.status === 'missing' || field.value == null) return null;
    return readable(field);
}

export function resolveFormHeaderTitle(
    source: FormDisplaySource,
    extensionName: string | null
): string | null {
    if (source.type === 'none') return null;
    if (source.type === 'static')
        return source.value?.trim() ? source.value : extensionName;
    if (source.field.status === 'missing') return extensionName;
    const title = readable(source.field);
    return source.field.field.config.type === 'formula'
        ? removeMarkdown(title)
        : title;
}

/** Logos require actual attachment values, not readable labels or thumbnails. */
export function resolveFormLogo(
    source: FormDisplaySource,
    isChildForm = false
): string | null {
    if (isChildForm || source.type === 'none') return null;
    if (source.type === 'static') return source.value ?? null;
    if (source.field.status === 'missing') return null;
    const value = source.field.value;
    if (
        !Array.isArray(value) ||
        !value.every(
            (item) =>
                item != null &&
                !Array.isArray(item) &&
                typeof item === 'object' &&
                'url' in item &&
                typeof item.url === 'string' &&
                !('label' in item)
        )
    )
        return null;
    const first = value[0];
    return first != null &&
        typeof first === 'object' &&
        'url' in first &&
        typeof first.url === 'string'
        ? first.url
        : null;
}

export type FormHeaderDisplayInput = {
    title: FormDisplaySource;
    extensionName: string | null;
    description?: {
        enabled: boolean;
        source: FormDisplaySource;
        truncate?: boolean;
    };
    logo?: FormDisplaySource;
    isChildForm?: boolean;
};
export function resolveFormFooterDescription(input: {
    enabled: boolean;
    source: FormDisplaySource;
}): string | null {
    const text = input.enabled ? resolveFormDisplayText(input.source) : null;
    return text != null && hasRenderableHTMLContent(text) ? text : null;
}
export function projectFormHeader(input: FormHeaderDisplayInput): {
    title: string | null;
    logo: string | null;
    description: string | null;
} {
    return {
        title: resolveFormHeaderTitle(input.title, input.extensionName),
        logo: resolveFormLogo(
            input.logo ?? { type: 'none' },
            input.isChildForm
        ),
        description: input.description
            ? resolveFormFooterDescription(input.description)
            : null,
    };
}

export function shouldRenderFormCover(input: {
    src?: string | null;
    isChildForm?: boolean;
    isModal?: boolean;
    showPlaceholders?: boolean;
}): boolean {
    return (
        !input.isChildForm &&
        !input.isModal &&
        Boolean(input.src || input.showPlaceholders)
    );
}
