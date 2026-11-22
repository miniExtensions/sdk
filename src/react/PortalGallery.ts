import {
    createElement as h,
    Fragment,
    lazy,
    Suspense,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
    type ReactElement,
} from 'react';
import {
    LinkedFinderCard,
    type LinkedFinderCardProjection,
} from './LinkedFinderCard.js';

const FieldTooltipPopup = lazy(() => import('./fieldTooltipPopup.js'));

export type PortalGalleryColumns = 1 | 2 | 3 | 4 | 5 | 6;

/** Presentation configuration only; this grants no record or action authority. */
export function resolvePortalGalleryColumns(
    value: unknown
): PortalGalleryColumns {
    switch (value) {
        case 1:
        case '1':
            return 1;
        case 2:
        case '2':
            return 2;
        case 3:
        case '3':
            return 3;
        case 4:
        case '4':
            return 4;
        case 5:
        case '5':
            return 5;
        case 6:
        case '6':
            return 6;
        default:
            return 5;
    }
}

export type PortalGalleryRow = Readonly<{
    key: string;
    recordId: string;
    accessibleLabel: string;
    /** Optional host automation association; no action authority. */
    testId?: string;
    projection: LinkedFinderCardProjection;
    /** An explicit current host request. Its return value is never admission. */
    open?: Readonly<{
        label: string;
        testId?: string;
        activate(): void;
        registerTrigger?(element: HTMLButtonElement): () => void;
    }> | null;
    requestUnlink?: Readonly<{
        label: string;
        description: string;
        testId?: string;
        activate(): void;
    }> | null;
    /** Only an inherited host presentation, never a review command. */
    needsReviewLabel?: string | null;
}>;

export type PortalGalleryContent =
    | Readonly<{
          status: 'rows';
          rows: readonly PortalGalleryRow[];
          emptyLabel: string | null;
      }>
    | Readonly<{ status: 'loading' | 'unavailable'; label: string }>;

export type PortalGalleryProps = Readonly<{
    label: string;
    content: PortalGalleryContent;
    columns?: PortalGalleryColumns;
    width?: 'fixed' | 'full';
    unlinkingRecordId?: string | null;
    /** Controlled visual overlay; existing rows and action registrations remain mounted. */
    reloading?: Readonly<{ label: string }> | null;
    paging?: Readonly<{
        canRequestMore: boolean;
        showSpinner: boolean;
        requestLabel: string;
        loadingLabel: string;
        requestMore(): void;
    }> | null;
    className?: string;
}>;

function GalleryUnlinkButton({
    action,
    pending,
    disabled,
}: {
    action: NonNullable<PortalGalleryRow['requestUnlink']>;
    pending: boolean;
    disabled: boolean;
}): ReactElement {
    const id = useId();
    const button = useRef<HTMLButtonElement>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined
    );
    const [open, setOpen] = useState(false);
    const [ready, setReady] = useState(false);
    const showTooltip = open && !disabled && action.description !== '';
    useEffect(() => () => clearTimeout(closeTimer.current), []);
    useEffect(() => {
        if (disabled) setOpen(false);
    }, [disabled]);

    function show() {
        clearTimeout(closeTimer.current);
        setOpen(!disabled && action.description !== '');
    }
    function hide() {
        clearTimeout(closeTimer.current);
        setOpen(false);
    }
    function leave() {
        clearTimeout(closeTimer.current);
        if (button.current?.ownerDocument.activeElement !== button.current) {
            // Keep the description reachable across the gap to its portal.
            closeTimer.current = setTimeout(hide, 150);
        }
    }

    return h(
        Fragment,
        null,
        h(
            'button',
            {
                ref: button,
                type: 'button',
                className: 'mx-sdk-portal-gallery-unlink',
                'aria-label': action.label,
                'aria-describedby': showTooltip && ready ? id : undefined,
                'data-testid': action.testId,
                'aria-busy': pending,
                disabled,
                onMouseEnter: show,
                onMouseLeave: leave,
                onFocus: show,
                onBlur: hide,
                onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
                    if (event.key !== 'Escape' || !showTooltip) return;
                    event.preventDefault();
                    event.stopPropagation();
                    hide();
                },
                onClick: () => {
                    hide();
                    action.activate();
                },
            },
            pending
                ? h(
                      'svg',
                      {
                          className: 'mx-sdk-portal-gallery-unlink-spinner',
                          viewBox: '0 0 24 24',
                          fill: 'none',
                          'aria-hidden': true,
                      },
                      h('circle', {
                          cx: 12,
                          cy: 12,
                          r: 10,
                          stroke: 'currentColor',
                          strokeWidth: 4,
                          opacity: 0.25,
                      }),
                      h('path', {
                          fill: 'currentColor',
                          opacity: 0.75,
                          d: 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z',
                      })
                  )
                : h(
                      'svg',
                      {
                          viewBox: '0 0 24 24',
                          fill: 'currentColor',
                          'aria-hidden': true,
                      },
                      h('path', {
                          fillRule: 'evenodd',
                          clipRule: 'evenodd',
                          d: 'M4.25 12a.75.75 0 0 1 .75-.75h14a.75.75 0 0 1 0 1.5H5a.75.75 0 0 1-.75-.75Z',
                      })
                  )
        ),
        showTooltip
            ? h(
                  Suspense,
                  { fallback: null },
                  h(
                      FieldTooltipPopup,
                      {
                          id,
                          anchorRef: button,
                          onReadyChange: setReady,
                          onOpenChange: setOpen,
                          onMouseEnter: show,
                          onMouseLeave: leave,
                          keepOpenOnAnchorInteraction: true,
                          className: 'mx-sdk-portal-gallery-unlink-tooltip',
                      },
                      action.description
                  )
              )
            : null
    );
}

function GalleryRow({
    row,
    unlinkingRecordId,
}: {
    row: PortalGalleryRow;
    unlinkingRecordId: string | null;
}): ReactElement {
    const register = row.open?.registerTrigger;
    const activateOpen = row.open?.activate;
    const openRef = useMemo(() => {
        let generation = 0;
        let cleanup: (() => void) | undefined;
        return (element: HTMLButtonElement | null): void => {
            const expected = ++generation;
            const previous = cleanup;
            cleanup = undefined;
            previous?.();
            if (expected !== generation || !element || !register) return;
            const retire = register(element);
            // A host may synchronously replace or unmount the source during
            // registration. Dispose its returned lease without reviving it.
            if (expected !== generation) retire();
            else cleanup = retire;
        };
    }, [register]);
    const pending = unlinkingRecordId === row.recordId;
    return h(
        'li',
        {
            className: 'mx-sdk-portal-gallery-row',
            'aria-label': row.accessibleLabel,
            'data-record-id': row.recordId,
            'data-testid': row.testId,
        },
        h(
            'div',
            { className: 'mx-sdk-portal-gallery-card-content' },
            h(LinkedFinderCard, { projection: row.projection })
        ),
        row.open
            ? h('button', {
                  type: 'button',
                  ref: openRef,
                  className: 'mx-sdk-portal-gallery-open',
                  'aria-label': row.open.label,
                  'data-testid': row.open.testId,
                  onClick: () => {
                      activateOpen?.();
                  },
              })
            : null,
        row.needsReviewLabel != null
            ? h('span', {
                  className: 'mx-sdk-portal-gallery-review',
                  role: 'img',
                  'aria-label': row.needsReviewLabel,
              })
            : null,
        row.requestUnlink
            ? h(GalleryUnlinkButton, {
                  action: row.requestUnlink,
                  pending,
                  disabled: unlinkingRecordId !== null,
              })
            : null
    );
}

/** Complete controlled Gallery; native hosts retain reads and mutation lifetimes. */
export function PortalGallery(props: PortalGalleryProps): ReactElement {
    const columns = resolvePortalGalleryColumns(props.columns);
    const classes = [
        'mx-sdk-portal-gallery',
        props.width === 'fixed' ? 'mx-sdk-portal-gallery-fixed' : '',
        props.className ?? '',
    ]
        .filter(Boolean)
        .join(' ');
    const content = props.content;
    if (content.status !== 'rows')
        return h(
            'div',
            {
                className: classes,
                role: content.status === 'loading' ? 'status' : 'alert',
                'aria-label': props.label,
            },
            content.label
        );
    const paging = props.paging;
    const requestMore = paging?.requestMore;
    return h(
        'div',
        {
            className: classes,
            'aria-busy': props.reloading != null,
        },
        h(
            'ul',
            {
                className: 'mx-sdk-portal-gallery-grid',
                'aria-label': props.label,
                style: { '--mx-sdk-gallery-columns': columns } as CSSProperties,
            },
            content.rows.map((row) =>
                h(GalleryRow, {
                    key: row.key,
                    row,
                    unlinkingRecordId: props.unlinkingRecordId ?? null,
                })
            ),
            content.rows.length === 0 && content.emptyLabel !== null
                ? h(
                      'li',
                      { className: 'mx-sdk-portal-gallery-empty' },
                      content.emptyLabel
                  )
                : null,
            paging && (paging.canRequestMore || paging.showSpinner)
                ? h(
                      'li',
                      { className: 'mx-sdk-portal-gallery-paging' },
                      paging.canRequestMore
                          ? h(
                                'button',
                                {
                                    type: 'button',
                                    className:
                                        'mx-sdk-portal-gallery-load-more',
                                    onClick: () => {
                                        requestMore?.();
                                    },
                                },
                                paging.requestLabel
                            )
                          : h(
                                'span',
                                {
                                    role: 'status',
                                    'aria-label': paging.loadingLabel,
                                },
                                h('span', {
                                    className: 'mx-sdk-portal-gallery-spinner',
                                    'aria-hidden': true,
                                })
                            )
                  )
                : null
        ),
        props.reloading
            ? h(
                  'div',
                  {
                      className: 'mx-sdk-portal-gallery-reloading',
                      role: 'status',
                      'aria-label': props.reloading.label,
                  },
                  h('span', {
                      className: 'mx-sdk-portal-gallery-spinner',
                      'aria-hidden': true,
                  })
              )
            : null
    );
}
