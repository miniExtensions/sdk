import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type ReactElement,
    type SyntheticEvent,
} from 'react';

/** Localized copy prepared by the host, including any masking of its values. */
export type LoginSignupConfirmationCopy = Readonly<{
    title: string;
    body: string;
    back: string;
    create: string;
}>;

export type LoginSignupConfirmationDialogProps = Readonly<{
    open: boolean;
    copy: LoginSignupConfirmationCopy;
    /** Requests dismissal without changing the host draft. */
    onCancel(): void;
    /** Requests one explicit signup action for this opening. */
    onCreate(): void;
}>;

/** The host opens the dialog, handles its intent, and controls dismissal. */
export function LoginSignupConfirmationDialog({
    open,
    ...props
}: LoginSignupConfirmationDialogProps): ReactElement | null {
    return open ? h(SignupConfirmation, props) : null;
}

function SignupConfirmation({
    copy,
    onCancel,
    onCreate,
}: Omit<LoginSignupConfirmationDialogProps, 'open'>): ReactElement {
    const dialog = useRef<HTMLDialogElement>(null);
    const back = useRef<HTMLButtonElement>(null);
    const decision = useRef<'inactive' | 'ready' | 'settled'>('inactive');
    const [settled, setSettled] = useState(false);
    const id = useId();
    const titleId = `${id}-title`;
    const bodyId = `${id}-body`;
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;

    useCommitEffect(() => {
        const current = dialog.current;
        if (!current) return;
        const opener = current.ownerDocument.activeElement;
        const HTMLElement = current.ownerDocument.defaultView?.HTMLElement;
        current.showModal();
        decision.current = 'ready';
        back.current?.focus();

        return () => {
            decision.current = 'inactive';
            current.close();
            if (
                opener?.isConnected &&
                HTMLElement &&
                opener instanceof HTMLElement
            )
                opener.focus();
        };
    }, []);

    function choose(action: () => void) {
        if (decision.current !== 'ready') return;
        decision.current = 'settled';
        setSettled(true);
        action();
    }

    return h(
        'dialog',
        {
            ref: dialog,
            'aria-labelledby': titleId,
            'aria-modal': true,
            'aria-describedby': bodyId,
            onCancel(event: SyntheticEvent<HTMLDialogElement>) {
                event.preventDefault();
                choose(onCancel);
            },
        },
        h('h2', { id: titleId }, copy.title),
        h('p', { id: bodyId }, copy.body),
        h(
            'div',
            null,
            h(
                'button',
                {
                    type: 'button',
                    ref: back,
                    disabled: settled,
                    onClick: () => choose(onCancel),
                },
                copy.back
            ),
            h(
                'button',
                {
                    type: 'button',
                    disabled: settled,
                    onClick: () => choose(onCreate),
                },
                copy.create
            )
        )
    );
}
