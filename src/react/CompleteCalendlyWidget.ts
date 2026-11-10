import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useRef,
    type CSSProperties,
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent,
    type SyntheticEvent,
} from 'react';
import { ActionButton } from './ActionButton.js';
import {
    useCalendlyBooking,
    type CalendlyBookingOptions,
    type CalendlyBookingSession,
} from './CalendlyBooking.js';

export type CompleteCalendlyWidgetLabels = {
    schedule: string;
    booked: string;
    invalidUrl: string;
    close: string;
};

export type CompleteCalendlyWidgetProps = Omit<
    CalendlyBookingOptions,
    'frameClassName'
> & {
    /** Resolved native custom/localized title; empty falls back to schedule. */
    schedulingTitle?: string | null;
    labels?: Partial<CompleteCalendlyWidgetLabels>;
    className?: string;
    accentColor?: string;
    hoverColor?: string;
    focusColor?: string;
    /** Native hosts may reserve space for their own messenger/decoration. */
    reservedInlineEndWidth?: string;
    zIndex?: number;
};

type CalendlyStyle = CSSProperties & {
    '--mx-sdk-calendly-accent'?: string;
    '--mx-sdk-calendly-hover'?: string;
    '--mx-sdk-calendly-focus'?: string;
    '--mx-sdk-calendly-reserved-inline-end'?: string;
};

function BookingDialog({
    session,
    title,
    closeLabel,
    zIndex,
}: {
    session: CalendlyBookingSession;
    title: string;
    closeLabel: string;
    zIndex?: number;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const overlay = useRef<HTMLDivElement>(null);
    const close = useRef<HTMLButtonElement>(null);
    const outsidePress = useRef(false);
    // This function belongs to the displayed frame generation. Never replace
    // it with a latest-session cancel ref: a retired dismiss must stay retired.
    const cancel = session.cancel;
    const focus = (element: HTMLElement | null) => {
        const node = dialog.current;
        if (!node?.isConnected || !node.open) return;
        const activeDialog =
            node.ownerDocument.activeElement?.closest('dialog');
        if (activeDialog && activeDialog !== node) return;
        element?.focus({ preventScroll: true });
    };
    const focusFrame = () =>
        focus(dialog.current?.querySelector('iframe') ?? null);
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommitEffect(() => {
        const node = dialog.current;
        if (!node) return;
        node.showModal();
        node.querySelector('iframe')?.focus();
        // Close before removal so the platform can restore this opener. This
        // cleanup never cancels a booking or targets a newer hook session.
        return () => node.close();
    }, []);
    const containTab = (event: KeyboardEvent<HTMLDialogElement>) => {
        if (event.key !== 'Tab' || event.defaultPrevented) return;
        const node = dialog.current;
        if (!node) return;
        const active = node.ownerDocument.activeElement;
        if (active?.closest('dialog') !== node) return;
        if (!event.shiftKey && active === close.current) {
            event.preventDefault();
            focusFrame();
        } else if (event.shiftKey && active === node.querySelector('iframe')) {
            event.preventDefault();
            focus(close.current);
        }
    };
    const beginPointer = (event: PointerEvent<HTMLDialogElement>) => {
        outsidePress.current = event.target === overlay.current;
    };
    return h(
        'dialog',
        {
            ref: dialog,
            className: 'mx-sdk-calendly-dialog',
            style: { zIndex },
            'aria-label': title,
            onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
                event.preventDefault();
                cancel();
            },
            onKeyDown: containTab,
            onPointerDown: beginPointer,
            onPointerCancel: () => {
                outsidePress.current = false;
            },
            onClick: (event: MouseEvent<HTMLDialogElement>) => {
                const dismiss =
                    outsidePress.current && event.target === overlay.current;
                outsidePress.current = false;
                if (dismiss) cancel();
            },
        },
        h('div', {
            ref: overlay,
            className: 'mx-sdk-calendly-overlay',
            'aria-hidden': true,
        }),
        h(
            'section',
            { className: 'mx-sdk-calendly-panel' },
            h('div', {
                className: 'mx-sdk-calendly-header',
                'aria-hidden': true,
            }),
            // Keyboard events inside a cross-origin frame cannot bubble to
            // React. These boundaries handle native traversal out of it.
            h('span', {
                className: 'mx-sdk-calendly-focus-guard',
                tabIndex: 0,
                'aria-hidden': true,
                onFocus: () => focus(close.current),
            }),
            h('div', { className: 'mx-sdk-calendly-body' }, session.frame),
            h(
                'button',
                {
                    ref: close,
                    type: 'button',
                    className: 'mx-sdk-calendly-close',
                    'aria-label': closeLabel,
                    onClick: () => cancel(),
                },
                h(
                    'svg',
                    {
                        viewBox: '0 0 24 24',
                        'aria-hidden': true,
                        focusable: 'false',
                    },
                    h('circle', { cx: 12, cy: 12, r: 10 }),
                    h('path', { d: 'm9 9 6 6m0-6-6 6' })
                )
            ),
            h('span', {
                className: 'mx-sdk-calendly-focus-guard',
                tabIndex: 0,
                'aria-hidden': true,
                onFocus: focusFrame,
            })
        )
    );
}

/**
 * Complete native-compatible scheduling UI. The existing hook is the only
 * booking authority; the host retains field projection and canonical writes.
 * Requires browser showModal support; importing/rendering does not load a frame.
 */
export function CompleteCalendlyWidget(props: CompleteCalendlyWidgetProps) {
    const booking = useCalendlyBooking({
        ...props,
        frameClassName: 'mx-sdk-calendly-frame',
    });
    const title = props.schedulingTitle || props.labels?.schedule || 'Schedule';
    const style: CalendlyStyle = {
        '--mx-sdk-calendly-accent': props.accentColor,
        '--mx-sdk-calendly-hover': props.hoverColor,
        '--mx-sdk-calendly-focus': props.focusColor,
        '--mx-sdk-calendly-reserved-inline-end': props.reservedInlineEndWidth,
    };
    const session = booking.session;
    return h(
        'div',
        {
            className: ['mx-sdk-calendly-widget', props.className]
                .filter(Boolean)
                .join(' '),
            style,
        },
        booking.url == null
            ? h(
                  'p',
                  { role: 'alert', className: 'mx-sdk-calendly-error' },
                  props.labels?.invalidUrl ??
                      'Calendly requires a valid HTTPS calendly.com scheduling URL.'
              )
            : props.booked === true
              ? h(
                    'label',
                    { className: 'mx-sdk-calendly-booked' },
                    props.labels?.booked ?? '✅ Booked'
                )
              : h(
                    ActionButton,
                    {
                        className: 'mx-sdk-calendly-trigger',
                        disabled: props.enabled === false,
                        onClick: () => {
                            booking.open();
                        },
                    },
                    title
                ),
        session
            ? h(BookingDialog, {
                  key: session.frame.key,
                  session,
                  title,
                  closeLabel: props.labels?.close ?? 'Close',
                  zIndex: props.zIndex,
              })
            : null
    );
}
