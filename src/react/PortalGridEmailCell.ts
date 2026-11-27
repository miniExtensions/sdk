import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    type ReactElement,
} from 'react';
import type { RuntimeLanguage } from '../runtime/types.js';
import { ReadOnlyEmailTextField } from './CompleteReadOnlyTextField.js';
import {
    ControlledEmailField,
    type ControlledEmailFieldProps,
} from './ControlledEmailField.js';
import { PortalGridCellShell } from './PortalGridCellShell.js';
import type { ReadonlyPortalGridRowHeight } from './ReadonlyPortalGrid.js';

type DeferredEmailProps = Extract<
    ControlledEmailFieldProps,
    { enableInlineEdit: true }
>;

export type PortalGridEmailCellEditor = Readonly<
    Omit<
        DeferredEmailProps,
        | 'mode'
        | 'value'
        | 'language'
        | 'title'
        | 'showLabel'
        | 'enableInlineEdit'
        | 'displayOnly'
        | 'disabled'
        | 'readOnly'
    >
>;

export type PortalGridEmailCellProps = Readonly<{
    value: string | null;
    displayText: string;
    title: string;
    language: RuntimeLanguage;
    cellIdentity: unknown;
    selected: boolean;
    onSelect(): void;
    /** Supply the host's admitted editor even while the cell is unselected. */
    editor?: PortalGridEmailCellEditor;
    rowHeight: ReadonlyPortalGridRowHeight;
    firstRow?: boolean;
    lastRow?: boolean;
    stickyLeft?: number;
    copyDisabled?: boolean;
}>;

/** An Email cell with host-owned selection, authority and persistence. */
export function PortalGridEmailCell({
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
}: PortalGridEmailCellProps): ReactElement {
    const ownerToken = editor?.owner.token;
    const hasEditor = editor != null;
    const generation = useMemo(
        () => ({}),
        [cellIdentity, ownerToken, hasEditor]
    );
    const committed = useRef(generation);
    const useCommittedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommittedEffect(() => {
        committed.current = generation;
    }, [generation]);

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
        className: 'mx-sdk-portal-grid-email-cell',
        children: editing
            ? h(ControlledEmailField, {
                  ...editor,
                  mode: 'controlled',
                  enableInlineEdit: true,
                  value,
                  title,
                  showLabel: false,
                  language,
                  // Deselection leaves a current writer available to settle on
                  // unmount. A different cell or admission retires its draft.
                  owner: {
                      token: generation,
                      isCurrent: () =>
                          committed.current === generation &&
                          editor.owner.isCurrent() === true &&
                          committed.current === generation,
                  },
              })
            : displayText === ''
              ? h('span', { className: 'read-only-text' })
              : h(ReadOnlyEmailTextField, {
                    value: displayText,
                    language,
                }),
    });
}
