import { createElement, forwardRef, type InputHTMLAttributes } from 'react';

export type TextInputProps = Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'defaultValue' | 'children'
> & {
    /** Supplied display text, including unfinished numeric or composition drafts. */
    value: string;
};

/** Stateless native presentation. The caller owns parsing, drafts and commits. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
    function TextInput(props, ref) {
        return createElement('input', { ...props, ref });
    }
);
