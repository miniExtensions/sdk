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
import type {
    Resizable,
    ResizableProps,
} from '../../vendor/portal-sidebar/index.js';

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

function sidebarResizeEdge(element: HTMLElement): 'left' | 'right' {
    return element.ownerDocument.defaultView?.getComputedStyle(element)
        .direction === 'rtl'
        ? 'left'
        : 'right';
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
    const [edge, setEdge] = useState<'left' | 'right'>('right');
    useEffect(() => {
        let current = true;
        // React 18's vendor main eagerly imports React DOM. Importing the public
        // SDK must leave unrelated hosts free to initialize their own DOM first.
        void import('../../vendor/portal-sidebar/index.js').then(
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
            edge,
            scope: props.scope,
            revision: props.revision,
            width: props.width,
            onCommit: props.onCommit,
        }),
        [edge, props.scope, props.revision, props.width, props.onCommit]
    );
    const accepted = useRef<typeof token | null>(null);
    const gesture = useRef<typeof token | null>(null);
    const plainArrowKeys = useRef(new Set<string>());
    const engine = useRef<Resizable>(null);
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommitEffect(() => {
        const element = engine.current?.resizable;
        const view = element?.ownerDocument.defaultView;
        if (!element || !view) return;
        let previous: typeof edge | undefined;
        const sync = () => {
            const next = sidebarResizeEdge(element);
            if (previous === next) return;
            previous = next;
            setEdge(next);
        };
        sync();
        const observer = new view.MutationObserver(sync);
        for (
            let owner = element.parentElement;
            owner;
            owner = owner.parentElement
        )
            observer.observe(owner, {
                attributes: true,
                attributeFilter: ['dir', 'class', 'style'],
            });
        view.addEventListener('resize', sync);
        return () => {
            observer.disconnect();
            view.removeEventListener('resize', sync);
        };
    }, [loaded]);
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
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            const key = event.code || event.key;
            const keys = plainArrowKeys.current;
            // A held history shortcut must not turn into a resize on modifier release.
            if (event.altKey || event.metaKey) {
                keys.delete(key);
                return;
            }
            if (event.repeat && !keys.has(key)) return;
            if (accepted.current !== token) return;
            keys.add(key);
        }
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
        enable: { [token.edge]: true },
        className: 'mx-sdk-portal-sidebar-resize',
        style: {
            position: 'absolute',
            top: 0,
            insetInlineStart: 0,
            pointerEvents: 'none',
            zIndex: 2,
        },
        handleStyles: { [token.edge]: { pointerEvents: 'auto' } },
        handleComponent: {
            [token.edge]: h('button', {
                type: 'button',
                role: 'separator',
                'aria-label': props.label,
                'aria-orientation': 'vertical',
                'aria-valuemin': 120,
                'aria-valuemax': 600,
                'aria-valuenow': props.width,
                className: 'mx-sdk-portal-sidebar-handle',
                onKeyDown: keyboard,
                onKeyUp: (event) => {
                    plainArrowKeys.current.delete(event.code || event.key);
                },
                onBlur: () => plainArrowKeys.current.clear(),
            }),
        },
        onResizeStart: (_event, direction, element) => {
            if (
                accepted.current !== token ||
                direction !== sidebarResizeEdge(element)
            )
                return false;
            gesture.current = token;
        },
        onResize: (_event, direction, element) => {
            if (
                gesture.current !== token ||
                accepted.current !== token ||
                direction !== sidebarResizeEdge(element)
            )
                return;
            props.onPreview(portalSidebarWidth(element.offsetWidth));
        },
        onResizeStop: (_event, direction, element) => {
            const current = gesture.current;
            gesture.current = null;
            if (current !== token) return;
            if (direction !== sidebarResizeEdge(element)) {
                props.onPreview(token.width);
                return;
            }
            commit(element.offsetWidth);
        },
    });
}
