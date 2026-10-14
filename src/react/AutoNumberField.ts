import { createElement, type ReactNode } from 'react';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';
import {
    NumberControl,
    numberConfiguration,
    type NumberFieldOptions,
} from './NumberField.js';

export type AutoNumberFieldOptions = NumberFieldOptions;

/** Read-only native presentation; the owner supplies the number. */
export function renderAutoNumberField(
    props: FieldRendererProps<'autoNumber'>,
    options: AutoNumberFieldOptions = {}
): ReactNode {
    return createElement(NumberControl, {
        ...numberConfiguration(props.displayConfig, props.writeConfig),
        ...options,
        title: props.title.trim() ? props.title : props.field.name,
        input:
            typeof props.value === 'number' && Number.isFinite(props.value)
                ? String(props.value)
                : '',
        disabled: true,
        pending: props.pending,
        invalid: props.error !== null || props.validation.length > 0,
        feedback:
            props.error ??
            props.validation.map((error) => error.errorMessage).join('\n'),
        // No scalar or value setter is borrowed, even from malformed capabilities.
        setInput: () => {},
    });
}
