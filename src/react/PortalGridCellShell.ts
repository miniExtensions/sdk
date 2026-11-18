import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useRef,
    type ClipboardEvent,
    type CSSProperties,
    type MouseEvent,
    type ReactElement,
    type ReactNode,
} from 'react';
import type { ReadonlyPortalGridRowHeight } from './ReadonlyPortalGrid.js';

type PortalGridCellShellProps = Readonly<{
    displayText: string;
    cellIdentity: unknown;
    selected: boolean;
    editing: boolean;
    onSelect(): void;
    rowHeight: ReadonlyPortalGridRowHeight;
    firstRow?: boolean;
    lastRow?: boolean;
    stickyLeft?: number;
    copyDisabled?: boolean;
    className?: string;
    /** Additional leaf controls that retain their own focus. */
    interactiveSelector?: string;
    children: ReactNode;
}>;

const interactiveTarget =
    'a, button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="textbox"]';

/** Internal shared presentation. Field leaves retain their own edit lifecycle. */
export function PortalGridCellShell({
    displayText,
    cellIdentity,
    selected,
    editing,
    onSelect,
    rowHeight,
    firstRow,
    lastRow,
    stickyLeft,
    copyDisabled,
    className,
    interactiveSelector,
    children,
}: PortalGridCellShellProps): ReactElement {
    const cell = useRef<HTMLTableCellElement>(null);
    const commitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        const node = cell.current;
        if (node && node.ownerDocument.activeElement === node) node.blur();
    }, [cellIdentity]);

    return h(
        'td',
        {
            ref: cell,
            tabIndex: -1,
            className: className
                ? `mx-sdk-portal-grid-cell ${className}`
                : 'mx-sdk-portal-grid-text-cell',
            'data-editing': editing,
            'data-first-row': firstRow,
            'data-last-row': lastRow,
            'data-sticky': stickyLeft != null,
            style:
                stickyLeft == null
                    ? undefined
                    : ({
                          '--mx-sdk-grid-text-left': `${stickyLeft}px`,
                      } as CSSProperties),
            onClick(event: MouseEvent<HTMLTableCellElement>) {
                const document = event.currentTarget.ownerDocument;
                const Element = document.defaultView?.Element;
                const selector = interactiveSelector
                    ? `${interactiveTarget}, ${interactiveSelector}`
                    : interactiveTarget;
                if (
                    Element &&
                    event.target instanceof Element &&
                    !event.target.closest(selector) &&
                    !document.getSelection()?.toString()
                ) {
                    event.currentTarget.focus({ preventScroll: true });
                }
                onSelect();
            },
            onCopy(event: ClipboardEvent<HTMLTableCellElement>) {
                const node = event.currentTarget;
                if (
                    event.defaultPrevented ||
                    copyDisabled ||
                    !selected ||
                    node.ownerDocument.activeElement !== node ||
                    node.ownerDocument.getSelection()?.toString()
                )
                    return;
                const literals = node.querySelectorAll('.read-only-text');
                if (literals.length !== 1) return;
                const text = literals[0].textContent;
                if (text == null) return;
                event.clipboardData.setData('text/plain', text);
                event.preventDefault();
            },
        },
        h(
            'div',
            {
                title: displayText,
                className: 'mx-sdk-portal-grid-text-cell__content',
                'data-row-height': editing ? 'fit-content' : rowHeight,
            },
            children
        ),
        selected && !editing
            ? h('span', {
                  'aria-hidden': true,
                  className: 'mx-sdk-portal-grid-text-cell__selection',
              })
            : null
    );
}
