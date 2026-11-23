import { createElement, useCallback, useRef, type ReactElement } from 'react';
import { ActionButton } from './ActionButton.js';

export type AttachmentTileOpenButtonProps = {
    /** Identity of the underlying resource, independent of display metadata. */
    resourceKey: string;
    label: string;
    onOpen: () => void;
};

/** Non-submit Open action for an attachment tile whose resource can change. */
export function AttachmentTileOpenButton({
    resourceKey,
    label,
    onOpen,
}: AttachmentTileOpenButtonProps): ReactElement {
    const button = useRef<HTMLButtonElement | null>(null);
    const restoreFocus = useRef(false);
    const attachButton = useCallback((node: HTMLButtonElement | null) => {
        const previous = button.current;
        if (node == null) {
            restoreFocus.current =
                previous != null &&
                previous.ownerDocument.activeElement === previous;
        } else {
            if (
                restoreFocus.current &&
                node.ownerDocument.activeElement === node.ownerDocument.body
            ) {
                node.focus({ preventScroll: true });
            }
            restoreFocus.current = false;
        }
        button.current = node;
    }, []);

    return createElement(
        ActionButton,
        {
            // A held click or key press belongs to the previous button.
            key: resourceKey,
            ref: attachButton,
            onClick: onOpen,
            onKeyDown: (event) => {
                // Repeated Space can reach the newly focused button.
                if (event.key === ' ' && event.repeat) event.preventDefault();
            },
            'aria-label': label,
            className: 'mx-sdk-attachment-tile__open',
        },
        createElement(
            'span',
            { className: 'mx-sdk-attachment-tile__open-label' },
            'Open attachment'
        )
    );
}
