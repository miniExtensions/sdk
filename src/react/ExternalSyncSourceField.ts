import { createElement, type ReactNode } from 'react';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';
import {
    TextControl,
    textConfiguration,
    type TextFieldOptions,
} from './TextField.js';

export type ExternalSyncSourceFieldOptions = TextFieldOptions;

/** Read-only supplied SDK string; choices do not remap the native value. */
export function renderExternalSyncSourceField(
    props: FieldRendererProps<'externalSyncSource'>,
    options: ExternalSyncSourceFieldOptions = {}
): ReactNode {
    return createElement(TextControl, {
        ...textConfiguration(props.displayConfig, props.writeConfig),
        ...options,
        source: props.field,
        title: props.title.trim() ? props.title : props.field.name,
        value: typeof props.value === 'string' ? props.value : '',
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
