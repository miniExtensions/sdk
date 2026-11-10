import { createElement as h, useRef, useState, type FormEvent } from 'react';
import type { CompleteVerificationScreenProps } from '../../src/react/CompleteVerificationScreen.js';

/* Frozen native protocol oracle: EmailOrPhoneNumberVerificationView.tsx blob
 * a107ee7efb9dd911835f41035469ab77f4257300. Mechanical bridges only: website
 * transport -> confirm, encrypted result -> generic opaque result, localized
 * string getters -> supplied labels, login/reload/log -> supplied adapters.
 * Native Button/input/Loading/ErrorMessage markup is reduced to native HTML
 * for protocol comparison; this oracle does not certify native styled assembly,
 * shared timeout/help decoration, request serialization or host auth ownership.
 */
export function NativeVerificationOracle<Result>(
    props: CompleteVerificationScreenProps<Result>
) {
    const [code, setCode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const confirmed = useRef<{ verificationId: string; result: Result } | null>(
        null
    );
    const confirm = async () => {
        try {
            setLoading(true);
            const previous = confirmed.current;
            let result: Result;
            if (previous?.verificationId === props.verificationId)
                result = previous.result;
            else {
                result = await props.confirm({
                    verificationId: props.verificationId,
                    verificationCode: code,
                });
                confirmed.current = {
                    verificationId: props.verificationId,
                    result,
                };
            }
            await props.continueWithResult(result);
        } catch (failure) {
            const normalized =
                failure instanceof Error ? failure : new Error(String(failure));
            props.onError?.(normalized);
            setLoading(false);
            setError(normalized.message);
        }
    };
    if (loading) return h('div', { role: 'status' }, props.labels.loading);
    return h(
        'form',
        {
            onSubmit(event: FormEvent<HTMLFormElement>) {
                event.preventDefault();
                if (error === props.labels.attemptsExhausted) props.reload();
                else void confirm();
            },
        },
        h('p', null, `${props.labels.sentCodeTo} ${props.maskedDestination}.`),
        h('label', { htmlFor: 'native-verification' }, props.labels.enterCode),
        h('input', {
            id: 'native-verification',
            type: 'text',
            pattern: '\\d*',
            placeholder: props.labels.enterCode,
            value: code,
            onChange: (event) => setCode(event.target.value),
        }),
        error ? h('p', { role: 'alert' }, error) : null,
        h(
            'button',
            { disabled: !code },
            error === props.labels.attemptsExhausted
                ? props.labels.reload
                : props.labels.continue
        )
    );
}
