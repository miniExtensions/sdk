import {
    createElement as h,
    type KeyboardEvent,
    type ReactElement,
    type ReactNode,
} from 'react';
import { ActionButton } from './ActionButton.js';

export type AttachmentSliderNavigationProps = {
    /** Ordered, host-granted occurrences. Equal filenames remain distinct. */
    rows: readonly { filename?: string | null }[];
    /** Nonempty host identity, stable across row and selection changes. Null retires it. */
    collectionOwner: string | null;
    selectedIndex: number;
    labels: {
        navigation: string;
        previous: string;
        next: string;
    };
    /** A selection intent. The host accepts and owns the resulting selection. */
    onSelect(index: number): void;
    /** The host supplies the current preview, such as an AttachmentPreview. */
    children?: ReactNode;
};

export function AttachmentSliderNavigation({
    rows,
    collectionOwner,
    selectedIndex,
    labels,
    onSelect,
    children,
}: AttachmentSliderNavigationProps): ReactElement | null {
    if (typeof collectionOwner !== 'string' || collectionOwner.length === 0)
        return null;
    const current =
        Number.isInteger(selectedIndex) &&
        selectedIndex >= 0 &&
        selectedIndex < rows.length
            ? rows[selectedIndex]
            : undefined;
    if (!current) return null;

    const canSelect = (index: number) =>
        index >= 0 && index < rows.length && rows[index] != null;
    const move = (step: -1 | 1) => {
        const next = selectedIndex + step;
        if (canSelect(next)) onSelect(next);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (
            event.target !== event.currentTarget ||
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
        )
            return;
        event.preventDefault();
        event.stopPropagation();
        move(event.key === 'ArrowLeft' ? -1 : 1);
    };

    return h(
        'div',
        {
            role: 'group',
            'aria-label': labels.navigation,
            tabIndex: 0,
            onKeyDown,
        },
        h('p', { 'aria-live': 'polite' }, current.filename),
        h(
            'div',
            null,
            h(
                ActionButton,
                {
                    // Native pointer and Space activation belong to the mounted button.
                    key: `previous:${collectionOwner}`,
                    'aria-label': labels.previous,
                    'aria-disabled': !canSelect(selectedIndex - 1),
                    onClick: () => move(-1),
                    onKeyDown,
                },
                labels.previous
            ),
            children,
            h(
                ActionButton,
                {
                    key: `next:${collectionOwner}`,
                    'aria-label': labels.next,
                    'aria-disabled': !canSelect(selectedIndex + 1),
                    onClick: () => move(1),
                    onKeyDown,
                },
                labels.next
            )
        )
    );
}
