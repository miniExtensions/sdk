import { createElement, type ReactNode } from 'react';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';
import {
    DateTimeControl,
    dateTimeConfiguration,
    type DateTimeFieldOptions,
} from './DateTimeField.js';

export type CreatedTimeFieldOptions = DateTimeFieldOptions;

/** Preserve the supplied timestamp text without parsing result metadata. */
export function createdTimeInput(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/** Read-only timestamp presentation; the accepted owner keeps the native value. */
export function renderCreatedTimeField(
    props: FieldRendererProps<'createdTime'>,
    options: CreatedTimeFieldOptions = {}
): ReactNode {
    return createElement(DateTimeControl, {
        ...dateTimeConfiguration(props.displayConfig, props.writeConfig),
        ...options,
        title: props.title.trim() ? props.title : props.field.name,
        input: createdTimeInput(props.value),
        disabled: true,
        pending: props.pending,
        invalid: props.error !== null || props.validation.length > 0,
        feedback:
            props.error ??
            props.validation.map((error) => error.errorMessage).join('\n'),
        // Computed presentation never borrows a date model or setter authority.
        setInput: () => {},
        clear: () => {},
    });
}
