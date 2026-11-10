import {
    createElement,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
    type ChangeEvent,
} from 'react';
import { TextareaInput } from './TextareaInput.js';

export type CompleteMultilineTextFieldProps = {
    /** Literal canonical value; the consumer owns conversion and persistence. */
    value: string | null;
    /** Every native change, including intermediate composition text. */
    onChange: (value: string) => void;
    id: string;
    form?: string;
    placeholder?: string;
    /** Native read-only presentation is disabled, with no editable limit. */
    readOnly?: boolean;
    /** Exact native metadata; no normalization or truncation is applied. */
    characterLimit?: number;
    hasErrorMessage?: boolean;
    hasDescription?: boolean;
};

/** Complete native multiline presentation; no draft, parser or writer policy. */
export const CompleteMultilineTextField = forwardRef<
    HTMLTextAreaElement,
    CompleteMultilineTextFieldProps
>(function CompleteMultilineTextField(
    {
        value,
        onChange,
        id,
        form,
        placeholder,
        readOnly,
        characterLimit: configuredCharacterLimit,
        hasErrorMessage,
        hasDescription,
    },
    ref
) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [selectionStart, setSelectionStart] = useState<number | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
    useImperativeHandle(
        ref,
        () => textareaRef.current as HTMLTextAreaElement,
        []
    );

    const characterLimit = !readOnly ? configuredCharacterLimit : undefined;
    const reachedCharacterLimit =
        value != null &&
        characterLimit != null &&
        characterLimit <= value.length;

    const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
        if (textareaRef.current != null) {
            setSelectionStart(textareaRef.current.selectionStart);
            setSelectionEnd(textareaRef.current.selectionEnd);
        }
        onChange(event.target.value);
    };

    // Retain the native effect timing and range-only caret restoration.
    useEffect(() => {
        if (
            textareaRef.current != null &&
            selectionStart != null &&
            selectionEnd != null
        ) {
            textareaRef.current.setSelectionRange(selectionStart, selectionEnd);
        }
    }, [value, selectionStart, selectionEnd]);

    const describedBy = [
        hasErrorMessage && `${id}-error`,
        hasDescription && `${id}-description`,
    ]
        .filter(Boolean)
        .join(' ');

    return createElement(
        'div',
        {
            className: 'relative mt-1 w-full mx-sdk-complete-multiline',
            'data-limit-reached': reachedCharacterLimit ? 'true' : 'false',
        },
        createElement(TextareaInput, {
            ref: textareaRef,
            className: [
                'block w-full resize-y rounded-md border-gray-300 shadow-sm transition-colors duration-100 disabled:resize-none disabled:bg-gray-100 disabled:text-gray-600 sm:text-sm',
                reachedCharacterLimit
                    ? 'focus:border-red-500 focus:ring-red-500'
                    : 'focus:border-theme-500 focus:ring-theme-500',
            ].join(' '),
            value: value ?? '',
            onChange: handleChange,
            disabled: readOnly,
            autoSize: { minRows: 3, maxRows: 30 },
            id,
            autoComplete: 'off',
            placeholder,
            form,
            'aria-describedby': describedBy || undefined,
            'aria-invalid': hasErrorMessage,
            maxLength: characterLimit,
        }),
        characterLimit != null
            ? createElement(
                  'p',
                  {
                      className: [
                          'ml-auto mt-1 w-fit text-xs',
                          reachedCharacterLimit
                              ? 'text-red-500'
                              : 'text-gray-500',
                      ].join(' '),
                      title: 'Character Limit',
                  },
                  `${value?.length ?? 0}/${characterLimit}`
              )
            : null
    );
});
