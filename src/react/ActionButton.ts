import {
    createElement,
    forwardRef,
    type ButtonHTMLAttributes,
    type ReactNode,
} from 'react';

export type ActionButtonProps = Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'type' | 'aria-busy'
> & {
    /** Pending presentation only; the caller owns requests and singleflight. */
    busy?: boolean;
    /** Optional replacement content while busy; otherwise keep children. */
    busyContent?: ReactNode;
};

/** Native non-submit action with shared pending/disabled presentation. */
export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
    function ActionButton(
        { busy, busyContent, disabled, children, ...native },
        ref
    ) {
        return createElement(
            'button',
            {
                ...native,
                ref,
                type: 'button',
                disabled: disabled || busy,
                'aria-busy': busy,
            },
            busy && busyContent !== undefined ? busyContent : children
        );
    }
);
