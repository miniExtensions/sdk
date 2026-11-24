import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type MouseEvent,
    type ReactNode,
} from 'react';
import { getValidUrlHref } from '../forms/pageUrlValidation.js';
import { CompleteClearableTextInput } from './CompleteClearableTextInput.js';
import {
    AttachmentGallery,
    type AttachmentGalleryProps,
} from './AttachmentGallery.js';
import {
    SingleLineTextField,
    type ReadOnlySingleLineTextFieldProps,
} from './SingleLineTextField.js';
import {
    useBarcodeScannerButtonInField,
    type BarcodeScannerFieldOptions,
} from './useBarcodeScannerButton.js';

/** A host-provided identity and synchronous permission for this edit. */
export type UrlEditOwner = {
    token: unknown;
    isCurrent(): boolean;
};

export type ControlledUrlFieldProps = {
    mode: 'controlled';
    binding?: never;
    render?: never;
    value: string | null;
    onChange(value: string): void;
    /** Defaults to the same writer as typing and Clear. */
    onScan?(value: string): void;
    owner?: UrlEditOwner;
    enableInlineEdit?: boolean;
    disabled?: boolean;
    id?: string;
    form?: string;
    title?: string;
    showLabel?: boolean;
    placeholder?: string;
    describedBy?: string;
    labelledBy?: string;
    invalid?: boolean;
    initialMobile?: boolean;
    clearLabel?: string;
    className?: string;
    scanner?: Omit<
        BarcodeScannerFieldOptions,
        'fieldType' | 'setValue' | 'ownerKey' | 'readOnly' | 'isCurrent'
    >;
};

type ReadOnlyUrlGallery = Omit<
    AttachmentGalleryProps,
    | 'formRemovalOwner'
    | 'canRemoveFromTile'
    | 'canRemoveFromSlider'
    | 'onRemove'
    | 'confirmRemove'
    | 'onAnnotate'
>;

export type ReadOnlyUrlFieldProps = Omit<
    ReadOnlySingleLineTextFieldProps,
    'obscurePassword'
> & {
    /** A host's existing media projection for the same validated HTTP URL. */
    attachmentGallery?: ReadOnlyUrlGallery;
};

type EditGeneration = {
    signature: readonly unknown[];
    number: number;
};

type EditorProps = ControlledUrlFieldProps & {
    inputId: string;
    isCurrentGeneration(): boolean;
    allowAutoStart: boolean;
};

function UrlEditor(props: EditorProps): ReactNode {
    const useCommittedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    const input = useRef<HTMLInputElement>(null);
    const [focused, setFocused] = useState(false);
    const [lease] = useState(() => ({ mounted: false }));
    const committed = useRef<EditorProps | null>(null);
    useCommittedEffect(() => {
        committed.current = props;
    });
    useCommittedEffect(() => {
        lease.mounted = true;
        return () => {
            lease.mounted = false;
        };
    }, [lease]);

    function write(
        value: string,
        writer: (value: string) => void,
        settling = false
    ) {
        const current = committed.current;
        if (
            !current ||
            current.disabled ||
            !props.isCurrentGeneration() ||
            (!lease.mounted && !settling)
        )
            return;

        try {
            if (props.owner && props.owner.isCurrent() !== true) return;
        } catch {
            return;
        }

        // The host's authority check can synchronously replace the field.
        if (
            committed.current !== current ||
            !props.isCurrentGeneration() ||
            (!lease.mounted && !settling)
        )
            return;

        writer(value);
    }

    const scanner = useBarcodeScannerButtonInField({
        ...props.scanner,
        autoStartCamera:
            props.allowAutoStart && props.scanner?.autoStartCamera === true,
        fieldType: 'url',
        readOnly: props.disabled,
        ownerKey: lease,
        isCurrent: () =>
            props.isCurrentGeneration() &&
            (props.owner == null || props.owner.isCurrent() === true),
        setValue: (value) => write(value, props.onScan ?? props.onChange),
    });
    const value = props.value ?? '';
    const hasScanner = scanner.barcodeScannerButton != null;

    return h(
        'div',
        {
            className: ['mx-sdk-url-field', props.className]
                .filter(Boolean)
                .join(' '),
        },
        props.title && props.showLabel !== false
            ? h('label', { htmlFor: props.inputId }, props.title)
            : null,
        h(
            'div',
            {
                className: 'mx-sdk-url-control relative flex w-full',
                'data-disabled': props.disabled === true,
            },
            h(CompleteClearableTextInput, {
                ref: input,
                id: props.inputId,
                form: props.form,
                type: 'url',
                autoComplete: 'off',
                value,
                disabled: props.disabled,
                placeholder: props.placeholder,
                clearLabel: props.clearLabel ?? 'Clear',
                initialMobile: props.initialMobile ?? false,
                enableInlineEdit: props.enableInlineEdit === true,
                onChange: (next) => write(next, props.onChange),
                onUnmountChange: (next) => write(next, props.onChange, true),
                onClear: () => write('', props.onChange),
                onClick: (event) => event.stopPropagation(),
                onFocus: () => setFocused(true),
                onBlur: () => setFocused(false),
                'aria-label':
                    props.showLabel === false ? props.title : undefined,
                'aria-describedby': props.describedBy,
                'aria-labelledby': props.labelledBy,
                'aria-invalid': props.invalid,
                className: [
                    'mx-sdk-url-input block w-full rounded-l-md border-gray-300 transition-colors duration-100 focus:border-theme-500 focus:ring-inset focus:ring-theme-500 sm:text-sm',
                    !focused && 'mx-sdk-url-input-resting text-transparent',
                    hasScanner
                        ? 'mx-sdk-url-input-with-scanner'
                        : 'rounded-r-md',
                ]
                    .filter(Boolean)
                    .join(' '),
            }),
            !focused &&
                h(
                    'a',
                    {
                        href: getValidUrlHref(value) ?? undefined,
                        target: '_blank',
                        rel: 'noreferrer',
                        'aria-hidden': true,
                        tabIndex: -1,
                        className: [
                            'mx-sdk-url-overlay absolute top-2 max-w-full truncate pl-3 text-theme-700 underline hover:text-theme-500 sm:text-sm',
                            hasScanner
                                ? 'mx-sdk-url-overlay-with-scanner pr-10'
                                : 'pr-2',
                        ].join(' '),
                        onClick: (event: MouseEvent<HTMLAnchorElement>) => {
                            event.preventDefault();
                            input.current?.focus();
                        },
                        onAuxClick: (event: MouseEvent<HTMLAnchorElement>) =>
                            event.preventDefault(),
                    },
                    value
                ),
            scanner.barcodeScannerButton
        ),
        scanner.scannerComponent
    );
}

function ReadOnlyUrlField(props: ReadOnlyUrlFieldProps): ReactNode {
    const { attachmentGallery, ...presentation } = props;
    const href =
        typeof props.value === 'string' ? getValidUrlHref(props.value) : null;
    if (
        attachmentGallery &&
        props.displayAsAttachments === true &&
        href != null &&
        /^https?:\/\//i.test(href) &&
        attachmentGallery.rows.length === 1 &&
        attachmentGallery.rows[0]?.resourceUrl === href &&
        props.resource?.inert !== true &&
        props.resource?.owner == null
    ) {
        return h(AttachmentGallery, {
            ...attachmentGallery,
            onRemove: undefined,
            onAnnotate: undefined,
        });
    }

    return h(SingleLineTextField, {
        ...presentation,
        obscurePassword: false,
        className: ['mx-sdk-url-readonly', props.className]
            .filter(Boolean)
            .join(' '),
    });
}

type ConfiguredUrlFieldProps =
    | ControlledUrlFieldProps
    | ReadOnlyUrlFieldProps
    | { mode: 'binding'; content: ReactNode };

/** Keep the edit generation across mode changes. The host still owns Save. */
export function ConfiguredUrlField(props: ConfiguredUrlFieldProps): ReactNode {
    const useCommittedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    const generatedId = useId();
    const id =
        props.mode === 'controlled' ? (props.id ?? generatedId) : generatedId;
    const signature =
        props.mode === 'controlled'
            ? [
                  props.mode,
                  id,
                  props.form,
                  props.owner?.token,
                  props.owner != null,
                  props.disabled === true,
                  props.enableInlineEdit === true,
              ]
            : [props.mode];
    const [generation, setGeneration] = useState<EditGeneration>(() => ({
        signature,
        number: 0,
    }));
    let selected = generation;
    if (
        signature.length !== generation.signature.length ||
        !signature.every((value, i) =>
            Object.is(value, generation.signature[i])
        )
    ) {
        selected = { signature, number: generation.number + 1 };
        setGeneration(selected);
    }
    const committed = useRef<EditGeneration | null>(null);
    useCommittedEffect(() => {
        committed.current = selected;
    }, [selected]);

    if (props.mode === 'readOnly') return h(ReadOnlyUrlField, props);
    if (props.mode === 'binding') return props.content;

    return h(UrlEditor, {
        ...props,
        key: selected.number,
        inputId: id,
        isCurrentGeneration: () => committed.current === selected,
        allowAutoStart: selected.number === 0,
    });
}
