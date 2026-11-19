import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactElement,
} from 'react';
import {
    CompleteCheckboxField,
    type CompleteCheckboxFieldProps,
} from './CompleteCheckboxField.js';
import { PortalGridCellShell } from './PortalGridCellShell.js';
import type { ReadonlyPortalGridRowHeight } from './ReadonlyPortalGrid.js';

export type PortalGridCheckboxCellEditor = Readonly<
    Pick<
        CompleteCheckboxFieldProps,
        'onChange' | 'id' | 'form' | 'ariaDescribedBy' | 'ariaInvalid'
    > & { owner: { token: unknown; isCurrent(): boolean } }
>;

export type PortalGridCheckboxCellProps = Readonly<{
    value: boolean | null;
    displayText: string;
    title: string;
    checkboxStyle?: CompleteCheckboxFieldProps['checkboxStyle'];
    checkedStateLabel?: string;
    uncheckedStateLabel?: string;
    /** Presentation identity. The editor owner independently admits writes. */
    cellIdentity: unknown;
    selected: boolean;
    onSelect(): void;
    /** A host-admitted checkbox is immediately interactive before selection. */
    editor?: PortalGridCheckboxCellEditor;
    rowHeight: ReadonlyPortalGridRowHeight;
    firstRow?: boolean;
    lastRow?: boolean;
    stickyLeft?: number;
    copyDisabled?: boolean;
}>;

/** Checkbox Grid presentation with host-owned value and writes. */
export function PortalGridCheckboxCell({
    value,
    displayText,
    title,
    checkboxStyle = 'checkbox',
    checkedStateLabel,
    uncheckedStateLabel,
    cellIdentity,
    selected,
    onSelect,
    editor,
    rowHeight,
    firstRow,
    lastRow,
    stickyLeft,
    copyDisabled,
}: PortalGridCheckboxCellProps): ReactElement {
    const editing = editor != null;
    const owner = editor?.owner.token;
    const placement = useMemo(
        () => ({}),
        [cellIdentity, checkboxStyle, editing, owner]
    );
    const [control, setControl] = useState({ placement, key: 0 });
    // Retire the native press target when the Grid slot changes owner or style.
    if (control.placement !== placement)
        setControl({ placement, key: control.key + 1 });
    const active = useRef<{
        placement: object;
        editor: PortalGridCheckboxCellEditor;
    } | null>(null);
    const useCommittedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommittedEffect(() => {
        return () => {
            if (active.current?.placement === placement) active.current = null;
        };
    }, [placement]);
    useCommittedEffect(() => {
        active.current = editor ? { placement, editor } : null;
    });

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
        className: 'mx-sdk-portal-grid-checkbox-cell',
        children: blank
            ? h('span', { className: 'read-only-text' })
            : h(
                  'div',
                  { key: control.key },
                  h(CompleteCheckboxField, {
                      value,
                      title,
                      checkboxStyle,
                      checkedStateLabel,
                      uncheckedStateLabel,
                      showTitle: false,
                      readOnly: !editing,
                      isInGrid: true,
                      isPortalScreen: true,
                      id: editor?.id,
                      form: editor?.form,
                      ariaDescribedBy: editor?.ariaDescribedBy,
                      ariaInvalid: editor?.ariaInvalid,
                      onChange: (checked) => {
                          const current = active.current;
                          if (current?.placement !== placement) return;
                          try {
                              if (current.editor.owner.isCurrent() !== true)
                                  return;
                          } catch {
                              return;
                          }
                          if (active.current === current)
                              current.editor.onChange(checked);
                      },
                  })
              ),
    });
}
