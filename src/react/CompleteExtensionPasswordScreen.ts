import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type FormEvent,
    type ReactElement,
} from 'react';
import type { AuthOwnerScope, AuthPasswordResult } from '../auth/types.js';

export type CompleteExtensionPasswordScreenLabels = {
    password: string;
    submit: string;
    pending: string;
    wrong: string;
    blocked: string;
    error: string;
};

export type CompleteExtensionPasswordScreenResult = Readonly<{
    type: AuthPasswordResult['type'] | 'error';
}>;

export type CompleteExtensionPasswordScreenProps = {
    scope: AuthOwnerScope;
    labels: CompleteExtensionPasswordScreenLabels;
    /** Resolve as correct only after the host has handled its accepted result. */
    verifyPassword: (
        password: string
    ) => Promise<CompleteExtensionPasswordScreenResult>;
    className?: string;
    accentColor?: string;
};

const useCommitEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

/** Password-entry UI for the current Form or Portal owner. */
export function CompleteExtensionPasswordScreen(
    props: CompleteExtensionPasswordScreenProps
): ReactElement {
    return h(ExtensionPasswordForm, {
        ...props,
        key: JSON.stringify([props.scope.ownerId, props.scope.revision]),
    });
}

function ExtensionPasswordForm({
    labels,
    verifyPassword,
    className,
    accentColor,
}: CompleteExtensionPasswordScreenProps) {
    const inputId = `mx-extension-password-${useId()}`;
    const errorId = `${inputId}-error`;
    const input = useRef<HTMLInputElement>(null);
    const [hasPassword, setHasPassword] = useState(false);
    const [status, setStatus] = useState<'ready' | 'pending' | 'accepted'>(
        'ready'
    );
    const [feedback, setFeedback] = useState<
        'wrong' | 'blocked' | 'error' | null
    >(null);
    const owner = useRef<{ acceptsSubmit: boolean } | null>(null);

    useCommitEffect(() => {
        owner.current = { acceptsSubmit: true };
        return () => {
            owner.current = null;
        };
    }, []);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const attemptOwner = owner.current;
        const field = input.current;
        if (!attemptOwner?.acceptsSubmit || !field?.value.length) return;
        attemptOwner.acceptsSubmit = false;
        setStatus('pending');

        let result: CompleteExtensionPasswordScreenResult['type'];
        try {
            result = (await verifyPassword(field.value)).type;
        } catch {
            result = 'error';
        }
        if (owner.current !== attemptOwner) return;

        if (result === 'correct') {
            field.value = '';
            setHasPassword(false);
            setFeedback(null);
            setStatus('accepted');
        } else {
            setFeedback(result);
            setStatus('ready');
            attemptOwner.acceptsSubmit = result !== 'blocked';
        }
    }

    return h(
        'div',
        {
            className: ['mx-sdk-extension-password', className]
                .filter(Boolean)
                .join(' '),
            style: {
                '--mx-sdk-extension-password-accent': accentColor,
                '--mx-sdk-extension-password-accent-hover':
                    accentColor &&
                    `color-mix(in srgb, ${accentColor} 86%, white)`,
            } as CSSProperties,
        },
        h(
            'form',
            { className: 'mx-sdk-extension-password-panel', onSubmit: submit },
            h('label', { htmlFor: inputId }, labels.password),
            h('input', {
                ref: input,
                id: inputId,
                name: 'password',
                type: 'password',
                autoComplete: 'current-password',
                required: true,
                // Keep the draft in the input property so React does not
                // mirror a controlled value into serialized HTML.
                onChange: (event) =>
                    setHasPassword(event.currentTarget.value.length > 0),
                'aria-invalid': feedback !== null,
                'aria-describedby': feedback === null ? undefined : errorId,
            }),
            feedback === null
                ? null
                : h('p', { id: errorId, role: 'alert' }, labels[feedback]),
            h(
                'div',
                { className: 'mx-sdk-extension-password-actions' },
                h(
                    'button',
                    {
                        type: 'submit',
                        disabled:
                            status !== 'ready' ||
                            feedback === 'blocked' ||
                            !hasPassword,
                    },
                    status === 'pending'
                        ? h(
                              'svg',
                              {
                                  'aria-hidden': true,
                                  className:
                                      'mx-sdk-extension-password-spinner',
                                  viewBox: '0 0 24 24',
                                  fill: 'none',
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
                                  d: 'M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z',
                                  fill: 'currentColor',
                                  opacity: 0.75,
                              })
                          )
                        : null,
                    labels.submit
                ),
                h(
                    'span',
                    {
                        className: 'mx-sdk-extension-password-status',
                        role: 'status',
                    },
                    status === 'pending' ? labels.pending : null
                )
            )
        )
    );
}
