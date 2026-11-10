/**
 * Mechanical presentation/lifecycle port of the native host component:
 * components/reusables/TruncatedDescription.tsx (native source, not SDK main).
 * Native source SHA256:
 * ad923a89ca1cca159bf1712c05eb4a2c81535f90f941a614bfe58df73369b538
 *
 * Deliberate substitutions: JSX -> createElement, host localization -> caller
 * labels with exact native English defaults, and scoped presentation classes.
 * The renderer owns sanitization; this disclosure adds no sanitizer lifecycle.
 * Native state/reset, measurement, observers, image/window listeners and exact
 * interactive-attribute restoration are retained. No forwarded ref is added.
 *
 * Chevron SVG paths/default attributes are copied from installed lucide-react
 * 0.417.0: dist/esm/icons/chevron-down.js, chevron-up.js, defaultAttributes.js,
 * createLucideIcon.js and Icon.js. Only the fixed native usages are reproduced;
 * no icon dependency or generalized icon API is introduced.
 *
 * ISC License
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part
 * of Feather (MIT). All other copyright (c) for Lucide are held by Lucide
 * Contributors 2022.
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
import {
    createElement,
    type ReactElement,
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
} from 'react';
import { CompleteQuillHTMLRenderer } from './CompleteQuillHTMLRenderer.js';

export interface CompleteTruncatedDescriptionProps {
    html: string;
    /** Native placement: forwarded to the inner Quill renderer only. */
    className?: string;
    resetKey?: string;
    readMoreLabel?: string;
    showLessLabel?: string;
}

function ChevronDown(): ReactElement {
    return createElement(
        'svg',
        {
            xmlns: 'http://www.w3.org/2000/svg',
            width: 24,
            height: 24,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            className:
                'lucide lucide-chevron-down ml-1 h-4 w-4 mx-sdk-description__chevron',
            'aria-hidden': 'true',
        },
        createElement('path', { d: 'm6 9 6 6 6-6', key: 'qrunsl' })
    );
}

function ChevronUp(): ReactElement {
    return createElement(
        'svg',
        {
            xmlns: 'http://www.w3.org/2000/svg',
            width: 24,
            height: 24,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            className:
                'lucide lucide-chevron-up ml-1 h-4 w-4 mx-sdk-description__chevron',
            'aria-hidden': 'true',
        },
        createElement('path', { d: 'm18 15-6-6-6 6', key: '153udz' })
    );
}

type InteractiveAttributes = {
    ariaHidden: string | null;
    tabIndex: string | null;
};

const interactiveSelector =
    'a[href], button, input, select, textarea, [tabindex]';

export function CompleteTruncatedDescription({
    html,
    className = '',
    readMoreLabel = 'Read more',
    showLessLabel = 'Show less',
    resetKey = '',
}: CompleteTruncatedDescriptionProps): ReactElement {
    const [isExpanded, setIsExpanded] = useState(false);
    const [isOverflowing, setIsOverflowing] = useState(true);
    const viewportRef = useRef<HTMLDivElement>(null);
    const viewportId = useId();
    const clippedInteractiveAttributes = useRef(
        new Map<HTMLElement, InteractiveAttributes>()
    );
    const contentIdentity = `${resetKey}\u0000${html}`;
    const [renderedContentIdentity, setRenderedContentIdentity] =
        useState(contentIdentity);

    if (renderedContentIdentity !== contentIdentity) {
        setRenderedContentIdentity(contentIdentity);
        setIsExpanded(false);
        setIsOverflowing(true);
    }

    const measureOverflow = useCallback(() => {
        if (isExpanded) return;

        const viewport = viewportRef.current;
        if (viewport == null) return;

        const { clientHeight, scrollHeight } = viewport;
        if (clientHeight === 0 && scrollHeight === 0) return;

        setIsOverflowing(scrollHeight > clientHeight);
    }, [isExpanded]);

    const restoreInteractiveElement = useCallback((element: HTMLElement) => {
        const attributes = clippedInteractiveAttributes.current.get(element);
        if (attributes == null) return;

        if (attributes.tabIndex == null) {
            element.removeAttribute('tabindex');
        } else {
            element.setAttribute('tabindex', attributes.tabIndex);
        }
        if (attributes.ariaHidden == null) {
            element.removeAttribute('aria-hidden');
        } else {
            element.setAttribute('aria-hidden', attributes.ariaHidden);
        }
        clippedInteractiveAttributes.current.delete(element);
    }, []);

    const restoreAllInteractiveElements = useCallback(() => {
        for (const element of clippedInteractiveAttributes.current.keys()) {
            restoreInteractiveElement(element);
        }
    }, [restoreInteractiveElement]);

    const synchronizeClippedInteractiveElements = useCallback(() => {
        const viewport = viewportRef.current;
        if (viewport == null) return;

        if (isExpanded) {
            restoreAllInteractiveElements();
            return;
        }

        const viewportBounds = viewport.getBoundingClientRect();
        if (viewportBounds.height === 0) return;

        const interactiveElements = Array.from(
            viewport.querySelectorAll<HTMLElement>(interactiveSelector)
        );
        const currentElements = new Set(interactiveElements);
        for (const trackedElement of clippedInteractiveAttributes.current.keys()) {
            if (!currentElements.has(trackedElement)) {
                clippedInteractiveAttributes.current.delete(trackedElement);
            }
        }

        for (const element of interactiveElements) {
            const elementBounds = element.getBoundingClientRect();
            const isClipped = elementBounds.bottom > viewportBounds.bottom;
            if (!isClipped) {
                restoreInteractiveElement(element);
                continue;
            }

            if (!clippedInteractiveAttributes.current.has(element)) {
                clippedInteractiveAttributes.current.set(element, {
                    ariaHidden: element.getAttribute('aria-hidden'),
                    tabIndex: element.getAttribute('tabindex'),
                });
            }
            element.setAttribute('tabindex', '-1');
            element.setAttribute('aria-hidden', 'true');
        }
    }, [isExpanded, restoreAllInteractiveElements, restoreInteractiveElement]);

    useEffect(() => {
        const synchronizeLayout = () => {
            measureOverflow();
            synchronizeClippedInteractiveElements();
        };

        synchronizeLayout();

        const viewport = viewportRef.current;
        if (viewport == null) return;

        const resizeObserver =
            typeof ResizeObserver === 'undefined'
                ? null
                : new ResizeObserver(synchronizeLayout);
        const images = Array.from(
            viewport.querySelectorAll<HTMLImageElement>('img')
        );
        resizeObserver?.observe(viewport);
        window.addEventListener('resize', synchronizeLayout);
        for (const image of images) {
            image.addEventListener('load', synchronizeLayout);
            image.addEventListener('error', synchronizeLayout);
        }

        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener('resize', synchronizeLayout);
            for (const image of images) {
                image.removeEventListener('load', synchronizeLayout);
                image.removeEventListener('error', synchronizeLayout);
            }
            restoreAllInteractiveElements();
        };
    }, [
        contentIdentity,
        measureOverflow,
        restoreAllInteractiveElements,
        synchronizeClippedInteractiveElements,
    ]);

    return createElement(
        'div',
        { className: 'relative mx-sdk-description' },
        createElement(
            'div',
            {
                id: viewportId,
                ref: viewportRef,
                className: 'mx-sdk-description__viewport',
                style: {
                    maxHeight: isExpanded ? 'none' : '4.5rem',
                    overflow: 'hidden',
                },
            },
            createElement(CompleteQuillHTMLRenderer, { html, className })
        ),
        isOverflowing
            ? createElement(
                  'button',
                  {
                      'aria-controls': viewportId,
                      'aria-expanded': isExpanded,
                      onClick: () => setIsExpanded(!isExpanded),
                      className:
                          'mt-2 flex items-center font-medium text-blue-600 hover:text-blue-800 mx-sdk-description__toggle',
                      type: 'button',
                  },
                  isExpanded ? showLessLabel : readMoreLabel,
                  createElement(isExpanded ? ChevronUp : ChevronDown)
              )
            : null
    );
}
