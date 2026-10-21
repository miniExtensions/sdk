import { LiteralText } from './LiteralText.js';
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

export type RichTextFieldOptions = { className?: string };
export type RichTextFieldProps = FieldProps & RichTextFieldOptions;

/** Preserve the supplied Markdown string, including whitespace and line endings. */
function literalText(value: unknown): string | null {
    return isFieldReadValue('richText', value) ? (value ?? '') : null;
}

type RichTextControlProps = RichTextFieldOptions & {
    title: string;
    text: string | null;
    showTitle: boolean;
    pending: boolean;
    invalid: boolean;
    feedback: string;
};
const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Plain escaped text only; this stage does not format Markdown or create an editor. */
function RichTextControl(props: RichTextControlProps): ReactNode {
    const id = useId();
    return createElement(
        'span',
        {
            className: ['mx-sdk-rich-text-field', props.className]
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
        createElement(LiteralText, {
            id,
            'aria-label': props.showTitle ? undefined : props.title,
            'aria-busy': props.pending,
            'aria-invalid': props.invalid || props.text === null,
            'aria-describedby': props.feedback ? `${id}-feedback` : undefined,
            value: props.text ?? 'Unavailable',
        }),
        createElement(
            'span',
            { id: `${id}-feedback`, role: 'status', 'aria-live': 'polite' },
            props.feedback
        )
    );
}

/** Literal display adapter for the existing physical renderRichTextField slot. */
export function renderRichTextField(
    props: FieldRendererProps<'richText'>,
    options: RichTextFieldOptions = {}
): ReactNode {
    const config = textConfiguration(props.displayConfig, props.writeConfig);
    return createElement(RichTextControl, {
        className: options.className,
        title: props.title.trim() ? props.title : props.field.name,
        // Mask before reading the native value reference, even for malformed values.
        text: config.password ? '••••••••' : literalText(props.value),
        showTitle: config.showTitle,
        pending: props.pending,
        invalid: props.error !== null || props.validation.length > 0,
        feedback:
            props.error ??
            props.validation.map((item) => item.errorMessage).join('\n'),
    });
}

/** Observe accepted owner snapshots without borrowing any editing or save actions. */
export function RichTextField({
    binding,
    render,
    className,
}: RichTextFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'richText' ||
        schema.airtableField.config.type !== 'richText'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Rich Text fields.'
        );
    const config = textConfiguration(schema.miniExtConfig);
    return createElement(RichTextControl, {
        className,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : schema.airtableField.name,
        text: config.password ? '••••••••' : literalText(snapshot.value),
        showTitle: config.showTitle,
        pending: snapshot.pending,
        invalid: snapshot.error !== null || snapshot.validation.length > 0,
        feedback:
            snapshot.error ??
            snapshot.validation.map((item) => item.errorMessage).join('\n'),
    });
}
