import { createElement, type MouseEvent, type ReactElement } from 'react';

export type CompleteReadOnlyPhoneNumberFieldProps = {
    /** Saved text is displayed and linked literally, without phone parsing. */
    value: string | null | undefined;
    /** The host supplies its localized empty-value message. */
    emptyLabel: string;
    /** Optional layout classes on the component root. */
    className?: string;
    /** Optional host cell/list layout classes on the telephone anchor. */
    linkClassName?: string;
};

/** Standalone native telephone presentation; it owns no state or requests. */
export function CompleteReadOnlyPhoneNumberField({
    value,
    emptyLabel,
    className,
    linkClassName,
}: CompleteReadOnlyPhoneNumberFieldProps): ReactElement {
    if (value == null || value === '') {
        return createElement(
            'p',
            {
                className: ['mx-sdk-complete-phone-empty', className]
                    .filter(Boolean)
                    .join(' '),
            },
            createElement(
                'svg',
                {
                    className: 'mx-sdk-complete-phone-empty-icon',
                    width: 16,
                    height: 16,
                    viewBox: '0 0 24 24',
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 1.75,
                    'aria-hidden': true,
                    focusable: 'false',
                },
                createElement('circle', { cx: 12, cy: 12, r: 9 }),
                createElement('path', {
                    d: 'M5.6 5.6l12.8 12.8',
                    strokeLinecap: 'round',
                })
            ),
            emptyLabel
        );
    }

    return createElement(
        'div',
        {
            className: ['mx-sdk-complete-phone-readonly', className]
                .filter(Boolean)
                .join(' '),
        },
        createElement(
            'a',
            {
                className: ['mx-sdk-complete-phone-link', linkClassName]
                    .filter(Boolean)
                    .join(' '),
                href: `tel:${value}`,
                target: '_blank',
                rel: 'noreferrer',
                onClick: (event: MouseEvent<HTMLAnchorElement>) =>
                    event.stopPropagation(),
            },
            value
        )
    );
}
