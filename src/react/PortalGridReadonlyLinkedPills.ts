import { createElement as h, type ReactElement } from 'react';

export type PortalGridReadonlyLinkedPillsProps = Readonly<{
    /** Ordered display labels resolved by the host for this cell. */
    labels: readonly (string | null)[];
}>;

/** Passive contents of a read-only linked-record Grid cell. */
export function PortalGridReadonlyLinkedPills({
    labels,
}: PortalGridReadonlyLinkedPillsProps): ReactElement {
    return h(
        'ul',
        { className: 'mx-sdk-portal-grid-linked-pills' },
        labels.map((label, index) =>
            label == null || label === ''
                ? null
                : h(
                      'li',
                      {
                          className: 'mx-sdk-portal-grid-linked-pills__pill',
                          key: index,
                      },
                      label
                  )
        )
    );
}
