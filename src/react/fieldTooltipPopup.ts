import {
    createElement as h,
    useCallback,
    useEffect,
    type KeyboardEvent,
    type ReactElement,
    type ReactNode,
    type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import {
    DatePopover,
    DatePopoverAnchor,
    DatePopoverContent,
} from './datePopoverRuntime.js';
import { fieldHelpTabStops } from './fieldPresentation.js';

/** Optional portal/collision primitive, loaded only for an opened tooltip. */
export default function FieldTooltipPopup(props: {
    id: string;
    onReadyChange: (ready: boolean) => void;
    anchorRef: RefObject<HTMLButtonElement>;
    onOpenChange: (open: boolean) => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    admitDescription?: () => boolean;
    keepOpenOnAnchorInteraction?: boolean;
    gridHeaderKeyboard?: boolean;
    className?: string;
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
    const leaveGridHeaderHelp = (event: KeyboardEvent<HTMLDivElement>) => {
        if (
            event.key !== 'Tab' ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.defaultPrevented
        )
            return;
        const anchor = props.anchorRef.current;
        const controls = fieldHelpTabStops(event.currentTarget);
        const boundary = event.shiftKey ? controls[0] : controls.at(-1);
        if (!anchor || event.target !== boundary) return;
        event.stopPropagation();
        anchor.focus({ preventScroll: true });
        if (event.shiftKey) {
            event.preventDefault();
        } else {
            // Remove the portal before native Tab advances from the anchor.
            flushSync(() => props.onOpenChange(false));
        }
    };
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
                className: props.className ?? 'mx-sdk-field-tooltip-popup',
                onOpenAutoFocus: (event: Event) => event.preventDefault(),
                onCloseAutoFocus: (event: Event) => event.preventDefault(),
                onMouseEnter: props.onMouseEnter,
                onMouseLeave: props.onMouseLeave,
                onKeyDownCapture: props.gridHeaderKeyboard
                    ? leaveGridHeaderHelp
                    : undefined,
                onEscapeKeyDown: () => {
                    const anchor = props.anchorRef.current;
                    const document = anchor?.ownerDocument;
                    if (
                        props.gridHeaderKeyboard &&
                        document
                            ?.getElementById(props.id)
                            ?.contains(document.activeElement)
                    )
                        anchor?.focus({ preventScroll: true });
                    props.onOpenChange(false);
                },
                onInteractOutside: props.keepOpenOnAnchorInteraction
                    ? (event) => {
                          const anchor = props.anchorRef.current;
                          const Node = anchor?.ownerDocument.defaultView?.Node;
                          if (
                              Node &&
                              event.target instanceof Node &&
                              anchor?.contains(event.target)
                          ) {
                              event.preventDefault();
                          }
                      }
                    : undefined,
            },
            h('div', { ref: markReady }, props.children)
        )
    );
}
