import {
    createElement as h,
    forwardRef,
    useId,
    type ForwardedRef,
    type ReactNode,
} from 'react';
import {
    CompleteAddressAutocomplete,
    type CompleteAddressAutocompleteProps,
    type AddressAutocompleteLabels,
} from './CompleteAddressAutocomplete.js';
import {
    CompleteClearableTextInput,
    resolveCurrentClearableInputMobile,
} from './CompleteClearableTextInput.js';
import {
    CompleteReadOnlyTextField,
    type CompleteReadOnlyTextFieldProps,
} from './CompleteReadOnlyTextField.js';
import {
    useBarcodeScannerButtonInField,
    type BarcodeScannerFieldOptions,
} from './useBarcodeScannerButton.js';

export type AddressFieldScannerOptions = Omit<
    BarcodeScannerFieldOptions,
    'fieldType' | 'setValue'
>;

export type AutocompleteAddressFieldProps = CompleteAddressAutocompleteProps & {
    mode?: 'autocomplete';
    showCharacterCount?: boolean;
    scanner?: AddressFieldScannerOptions;
};

/** Manual admission has no read capability, even in an embedded preview. */
export type ManualAddressFieldProps = Omit<
    CompleteAddressAutocompleteProps,
    'identity' | 'reads' | 'labels' | 'theme'
> & {
    mode: 'manual';
    identity?: never;
    reads?: never;
    labels: Pick<AddressAutocompleteLabels, 'clear'>;
    explanation?: string;
    enableInlineEdit?: boolean;
    showCharacterCount?: boolean;
    scanner?: AddressFieldScannerOptions;
};

/** Already accepted/converted text. This mode owns neither a writer nor reads. */
export type ReadOnlyAddressFieldProps = CompleteReadOnlyTextFieldProps & {
    mode: 'readonly';
    identity?: never;
    reads?: never;
    onChange?: never;
};

export type AddressFieldProps =
    | AutocompleteAddressFieldProps
    | ManualAddressFieldProps
    | ReadOnlyAddressFieldProps;

function ManualAddressField({
    props,
    inputRef,
}: {
    props: ManualAddressFieldProps;
    inputRef: ForwardedRef<HTMLInputElement>;
}) {
    const generatedId = useId();
    const {
        mode: _mode,
        identity: _identity,
        reads: _reads,
        value,
        onChange,
        labels,
        explanation,
        enableInlineEdit,
        initialMobile,
        showCharacterCount: _showCharacterCount,
        scanner: _scanner,
        ...input
    } = props;
    const explanationId = `${input.id ?? generatedId}-address-preview`;
    const write = (next: string) => {
        if (!input.disabled && !input.readOnly) onChange(next);
    };
    return h(
        'div',
        { className: 'mx-sdk-address-field-manual' },
        h(CompleteClearableTextInput, {
            ...input,
            className: ['mx-sdk-address-input', input.className]
                .filter(Boolean)
                .join(' '),
            ref: inputRef,
            value: value ?? '',
            onChange: write,
            onClear: () => write(''),
            autoComplete: 'off',
            clearLabel: labels.clear,
            initialMobile:
                initialMobile ?? resolveCurrentClearableInputMobile(),
            enableInlineEdit: enableInlineEdit ?? false,
            'aria-describedby':
                [input['aria-describedby'], explanation && explanationId]
                    .filter(Boolean)
                    .join(' ') || undefined,
        }),
        explanation
            ? h(
                  'p',
                  {
                      id: explanationId,
                      className: 'mx-sdk-address-field-explanation',
                  },
                  explanation
              )
            : null
    );
}

/** Complete configured Address presentation; the caller owns accepted values. */
export const AddressField = forwardRef<HTMLInputElement, AddressFieldProps>(
    function AddressField(props, ref) {
        if (props.mode === 'readonly') {
            return h(CompleteReadOnlyTextField, {
                value: props.value,
                language: props.language,
                textSize: props.textSize,
                layout: props.layout,
                className: props.className,
            });
        }
        return h(EditingAddressField, { props, inputRef: ref });
    }
);

function EditingAddressField({
    props,
    inputRef,
}: {
    props: AutocompleteAddressFieldProps | ManualAddressFieldProps;
    inputRef: ForwardedRef<HTMLInputElement>;
}) {
    const scanner = useBarcodeScannerButtonInField({
        ...props.scanner,
        fieldType: 'singleLineText',
        readOnly: props.disabled || props.readOnly || props.scanner?.readOnly,
        enableQRCodeScannerForFormField:
            props.scanner?.enableQRCodeScannerForFormField,
        setValue: (value) => {
            if (!props.disabled && !props.readOnly) props.onChange(value);
        },
    });
    let editor: ReactNode;
    if (props.mode === 'manual') {
        editor = h(ManualAddressField, { props, inputRef });
    } else {
        const {
            mode: _mode,
            showCharacterCount: _counter,
            scanner: _scanner,
            ...input
        } = props;
        editor = h(CompleteAddressAutocomplete, { ...input, ref: inputRef });
    }
    return h(
        'div',
        { className: 'mx-sdk-address-field' },
        h(
            'div',
            { className: 'mx-sdk-address-field-editor' },
            editor,
            scanner.barcodeScannerButton
        ),
        props.maxLength == null || props.showCharacterCount === false
            ? null
            : h(
                  'p',
                  {
                      className: 'mx-sdk-address-field-counter',
                      'data-at-limit':
                          (props.value?.length ?? 0) >= props.maxLength,
                      title: 'Character Limit',
                  },
                  `${props.value?.length ?? 0}/${props.maxLength}`
              ),
        scanner.scannerComponent
    );
}
