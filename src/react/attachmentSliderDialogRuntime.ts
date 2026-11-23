import { FocusTrap, FocusTrapFeatures, Portal } from '@headlessui/react';
import {
    createElement as h,
    Fragment,
    type MutableRefObject,
    type ReactElement,
} from 'react';

/** Client-only portal for a single attachment slider shell element. */
export function AttachmentSliderPortal({
    children,
    initialFocus,
    covered,
    focusOnMount,
}: {
    children: ReactElement;
    initialFocus: MutableRefObject<HTMLElement | null>;
    covered: boolean;
    focusOnMount: boolean;
}): ReactElement {
    let features = FocusTrapFeatures.RestoreFocus;
    if (!covered) {
        features |= FocusTrapFeatures.TabLock;
        if (focusOnMount) features |= FocusTrapFeatures.InitialFocus;
    }

    return h(
        Portal,
        null,
        h(FocusTrap, { as: Fragment, features, initialFocus }, children)
    );
}
