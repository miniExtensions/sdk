import { createElement as h, type MouseEvent, type ReactElement } from 'react';
import { ButtonField, type ControlledButtonFieldProps } from './ButtonField.js';
import { PortalGridCellShell } from './PortalGridCellShell.js';
import type { ReadonlyPortalGridRowHeight } from './ReadonlyPortalGrid.js';

export type PortalGridButtonCellProps = Readonly<{
    /** The host supplies the current action and retains its settlement. */
    button: Readonly<ControlledButtonFieldProps>;
    displayText: string;
    cellIdentity: unknown;
    selected: boolean;
    onSelect(): void;
    rowHeight: ReadonlyPortalGridRowHeight;
    firstRow?: boolean;
    lastRow?: boolean;
    stickyLeft?: number;
    copyDisabled?: boolean;
}>;

function stopActionClick(event: MouseEvent<HTMLSpanElement>) {
    event.stopPropagation();
}

/** A read-only Grid value with a separate host-owned Button action. */
export function PortalGridButtonCell({
    button,
    ...frame
}: PortalGridButtonCellProps): ReactElement {
    return h(PortalGridCellShell, {
        ...frame,
        editing: false,
        className: 'mx-sdk-portal-grid-button-cell',
        children:
            button.value == null
                ? h('span', { className: 'read-only-text' })
                : h(
                      'span',
                      {
                          // A disabled Button can still receive a bubbling click
                          // from its nested label or spinner.
                          onClick: stopActionClick,
                          onAuxClick: stopActionClick,
                          onDoubleClick: stopActionClick,
                      },
                      h(ButtonField, button)
                  ),
    });
}
