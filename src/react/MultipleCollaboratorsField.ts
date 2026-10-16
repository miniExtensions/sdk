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

export type MultipleCollaboratorsFieldOptions = { className?: string };
export type MultipleCollaboratorsFieldProps = FieldProps &
    MultipleCollaboratorsFieldOptions;

/** Preserve every supplied name and occurrence; the owner retains native objects. */
function collaboratorNames(value: unknown): string | null {
    try {
        return isFieldReadValue('multipleCollaborators', value)
            ? (value?.map((collaborator) => collaborator.name).join(', ') ?? '')
            : null;
    } catch {
        return null;
    }
}

type MultipleCollaboratorsControlProps = MultipleCollaboratorsFieldOptions & {
    title: string;
    text: string | null;
    showTitle: boolean;
    pending: boolean;
    invalid: boolean;
    feedback: string;
};
const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Escaped selectable names, without identity resolution, avatars or a picker. */
function MultipleCollaboratorsControl(
    props: MultipleCollaboratorsControlProps
): ReactNode {
    const id = useId();
    return createElement(
        'span',
        {
            className: ['mx-sdk-multiple-collaborators-field', props.className]
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

/** Display-only adapter for the existing physical Multiple Collaborators slot. */
export function renderMultipleCollaboratorsField(
    props: FieldRendererProps<'multipleCollaborators'>,
    options: MultipleCollaboratorsFieldOptions = {}
): ReactNode {
    const config = textConfiguration(props.displayConfig, props.writeConfig);
    return createElement(MultipleCollaboratorsControl, {
        className: options.className,
        title: props.title.trim() ? props.title : props.field.name,
        // Mask before reading the array reference, length, entries or native fields.
        text: config.password ? '••••••••' : collaboratorNames(props.value),
        showTitle: config.showTitle,
        pending: props.pending,
        invalid: props.error !== null || props.validation.length > 0,
        feedback:
            props.error ??
            props.validation.map((item) => item.errorMessage).join('\n'),
    });
}

/** Subscribe to accepted native arrays without borrowing binding write actions. */
export function MultipleCollaboratorsField({
    binding,
    render,
    className,
}: MultipleCollaboratorsFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'multipleCollaborators' ||
        schema.airtableField.config.type !== 'multipleCollaborators'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Multiple Collaborators fields.'
        );
    const config = textConfiguration(schema.miniExtConfig);
    return createElement(MultipleCollaboratorsControl, {
        className,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : schema.airtableField.name,
        text: config.password ? '••••••••' : collaboratorNames(snapshot.value),
        showTitle: config.showTitle,
        pending: snapshot.pending,
        invalid: snapshot.error !== null || snapshot.validation.length > 0,
        feedback:
            snapshot.error ??
            snapshot.validation.map((item) => item.errorMessage).join('\n'),
    });
}
