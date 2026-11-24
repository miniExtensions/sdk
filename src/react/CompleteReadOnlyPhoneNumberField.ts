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
                'data-testid': 'no-value-test-id',
            },
            createElement(
                'svg',
                {
                    className: 'mx-sdk-complete-phone-empty-icon',
                    xmlns: 'http://www.w3.org/2000/svg',
                    width: 16,
                    height: 16,
                    viewBox: '0 0 24 24',
                    fill: 'currentColor',
                    'aria-hidden': true,
                    'data-slot': 'icon',
                    focusable: 'false',
                },
                createElement('path', {
                    fillRule: 'evenodd',
                    clipRule: 'evenodd',
                    d: 'm6.72 5.66 11.62 11.62A8.25 8.25 0 0 0 6.72 5.66Zm10.56 12.68L5.66 6.72a8.25 8.25 0 0 0 11.62 11.62ZM5.105 5.106c3.807-3.808 9.98-3.808 13.788 0 3.808 3.807 3.808 9.98 0 13.788-3.807 3.808-9.98 3.808-13.788 0-3.808-3.807-3.808-9.98 0-13.788Z',
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
