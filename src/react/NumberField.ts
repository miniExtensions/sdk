import { TextInput } from './TextInput.js';
import {
    createElement,
    useId,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import type {
    FieldConfig,
    FieldRendererProps,
} from '../ui/rendererRegistry.js';

export type NumberFieldOptions = {
    /** Applied to the wrapper; the optional stylesheet can be replaced entirely. */
    className?: string;
};

type NumberConfig = FieldConfig<'number'> | null | undefined;
export function numberConfiguration(
    display: NumberConfig,
    write?: NumberConfig
) {
    const configs = [display, write].filter((config) => config != null);
    return {
        configuredReadOnly: configs.some(
            (config) => 'readOnly' in config && config.readOnly === true
        ),
        showTitle: !(
            display &&
            'showTitle' in display &&
            display.showTitle === false
        ),
        required: configs.some(
            (config) => 'required' in config && config.required === true
        ),
        password: configs.some(
            (config) =>
                'maskPasswordOnLoginScreen' in config &&
                config.maskPasswordOnLoginScreen === true
        ),
        placeholder:
            display && 'placeholderText' in display
                ? (display.placeholderText ?? undefined)
                : undefined,
    };
}

type NumberControlProps = NumberFieldOptions &
    ReturnType<typeof numberConfiguration> & {
        title: string;
        input: string;
        disabled: boolean;
        pending: boolean;
        invalid: boolean;
        feedback: string;
        setInput(input: string): void;
    };
const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Presentation only. The borrowed scalar owns parsing and unfinished input. */
export function NumberControl(props: NumberControlProps): ReactNode {
    const id = useId();
    return createElement(
        'span',
        {
            className: ['mx-sdk-number-field', props.className]
                .filter(Boolean)
                .join(' '),
            onClick: stop,
            onAuxClick: stop,
            onDoubleClick: stop,
            onPointerDown: stop,
            onKeyDown: stop,
            onKeyUp: stop,
            onCompositionStart: stop,
            onCompositionEnd: stop,
        },
        props.showTitle
            ? createElement(
                  'label',
                  { className: 'mx-sdk-number-label', htmlFor: id },
                  props.title
              )
            : null,
        createElement(TextInput, {
            id,
            className: 'mx-sdk-number',
            type: props.password ? 'password' : 'text',
            inputMode: 'decimal',
            value: props.input,
            disabled: props.disabled,
            placeholder: props.placeholder,
            autoComplete: 'off',
            spellCheck: false,
            'aria-label': props.showTitle ? undefined : props.title,
            'aria-required': props.required || undefined,
            'aria-invalid': props.invalid,
            'aria-busy': props.pending,
            'aria-describedby': props.feedback ? `${id}-feedback` : undefined,
            onChange: (
                event: import('react').ChangeEvent<HTMLInputElement>
            ) => {
                event.stopPropagation();
                if (props.disabled) {
                    event.currentTarget.value = props.input;
                    return;
                }
                // A false return can mean a retained incomplete draft. Render
                // the next owner snapshot; never parse or discard that input here.
                props.setInput(event.currentTarget.value);
            },
        }),
        createElement(
            'span',
            {
                id: `${id}-feedback`,
                className: 'mx-sdk-number-feedback',
                role: 'status',
                'aria-live': 'polite',
                'aria-atomic': true,
            },
            props.feedback
        )
    );
}

/** Shared Form/Grid/List slot. Editing requires the accepted scalar capability. */
export function renderNumberField(
    props: FieldRendererProps<'number'>,
    options: NumberFieldOptions = {}
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
