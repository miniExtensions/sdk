/** Private portable popup dependency. Built outputs bundle its supported closure. */
export {
    Root as DatePopover,
    Anchor as DatePopoverAnchor,
} from '@radix-ui/react-popover';
import {
    Content,
    Portal,
    type PopoverContentProps,
} from '@radix-ui/react-popover';
import { createElement as h } from 'react';
import type * as React from 'react';

export function DatePopoverContent({
    container,
    ...props
}: PopoverContentProps & { container?: HTMLElement }): React.ReactElement {
    return h(
        Portal,
        { container },
        h(Content, { sideOffset: 8, collisionPadding: 8, ...props })
    );
}
