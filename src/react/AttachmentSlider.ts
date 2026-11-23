import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type MouseEvent,
    type ReactNode,
} from 'react';
import {
    AttachmentSliderActions,
    type AttachmentSliderActionsProps,
} from './AttachmentSliderActions.js';
import {
    AttachmentSliderBody,
    type AttachmentSliderBodyProps,
} from './AttachmentSliderBody.js';
import { ActionButton } from './ActionButton.js';
import { getThemePortalProps, useThemeSnapshot } from './ThemeBoundary.js';

export type AttachmentSliderProps = Omit<
    AttachmentSliderBodyProps,
    'thumbnailRailRef' | 'labels' | 'covered'
> &
    Pick<
        AttachmentSliderActionsProps,
        | 'downloadIdentity'
        | 'canDownload'
        | 'canOpen'
        | 'onDelete'
        | 'readDownload'
        | 'onDownloadError'
    > & {
        labels: AttachmentSliderBodyProps['labels'] &
            AttachmentSliderActionsProps['labels'] & { close: string };
        onDismiss(): void;
        /** A separately managed confirmation currently owns the dialog stack. */
        covered?: boolean;
        /** Mirrors the host's docked support panel at desktop widths. */
        intercomOpen?: boolean;
    };

const slider = 'mx-sdk-attachment-slider';
type SliderPortal =
    (typeof import('./attachmentSliderDialogRuntime.js'))['AttachmentSliderPortal'];
const focusEpochs = new WeakMap<Document, number>();
const scrollLocks = new WeakMap<Document, { users: number; restore(): void }>();
const useCommitEffect =
    typeof window === 'undefined' ? useEffect : useLayoutEffect;

function useSliderReturnFocus() {
    const opener = useRef<HTMLElement | null>();
    const scope = useRef<{ owner: Document; epoch: number }>();
    useCommitEffect(() => {
        const owner = document;
        if (opener.current === undefined) {
            const active = owner.activeElement;
            opener.current = active instanceof HTMLElement ? active : null;
        }
        const epoch = (focusEpochs.get(owner) ?? 0) + 1;
        focusEpochs.set(owner, epoch);
        scope.current = { owner, epoch };
    }, []);
    useEffect(() => {
        const current = scope.current;
        if (current == null) return;
        return () => {
            // Wait for Headless UI's cleanup before restoring the opener
            // captured before the private portal module loaded.
            queueMicrotask(() =>
                queueMicrotask(() => {
                    const target = opener.current;
                    const { owner, epoch } = current;
                    const active = owner.activeElement;
                    if (
                        scope.current !== current ||
                        focusEpochs.get(owner) !== epoch ||
                        !target?.isConnected ||
                        target === owner.body ||
                        target.matches(':disabled') ||
                        target.closest('[inert], [hidden]') ||
                        (active &&
                            active !== owner.body &&
                            active !== owner.documentElement &&
                            active.isConnected)
                    )
                        return;
                    target.focus({ preventScroll: true });
                })
            );
        };
    }, []);
}

function startDocumentScrollLock(owner: Document, view: Window) {
    const root = owner.documentElement;
    const original = new Map<string, { value: string; priority: string }>();
    const set = (property: string, value: string) => {
        original.set(property, {
            value: root.style.getPropertyValue(property),
            priority: root.style.getPropertyPriority(property),
        });
        root.style.setProperty(property, value);
    };
    const gap = view.innerWidth - root.clientWidth;
    set('overflow', 'hidden');
    if (gap > 0)
        set(
            'padding-right',
            `${gap - (root.clientWidth - root.offsetWidth)}px`
        );
    const { platform, maxTouchPoints } = view.navigator;
    const fixScroll =
        /iPhone/i.test(platform) ||
        (/Mac/i.test(platform) && maxTouchPoints > 0);
    const scrollY = view.scrollY;
    if (fixScroll) {
        set('position', 'fixed');
        set('margin-top', `-${scrollY}px`);
        set('width', '100%');
    }
    return () => {
        for (const [property, { value, priority }] of original)
            root.style.setProperty(property, value, priority);
        if (fixScroll) view.scrollTo(0, scrollY);
    };
}

function lockDocumentScroll(owner: Document, view: Window) {
    const lock = scrollLocks.get(owner) ?? {
        users: 0,
        restore: startDocumentScrollLock(owner, view),
    };
    scrollLocks.set(owner, lock);
    lock.users++;
    return () => {
        lock.users--;
        if (lock.users === 0) {
            scrollLocks.delete(owner);
            lock.restore();
        }
    };
}

function hasOpenTooltip(dialog: HTMLElement) {
    const document = dialog.ownerDocument;
    return [...dialog.querySelectorAll('[aria-describedby]')].some(
        (control) => {
            const id = control.getAttribute('aria-describedby');
            return (
                id != null &&
                document.getElementById(id)?.getAttribute('role') === 'tooltip'
            );
        }
    );
}

function FullscreenAttachmentSlider({
    portal: suppliedPortal,
    ...props
}: AttachmentSliderProps & { portal?: SliderPortal }) {
    const { labels, covered = false, onDismiss } = props;
    const [runtime, setRuntime] =
        useState<typeof import('./attachmentSliderDialogRuntime.js')>();
    const [failure, setFailure] = useState<{ error: unknown }>();
    const [dialog, setDialog] = useState<HTMLDivElement | null>(null);
    const rail = useRef<HTMLDivElement | null>(null);
    const titleId = useId();
    const activated = useRef(false);
    const resumed = useRef(false);
    const theme = getThemePortalProps(useThemeSnapshot());
    useSliderReturnFocus();

    useEffect(() => {
        if (suppliedPortal) return;
        let current = true;
        void import('./attachmentSliderDialogRuntime.js').then(
            (loaded) => {
                if (current) setRuntime(loaded);
            },
            (error: unknown) => {
                if (current) setFailure({ error });
            }
        );
        return () => {
            current = false;
        };
    }, [suppliedPortal]);

    useCommitEffect(() => {
        if (!dialog) return;
        if (!covered) activated.current = true;
        else if (activated.current) resumed.current = true;
    }, [dialog, covered]);

    useCommitEffect(() => {
        const document = dialog?.ownerDocument;
        const view = document?.defaultView;
        if (!dialog || !document || !view || covered) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (
                event.key !== 'Escape' ||
                event.defaultPrevented ||
                [...document.querySelectorAll(`.${slider}[role="dialog"]`)].at(
                    -1
                ) !== dialog ||
                hasOpenTooltip(dialog)
            )
                return;
            // Capture before the older native parent dialog's window listener.
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!event.repeat) onDismiss();
        };
        view.addEventListener('keydown', onKeyDown, true);
        return () => view.removeEventListener('keydown', onKeyDown, true);
    }, [dialog, covered, onDismiss]);

    useEffect(() => {
        const owner = dialog?.ownerDocument;
        const view = owner?.defaultView;
        // Release the viewer's lock when a native confirmation takes over.
        // The older dialog and its cleanup use passive effects in the same root.
        if (covered || !owner || !view) return;
        return lockDocumentScroll(owner, view);
    }, [dialog, covered]);

    const Portal = suppliedPortal ?? runtime?.AttachmentSliderPortal;
    if (failure && !Portal) throw failure.error;
    if (!Portal) return null;

    const dismiss = () => {
        if (!covered) onDismiss();
    };
    const closeButton = {
        className: `${slider}__close`,
        onClick: dismiss,
        'data-testid': 'close-dialog',
    };
    const onOutsideClick = (event: MouseEvent<HTMLDivElement>) => {
        const target = event.target;
        if (
            target === event.currentTarget ||
            (target instanceof Element &&
                (target.classList.contains(`${slider}__viewport`) ||
                    target.classList.contains(`${slider}__backdrop`)))
        )
            dismiss();
    };
    const children = h(
        'div',
        {
            ref: setDialog,
            className: props.intercomOpen
                ? `${slider} ${slider}--intercom`
                : slider,
            role: 'dialog',
            'aria-labelledby': titleId,
            'aria-modal': covered ? undefined : true,
            onClick: onOutsideClick,
        },
        h(
            'div',
            {
                ...theme,
                className: theme.className
                    ? `${slider}__viewport ${theme.className}`
                    : `${slider}__viewport`,
            },
            h('div', {
                className: `${slider}__backdrop`,
                'data-testid': 'dialog-overlay-test-id',
                'aria-hidden': true,
            }),
            h(
                'div',
                {
                    className: `${slider}__panel`,
                    'data-testid': 'dialog-test-id',
                },
                h(
                    'div',
                    { className: `${slider}__header` },
                    h(
                        'h2',
                        { id: titleId, className: `${slider}__title` },
                        h(AttachmentSliderActions, {
                            attachment: props.rows[props.currentIndex],
                            downloadIdentity: props.downloadIdentity,
                            labels,
                            onDelete:
                                props.onDelete == null
                                    ? undefined
                                    : () => {
                                          if (!covered) props.onDelete?.();
                                      },
                            tooltipsSuspended: covered,
                            canDownload: props.canDownload,
                            canOpen: props.canOpen,
                            presentationOwner: props.presentationOwner,
                            readDownload: props.readDownload,
                            onDownloadError: props.onDownloadError,
                        })
                    )
                ),
                h(
                    'div',
                    { className: `${slider}__body` },
                    h(AttachmentSliderBody, {
                        rows: props.rows,
                        currentIndex: props.currentIndex,
                        setCurrentIndex: props.setCurrentIndex,
                        presentationOwner: props.presentationOwner,
                        navigationOwner: props.navigationOwner,
                        labels,
                        thumbnailRailRef: rail,
                        covered,
                    })
                ),
                h(
                    'div',
                    { className: `${slider}__close-container` },
                    h(
                        ActionButton,
                        closeButton,
                        h(
                            'span',
                            {
                                className:
                                    'mx-sdk-attachment-slider-actions__label',
                            },
                            labels.close
                        ),
                        h(
                            'svg',
                            {
                                viewBox: '0 0 24 24',
                                fill: 'currentColor',
                                'aria-hidden': true,
                                className: `${slider}__close-icon`,
                            },
                            h('path', {
                                fillRule: 'evenodd',
                                clipRule: 'evenodd',
                                d: 'M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z',
                            })
                        )
                    )
                )
            )
        )
    );
    return h(Portal, {
        children,
        initialFocus: rail,
        covered,
        focusOnMount: !resumed.current,
    });
}

/** Fullscreen viewer for the current host-admitted attachment collection. */
export function AttachmentSlider(props: AttachmentSliderProps): ReactNode {
    return renderAttachmentSlider(props);
}

export function renderAttachmentSlider(
    props: AttachmentSliderProps,
    portal?: SliderPortal
): ReactNode {
    return props.rows[props.currentIndex] == null
        ? null
        : h(FullscreenAttachmentSlider, { ...props, portal });
}
