import {
    createElement as h,
    type CSSProperties,
    type ReactElement,
} from 'react';
import type { ReadonlyPortalGridRowHeight } from './ReadonlyPortalGrid.js';

export type PortalGridEmptyCellProps = Readonly<{
    rowHeight: ReadonlyPortalGridRowHeight;
    lastRow?: boolean;
    /** The first column’s left offset in pixels on wider screens. */
    stickyLeft?: number;
}>;

/** Preserves an empty column slot in a host Grid row. */
export function PortalGridEmptyCell({
    rowHeight,
    lastRow,
    stickyLeft,
}: PortalGridEmptyCellProps): ReactElement {
    const style:
        | (CSSProperties & { '--mx-sdk-grid-empty-left': string })
        | undefined =
        stickyLeft == null
            ? undefined
            : { '--mx-sdk-grid-empty-left': `${stickyLeft}px` };

    return h(
        'td',
        {
            className: 'mx-sdk-portal-grid-empty-cell',
            'data-last-row': lastRow,
            'data-sticky': stickyLeft != null,
            style,
        },
        h('div', {
            className: 'mx-sdk-portal-grid-empty-cell__content',
            'data-row-height': rowHeight,
        })
    );
}
