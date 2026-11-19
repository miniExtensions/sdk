import {
    createElement as h,
    useRef,
    useState,
    type MouseEvent,
    type ReactElement,
} from 'react';
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
    cellIdentity,
    ...frame
}: PortalGridButtonCellProps): ReactElement {
    const [control, setControl] = useState({ cellIdentity, key: 0 });
    const pressedKey = useRef<number | undefined>(undefined);
    // Retire the native press target while retaining the cell and click shield.
    if (!Object.is(control.cellIdentity, cellIdentity))
        setControl({ cellIdentity, key: control.key + 1 });

    const refuseRetiredPress = (event: MouseEvent<HTMLTableCellElement>) => {
        // Keyboard and assistive clicks have no pointer press to retire.
        if (event.detail === 0) return;
        const started = pressedKey.current;
        pressedKey.current = undefined;
        if (started !== undefined && started !== control.key) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    return h(PortalGridCellShell, {
        ...frame,
        cellIdentity,
        editing: false,
        className: 'mx-sdk-portal-grid-button-cell',
        onPointerDownCapture: (event) => {
            if (event.isPrimary) pressedKey.current = control.key;
        },
        onClickCapture: refuseRetiredPress,
        onAuxClickCapture: refuseRetiredPress,
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
                      h(ButtonField, { ...button, key: control.key })
                  ),
    });
}
