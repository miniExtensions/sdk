import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useMemo,
    type ReactElement,
} from 'react';
import type { RuntimeLanguage } from '../runtime/types.js';
import {
    CompleteMultilineTextField,
    type CompleteMultilineTextFieldProps,
} from './CompleteMultilineTextField.js';
import { CompleteReadOnlyTextField } from './CompleteReadOnlyTextField.js';
import { PortalGridCellGuidance } from './PortalGridCellGuidance.js';
import { PortalGridCellShell } from './PortalGridCellShell.js';
import type { ReadonlyPortalGridRowHeight } from './ReadonlyPortalGrid.js';

export type PortalGridMultilineTextEditor = Readonly<
    Pick<
        CompleteMultilineTextFieldProps,
        | 'id'
        | 'form'
        | 'placeholder'
        | 'characterLimit'
        | 'hasDescription'
        | 'hasErrorMessage'
        | 'onChange'
    > & {
        owner: Readonly<{
            /** Opaque identity of the host's admitted editor. */
            token: unknown;
            isCurrent(): boolean;
        }>;
    }
>;

export type PortalGridMultilineTextCellProps = Readonly<{
    value: string | null;
    displayText: string;
    language: RuntimeLanguage;
    cellIdentity: unknown;
    selected: boolean;
    onSelect(): void;
    editor?: PortalGridMultilineTextEditor;
    readOnlyGuidance?: Readonly<{ label: string; text: string }>;
    rowHeight: ReadonlyPortalGridRowHeight;
    firstRow?: boolean;
    lastRow?: boolean;
    stickyLeft?: number;
    copyDisabled?: boolean;
}>;

/** A plain multiline Grid cell with host-owned admission, selection and writes. */
export function PortalGridMultilineTextCell({
    value,
    displayText,
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
}: PortalGridMultilineTextCellProps): ReactElement {
    const editing = selected && editor != null;
    const ownerToken = editor?.owner.token;
    const admission = useMemo(
        (): { editor?: PortalGridMultilineTextEditor } => ({}),
        [cellIdentity, ownerToken, editing]
    );
    const useCommittedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommittedEffect(() => {
        admission.editor = editing ? editor : undefined;
        return () => {
            admission.editor = undefined;
        };
    }, [admission, editing, editor]);

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
        className: 'mx-sdk-portal-grid-multiline-text-cell',
        guidance:
            selected && editor == null && readOnlyGuidance != null
                ? h(PortalGridCellGuidance, {
                      ...readOnlyGuidance,
                      cellIdentity,
                  })
                : undefined,
        children: editing
            ? h(CompleteMultilineTextField, {
                  value,
                  id: editor.id,
                  form: editor.form,
                  placeholder: editor.placeholder,
                  characterLimit: editor.characterLimit,
                  hasDescription: editor.hasDescription,
                  hasErrorMessage: editor.hasErrorMessage,
                  onChange(nextValue) {
                      const current = admission.editor;
                      if (
                          current?.owner.isCurrent() === true &&
                          admission.editor === current
                      ) {
                          current.onChange(nextValue);
                      }
                  },
              })
            : displayText === ''
              ? h('span', { className: 'read-only-text' })
              : h(CompleteReadOnlyTextField, { value: displayText, language }),
    });
}
