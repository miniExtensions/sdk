import { createElement as h, useState, type ReactElement } from 'react';
import {
    ControlledSingleSelectField,
    type ControlledSingleSelectFieldProps,
} from './ControlledSelectField.js';
import { PortalGridCellGuidance } from './PortalGridCellGuidance.js';
import { PortalGridCellShell } from './PortalGridCellShell.js';
import type { ReadonlyPortalGridRowHeight } from './ReadonlyPortalGrid.js';

export type PortalGridSingleSelectCellEditor = Readonly<
    Pick<
        ControlledSingleSelectFieldProps,
        | 'availableChoices'
        | 'onValueChange'
        | 'inputId'
        | 'formId'
        | 'describedBy'
        | 'invalid'
    > & {
        owner: Readonly<
            Pick<
                ControlledSingleSelectFieldProps['owner'],
                'token' | 'isCurrent'
            >
        >;
        presentation?: ControlledSingleSelectFieldProps['presentation'];
    }
>;

export type PortalGridSingleSelectCellProps = Readonly<
    Pick<ControlledSingleSelectFieldProps, 'value' | 'choices' | 'labels'> & {
        displayText: string;
        title: string;
        /** Identity of the rendered cell. The editor owner separately admits writes. */
        cellIdentity: unknown;
        selected: boolean;
        onSelect(): void;
        editor?: PortalGridSingleSelectCellEditor;
        readOnlyGuidance?: Readonly<{ label: string; text: string }>;
        rowHeight: ReadonlyPortalGridRowHeight;
        firstRow?: boolean;
        lastRow?: boolean;
        stickyLeft?: number;
        copyDisabled?: boolean;
    }
>;

const readonlyOwner = { token: null, isCurrent: () => false };
const ignoreChange = () => {};
const noAvailableChoices: ControlledSingleSelectFieldProps['availableChoices'] =
    [];

function isCurrent(owner: PortalGridSingleSelectCellEditor['owner']): boolean {
    try {
        return owner.isCurrent() === true;
    } catch {
        return false;
    }
}

/** A physical Grid cell with host-owned selection, canonical values and writes. */
export function PortalGridSingleSelectCell({
    value,
    choices,
    labels,
    title,
    displayText,
    cellIdentity,
    selected,
    onSelect,
    editor,
    readOnlyGuidance,
    rowHeight,
    firstRow,
    lastRow,
    stickyLeft,
    copyDisabled,
}: PortalGridSingleSelectCellProps): ReactElement {
    const activeEditor = selected ? editor : undefined;
    const ownerToken = activeEditor?.owner.token;
    const presentation = activeEditor?.presentation ?? 'dropdown';
    const [picker, setPicker] = useState({
        cellIdentity,
        ownerToken,
        presentation,
        key: 0,
    });
    // Retire the picker and its press targets when the table reuses the cell.
    if (
        !Object.is(picker.cellIdentity, cellIdentity) ||
        !Object.is(picker.ownerToken, ownerToken) ||
        picker.presentation !== presentation
    )
        setPicker({
            cellIdentity,
            ownerToken,
            presentation,
            key: picker.key + 1,
        });

    const field = { value, choices, labels, ariaLabel: title, isInGrid: true };
    return h(PortalGridCellShell, {
        displayText,
        cellIdentity,
        selected,
        onSelect,
        rowHeight,
        firstRow,
        lastRow,
        stickyLeft,
        copyDisabled,
        editing: activeEditor != null,
        className: 'mx-sdk-portal-grid-single-select-cell',
        guidance:
            selected && editor == null && readOnlyGuidance != null
                ? h(PortalGridCellGuidance, {
                      ...readOnlyGuidance,
                      cellIdentity,
                  })
                : undefined,
        children: activeEditor
            ? h(ControlledSingleSelectField, {
                  ...field,
                  key: picker.key,
                  presentation,
                  availableChoices: activeEditor.availableChoices,
                  owner: {
                      token: ownerToken,
                      isCurrent: () => isCurrent(activeEditor.owner),
                  },
                  onValueChange: activeEditor.onValueChange,
                  inputId: activeEditor.inputId,
                  formId: activeEditor.formId,
                  describedBy: activeEditor.describedBy,
                  invalid: activeEditor.invalid,
              })
            : !value || displayText === ''
              ? h('span', { className: 'read-only-text' })
              : h(ControlledSingleSelectField, {
                    ...field,
                    key: 'readonly',
                    presentation: 'dropdown',
                    availableChoices: noAvailableChoices,
                    owner: readonlyOwner,
                    onValueChange: ignoreChange,
                    readOnly: true,
                }),
    });
}
