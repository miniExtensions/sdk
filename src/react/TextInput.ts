import { createElement, forwardRef, type InputHTMLAttributes } from 'react';

export type TextInputProps = Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'value' | 'defaultValue' | 'children'
> &
    (
        | {
              /** Native uncontrolled text for ref-managed owners such as comboboxes. */
              defaultValue?: string;
              value?: undefined;
          }
        | {
              /** Supplied display text, including unfinished numeric or composition drafts. */
              value: string;
              defaultValue?: never;
          }
    );

/** Stateless native presentation. The caller owns parsing, drafts and commits. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
    function TextInput(props, ref) {
        return createElement('input', { ...props, ref });
    }
);
