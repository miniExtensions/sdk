/** Already-resolved section metadata; the host keeps schema/configuration policy. */
export type FormSectionHeader = Readonly<{
    enabled?: boolean;
    title?: string | null;
    description?: string | null;
    isExpanded?: boolean;
}>;

/** The original host field object or node is retained without inspecting it. */
export type FormSectionField<Field> = Readonly<{
    field: Field;
    sectionHeader?: FormSectionHeader | null;
}>;

export type FormFieldsGroup<Field> = Readonly<{
    kind: 'group';
    title: string;
    description: string | null;
    fieldsInSection: readonly Field[];
    /** Configuration default only; readonly presentation is a separate input. */
    isExpanded: boolean;
}>;

export type FormFieldSection<Field> =
    | Readonly<{ kind: 'field'; field: Field }>
    | FormFieldsGroup<Field>;

/**
 * Ordered presentation grouping, matching native FormFieldSections.ts blob
 * ec32f746091023c338a40836fea978d21dc3619b. A boundary includes its own field;
 * fields before the first boundary remain ungrouped. Only title blankness is
 * normalized: nonblank titles and nonnull descriptions retain their bytes.
 *
 * This projection does not evaluate visibility/errors, create pages, inspect
 * field IDs/values, or own field state. Native adapters resolve those concerns.
 */
export function groupFormFieldsBySections<
    const Descriptors extends readonly FormSectionField<unknown>[],
>(
    formFields: Descriptors
): readonly FormFieldSection<Descriptors[number]['field']>[] {
    type Field = Descriptors[number]['field'];
    const sections: FormFieldSection<Field>[] = [];
    let currentFields: Field[] | null = null;

    for (const { field, sectionHeader } of formFields) {
        const title = sectionHeader?.title;
        if (
            sectionHeader?.enabled !== false &&
            typeof title === 'string' &&
            title.trim() !== ''
        ) {
            currentFields = [];
            sections.push({
                kind: 'group',
                title,
                description: sectionHeader?.description ?? null,
                fieldsInSection: currentFields,
                isExpanded: sectionHeader?.isExpanded === true,
            });
        }

        if (currentFields === null) {
            sections.push({ kind: 'field', field });
        } else {
            currentFields.push(field);
        }
    }

    return sections;
}
