import type { ReactNode } from 'react';
import {
    renderAttachmentSlider,
    type AttachmentSliderProps,
} from './AttachmentSlider.js';
import { AttachmentSliderPortal } from './attachmentSliderDialogRuntime.js';

export type { AttachmentSliderProps } from './AttachmentSlider.js';
export {
    AttachmentGallery,
    type AttachmentGalleryDocument,
    type AttachmentGalleryProps,
    type AttachmentGalleryRow,
} from './AttachmentGallery.js';

/** Fullscreen viewer for React DOM hosts that render the portal on opening. */
export function AttachmentSlider(props: AttachmentSliderProps): ReactNode {
    return renderAttachmentSlider(props, AttachmentSliderPortal);
}
