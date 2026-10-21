import { ActionButton } from './ActionButton.js';
import {
    createElement,
    useId,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import type { ButtonFieldRenderProps } from '../ui/buttonModel.js';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';
import type { RuntimeLanguage } from '../runtime/types.js';
import { buttonMessages, type ButtonFieldMessages } from './buttonMessages.js';

export type { ButtonFieldMessages } from './buttonMessages.js';
export type ButtonFieldProps = ButtonFieldRenderProps & {
    /** Optional presentation overrides; configured feedback still wins. */
    messages?: Partial<ButtonFieldMessages>;
    className?: string;
};
const stop = (event: SyntheticEvent) => event.stopPropagation();
const noValue = (text: string, className?: string) =>
    createElement(
        'span',
        {
            className: ['mx-sdk-button-empty', className]
                .filter(Boolean)
                .join(' '),
        },
        createElement('span', { 'aria-hidden': true }, '⊘'),
        text
    );

/** Pure presentation of an accepted model snapshot. No model lifetime or effects. */
export function ButtonField(props: ButtonFieldProps): ReactNode {
    const id = useId();
    if (props.phase === 'retired' || props.field === null) return null;
    const messages = {
        ...buttonMessages[props.language ?? 'en'],
        ...props.messages,
    };
    if (props.value === null) return noValue(messages.noValue, props.className);
    const link = props.canLink ? props.prepareLink() : null;
    const webhook =
        props.config?.openLinkType === 'triggerWebhookGET' ||
        props.config?.openLinkType === 'triggerWebhookPOST';
    const feedback =
        props.feedback === null
            ? null
            : (props.feedback.text ?? messages[props.feedback.kind]);
    const label = props.value.label.trim()
        ? props.value.label
        : props.field.name;
    const common = {
        id,
        className: 'mx-sdk-button',
        'data-color': props.config?.buttonColor,
        'aria-describedby': feedback ? `${id}-feedback` : undefined,
    };
    // Keep native link semantics, but revalidate the captured capability at activation.
    // Never derive an href from the raw value or replace stale props with fresh authority.
    const validateLink = (event: SyntheticEvent<HTMLAnchorElement>) => {
        event.stopPropagation();
        const current = props.prepareLink();
        if (
            !link ||
            !current ||
            current.href !== link.href ||
            current.target !== link.target
        ) {
            event.preventDefault();
            event.currentTarget.removeAttribute('href');
        }
    };
    const content = (busy: boolean) =>
        createElement(
            'span',
            { className: 'mx-sdk-button-content' },
            busy
                ? createElement('span', {
                      className: 'mx-sdk-button-spinner',
                      'aria-hidden': true,
                  })
                : null,
            createElement('span', null, label)
        );
    return createElement(
        'span',
        {
            className: ['mx-sdk-button-field', props.className]
                .filter(Boolean)
                .join(' '),
            onClick: stop,
            onAuxClick: stop,
            onDoubleClick: stop,
            onPointerDown: stop,
            onKeyDown: stop,
            onKeyUp: stop,
        },
        webhook
            ? createElement(
                  ActionButton,
                  {
                      ...common,
                      busy: props.busy,
                      busyContent: content(true),
                      disabled: !props.canTrigger,
                      onClick: (event: SyntheticEvent) => {
                          event.stopPropagation();
                          void props.triggerWebhook();
                      },
                  },
                  content(false)
              )
            : createElement(
                  'a',
                  {
                      ...common,
                      'aria-busy': props.busy,
                      href: link?.href,
                      target: link?.target,
                      rel: link?.rel,
                      role: link ? undefined : 'link',
                      'aria-disabled': !link || undefined,
                      onClick: validateLink,
                      onAuxClick: validateLink,
                      onContextMenu: validateLink,
                  },
                  content(props.busy)
              ),
        // Declarative feedback avoids toast/alert effects being replayed by StrictMode.
        createElement(
            'span',
            {
                id: `${id}-feedback`,
                role: 'status',
                'aria-live': 'polite',
                'aria-atomic': true,
                className: 'mx-sdk-button-feedback',
                'data-kind': props.feedback?.kind,
            },
            feedback
        )
    );
}

/** Shared Form/Grid/List slot. Readonly values never acquire action capability. */
export function renderButtonField(
    props: FieldRendererProps<'button'>,
    options: {
        language?: RuntimeLanguage;
        messages?: Partial<ButtonFieldMessages>;
        className?: string;
    } = {}
): ReactNode {
    if (props.capability.type === 'button')
        return createElement(ButtonField, {
            ...props.capability.button,
            messages: options.messages,
            className: options.className,
        });
    if (props.value == null)
        return noValue(
            options.messages?.noValue ??
                buttonMessages[options.language ?? 'en'].noValue,
            options.className
        );
    return createElement(
        'span',
        {
            className: ['mx-sdk-button-field', options.className]
                .filter(Boolean)
                .join(' '),
            onClick: stop,
            onAuxClick: stop,
            onPointerDown: stop,
            onKeyDown: stop,
            onKeyUp: stop,
        },
        createElement(
            ActionButton,
            {
                className: 'mx-sdk-button',
                ...{
                    'data-color':
                        props.displayConfig &&
                        'buttonColor' in props.displayConfig
                            ? props.displayConfig.buttonColor
                            : undefined,
                },
                disabled: true,
            },
            props.value.label.trim() ? props.value.label : props.title
        )
    );
}
