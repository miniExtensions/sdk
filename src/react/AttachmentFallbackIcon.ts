import { createElement as h, type ReactElement } from 'react';

export function AttachmentFallbackIcon({
    play,
}: {
    play: boolean;
}): ReactElement {
    // Native Heroicons solid Play/Document geometry; MIT, see THIRD_PARTY_NOTICES.
    return h(
        'svg',
        {
            viewBox: '0 0 24 24',
            fill: 'currentColor',
            'aria-hidden': true,
        },
        play
            ? h('path', {
                  fillRule: 'evenodd',
                  clipRule: 'evenodd',
                  d: 'M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z',
              })
            : [
                  h('path', {
                      key: 'body',
                      d: 'M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625Z',
                  }),
                  h('path', {
                      key: 'corner',
                      d: 'M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z',
                  }),
              ]
    );
}
