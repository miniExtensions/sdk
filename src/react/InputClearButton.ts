import type * as React from 'react';
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

const nativeTextClearPath =
    'M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z';

function createInputClearButton(filled: boolean) {
    return forwardRef<HTMLButtonElement, InputClearButtonProps>(
        function InputClearButton(
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
                            fill: filled ? 'currentColor' : 'none',
                            stroke: filled ? undefined : 'currentColor',
                            strokeWidth: filled ? undefined : 2.5,
                            focusable: 'false',
                            'aria-hidden': true,
                        },
                        createElement(
                            'path',
                            filled
                                ? {
                                      d: nativeTextClearPath,
                                      fillRule: 'evenodd',
                                      clipRule: 'evenodd',
                                  }
                                : {
                                      d: 'M6 6l12 12M18 6L6 18',
                                      strokeLinecap: 'round',
                                  }
                        )
                    )
                )
            );
        }
    );
}

/** Shared native clear presentation. The caller owns visibility and write policy. */
export const InputClearButton = createInputClearButton(false);
export const NativeTextInputClearButton = createInputClearButton(true);
