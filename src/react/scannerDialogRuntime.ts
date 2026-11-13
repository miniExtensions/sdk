import { Dialog } from '@headlessui/react';
import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useRef,
    type CSSProperties,
    type ReactElement,
    type ReactNode,
} from 'react';

export type ScannerDialogProps = {
    title: string;
    closeLabel: string;
    dismiss: () => void;
    children?: ReactNode;
    style: CSSProperties;
    className?: string;
};

/** Private scanner UI. Build bundles the dialog while keeping React optional. */
export function ScannerDialog(props: ScannerDialogProps): ReactElement {
    const dialogRef = useRef<HTMLDivElement>(null);
    const useCommittedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommittedEffect(() => {
        // Native hosts can have an older independent dialog stack. Retire this
        // top scanner before their window-bubble Escape handlers see the key.
        const escape = (event: KeyboardEvent) => {
            if (!['Escape', 'Tab'].includes(event.key) || event.isComposing)
                return;
            const dialogs = document.querySelectorAll(
                '.mx-sdk-scanner[role=dialog]'
            );
            if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
            if (event.key === 'Tab') {
                const controls = Array.from(
                    dialogRef.current.querySelectorAll<HTMLButtonElement>(
                        'button'
                    )
                ).filter((control) => !control.disabled);
                const first = controls[0],
                    last = controls[controls.length - 1];
                const wrap = event.shiftKey
                    ? document.activeElement === first
                    : document.activeElement === last;
                if (first && last && wrap) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    (event.shiftKey ? last : first).focus({
                        preventScroll: true,
                    });
                }
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            props.dismiss();
        };
        window.addEventListener('keydown', escape, true);
        return () => window.removeEventListener('keydown', escape, true);
    }, [props.dismiss]);
    const panelProps = {
        className: 'mx-sdk-scanner-panel',
        'data-testid': 'dialog-test-id',
    };
    return h(
        Dialog,
        {
            ref: dialogRef,
            open: true,
            onClose: props.dismiss,
            className: ['mx-sdk-scanner', props.className]
                .filter(Boolean)
                .join(' '),
            style: props.style,
        },
        h('div', {
            className: 'mx-sdk-scanner-overlay',
            'aria-hidden': true,
            onClick: props.dismiss,
            'data-testid': 'dialog-overlay-test-id',
        }),
        h(
            'div',
            { className: 'mx-sdk-scanner-viewport' },
            h(
                Dialog.Panel,
                panelProps,
                h(
                    'header',
                    { className: 'mx-sdk-scanner-header' },
                    h(Dialog.Title, null, props.title),
                    h(
                        'button',
                        {
                            type: 'button',
                            className: 'mx-sdk-scanner-close',
                            onClick: props.dismiss,
                            'aria-label': props.closeLabel,
                            'data-testid': 'close-dialog',
                        },
                        '×'
                    )
                ),
                props.children
            )
        )
    );
}
