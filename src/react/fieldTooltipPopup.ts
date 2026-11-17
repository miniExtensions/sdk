import {
    createElement as h,
    useCallback,
    useEffect,
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
    admitDescription?: () => boolean;
    children?: ReactNode;
}): ReactElement | null {
    const markReady = useCallback(
        (node: HTMLDivElement | null) => {
            props.onReadyChange(node != null);
        },
        [props.onReadyChange]
    );
    let admitted = false;
    try {
        admitted =
            props.admitDescription == null || props.admitDescription() === true;
    } catch {
        // A retired or unavailable host cannot mount delayed description media.
    }
    useEffect(() => {
        if (!admitted) props.onOpenChange(false);
    }, [admitted, props.onOpenChange]);
    if (!admitted) return null;
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
