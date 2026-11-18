import type * as React from 'react';
import {
    createElement,
    forwardRef,
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
};

function ImageChain({
    sources,
    isCurrent,
    renderFallback,
    forwardedRef,
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
    return createElement('img', {
        ...native,
        ref: forwardedRef,
        src: sources[current.index],
        key: `${current.index}-${current.attempt}`,
        onError: () => advance({ ...current, index: current.index + 1 }),
    });
}

/** Native image/ref with ordered recovery; attachment state and persistence stay with the caller. */
export const RecoverableImage = forwardRef<
    HTMLImageElement,
    RecoverableImageProps
>(function RecoverableImage(props, ref) {
    const sources = Array.from(new Set(props.sources.filter(Boolean)));
    return createElement(ImageChain, {
        ...props,
        sources,
        forwardedRef: ref,
        key: JSON.stringify(sources),
    });
});
