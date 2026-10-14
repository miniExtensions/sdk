import { createElement, type ReactNode } from 'react';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';
import {
    TextControl,
    textConfiguration,
    type TextFieldOptions,
} from './TextField.js';

export type EmailFieldOptions = TextFieldOptions;

/** Exact text editing; email validation remains with the page and server owners. */
export function renderEmailField(
    props: FieldRendererProps<'email'>,
    options: EmailFieldOptions = {}
): ReactNode {
    const config = textConfiguration(props.displayConfig, props.writeConfig);
    const capability = props.capability;
    return createElement(TextControl, {
        ...config,
        ...options,
        source:
            capability.type === 'editable' ? capability.setValue : capability,
        title: props.title.trim() ? props.title : props.field.name,
        value: props.value ?? '',
        disabled:
            config.configuredReadOnly ||
            capability.type !== 'editable' ||
            props.computed ||
            props.pending,
        pending: props.pending,
        invalid: props.error !== null || props.validation.length > 0,
        feedback:
            props.error ??
            props.validation.map((error) => error.errorMessage).join('\n'),
        setValue: (value) =>
            capability.type === 'editable' &&
            capability.setValue(value).accepted,
    });
}
