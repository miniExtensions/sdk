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
    refreshRequired?: string;
};

export type CompleteExtensionPasswordScreenResult = Readonly<
    | { type: AuthPasswordResult['type'] }
    | {
          type: 'error';
          recovery?: 'refresh-required' | 'reload-required' | 'retired';
      }
>;

export type CompleteExtensionPasswordScreenProps = {
    scope: AuthOwnerScope;
    labels: CompleteExtensionPasswordScreenLabels;
    /** Resolve as correct only after the host has handled its accepted result. */
    verifyPassword: (
        password: string
    ) => Promise<CompleteExtensionPasswordScreenResult>;
    /** Read a fresh page without re-verifying the password. */
    reload?: {
        label: string;
        run(): Promise<'completed' | 'retry' | 'refresh-required' | 'retired'>;
    };
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

type PasswordRecoveryStatus = 'refresh-required' | 'reload-required';

type PasswordFormStatus =
    | 'ready'
    | 'pending'
    | 'accepted'
    | 'blocked'
    | PasswordRecoveryStatus
    | 'reloading'
    | 'waiting';

function isRecoveryStatus(
    status: PasswordFormStatus
): status is PasswordRecoveryStatus {
    return status === 'refresh-required' || status === 'reload-required';
}

function ExtensionPasswordForm({
    labels,
    verifyPassword,
    reload,
    className,
    accentColor,
}: CompleteExtensionPasswordScreenProps) {
    const inputId = `mx-extension-password-${useId()}`;
    const errorId = `${inputId}-error`;
    const input = useRef<HTMLInputElement>(null);
    const [hasPassword, setHasPassword] = useState(false);
    const [status, setStatus] = useState<PasswordFormStatus>('ready');
    const [feedback, setFeedback] = useState<
        'wrong' | 'blocked' | 'error' | 'refreshRequired' | null
    >(null);
    const owner = useRef<{ status: PasswordFormStatus } | null>(null);

    useCommitEffect(() => {
        owner.current = { status: 'ready' };
        return () => {
            owner.current = null;
        };
    }, []);

    function transition(
        currentOwner: NonNullable<typeof owner.current>,
        next: PasswordFormStatus
    ) {
        // Claim the next action before React has committed the new controls.
        currentOwner.status = next;
        setStatus(next);
    }

    function clearDraft() {
        if (input.current) input.current.value = '';
        setHasPassword(false);
    }

    function settleRecovery(
        currentOwner: NonNullable<typeof owner.current>,
        result: PasswordRecoveryStatus | 'completed' | 'retired'
    ) {
        clearDraft();
        if (result === 'reload-required') {
            setFeedback('error');
            transition(currentOwner, result);
        } else if (result === 'refresh-required') {
            setFeedback('refreshRequired');
            transition(currentOwner, result);
        } else {
            setFeedback(null);
            transition(currentOwner, 'waiting');
        }
    }

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const attemptOwner = owner.current;
        const field = input.current;
        if (attemptOwner?.status !== 'ready' || !field?.value.length) return;
        transition(attemptOwner, 'pending');

        let result: CompleteExtensionPasswordScreenResult;
        try {
            result = await verifyPassword(field.value);
        } catch {
            result = { type: 'error' };
        }
        if (owner.current !== attemptOwner) return;

        if (result.type === 'correct') {
            clearDraft();
            setFeedback(null);
            transition(attemptOwner, 'accepted');
        } else if (result.type === 'error' && result.recovery) {
            settleRecovery(attemptOwner, result.recovery);
        } else {
            setFeedback(result.type);
            transition(
                attemptOwner,
                result.type === 'blocked' ? 'blocked' : 'ready'
            );
        }
    }

    async function reloadScreen() {
        const attemptOwner = owner.current;
        if (!attemptOwner || !reload || !isRecoveryStatus(attemptOwner.status))
            return;
        const origin = attemptOwner.status;
        transition(attemptOwner, 'reloading');

        let result: Awaited<ReturnType<typeof reload.run>>;
        try {
            result = await reload.run();
        } catch {
            result = 'retry';
        }
        if (owner.current !== attemptOwner) return;

        if (result === 'retry') transition(attemptOwner, origin);
        else settleRecovery(attemptOwner, result);
    }

    const reloadAction =
        isRecoveryStatus(status) || status === 'reloading' ? reload : undefined;
    const lockedInput =
        isRecoveryStatus(status) ||
        status === 'reloading' ||
        status === 'waiting';

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
                readOnly: lockedInput,
                // Keep the draft in the input property so React does not
                // mirror a controlled value into serialized HTML.
                onChange: (event) =>
                    setHasPassword(event.currentTarget.value.length > 0),
                'aria-invalid': feedback !== null,
                'aria-describedby': feedback === null ? undefined : errorId,
            }),
            feedback === null
                ? null
                : h(
                      'p',
                      { id: errorId, role: 'alert' },
                      labels[feedback] ?? labels.error
                  ),
            h(
                'div',
                {
                    className: reloadAction
                        ? 'mx-sdk-extension-password-actions mx-sdk-extension-password-actions--with-reload'
                        : 'mx-sdk-extension-password-actions',
                },
                h(
                    'button',
                    {
                        type: 'submit',
                        disabled: status !== 'ready' || !hasPassword,
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
                reloadAction
                    ? h(
                          'button',
                          {
                              type: 'button',
                              disabled: status === 'reloading',
                              'aria-busy': status === 'reloading',
                              onClick: reloadScreen,
                          },
                          reloadAction.label
                      )
                    : null,
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
