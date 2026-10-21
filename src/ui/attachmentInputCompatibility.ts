/** Syntactic HTTP(S) input compatibility, not upload authorization or signing. */
export const isAttachmentUploadUrlCompatible = (value: string): boolean => {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
};

/** Preserve the hosted path fallback and single decode; invalid URLs throw. */
export const getAttachmentFilenameFromUrl = (value: string): string => {
    const url = new URL(value);
    const encodedFilename = url.pathname.endsWith('/')
        ? ''
        : (url.pathname.split('/').pop() ?? '');
    if (encodedFilename === '') return url.hostname;
    try {
        return decodeURIComponent(encodedFilename) || url.hostname;
    } catch {
        return encodedFilename;
    }
};

export const getUploadProgressWeight = (fileSize: number): number =>
    Math.max(fileSize, 1);

export type AttachmentUploadProgressInput = {
    completedUploadWeight: number;
    currentFileUploadedWeight: number;
    currentFileTotalWeight: number;
    totalUploadWeight: number;
};

/** Existing ordered-batch progress arithmetic; the host owns upload state. */
export const getAggregateUploadProgress = (
    args: AttachmentUploadProgressInput
): number => {
    if (args.totalUploadWeight <= 0) return 100;
    const currentFileUploadedWeight = Math.min(
        Math.max(args.currentFileUploadedWeight, 0),
        Math.max(args.currentFileTotalWeight, 0)
    );
    const totalUploadedWeight = Math.min(
        Math.max(args.completedUploadWeight, 0) + currentFileUploadedWeight,
        args.totalUploadWeight
    );
    return Math.min(
        Math.max(
            Math.round((totalUploadedWeight / args.totalUploadWeight) * 100),
            0
        ),
        100
    );
};
