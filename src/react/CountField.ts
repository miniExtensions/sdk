import { createElement, type ReactNode } from 'react';
import type {
    FieldMetadata,
    FieldRendererProps,
} from '../ui/rendererRegistry.js';
import {
    NumberControl,
    numberConfiguration,
    type NumberFieldOptions,
} from './NumberField.js';

export type CountFieldOptions = NumberFieldOptions;

/** Invalid Count result metadata keeps its accepted blank presentation. */
export function countInput(
    value: unknown,
    metadata: FieldMetadata<'count'>['config'] | null | undefined
): string {
    return metadata?.type === 'count' &&
        metadata.options?.isValid === true &&
        typeof value === 'number' &&
        Number.isFinite(value)
        ? String(value)
        : '';
}

/** Read-only supplied Count value; no count calculation or owner action. */
export function renderCountField(
    props: FieldRendererProps<'count'>,
    options: CountFieldOptions = {}
): ReactNode {
    return createElement(NumberControl, {
        ...numberConfiguration(props.displayConfig, props.writeConfig),
        ...options,
        title: props.title.trim() ? props.title : props.field.name,
        input: countInput(props.value, props.field.config),
        disabled: true,
        pending: props.pending,
        invalid: props.error !== null || props.validation.length > 0,
        feedback:
            props.error ??
            props.validation.map((error) => error.errorMessage).join('\n'),
        // Count never borrows a scalar or setter, even from forged capabilities.
        setInput: () => {},
    });
}
