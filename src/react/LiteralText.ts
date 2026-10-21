import {
    createElement,
    forwardRef,
    type HTMLAttributes,
    type ReactNode,
} from 'react';

export type LiteralTextProps = Omit<
    HTMLAttributes<HTMLElement>,
    'children' | 'dangerouslySetInnerHTML' | 'defaultValue' | 'defaultChecked'
> & {
    /** Already formatted display text; native values and masking stay with the caller. */
    value: string | null | undefined;
    as?: 'output' | 'span' | 'p' | 'div';
    /** Optional localized empty presentation, rendered without a wrapper. */
    empty?: ReactNode;
    /** Defaults to the SDK literal-output whitespace and wrapping styles. */
    preserveWhitespace?: boolean;
    /** Optional caller-owned formatting, such as an existing safe linkifier. */
    renderText?(text: string): ReactNode;
};

/** Shared literal presentation; its caller retains formatting, identity and policy. */
export const LiteralText = forwardRef<HTMLElement, LiteralTextProps>(
    function LiteralText(props, ref) {
        const {
            value,
            as = 'output',
            empty,
            preserveWhitespace = true,
            renderText,
            style,
            ...native
        } = props;
        if ((value == null || value === '') && empty !== undefined)
            return empty;
        const text = value ?? '';
        return createElement(
            as,
            {
                ...native,
                ref,
                style: preserveWhitespace
                    ? {
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                          display: 'block',
                          ...style,
                      }
                    : style,
            },
            renderText ? renderText(text) : text
        );
    }
);
