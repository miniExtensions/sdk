import type * as React from 'react';
import {
    createElement as h,
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

/** A disclosure with actionable buttons and ordinary keyboard tab order. */
export function FormRecordActionsMenu(
    props: FormRecordActionsProps
): React.ReactElement | null {
    const { controller, labels, className } = props;
    const snapshot = useActions(controller);
    const root = useRef<HTMLDivElement>(null);
    const opener = useRef<HTMLButtonElement>(null);
    const panelId = useId();
    const [expanded, setExpanded] = useState(false);
    const hasActions = snapshot.showComments || snapshot.showDelete;

    useEffect(() => {
        if (!hasActions) setExpanded(false);
    }, [hasActions]);
    useEffect(() => {
        const node = root.current;
        if (!expanded || !node) return;
        const dismissOutside = (event: PointerEvent) => {
            if (!node.contains(event.target as Node)) setExpanded(false);
        };
        node.ownerDocument.addEventListener('pointerdown', dismissOutside);
        return () =>
            node.ownerDocument.removeEventListener(
                'pointerdown',
                dismissOutside
            );
    }, [expanded]);

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
