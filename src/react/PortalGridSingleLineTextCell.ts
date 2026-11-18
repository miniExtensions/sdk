import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useRef,
    type ClipboardEvent,
    type CSSProperties,
    type MouseEvent,
    type ReactElement,
} from 'react';
import type { RuntimeLanguage } from '../runtime/types.js';
import type { ReadonlyPortalGridRowHeight } from './ReadonlyPortalGrid.js';
import {
    SingleLineTextField,
    type ControlledSingleLineTextFieldProps,
} from './SingleLineTextField.js';

type InlineSingleLineTextProps = Extract<
    ControlledSingleLineTextFieldProps,
    { enableInlineEdit: true }
>;

export type PortalGridSingleLineTextEditor = Readonly<
    Pick<
        InlineSingleLineTextProps,
        | 'owner'
        | 'onChange'
        | 'id'
        | 'form'
        | 'placeholder'
        | 'characterLimit'
        | 'initialMobile'
        | 'clearLabel'
        | 'describedBy'
        | 'labelledBy'
        | 'invalid'
    >
>;

export type PortalGridSingleLineTextCellProps = Readonly<{
    value: string | null;
    displayText: string;
    title: string;
    language: RuntimeLanguage;
    /** Presentation identity. The editor's owner independently controls writes. */
    cellIdentity: unknown;
    selected: boolean;
    onSelect(): void;
    /** Supply the host's admitted editor and canonical writer. */
    editor?: PortalGridSingleLineTextEditor;
    rowHeight: ReadonlyPortalGridRowHeight;
    firstRow?: boolean;
    lastRow?: boolean;
    stickyLeft?: number;
    copyDisabled?: boolean;
}>;

const interactiveTarget =
    'a, button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="textbox"]';

/** A plain-text Grid cell with host-owned selection, edit admission and writes. */
export function PortalGridSingleLineTextCell({
    value,
    displayText,
    title,
    language,
    cellIdentity,
    selected,
    onSelect,
    editor,
    rowHeight,
    firstRow,
    lastRow,
    stickyLeft,
    copyDisabled,
}: PortalGridSingleLineTextCellProps): ReactElement {
    const cell = useRef<HTMLTableCellElement>(null);
    const commitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        const node = cell.current;
        if (node && node.ownerDocument.activeElement === node) node.blur();
    }, [cellIdentity]);

    const editing = selected && editor != null;
    return h(
        'td',
        {
            ref: cell,
            tabIndex: -1,
            className: 'mx-sdk-portal-grid-text-cell',
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
                if (
                    Element &&
                    event.target instanceof Element &&
                    !event.target.closest(interactiveTarget) &&
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
            editing
                ? h(SingleLineTextField, {
                      // Deselecting a current editor leaves its cleanup writer
                      // attached to the original leaf until that leaf unmounts.
                      key: 'editor',
                      ...editor,
                      mode: 'controlled',
                      enableInlineEdit: true,
                      value,
                      title,
                      showLabel: false,
                      language,
                  })
                : displayText === ''
                  ? h('span', { className: 'read-only-text' })
                  : h(SingleLineTextField, {
                        key: 'display',
                        mode: 'readOnly',
                        value: displayText,
                        language,
                    })
        ),
        selected && !editing
            ? h('span', {
                  'aria-hidden': true,
                  className: 'mx-sdk-portal-grid-text-cell__selection',
              })
            : null
    );
}
