import {
    createElement as h,
    lazy,
    Suspense,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type ReactElement,
} from 'react';

const FieldTooltipPopup = lazy(() => import('./fieldTooltipPopup.js'));

export function PortalGridCellGuidance(props: {
    cellIdentity: unknown;
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
    const commitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        // A recycled cell must not carry help or focus to the next record.
        const button = trigger.current;
        if (button && button.ownerDocument.activeElement === button)
            button.blur();
        cancelClose();
        setOpen(false);
        setReady(false);
    }, [props.cellIdentity]);

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
                onMouseDown: (event: MouseEvent<HTMLButtonElement>) => {
                    if (event.button === 0) event.preventDefault();
                },
                onClick: (event: MouseEvent<HTMLButtonElement>) => {
                    const button = event.currentTarget;
                    // A pointer click keeps the selected cell ready for copy.
                    // Keyboard activation leaves focus on the help button.
                    if (
                        event.detail > 0 &&
                        !button.ownerDocument.getSelection()?.toString()
                    ) {
                        button.closest('td')?.focus({ preventScroll: true });
                    }
                    show();
                },
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
            // Match the native Cell's Lucide React 0.417 Info outline.
            h(
                'svg',
                {
                    'aria-hidden': true,
                    focusable: 'false',
                    width: 24,
                    height: 24,
                    viewBox: '0 0 24 24',
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 2,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                },
                h('circle', { cx: 12, cy: 12, r: 10 }),
                h('path', { d: 'M12 16v-4' }),
                h('path', { d: 'M12 8h.01' })
            )
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
                          keepOpenOnAnchorInteraction: true,
                      },
                      props.text
                  )
              )
            : null
    );
}
