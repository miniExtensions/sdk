import { RatingInput, type RatingInputProps } from './RatingInput.js';
import { createElement, type ReactNode, type SyntheticEvent } from 'react';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';
import {
    NumberControl,
    numberConfiguration,
    type NumberFieldOptions,
} from './NumberField.js';

export type RatingFieldOptions = NumberFieldOptions & {
    /** Opt-in icon/range presentation; default numeric editing is unchanged. */
    iconInput?: Omit<
        RatingInputProps,
        'value' | 'max' | 'disabled' | 'onChange'
    >;
};

/** Native rating input; the accepted numeric scalar owns parsing and drafts. */
export function renderRatingField(
    props: FieldRendererProps<'rating'>,
    options: RatingFieldOptions = {}
): ReactNode {
    const capability = props.capability;
    const candidate =
        capability.type === 'editable' ? capability.scalar : undefined;
    if (candidate?.state.retired) return null;
    const scalar = candidate?.state.kind === 'number' ? candidate : undefined;
    const config = numberConfiguration(props.displayConfig, props.writeConfig);
    if (options.iconInput && !config.password)
        return renderOwnedRatingInput({
            ...options.iconInput,
            className: options.className ?? options.iconInput.className,
            title: props.title.trim() ? props.title : props.field.name,
            showTitle: config.showTitle,
            value: props.value ?? null,
            max: props.field.config.options.max,
            disabled:
                config.configuredReadOnly ||
                props.computed ||
                props.pending ||
                !scalar?.state.canEdit,
            inputProps: {
                ...options.iconInput.inputProps,
                'aria-label': config.showTitle
                    ? options.iconInput.inputProps?.['aria-label']
                    : props.title,
                'aria-invalid':
                    scalar?.state.valid === false ||
                    props.error !== null ||
                    props.validation.length > 0,
                'aria-busy': props.pending,
                'aria-required': config.required || undefined,
            },
            feedback:
                scalar?.state.error ??
                props.error ??
                props.validation.map((error) => error.errorMessage).join('\n'),
            onChange: (value) =>
                scalar?.setInput(value === null ? '' : String(value)),
        });
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

const stop = (event: SyntheticEvent) => event.stopPropagation();
/** Existing field hosts own row/keyboard actions around the native control. */
export function renderOwnedRatingInput(props: RatingInputProps): ReactNode {
    return createElement(
        'span',
        {
            onClick: stop,
            onAuxClick: stop,
            onDoubleClick: stop,
            onPointerDown: stop,
            onKeyDown: stop,
            onKeyUp: stop,
        },
        createElement(RatingInput, props)
    );
}
