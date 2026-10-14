import {
    createElement,
    useId,
    useRef,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import type { RuntimeFieldSchema } from '../runtime/types.js';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';

export type DateFieldOptions = {
    /** Applied to the wrapper; the optional stylesheet can be replaced entirely. */
    className?: string;
    /** Accessible Clear label; defaults to "Clear <field title>". */
    clearLabel?: string;
};

type DateConfig = RuntimeFieldSchema['miniExtConfig'] | null;
export function dateConfiguration(display: DateConfig, write?: DateConfig) {
    const configs = [display, write].filter((config) => config != null);
    return {
        configuredReadOnly: configs.some(
            (config) => 'readOnly' in config && config.readOnly === true
        ),
        password: configs.some(
            (config) =>
                ('obscurePassword' in config &&
                    config.obscurePassword === true) ||
                ('maskPasswordOnLoginScreen' in config &&
                    config.maskPasswordOnLoginScreen === true)
        ),
        showTitle: !(
            display &&
            'showTitle' in display &&
            display.showTitle === false
        ),
        required: configs.some(
            (config) => 'required' in config && config.required === true
        ),
        placeholder:
            display && 'placeholderText' in display
                ? (display.placeholderText ?? 'YYYY-MM-DD')
                : 'YYYY-MM-DD',
    };
}

type DateControlProps = DateFieldOptions &
    ReturnType<typeof dateConfiguration> & {
        title: string;
        input: string;
        disabled: boolean;
        pending: boolean;
        invalid: boolean;
        feedback: string;
        setInput(input: string): void;
        clear(): void;
    };
const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Calendar presentation only; the borrowed date model owns parsing and drafts. */
export function DateControl(props: DateControlProps): ReactNode {
    const id = useId();
    const input = useRef<HTMLInputElement>(null);
    return createElement(
        'span',
        {
            className: ['mx-sdk-date-field', props.className]
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
                  { className: 'mx-sdk-date-label', htmlFor: id },
                  props.title
              )
            : null,
        createElement(
            'span',
            { className: 'mx-sdk-date-control' },
            createElement('input', {
                ref: input,
                id,
                className: 'mx-sdk-date',
                type: props.password ? 'password' : 'text',
                value: props.input,
                disabled: props.disabled,
                placeholder: props.placeholder,
                autoComplete: 'off',
                spellCheck: false,
                'aria-label': props.showTitle ? undefined : props.title,
                'aria-required': props.required || undefined,
                'aria-invalid': props.invalid,
                'aria-busy': props.pending,
                'aria-describedby': props.feedback
                    ? `${id}-feedback`
                    : undefined,
                onChange: (
                    event: import('react').ChangeEvent<HTMLInputElement>
                ) => {
                    event.stopPropagation();
                    if (props.disabled) {
                        event.currentTarget.value = props.input;
                        return;
                    }
                    // False can mean retained partial/invalid input. The next
                    // owner snapshot remains authoritative for the visible text.
                    props.setInput(event.currentTarget.value);
                },
            }),
            createElement(
                'button',
                {
                    type: 'button',
                    className: 'mx-sdk-date-clear',
                    'aria-label': props.clearLabel?.trim()
                        ? props.clearLabel
                        : `Clear ${props.title}`,
                    'aria-controls': id,
                    disabled: props.disabled || props.input === '',
                    onMouseDown: (event: SyntheticEvent) =>
                        event.preventDefault(),
                    onClick: (event: SyntheticEvent) => {
                        event.stopPropagation();
                        if (!props.disabled && props.input !== '') {
                            props.clear();
                            input.current?.focus();
                        }
                    },
                },
                createElement('span', { 'aria-hidden': true }, '×')
            )
        ),
        createElement(
            'span',
            {
                id: `${id}-feedback`,
                className: 'mx-sdk-date-feedback',
                role: 'status',
                'aria-live': 'polite',
                'aria-atomic': true,
            },
            props.feedback
        )
    );
}

/** Shared Form/Grid/List slot. Editing requires the accepted calendar-date bridge. */
export function renderDateField(
    props: FieldRendererProps<'date'>,
    options: DateFieldOptions = {}
): ReactNode {
    const candidate =
        props.capability.type === 'editable'
            ? props.capability.date
            : undefined;
    if (candidate?.state.retired) return null;
    const date = candidate?.state.kind === 'date' ? candidate : undefined;
    const config = dateConfiguration(props.displayConfig, props.writeConfig);
    return createElement(DateControl, {
        ...config,
        ...options,
        title: props.title.trim() ? props.title : props.field.name,
        input:
            date?.state.input ??
            (typeof props.value === 'string' ? props.value : ''),
        disabled:
            config.configuredReadOnly ||
            props.computed ||
            props.pending ||
            !date?.state.canEdit,
        pending: props.pending,
        invalid:
            date?.state.valid === false ||
            props.error !== null ||
            props.validation.length > 0,
        feedback:
            date?.state.error ??
            props.error ??
            props.validation.map((error) => error.errorMessage).join('\n'),
        setInput: (value) => date?.setInput(value),
        clear: () => date?.clear(),
    });
}
