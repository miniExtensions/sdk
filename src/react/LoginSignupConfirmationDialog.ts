import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent,
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
    /** An opaque host key. Change it whenever a different attempt replaces the current one. */
    attemptId: string;
    /** Suspends decisions and retires held input without reopening the attempt. */
    disabled?: boolean;
    /** Uses the responsive panel styling from login-signup-confirmation-dialog.css. */
    appearance?: 'native';
    testIds?: Readonly<{
        root?: string;
        cancelButton?: string;
        confirmButton?: string;
    }>;
    copy: LoginSignupConfirmationCopy;
    /** Requests dismissal without changing the host draft. */
    onCancel(): void;
    /** Requests one explicit signup action for this attempt. */
    onCreate(): void;
}>;

function isPointerClick(event: MouseEvent) {
    return (
        event.detail > 0 ||
        ('pointerType' in event.nativeEvent &&
            event.nativeEvent.pointerType !== '')
    );
}

function hitsBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return false;
    // The browser targets the dialog for both its padding and its backdrop.
    const { left, right, top, bottom } =
        event.currentTarget.getBoundingClientRect();
    return (
        event.clientX < left ||
        event.clientX >= right ||
        event.clientY < top ||
        event.clientY >= bottom
    );
}

/** The host opens the dialog, handles its intent, and controls dismissal. */
export function LoginSignupConfirmationDialog({
    open,
    attemptId,
    ...props
}: LoginSignupConfirmationDialogProps): ReactElement | null {
    // Commit a new DOM and decision lifetime even if the dialog stays open.
    return open ? h(SignupConfirmation, { ...props, key: attemptId }) : null;
}

function SignupConfirmation({
    appearance,
    copy,
    disabled = false,
    onCancel,
    onCreate,
    testIds,
}: Omit<
    LoginSignupConfirmationDialogProps,
    'open' | 'attemptId'
>): ReactElement {
    const dialog = useRef<HTMLDialogElement>(null);
    const back = useRef<HTMLButtonElement>(null);
    const pointerStart = useRef<HTMLButtonElement | null>(null);
    const backdropPress = useRef<{
        pointerId: number;
        releasedOutside: boolean;
    } | null>(null);
    const spaceStart = useRef<HTMLButtonElement | null>(null);
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

    useCommitEffect(() => {
        pointerStart.current = null;
        backdropPress.current = null;
        spaceStart.current = null;
        const current = dialog.current;
        const focused = current?.ownerDocument.activeElement;
        if (
            !disabled &&
            decision.current === 'ready' &&
            current &&
            (focused === current || !current.contains(focused ?? null))
        )
            back.current?.focus();
    }, [appearance, disabled]);

    function choose(action: () => void) {
        if (disabled || decision.current !== 'ready') return;
        decision.current = 'settled';
        setSettled(true);
        action();
    }

    function actionProps(action: () => void) {
        return {
            type: 'button' as const,
            disabled: disabled || settled,
            onPointerDown(event: PointerEvent<HTMLButtonElement>) {
                pointerStart.current =
                    event.isPrimary && event.button === 0
                        ? event.currentTarget
                        : null;
            },
            onPointerCancel() {
                pointerStart.current = null;
            },
            onClick(event: MouseEvent<HTMLButtonElement>) {
                // Pointer clicks must start in this lifetime. Non-pointer
                // activations also include assistive technology and Enter.
                const beganHere = pointerStart.current === event.currentTarget;
                pointerStart.current = null;
                if (!isPointerClick(event) || beganHere) choose(action);
            },
            onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
                if (event.key === ' ') {
                    // Space activates on release, which can cross a host update.
                    event.preventDefault();
                    if (!event.repeat) spaceStart.current = event.currentTarget;
                } else if (event.key === 'Enter' && event.repeat) {
                    event.preventDefault();
                }
            },
            onKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
                if (event.key !== ' ') return;
                event.preventDefault();
                const beganHere = spaceStart.current === event.currentTarget;
                spaceStart.current = null;
                if (beganHere) choose(action);
            },
            onBlur() {
                spaceStart.current = null;
            },
        };
    }

    const native = appearance === 'native';
    const title = h(native ? 'h3' : 'h2', { id: titleId }, copy.title);
    const body = h('p', { id: bodyId }, copy.body);
    const backButton = h(
        'button',
        {
            ...actionProps(onCancel),
            ref: back,
            'data-testid': testIds?.cancelButton,
            className: native ? 'mx-sdk-login-signup__back' : undefined,
        },
        copy.back
    );
    const createButton = h(
        'button',
        {
            ...actionProps(onCreate),
            'data-testid': testIds?.confirmButton,
            className: native ? 'mx-sdk-login-signup__create' : undefined,
        },
        copy.create
    );

    return h(
        'dialog',
        {
            ref: dialog,
            className: native ? 'mx-sdk-login-signup' : undefined,
            'data-testid': testIds?.root,
            'aria-labelledby': titleId,
            'aria-modal': true,
            'aria-describedby': bodyId,
            onPointerDown(event: PointerEvent<HTMLDialogElement>) {
                backdropPress.current =
                    !disabled &&
                    event.isTrusted &&
                    event.isPrimary &&
                    event.button === 0 &&
                    hitsBackdrop(event)
                        ? { pointerId: event.pointerId, releasedOutside: false }
                        : null;
            },
            onPointerUp(event: PointerEvent<HTMLDialogElement>) {
                const press = backdropPress.current;
                if (!press || press.pointerId !== event.pointerId) return;
                if (event.isTrusted && hitsBackdrop(event))
                    press.releasedOutside = true;
                else backdropPress.current = null;
            },
            onPointerCancel() {
                backdropPress.current = null;
            },
            onClick(event: MouseEvent<HTMLDialogElement>) {
                const press = backdropPress.current;
                backdropPress.current = null;
                // Press and release establish the bounds because click can round its coordinates.
                // Waiting for click keeps controls behind the dialog inert through pointerup.
                if (
                    press?.releasedOutside &&
                    event.isTrusted &&
                    isPointerClick(event) &&
                    event.target === event.currentTarget &&
                    (!('pointerId' in event.nativeEvent) ||
                        event.nativeEvent.pointerId === press.pointerId)
                )
                    choose(onCancel);
            },
            onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
                if (event.key === 'Escape' && event.repeat)
                    event.preventDefault();
            },
            onCancel(event: SyntheticEvent<HTMLDialogElement>) {
                event.preventDefault();
                choose(onCancel);
            },
        },
        ...(native
            ? [
                  h(
                      'div',
                      { className: 'mx-sdk-login-signup__copy' },
                      title,
                      body
                  ),
              ]
            : [title, body]),
        h(
            'div',
            native ? { className: 'mx-sdk-login-signup__actions' } : null,
            ...(native
                ? [createButton, backButton]
                : [backButton, createButton])
        )
    );
}
