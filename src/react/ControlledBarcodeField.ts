import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    type ReactNode,
} from 'react';
import type {
    AirtableBarcodeValue,
    RuntimeLanguage,
} from '../runtime/types.js';
import { CompleteClearableTextInput } from './CompleteClearableTextInput.js';
import { CompleteReadOnlyTextField } from './CompleteReadOnlyTextField.js';
import { useBarcodeScannerButtonInField } from './useBarcodeScannerButton.js';
import type {
    BarcodeScannerLabels,
    BarcodeScannerLayout,
} from './CompleteBarcodeScanner.js';

export type ControlledBarcodeFieldProps = BarcodeScannerLayout & {
    mode: 'controlled';
    value: AirtableBarcodeValue | null;
    onChange(value: AirtableBarcodeValue): void;
    language: RuntimeLanguage;
    /** Display-only native field presentation, distinct from a disabled editor. */
    displayOnly?: boolean;
    readOnly?: boolean;
    owner?: { token: unknown; isCurrent(): boolean };
    id?: string;
    form?: string;
    title?: string;
    showLabel?: boolean;
    placeholder?: string;
    describedBy?: string;
    invalid?: boolean;
    initialMobile?: boolean;
    enableInlineEdit?: boolean;
    clearLabel?: string;
    autoStartCamera?: boolean;
    labels?: BarcodeScannerLabels;
    inputClassName?: string;
    scannerButtonClassName?: string;
    buttonAppearance?: 'filled' | 'unstyled';
};

/** The native barcode object and Save remain controlled by the caller. */
export function ControlledBarcodeField(
    props: ControlledBarcodeFieldProps
): ReactNode {
    const generatedId = useId();
    const id = props.id ?? generatedId;
    const generation = useRef(0);
    const lease = useMemo(
        () => ({ mounted: false, key: ++generation.current }),
        [
            id,
            props.form,
            props.owner?.token,
            props.readOnly,
            props.displayOnly,
            props.enableInlineEdit,
            props.autoStartCamera,
            props.placeholder,
        ]
    );
    const live = useRef({ lease, props });
    const committedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    committedEffect(() => {
        lease.mounted = true;
        live.current = { lease, props };
        return () => {
            lease.mounted = false;
        };
    });
    const commit = (text: string, detached = false) => {
        const active = live.current;
        if (
            active.lease !== lease ||
            (!lease.mounted && !detached) ||
            active.props.readOnly ||
            active.props.displayOnly ||
            !(active.props.owner?.isCurrent() ?? true)
        )
            return;
        // Read current metadata at admission; only text is replaced.
        // The authority callback may synchronously replace the owner. Recheck
        // the committed generation before invoking the writer.
        if (live.current !== active) return;
        active.props.onChange({ ...active.props.value, text });
    };
    const scanner = useBarcodeScannerButtonInField({
        fieldType: 'barcode',
        readOnly: props.readOnly || props.displayOnly,
        autoStartCamera: props.autoStartCamera,
        ownerKey: lease,
        setValue: (text) => commit(text),
        labels: props.labels,
        style: props.style,
        desktopViewportOffset: props.desktopViewportOffset,
        scannerButtonClassName: props.scannerButtonClassName,
        buttonAppearance: props.buttonAppearance,
    });
    if (props.displayOnly)
        return h(CompleteReadOnlyTextField, {
            value: props.value?.text ?? '',
            language: props.language,
            className: props.className,
        });
    return h(
        'div',
        {
            className: ['mx-sdk-barcode-editor', props.className]
                .filter(Boolean)
                .join(' '),
        },
        props.title && props.showLabel !== false
            ? h('label', { htmlFor: id }, props.title)
            : null,
        h(
            'div',
            { className: 'mx-sdk-barcode-editor-control relative flex' },
            h(CompleteClearableTextInput, {
                key: lease.key,
                id,
                form: props.form,
                type: 'text',
                autoComplete: 'off',
                value: props.value?.text ?? '',
                onChange: (text) => commit(text),
                onUnmountChange: (text) => commit(text, true),
                onClear: () => commit(''),
                clearLabel: props.clearLabel ?? 'Clear',
                initialMobile: props.initialMobile ?? false,
                enableInlineEdit: props.enableInlineEdit ?? false,
                disabled: props.readOnly,
                placeholder: props.placeholder,
                'aria-label':
                    props.showLabel === false ? props.title : undefined,
                'aria-describedby': props.describedBy,
                'aria-invalid': props.invalid,
                className: [
                    'mx-sdk-barcode-editor-input block w-full truncate rounded-l-md border-gray-300 transition-colors duration-100 focus:border-theme-500 focus:ring-inset focus:ring-theme-500 disabled:bg-gray-100 disabled:text-gray-600 sm:text-sm',
                    props.inputClassName,
                ]
                    .filter(Boolean)
                    .join(' '),
            }),
            scanner.barcodeScannerButton
        ),
        scanner.scannerComponent
    );
}
