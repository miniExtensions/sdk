import { createElement, type ReactNode } from 'react';
import {
    isFieldReadValue,
    type FieldRendererProps,
} from '../ui/rendererRegistry.js';
import {
    TextControl,
    textConfiguration,
    type TextFieldOptions,
} from './TextField.js';
import {
    CompleteSingleCollaboratorField,
    type CompleteCollaborator,
    type CompleteCollaboratorLabels,
    type CompleteSingleCollaboratorFieldProps,
} from './CompleteCollaboratorField.js';

export type CreatedByFieldOptions = TextFieldOptions;

/** Host-projected creator display; computed authors grant no editing authority. */
export type ControlledCreatedByFieldProps<
    T extends CompleteCollaborator = CompleteCollaborator,
> = Pick<
    CompleteSingleCollaboratorFieldProps<T>,
    | 'value'
    | 'disabled'
    | 'visible'
    | 'inputId'
    | 'formId'
    | 'ariaLabel'
    | 'labelledBy'
    | 'describedBy'
    | 'invalid'
    | 'title'
    | 'showLabel'
    | 'className'
    | 'avatarPolicy'
> & {
    mode: 'controlled';
    readOnly?: true;
    labels?: Pick<CompleteCollaboratorLabels, 'empty'>;
    binding?: never;
    render?: never;
    owner?: never;
    choices?: never;
    onValueChange?: never;
    onChange?: never;
};

const emptyChoices: readonly never[] = Object.freeze([]);
const readonlyDisplayOwner = Object.freeze({
    token: null,
    isCurrent: () => false,
});
const ignoreChange = () => {};

/** Hook-free projection: never inspect or forward caller editing capabilities. */
export function renderControlledCreatedByField<T extends CompleteCollaborator>(
    props: ControlledCreatedByFieldProps<T>
): ReactNode {
    return createElement(CompleteSingleCollaboratorField<T>, {
        value: props.value,
        choices: emptyChoices,
        owner: readonlyDisplayOwner,
        onValueChange: ignoreChange,
        readOnly: true,
        disabled: props.disabled,
        visible: props.visible,
        inputId: props.inputId,
        formId: props.formId,
        ariaLabel: props.ariaLabel,
        labelledBy: props.labelledBy,
        describedBy: props.describedBy,
        invalid: props.invalid,
        title: props.title,
        showLabel: props.showLabel,
        className: props.className,
        avatarPolicy: props.avatarPolicy,
        labels: { empty: props.labels?.empty },
    });
}

/** Preserve the supplied native name without resolving another identity. */
export function createdByName(value: unknown): string {
    return isFieldReadValue('createdBy', value) ? (value?.name ?? '') : '';
}

/** Read-only collaborator presentation; the accepted owner keeps the native object. */
export function renderCreatedByField(
    props: FieldRendererProps<'createdBy'>,
    options: CreatedByFieldOptions = {}
): ReactNode {
    return createElement(TextControl, {
        ...textConfiguration(props.displayConfig, props.writeConfig),
        ...options,
        source: props.field,
        title: props.title.trim() ? props.title : props.field.name,
        value: createdByName(props.value),
        disabled: true,
        pending: props.pending,
        invalid: props.error !== null || props.validation.length > 0,
        feedback:
            props.error ??
            props.validation.map((error) => error.errorMessage).join('\n'),
        // Computed presentation never borrows selection, scalar or setter authority.
        setValue: () => false,
    });
}
