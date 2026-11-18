import { createElement as h, type ReactElement } from 'react';
import type { RuntimeLanguage } from '../runtime/types.js';
import type { ReadonlyPortalGridRowHeight } from './ReadonlyPortalGrid.js';
import { PortalGridCellGuidance } from './PortalGridCellGuidance.js';
import { PortalGridCellShell } from './PortalGridCellShell.js';
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
    /** Localized explanation for a selected cell whose host withheld editing. */
    readOnlyGuidance?: Readonly<{ label: string; text: string }>;
    rowHeight: ReadonlyPortalGridRowHeight;
    firstRow?: boolean;
    lastRow?: boolean;
    stickyLeft?: number;
    copyDisabled?: boolean;
}>;

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
    readOnlyGuidance,
    rowHeight,
    firstRow,
    lastRow,
    stickyLeft,
    copyDisabled,
}: PortalGridSingleLineTextCellProps): ReactElement {
    const editing = selected && editor != null;
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
        guidance:
            selected && editor == null && readOnlyGuidance != null
                ? h(PortalGridCellGuidance, readOnlyGuidance)
                : undefined,
        children: editing
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
                }),
    });
}
