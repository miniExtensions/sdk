import {
    createElement,
    useId,
    type InputHTMLAttributes,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import type {
    FieldConfig,
    FieldRendererProps,
} from '../ui/rendererRegistry.js';

export type CheckboxInputProps = Pick<
    InputHTMLAttributes<HTMLInputElement>,
    | 'id'
    | 'form'
    | 'className'
    | 'disabled'
    | 'readOnly'
    | 'aria-label'
    | 'aria-labelledby'
    | 'aria-checked'
    | 'aria-invalid'
    | 'aria-required'
    | 'aria-busy'
    | 'aria-describedby'
> & {
    checked: boolean;
    onChange: NonNullable<InputHTMLAttributes<HTMLInputElement>['onChange']>;
};

/** Controlled native input; the caller owns labels, events and write policy. */
export function CheckboxInput(props: CheckboxInputProps): ReactNode {
    return createElement('input', { ...props, type: 'checkbox' });
}

export type CheckboxFieldOptions = {
    /** Applied to the wrapper; the optional stylesheet can be replaced entirely. */
    className?: string;
};

/** Presentation can further restrict an accepted capability, never grant one. */
export function checkboxConfiguration(config: FieldConfig<'checkbox'> | null) {
    return {
        disabled: !!(
            (config && 'readOnly' in config && config.readOnly) ||
            (config &&
                'enableCalendlyIntegration' in config &&
                config.enableCalendlyIntegration)
        ),
        showTitle: !(
            config &&
            'showTitle' in config &&
            config.showTitle === false
        ),
        required: !!(config && 'required' in config && config.required),
    };
}

type CheckboxControlProps = CheckboxFieldOptions & {
    title: string;
    checked: boolean;
    disabled: boolean;
    pending: boolean;
    invalid: boolean;
    feedback: string;
    showTitle: boolean;
    required: boolean;
    setChecked(checked: boolean): boolean;
};
const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Native presentation only. No draft, subscription, request or owner lifetime. */
export function CheckboxControl(props: CheckboxControlProps): ReactNode {
    const id = useId();
    return createElement(
        'span',
        {
            className: ['mx-sdk-checkbox-field', props.className]
                .filter(Boolean)
                .join(' '),
            onClick: stop,
            onAuxClick: stop,
            onDoubleClick: stop,
            onPointerDown: stop,
            onKeyDown: stop,
            onKeyUp: stop,
        },
        createElement(
            'label',
            { className: 'mx-sdk-checkbox-label', htmlFor: id },
            createElement(CheckboxInput, {
                id,
                className: 'mx-sdk-checkbox',
                checked: props.checked,
                disabled: props.disabled,
                'aria-label': props.showTitle ? undefined : props.title,
                'aria-invalid': props.invalid,
                'aria-required': props.required || undefined,
                'aria-busy': props.pending,
                'aria-describedby': props.feedback
                    ? `${id}-feedback`
                    : undefined,
                onChange: (
                    event: import('react').ChangeEvent<HTMLInputElement>
                ) => {
                    event.stopPropagation();
                    if (
                        props.disabled ||
                        !props.setChecked(event.currentTarget.checked)
                    ) {
                        event.currentTarget.checked = props.checked;
                    }
                },
            }),
            props.showTitle ? createElement('span', null, props.title) : null
        ),
        createElement(
            'span',
            {
                id: `${id}-feedback`,
                className: 'mx-sdk-checkbox-feedback',
                role: 'status',
                'aria-live': 'polite',
                'aria-atomic': true,
            },
            props.feedback
        )
    );
}

/** Shared Form/Grid/List slot; writes only through an accepted editable capability. */
export function renderCheckboxField(
    props: FieldRendererProps<'checkbox'>,
    options: CheckboxFieldOptions = {}
): ReactNode {
    const capability = props.capability;
    const scalar =
        capability.type === 'editable' ? capability.scalar : undefined;
    if (scalar?.state.retired) return null;
    const config = checkboxConfiguration(props.displayConfig);
    return createElement(CheckboxControl, {
        ...config,
        ...options,
        title: props.title.trim() ? props.title : props.field.name,
        checked:
            scalar?.state.kind === 'checkbox'
                ? scalar.state.checked
                : props.value === true,
        disabled:
            config.disabled ||
            checkboxConfiguration(props.writeConfig).disabled ||
            props.computed ||
            props.pending ||
            capability.type !== 'editable' ||
            !!(
                scalar &&
                (scalar.state.kind !== 'checkbox' || !scalar.state.canEdit)
            ),
        pending: props.pending,
        invalid:
            scalar?.state.valid === false ||
            props.error !== null ||
            props.validation.length > 0,
        feedback:
            scalar?.state.error ??
            props.error ??
            props.validation.map((error) => error.errorMessage).join('\n'),
        setChecked: (checked) =>
            capability.type === 'editable' &&
            (scalar
                ? scalar.setChecked(checked)
                : capability.setValue(checked).accepted),
    });
}
