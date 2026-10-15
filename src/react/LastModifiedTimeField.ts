import { createElement, type ReactNode } from 'react';
import type {
    FieldMetadata,
    FieldRendererProps,
} from '../ui/rendererRegistry.js';
import {
    DateTimeControl,
    dateTimeConfiguration,
    type DateTimeFieldOptions,
} from './DateTimeField.js';

export type LastModifiedTimeFieldOptions = DateTimeFieldOptions;

/** Invalid result metadata stays blank; valid timestamps retain their native text. */
export function lastModifiedTimeInput(
    value: unknown,
    metadata: FieldMetadata<'lastModifiedTime'>['config'] | null | undefined
): string {
    return metadata?.type === 'lastModifiedTime' &&
        metadata.options?.isValid === true &&
        typeof value === 'string'
        ? value
        : '';
}

/** Read-only supplied timestamp; no referenced-field calculation or owner action. */
export function renderLastModifiedTimeField(
    props: FieldRendererProps<'lastModifiedTime'>,
    options: LastModifiedTimeFieldOptions = {}
): ReactNode {
    return createElement(DateTimeControl, {
        ...dateTimeConfiguration(props.displayConfig, props.writeConfig),
        ...options,
        title: props.title.trim() ? props.title : props.field.name,
        input: lastModifiedTimeInput(props.value, props.field.config),
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
