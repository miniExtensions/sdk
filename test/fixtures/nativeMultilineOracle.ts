/**
 * Frozen native multiline presentation oracle, mechanically translated from:
 * host component Git blob 71fa0096ade72c65179d19aaf6cd65caaf19fc08
 * components/Fields/FieldRenderer/MultilineTextField/MultilineTextField.tsx
 *
 * Mechanical substitutions only:
 * - JSX becomes createElement; TextareaInput remains the real public SDK
 *   primitive, without a mock or the legacy buffered multiline controller.
 * - airtableField.id, the session-derived form id, and miniExtFieldConfig's
 *   placeholderText/readOnly/characterLimit become corresponding scalar props.
 * - setValue becomes onChange; doesFieldHaveTextDescription becomes the already
 *   resolved hasDescription boolean. Description ownership stays with the host.
 * - clsx becomes a truthy-string join for its actual string/false inputs.
 *
 * Preserve the native local range state, effect dependencies, literal change
 * delivery, disabled read-only presentation, raw limit arithmetic, and markup.
 * This fixture has no exported ref API, just like the native component.
 */
import {
    createElement,
    useEffect,
    useRef,
    useState,
    type ChangeEventHandler,
} from 'react';
import { TextareaInput } from '../../src/react/index.js';

export type NativeMultilineTextFieldProps = {
    value: string | null;
    onChange: (value: string) => void;
    id: string;
    form?: string;
    placeholder?: string;
    readOnly?: boolean;
    characterLimit?: number;
    hasErrorMessage?: boolean;
    hasDescription?: boolean;
};

const joinClasses = (...values: (string | false | undefined)[]): string =>
    values.filter(Boolean).join(' ');

export function NativeMultilineTextField(props: NativeMultilineTextFieldProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [selectionStart, setSelectionStart] = useState<number | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
    const characterLimit = !props.readOnly ? props.characterLimit : undefined;
    const reachedCharacterLimit =
        props.value != null &&
        characterLimit != null &&
        characterLimit <= props.value.length;
    const handleChange: ChangeEventHandler<HTMLTextAreaElement> = (event) => {
        if (textareaRef.current != null) {
            setSelectionStart(textareaRef.current.selectionStart);
            setSelectionEnd(textareaRef.current.selectionEnd);
        }
        props.onChange(event.target.value);
    };

    useEffect(() => {
        if (
            textareaRef.current != null &&
            selectionStart != null &&
            selectionEnd != null
        ) {
            textareaRef.current.setSelectionRange(selectionStart, selectionEnd);
        }
    }, [props.value, selectionStart, selectionEnd]);

    return createElement(
        'div',
        { className: 'relative mt-1 w-full' },
        createElement(TextareaInput, {
            ref: textareaRef,
            className: joinClasses(
                'block w-full resize-y rounded-md border-gray-300 shadow-sm transition-colors duration-100 disabled:resize-none disabled:bg-gray-100 disabled:text-gray-600 sm:text-sm',
                reachedCharacterLimit
                    ? 'focus:border-red-500 focus:ring-red-500'
                    : 'focus:border-theme-500 focus:ring-theme-500'
            ),
            value: props.value ?? '',
            onChange: handleChange,
            disabled: props.readOnly,
            autoSize: { minRows: 3, maxRows: 30 },
            id: props.id,
            autoComplete: 'off',
            placeholder: props.placeholder,
            form: props.form,
            'aria-describedby':
                joinClasses(
                    props.hasErrorMessage && `${props.id}-error`,
                    props.hasDescription && `${props.id}-description`
                ) || undefined,
            'aria-invalid': props.hasErrorMessage,
            maxLength: characterLimit,
        }),
        characterLimit != null
            ? createElement(
                  'p',
                  {
                      className: joinClasses(
                          'ml-auto mt-1 w-fit text-xs',
                          reachedCharacterLimit
                              ? 'text-red-500'
                              : 'text-gray-500'
                      ),
                      title: 'Character Limit',
                  },
                  props.value?.length ?? 0,
                  '/',
                  characterLimit
              )
            : null
    );
}
