import {
    createElement as h,
    forwardRef,
    useEffect,
    useId,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    useState,
    type ForwardedRef,
    type ReactNode,
} from 'react';
import type { RuntimeLanguage } from '../runtime/types.js';
import { getValidUrlHref } from '../forms/pageUrlValidation.js';
import { CompleteClearableTextInput } from './CompleteClearableTextInput.js';
import {
    CompleteAddressAutocomplete,
    type CompleteAddressAutocompleteProps,
} from './CompleteAddressAutocomplete.js';
import {
    CompleteReadOnlyTextField,
    type CompleteReadOnlyTextFieldProps,
} from './CompleteReadOnlyTextField.js';
import {
    CreatedTimeResource,
    type CreatedTimeResourceProps,
} from './CreatedTimeResource.js';
import {
    useBarcodeScannerButtonInField,
    type BarcodeScannerFieldOptions,
} from './useBarcodeScannerButton.js';

/** Observe the host's real authority; this component allocates no draft or Save. */
export type SingleLineTextEditOwner = {
    token: unknown;
    isCurrent(): boolean;
};

export type SingleLineTextAddressOptions =
    | ({ mode: 'autocomplete' } & Pick<
          CompleteAddressAutocompleteProps,
          'identity' | 'reads' | 'labels' | 'theme'
      >)
    | { mode: 'preview'; explanation: string };

type ControlledPresentation = {
    mode: 'controlled';
    binding?: never;
    render?: never;
    value: string | null;
    /** Literal strings, including Clear's empty string, stay with the native writer. */
    onChange(value: string): void;
    language: RuntimeLanguage;
    id?: string;
    form?: string;
    title?: string;
    showLabel?: boolean;
    placeholder?: string;
    describedBy?: string;
    labelledBy?: string;
    invalid?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    obscurePassword?: boolean;
    /** Native UTF-16 slice semantics, not code-point or grapheme truncation. */
    characterLimit?: number;
    initialMobile?: boolean;
    clearLabel?: string;
    address?: SingleLineTextAddressOptions;
    scanner?: Omit<
        BarcodeScannerFieldOptions,
        'fieldType' | 'setValue' | 'ownerKey' | 'readOnly' | 'isCurrent'
    >;
    className?: string;
    inputClassName?: string;
};

export type ControlledSingleLineTextFieldProps = ControlledPresentation &
    (
        | { enableInlineEdit?: false; owner?: SingleLineTextEditOwner }
        | { enableInlineEdit: true; owner: SingleLineTextEditOwner }
    );

export type ReadOnlySingleLineTextFieldProps = Pick<
    CompleteReadOnlyTextFieldProps,
    'value' | 'language' | 'textSize' | 'layout' | 'className'
> & {
    mode: 'readOnly';
    binding?: never;
    render?: never;
    onChange?: never;
    obscurePassword?: boolean;
    displayAsAttachments?: boolean;
    displayAsButton?: boolean;
    validButtonLabel?: string | null;
    invalidButtonLabel?: string | null;
    resource?: Pick<
        CreatedTimeResourceProps,
        'owner' | 'identity' | 'inert' | 'labels' | 'attachmentOptions'
    >;
};

export type SingleLineTextFieldProps =
    | ControlledSingleLineTextFieldProps
    | ReadOnlySingleLineTextFieldProps;

function ReadOnlySingleLineText(
    props: ReadOnlySingleLineTextFieldProps
): ReactNode {
    // The dispatcher validates shape before selecting this presentation.
    const masked =
        props.obscurePassword === true &&
        props.value != null &&
        props.value.length > 0;
    const href =
        !masked && typeof props.value === 'string'
            ? getValidUrlHref(props.value)
            : null;
    const attachment =
        props.displayAsAttachments === true &&
        href != null &&
        /^https?:\/\//i.test(href);
    if (!masked && (attachment || props.displayAsButton === true))
        return h(CreatedTimeResource, {
            ...props.resource,
            mode: attachment ? 'attachment' : 'button',
            href,
            buttonLabel:
                href == null
                    ? props.invalidButtonLabel
                    : props.validButtonLabel,
            className: props.className,
        });
    return h(CompleteReadOnlyTextField, {
        value: masked ? '••••••••' : props.value,
        language: props.language,
        textSize: props.textSize,
        layout: props.layout,
        className: props.className,
    });
}

type Boundary = { signature: readonly unknown[]; generation: number };
const same = (a: readonly unknown[], b: readonly unknown[]) =>
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]));
type ControllerProps = ControlledSingleLineTextFieldProps & {
    inputId: string;
    inputRef: ForwardedRef<HTMLInputElement>;
    generationIsCurrent(): boolean;
    allowAutoStart: boolean;
};

function SingleLineTextController(props: ControllerProps): ReactNode {
    const input = useRef<HTMLInputElement>(null);
    // Address intentionally has no ordinary input ref for caret capture.
    const addressInput = useRef<HTMLInputElement>(null);
    const [selection, setSelection] = useState<{
        start: number | null;
        end: number | null;
    }>({ start: null, end: null });
    const [lease] = useState(() => ({ mounted: false }));
    const live = useRef<ControllerProps | null>(null);
    const ownerEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    ownerEffect(() => {
        live.current = props;
    });
    ownerEffect(() => {
        lease.mounted = true;
        return () => {
            lease.mounted = false;
        };
    }, [lease]);
    const limit = props.readOnly ? undefined : props.characterLimit;
    const disabled =
        props.disabled === true ||
        props.readOnly === true ||
        (props.enableInlineEdit === true && props.owner == null);
    const admits = (detached = false) => {
        const current = live.current;
        if (
            current == null ||
            !props.generationIsCurrent() ||
            (!lease.mounted && !detached) ||
            current.disabled ||
            current.readOnly ||
            (props.enableInlineEdit === true && props.owner == null)
        )
            return false;
        if (props.owner != null) {
            try {
                if (props.owner.isCurrent() !== true) return false;
            } catch {
                return false;
            }
        }
        // A host authority check may reenter React; never adopt its successor.
        if (
            live.current !== current ||
            !props.generationIsCurrent() ||
            (!lease.mounted && !detached)
        )
            return false;
        return true;
    };
    const emit = (raw: string, detached = false, clear = false) => {
        if (!admits(detached)) return;
        const value = clear || limit == null ? raw : raw.slice(0, limit);
        if (input.current != null)
            setSelection({
                start: clear ? 0 : input.current.selectionStart,
                end: clear ? 0 : input.current.selectionEnd,
            });
        props.onChange(value);
    };
    const scanner = useBarcodeScannerButtonInField({
        ...props.scanner,
        autoStartCamera:
            props.allowAutoStart && props.scanner?.autoStartCamera === true,
        fieldType: 'singleLineText',
        readOnly: disabled,
        ownerKey: lease,
        isCurrent: admits,
        setValue: (value) => emit(value),
    });
    const address = props.obscurePassword ? undefined : props.address;
    const preview = address?.mode === 'preview';
    const previewId = `${props.inputId}-address-preview`;
    const reached =
        limit != null && props.value != null && limit <= props.value.length;
    const className = [
        'mx-sdk-single-line-input block max-h-60 w-full resize-none shadow-sm rounded-l-md border-gray-300 transition-colors duration-100 disabled:bg-gray-100 disabled:text-gray-600 sm:text-sm',
        reached
            ? 'focus:ring-red-500 focus:border-red-500'
            : 'focus:ring-theme-500 focus:border-theme-500',
        scanner.barcodeScannerButton == null && 'rounded-r-md',
        props.inputClassName,
    ]
        .filter(Boolean)
        .join(' ');
    const inputProps = {
        id: props.inputId,
        form: props.form,
        placeholder: props.placeholder,
        className,
        'data-at-limit': reached,
        'data-with-scanner': scanner.barcodeScannerButton != null,
        disabled,
        readOnly: props.readOnly,
        maxLength: limit,
        'aria-label': props.showLabel === false ? props.title : undefined,
        'aria-labelledby': props.labelledBy,
        'aria-describedby':
            [props.describedBy, preview && previewId]
                .filter(Boolean)
                .join(' ') || undefined,
        'aria-invalid': props.invalid,
    };
    useImperativeHandle(
        props.inputRef,
        () =>
            (address?.mode === 'autocomplete'
                ? addressInput.current
                : input.current)!,
        [address?.mode]
    );
    // Preserve native effect timing: capture at parent handleChange, then restore
    // when the accepted value or captured selection changes.
    useEffect(() => {
        if (
            input.current != null &&
            selection.start != null &&
            selection.end != null
        )
            input.current.setSelectionRange(selection.start, selection.end);
    }, [props.value, selection.start, selection.end]);
    return h(
        'div',
        {
            className: ['mx-sdk-single-line-field', props.className]
                .filter(Boolean)
                .join(' '),
        },
        props.title && props.showLabel !== false
            ? h('label', { htmlFor: props.inputId }, props.title)
            : null,
        h(
            'div',
            { className: 'mx-sdk-single-line-control relative flex' },
            address?.mode === 'autocomplete'
                ? h(CompleteAddressAutocomplete, {
                      ...inputProps,
                      identity: address.identity,
                      reads: {
                          listPredictions: (query, options) => {
                              if (!admits())
                                  return Promise.reject(
                                      new Error(
                                          'Address owner is no longer current'
                                      )
                                  );
                              return address.reads.listPredictions(
                                  query,
                                  options
                              );
                          },
                          getFormattedAddress: (placeId, options) => {
                              if (!admits())
                                  return Promise.reject(
                                      new Error(
                                          'Address owner is no longer current'
                                      )
                                  );
                              return address.reads.getFormattedAddress(
                                  placeId,
                                  options
                              );
                          },
                      },
                      labels: address.labels,
                      theme: address.theme,
                      ref: addressInput,
                      value: props.value,
                      onChange: (value) => emit(value),
                      initialMobile: props.initialMobile,
                  })
                : h(CompleteClearableTextInput, {
                      ...inputProps,
                      ref: input,
                      role: 'textbox',
                      type: props.obscurePassword ? 'password' : 'text',
                      value: props.value ?? '',
                      autoComplete: 'off',
                      initialMobile: props.initialMobile ?? false,
                      enableInlineEdit: props.enableInlineEdit === true,
                      clearLabel: props.clearLabel ?? 'Clear',
                      onChange: (value) => emit(value),
                      onUnmountChange: (value) => emit(value, true),
                      onClear: () => emit('', false, true),
                  }),
            scanner.barcodeScannerButton
        ),
        preview
            ? h(
                  'p',
                  {
                      id: previewId,
                      className:
                          'mx-sdk-single-line-address-preview mt-2 text-sm text-gray-600',
                  },
                  address.explanation
              )
            : null,
        limit != null
            ? h(
                  'p',
                  {
                      className: `mx-sdk-single-line-count ml-auto mt-1 w-fit text-xs ${reached ? 'text-red-500' : 'text-gray-500'}`,
                      title: 'Character Limit',
                      'data-at-limit': reached,
                  },
                  `${props.value?.length ?? 0}/${limit}`
              )
            : null,
        scanner.scannerComponent
    );
}

function EditingSingleLineText({
    props,
    inputRef,
}: {
    props: ControlledSingleLineTextFieldProps;
    inputRef: ForwardedRef<HTMLInputElement>;
}): ReactNode {
    const generatedId = useId();
    const id = props.id ?? generatedId;
    const address = props.obscurePassword ? undefined : props.address;
    const signature = [
        id,
        props.form,
        props.owner?.token,
        props.owner != null,
        props.enableInlineEdit === true,
        props.disabled === true,
        props.readOnly === true,
        props.obscurePassword === true,
        props.readOnly ? undefined : props.characterLimit,
        address?.mode,
        address?.mode === 'autocomplete' ? address.identity.session : undefined,
        address?.mode === 'autocomplete' ? address.identity.field : undefined,
        address?.mode === 'autocomplete'
            ? address.identity.readScope
            : undefined,
    ];
    const [boundary, setBoundary] = useState<Boundary>(() => ({
        signature,
        generation: 0,
    }));
    let selected = boundary;
    if (!same(boundary.signature, signature)) {
        selected = { signature, generation: boundary.generation + 1 };
        setBoundary(selected);
    }
    const committed = useRef<Boundary | null>(null);
    const ownerEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    ownerEffect(() => {
        committed.current = selected;
    }, [selected]);
    return h(SingleLineTextController, {
        ...props,
        key: selected.generation,
        inputId: id,
        inputRef,
        generationIsCurrent: () => committed.current === selected,
        allowAutoStart: selected.generation === 0,
    });
}

/** Complete configured native presentation. TextField/renderSingleLineTextField
 * retain their existing binding semantics, including null writes and IME policy. */
export const SingleLineTextField = forwardRef<
    HTMLInputElement,
    SingleLineTextFieldProps
>(function SingleLineTextField(props, ref) {
    return props.mode === 'readOnly'
        ? h(ReadOnlySingleLineText, props)
        : h(EditingSingleLineText, { props, inputRef: ref });
});
