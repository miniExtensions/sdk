import { createElement as h, type ReactElement } from 'react';

export const formProgressConflictHeading =
    'Saved progress changed in another tab';
export const formProgressConflictMessage =
    'Your current entries are still here, but this tab will not replace the newer saved progress. Reload this page to continue saving progress from this tab.';

/** Complete native warning presentation. Import form-progress.css. */
export function FormProgressConflictAlert(): ReactElement {
    return h(
        'div',
        {
            role: 'alert',
            'data-testid': 'alert-test-id',
            className: 'mx-sdk-form-progress-conflict',
        },
        h(
            'svg',
            { viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true },
            h('path', {
                fillRule: 'evenodd',
                d: 'M9.401 3.003c1.155-2 4.043-2 5.198 0l8.072 13.98c1.155 2-.289 4.5-2.598 4.5H3.927c-2.31 0-3.753-2.5-2.598-4.5L9.4 3.003ZM12 8a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 12 8Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
                clipRule: 'evenodd',
            })
        ),
        h(
            'div',
            null,
            h('h3', null, formProgressConflictHeading),
            h('p', null, formProgressConflictMessage)
        )
    );
}
