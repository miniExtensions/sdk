import { Options as LinkifyOptions, tokenize } from 'linkifyjs';
import { createElement as h, type ReactElement } from 'react';
import {
    AttachmentDeviceInput,
    type AttachmentDeviceInputProps,
} from './AttachmentDeviceInput.js';
import {
    AttachmentGallery,
    type AttachmentGalleryProps,
} from './attachment-slider.js';
import {
    AttachmentUploadDialog,
    type AttachmentUploadDialogProps,
} from './AttachmentUploadDialog.js';
import {
    AttachmentUrlInput,
    type AttachmentUrlInputProps,
} from './AttachmentUrlInput.js';
import {
    ImageAnnotationField,
    type ImageAnnotationFieldProps,
} from './CompleteImageAnnotationField.js';
import { SignatureField, type SignatureFieldProps } from './SignatureField.js';

export type AttachmentFieldInput<Upload> =
    | { kind: 'device'; props: AttachmentDeviceInputProps }
    | { kind: 'url'; props: AttachmentUrlInputProps }
    | { kind: 'signature'; props: SignatureFieldProps }
    | { kind: 'annotation'; props: ImageAnnotationFieldProps<Upload> };

type AttachmentFieldError = {
    message: string;
    help?: {
        label: string;
        disabled?: boolean;
        onClick(): void;
    };
};

export type AttachmentFieldProps<Upload = unknown> = {
    input?: AttachmentFieldInput<Upload>;
    gallery: AttachmentGalleryProps;
    upload?: AttachmentUploadDialogProps;
    error?: AttachmentFieldError;
    /** Host-localized message for a read-only field without accepted rows. */
    emptyLabel?: string;
};

const linkOptions = new LinkifyOptions({
    target: '_blank',
    format: (value: string, type: string) =>
        type === 'url' ? 'Learn more' : value,
});

function StatusIcon({ kind }: { kind: 'error' | 'empty' }) {
    return h(
        'svg',
        {
            xmlns: 'http://www.w3.org/2000/svg',
            viewBox: '0 0 24 24',
            fill: 'currentColor',
            'aria-hidden': true,
            'data-slot': 'icon',
        },
        h('path', {
            fillRule: 'evenodd',
            clipRule: 'evenodd',
            d:
                kind === 'error'
                    ? 'M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z'
                    : 'm6.72 5.66 11.62 11.62A8.25 8.25 0 0 0 6.72 5.66Zm10.56 12.68L5.66 6.72a8.25 8.25 0 0 0 11.62 11.62ZM5.105 5.106c3.807-3.808 9.98-3.808 13.788 0 3.808 3.807 3.808 9.98 0 13.788-3.807 3.808-9.98 3.808-13.788 0-3.808-3.807-3.808-9.98 0-13.788Z',
        })
    );
}

function FieldError({ message, help }: AttachmentFieldError) {
    return h(
        'div',
        {
            className: 'mx-sdk-attachment-field__error',
            role: 'alert',
            'data-testid': 'alert-test-id',
        },
        h(StatusIcon, { kind: 'error' }),
        h(
            'div',
            { className: 'mx-sdk-attachment-field__error-body' },
            h(
                'p',
                { className: 'linkify', 'aria-label': 'error-message' },
                tokenize(message).map((token, index) => {
                    if (!token.isLink || !linkOptions.check(token))
                        return token.toString();
                    const link = linkOptions.resolve(token);
                    return h(
                        'a',
                        {
                            key: index,
                            href: link.formattedHref,
                            target: link.target || undefined,
                            rel: link.rel || undefined,
                        },
                        link.formatted
                    );
                })
            ),
            help &&
                h(
                    'button',
                    {
                        type: 'button',
                        className: 'mx-sdk-attachment-field__help',
                        disabled: help.disabled,
                        onClick: help.onClick,
                    },
                    help.label
                )
        )
    );
}

function renderInput<Upload>(input: AttachmentFieldInput<Upload>) {
    switch (input.kind) {
        case 'device':
            return h(AttachmentDeviceInput, input.props);
        case 'url':
            return h(AttachmentUrlInput, input.props);
        case 'signature':
            return h(SignatureField, input.props);
        case 'annotation':
            return h(ImageAnnotationField<Upload>, input.props);
    }
}

/** The Form and Portal attachment presentation with host-admitted actions. */
export function AttachmentField<Upload>({
    input,
    gallery,
    upload,
    error,
    emptyLabel,
}: AttachmentFieldProps<Upload>): ReactElement {
    return h(
        'div',
        { className: 'mx-sdk-attachment-field' },
        input && renderInput(input),
        upload && h(AttachmentUploadDialog, upload),
        error && h(FieldError, error),
        h(AttachmentGallery, gallery),
        emptyLabel !== undefined &&
            gallery.rows.length === 0 &&
            h(
                'p',
                {
                    className: 'mx-sdk-attachment-field__empty',
                    'data-testid': 'no-value-test-id',
                },
                h(StatusIcon, { kind: 'empty' }),
                emptyLabel
            )
    );
}
