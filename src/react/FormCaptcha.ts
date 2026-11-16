import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import {
    mountFormCaptcha,
    type FormCaptchaHost,
    type FormCaptchaState,
} from '../ui/formCaptcha.js';

export type FormCaptchaLabels = {
    title?: string;
    preview?: string;
    loading?: string;
    unavailable?: string;
};

export type FormCaptchaProps<T = string, Options = unknown> = {
    className?: string;
    labels?: FormCaptchaLabels;
} & (
    | { mode: 'preview'; host?: never }
    | { mode: 'controlled'; host: FormCaptchaHost<T, Options> }
);

/** Complete visible widget lifecycle. Preview/SSR never load a provider. */
export function FormCaptcha<T = string, Options = unknown>(
    props: FormCaptchaProps<T, Options>
): ReactNode {
    const container = useRef<HTMLDivElement>(null);
    const lifecycle = useRef<ReturnType<
        typeof mountFormCaptcha<T, Options>
    > | null>(null);
    const [state, setState] = useState<FormCaptchaState>('loading');
    const committedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    committedEffect(() => {
        if (props.mode !== 'controlled' || !container.current) return;
        const mounted = mountFormCaptcha(
            container.current,
            props.host,
            setState
        );
        lifecycle.current = mounted;
        return () => {
            lifecycle.current = null;
            mounted.dispose();
        };
    }, [props.mode]);
    committedEffect(() => {
        if (props.mode === 'controlled')
            lifecycle.current?.updateHost(props.host);
    });
    const title = props.labels?.title ?? 'CAPTCHA';
    const preview = props.mode === 'preview';
    const snapshot =
        props.mode === 'controlled' ? props.host.read() : undefined;
    const visible =
        preview ||
        !!(snapshot?.enabled && snapshot.editable && !snapshot.verified);
    return h(
        'section',
        {
            className: ['mx-sdk-form-captcha', props.className]
                .filter(Boolean)
                .join(' '),
            'aria-label': title,
            'data-state': preview ? 'preview' : state,
            hidden: !visible || (!preview && state === 'hidden'),
        },
        preview
            ? h(
                  'div',
                  {
                      className: 'mx-sdk-form-captcha-preview',
                      'aria-disabled': true,
                  },
                  h('span', {
                      className: 'mx-sdk-form-captcha-checkbox',
                      'aria-hidden': true,
                  }),
                  props.labels?.preview ?? 'CAPTCHA preview'
              )
            : [
                  h('div', {
                      key: 'widget',
                      ref: container,
                      className: 'mx-sdk-form-captcha-widget',
                  }),
                  state === 'loading' || state === 'unavailable'
                      ? h(
                            'p',
                            {
                                key: 'status',
                                role: 'status',
                                className: 'mx-sdk-form-captcha-status',
                            },
                            state === 'loading'
                                ? (props.labels?.loading ?? 'Loading CAPTCHA…')
                                : (props.labels?.unavailable ??
                                      'CAPTCHA is unavailable.')
                        )
                      : null,
              ]
    );
}
