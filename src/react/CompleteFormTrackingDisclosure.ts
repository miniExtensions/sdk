import type * as React from 'react';
import { createElement as h, Fragment } from 'react';
import type { EffectiveFormTracking } from '../forms/tracking.js';

export type FormTrackingDisclosureLabels = Readonly<{
    ipAddress: string;
    location: string;
}>;
export type CompleteFormTrackingDisclosureProps = Readonly<{
    policy: EffectiveFormTracking;
    labels: FormTrackingDisclosureLabels;
    isLastPage: boolean;
    readOnly: boolean;
    preview: boolean;
    className?: string;
}>;

/** Full portable disclosure presentation. No browser, permission or Save effect. */
export function CompleteFormTrackingDisclosure(
    props: CompleteFormTrackingDisclosureProps
) {
    if (!props.isLastPage || props.readOnly || props.preview) return null;
    function notice(message: string) {
        return h(
            'div',
            {
                role: 'alert',
                className: ['mx-sdk-form-tracking', props.className]
                    .filter(Boolean)
                    .join(' '),
            },
            h(
                'div',
                { className: 'mx-sdk-form-tracking-row' },
                h(
                    'svg',
                    {
                        className: 'mx-sdk-form-tracking-icon',
                        viewBox: '0 0 24 24',
                        fill: 'currentColor',
                        'aria-hidden': true,
                    },
                    h('path', {
                        fillRule: 'evenodd',
                        d: 'M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 0 1 .67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 1 1-.671-1.34l.041-.022ZM12 9a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z',
                        clipRule: 'evenodd',
                    })
                ),
                h('div', { className: 'mx-sdk-form-tracking-message' }, message)
            )
        );
    }
    return h(
        Fragment,
        null,
        props.policy.collectIPAddress ? notice(props.labels.ipAddress) : null,
        props.policy.collectLocation ? notice(props.labels.location) : null
    );
}
