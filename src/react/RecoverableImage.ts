import type * as React from 'react';
import {
    createElement,
    forwardRef,
    useCallback,
    useEffect,
    useRef,
    useState,
    type ForwardedRef,
    type ImgHTMLAttributes,
    type ReactNode,
} from 'react';

export type RecoverableImageProps = Omit<
    ImgHTMLAttributes<HTMLImageElement>,
    'src' | 'srcSet' | 'onError' | 'children' | 'dangerouslySetInnerHTML'
> & {
    /** Caller-authorized sources, tried in order; no URL rewriting or write authority. */
    sources: readonly string[];
    alt: string;
    /** Optional live resource check before rendering or advancing an image attempt. */
    isCurrent?(): boolean;
    /** Caller owns localized markup and retry-event containment. */
    renderFallback(retry: () => void): ReactNode;
};

type ImageChainProps = RecoverableImageProps & {
    forwardedRef: ForwardedRef<HTMLImageElement>;
    activateSource?: () => void;
};

function RefOwnedImageAttempt({
    native,
    forwardedRef,
    activateSource,
}: {
    native: ImgHTMLAttributes<HTMLImageElement>;
    forwardedRef: ForwardedRef<HTMLImageElement>;
    activateSource: () => void;
}) {
    const ready = useRef(false);
    const attach = useCallback(
        (node: HTMLImageElement | null) => {
            if (typeof forwardedRef === 'function') forwardedRef(node);
            else if (forwardedRef) forwardedRef.current = node;
            // Suspense can reattach a previously committed image without
            // replaying its passive effect.
            if (node && ready.current) activateSource();
        },
        [forwardedRef, activateSource]
    );
    useEffect(() => {
        ready.current = true;
        activateSource();
        return () => {
            ready.current = false;
        };
    }, [activateSource]);
    return createElement('img', { ...native, ref: attach });
}

function ImageChain({
    sources,
    isCurrent,
    renderFallback,
    forwardedRef,
    activateSource,
    ...native
}: ImageChainProps) {
    const [current, setCurrent] = useState({ index: 0, attempt: 0 });
    if (isCurrent?.() === false) return null;
    const advance = (next: typeof current) => {
        if (isCurrent?.() === false) return;
        setCurrent((previous) =>
            previous === current && isCurrent?.() !== false ? next : previous
        );
    };
    if (current.index >= sources.length)
        return renderFallback(() =>
            advance({ index: 0, attempt: current.attempt + 1 })
        );
    const nativeAttempt = {
        ...native,
        onError: () => advance({ ...current, index: current.index + 1 }),
    };
    const key = `${current.index}-${current.attempt}`;
    return activateSource
        ? createElement(RefOwnedImageAttempt, {
              key,
              native: nativeAttempt,
              forwardedRef,
              activateSource,
          })
        : createElement('img', {
              ...nativeAttempt,
              ref: forwardedRef,
              src: sources[current.index],
              key,
          });
}

function renderImageChain(
    props: RecoverableImageProps,
    forwardedRef: ForwardedRef<HTMLImageElement>,
    activateSource?: () => void
) {
    const sources = Array.from(new Set(props.sources.filter(Boolean)));
    return createElement(ImageChain, {
        ...props,
        sources,
        forwardedRef,
        activateSource,
        key: JSON.stringify(sources),
    });
}

/** Native image/ref with ordered recovery; attachment state and persistence stay with the caller. */
export const RecoverableImage = forwardRef<
    HTMLImageElement,
    RecoverableImageProps
>(function RecoverableImage(props, ref) {
    return renderImageChain(props, ref);
});

/** Resource images can let the live lease activate the native src. */
export const ResourceRecoverableImage = forwardRef<
    HTMLImageElement,
    RecoverableImageProps & { activateSource?: () => void }
>(function ResourceRecoverableImage({ activateSource, ...props }, ref) {
    return renderImageChain(props, ref, activateSource);
});
