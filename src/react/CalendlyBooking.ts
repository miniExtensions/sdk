import {
    createElement,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type IframeHTMLAttributes,
    type ReactElement,
} from 'react';

export type CalendlyUrlOptions = {
    configuredUrl: string;
    email: string | null;
    name: string | null;
    embedDomain: string;
};

/** Existing Calendly destination/prefill contract; no request or booking. */
export function composeCalendlyUrl(options: CalendlyUrlOptions): URL | null {
    let url: URL;
    try {
        url = new URL(options.configuredUrl);
    } catch {
        return null;
    }
    if (
        url.protocol !== 'https:' ||
        !(
            url.hostname === 'calendly.com' ||
            url.hostname.endsWith('.calendly.com')
        )
    )
        return null;
    if (options.email) url.searchParams.set('email', options.email);
    if (options.name) url.searchParams.set('name', options.name);
    url.searchParams.set('embed_domain', options.embedDomain);
    url.searchParams.set('embed_type', 'PopupText');
    return url;
}

export type CalendlyBookingOptions = CalendlyUrlOptions & {
    /** Actual caller context identity. Changing it retires the open frame. */
    ownerKey: unknown;
    enabled?: boolean;
    booked?: boolean;
    /** The caller retains native write admission, persistence and feedback. */
    onScheduled(): void;
    frameClassName?: string;
    frameTitle?: string;
};
export type CalendlyBookingSession = {
    frame: ReactElement<IframeHTMLAttributes<HTMLIFrameElement>>;
    /** Cancels only this open generation, with no native write. */
    cancel(): boolean;
};
export type CalendlyBooking = {
    url: string | null;
    open(): boolean;
    session: CalendlyBookingSession | null;
};

const scheduled = (data: unknown): boolean =>
    data != null &&
    typeof data === 'object' &&
    'event' in data &&
    data.event === 'calendly.event_scheduled';

/** Local trusted-frame workflow; no binding, client, network call or data store. */
export function useCalendlyBooking(
    options: CalendlyBookingOptions
): CalendlyBooking {
    const instanceId = useId();
    const url = useMemo(
        () =>
            composeCalendlyUrl({
                configuredUrl: options.configuredUrl,
                email: options.email,
                name: options.name,
                embedDomain: options.embedDomain,
            })?.toString() ?? null,
        [
            options.configuredUrl,
            options.email,
            options.name,
            options.embedDomain,
        ]
    );
    const enabled = options.enabled !== false;
    const booked = options.booked === true;
    const identity = useMemo(
        () => ({ url, ownerKey: options.ownerKey, enabled, booked }),
        [url, options.ownerKey, enabled, booked]
    );
    type Frame = {
        identity: typeof identity;
        sequence: number;
        node: HTMLIFrameElement | null;
    };
    const active = useRef<Frame | null>(null);
    const accepted = useRef<{
        identity: typeof identity;
        onScheduled(): void;
    } | null>(null);
    const sequence = useRef(0);
    const [current, setCurrent] = useState<Frame | null>(null);
    useLayoutEffect(() => {
        accepted.current = { identity, onScheduled: options.onScheduled };
    }, [identity, options.onScheduled]);
    useLayoutEffect(() => {
        active.current = null;
        setCurrent(null);
        return () => {
            if (accepted.current?.identity === identity)
                accepted.current = null;
            if (active.current?.identity === identity) active.current = null;
        };
    }, [identity]);
    useEffect(() => {
        const receive = (event: MessageEvent<unknown>) => {
            const owner = accepted.current;
            const frame = active.current;
            if (
                !owner ||
                !frame ||
                frame.identity !== owner.identity ||
                !owner.identity.enabled ||
                owner.identity.booked ||
                !owner.identity.url ||
                !frame.node ||
                event.source !== frame.node.contentWindow ||
                event.origin !== new URL(owner.identity.url).origin ||
                !scheduled(event.data)
            )
                return;
            // Consume and close before the caller can re-enter or emit another event.
            active.current = null;
            setCurrent((value) => (value === frame ? null : value));
            owner.onScheduled();
        };
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
    }, []);
    const open = useCallback(() => {
        if (
            accepted.current?.identity !== identity ||
            !identity.enabled ||
            identity.booked ||
            !identity.url ||
            active.current
        )
            return false;
        const frame: Frame = {
            identity,
            sequence: ++sequence.current,
            node: null,
        };
        active.current = frame;
        setCurrent(frame);
        return true;
    }, [identity]);
    if (!current || current.identity !== identity || !url || !enabled || booked)
        return { url, open, session: null };
    const frame = current;
    return {
        url,
        open,
        session: {
            frame: createElement('iframe', {
                key: `${instanceId}-${frame.sequence}`,
                ref: (node: HTMLIFrameElement | null) => {
                    if (node === null) frame.node = null;
                    else if (
                        active.current === frame &&
                        accepted.current?.identity === identity
                    )
                        frame.node = node;
                },
                src: url,
                title: options.frameTitle ?? 'Schedule with Calendly',
                className: options.frameClassName,
                sandbox:
                    'allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts',
                referrerPolicy: 'strict-origin-when-cross-origin' as const,
            }),
            cancel: () => {
                if (
                    accepted.current?.identity !== identity ||
                    active.current !== frame
                )
                    return false;
                active.current = null;
                setCurrent((value) => (value === frame ? null : value));
                return true;
            },
        },
    };
}
