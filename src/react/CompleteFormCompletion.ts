import {
    createElement as h,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type ReactElement,
} from 'react';
import { Options as LinkifyOptions, tokenize } from 'linkifyjs';
import {
    type FormCompletionDispatchReceipt,
    createFormCompletionCountdown,
} from '../forms/completionCountdown.js';
import type {
    FormCompletionConfiguration,
    FormCompletionProjection,
} from '../forms/completion.js';
import { CompleteQuillHTMLRenderer } from './html/CompleteQuillHTMLRenderer.js';

export type FormCompletionAction =
    | 'close'
    | 'automatic_new_form'
    | 'copy_form'
    | 'submit_another_form'
    | 'navigate';

export function useFormCompletionCountdown({
    start = 2,
    onComplete,
}: {
    start?: number;
    onComplete: () => void;
    onBeforeComplete?: () => void;
}) {
    const [controller] = useState(() =>
        createFormCompletionCountdown({
            start,
            onComplete: () => {},
            attached: false,
        })
    );
    useEffect(() => {
        controller.update({ start, onComplete: () => {} });
    }, [controller, start, onComplete]);
    useEffect(() => controller.attach(), [controller]);
    const snapshot = useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
        controller.getSnapshot
    );
    const dispatched = useRef<typeof snapshot>();
    useEffect(() => {
        if (snapshot.status !== 'completed' || dispatched.current === snapshot)
            return;
        dispatched.current = snapshot;
        onComplete();
    }, [snapshot, onComplete]);
    return {
        count: snapshot.count,
        status: snapshot.status,
        start: controller.start,
        stop: controller.stop,
        reset: controller.reset,
    };
}

export type CompleteFormCompletionMessageProps = {
    message: FormCompletionProjection['message'];
    delay?: number | null;
};

/** The message delay belongs to this mounted body, independently of the action clock. */
export function CompleteFormCompletionMessage({
    message,
    delay,
}: CompleteFormCompletionMessageProps): ReactElement {
    const [initialDelay] = useState(delay);
    const [waiting, setWaiting] = useState(initialDelay != null);
    useEffect(() => {
        if (initialDelay == null || !waiting) return;
        const timer = setTimeout(() => setWaiting(false), initialDelay * 1000);
        return () => clearTimeout(timer);
    }, [initialDelay, waiting]);
    if (waiting)
        return h(
            'span',
            {
                role: 'status',
                'aria-label': 'Loading',
                className: 'mx-sdk-form-completion-spinner',
                'data-testid': 'spinner',
            },
            h('span', { className: 'mx-sdk-completion-sr-only' }, 'Loading...')
        );
    if (message.format === 'html')
        return h(CompleteQuillHTMLRenderer, { html: message.text });
    const options = new LinkifyOptions({
        target: '_blank',
        rel: 'noopener noreferrer',
    });
    return h(
        'p',
        { className: 'mx-sdk-form-completion-text' },
        tokenize(message.text).map((token, index) => {
            if (!token.isLink || !options.check(token)) return token.toString();
            const link = options.resolve(token);
            return h(
                'a',
                {
                    key: index,
                    href: link.formattedHref,
                    target: link.target || undefined,
                    rel: link.rel || undefined,
                },
                link.formatted
            );
        })
    );
}

export type CompleteFormCompletionProps = {
    projection: FormCompletionProjection;
    configuration: FormCompletionConfiguration;
    canSubmit: boolean;
    onCommand: (
        command: FormCompletionAction
    ) =>
        | void
        | FormCompletionDispatchReceipt
        | Promise<void | FormCompletionDispatchReceipt>;
    /** Current host ownership, without granting Save or navigation authority. */
    isCurrent?: () => boolean;
    onError?: (error: unknown) => void;
    className?: string;
};

/** Full stock completion presenter. Hosts provide data and authorized effects only. */
export function CompleteFormCompletion(
    props: CompleteFormCompletionProps
): ReactElement {
    const { projection, configuration, canSubmit } = props;
    const [didAttemptClose, setDidAttemptClose] = useState(false);
    const didStart = useRef(false);
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const report = (error: unknown) => {
        try {
            props.onError?.(error);
        } catch {
            /* Reporting cannot retry an effect. */
        }
    };
    const dispatch = async (command: FormCompletionAction) => {
        let attempted = false;
        try {
            if (!mounted.current || props.isCurrent?.() === false) return;
            attempted = true;
            const result = props.onCommand(command);
            const receipt =
                result != null && 'then' in result ? await result : result;
            if (
                command === 'close' &&
                mounted.current &&
                (receipt == null || receipt.attempted > 0)
            )
                setDidAttemptClose(true);
            if (receipt?.status === 'failed') report(receipt.error);
        } catch (error) {
            if (attempted && command === 'close' && mounted.current)
                setDidAttemptClose(true);
            report(error);
        }
    };
    const countdown = useFormCompletionCountdown({
        start: projection.duration,
        onComplete: () => {
            const action = projection.action;
            void dispatch(
                action === 'close'
                    ? 'close'
                    : action === 'newForm'
                      ? 'automatic_new_form'
                      : 'navigate'
            );
        },
    });
    useEffect(() => {
        if (canSubmit && projection.action !== 'none' && !didStart.current) {
            didStart.current = true;
            countdown.start();
        }
    }, [canSubmit, projection.action, countdown.start]);
    const body = configuration.successAction
        ? h(CompleteFormCompletionMessage, {
              message: projection.message,
              delay: configuration.successMessageDelay,
          })
        : null;
    const close = projection.action === 'close';
    const logout = projection.action === 'logout';
    const buttons =
        !close &&
        !logout &&
        (projection.canSubmitAnother || projection.canCopy);
    const redirectText =
        !close && !logout && !buttons
            ? configuration.afterFormSubmission === 'newForm'
                ? projection.labels.redirectingToNewForm
                : projection.redirectURL
                  ? projection.labels.redirecting
                  : null
            : null;
    return h(
        'div',
        {
            role: 'alert',
            'data-testid': 'alert-test-id',
            className: ['mx-sdk-form-completion', props.className]
                .filter(Boolean)
                .join(' '),
        },
        h(
            'svg',
            {
                className: 'mx-sdk-form-completion-icon',
                viewBox: '0 0 20 20',
                fill: 'currentColor',
                'aria-hidden': true,
            },
            h('path', {
                fillRule: 'evenodd',
                d: 'M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z',
                clipRule: 'evenodd',
            })
        ),
        h(
            'div',
            { className: 'mx-sdk-form-completion-content' },
            !close && !logout && !buttons && body ? h('div', null, body) : body,
            close
                ? h(
                      'p',
                      null,
                      didAttemptClose
                          ? projection.labels.canClose
                          : projection.labels.closing
                  )
                : null,
            buttons
                ? h(
                      'div',
                      { className: 'mx-sdk-form-completion-actions' },
                      projection.canSubmitAnother &&
                          projection.labels.submitAnother
                          ? h(
                                'button',
                                {
                                    type: 'button',
                                    disabled: !canSubmit,
                                    onClick: () => {
                                        void dispatch('submit_another_form');
                                    },
                                },
                                projection.labels.submitAnother
                            )
                          : null,
                      projection.canCopy && projection.labels.copySubmitted
                          ? h(
                                'button',
                                {
                                    type: 'button',
                                    disabled: !canSubmit,
                                    onClick: () => {
                                        void dispatch('copy_form');
                                    },
                                },
                                projection.labels.copySubmitted
                            )
                          : null
                  )
                : null,
            redirectText
                ? h(
                      'p',
                      {
                          className: body
                              ? 'mx-sdk-form-completion-status'
                              : undefined,
                      },
                      redirectText
                  )
                : null
        )
    );
}
