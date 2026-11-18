import {
    createElement as h,
    lazy,
    Suspense,
    useEffect,
    useId,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type ReactElement,
} from 'react';

const FieldTooltipPopup = lazy(() => import('./fieldTooltipPopup.js'));

export function PortalGridCellGuidance(props: {
    label: string;
    text: string;
}): ReactElement {
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined
    );
    const [open, setOpen] = useState(false);
    const [ready, setReady] = useState(false);

    function cancelClose() {
        clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
    }
    function show() {
        cancelClose();
        setOpen(true);
    }
    function hide() {
        cancelClose();
        setOpen(false);
    }
    function leave() {
        cancelClose();
        if (trigger.current?.ownerDocument.activeElement === trigger.current)
            return;
        // Leave time to move between the trigger and the portal.
        closeTimer.current = setTimeout(hide, 150);
    }
    useEffect(() => () => clearTimeout(closeTimer.current), []);

    return h(
        'span',
        {
            className: 'mx-sdk-portal-grid-cell__guidance',
            onMouseEnter: show,
            onMouseLeave: leave,
            onClick: (event: MouseEvent) => event.stopPropagation(),
        },
        h(
            'button',
            {
                ref: trigger,
                type: 'button',
                className: 'mx-sdk-field-tooltip-trigger',
                'aria-label': props.label,
                'aria-describedby': open && ready ? id : undefined,
                onClick: show,
                onFocus: show,
                onBlur: hide,
                onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        hide();
                    }
                },
            },
            h('span', { 'aria-hidden': true }, 'ⓘ')
        ),
        open
            ? h(
                  Suspense,
                  { fallback: null },
                  h(
                      FieldTooltipPopup,
                      {
                          id,
                          onReadyChange: setReady,
                          anchorRef: trigger,
                          onOpenChange: setOpen,
                          onMouseEnter: show,
                          onMouseLeave: leave,
                      },
                      props.text
                  )
              )
            : null
    );
}
