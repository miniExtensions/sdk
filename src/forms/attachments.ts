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
/** Normalized metadata limits; permissions and producer capabilities are caller-owned. */
export type AttachmentFileMetadataInput = {
    files: readonly AttachmentFileDescriptor[];
    /** Complete native count after caller-owned asynchronous validation. */
    currentCount: number;
    maxFiles: number | null;
    /** Infinity is supported when a finite configured MiB limit overflows in bytes. */
    maxFileBytes: number | null;
    allowedTypes: readonly AttachmentTypeGroup[] | null;
};
export type AttachmentFileMetadataCheck = {
    acceptedIndexes: readonly number[];
    rejected: readonly { index: number; reason: 'type' | 'size' }[];
    batchError: 'count' | null;
};
export type FormAttachmentFileCheck = Omit<
    AttachmentFileMetadataCheck,
    'batchError'
> & {
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

/** Normalize configured file count. Metadata only; no upload authority. */
export function getEffectiveAttachmentFileLimit(
    configuredLimit: number | null | undefined
): number | null {
    if (configuredLimit == null) return null;
    if (!Number.isFinite(configuredLimit)) return 0;
    return Math.max(0, Math.floor(configuredLimit));
}

/** Normalize the configured MiB limit; null means unlimited and zero denies positive sizes. */
export function getEffectiveAttachmentSizeLimit(
    configuredLimit: number | null | undefined
): number | null {
    if (configuredLimit == null || configuredLimit === 0) return null;
    if (!Number.isFinite(configuredLimit) || configuredLimit < 0) return 0;
    return configuredLimit;
}

export type AttachmentRowPolicyInput = {
    /** Native URLs in original order, never display-proxy aliases. */
    urls: readonly string[];
    /** Missing means no authoritative baseline; it is not an empty baseline. */
    persistedUrls?: readonly string[];
    readOnly: boolean;
    addOnly: boolean;
    showExistingValues: boolean;
    hidePersistedValues: boolean;
};
export type AttachmentRowPolicy =
    | { status: 'unavailable'; reason: 'missing-persisted-baseline' }
    | {
          status: 'ready';
          rows: readonly {
              nativeIndex: number;
              persisted: boolean;
              visible: boolean;
              removeAllowed: boolean;
          }[];
      };

/** Native row admission only. No metadata, upload authority, writer or cleanup. */
export function getAttachmentRowPolicy(
    input: AttachmentRowPolicyInput
): AttachmentRowPolicy {
    const validUrls = (value: readonly string[]) =>
        Array.isArray(value) &&
        Array.from(value).every((url) => typeof url === 'string' && url !== '');
    if (
        !validUrls(input.urls) ||
        (input.persistedUrls !== undefined &&
            !validUrls(input.persistedUrls)) ||
        [
            input.readOnly,
            input.addOnly,
            input.showExistingValues,
            input.hidePersistedValues,
        ].some((flag) => typeof flag !== 'boolean')
    )
        throw new TypeError('Attachment row policy is malformed.');
    const addOnly = !input.readOnly && input.addOnly;
    if (addOnly && input.persistedUrls === undefined)
        return { status: 'unavailable', reason: 'missing-persisted-baseline' };
    const persisted = new Set(input.persistedUrls ?? []);
    return {
        status: 'ready',
        rows: input.urls.map((url, nativeIndex) => {
            const stored = addOnly && persisted.has(url);
            return {
                nativeIndex,
                persisted: stored,
                visible:
                    !stored ||
                    (input.showExistingValues && !input.hidePersistedValues),
                removeAllowed: !input.readOnly && !stored,
            };
        }),
    };
}

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
    const hasPersistedEntry =
        addOnly &&
        baseline !== undefined &&
        Object.hasOwn(baseline, input.fieldId);
    const persistedValue = hasPersistedEntry ? baseline[input.fieldId] : [];
    if (hasPersistedEntry && !Array.isArray(persistedValue))
        throw new TypeError(
            'A present persisted attachment baseline must be an array.'
        );
    const persistedUrls = new Set(
        attachments(persistedValue).map((entry) => entry.url)
    );
    const maxFiles = getEffectiveAttachmentFileLimit(config?.allowedFiles);
    const sizeLimit = getEffectiveAttachmentSizeLimit(config?.sizeLimit);
    const maxFileBytes = sizeLimit == null ? null : sizeLimit * 1048576;
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
        rows: (() => {
            const policy = getAttachmentRowPolicy({
                urls: values.map((value) => value.url),
                persistedUrls: [...persistedUrls],
                readOnly,
                addOnly,
                showExistingValues:
                    config?.showExistingValuesForAddOnlyMode === true,
                hidePersistedValues: input.hidePersistedAddOnlyValues === true,
            });
            if (policy.status !== 'ready')
                throw new Error('Unavailable attachment baseline.');
            return policy.rows.map((row) => ({
                ...row,
                attachment: values[row.nativeIndex]!,
            }));
        })(),
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

/** Declared MIME classification only; no file-byte, folder, readability or authorization guarantee. */
export function isAttachmentTypeAllowed(
    group: AttachmentTypeGroup,
    rawType: string
): boolean {
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

function validateAttachmentFiles(
    files: readonly AttachmentFileDescriptor[]
): void {
    if (
        !Array.isArray(files) ||
        Array.from(files).some(
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
}

function checkValidatedAttachmentFileMetadata(
    input: AttachmentFileMetadataInput
): AttachmentFileMetadataCheck {
    const acceptedIndexes: number[] = [];
    const rejected: { index: number; reason: 'type' | 'size' }[] = [];
    input.files.forEach((file, index) => {
        if (
            input.allowedTypes !== null &&
            !input.allowedTypes.some((group) =>
                isAttachmentTypeAllowed(group, file.type)
            )
        )
            rejected.push({ index, reason: 'type' });
        else if (input.maxFileBytes !== null && file.size > input.maxFileBytes)
            rejected.push({ index, reason: 'size' });
        else acceptedIndexes.push(index);
    });
    // Use the whole native array, not visible rows or clamped remainingSlots.
    // Existing-over-cap plus even an empty valid batch remains a count error.
    const overflow =
        input.maxFiles !== null &&
        input.currentCount + acceptedIndexes.length > input.maxFiles;
    return {
        acceptedIndexes: overflow ? [] : acceptedIndexes,
        rejected,
        batchError: overflow ? 'count' : null,
    };
}

/**
 * Metadata only: no folder/readability check, permissions, upload allocation or writes.
 * Callers retain asynchronous validation, owner retirement and producer capability checks.
 */
export function checkAttachmentFileMetadata(
    input: AttachmentFileMetadataInput
): AttachmentFileMetadataCheck {
    validateAttachmentFiles(input.files);
    if (
        !Number.isSafeInteger(input.currentCount) ||
        input.currentCount < 0 ||
        (input.maxFiles !== null &&
            (!Number.isInteger(input.maxFiles) || input.maxFiles < 0)) ||
        (input.maxFileBytes !== null &&
            (typeof input.maxFileBytes !== 'number' ||
                Number.isNaN(input.maxFileBytes) ||
                input.maxFileBytes < 0)) ||
        (input.allowedTypes !== null &&
            (!Array.isArray(input.allowedTypes) ||
                input.allowedTypes.some((group) => !typeGroups.has(group))))
    )
        throw new TypeError('Expected normalized attachment metadata limits.');
    return checkValidatedAttachmentFileMetadata(input);
}

/** Metadata-only batch check. Pending upload cancellation is caller-owned. */
export function checkFormAttachmentFiles(
    input: FormAttachmentPolicyInput & {
        files: readonly AttachmentFileDescriptor[];
    }
): FormAttachmentFileCheck {
    validateAttachmentFiles(input.files);
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
    return checkValidatedAttachmentFileMetadata({
        files: input.files,
        currentCount: policy.rows.length,
        ...policy.upload,
    });
}
