import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactNode,
} from 'react';
import type { Resizable, ResizableProps } from 're-resizable';

// The vendor declares defaultProps.grid as number[] although the prop is a
// tuple. Hide only that inaccurate static declaration, preserving its real
// constructor, instance, callbacks and runtime engine without a wrapper.
type EngineConstructor = new (props: ResizableProps) => Resizable;

export type PortalShellSidebarWidthCommit = Readonly<{
    scope: string;
    revision: string | number;
    width: number;
}>;

export function portalSidebarWidth(width: number | undefined): number {
    return Number.isFinite(width) ? Math.min(600, Math.max(120, width!)) : 288;
}

/** Only resize presentation is transient; storage and accepted width stay host-owned. */
export function PortalSidebarResize(props: {
    scope: string;
    revision: string | number;
    width: number;
    label: string;
    onCommit: (change: PortalShellSidebarWidthCommit) => void;
    onPreview: (width: number) => void;
}): ReactNode {
    const [loaded, setLoaded] = useState<
        { component: EngineConstructor } | { error: unknown } | null
    >(null);
    useEffect(() => {
        let current = true;
        // React 18's vendor main eagerly imports React DOM. Importing the public
        // SDK must leave unrelated hosts free to initialize their own DOM first.
        void import('re-resizable').then(
            (module) => {
                if (current) setLoaded({ component: module.Resizable });
            },
            (error: unknown) => {
                if (current) setLoaded({ error });
            }
        );
        return () => {
            current = false;
        };
    }, []);
    const token = useMemo(
        () => ({
            scope: props.scope,
            revision: props.revision,
            width: props.width,
            onCommit: props.onCommit,
        }),
        [props.scope, props.revision, props.width, props.onCommit]
    );
    const accepted = useRef<typeof token | null>(null);
    const gesture = useRef<typeof token | null>(null);
    const engine = useRef<Resizable>(null);
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommitEffect(() => {
        // Retire an old gesture through the pinned engine's own stop/cleanup
        // path. Clearing its authority first suppresses the stop notification.
        // Keep the button mounted so accepted keyboard commits retain focus.
        gesture.current = null;
        accepted.current = token;
        const ownerWindow = engine.current?.window;
        if (ownerWindow)
            engine.current?.onMouseUp(new ownerWindow.MouseEvent('mouseup'));
        props.onPreview(token.width);
        return () => {
            if (accepted.current === token) accepted.current = null;
        };
    }, [token]);
    function commit(width: number) {
        if (accepted.current !== token) return;
        // Restore before notifying: a synchronous host publication must win.
        props.onPreview(token.width);
        token.onCommit({
            scope: token.scope,
            revision: token.revision,
            width: portalSidebarWidth(width),
        });
    }
    function keyboard(event: KeyboardEvent<HTMLButtonElement>) {
        const width =
            event.key === 'Home'
                ? 120
                : event.key === 'End'
                  ? 600
                  : event.key === 'ArrowLeft'
                    ? token.width - 10
                    : event.key === 'ArrowRight'
                      ? token.width + 10
                      : null;
        if (width === null) return;
        event.preventDefault();
        event.stopPropagation();
        gesture.current = null;
        commit(width);
    }
    if (loaded && 'error' in loaded) throw loaded.error;
    // SSR retains canonical width; the resize handle hydrates after mount.
    if (!loaded) return null;
    return h(loaded.component, {
        ref: engine,
        size: { width: props.width, height: '100%' },
        minWidth: 120,
        maxWidth: 600,
        enable: { right: true },
        className: 'mx-sdk-portal-sidebar-resize',
        style: {
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: 'none',
            zIndex: 2,
        },
        handleStyles: { right: { pointerEvents: 'auto' } },
        handleComponent: {
            right: h('button', {
                type: 'button',
                role: 'separator',
                'aria-label': props.label,
                'aria-orientation': 'vertical',
                'aria-valuemin': 120,
                'aria-valuemax': 600,
                'aria-valuenow': props.width,
                className: 'mx-sdk-portal-sidebar-handle',
                onKeyDown: keyboard,
            }),
        },
        onResizeStart: () => {
            if (accepted.current !== token) return false;
            gesture.current = token;
        },
        onResize: (_event, _direction, element) => {
            if (gesture.current !== token || accepted.current !== token) return;
            props.onPreview(portalSidebarWidth(element.offsetWidth));
        },
        onResizeStop: (_event, _direction, element) => {
            const current = gesture.current;
            gesture.current = null;
            if (current !== token) return;
            commit(element.offsetWidth);
        },
    });
}
