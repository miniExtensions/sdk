import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
    ImageAnnotationField,
    type ImageAnnotationFieldProps,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-image-annotation.css';

/** The application supplies genuine native authority, storage and append ports. */
export function mountImageAnnotation<Upload>(
    element: HTMLElement,
    ports: ImageAnnotationFieldProps<Upload>
) {
    const root = createRoot(element);
    root.render(createElement(ImageAnnotationField<Upload>, ports));
    return () => root.unmount();
}
