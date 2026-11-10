import {
    createElement as h,
    useId,
    useRef,
    useState,
    type CSSProperties,
    type FormEvent,
    type ReactNode,
} from 'react';
import { TextInput } from './TextInput.js';

export type CompleteVerificationScreenLabels = {
    sentCodeTo: string;
    enterCode: string;
    continue: string;
    reload: string;
    attemptsExhausted: string;
    loading: string;
};

export type CompleteVerificationScreenProps<Result> = {
    verificationId: string;
    /** Already masked by the host. The SDK does not inspect contact details. */
    maskedDestination: string;
    labels: CompleteVerificationScreenLabels;
    /** Captured at submit; the host owns language, transport and error policy. */
    confirm: (input: {
        verificationId: string;
        verificationCode: string;
    }) => Promise<Result>;
    /** Receives the identical opaque result, never a reconstructed grant. */
    continueWithResult: (result: Result) => Promise<void>;
    reload: () => void;
    /** Nonthrowing host observer; do not log codes or private service results. */
    onError?: (error: Error) => void;
    /** Pure display adapter; exhaustion matching still uses the original message. */
    formatErrorMessage?: (message: string) => string;
    /** Optional app-level timeout/help decoration, mounted only while pending. */
    pendingDetails?: ReactNode;
    inputId?: string;
    className?: string;
    accentColor?: string;
};

/**
 * Complete native-compatible confirmation/continuation UI. This is deliberately
 * separate from createAuthFlow and its one-use grants. No transport, storage,
 * session application, automatic retry or cancellation is introduced here.
 */
export function CompleteVerificationScreen<Result>(
    props: CompleteVerificationScreenProps<Result>
) {
    const generatedId = useId();
    const inputId = props.inputId ?? `mx-verification-${generatedId}`;
    const [code, setCode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    // Private component memory only. Never expose this via a hook snapshot,
    // DOM attributes, diagnostics, storage or a serialized application state.
    const confirmed = useRef<{
        verificationId: string;
        result: Result;
    } | null>(null);

    async function confirmAndContinue() {
        try {
            setPending(true);
            let cached = confirmed.current;
            if (
                cached === null ||
                cached.verificationId !== props.verificationId
            ) {
                const result = await props.confirm({
                    verificationId: props.verificationId,
                    verificationCode: code,
                });
                cached = { verificationId: props.verificationId, result };
                // Store before continuation: it may apply side effects and then
                // reject. An explicit retry must not confirm this challenge again.
                confirmed.current = cached;
            }
            // Use this admitted render's closure, not a latest-callback ref.
            // Native pending work is not cancelled by prop changes or unmount.
            await props.continueWithResult(cached.result);
            // Success stays pending until the host replaces/unmounts the screen.
        } catch (failure) {
            const normalized =
                failure instanceof Error ? failure : new Error(String(failure));
            props.onError?.(normalized);
            setPending(false);
            setError(normalized.message);
        }
    }

    const style = {
        '--mx-sdk-verification-accent': props.accentColor,
    } as CSSProperties;
    const className = ['mx-sdk-verification', props.className]
        .filter(Boolean)
        .join(' ');
    if (pending)
        return h(
            'div',
            { className, style },
            h(
                'div',
                {
                    className: 'mx-sdk-verification-loading',
                    role: 'status',
                    'aria-live': 'polite',
                },
                h('span', {
                    className: 'mx-sdk-verification-spinner',
                    'aria-hidden': true,
                }),
                h(
                    'span',
                    { className: 'mx-sdk-verification-sr-only' },
                    props.labels.loading
                )
            ),
            props.pendingDetails
        );

    const exhausted = error === props.labels.attemptsExhausted;
    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (exhausted) props.reload();
        else void confirmAndContinue();
    }
    return h(
        'form',
        { className, style, onSubmit: submit },
        h(
            'p',
            { className: 'mx-sdk-verification-destination' },
            `${props.labels.sentCodeTo} ${props.maskedDestination}.`
        ),
        h(
            'label',
            { htmlFor: inputId, className: 'mx-sdk-verification-sr-only' },
            props.labels.enterCode
        ),
        h(TextInput, {
            id: inputId,
            type: 'text',
            pattern: '\\d*',
            placeholder: props.labels.enterCode,
            className: 'mx-sdk-verification-input',
            value: code,
            onChange: (event) => setCode(event.target.value),
        }),
        error
            ? h(
                  'p',
                  { className: 'mx-sdk-verification-error', role: 'alert' },
                  props.formatErrorMessage?.(error) ?? error
              )
            : null,
        // ActionButton forces type=button. Verification requires real native
        // form submission/Enter and the browser's ordinary pattern validation.
        h(
            'button',
            {
                type: 'submit',
                className: 'mx-sdk-verification-submit',
                disabled: !code,
            },
            exhausted ? props.labels.reload : props.labels.continue
        )
    );
}
