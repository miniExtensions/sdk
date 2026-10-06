import type {
    AirtableAttachment,
    AirtableValue,
    FormLoadedResult,
    RuntimeFieldSchema,
} from '../runtime/types.js';
import { describeLoadedFormFields } from './helpers.js';

type AttachmentField = Extract<
    RuntimeFieldSchema,
    { fieldType: 'multipleAttachments' }
>;
type AttachmentConfig = Extract<
    NonNullable<AttachmentField['miniExtConfig']>,
    { allowedAttachmentTypes?: readonly unknown[] }
>;
export type AttachmentTypeGroup = NonNullable<
    AttachmentConfig['allowedAttachmentTypes']
>[number];

/** Metadata only; no DOM, readability, folder or actual-byte guarantees. */
export type AttachmentFileDescriptor = { type: string; size: number };
export type FormAttachmentPolicyInput = {
    loaded: FormLoadedResult;
    fieldId: string;
    /** Complete current native draft value, including hidden rows. */
    value: AirtableValue | undefined;
    /** Narrows presentation only; never changes native data or capacity. */
    hidePersistedAddOnlyValues?: boolean;
};
export type FormAttachmentPolicy =
    | { status: 'unavailable'; reason: 'missing-persisted-baseline' }
    | {
          status: 'ready';
          readOnly: boolean;
          addOnly: boolean;
          /** Configuration permissions, not URL/rendering capabilities. */
          openAllowed: boolean;
          downloadAllowed: boolean;
          rows: readonly {
              nativeIndex: number;
              attachment: Readonly<AirtableAttachment>;
              persisted: boolean;
              visible: boolean;
              removeAllowed: boolean;
          }[];
          upload: {
              mode: NonNullable<AttachmentConfig['fieldMode']>;
              status:
                  | 'allowed'
                  | 'read-only'
                  | 'unsupported-mode'
                  | 'at-capacity';
              allowed: boolean;
              maxFiles: number | null;
              remainingSlots: number | null;
              maxFileBytes: number | null;
              allowedTypes: readonly AttachmentTypeGroup[] | null;
          };
      };
export type FormAttachmentFileCheck = {
    acceptedIndexes: readonly number[];
    rejected: readonly { index: number; reason: 'type' | 'size' }[];
    batchError:
        | 'unavailable-policy'
        | 'read-only'
        | 'unsupported-mode'
        | 'count'
        | null;
};

const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

function attachments(value: unknown): AirtableAttachment[] {
    if (value == null) return [];
    if (!Array.isArray(value))
        throw new TypeError('Expected a native attachment array.');
    const valid = (entry: unknown): entry is AirtableAttachment =>
        !(
            !object(entry) ||
            typeof entry.url !== 'string' ||
            entry.url === '' ||
            (entry.id != null && typeof entry.id !== 'string') ||
            (entry.filename !== undefined &&
                typeof entry.filename !== 'string') ||
            (entry.type !== undefined && typeof entry.type !== 'string') ||
            (entry.size !== undefined && typeof entry.size !== 'number')
        );
    return Array.from(value).map((entry: unknown) => {
        if (!valid(entry))
            throw new TypeError('The native attachment value is malformed.');
        // Keep all canonical metadata, including thumbnails, without sharing
        // mutable nested objects with the caller's loaded/native data.
        return structuredClone(entry);
    });
}

const typeGroups = new Set<AttachmentTypeGroup>([
    'images',
    'videos',
    'audios',
    'documents',
    'compressedFiles',
]);

/** Opt-in presentation/admission helper; never writes, uploads or authorizes. */
export function getFormAttachmentPolicy(
    input: FormAttachmentPolicyInput
): FormAttachmentPolicy {
    const descriptor = describeLoadedFormFields(input.loaded).find(
        (field) => field.fieldId === input.fieldId
    );
    if (descriptor?.schema.fieldType !== 'multipleAttachments')
        throw new TypeError('Expected a returned Form attachment field.');
    const config: AttachmentConfig | undefined =
        descriptor.schema.miniExtConfig;
    for (const flag of [
        config?.addOnlyMode,
        config?.showExistingValuesForAddOnlyMode,
        config?.disableOpenFiles,
        config?.disableDownloadFiles,
        input.hidePersistedAddOnlyValues,
    ])
        if (flag !== undefined && typeof flag !== 'boolean')
            throw new TypeError('Attachment presentation flags are malformed.');
    const mode = config?.fieldMode ?? 'upload-file';
    if (
        ![
            'upload-file',
            'upload-url',
            'hand-signature',
            'image-annotation',
        ].includes(mode)
    )
        throw new TypeError('Attachment producer mode is malformed.');
    for (const limit of [config?.allowedFiles, config?.sizeLimit])
        if (limit != null && typeof limit !== 'number')
            throw new TypeError('Attachment limits must be numbers.');
    const groups = config?.allowedAttachmentTypes;
    if (
        groups != null &&
        (!Array.isArray(groups) ||
            Array.from(groups).some((group) => !typeGroups.has(group)))
    )
        throw new TypeError('Attachment type groups are malformed.');
    const values = attachments(input.value);
    const readOnly = descriptor.readOnly;
    const addOnly = !readOnly && config?.addOnlyMode === true;
    const baseline =
        input.loaded.payload.persistedAddOnlyAttachmentValuesByFieldId;
    if (addOnly && baseline === undefined)
        return { status: 'unavailable', reason: 'missing-persisted-baseline' };
    if (addOnly && !object(baseline))
        throw new TypeError('Persisted attachment baseline is malformed.');
    const persistedUrls = new Set(
        addOnly &&
        baseline !== undefined &&
        Object.hasOwn(baseline, input.fieldId)
            ? attachments(baseline[input.fieldId]).map((entry) => entry.url)
            : []
    );
    const maxFiles =
        config?.allowedFiles == null
            ? null
            : Number.isFinite(config.allowedFiles)
              ? Math.max(0, Math.floor(config.allowedFiles))
              : 0;
    const sizeLimit = config?.sizeLimit;
    const maxFileBytes =
        sizeLimit == null || sizeLimit === 0
            ? null
            : !Number.isFinite(sizeLimit) || sizeLimit < 0
              ? 0
              : sizeLimit * 1048576;
    const remainingSlots =
        maxFiles === null ? null : Math.max(0, maxFiles - values.length);
    const uploadStatus =
        mode !== 'upload-file'
            ? 'unsupported-mode'
            : readOnly
              ? 'read-only'
              : remainingSlots === 0
                ? 'at-capacity'
                : 'allowed';
    return {
        status: 'ready',
        readOnly,
        addOnly,
        openAllowed: config?.disableOpenFiles !== true,
        downloadAllowed: config?.disableDownloadFiles !== true,
        rows: values.map((attachment, nativeIndex) => {
            const persisted = addOnly && persistedUrls.has(attachment.url);
            return {
                nativeIndex,
                attachment,
                persisted,
                visible:
                    !persisted ||
                    (config?.showExistingValuesForAddOnlyMode === true &&
                        input.hidePersistedAddOnlyValues !== true),
                removeAllowed: !readOnly && !persisted,
            };
        }),
        upload: {
            mode,
            status: uploadStatus,
            allowed: uploadStatus === 'allowed',
            maxFiles,
            remainingSlots,
            maxFileBytes,
            allowedTypes:
                groups == null || groups.length === 0 ? null : [...groups],
        },
    };
}

function allowedMime(group: AttachmentTypeGroup, rawType: string): boolean {
    const type = rawType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    switch (group) {
        case 'images':
            return /^image\/[^/\s]+$/.test(type);
        case 'videos':
            return /^video\/[^/\s]+$/.test(type);
        case 'audios':
            return /^audio\/[^/\s]+$/.test(type);
        case 'documents':
            return [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ].includes(type);
        case 'compressedFiles':
            return [
                'application/zip',
                'application/x-zip',
                'application/x-zip-compressed',
            ].includes(type);
    }
}

/** Metadata-only batch check. Pending upload cancellation is caller-owned. */
export function checkFormAttachmentFiles(
    input: FormAttachmentPolicyInput & {
        files: readonly AttachmentFileDescriptor[];
    }
): FormAttachmentFileCheck {
    if (
        !Array.isArray(input.files) ||
        Array.from(input.files).some(
            (file) =>
                !object(file) ||
                typeof file.type !== 'string' ||
                typeof file.size !== 'number' ||
                !Number.isFinite(file.size) ||
                file.size < 0
        )
    )
        throw new TypeError(
            'Expected string MIME types and finite nonnegative sizes.'
        );
    const policy = getFormAttachmentPolicy(input);
    const blocked = (
        batchError: FormAttachmentFileCheck['batchError']
    ): FormAttachmentFileCheck => ({
        acceptedIndexes: [],
        rejected: [],
        batchError,
    });
    if (policy.status === 'unavailable') return blocked('unavailable-policy');
    if (policy.upload.status === 'unsupported-mode')
        return blocked('unsupported-mode');
    if (policy.readOnly) return blocked('read-only');
    const acceptedIndexes: number[] = [];
    const rejected: { index: number; reason: 'type' | 'size' }[] = [];
    input.files.forEach((file, index) => {
        if (
            policy.upload.allowedTypes !== null &&
            !policy.upload.allowedTypes.some((group) =>
                allowedMime(group, file.type)
            )
        )
            rejected.push({ index, reason: 'type' });
        else if (
            policy.upload.maxFileBytes !== null &&
            file.size > policy.upload.maxFileBytes
        )
            rejected.push({ index, reason: 'size' });
        else acceptedIndexes.push(index);
    });
    // Use the whole native array, not visible rows or clamped remainingSlots.
    // Existing-over-cap plus even an empty valid batch remains a count error.
    const overflow =
        policy.upload.maxFiles !== null &&
        policy.rows.length + acceptedIndexes.length > policy.upload.maxFiles;
    return {
        acceptedIndexes: overflow ? [] : acceptedIndexes,
        rejected,
        batchError: overflow ? 'count' : null,
    };
}
