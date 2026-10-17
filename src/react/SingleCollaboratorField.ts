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

export type SingleCollaboratorFieldOptions = { className?: string };
export type SingleCollaboratorFieldProps = FieldProps &
    SingleCollaboratorFieldOptions;

/** Only the supplied name is presented; the owner retains the native collaborator object. */
function singleCollaboratorName(value: unknown): string | null {
    try {
        return isFieldReadValue('singleCollaborator', value)
            ? (value?.name ?? '')
            : null;
    } catch {
        return null;
    }
}

type SingleCollaboratorControlProps = SingleCollaboratorFieldOptions & {
    title: string;
    text: string | null;
    showTitle: boolean;
    pending: boolean;
    invalid: boolean;
    feedback: string;
};
const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Escaped supplied name, without an identity lookup, avatar, link or editor. */
function SingleCollaboratorControl(
    props: SingleCollaboratorControlProps
): ReactNode {
    const id = useId();
    return createElement(
        'span',
        {
            className: ['mx-sdk-single-collaborator-field', props.className]
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

/** Display-only adapter for the existing physical renderSingleCollaboratorField slot. */
export function renderSingleCollaboratorField(
    props: FieldRendererProps<'singleCollaborator'>,
    options: SingleCollaboratorFieldOptions = {}
): ReactNode {
    const config = textConfiguration(props.displayConfig, props.writeConfig);
    return createElement(SingleCollaboratorControl, {
        className: options.className,
        title: props.title.trim() ? props.title : props.field.name,
        // Mask before even reading the value reference or validating native identity metadata.
        text: config.password
            ? '••••••••'
            : singleCollaboratorName(props.value),
        showTitle: config.showTitle,
        pending: props.pending,
        invalid: props.error !== null || props.validation.length > 0,
        feedback:
            props.error ??
            props.validation.map((item) => item.errorMessage).join('\n'),
    });
}

/** Subscribe to accepted native answers without borrowing binding write actions. */
export function SingleCollaboratorField({
    binding,
    render,
    className,
}: SingleCollaboratorFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'singleCollaborator' ||
        schema.airtableField.config.type !== 'singleCollaborator'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Single Collaborator fields.'
        );
    const config = textConfiguration(schema.miniExtConfig);
    return createElement(SingleCollaboratorControl, {
        className,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : schema.airtableField.name,
        text: config.password
            ? '••••••••'
            : singleCollaboratorName(snapshot.value),
        showTitle: config.showTitle,
        pending: snapshot.pending,
        invalid: snapshot.error !== null || snapshot.validation.length > 0,
        feedback:
            snapshot.error ??
            snapshot.validation.map((item) => item.errorMessage).join('\n'),
    });
}
