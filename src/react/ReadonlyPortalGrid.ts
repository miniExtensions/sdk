import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import { CompleteFormFieldPresentation } from './CompleteFormFieldPresentation.js';

export type ReadonlyPortalGridHeaderIcon =
    | 'text'
    | 'multiline-text'
    | 'number'
    | 'checkbox'
    | 'formula'
    | 'date'
    | 'select'
    | 'attachment'
    | 'link'
    | 'other';

export type ReadonlyPortalGridColumn = {
    readonly fieldId: string;
    readonly title: string;
    /** Already-admitted Quill HTML and image metadata, independent of row values. */
    readonly description?: string | null;
    readonly descriptionImageUrl?: string | null;
    readonly icon?: ReadonlyPortalGridHeaderIcon | null;
};

/** Cells are the already-rendered SDK field nodes from AirtableGrid's snapshot. */
export type ReadonlyPortalGridRow = {
    readonly recordId: string;
    readonly label?: string | null;
    readonly cells: readonly {
        readonly fieldId: string;
        readonly node: ReactNode;
    }[];
};

export type ReadonlyPortalGridRowHeight =
    | 'short'
    | 'medium'
    | 'tall'
    | 'extra-tall'
    | 'fit-content';

export type ReadonlyPortalGridLabels = {
    readonly caption: string;
    readonly hideColumns: string;
    readonly close: string;
    readonly recordColumn: string;
    readonly openRecord: string;
    readonly empty: string;
    readonly notReady: string;
    readonly resizeColumn: (title: string) => string;
};

export type ReadonlyPortalGridProps = {
    readonly columns: readonly ReadonlyPortalGridColumn[];
    readonly rows: readonly ReadonlyPortalGridRow[];
    readonly primaryFieldId: string | null;
    readonly revision: number;
    /** An opaque presentation identity, never a client or authorization receipt. */
    readonly preferenceScopeKey: string | null;
    readonly ready: boolean;
    readonly isCurrent: () => boolean;
    readonly hiddenColumns: Readonly<Record<string, unknown>>;
    readonly columnWidths: Readonly<Record<string, unknown>>;
    readonly allowHideColumns?: boolean;
    readonly onFieldHiddenChange?: (change: {
        readonly fieldId: string;
        readonly isHidden: boolean;
    }) => void;
    /** Host persists the measured width under its existing scoped preference key. */
    readonly onColumnWidthCommit?: (change: {
        readonly fieldId: string;
        readonly width: number;
    }) => void;
    /** The existing child owner admits and executes this intent; no success is inferred. */
    readonly onOpenRecord?: (
        recordId: string,
        trigger: HTMLButtonElement
    ) => void;
    readonly doNotAllowUserToCopyTextOnGrid?: boolean | null;
    readonly rowHeight?: ReadonlyPortalGridRowHeight;
    /** Host-owned preview fact; affects image-failure presentation only. */
    readonly preview?: boolean;
    readonly labels?: Partial<ReadonlyPortalGridLabels>;
    readonly className?: string;
};

const defaultLabels: ReadonlyPortalGridLabels = {
    caption: 'Records',
    hideColumns: 'Hide columns',
    close: 'Close',
    recordColumn: 'Record',
    openRecord: 'Open record',
    empty: 'No records',
    notReady: 'Grid is not ready.',
    resizeColumn: (title) => `Resize ${title}`,
};

function current(check: () => boolean): boolean {
    try {
        return check() === true;
    } catch {
        return false;
    }
}

function admittedWidth(value: unknown): number | null {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed)
        ? parsed
        : null;
}

const iconPaths: Record<ReadonlyPortalGridHeaderIcon, string> = {
    text: 'M3 12 6.5 3 10 12M4 9h5M11 6h3m-1.5 0v6',
    'multiline-text': 'M3 4h10M3 8h10M3 12h7',
    number: 'M6 2 4 14M12 2l-2 12M2 6h12M1 10h12',
    checkbox: 'M3 3h10v10H3ZM5 8l2 2 4-4',
    formula: 'M11 3H8L6 13H3M4 7h6M11 8l3 5m0-5-3 5',
    date: 'M3 4h10v9H3ZM5 2v4m6-4v4M3 7h10',
    select: 'M3 5h10M3 8h6m1 3 2 2 2-2',
    attachment: 'm6 5 4-3a3 3 0 0 1 4 4l-7 7a3 3 0 0 1-4-4l7-6',
    link: 'm6 10-1 1a3 3 0 0 1-4-4l3-3a3 3 0 0 1 4 0m2 2 1-1a3 3 0 0 1 4 4l-3 3a3 3 0 0 1-4 0M5 11l6-6',
    other: 'M3 3h10v10H3ZM6 6h4m-4 4h4',
};

function headerIcon(icon: ReadonlyPortalGridHeaderIcon | null | undefined) {
    if (icon == null) return null;
    return h(
        'svg',
        {
            className: 'mx-sdk-readonly-grid__icon',
            viewBox: '0 0 16 16',
            fill: 'none',
            'aria-hidden': true,
        },
        h('path', {
            d: iconPaths[icon] ?? iconPaths.other,
            stroke: 'currentColor',
            strokeWidth: 1.25,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
        })
    );
}

type HeaderProps = {
    column: ReadonlyPortalGridColumn;
    width: unknown;
    isCurrent: () => boolean;
    onCommit: ReadonlyPortalGridProps['onColumnWidthCommit'];
    resizeLabel: string;
    preview: boolean;
};

function GridHeader({
    column,
    width,
    isCurrent,
    onCommit,
    resizeLabel,
    preview,
}: HeaderProps) {
    const header = useRef<HTMLTableCellElement>(null);
    const stopDrag = useRef<(() => void) | null>(null);
    const keyboardMove = useRef(false);
    const commitPort = useRef(onCommit);
    const [localWidth, setLocalWidth] = useState(() => admittedWidth(width));

    useEffect(() => {
        if (stopDrag.current == null && !keyboardMove.current)
            setLocalWidth(admittedWidth(width));
    }, [width]);
    useEffect(
        () => () => {
            stopDrag.current?.();
            stopDrag.current = null;
            keyboardMove.current = false;
        },
        []
    );

    const settle = () => {
        const cell = header.current;
        const commit = commitPort.current;
        if (!commit || !cell?.isConnected || !current(isCurrent)) return;
        const measured = cell.clientWidth;
        if (!Number.isFinite(measured)) return;
        setLocalWidth(measured);
        commit({ fieldId: column.fieldId, width: measured });
    };
    const cancel = () => {
        stopDrag.current?.();
        stopDrag.current = null;
        keyboardMove.current = false;
        setLocalWidth(admittedWidth(width));
    };
    const commitEffect =
        typeof window === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        commitPort.current = onCommit;
        if (!onCommit) cancel();
    }, [onCommit]);
    const start = (event: ReactPointerEvent<HTMLSpanElement>) => {
        const cell = header.current;
        if (!onCommit || !cell || !current(isCurrent) || event.button !== 0)
            return;
        event.preventDefault();
        event.stopPropagation();
        stopDrag.current?.();
        let lastX = event.clientX;
        const pointerId = event.pointerId;
        const document = cell.ownerDocument;
        const cleanup = () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', end);
            document.removeEventListener('pointercancel', cancelled);
        };
        const move = (next: PointerEvent) => {
            if (next.pointerId !== pointerId) return;
            if (!current(isCurrent)) {
                cancel();
                return;
            }
            next.preventDefault();
            const delta = next.clientX - lastX;
            lastX = next.clientX;
            setLocalWidth((previous) => (previous ?? cell.clientWidth) + delta);
        };
        const end = (next: PointerEvent) => {
            if (next.pointerId !== pointerId) return;
            cleanup();
            stopDrag.current = null;
            if (current(isCurrent)) settle();
            else setLocalWidth(admittedWidth(width));
        };
        const cancelled = (next: PointerEvent) => {
            if (next.pointerId === pointerId) cancel();
        };
        stopDrag.current = cleanup;
        document.addEventListener('pointermove', move, { passive: false });
        document.addEventListener('pointerup', end);
        document.addEventListener('pointercancel', cancelled);
    };
    const keyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
            return;
        }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        if (!onCommit || !header.current || !current(isCurrent)) return;
        event.preventDefault();
        event.stopPropagation();
        keyboardMove.current = true;
        const measured = header.current.clientWidth;
        const delta =
            (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1);
        setLocalWidth((previous) => (previous ?? measured) + delta);
    };

    return h(
        'th',
        {
            ref: header,
            scope: 'col',
            className: 'mx-sdk-readonly-grid__header',
            style: { width: localWidth ?? 200 },
            'data-field-id': column.fieldId,
        },
        h(
            'div',
            { className: 'mx-sdk-readonly-grid__heading' },
            headerIcon(column.icon),
            h(CompleteFormFieldPresentation, {
                title: column.title,
                fieldName: column.title,
                associationKind: 'group',
                description: column.description,
                descriptionImageUrl: column.descriptionImageUrl,
                descriptionPlacement: 'tooltip',
                preview,
                previewControlProps: preview
                    ? { 'data-config-preview-canvas-control': 'true' }
                    : undefined,
                className: 'mx-sdk-readonly-grid__field-heading',
                children: () => null,
            })
        ),
        onCommit &&
            h('span', {
                className: 'mx-sdk-readonly-grid__resize',
                role: 'separator',
                tabIndex: 0,
                'aria-label': resizeLabel,
                'aria-orientation': 'vertical',
                'aria-valuenow': localWidth ?? 200,
                onPointerDown: start,
                onKeyDown: keyDown,
                onKeyUp: (event: ReactKeyboardEvent<HTMLSpanElement>) => {
                    if (
                        !keyboardMove.current ||
                        (event.key !== 'ArrowLeft' &&
                            event.key !== 'ArrowRight')
                    )
                        return;
                    event.preventDefault();
                    event.stopPropagation();
                    keyboardMove.current = false;
                    if (current(isCurrent)) settle();
                    else setLocalWidth(admittedWidth(width));
                },
                onBlur: () => {
                    if (keyboardMove.current) cancel();
                },
            })
    );
}

function ColumnVisibilityDialog(props: {
    columns: readonly ReadonlyPortalGridColumn[];
    primaryFieldId: string;
    hidden: Readonly<Record<string, unknown>>;
    isCurrent: () => boolean;
    onChange: NonNullable<ReadonlyPortalGridProps['onFieldHiddenChange']>;
    onClose: () => void;
    returnFocus: () => void;
    labels: ReadonlyPortalGridLabels;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useEffect(() => {
        const node = dialog.current;
        if (!node || !current(props.isCurrent)) return;
        node.showModal();
        return () => {
            if (node.open) node.close();
            props.returnFocus();
        };
    }, []);
    return h(
        'dialog',
        {
            ref: dialog,
            className: 'mx-sdk-readonly-grid__dialog',
            'aria-labelledby': titleId,
            onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
                event.preventDefault();
                props.onClose();
            },
        },
        h(
            'div',
            { className: 'mx-sdk-readonly-grid__dialog-heading' },
            h('h2', { id: titleId }, props.labels.hideColumns),
            h(
                'button',
                { type: 'button', onClick: props.onClose },
                props.labels.close
            )
        ),
        h(
            'ul',
            null,
            props.columns
                .filter((column) => column.fieldId !== props.primaryFieldId)
                .map((column) => {
                    const shown = props.hidden[column.fieldId] !== true;
                    return h(
                        'li',
                        { key: column.fieldId },
                        h(
                            'button',
                            {
                                type: 'button',
                                role: 'switch',
                                'aria-checked': shown,
                                'aria-label': column.title,
                                onClick: () => {
                                    if (
                                        !current(props.isCurrent) ||
                                        column.fieldId === props.primaryFieldId
                                    )
                                        return;
                                    props.onChange({
                                        fieldId: column.fieldId,
                                        isHidden: shown,
                                    });
                                },
                            },
                            h(
                                'span',
                                {
                                    className: 'mx-sdk-readonly-grid__switch',
                                    'aria-hidden': true,
                                    'data-checked': shown,
                                },
                                h('span')
                            ),
                            column.title
                        )
                    );
                })
        )
    );
}

/** Complete readonly table presentation over one host-admitted render snapshot. */
export function ReadonlyPortalGrid(props: ReadonlyPortalGridProps): ReactNode {
    const labels = { ...defaultLabels, ...props.labels };
    const captionId = useId();
    const hideButton = useRef<HTMLButtonElement>(null);
    const [visibilityDialog, setVisibilityDialog] = useState<object | null>(
        null
    );
    const identity = JSON.stringify([props.preferenceScopeKey, props.revision]);
    const ready =
        props.ready &&
        props.preferenceScopeKey != null &&
        current(props.isCurrent);
    // This fences only this presentation's controls, never the borrowed read.
    const token = useMemo(() => ({}), [identity, ready]);
    const activeToken = useRef<object | null>(token);
    useEffect(() => {
        activeToken.current = token;
        return () => {
            if (activeToken.current === token) activeToken.current = null;
        };
    }, [token]);
    const isCurrent = () =>
        ready && activeToken.current === token && current(props.isCurrent);
    const hideAllowed =
        ready &&
        props.allowHideColumns === true &&
        props.primaryFieldId != null &&
        props.onFieldHiddenChange != null;
    const closeDialog = () => {
        setVisibilityDialog(null);
    };
    if (!ready)
        return h(
            'div',
            {
                className: 'mx-sdk-readonly-grid__not-ready',
                role: 'status',
            },
            labels.notReady
        );
    const visible = props.columns.filter(
        (column) =>
            column.fieldId === props.primaryFieldId ||
            props.hiddenColumns[column.fieldId] !== true
    );
    const heights: readonly string[] = [
        'short',
        'medium',
        'tall',
        'extra-tall',
        'fit-content',
    ];
    const rowHeight = heights.includes(props.rowHeight ?? '')
        ? props.rowHeight
        : 'short';
    return h(
        'div',
        {
            className: ['mx-sdk-readonly-grid', props.className]
                .filter(Boolean)
                .join(' '),
            'data-copy-restricted':
                props.doNotAllowUserToCopyTextOnGrid === true,
        },
        hideAllowed &&
            h(
                'button',
                {
                    ref: hideButton,
                    type: 'button',
                    className: 'mx-sdk-readonly-grid__hide',
                    'aria-haspopup': 'dialog',
                    onClick: () => {
                        if (isCurrent()) setVisibilityDialog(token);
                    },
                },
                labels.hideColumns
            ),
        hideAllowed &&
            visibilityDialog === token &&
            h(ColumnVisibilityDialog, {
                key: identity,
                columns: props.columns,
                primaryFieldId: props.primaryFieldId!,
                hidden: props.hiddenColumns,
                isCurrent,
                onChange: props.onFieldHiddenChange!,
                onClose: closeDialog,
                returnFocus: () => {
                    if (isCurrent() && hideButton.current?.isConnected)
                        hideButton.current.focus();
                },
                labels,
            }),
        h(
            'div',
            { className: 'mx-sdk-readonly-grid__viewport' },
            h(
                'table',
                {
                    className: 'mx-sdk-readonly-grid__table',
                    'aria-labelledby': captionId,
                },
                h('caption', { id: captionId }, labels.caption),
                h(
                    'thead',
                    null,
                    h(
                        'tr',
                        null,
                        visible.map((column) =>
                            h(GridHeader, {
                                key: `${identity}:${column.fieldId}`,
                                column,
                                width: props.columnWidths[column.fieldId],
                                isCurrent,
                                onCommit: props.onColumnWidthCommit,
                                resizeLabel: labels.resizeColumn(column.title),
                                preview: props.preview === true,
                            })
                        ),
                        props.onOpenRecord &&
                            h('th', { scope: 'col' }, labels.recordColumn)
                    )
                ),
                h(
                    'tbody',
                    null,
                    props.rows.map((row) =>
                        h(
                            'tr',
                            {
                                key: row.recordId,
                                'data-record-id': row.recordId,
                            },
                            visible.map((column) =>
                                h(
                                    'td',
                                    {
                                        key: column.fieldId,
                                        className: 'mx-sdk-readonly-grid__cell',
                                        'data-field-id': column.fieldId,
                                        'data-primary':
                                            column.fieldId ===
                                            props.primaryFieldId,
                                    },
                                    h(
                                        'div',
                                        {
                                            className: `mx-sdk-readonly-grid__cell-content cell-${rowHeight}`,
                                        },
                                        row.cells.find(
                                            (cell) =>
                                                cell.fieldId === column.fieldId
                                        )?.node ?? null
                                    )
                                )
                            ),
                            props.onOpenRecord &&
                                h(
                                    'td',
                                    null,
                                    h(
                                        'button',
                                        {
                                            type: 'button',
                                            className:
                                                'mx-sdk-readonly-grid__open',
                                            'aria-label': [
                                                labels.openRecord,
                                                row.label,
                                            ]
                                                .filter(Boolean)
                                                .join(' '),
                                            onClick: (
                                                event: ReactMouseEvent<HTMLButtonElement>
                                            ) => {
                                                event.stopPropagation();
                                                if (isCurrent())
                                                    props.onOpenRecord?.(
                                                        row.recordId,
                                                        event.currentTarget
                                                    );
                                            },
                                        },
                                        labels.openRecord
                                    )
                                )
                        )
                    )
                )
            )
        ),
        props.rows.length === 0 &&
            h(
                'p',
                {
                    role: 'status',
                    className: 'mx-sdk-readonly-grid__empty',
                },
                labels.empty
            )
    );
}
