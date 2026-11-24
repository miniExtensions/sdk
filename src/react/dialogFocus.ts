import type { KeyboardEvent } from 'react';

export function isVisible(element: HTMLElement): boolean {
    return (
        element.getClientRects().length > 0 &&
        element.ownerDocument.defaultView?.getComputedStyle(element)
            .visibility === 'visible'
    );
}

export function wrapDialogTab(event: KeyboardEvent<HTMLDialogElement>) {
    const dialog = event.currentTarget;
    const stops = [
        ...dialog.querySelectorAll<HTMLElement>(
            'button,a[href],input,select,textarea,[contenteditable],[tabindex]'
        ),
    ].filter(
        (element) =>
            element.tabIndex >= 0 &&
            !element.matches(':disabled') &&
            !element.closest('[hidden],[inert]') &&
            isVisible(element)
    );
    const first = stops[0];
    const last = stops.at(-1);
    if (!first || !last) return;
    if (dialog.ownerDocument.activeElement !== (event.shiftKey ? first : last))
        return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
}
