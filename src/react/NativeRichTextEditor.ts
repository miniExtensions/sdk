import {
    cloneElement,
    createElement,
    forwardRef,
    Fragment,
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

type NativeAttachment = {
    editor: NativeRichTextEditorHandle;
    active: boolean;
};
type NativeCallbackBinding = { attachment?: NativeAttachment };

/** This zero-DOM sibling commits policy before the supplied editor's layout work. */
function NativeEditorCommit({ commit }: { commit(): void }) {
    useLayoutEffect(commit);
    return null;
}

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
    const attachment = useRef<NativeAttachment | null>(null);
    const committed = useRef<{
        props: NativeRichTextEditorProps;
        binding: NativeCallbackBinding;
    } | null>(null);
    // Each supplied callback captures its own binding. Only a committed render
    // and actual attachment may bind it; an abandoned render has no admission.
    const supplied: { binding?: NativeCallbackBinding } = {};
    const commit = () => {
        const binding = supplied.binding!;
        const previous = committed.current?.props;
        if (
            previous &&
            previous.value !== props.value &&
            normalizeRichTextForComparison(props.value) !==
                normalizeRichTextForComparison(lastSetValueRef.current) &&
            attachment.current
        ) {
            // Retire the old document before a child can flush its update.
            attachment.current.active = false;
        }
        if (attachment.current?.active && !binding.attachment)
            binding.attachment = attachment.current;
        committed.current = { props, binding };
    };

    const attachEditor = useMemo(() => {
        let detach: (() => void) | undefined;
        return (editor: NativeRichTextEditorHandle | null) => {
            // Retire writes before forwarding any caller-owned detach cleanup.
            const previousAttachment = attachment.current;
            if (previousAttachment) previousAttachment.active = false;
            const previous = detach;
            detach = undefined;
            previous?.();
            setAttachedEditor(editor);
            if (editor === null) return;
            const next =
                previousAttachment?.editor === editor
                    ? previousAttachment
                    : { editor, active: false };
            next.active = true;
            attachment.current = next;
            if (committed.current && !committed.current.binding.attachment)
                committed.current.binding.attachment = next;
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
    }, [forwardedRef]);
    const currentProps = () => {
        const owner = supplied.binding?.attachment;
        return owner?.active && owner === attachment.current
            ? committed.current?.props
            : undefined;
    };
    const handleChange = (readValue: () => string) => {
        const admitted = currentProps();
        if (!admitted || admitted.readOnly) return;
        const stored = convertEditorValueToStoredRichText(readValue());
        const current = currentProps();
        if (!current || current.readOnly) return;
        if (
            normalizeRichTextForComparison(stored) ===
            normalizeRichTextForComparison(current.value)
        ) {
            lastSetValueRef.current = current.value;
            return;
        }
        lastSetValueRef.current = stored;
        current.onValueChange(stored);
    };
    const handleFocus = () => {
        if (currentProps()) setFocused(true);
    };
    const handleBlur = () => {
        if (currentProps()) setFocused(false);
    };

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

    const editor = emptyView
        ? null
        : props.renderEditor(
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
          );
    supplied.binding = useMemo<NativeCallbackBinding>(
        () => ({}),
        [
            // A parent render can replace an editor beneath a stable wrapper.
            // Keep this distinct even when each individual prop is equal.
            props,
            attachedEditor,
            editorKey,
            editor?.type,
            editor?.key,
            props.value,
            props.readOnly,
            props.onValueChange,
            props.renderEditor,
        ]
    );
    return createElement(
        Fragment,
        null,
        createElement(NativeEditorCommit, { commit }),
        emptyView
            ? props.emptyContent
            : cloneElement(editor!, { key: editorKey })
    );
});
