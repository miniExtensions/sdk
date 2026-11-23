import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactElement,
} from 'react';
import {
    lockDocumentScroll,
    useAttachmentDialogReturnFocus,
} from './AttachmentSlider.js';
import {
    AttachmentUploadProgress,
    type AttachmentUploadProgressProps,
} from './AttachmentUploadProgress.js';
import { AttachmentSliderPortal } from './attachmentSliderDialogRuntime.js';
import { getThemePortalProps, useThemeSnapshot } from './ThemeBoundary.js';

export type AttachmentUploadDialogProps = AttachmentUploadProgressProps &
    Readonly<{
        /** A host-owned confirmation currently sits above the upload dialog. */
        covered?: boolean;
        /** Reserve space for the host's docked support panel on desktop. */
        intercomOpen?: boolean;
    }>;

const uploadDialog = 'mx-sdk-attachment-upload-dialog';
const useCommitEffect =
    typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Controlled dialog for a host-owned upload and explicit cancellation intent. */
export function AttachmentUploadDialog({
    percentage,
    labels,
    onCancel,
    covered = false,
    intercomOpen = false,
}: AttachmentUploadDialogProps): ReactElement {
    const [dialog, setDialog] = useState<HTMLDivElement | null>(null);
    // The progress leaf's Cancel is the only focusable element in the dialog.
    const initialFocus = useRef<HTMLElement | null>(null);
    const resumeFocus = useRef(false);
    const theme = getThemePortalProps(useThemeSnapshot());

    useAttachmentDialogReturnFocus();

    useCommitEffect(() => {
        const document = dialog?.ownerDocument;
        const view = document?.defaultView;
        if (!dialog || !document || !view) return;
        const suppressEscape = (event: KeyboardEvent) => {
            if (
                event.key !== 'Escape' ||
                event.defaultPrevented ||
                [
                    ...document.querySelectorAll(
                        `.${uploadDialog}[role="dialog"]`
                    ),
                ].at(-1) !== dialog
            )
                return;
            // The native upload consumes Escape even under its confirmation.
            // Keep the legacy parent and upload open until an explicit action.
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        view.addEventListener('keydown', suppressEscape, true);
        return () => view.removeEventListener('keydown', suppressEscape, true);
    }, [dialog]);

    useCommitEffect(() => {
        if (covered) {
            resumeFocus.current = true;
            return;
        }
        const owner = dialog?.ownerDocument;
        const view = owner?.defaultView;
        if (!dialog || !owner || !view || !resumeFocus.current) return;
        const frame = view.requestAnimationFrame(() => {
            resumeFocus.current = false;
            // A legacy confirmation can finish restoring focus to its parent.
            // Reclaim the still-open upload after those focus effects.
            if (!dialog.isConnected || dialog.contains(owner.activeElement))
                return;
            dialog
                .querySelector<HTMLButtonElement>('button:not(:disabled)')
                ?.focus({ preventScroll: true });
        });
        return () => view.cancelAnimationFrame(frame);
    }, [dialog, covered]);

    useEffect(() => {
        const document = dialog?.ownerDocument;
        const view = document?.defaultView;
        // The host confirmation owns the lock while it covers this dialog.
        if (!document || !view || covered) return;
        return lockDocumentScroll(document, view);
    }, [dialog, covered]);

    return h(AttachmentSliderPortal, {
        initialFocus,
        covered,
        focusOnMount: true,
        children: h(
            'div',
            {
                ref: setDialog,
                role: 'dialog',
                'aria-label': labels.uploading,
                'aria-modal': covered ? undefined : true,
                className: intercomOpen
                    ? `${uploadDialog} ${uploadDialog}--intercom`
                    : uploadDialog,
            },
            h(
                'div',
                {
                    ...theme,
                    className: theme.className
                        ? `${uploadDialog}__viewport ${theme.className}`
                        : `${uploadDialog}__viewport`,
                },
                h('div', {
                    className: `${uploadDialog}__backdrop`,
                    'data-testid': 'dialog-overlay-test-id',
                    'aria-hidden': true,
                }),
                h(
                    'div',
                    {
                        className: `${uploadDialog}__panel`,
                        'data-testid': 'dialog-test-id',
                    },
                    h(
                        'div',
                        { className: `${uploadDialog}__body` },
                        h(AttachmentUploadProgress, {
                            percentage,
                            labels,
                            onCancel: () => {
                                if (!covered) onCancel();
                            },
                        })
                    )
                )
            )
        ),
    });
}
