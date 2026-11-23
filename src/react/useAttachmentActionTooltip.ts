import {
    createElement as h,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type FocusEventHandler,
    type PointerEventHandler,
    type ReactPortal,
} from 'react';

const opened = 'tooltip.open';
const offset = 8;
const className = 'mx-sdk-attachment-action-tooltip';
type Portal = (typeof import('react-dom'))['createPortal'];
type AttachmentActionTooltip = {
    triggerRef(node: HTMLElement | null): void;
    show(): void;
    tooltip: ReactPortal | null;
    triggerProps: {
        'aria-describedby': string | undefined;
        onFocus: FocusEventHandler<HTMLElement>;
        onBlur(): void;
        onPointerMove: PointerEventHandler<HTMLElement>;
        onPointerLeave: PointerEventHandler<HTMLElement>;
        onPointerDown: PointerEventHandler<HTMLElement>;
    };
};

function containsEventTarget(
    container: HTMLElement | null,
    target: EventTarget | null
) {
    const Node = container?.ownerDocument.defaultView?.Node;
    return (
        Node != null &&
        target instanceof Node &&
        container?.contains(target) === true
    );
}

export function useAttachmentActionTooltip(
    label: string,
    suspended = false
): AttachmentActionTooltip {
    const id = useId();
    const trigger = useRef<HTMLElement | null>(null);
    const popup = useRef<HTMLDivElement>(null);
    const pointerDown = useRef<(() => void) | null>(null);
    const pointerMoved = useRef(false);
    const restoringFocus = useRef(false);
    const [open, setOpen] = useState(false);
    const [portal, setPortal] = useState<Portal | null>(null);
    const [position, setPosition] = useState<{
        left: number;
        top: number;
        side: 'top' | 'bottom';
    } | null>(null);
    const useCommitEffect =
        typeof window === 'undefined' ? useEffect : useLayoutEffect;

    const close = useCallback(() => {
        setOpen(false);
        setPosition(null);
    }, []);
    const show = useCallback(() => {
        if (!suspended) setOpen(true);
    }, [suspended]);
    const triggerRef = useCallback((node: HTMLElement | null) => {
        trigger.current = node;
    }, []);

    useEffect(() => () => pointerDown.current?.(), []);
    useCommitEffect(() => {
        if (!suspended) return;
        const anchor = trigger.current;
        // The higher dialog returns to this control when it closes. That
        // restoration is not a new tooltip activation.
        restoringFocus.current =
            anchor != null && anchor.ownerDocument.activeElement === anchor;
        close();
    }, [suspended, close]);
    useEffect(() => {
        if (!open || portal != null) return;
        let current = true;
        void import('react-dom').then(
            ({ createPortal }) => {
                if (current) setPortal(() => createPortal);
            },
            () => {
                if (current) close();
            }
        );
        return () => {
            current = false;
        };
    }, [open, portal, close]);

    useCommitEffect(() => {
        if (!open || suspended || trigger.current == null) return;
        const anchor = trigger.current;
        const document = anchor.ownerDocument;
        const view = document.defaultView;
        if (view == null) return;
        // Native tooltips and this portalled tooltip share the same open signal.
        document.dispatchEvent(new view.CustomEvent(opened));
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            close();
        };
        const scroll = (event: Event) => {
            const target = event.target;
            if (target instanceof view.Node && target.contains(anchor)) close();
        };
        const outsidePointer = (event: PointerEvent) => {
            if (
                !containsEventTarget(anchor, event.target) &&
                !containsEventTarget(popup.current, event.target)
            )
                close();
        };
        document.addEventListener(opened, close);
        document.addEventListener('keydown', escape);
        document.addEventListener('pointerdown', outsidePointer);
        view.addEventListener('scroll', scroll, true);
        return () => {
            document.removeEventListener(opened, close);
            document.removeEventListener('keydown', escape);
            document.removeEventListener('pointerdown', outsidePointer);
            view.removeEventListener('scroll', scroll, true);
        };
    }, [open, suspended, close]);

    useCommitEffect(() => {
        const anchor = trigger.current;
        const box = popup.current;
        const view = anchor?.ownerDocument.defaultView;
        if (!open || suspended || !portal || !anchor || !box || !view) return;
        const measure = () => {
            const target = anchor.getBoundingClientRect();
            const { width, height } = box.getBoundingClientRect();
            const below = target.bottom + offset;
            const above = target.top - offset - height;
            const side =
                below + height > view.innerHeight && above >= 0
                    ? 'top'
                    : 'bottom';
            const left = Math.max(
                0,
                Math.min(
                    target.left + (target.width - width) / 2,
                    view.innerWidth - width
                )
            );
            setPosition({ left, top: side === 'top' ? above : below, side });
        };
        measure();
        view.addEventListener('resize', measure);
        return () => view.removeEventListener('resize', measure);
    }, [open, suspended, portal, label]);

    const onFocus: FocusEventHandler<HTMLElement> = () => {
        if (restoringFocus.current) {
            restoringFocus.current = false;
            return;
        }
        if (pointerDown.current == null) show();
    };
    const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
        close();
        const view = event.currentTarget.ownerDocument.defaultView;
        pointerDown.current?.();
        if (view == null) return;
        const release = () => {
            pointerDown.current = null;
            view.removeEventListener('pointerup', release);
            view.removeEventListener('pointercancel', release);
            view.removeEventListener('blur', release);
        };
        pointerDown.current = release;
        view.addEventListener('pointerup', release);
        view.addEventListener('pointercancel', release);
        view.addEventListener('blur', release);
    };
    const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
        if (suspended || event.pointerType === 'touch' || pointerMoved.current)
            return;
        pointerMoved.current = true;
        show();
    };
    const onPointerLeave: PointerEventHandler<HTMLElement> = (event) => {
        pointerMoved.current = false;
        if (!containsEventTarget(popup.current, event.relatedTarget)) close();
    };
    const document = trigger.current?.ownerDocument;
    const tooltip =
        open && !suspended && portal && document
            ? portal(
                  h(
                      'div',
                      {
                          ref: popup,
                          id,
                          role: 'tooltip',
                          className,
                          'data-side': position?.side,
                          style: position
                              ? { left: position.left, top: position.top }
                              : { visibility: 'hidden' },
                          onPointerLeave: (
                              event: import('react').PointerEvent<HTMLDivElement>
                          ) => {
                              if (
                                  !containsEventTarget(
                                      trigger.current,
                                      event.relatedTarget
                                  )
                              )
                                  close();
                          },
                      },
                      label
                  ),
                  document.body
              )
            : null;

    return {
        triggerRef,
        show,
        tooltip,
        triggerProps: {
            'aria-describedby': tooltip ? id : undefined,
            onFocus,
            onBlur: close,
            onPointerMove,
            onPointerLeave,
            onPointerDown,
        },
    };
}
