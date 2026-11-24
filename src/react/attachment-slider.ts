import { createElement as h, type ReactNode } from 'react';
import {
    AttachmentGallery as Gallery,
    type AttachmentGalleryProps,
} from './AttachmentGallery.js';
import {
    renderAttachmentSlider,
    type AttachmentSliderProps,
} from './AttachmentSlider.js';
import { AttachmentSliderPortal } from './attachmentSliderDialogRuntime.js';

export type { AttachmentSliderProps } from './AttachmentSlider.js';
export type {
    AttachmentGalleryDocument,
    AttachmentGalleryProps,
    AttachmentGalleryRow,
} from './AttachmentGallery.js';

/** Attachment entry-point hosts already load the portal for the first open. */
export function AttachmentGallery(props: AttachmentGalleryProps): ReactNode {
    return h(Gallery, { ...props, portal: AttachmentSliderPortal });
}

/** Fullscreen viewer for React DOM hosts that render the portal on opening. */
export function AttachmentSlider(props: AttachmentSliderProps): ReactNode {
    return renderAttachmentSlider(props, AttachmentSliderPortal);
}
