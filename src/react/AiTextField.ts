import {
    createElement,
    useId,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';
import { useFieldBinding, type FieldProps } from './index.js';
import { textConfiguration } from './TextField.js';

export type AiTextFieldOptions = { className?: string };
export type AiTextFieldProps = FieldProps & AiTextFieldOptions;

/** Validate the runtime native object without coercing or interpreting its state. */
function suppliedText(readValue: () => unknown): string | null {
    try {
        const native = readValue();
        if (native === null || native === undefined) return '';
        if (
            typeof native !== 'object' ||
            Array.isArray(native) ||
            Object.getPrototypeOf(native) !== Object.prototype
        )
            return null;
        const { state, value, isStale, errorType } = native as Record<
            string,
            unknown
        >;
        return typeof state === 'string' &&
            ['empty', 'loading', 'generated', 'error'].includes(state) &&
            typeof value === 'string' &&
            typeof isStale === 'boolean' &&
            (errorType === undefined || typeof errorType === 'string')
            ? value
            : null;
    } catch {
        return null;
    }
}

type AiTextControlProps = AiTextFieldOptions & {
    title: string;
    text: string | null;
    showTitle: boolean;
    pending: boolean;
    invalid: boolean;
    feedback: string;
};
const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Escaped selectable text; generation state and stale flags remain owner data. */
function AiTextControl(props: AiTextControlProps): ReactNode {
    const id = useId();
    return createElement(
        'span',
        {
            className: ['mx-sdk-ai-text-field', props.className]
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

/** Read-only adapter for the existing physical renderAiTextField slot. */
export function renderAiTextField(
    props: FieldRendererProps<'aiText'>,
    options: AiTextFieldOptions = {}
): ReactNode {
    const config = textConfiguration(props.displayConfig, props.writeConfig);
    return createElement(AiTextControl, {
        className: options.className,
        title: props.title.trim() ? props.title : props.field.name,
        // Mask before reading the native reference or any native property.
        text: config.password ? '••••••••' : suppliedText(() => props.value),
        showTitle: config.showTitle,
        pending: props.pending,
        invalid: props.error !== null || props.validation.length > 0,
        feedback:
            props.error ??
            props.validation.map((item) => item.errorMessage).join('\n'),
    });
}

/** Observe accepted owner snapshots without borrowing write or save actions. */
export function AiTextField({
    binding,
    render,
    className,
}: AiTextFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'aiText' ||
        schema.airtableField.config.type !== 'aiText'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports AI Text fields.'
        );
    const config = textConfiguration(schema.miniExtConfig);
    return createElement(AiTextControl, {
        className,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : schema.airtableField.name,
        text: config.password ? '••••••••' : suppliedText(() => snapshot.value),
        showTitle: config.showTitle,
        pending: snapshot.pending,
        invalid: snapshot.error !== null || snapshot.validation.length > 0,
        feedback:
            snapshot.error ??
            snapshot.validation.map((item) => item.errorMessage).join('\n'),
    });
}
