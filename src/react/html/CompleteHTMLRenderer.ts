import { createElement, forwardRef, type HTMLProps } from 'react';
import { sanitizeHTML } from './sanitizeHTML.js';

export type CompleteHTMLRendererProps = HTMLProps<HTMLDivElement> & {
    html: string;
    inline?: boolean;
};

// Native HTMLRenderer base classes. Keep inline rendering free of this block
// presentation; the scoped stylesheet supplies the same fallback without a
// consumer Tailwind build.
const baseStyles = `
    [&_ul]:list-disc [&_ul]:pl-6
    [&_ol]:list-decimal [&_ol]:pl-6
    [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-4
    [&_h2]:text-xl [&_h2]:font-bold [&_h2]:my-3
    [&_h3]:text-lg [&_h3]:font-bold [&_h3]:my-2
    [&_p]:my-2
    [&_blockquote]:pl-4 [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:my-2
    [&_pre]:bg-gray-100 [&_pre]:p-4 [&_pre]:rounded [&_pre]:my-2
    [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded
    [&_table]:w-full [&_table]:border-collapse [&_table]:my-4
    [&_th]:border [&_th]:p-2 [&_th]:bg-gray-50
    [&_td]:border [&_td]:p-2
    [&_a]:text-blue-600 [&_a]:underline [&_a:hover]:text-blue-800
`;

/** Native-compatible sanitized HTML; canonical sanitizer policy is separate. */
export const CompleteHTMLRenderer = forwardRef<
    HTMLDivElement,
    CompleteHTMLRendererProps
>(function CompleteHTMLRenderer(props, ref) {
    const { html, className, inline, style, ...restProps } = props;
    return createElement('div', {
        ...restProps,
        className: `${!inline ? baseStyles : ''} ${className || ''} mx-sdk-html${inline ? '' : ' mx-sdk-html--block'}`,
        ref,
        style: {
            ...style,
            contain: 'paint',
            isolation: 'isolate',
            overflow: style?.overflow ?? 'auto',
            position: 'relative',
        },
        dangerouslySetInnerHTML: { __html: sanitizeHTML(html) },
    });
});
