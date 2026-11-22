import { createElement as h, type ReactElement } from 'react';
import { useFileSelection } from './useFileSelection.js';

export type AttachmentDeviceInputLabels = Readonly<{
    chooseFiles: string;
    dragAndDrop: string;
}>;

export type AttachmentDeviceInputProps = Readonly<{
    id: string;
    form?: string;
    accept?: string;
    describedBy?: string;
    invalid?: boolean;
    disabled?: boolean;
    labels: AttachmentDeviceInputLabels;
    /** Receives the original Files in input order. The host owns admission and uploads. */
    onFiles(files: File[]): void;
}>;

/** Render the attachment picker and drop target in an existing host Form. */
export function AttachmentDeviceInput({
    id,
    form,
    accept,
    describedBy,
    invalid,
    disabled,
    labels,
    onFiles,
}: AttachmentDeviceInputProps): ReactElement {
    const { dropProps, inputProps, isDragActive } =
        useFileSelection<HTMLDivElement>({ onFiles, disabled });

    return h(
        'div',
        {
            ...dropProps,
            className: 'mx-sdk-attachment-device',
            'data-drag-active': isDragActive || undefined,
            'data-disabled': disabled || undefined,
        },
        h('input', {
            ...inputProps,
            className: 'mx-sdk-attachment-device__input',
            id,
            form,
            accept,
            multiple: true,
            'aria-label': labels.chooseFiles,
            'aria-describedby': describedBy,
            'aria-invalid': invalid,
        }),
        h(
            'svg',
            {
                className: 'mx-sdk-attachment-device__icon',
                'aria-hidden': true,
                viewBox: '0 0 24 24',
                fill: 'currentColor',
            },
            h('path', {
                fillRule: 'evenodd',
                clipRule: 'evenodd',
                d: 'M5.625 1.5H9a3.75 3.75 0 0 1 3.75 3.75v1.875c0 1.036.84 1.875 1.875 1.875H16.5a3.75 3.75 0 0 1 3.75 3.75v7.875c0 1.035-.84 1.875-1.875 1.875H5.625a1.875 1.875 0 0 1-1.875-1.875V3.375c0-1.036.84-1.875 1.875-1.875ZM12.75 12a.75.75 0 0 0-1.5 0v2.25H9a.75.75 0 0 0 0 1.5h2.25V18a.75.75 0 0 0 1.5 0v-2.25H15a.75.75 0 0 0 0-1.5h-2.25V12Z',
            }),
            h('path', {
                d: 'M14.25 5.25a5.23 5.23 0 0 0-1.279-3.434 9.768 9.768 0 0 1 6.963 6.963A5.23 5.23 0 0 0 16.5 7.5h-1.875a.375.375 0 0 1-.375-.375V5.25Z',
            })
        ),
        h(
            'p',
            {
                className: 'mx-sdk-attachment-device__title',
                'aria-hidden': true,
            },
            labels.chooseFiles
        ),
        h(
            'p',
            {
                className: 'mx-sdk-attachment-device__hint',
                'aria-hidden': true,
            },
            labels.dragAndDrop
        )
    );
}
