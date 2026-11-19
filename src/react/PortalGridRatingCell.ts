import {
    createElement as h,
    useMemo,
    useState,
    type ReactElement,
} from 'react';
import {
    ControlledRatingField,
    type ControlledRatingFieldProps,
} from './ControlledRatingField.js';
import { PortalGridCellShell } from './PortalGridCellShell.js';
import type { ReadonlyPortalGridRowHeight } from './ReadonlyPortalGrid.js';

export type PortalGridRatingCellEditor = Readonly<
    Pick<
        ControlledRatingFieldProps,
        'onChange' | 'id' | 'form' | 'describedBy' | 'labelledBy' | 'invalid'
    > & { owner: NonNullable<ControlledRatingFieldProps['owner']> }
>;

export type PortalGridRatingCellProps = Readonly<
    Pick<
        ControlledRatingFieldProps,
        'value' | 'max' | 'icon' | 'color' | 'labels'
    > & {
        displayText: string;
        title: string;
        /** Presentation identity; the editor owner independently admits writes. */
        cellIdentity: unknown;
        selected: boolean;
        onSelect(): void;
        editor?: PortalGridRatingCellEditor;
        rowHeight: ReadonlyPortalGridRowHeight;
        firstRow?: boolean;
        lastRow?: boolean;
        stickyLeft?: number;
        copyDisabled?: boolean;
    }
>;

function current(owner: PortalGridRatingCellEditor['owner']): boolean {
    try {
        return owner.isCurrent() === true;
    } catch {
        return false;
    }
}

const ignoreChange = () => {};

/** A configured Rating cell; the existing controlled leaf owns all icon/key behavior. */
export function PortalGridRatingCell({
    value,
    displayText,
    title,
    max,
    icon,
    color,
    labels,
    cellIdentity,
    selected,
    onSelect,
    editor,
    rowHeight,
    firstRow,
    lastRow,
    stickyLeft,
    copyDisabled,
}: PortalGridRatingCellProps): ReactElement {
    // The host's owner may finish publishing its frame in a layout effect.
    // Read currentness at the user action rather than during render.
    const editing = selected && editor != null;
    const ownerToken = editor?.owner.token;
    const placement = useMemo(() => ({}), [cellIdentity, editing, ownerToken]);
    const [control, setControl] = useState({ placement, key: 0 });
    // A native click can finish on a reused icon after the press's owner changes.
    // Retire the control without remounting the Grid cell.
    if (control.placement !== placement)
        setControl({ placement, key: control.key + 1 });
    const blank = !editing && (value === null || displayText === '');

    return h(PortalGridCellShell, {
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
        className: 'mx-sdk-portal-grid-rating-cell',
        interactiveSelector: editing ? '.mx-sdk-rating-icon' : undefined,
        children: blank
            ? h('span', { className: 'read-only-text' })
            : h(ControlledRatingField, {
                  key: control.key,
                  ...editor,
                  mode: 'controlled',
                  value,
                  max,
                  icon,
                  color,
                  labels,
                  title,
                  showLabel: false,
                  grid: !editing,
                  disabled: !editing,
                  enableInlineEdit: editor != null,
                  owner:
                      editor == null
                          ? undefined
                          : {
                                token: editor.owner.token,
                                isCurrent: () => current(editor.owner),
                            },
                  onChange: editor?.onChange ?? ignoreChange,
              }),
    });
}
