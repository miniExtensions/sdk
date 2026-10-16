import {
    createElement,
    useId,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import {
    isFieldReadValue,
    type FieldRendererProps,
} from '../ui/rendererRegistry.js';
import { useFieldBinding, type FieldProps } from './index.js';
import { textConfiguration } from './TextField.js';

export type BarcodeFieldOptions = { className?: string };
export type BarcodeFieldProps = FieldProps & BarcodeFieldOptions;

/** Only the supplied text is presented; the owner retains the native object/type. */
function barcodeText(value: unknown): string | null {
    try {
        return isFieldReadValue('barcode', value) ? (value?.text ?? '') : null;
    } catch {
        return null;
    }
}

type BarcodeControlProps = BarcodeFieldOptions & {
    title: string;
    text: string | null;
    showTitle: boolean;
    pending: boolean;
    invalid: boolean;
    feedback: string;
};
const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Escaped selectable text, without a scanner, generated image, link or editor. */
function BarcodeControl(props: BarcodeControlProps): ReactNode {
    const id = useId();
    return createElement(
        'span',
        {
            className: ['mx-sdk-barcode-field', props.className]
                .filter(Boolean)
                .join(' '),
            onClick: stop,
            onAuxClick: stop,
            onDoubleClick: stop,
            onPointerDown: stop,
            onKeyDown: stop,
            onKeyUp: stop,
        },
        props.showTitle
            ? createElement('label', { htmlFor: id }, props.title)
            : null,
        createElement(
            'output',
            {
                id,
                'aria-label': props.showTitle ? undefined : props.title,
                'aria-busy': props.pending,
                'aria-invalid': props.invalid || props.text === null,
                'aria-describedby': props.feedback
                    ? `${id}-feedback`
                    : undefined,
                style: {
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    display: 'block',
                },
            },
            props.text ?? 'Unavailable'
        ),
        createElement(
            'span',
            { id: `${id}-feedback`, role: 'status', 'aria-live': 'polite' },
            props.feedback
        )
    );
}

/** Display-only adapter for the existing physical renderBarcodeField slot. */
export function renderBarcodeField(
    props: FieldRendererProps<'barcode'>,
    options: BarcodeFieldOptions = {}
): ReactNode {
    const config = textConfiguration(props.displayConfig, props.writeConfig);
    return createElement(BarcodeControl, {
        className: options.className,
        title: props.title.trim() ? props.title : props.field.name,
        // Mask before even reading the value reference or validating native text/type.
        text: config.password ? '••••••••' : barcodeText(props.value),
        showTitle: config.showTitle,
        pending: props.pending,
        invalid: props.error !== null || props.validation.length > 0,
        feedback:
            props.error ??
            props.validation.map((item) => item.errorMessage).join('\n'),
    });
}

/** Subscribe to accepted native answers without borrowing binding write actions. */
export function BarcodeField({
    binding,
    render,
    className,
}: BarcodeFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'barcode' ||
        schema.airtableField.config.type !== 'barcode'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Barcode fields.'
        );
    const config = textConfiguration(schema.miniExtConfig);
    return createElement(BarcodeControl, {
        className,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : schema.airtableField.name,
        text: config.password ? '••••••••' : barcodeText(snapshot.value),
        showTitle: config.showTitle,
        pending: snapshot.pending,
        invalid: snapshot.error !== null || snapshot.validation.length > 0,
        feedback:
            snapshot.error ??
            snapshot.validation.map((item) => item.errorMessage).join('\n'),
    });
}
