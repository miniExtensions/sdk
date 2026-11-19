/** Visible, configured required-open fields in one committed native Form. */
export type BorrowedFormRequiredOpenField = Readonly<{
    fieldId: string;
    selectedRecordIds: readonly string[];
    reviewedRecordIds: readonly string[];
}>;

/** The exact receipt for an existing child whose native content has mounted. */
export type BorrowedFormRequiredOpenPresentation = Readonly<{
    kind: 'edit';
    parentOwner: object;
    fieldId: string;
    recordId: string;
    /** The actual nonnull envelope presented by the native host. */
    envelope: object;
}>;

export type BorrowedFormRequiredOpenFrame = Readonly<{
    /** Native Form-load identity, advanced on replacement even for the same record. */
    parentOwner: object;
    fields: readonly BorrowedFormRequiredOpenField[];
    /** Null until native content mounts. Never reconstruct a receipt from IDs. */
    currentPresentation: BorrowedFormRequiredOpenPresentation | null;
}>;

const validId = (value: unknown): value is string =>
    typeof value === 'string' && value.trim() !== '';

const validIds = (values: unknown): values is readonly string[] =>
    Array.isArray(values) && Array.from(values).every(validId);

const objectIdentity = (value: unknown): value is object =>
    typeof value === 'object' && value !== null;

/**
 * Projects review debt without storing history. Pass the visible required-open
 * fields with the current unfiltered selections and the native owner's review
 * history. Null denotes invalid input and must not be treated as clear debt.
 */
export function projectBorrowedFormRequiredOpenDebt(
    fields: readonly BorrowedFormRequiredOpenField[]
): Readonly<Record<string, readonly string[]>> | null {
    if (!Array.isArray(fields)) return null;

    const pending = new Map<string, readonly string[]>();
    for (const rawField of fields as readonly unknown[]) {
        if (!objectIdentity(rawField) || Array.isArray(rawField)) return null;
        const { fieldId, selectedRecordIds, reviewedRecordIds } =
            rawField as Record<string, unknown>;
        if (
            !validId(fieldId) ||
            pending.has(fieldId) ||
            !validIds(selectedRecordIds) ||
            !validIds(reviewedRecordIds)
        ) {
            return null;
        }

        const reviewed = new Set(reviewedRecordIds);
        pending.set(
            fieldId,
            selectedRecordIds.filter((recordId) => !reviewed.has(recordId))
        );
    }
    return Object.fromEntries(pending);
}

/**
 * Call within the synchronous native history update, with its current frame.
 * The host owns issuance and retirement of the exact mounted receipt. This
 * decision neither updates the native history nor admits a Save.
 */
export function resolveBorrowedFormRequiredOpenCredit(
    frame: BorrowedFormRequiredOpenFrame,
    presentation: BorrowedFormRequiredOpenPresentation
): Readonly<{ fieldId: string; recordId: string }> | null {
    if (
        !objectIdentity(frame) ||
        !objectIdentity(presentation) ||
        presentation !== frame.currentPresentation ||
        presentation.kind !== 'edit' ||
        !objectIdentity(frame.parentOwner) ||
        frame.parentOwner !== presentation.parentOwner ||
        !validId(presentation.fieldId) ||
        !validId(presentation.recordId) ||
        !objectIdentity(presentation.envelope) ||
        Array.isArray(presentation.envelope)
    ) {
        return null;
    }

    const { fieldId, recordId } = presentation;
    const debt = projectBorrowedFormRequiredOpenDebt(frame.fields);
    if (
        debt === null ||
        !Object.hasOwn(debt, fieldId) ||
        !debt[fieldId]?.includes(recordId)
    ) {
        return null;
    }

    return { fieldId, recordId };
}
