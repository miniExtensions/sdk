import {
    createElement,
    forwardRef,
    Fragment,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useState,
    useSyncExternalStore,
    type ReactElement,
    type ReactNode,
    type CSSProperties,
} from 'react';
import {
    NativeRichTextEditor,
    type NativeRichTextEditorHandle,
} from './NativeRichTextEditor.js';

export type CompleteRichTextEditorProps = {
    value: string | null;
    onValueChange(value: string): void;
    readOnly?: boolean;
    placeholder?: string;
    id?: string;
    ariaLabelledBy?: string;
    ariaDescribedBy?: string;
    ariaInvalid?: boolean;
    emptyContent?: ReactNode;
    /** A new document owner retires the previous editor and its callbacks. */
    identity?: string;
    accentColor?: string;
    linkColor?: string;
    linkHoverColor?: string;
};

type PortalEntry = {
    key: string;
    dom: HTMLElement;
    element: ReactElement;
};

function createPortalOwner() {
    const entries = new Map<object, PortalEntry>();
    const listeners = new Set<() => void>();
    let snapshot: readonly PortalEntry[] = [];
    let active = false;
    let sequence = 0;
    const publish = () => {
        snapshot = [...entries.values()];
        if (active) listeners.forEach((listener) => listener());
    };
    return {
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getSnapshot: () => snapshot,
        activate() {
            active = true;
            listeners.forEach((listener) => listener());
            return () => {
                active = false;
            };
        },
        renderNodeView(key: object, dom: HTMLElement, element: ReactElement) {
            const previous = entries.get(key);
            entries.set(key, {
                key: previous?.key ?? String(++sequence),
                dom,
                element,
            });
            publish();
        },
        removeNodeView(key: object) {
            // Removal must run even during parent teardown and StrictMode replay.
            if (entries.delete(key)) publish();
        },
    };
}

type Runtime = typeof import('./completeRichTextRuntime.js');

const OwnedRichTextEditor = forwardRef<
    NativeRichTextEditorHandle,
    CompleteRichTextEditorProps
>(function OwnedRichTextEditor(props, forwardedRef) {
    const [runtime, setRuntime] = useState<Runtime>();
    const [loadError, setLoadError] = useState<unknown>();
    const [editor, setEditor] = useState<NativeRichTextEditorHandle | null>(
        null
    );
    const portals = useMemo(createPortalOwner, []);
    const portalEntries = useSyncExternalStore(
        portals.subscribe,
        portals.getSnapshot,
        portals.getSnapshot
    );
    useLayoutEffect(() => portals.activate(), [portals]);
    useEffect(() => {
        let current = true;
        // Public imports and server rendering never initialize the browser engine.
        void import('./completeRichTextRuntime.js').then(
            (loaded) => {
                if (current) setRuntime(loaded);
            },
            (error: unknown) => {
                if (current) setLoadError(() => error);
            }
        );
        return () => {
            current = false;
        };
    }, []);
    const attach = useCallback(
        (instance: NativeRichTextEditorHandle | null) => {
            setEditor(instance);
            if (typeof forwardedRef === 'function') {
                const cleanup: unknown = forwardedRef(instance);
                if (typeof cleanup === 'function')
                    return () => {
                        setEditor(null);
                        cleanup();
                    };
            } else if (forwardedRef) forwardedRef.current = instance;
        },
        [forwardedRef]
    );
    useLayoutEffect(() => {
        if (!editor || !runtime) return;
        runtime.setEditorAttributes(editor, {
            ...(props.id == null ? {} : { id: props.id }),
            ...(props.ariaLabelledBy == null
                ? {}
                : { 'aria-labelledby': props.ariaLabelledBy }),
            ...(props.ariaDescribedBy == null
                ? {}
                : { 'aria-describedby': props.ariaDescribedBy }),
            ...(props.ariaInvalid == null
                ? {}
                : { 'aria-invalid': String(props.ariaInvalid) }),
        });
    }, [
        editor,
        runtime,
        props.id,
        props.ariaLabelledBy,
        props.ariaDescribedBy,
        props.ariaInvalid,
    ]);
    if (loadError !== undefined) throw loadError;
    const style: CSSProperties & Record<`--${string}`, string | undefined> = {
        '--me-rich-text-accent': props.accentColor,
        '--me-rich-text-link': props.linkColor,
        '--me-rich-text-link-hover': props.linkHoverColor,
    };
    return createElement(
        'div',
        {
            className: 'me-rich-text',
            style,
            'aria-busy': !runtime || undefined,
        },
        runtime
            ? createElement(NativeRichTextEditor, {
                  ref: attach,
                  value: props.value,
                  onValueChange: props.onValueChange,
                  readOnly: props.readOnly,
                  placeholder: props.placeholder,
                  emptyContent: props.emptyContent,
                  renderEditor: (native, focused) =>
                      runtime.renderEditor(native, focused, portals),
              })
            : null,
        runtime
            ? createElement(
                  Fragment,
                  null,
                  ...portalEntries.map((entry) =>
                      runtime.createNodePortal(
                          entry.element,
                          entry.dom,
                          entry.key
                      )
                  )
              )
            : null
    );
});

/** Complete, clientless Markdown editor. Import @miniextensions/sdk/react/rich-text.css. */
export const CompleteRichTextEditor = forwardRef<
    NativeRichTextEditorHandle,
    CompleteRichTextEditorProps
>(function CompleteRichTextEditor(props, ref) {
    return createElement(OwnedRichTextEditor, {
        ...props,
        ref,
        key: props.identity,
    });
});
