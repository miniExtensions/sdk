import type * as React from 'react';
import {
    createElement,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
} from 'react';
import { CompleteHTMLRenderer } from './CompleteHTMLRenderer.js';

export type CompleteQuillHTMLRendererProps = {
    html: string;
    className?: string;
};

/** Quill HTML display, not Markdown or an editor; sanitize exactly once. */
export const CompleteQuillHTMLRenderer = forwardRef<
    HTMLDivElement,
    CompleteQuillHTMLRendererProps
>(function CompleteQuillHTMLRenderer(props, ref) {
    const quillContainerRef = useRef<HTMLDivElement | null>(null);
    // React owns callback-ref replacement and React 19 returned cleanup. Do not
    // bridge refs by invoking a consumer callback and discarding its result.
    useImperativeHandle(ref, () => quillContainerRef.current!, []);
    useEffect(() => {
        quillContainerRef.current?.querySelectorAll('a').forEach((element) => {
            element.target = '_blank';
            element.rel = 'noopener noreferrer';
        });
    }, [props.html]);

    return createElement(
        'div',
        { className: 'quill mx-sdk-quill' },
        createElement(
            'div',
            {
                className:
                    'ql-container ql-snow ql-disabled !border-none mx-sdk-quill__container',
                style: { fontFamily: 'inherit' },
            },
            createElement(CompleteHTMLRenderer, {
                className: [
                    'ql-editor !p-0 mx-sdk-quill__editor',
                    props.className,
                ]
                    .filter(Boolean)
                    .join(' '),
                ref: quillContainerRef,
                html: props.html,
                inline: true,
            })
        )
    );
});
