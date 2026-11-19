import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    type ReactElement,
} from 'react';
import {
    CompletePhoneNumberField,
    type CompletePhoneNumberFieldProps,
} from './CompletePhoneNumberField.js';
import { CompleteReadOnlyPhoneNumberField } from './CompleteReadOnlyPhoneNumberField.js';
import { PortalGridCellShell } from './PortalGridCellShell.js';
import type { ReadonlyPortalGridRowHeight } from './ReadonlyPortalGrid.js';

type DeferredPhoneProps = Extract<
    CompletePhoneNumberFieldProps,
    { commit: 'deferred' }
>;

export type PortalGridPhoneNumberCellEditor = Readonly<
    Omit<DeferredPhoneProps, 'commit' | 'value' | 'disabled' | 'readOnly'>
>;

export type PortalGridPhoneNumberCellProps = Readonly<{
    value: string | null;
    displayText: string;
    title: string;
    cellIdentity: unknown;
    selected: boolean;
    onSelect(): void;
    /** Supply the host's admitted editor even while the cell is unselected. */
    editor?: PortalGridPhoneNumberCellEditor;
    rowHeight: ReadonlyPortalGridRowHeight;
    firstRow?: boolean;
    lastRow?: boolean;
    stickyLeft?: number;
    copyDisabled?: boolean;
}>;

/** A Phone cell with host-owned selection, admission and persistence. */
export function PortalGridPhoneNumberCell({
    value,
    displayText,
    title,
    cellIdentity,
    selected,
    onSelect,
    editor,
    rowHeight,
    firstRow,
    lastRow,
    stickyLeft,
    copyDisabled,
}: PortalGridPhoneNumberCellProps): ReactElement {
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
        className: 'mx-sdk-portal-grid-phone-number-cell',
        children: editing
            ? h(CompletePhoneNumberField, {
                  ...editor,
                  commit: 'deferred',
                  value,
                  input: {
                      ...editor.input,
                      'aria-label': editor.input?.['aria-label'] ?? title,
                  },
                  owner: {
                      token: generation,
                      isCurrent: () =>
                          committed.current === generation &&
                          editor.owner.isCurrent() === true &&
                          committed.current === generation,
                  },
              })
            : value == null || displayText === '' || value === ''
              ? h('span', { className: 'read-only-text' })
              : h(CompleteReadOnlyPhoneNumberField, {
                    value,
                    emptyLabel: '',
                    linkClassName:
                        'read-only-text text-blue-600 hover:text-blue-700',
                }),
    });
}
