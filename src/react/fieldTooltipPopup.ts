import {
    createElement as h,
    useCallback,
    type ReactElement,
    type ReactNode,
    type RefObject,
} from 'react';
import {
    DatePopover,
    DatePopoverAnchor,
    DatePopoverContent,
} from './datePopoverRuntime.js';

/** Optional portal/collision primitive, loaded only for an opened tooltip. */
export default function FieldTooltipPopup(props: {
    id: string;
    onReadyChange: (ready: boolean) => void;
    anchorRef: RefObject<HTMLButtonElement>;
    onOpenChange: (open: boolean) => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    children?: ReactNode;
}): ReactElement {
    const markReady = useCallback(
        (node: HTMLDivElement | null) => {
            props.onReadyChange(node != null);
        },
        [props.onReadyChange]
    );
    return h(
        DatePopover,
        { open: true, onOpenChange: props.onOpenChange, modal: false },
        h(DatePopoverAnchor, { virtualRef: props.anchorRef }),
        h(
            DatePopoverContent,
            {
                id: props.id,
                role: 'tooltip',
                side: 'bottom',
                className: 'mx-sdk-field-tooltip-popup',
                onOpenAutoFocus: (event: Event) => event.preventDefault(),
                onCloseAutoFocus: (event: Event) => event.preventDefault(),
                onMouseEnter: props.onMouseEnter,
                onMouseLeave: props.onMouseLeave,
                onEscapeKeyDown: () => props.onOpenChange(false),
            },
            h('div', { ref: markReady }, props.children)
        )
    );
}
