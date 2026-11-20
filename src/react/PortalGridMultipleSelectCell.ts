import { createElement as h, useState, type ReactElement } from 'react';
import {
    ControlledMultipleSelectsField,
    type ControlledMultipleSelectsFieldProps,
} from './ControlledSelectField.js';
import { PortalGridCellGuidance } from './PortalGridCellGuidance.js';
import { PortalGridCellShell } from './PortalGridCellShell.js';
import type { PortalGridSingleSelectCellProps } from './PortalGridSingleSelectCell.js';

export type PortalGridMultipleSelectCellEditor = Readonly<
    Pick<
        ControlledMultipleSelectsFieldProps,
        | 'availableChoices'
        | 'onValueChange'
        | 'inputId'
        | 'formId'
        | 'describedBy'
        | 'invalid'
        | 'maxSelections'
    > & {
        owner: Readonly<
            Pick<
                ControlledMultipleSelectsFieldProps['owner'],
                'token' | 'isCurrent'
            >
        >;
        presentation?: ControlledMultipleSelectsFieldProps['presentation'];
    }
>;

export type PortalGridMultipleSelectCellProps = Readonly<
    Omit<PortalGridSingleSelectCellProps, 'value' | 'editor'> & {
        value: readonly string[];
        editor?: PortalGridMultipleSelectCellEditor;
    }
>;

const readonlyOwner = { token: null, isCurrent: () => false };
const ignoreChange = () => {};

function isCurrent(
    owner: PortalGridMultipleSelectCellEditor['owner']
): boolean {
    try {
        return owner.isCurrent() === true;
    } catch {
        return false;
    }
}

/** A physical Grid cell with host-owned selection and ordered canonical values. */
export function PortalGridMultipleSelectCell({
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
}: PortalGridMultipleSelectCellProps): ReactElement {
    const activeEditor = selected ? editor : undefined;
    const ownerToken = activeEditor?.owner.token;
    const presentation = activeEditor?.presentation ?? 'dropdown';
    const [picker, setPicker] = useState({
        cellIdentity,
        ownerToken,
        presentation,
        key: 0,
    });
    // A recycled cell cannot reuse an earlier row or owner's press targets.
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
        className: 'mx-sdk-portal-grid-multiple-select-cell',
        guidance:
            selected && editor == null && readOnlyGuidance != null
                ? h(PortalGridCellGuidance, {
                      ...readOnlyGuidance,
                      cellIdentity,
                  })
                : undefined,
        children: activeEditor
            ? h(ControlledMultipleSelectsField, {
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
                  maxSelections: activeEditor.maxSelections,
              })
            : value.length === 0 || displayText === ''
              ? h('span', { className: 'read-only-text' })
              : h(ControlledMultipleSelectsField, {
                    ...field,
                    key: 'readonly',
                    presentation: 'dropdown',
                    availableChoices: [],
                    owner: readonlyOwner,
                    onValueChange: ignoreChange,
                    readOnly: true,
                }),
    });
}
