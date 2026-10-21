import { createElement, forwardRef, type ButtonHTMLAttributes } from 'react';

export type InputClearButtonProps = Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'type' | 'children' | 'aria-label'
> & {
    /** Localized accessible name; native input data stays with the caller. */
    label: string;
    indicatorClassName?: string;
    iconClassName?: string;
};

/** Shared native clear presentation. The caller owns visibility and write policy. */
export const InputClearButton = forwardRef<
    HTMLButtonElement,
    InputClearButtonProps
>(function InputClearButton(
    { label, indicatorClassName, iconClassName, ...props },
    ref
) {
    return createElement(
        'button',
        { ...props, ref, type: 'button', 'aria-label': label },
        createElement(
            'span',
            { className: indicatorClassName, 'aria-hidden': true },
            createElement(
                'svg',
                {
                    className: iconClassName,
                    width: 12,
                    height: 12,
                    viewBox: '0 0 24 24',
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 2.5,
                    focusable: 'false',
                    'aria-hidden': true,
                },
                createElement('path', {
                    d: 'M6 6l12 12M18 6L6 18',
                    strokeLinecap: 'round',
                })
            )
        )
    );
});
