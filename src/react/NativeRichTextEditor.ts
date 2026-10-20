import {
    cloneElement,
    createElement,
    forwardRef,
    Fragment,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactElement,
    type ReactNode,
} from 'react';
import {
    convertEditorValueToStoredRichText,
    convertStoredRichTextToEditorMarkdown,
    normalizeRichTextForComparison,
    parseStoredRichTextCheckbox,
    serializeStoredRichTextCheckbox,
} from '../forms/richTextSerialization.js';

/** Structural view of the actual supplied editor instance; never a replacement instance. */
export type NativeRichTextEditorHandle = {
    element?: HTMLElement | null;
    view?: { dom: HTMLElement } | null;
};

/** Pass these props/ref to the caller's real, React-compatible native editor. */
export type NativeRichTextEditorRenderProps = {
    ref(instance: NativeRichTextEditorHandle | null): void;
    defaultValue: string;
    readOnly: boolean;
    placeholder: string;
    onChange(readValue: () => string): void;
    onFocus(): void;
    onBlur(): void;
    parsers: { match: typeof parseStoredRichTextCheckbox }[];
    serializer: typeof serializeStoredRichTextCheckbox;
};

export type NativeRichTextEditorProps = {
    value: string | null;
    onValueChange(value: string): void;
    readOnly?: boolean;
    placeholder?: string;
    /** Opt in only when element contains editor-view roots exclusively, never toolbars or caller content. */
    removeStaleEditorRoots?: boolean;
    /** The real editor, extensions, styling and their peer compatibility remain with the caller. */
    renderEditor(
        native: NativeRichTextEditorRenderProps,
        focused: boolean
    ): ReactElement;
    /** Caller-owned localized empty view for a read-only null value. */
    emptyContent?: ReactNode;
};

/** Native editor ownership and serialization; no vendor, binding, permissions or text-renderer fallback. */
export const NativeRichTextEditor = forwardRef<
    NativeRichTextEditorHandle,
    NativeRichTextEditorProps
>(function NativeRichTextEditor(props, forwardedRef) {
    const [focused, setFocused] = useState(false);
    const [editorKey, setEditorKey] = useState(0);
    const [attachedEditor, setAttachedEditor] =
        useState<NativeRichTextEditorHandle | null>(null);
    const lastSetValueRef = useRef<string | null>(props.value);
    const emptyView = Boolean(props.readOnly && props.value == null);
    const generation = useMemo(
        () => ({ attached: false }),
        [editorKey, emptyView]
    );
    const committedProps = useRef(props);
    useLayoutEffect(() => {
        committedProps.current = props;
    });

    const attachEditor = useMemo(() => {
        let detach: (() => void) | undefined;
        return (editor: NativeRichTextEditorHandle | null) => {
            // Retire writes before forwarding any caller-owned detach cleanup.
            generation.attached = false;
            const previous = detach;
            detach = undefined;
            previous?.();
            setAttachedEditor(editor);
            if (editor === null) return;
            generation.attached = true;
            if (typeof forwardedRef === 'function') {
                // React 18 types return void; React 19 callers may return cleanup.
                const cleanup: unknown = forwardedRef(editor);
                detach =
                    typeof cleanup === 'function'
                        ? () => {
                              cleanup();
                          }
                        : () => forwardedRef(null);
            } else if (forwardedRef) {
                forwardedRef.current = editor;
                detach = () => {
                    forwardedRef.current = null;
                };
            }
        };
    }, [forwardedRef, generation]);
    const handleChange = useCallback(
        (readValue: () => string) => {
            const current = committedProps.current;
            if (!generation.attached || current.readOnly) return;
            const stored = convertEditorValueToStoredRichText(readValue());
            if (
                normalizeRichTextForComparison(stored) ===
                normalizeRichTextForComparison(current.value)
            ) {
                lastSetValueRef.current = current.value;
                return;
            }
            lastSetValueRef.current = stored;
            current.onValueChange(stored);
        },
        [generation]
    );
    const handleFocus = useCallback(() => setFocused(true), []);
    const handleBlur = useCallback(() => setFocused(false), []);

    useEffect(() => {
        if (!props.removeStaleEditorRoots) return;
        const editor = attachedEditor;
        if (editor?.element == null || !(editor.element instanceof HTMLElement))
            return;
        const active = editor.view?.dom;
        if (!(active instanceof HTMLElement)) return;
        for (const child of Array.from(editor.element.children))
            if (child !== active) child.remove();
    }, [attachedEditor, props.removeStaleEditorRoots]);

    useEffect(() => {
        if (
            normalizeRichTextForComparison(props.value) !==
            normalizeRichTextForComparison(lastSetValueRef.current)
        ) {
            lastSetValueRef.current = props.value;
            setEditorKey((key) => key + 1);
        } else if (props.value !== lastSetValueRef.current) {
            lastSetValueRef.current = props.value;
        }
    }, [props.value]);

    if (emptyView) return createElement(Fragment, null, props.emptyContent);
    return cloneElement(
        props.renderEditor(
            {
                ref: attachEditor,
                defaultValue: convertStoredRichTextToEditorMarkdown(
                    props.value
                ),
                readOnly: props.readOnly ?? false,
                placeholder: props.placeholder ?? '',
                onChange: handleChange,
                onFocus: handleFocus,
                onBlur: handleBlur,
                parsers: [{ match: parseStoredRichTextCheckbox }],
                serializer: serializeStoredRichTextCheckbox,
            },
            focused
        ),
        { key: editorKey }
    );
});
