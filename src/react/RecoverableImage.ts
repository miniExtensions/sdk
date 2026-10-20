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
    /** Caller owns localized markup and retry-event containment. */
    renderFallback(retry: () => void): ReactNode;
};

type ImageChainProps = RecoverableImageProps & {
    forwardedRef: ForwardedRef<HTMLImageElement>;
};

function ImageChain({
    sources,
    renderFallback,
    forwardedRef,
    ...native
}: ImageChainProps) {
    const [current, setCurrent] = useState({ index: 0, attempt: 0 });
    if (current.index >= sources.length)
        return renderFallback(() =>
            setCurrent((previous) =>
                previous.index === current.index &&
                previous.attempt === current.attempt
                    ? { index: 0, attempt: previous.attempt + 1 }
                    : previous
            )
        );
    return createElement('img', {
        ...native,
        ref: forwardedRef,
        src: sources[current.index],
        key: `${current.index}-${current.attempt}`,
        onError: () =>
            setCurrent((previous) =>
                previous.index === current.index &&
                previous.attempt === current.attempt
                    ? { ...previous, index: previous.index + 1 }
                    : previous
            ),
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
