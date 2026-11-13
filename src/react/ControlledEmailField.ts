import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
    type Ref,
} from 'react';
import type { RuntimeLanguage } from '../runtime/types.js';
import { CompleteClearableTextInput } from './CompleteClearableTextInput.js';
import { CompleteReadOnlyTextField } from './CompleteReadOnlyTextField.js';
import { useBarcodeScannerButtonInField } from './useBarcodeScannerButton.js';
import type {
    BarcodeScannerLabels,
    BarcodeScannerLayout,
} from './CompleteBarcodeScanner.js';

export type EmailEditOwner = {
    /** Opaque field/record/policy generation, renewed after replacement. */
    token: unknown;
    /** Only synchronous true admits a captured edit. */
    isCurrent(): boolean;
};

type EmailPresentation = BarcodeScannerLayout & {
    mode: 'controlled';
    value: string | null;
    /** Native email changes, including Clear, remain literal strings. */
    onChange(value: string): void;
    language: RuntimeLanguage;
    displayOnly?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    id?: string;
    form?: string;
    title?: string;
    showLabel?: boolean;
    placeholder?: string;
    describedBy?: string;
    labelledBy?: string;
    invalid?: boolean;
    inputRef?: Ref<HTMLInputElement>;
    initialMobile?: boolean;
    clearLabel?: string;
    enableQRCodeScannerForFormField?: boolean;
    autoStartCamera?: boolean;
    labels?: BarcodeScannerLabels;
    inputClassName?: string;
    scannerButtonClassName?: string;
    buttonAppearance?: 'filled' | 'unstyled';
};

export type ControlledEmailFieldProps = EmailPresentation &
    (
        | { enableInlineEdit?: false; owner?: EmailEditOwner }
        | { enableInlineEdit: true; owner: EmailEditOwner }
    );

type Boundary = { signature: readonly unknown[]; generation: number };
const sameSignature = (a: readonly unknown[], b: readonly unknown[]) =>
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]));
type ControllerProps = ControlledEmailFieldProps & {
    inputId: string;
    generationIsCurrent(): boolean;
};

function EmailController(props: ControllerProps): ReactNode {
    const deferred = props.enableInlineEdit === true;
    const unavailable = deferred && props.owner == null;
    const disabled =
        props.disabled === true || props.readOnly === true || unavailable;
    const [lease] = useState(() => ({ mounted: false }));
    const live = useRef<{ lease: typeof lease; props: ControllerProps } | null>(
        null
    );
    const committedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    committedEffect(() => {
        live.current = { lease, props };
    });
    committedEffect(() => {
        lease.mounted = true;
        return () => {
            lease.mounted = false;
        };
    }, [lease]);

    const emit = (value: string, detached = false) => {
        const active = live.current;
        if (
            active?.lease !== lease ||
            !props.generationIsCurrent() ||
            (!lease.mounted && !detached) ||
            active.props.disabled ||
            active.props.readOnly ||
            active.props.displayOnly ||
            (deferred && props.owner == null) ||
            (props.owner != null && props.owner.isCurrent() !== true)
        )
            return;
        // An authority callback may reenter React. Never adopt a successor
        // generation or writer, including during deferred unmount settlement.
        if (
            live.current !== active ||
            !props.generationIsCurrent() ||
            (!lease.mounted && !detached)
        )
            return;
        props.onChange(value);
    };
    const scanner = useBarcodeScannerButtonInField({
        fieldType: 'email',
        readOnly: disabled || props.displayOnly,
        enableQRCodeScannerForFormField: props.enableQRCodeScannerForFormField,
        autoStartCamera: props.autoStartCamera,
        ownerKey: lease,
        setValue: (text) => emit(text),
        labels: props.labels,
        style: props.style,
        desktopViewportOffset: props.desktopViewportOffset,
        scannerButtonClassName: props.scannerButtonClassName,
        buttonAppearance: props.buttonAppearance,
    });
    if (props.displayOnly)
        return h(CompleteReadOnlyTextField, {
            value: props.value,
            language: props.language,
            className: props.className,
        });
    return h(
        'div',
        {
            className: ['mx-sdk-email-editor', props.className]
                .filter(Boolean)
                .join(' '),
            style: props.style,
        },
        props.title && props.showLabel !== false
            ? h('label', { htmlFor: props.inputId }, props.title)
            : null,
        h(
            'div',
            {
                className:
                    'mx-sdk-email-control relative flex w-full text-gray-400 shadow-sm focus-within:text-theme-500',
            },
            h(CompleteClearableTextInput, {
                ref: props.inputRef,
                id: props.inputId,
                form: props.form,
                type: 'email',
                autoComplete: 'off',
                value: props.value ?? '',
                onChange: (text) => emit(text),
                onUnmountChange: (text) => emit(text, true),
                onClear: () => emit(''),
                clearLabel: props.clearLabel ?? 'Clear',
                initialMobile: props.initialMobile ?? false,
                enableInlineEdit: deferred,
                disabled,
                placeholder: props.placeholder,
                'aria-label':
                    props.showLabel === false ? props.title : undefined,
                'aria-describedby': props.describedBy,
                'aria-labelledby': props.labelledBy,
                'aria-invalid': props.invalid,
                className: [
                    'mx-sdk-email-input block w-full truncate rounded-l-md border-gray-300 pl-10 text-black transition-colors duration-100 focus:border-theme-500 focus:ring-inset focus:ring-theme-500 disabled:bg-gray-100 disabled:text-gray-600 sm:text-sm',
                    scanner.barcodeScannerButton == null && 'rounded-r-md',
                    props.inputClassName,
                ]
                    .filter(Boolean)
                    .join(' '),
            }),
            scanner.barcodeScannerButton,
            h(
                'span',
                {
                    className:
                        'mx-sdk-email-icon pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3',
                    'aria-hidden': true,
                },
                h(
                    'svg',
                    {
                        viewBox: '0 0 24 24',
                        fill: 'currentColor',
                        width: 20,
                        height: 20,
                        className: 'h-5 w-5 transition-colors duration-100',
                    },
                    h('path', {
                        d: 'M3 5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H3Zm0 2h18l-9 6L3 7Zm18 10H3V9.4l8.45 5.63a1 1 0 0 0 1.1 0L21 9.4V17Z',
                    })
                )
            )
        ),
        scanner.scannerComponent
    );
}

/** Complete Email presentation; the host owns canonical data and Save. */
export function ControlledEmailField(
    props: ControlledEmailFieldProps
): ReactNode {
    const generatedId = useId();
    const id = props.id ?? generatedId;
    const signature = [
        id,
        props.form,
        props.owner?.token,
        props.owner != null,
        props.enableInlineEdit === true,
        props.disabled === true,
        props.readOnly === true,
        props.displayOnly === true,
    ];
    const [boundary, setBoundary] = useState<Boundary>(() => ({
        signature,
        generation: 0,
    }));
    let selected = boundary;
    if (!sameSignature(boundary.signature, signature)) {
        selected = { signature, generation: boundary.generation + 1 };
        setBoundary(selected);
    }
    const committed = useRef<Boundary | null>(null);
    const committedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    committedEffect(() => {
        committed.current = selected;
    }, [selected]);
    return h(EmailController, {
        ...props,
        key: selected.generation,
        inputId: id,
        generationIsCurrent: () => committed.current === selected,
    });
}
