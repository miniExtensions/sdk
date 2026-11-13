/** Explicit media input, separate from the label-only attachment field facet. */
export type AttachmentPreviewSource = {
    readonly url: string;
    readonly filename?: string | null;
    readonly type?: string | null;
    readonly thumbnails?: {
        readonly full?: { readonly url: string } | null;
    } | null;
};

/** Native preview inference is intentionally narrower than upload admission. */
export function isAttachmentPreviewImage(attachment: AttachmentPreviewSource) {
    if (attachment.type != null) return /^image\//.test(attachment.type);
    return /\.(?:png|jpg|gif|bmp|jpeg)(?:[?#]|$)/.test(
        (attachment.filename ?? attachment.url).toLowerCase()
    );
}

export function classifyAttachmentPreview(attachment: AttachmentPreviewSource) {
    const { type, url } = attachment;
    return {
        isImage: isAttachmentPreviewImage(attachment),
        isHEIC:
            type === 'image/heic' ||
            type === 'image/heif' ||
            url.toLowerCase().endsWith('.heic') ||
            url.toLowerCase().endsWith('.heif'),
        isVideo: type != null && /^video\//.test(type),
        isAudio: type != null && /^audio\//.test(type),
        isWordDocument:
            type != null &&
            /^application\/vnd.openxmlformats-officedocument.wordprocessingml.document$/.test(
                type
            ),
        isPdf:
            (type != null && /^application\/pdf$/.test(type)) ||
            url.endsWith('.pdf'),
    };
}
