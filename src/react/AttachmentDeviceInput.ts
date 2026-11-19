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
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.5,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
            },
            h('path', {
                d: 'M13.5 3H6a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V9l-6-6Z',
            }),
            h('path', { d: 'M13.5 3v6h6M12 11.5v6m-3-3h6' })
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
