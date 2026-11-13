import type * as React from 'react';
import {
    createElement,
    forwardRef,
    useCallback,
    useEffect,
    useRef,
    useState,
    type ChangeEvent,
    type InputHTMLAttributes,
    type KeyboardEvent,
} from 'react';
import { UAParser } from 'ua-parser-js';
import { TextInput } from './TextInput.js';
import { InputClearButton } from './InputClearButton.js';

export type CompleteDeferredClearableTextInputProps = Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'onChange' | 'value' | 'defaultValue' | 'children'
> & {
    value: string;
    onChange: (value: string) => void;
    onClear: () => void;
    /** Optional separate authority path for a dirty deferred writer's final settlement. */
    onUnmountChange?: (value: string) => void;
    /** Localized accessible name, resolved by the consumer. */
    clearLabel: string;
    /**
     * A resolved current-device result, captured for this component's mount.
     * SSR/hydration consumers must supply the same initial value on both sides.
     */
    initialMobile: boolean;
    /** Deferred typing only; clear and accepted external values do not use it. */
    validateInput?: (value: string) => boolean;
};

export type CompleteClearableTextInputProps =
    CompleteDeferredClearableTextInputProps & {
        enableInlineEdit: boolean;
    };

/**
 * Native bridge for the existing bounded current-device policy. Calling this
 * reads the current browser environment; importing/rendering the components
 * does not. Resolve before a new mount. Do not use it to change an initial
 * server value during hydration; hydrate that same explicit value first.
 */
export function resolveCurrentClearableInputMobile(): boolean {
    if (typeof window === 'undefined') return false;
    return (
        new UAParser(window.navigator.userAgent).getDevice().type === 'mobile'
    );
}

const inputClassName = (supplied: string | undefined, mobile: boolean) =>
    [supplied, mobile && 'pr-10'].filter(Boolean).join(' ');

const clearButton = (
    label: string,
    disabled: boolean | undefined,
    onClear: () => void
) =>
    createElement(InputClearButton, {
        onClick: onClear,
        disabled,
        label,
        className:
            'mx-sdk-complete-clearable-button absolute inset-y-0 right-3 flex items-center text-gray-900',
        indicatorClassName:
            'mx-sdk-complete-clearable-indicator flex h-5 w-5 rounded-full bg-gray-600',
        iconClassName:
            'mx-sdk-complete-clearable-icon m-auto h-3 w-3 text-white',
    });

/**
 * Controlled immediate presentation, or the native deferred lifecycle below.
 * Mobile classification and each deferred mode have their own mount lifetime.
 */
export const CompleteClearableTextInput = forwardRef<
    HTMLInputElement,
    CompleteClearableTextInputProps
>(function CompleteClearableTextInput(props, ref) {
    const {
        value,
        onChange,
        onClear,
        onUnmountChange,
        clearLabel,
        initialMobile,
        validateInput,
        enableInlineEdit,
        ...inputProps
    } = props;
    const [mobile] = useState(initialMobile);

    if (enableInlineEdit) {
        return createElement(CompleteDeferredClearableTextInput, {
            ...inputProps,
            ref,
            value,
            onChange,
            onClear,
            onUnmountChange,
            clearLabel,
            initialMobile,
            validateInput,
        });
    }
    return createElement(
        'div',
        {
            className: 'mx-sdk-complete-clearable-input relative flex-1',
            'data-mobile': mobile ? 'true' : 'false',
        },
        createElement(TextInput, {
            ...inputProps,
            autoComplete: inputProps.autoComplete ?? 'on',
            className: inputClassName(inputProps.className, mobile),
            ref,
            value,
            onChange: (event: ChangeEvent<HTMLInputElement>) =>
                onChange(event.target.value),
        }),
        mobile && value.length > 0
            ? clearButton(
                  clearLabel,
                  inputProps.disabled || inputProps.readOnly,
                  onClear
              )
            : null
    );
});

/** Deliberate native pending-unmount settlement stays with the mounted writer. */
export const CompleteDeferredClearableTextInput = forwardRef<
    HTMLInputElement,
    CompleteDeferredClearableTextInputProps
>(function CompleteDeferredClearableTextInput(
    {
        value,
        onChange,
        onClear,
        onUnmountChange,
        clearLabel,
        initialMobile,
        validateInput,
        ...inputProps
    },
    ref
) {
    const [mobile] = useState(initialMobile);
    const [localValue, setLocalValue] = useState(value);
    const latestLocalValueRef = useRef(localValue);
    const shouldCleanup = useRef(false);

    useEffect(() => {
        if (!shouldCleanup.current) setLocalValue(value);
    }, [value]);

    useEffect(() => {
        latestLocalValueRef.current = localValue;
    }, [localValue]);

    useEffect(() => {
        return () => {
            if (shouldCleanup.current) {
                shouldCleanup.current = false;
                (onUnmountChange ?? onChange)(latestLocalValueRef.current);
            }
        };
        // The original mounted writer is intentional. Ordinary blur below uses
        // the current callback; cleanup must never adopt a successor writer.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>) => {
            const next = event.target.value;
            if (validateInput == null || validateInput(next)) {
                shouldCleanup.current = true;
                setLocalValue(next);
            }
        },
        [validateInput]
    );
    const handleBlur = useCallback(() => {
        shouldCleanup.current = false;
        if (localValue !== value) onChange(localValue);
    }, [onChange, localValue, value]);
    const handleKeyDown = useCallback(
        (event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                if (!event.nativeEvent.isComposing) event.currentTarget.blur();
            }
        },
        []
    );
    const handleClear = useCallback(() => {
        shouldCleanup.current = false;
        setLocalValue('');
        onClear();
    }, [onClear]);

    return createElement(
        'div',
        {
            className: 'mx-sdk-complete-clearable-input relative flex-1',
            'data-mobile': mobile ? 'true' : 'false',
        },
        createElement(TextInput, {
            ...inputProps,
            className: inputClassName(inputProps.className, mobile),
            ref,
            value: localValue,
            onChange: handleChange,
            // Native deferred mode overrides these handlers rather than chaining
            // caller blur/key handlers (including the URL resting overlay).
            onBlur: handleBlur,
            onKeyDown: handleKeyDown,
        }),
        mobile && localValue.length > 0
            ? clearButton(
                  clearLabel,
                  inputProps.disabled || inputProps.readOnly,
                  handleClear
              )
            : null
    );
});
