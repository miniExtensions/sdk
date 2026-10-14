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

export type CreatedByFieldOptions = TextFieldOptions;

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
