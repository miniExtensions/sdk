import { createElement as h, type ReactElement } from 'react';

export type AttachmentUploadProgressLabels = Readonly<{
    uploading: string;
    cancel: string;
}>;

export type AttachmentUploadProgressProps = Readonly<{
    /** The percentage already calculated by the upload owner. */
    percentage: number;
    labels: AttachmentUploadProgressLabels;
    /** An explicit intent. The host owns confirmation and cancellation. */
    onCancel: () => void;
}>;

/** Controlled upload presentation. Import attachment-upload-progress.css for stock styles. */
export function AttachmentUploadProgress({
    percentage,
    labels,
    onCancel,
}: AttachmentUploadProgressProps): ReactElement {
    const value = Number.isFinite(percentage)
        ? Math.min(100, Math.max(0, percentage))
        : 0;
    const display = `${value}%`;
    return h(
        'div',
        { className: 'mx-sdk-attachment-upload-progress' },
        h(
            'div',
            { className: 'mx-sdk-attachment-upload-progress__body' },
            h('h3', null, labels.uploading),
            h('p', { 'aria-hidden': true }, display),
            h('progress', {
                'aria-label': labels.uploading,
                max: 100,
                value,
            })
        ),
        h(
            'div',
            { className: 'mx-sdk-attachment-upload-progress__actions' },
            h('button', { type: 'button', onClick: onCancel }, labels.cancel)
        )
    );
}
