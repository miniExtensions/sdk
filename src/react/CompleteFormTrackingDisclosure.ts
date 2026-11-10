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
                        d: 'M2.25 12a9.75 9.75 0 1 1 19.5 0 9.75 9.75 0 0 1-19.5 0Zm9-4.5a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm-.75 3a.75.75 0 0 0 0 1.5h.75v3h-.75a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5h-.75v-3.75a.75.75 0 0 0-.75-.75H10.5Z',
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
