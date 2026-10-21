import {
    createElement,
    forwardRef,
    type InputHTMLAttributes,
    type MouseEvent,
} from 'react';

export type RadioInputProps = Omit<
    InputHTMLAttributes<HTMLInputElement>,
    | 'type'
    | 'checked'
    | 'defaultChecked'
    | 'onChange'
    | 'onClick'
    | 'children'
    | 'dangerouslySetInnerHTML'
> & {
    checked: boolean;
    /** Opt in to the hosted single-choice convention: a second click clears. */
    allowDeselect?: boolean;
    /** Intent only; the caller retains native choice identity and write admission. */
    onCheckedChange(
        checked: boolean,
        event: MouseEvent<HTMLInputElement>
    ): void;
};

/** Controlled native radio; no choice model, draft, transport or persistence. */
export const RadioInput = forwardRef<HTMLInputElement, RadioInputProps>(
    function RadioInput(
        {
            checked,
            allowDeselect,
            onCheckedChange,
            disabled,
            readOnly,
            ...native
        },
        ref
    ) {
        return createElement('input', {
            ...native,
            ref,
            type: 'radio',
            checked,
            disabled,
            readOnly,
            // Selection intent uses click so an already checked radio can clear.
            onChange: () => {},
            onClick: (event: MouseEvent<HTMLInputElement>) => {
                if (disabled || readOnly) {
                    event.preventDefault();
                    return;
                }
                if (event.defaultPrevented || (checked && !allowDeselect))
                    return;
                onCheckedChange(!checked, event);
            },
        });
    }
);
