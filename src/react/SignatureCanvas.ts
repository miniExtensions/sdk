import {
    createElement,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
} from 'react';
import SignaturePadModule from 'signature_pad';

// The 4.1.7 package's CommonJS declaration is interpreted differently by
// NodeNext and the CommonJS compiler. Both runtime entry points expose this
// default constructor; keep the interoperability assertion at that boundary.
interface CanvasPad {
    clear(): void;
    toDataURL(type: string): string;
    off(): void;
    addEventListener(type: string, callback: EventListener): void;
    removeEventListener(type: string, callback: EventListener): void;
}
const SignaturePad = SignaturePadModule as unknown as {
    new (canvas: HTMLCanvasElement): CanvasPad;
};

export type SignatureCanvasHandle = {
    clear: () => void;
    toDataURL: () => string | undefined;
};
export type SignatureCanvasProps = {
    id: string;
    label: string;
    onDraft: (empty: boolean) => void;
};

/**
 * React adapter for the native 4.1.7 engine. Resize behavior derives from
 * react-signature-pad-wrapper 3.3.4 (MIT; see THIRD_PARTY_NOTICES.md).
 */
export const SignatureCanvas = forwardRef<
    SignatureCanvasHandle,
    SignatureCanvasProps
>(function SignatureCanvas(props, ref) {
    const container = useRef<HTMLDivElement>(null);
    const live = useRef<CanvasPad | null>(null);
    const canvasElement = useRef<HTMLCanvasElement | null>(null);
    const committed = useRef(props);
    const commitEffect =
        typeof window === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        committed.current = props;
        canvasElement.current?.setAttribute('aria-label', props.label);
    });
    useImperativeHandle(
        ref,
        () => ({
            clear: () => {
                if (live.current == null) return;
                live.current.clear();
                committed.current.onDraft(true);
            },
            toDataURL: () => live.current?.toDataURL('image/png'),
        }),
        []
    );

    useEffect(() => {
        const host = container.current;
        if (host == null) return;
        const view = host.ownerDocument.defaultView;
        if (view == null) return;
        // Effect replay gets a NEW canvas. A retired engine may still have
        // its private throttled work queued; it must never share a successor.
        const canvas = host.ownerDocument.createElement('canvas');
        canvasElement.current = canvas;
        canvas.id = committed.current.id;
        canvas.className = 'mx-sdk-signature-canvas';
        canvas.setAttribute('aria-label', committed.current.label);
        host.append(canvas);
        let active = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let width: number | undefined;
        let height: number | undefined;
        const pad = new SignaturePad(canvas);
        live.current = pad;
        const begin = () => {
            if (active) committed.current.onDraft(false);
        };
        pad.addEventListener('beginStroke', begin);
        const scale = () => {
            if (!active) return;
            const ratio = Math.max(view.devicePixelRatio || 1, 1);
            const nextWidth = canvas.offsetWidth * ratio;
            const nextHeight = canvas.offsetHeight * ratio;
            if (width === nextWidth && height === nextHeight) return;
            width = nextWidth;
            height = nextHeight;
            canvas.width = nextWidth;
            canvas.height = nextHeight;
            canvas.getContext('2d')?.scale(ratio, ratio);
            pad.clear();
            committed.current.onDraft(true);
        };
        const resize = () => {
            clearTimeout(timer);
            timer = setTimeout(scale, 150);
        };
        scale();
        view.addEventListener('resize', resize);
        return () => {
            active = false;
            clearTimeout(timer);
            view.removeEventListener('resize', resize);
            pad.removeEventListener('beginStroke', begin);
            pad.off();
            if (live.current === pad) live.current = null;
            if (canvasElement.current === canvas) canvasElement.current = null;
            canvas.remove();
        };
    }, []);
    return createElement('div', {
        ref: container,
        className: 'mx-sdk-signature-canvas-host',
    });
});
