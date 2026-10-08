import type {
    AirtableAttachment,
    AirtableValue,
    FormLoadedResult,
} from '../runtime/types.js';
import {
    checkFormAttachmentFiles,
    getFormAttachmentPolicy,
    type AttachmentFileDescriptor,
} from './attachments.js';

const refused = (): never => {
    throw new Error(
        'The attachment cannot be added with the current Form settings.'
    );
};

/** Admission uses the complete native answer, never its visible presentation. */
export function admittedAttachmentValues(
    loaded: FormLoadedResult,
    fieldId: string,
    nativeValue: AirtableValue | undefined,
    file: AttachmentFileDescriptor
): AirtableAttachment[] {
    const value =
        nativeValue == null ||
        (typeof nativeValue === 'string' && nativeValue.trim() === '')
            ? []
            : nativeValue;
    try {
        const input = { loaded, fieldId, value };
        const check = checkFormAttachmentFiles({ ...input, files: [file] });
        if (check.batchError !== null || !check.acceptedIndexes.includes(0))
            return refused();
        const policy = getFormAttachmentPolicy(input);
        if (policy.status !== 'ready') return refused();
        return policy.rows.map((row) => structuredClone(row.attachment));
    } catch {
        return refused();
    }
}

/** Validate both the returned object and full candidate before any draft write. */
export function appendedAttachmentValues(
    loaded: FormLoadedResult,
    fieldId: string,
    nativeValue: AirtableValue | undefined,
    file: AttachmentFileDescriptor,
    returned: unknown
): AirtableAttachment[] {
    const existing = admittedAttachmentValues(
        loaded,
        fieldId,
        nativeValue,
        file
    );
    try {
        if (
            returned == null ||
            typeof returned !== 'object' ||
            Array.isArray(returned) ||
            ('size' in returned &&
                (typeof returned.size !== 'number' ||
                    !Number.isFinite(returned.size) ||
                    returned.size < 0))
        )
            return refused();
        const policy = getFormAttachmentPolicy({
            loaded,
            fieldId,
            value: [...existing, returned] as AirtableValue,
        });
        if (policy.status !== 'ready') return refused();
        return policy.rows.map((row) => structuredClone(row.attachment));
    } catch {
        return refused();
    }
}
