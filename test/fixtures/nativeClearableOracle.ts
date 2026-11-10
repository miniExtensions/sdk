/**
 * Frozen native presentation/settlement oracle, mechanically translated from:
 * host commit cf0fc85c4f26a9ebfc52c78c1247823e1d51dfa3
 * - components/ClearableTextInput.tsx
 *   Git blob b91b4eb045502f4a1e574658ba4dc53aca8bbfeb
 * - components/DeferredClearableTextInput.tsx
 *   Git blob 3fd226d290eb8eba86a49d716280406c642dd97a
 * - hooks/useIsInMobile.ts
 *   Git blob d0217fb10dbec80e46ad5fe487b4ca742f91d82a
 *
 * Mechanical substitutions only:
 * - JSX becomes React.createElement; public TextInput/InputClearButton remain
 *   real public SDK exports, not mocks or copied implementations.
 * - language/getLocalizedStrings(language).clear() becomes caller clearLabel.
 * - useIsInMobile() becomes useState(initialMobile): a test-only bridge for an
 *   already resolved device boolean, not a UAParser or device-detection proof.
 *   Wrapper and deferred mounts capture independently. In particular, the raw
 *   initialMobile prop is forwarded when the deferred child is newly mounted;
 *   the wrapper's previously captured boolean must not replace it.
 * - The two-argument clsx calls become the equivalent truthy-string join for
 *   their actual string/undefined/false inputs, without another dependency.
 *
 * Keep native spread/event order, autocomplete asymmetry, validation, local
 * refs and captured mount cleanup unchanged. This oracle intentionally retains
 * native behavior; it is not an owner-safety repair or a locale/device test.
 */
import {
    createElement,
    forwardRef,
    useState,
    useCallback,
    useEffect,
    useRef,
    type ChangeEvent,
    type DetailedHTMLProps,
    type InputHTMLAttributes,
    type KeyboardEvent,
} from 'react';
import { TextInput, InputClearButton } from '../../src/react/index.js';

export type NativeDeferredClearableTextInputProps = Omit<
    DetailedHTMLProps<InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>,
    'onChange' | 'defaultValue'
> & {
    clearLabel: string;
    initialMobile: boolean;
    onClear: () => void;
    onChange: (value: string) => void;
    value: string;
    validateInput?: (value: string) => boolean;
};

export type NativeClearableTextInputProps =
    NativeDeferredClearableTextInputProps & {
        enableInlineEdit: boolean;
    };

const joinClasses = (...values: (string | undefined | false)[]): string =>
    values.filter(Boolean).join(' ');

const useResolvedInitialMobile = (initialMobile: boolean): boolean => {
    const [is] = useState(initialMobile);
    return is;
};

export const NativeDeferredClearableTextInput = forwardRef<
    HTMLInputElement,
    NativeDeferredClearableTextInputProps
>((props, ref) => {
    const {
        onChange,
        value,
        onClear,
        clearLabel,
        initialMobile,
        validateInput,
        ...restProps
    } = props;
    const isInMobile = useResolvedInitialMobile(initialMobile);
    const [localValue, setLocalValue] = useState(value);
    const latestLocalValueRef = useRef(localValue);
    const shouldCleanup = useRef(false);

    useEffect(() => {
        // Reconcile settled values without replacing newer uncommitted typing.
        if (!shouldCleanup.current) setLocalValue(value);
    }, [value]);

    useEffect(() => {
        latestLocalValueRef.current = localValue;
    }, [localValue]);

    useEffect(() => {
        return () => {
            if (shouldCleanup.current) {
                onChange(latestLocalValueRef.current);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleChange = useCallback(
        (e: ChangeEvent<HTMLInputElement>) => {
            const newValue = e.target.value;
            if (validateInput == null || validateInput(newValue)) {
                shouldCleanup.current = true;
                setLocalValue(newValue);
            }
        },
        [validateInput]
    );

    const handleBlur = useCallback(() => {
        shouldCleanup.current = false;
        if (localValue !== value) {
            onChange(localValue);
        }
    }, [onChange, localValue, value]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!e.nativeEvent.isComposing) {
                e.currentTarget.blur();
            }
        }
    }, []);

    const handleClear = useCallback(() => {
        shouldCleanup.current = false;
        setLocalValue('');
        onClear();
    }, [onClear]);

    const isEmpty = localValue.length === 0;

    return createElement(
        'div',
        { className: 'relative flex-1' },
        createElement(TextInput, {
            ...restProps,
            className: joinClasses(restProps.className, isInMobile && 'pr-10'),
            ref,
            value: localValue,
            onChange: handleChange,
            onBlur: handleBlur,
            onKeyDown: handleKeyDown,
        }),
        isInMobile &&
            !isEmpty &&
            createElement(InputClearButton, {
                onClick: handleClear,
                disabled: restProps.disabled || restProps.readOnly,
                label: clearLabel,
                className:
                    'absolute inset-y-0 right-3 flex items-center text-gray-900',
                indicatorClassName: 'flex h-5 w-5 rounded-full bg-gray-600',
                iconClassName: 'm-auto h-3 w-3 text-white',
            })
    );
});

export const NativeClearableTextInput = forwardRef<
    HTMLInputElement,
    NativeClearableTextInputProps
>((props, ref) => {
    const {
        onChange,
        value,
        onClear,
        clearLabel,
        initialMobile,
        validateInput,
        enableInlineEdit,
        ...restProps
    } = props;
    const isInMobile = useResolvedInitialMobile(initialMobile);
    const isEmpty = value.length === 0;

    if (enableInlineEdit) {
        return createElement(NativeDeferredClearableTextInput, {
            ref,
            onChange,
            value,
            onClear,
            clearLabel,
            validateInput,
            initialMobile,
            ...restProps,
        });
    }

    return createElement(
        'div',
        { className: 'relative flex-1' },
        createElement(TextInput, {
            ...restProps,
            autoComplete: restProps.autoComplete ?? 'on',
            className: joinClasses(restProps.className, isInMobile && 'pr-10'),
            ref,
            value,
            onChange: (e: ChangeEvent<HTMLInputElement>) =>
                onChange(e.target.value),
        }),
        isInMobile &&
            !isEmpty &&
            createElement(InputClearButton, {
                onClick: onClear,
                disabled: restProps.disabled || restProps.readOnly,
                label: clearLabel,
                className:
                    'absolute inset-y-0 right-3 flex items-center text-gray-900',
                indicatorClassName: 'flex h-5 w-5 rounded-full bg-gray-600',
                iconClassName: 'm-auto h-3 w-3 text-white',
            })
    );
});
