export type OrderedAttachmentUpload<T> = {
    file: File;
    index: number;
    attachment: T;
};
export type OrderedAttachmentUploadOptions<T> = {
    /** Host-admitted batch; original File references and occurrence order are retained. */
    files: readonly File[];
    /** Existing batch cancellation decision, checked only before a next allocation. */
    shouldContinue(): boolean;
    /** Host-owned validation, transport/fallback and original returned value. */
    upload(file: File, index: number): Promise<T>;
};

/** Serial iteration only. Prefix recovery, progress and canonical writes stay hosted. */
export async function* iterateOrderedAttachmentUploads<T>(
    options: OrderedAttachmentUploadOptions<T>
): AsyncGenerator<OrderedAttachmentUpload<T>, void, unknown> {
    const { files } = options;
    for (let index = 0; index < files.length; index++) {
        if (!options.shouldContinue()) return;
        const file = files[index];
        const attachment = await options.upload(file, index);
        // An allocated completion is delivered even when cancellation changes
        // during its await. The next iteration owns the next admission check.
        yield { file, index, attachment };
    }
}
