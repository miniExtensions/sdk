import type * as React from 'react';
import {
    createElement as h,
    lazy,
    Suspense,
    useEffect,
    useId,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import type {
    FormRecordActionsController,
    FormRecordActionsSnapshot,
} from '../forms/recordActions.js';
import { ActionButton } from './ActionButton.js';

export type FormRecordActionsLabels = Readonly<{
    /** Localized and resolved by the host, including any custom delete label. */
    deleteRecord: string;
    comments: string;
    openMenu: string;
    confirmationTitle: string;
    irreversibleWarning: string;
    confirmDelete: string;
    cancel: string;
}>;

export type FormRecordDeleteConfirmationProps = Readonly<{
    labels: Pick<
        FormRecordActionsLabels,
        'confirmationTitle' | 'irreversibleWarning' | 'confirmDelete' | 'cancel'
    >;
    onConfirm(): void;
    onDismiss(): void;
    returnFocus?: React.RefObject<HTMLButtonElement | null>;
}>;

export function FormRecordDeleteConfirmation({
    labels,
    onConfirm,
    onDismiss,
    returnFocus,
}: FormRecordDeleteConfirmationProps): React.ReactElement {
    const dialog = useRef<HTMLDialogElement>(null);
    const cancel = useRef<HTMLButtonElement>(null);
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        const node = dialog.current;
        if (!node) return;
        const owner = node.ownerDocument;
        const opener = returnFocus?.current ?? owner.activeElement;
        node.showModal();
        cancel.current?.focus({ preventScroll: true });
        return () => {
            const active = owner.activeElement;
            const restore = active === owner.body || node.contains(active);
            node.close();
            if (
                restore &&
                opener?.isConnected &&
                'focus' in opener &&
                typeof opener.focus === 'function'
            )
                opener.focus({ preventScroll: true });
        };
    }, [returnFocus]);

    return h(
        'dialog',
        {
            ref: dialog,
            role: 'alertdialog',
            className: 'mx-sdk-form-record-actions__dialog',
            'aria-modal': true,
            'aria-labelledby': titleId,
            'aria-describedby': descriptionId,
            onCancel: (event: React.SyntheticEvent<HTMLDialogElement>) => {
                event.preventDefault();
                onDismiss();
            },
            onKeyDown: (event: React.KeyboardEvent<HTMLDialogElement>) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                onDismiss();
            },
            onClick: (event: React.MouseEvent<HTMLDialogElement>) => {
                if (event.target === event.currentTarget) onDismiss();
            },
        },
        h(
            'div',
            { className: 'mx-sdk-form-record-actions__warning' },
            h('h2', { id: titleId }, labels.confirmationTitle),
            h('p', { id: descriptionId }, labels.irreversibleWarning),
            h(
                'div',
                { className: 'mx-sdk-form-record-actions__choices' },
                h(
                    ActionButton,
                    { ref: cancel, onClick: onDismiss },
                    labels.cancel
                ),
                h(
                    ActionButton,
                    {
                        className: 'mx-sdk-form-record-actions__danger',
                        onClick: onConfirm,
                    },
                    labels.confirmDelete
                )
            )
        )
    );
}

/** Mount one presentation per controller. Keep the host port live while mounted. */
export type FormRecordActionsProps = Readonly<{
    controller: FormRecordActionsController;
    labels: FormRecordActionsLabels;
    className?: string;
}>;

/** A portaled action menu for a clipped Portal side-panel header. */
export type FormRecordActionsHeaderMenuProps = FormRecordActionsProps &
    Readonly<{
        /** Decorative icons supplied by the host. The action labels name the controls. */
        icons: Readonly<{
            trigger: React.ReactNode;
            comments: React.ReactNode;
            deleteRecord: React.ReactNode;
        }>;
        buttonRef?: React.RefObject<HTMLButtonElement | null>;
        buttonClassName?: string;
        buttonTestId?: string;
    }>;

function useActions(controller: FormRecordActionsController) {
    return useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
        controller.getSnapshot
    );
}

function confirmation(
    props: FormRecordActionsProps,
    snapshot: FormRecordActionsSnapshot,
    opener: React.RefObject<HTMLButtonElement | null>
): React.ReactElement | null {
    const opening = snapshot.confirmation;
    return (
        opening &&
        h(FormRecordDeleteConfirmation, {
            labels: props.labels,
            returnFocus: opener,
            onConfirm: () => props.controller.confirmDelete(opening),
            onDismiss: () =>
                props.controller.dismissDeleteConfirmation(opening),
        })
    );
}

/** Record actions beside the host's existing Save control. */
export function FormRecordActionsFooter(
    props: FormRecordActionsProps
): React.ReactElement | null {
    const { controller, labels, className } = props;
    const snapshot = useActions(controller);
    const opener = useRef<HTMLButtonElement>(null);
    if (
        !snapshot.showComments &&
        !snapshot.showDelete &&
        !snapshot.confirmation
    )
        return null;
    return h(
        'div',
        {
            className: [
                'mx-sdk-form-record-actions',
                'mx-sdk-form-record-actions__footer',
                className,
            ]
                .filter(Boolean)
                .join(' '),
        },
        snapshot.showComments &&
            h(
                ActionButton,
                {
                    disabled: snapshot.commentsDisabled,
                    onClick: controller.openComments,
                },
                labels.comments
            ),
        snapshot.showDelete &&
            h(
                ActionButton,
                {
                    ref: opener,
                    className: 'mx-sdk-form-record-actions__danger-text',
                    busy: snapshot.deletePending,
                    disabled: snapshot.deleteDisabled,
                    onClick: controller.openDeleteConfirmation,
                },
                labels.deleteRecord
            ),
        confirmation(props, snapshot, opener)
    );
}

function useActionOwnerKey(controller: FormRecordActionsController): number {
    const [owner, setOwner] = useState(() => ({
        controller,
        key: 0,
    }));
    if (owner.controller !== controller)
        setOwner({ controller, key: owner.key + 1 });
    return owner.key;
}

/** A disclosure with actionable buttons and ordinary keyboard tab order. */
export function FormRecordActionsMenu(
    props: FormRecordActionsProps
): React.ReactElement | null {
    // A reused row must not inherit the old disclosure or its focus target.
    return h(RecordActionsMenu, {
        ...props,
        key: useActionOwnerKey(props.controller),
    });
}

const HeaderMenu = lazy(async () => ({
    default: (await import('./formRecordActionsHeaderMenuRuntime.js'))
        .FormRecordActionsHeaderMenuRuntime,
}));

/** Header actions with arrow navigation and a menu outside the panel's clipping boundary. */
export function FormRecordActionsHeaderMenu(
    props: FormRecordActionsHeaderMenuProps
): React.ReactElement {
    return h(RecordActionsHeaderMenu, {
        ...props,
        key: useActionOwnerKey(props.controller),
    });
}

function RecordActionsHeaderMenu(props: FormRecordActionsHeaderMenuProps) {
    const { controller, labels, icons } = props;
    const snapshot = useActions(controller);
    const localOpener = useRef<HTMLButtonElement>(null);
    const opener = props.buttonRef ?? localOpener;
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const run = (action: () => void) => () => {
        if (mounted.current) action();
    };
    const items = [
        ...(snapshot.showComments
            ? [
                  {
                      kind: 'comments' as const,
                      label: labels.comments,
                      icon: icons.comments,
                      disabled: snapshot.commentsDisabled,
                      onSelect: run(controller.openComments),
                  },
              ]
            : []),
        ...(snapshot.showDelete
            ? [
                  {
                      kind: 'delete' as const,
                      label: labels.deleteRecord,
                      icon: icons.deleteRecord,
                      disabled: snapshot.deleteDisabled,
                      pending: snapshot.deletePending,
                      onSelect: run(controller.openDeleteConfirmation),
                  },
              ]
            : []),
    ];

    if (items.length === 0 && !snapshot.confirmation) return null;
    return h(
        'div',
        { className: props.className },
        items.length > 0 &&
            h(
                Suspense,
                { fallback: null },
                h(HeaderMenu, {
                    label: labels.openMenu,
                    buttonRef: opener,
                    buttonClassName: props.buttonClassName,
                    buttonTestId: props.buttonTestId,
                    triggerIcon: icons.trigger,
                    items,
                })
            ),
        confirmation(props, snapshot, opener)
    );
}

function showActionsPanel(panel: HTMLDivElement, button: HTMLButtonElement) {
    const doc = button.ownerDocument;
    const view = doc.defaultView;
    if (
        !view ||
        typeof panel.showPopover !== 'function' ||
        typeof panel.hidePopover !== 'function'
    )
        return;
    // Keep the panel in the disclosure's DOM and tab order, including in a
    // host dialog, while allowing it to paint beyond the clipping ancestor.
    panel.setAttribute('popover', 'manual');
    panel.showPopover();
    if (!panel.matches(':popover-open')) {
        panel.removeAttribute('popover');
        return;
    }

    const gap = 4;
    let frame = 0;
    // Host layout and side-panel animation can move the button without a
    // resize or scroll event. Track it only while the disclosure is open.
    const position = () => {
        if (!panel.isConnected || !button.isConnected) return;
        const anchor = button.getBoundingClientRect();
        const { clientWidth, clientHeight } = doc.documentElement;
        const { width, height } = panel.getBoundingClientRect();
        const start =
            view.getComputedStyle(button).direction === 'rtl'
                ? anchor.right - width
                : anchor.left;
        const below = anchor.bottom + gap;
        const above = anchor.top - gap - height;
        const preferredTop =
            below + height + gap > clientHeight &&
            anchor.top > clientHeight - anchor.bottom
                ? above
                : below;
        const left = Math.max(gap, Math.min(start, clientWidth - width - gap));
        const top = Math.max(
            gap,
            Math.min(preferredTop, clientHeight - height - gap)
        );
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        frame = view.requestAnimationFrame(position);
    };

    position();
    return () => {
        view.cancelAnimationFrame(frame);
        if (panel.isConnected && panel.matches(':popover-open'))
            panel.hidePopover();
        panel.removeAttribute('popover');
        panel.style.removeProperty('left');
        panel.style.removeProperty('top');
    };
}

function RecordActionsMenu(
    props: FormRecordActionsProps
): React.ReactElement | null {
    const { controller, labels, className } = props;
    const snapshot = useActions(controller);
    const root = useRef<HTMLDivElement>(null);
    const opener = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const panelId = useId();
    const [expanded, setExpanded] = useState(false);
    const hasActions = snapshot.showComments || snapshot.showDelete;

    useEffect(() => {
        if (!hasActions) setExpanded(false);
    }, [hasActions]);
    useEffect(() => {
        const node = root.current;
        if (!expanded || !hasActions || !node) return;
        const closePanel =
            opener.current && panel.current
                ? showActionsPanel(panel.current, opener.current)
                : undefined;
        const dismissOutside = (event: PointerEvent) => {
            if (!node.contains(event.target as Node)) setExpanded(false);
        };
        node.ownerDocument.addEventListener('pointerdown', dismissOutside);
        return () => {
            closePanel?.();
            node.ownerDocument.removeEventListener(
                'pointerdown',
                dismissOutside
            );
        };
    }, [expanded, hasActions]);

    const dismissMenu = () => {
        setExpanded(false);
        opener.current?.focus({ preventScroll: true });
    };

    if (!hasActions && !snapshot.confirmation) return null;
    return h(
        'div',
        {
            ref: root,
            className: [
                'mx-sdk-form-record-actions',
                'mx-sdk-form-record-actions__menu',
                className,
            ]
                .filter(Boolean)
                .join(' '),
            onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                    setExpanded(false);
            },
            onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                if (!expanded || event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                dismissMenu();
            },
        },
        hasActions &&
            h(
                ActionButton,
                {
                    ref: opener,
                    'aria-label': labels.openMenu,
                    'aria-expanded': expanded,
                    'aria-controls': expanded ? panelId : undefined,
                    onClick: () => setExpanded((open) => !open),
                },
                h('span', { 'aria-hidden': true }, '⋯')
            ),
        hasActions &&
            expanded &&
            h(
                'div',
                {
                    id: panelId,
                    ref: panel,
                    role: 'group',
                    'aria-label': labels.openMenu,
                    className: 'mx-sdk-form-record-actions__panel',
                },
                snapshot.showComments &&
                    h(
                        ActionButton,
                        {
                            disabled: snapshot.commentsDisabled,
                            onClick: () => {
                                dismissMenu();
                                controller.openComments();
                            },
                        },
                        labels.comments
                    ),
                snapshot.showDelete &&
                    h(
                        ActionButton,
                        {
                            className:
                                'mx-sdk-form-record-actions__danger-text',
                            busy: snapshot.deletePending,
                            disabled: snapshot.deleteDisabled,
                            onClick: () => {
                                dismissMenu();
                                controller.openDeleteConfirmation();
                            },
                        },
                        labels.deleteRecord
                    )
            ),
        confirmation(props, snapshot, opener)
    );
}
