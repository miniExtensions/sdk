import {
    createElement,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    type TextareaHTMLAttributes,
} from 'react';

export type TextareaAutoSize = { minRows?: number; maxRows?: number };
export type TextareaInputProps = Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'value' | 'defaultValue' | 'children'
> & {
    /** Literal controlled draft. The caller owns editing and persistence. */
    value: string;
    /** Opt in to content sizing. Native rows/style behavior is otherwise unchanged. */
    autoSize?: TextareaAutoSize;
};

// Sizing adapted from react-textarea-autosize 8.5.3 (MIT); see THIRD_PARTY_NOTICES.
const sizingStyles = [
    'borderBottomWidth',
    'borderLeftWidth',
    'borderRightWidth',
    'borderTopWidth',
    'boxSizing',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
    'paddingBottom',
    'paddingLeft',
    'paddingRight',
    'paddingTop',
    'tabSize',
    'textIndent',
    'textRendering',
    'textTransform',
    'width',
    'wordBreak',
] as const;
const useBrowserLayoutEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

function measuredHeight(node: HTMLTextAreaElement, min: number, max: number) {
    const document = node.ownerDocument;
    const view = document.defaultView;
    if (!node.isConnected || !document.body || !view) return null;
    const style = view.getComputedStyle(node);
    if (!style.boxSizing || style.display === 'none') return null;
    const padding =
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const border =
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const probe = document.createElement('textarea');
    probe.tabIndex = -1;
    probe.setAttribute('aria-hidden', 'true');
    for (const key of sizingStyles) probe.style[key] = style[key];
    for (const [key, value] of Object.entries({
        'min-height': '0',
        'max-height': 'none',
        height: '0',
        visibility: 'hidden',
        overflow: 'hidden',
        position: 'absolute',
        'z-index': '-1000',
        top: '0',
        right: '0',
    }))
        probe.style.setProperty(key, value, 'important');
    document.body.append(probe);
    try {
        const value = node.value || node.placeholder || 'x';
        probe.value = value;
        // Keep the upstream double read for Firefox's textarea measurement bug.
        void probe.scrollHeight;
        probe.value = value;
        const scroll = probe.scrollHeight;
        probe.value = 'x';
        const row = probe.scrollHeight - padding;
        if (!(row > 0) || !Number.isFinite(border + padding)) return null;
        const extra = style.boxSizing === 'border-box' ? padding + border : 0;
        const content = scroll - padding + extra;
        return Math.min(
            Math.max(content, row * min + extra),
            row * max + extra
        );
    } finally {
        // Never retain a measurement node containing an owner's draft.
        probe.remove();
    }
}

/** Native textarea/ref; optional sizing never rewrites drafts or emits edits. */
export const TextareaInput = forwardRef<
    HTMLTextAreaElement,
    TextareaInputProps
>(function TextareaInput({ autoSize, ...props }, forwardedRef) {
    const node = useRef<HTMLTextAreaElement | null>(null);
    const lastHeight = useRef<number | null>(null);
    const ownedHeight = useRef<string | null>(null);
    const resize = useRef<() => void>(() => {});
    const enabled = autoSize !== undefined;
    const min = autoSize?.minRows ?? 1;
    const max = autoSize?.maxRows ?? Infinity;
    if (
        enabled &&
        (!Number.isInteger(min) ||
            min < 1 ||
            (max !== Infinity && !Number.isInteger(max)) ||
            max < min)
    )
        throw new RangeError(
            'autoSize requires positive integer rows and maxRows >= minRows.'
        );
    if (
        enabled &&
        (props.style?.minHeight !== undefined ||
            props.style?.maxHeight !== undefined)
    )
        throw new Error(
            'Use autoSize.minRows/maxRows instead of style.minHeight/maxHeight.'
        );
    useImperativeHandle(forwardedRef, () => node.current!, []);
    useBrowserLayoutEffect(() => {
        const current = node.current;
        if (!enabled || !current) return;
        const height = current.style.getPropertyValue('height');
        const priority = current.style.getPropertyPriority('height');
        return () => {
            if (
                ownedHeight.current !== null &&
                current.style.height === ownedHeight.current
            )
                current.style.setProperty('height', height, priority);
            lastHeight.current = null;
            ownedHeight.current = null;
        };
    }, [enabled]);
    useBrowserLayoutEffect(() => {
        resize.current = () => {
            if (!enabled || !node.current) return;
            const height = measuredHeight(node.current, min, max);
            if (height !== null && lastHeight.current !== height) {
                node.current.style.setProperty(
                    'height',
                    `${height}px`,
                    'important'
                );
                lastHeight.current = height;
                ownedHeight.current = node.current.style.height;
            }
        };
        resize.current();
    });
    useEffect(() => {
        if (!enabled || !node.current) return;
        const document = node.current.ownerDocument;
        const view = document.defaultView;
        const fonts = document.fonts;
        const onResize = () => resize.current();
        view?.addEventListener('resize', onResize);
        fonts?.addEventListener('loadingdone', onResize);
        return () => {
            view?.removeEventListener('resize', onResize);
            fonts?.removeEventListener('loadingdone', onResize);
        };
    }, [enabled]);
    return createElement('textarea', { ...props, ref: node });
});
