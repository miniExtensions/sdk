import { createElement, type ReactNode } from 'react';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';
import {
    NumberControl,
    numberConfiguration,
    type NumberFieldOptions,
} from './NumberField.js';

export type PercentFieldOptions = NumberFieldOptions;

/** Native fraction input; the accepted numeric scalar owns parsing and drafts. */
export function renderPercentField(
    props: FieldRendererProps<'percent'>,
    options: PercentFieldOptions = {}
): ReactNode {
    const capability = props.capability;
    const candidate =
        capability.type === 'editable' ? capability.scalar : undefined;
    if (candidate?.state.retired) return null;
    const scalar = candidate?.state.kind === 'number' ? candidate : undefined;
    const config = numberConfiguration(props.displayConfig, props.writeConfig);
    return createElement(NumberControl, {
        ...config,
        ...options,
        title: props.title.trim() ? props.title : props.field.name,
        input:
            scalar?.state.input ??
            (typeof props.value === 'number' && Number.isFinite(props.value)
                ? String(props.value)
                : ''),
        disabled:
            config.configuredReadOnly ||
            props.computed ||
            props.pending ||
            !scalar?.state.canEdit,
        pending: props.pending,
        invalid:
            scalar?.state.valid === false ||
            props.error !== null ||
            props.validation.length > 0,
        feedback:
            scalar?.state.error ??
            props.error ??
            props.validation.map((error) => error.errorMessage).join('\n'),
        setInput: (input) => scalar?.setInput(input),
    });
}
