import {
    createElement,
    useId,
    useRef,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import type { RuntimeFieldSchema } from '../runtime/types.js';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';
import { getFormattedDuration } from '../formulas/durationFormatting.js';
import { isDurationFormat, type DurationFormat } from '../ui/durationInput.js';

export type DurationFieldOptions = {
    /** Applied to the wrapper; the optional stylesheet can be replaced entirely. */
    className?: string;
    /** Accessible Clear label; defaults to "Clear <field title>". */
    clearLabel?: string;
};

type DurationConfig = RuntimeFieldSchema['miniExtConfig'] | null;
export function durationConfiguration(
    display: DurationConfig,
    write?: DurationConfig,
    format?: DurationFormat | null
) {
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
                ? (display.placeholderText ?? format ?? undefined)
                : (format ?? undefined),
    };
}

type DurationControlProps = DurationFieldOptions &
    ReturnType<typeof durationConfiguration> & {
        title: string;
        input: string;
        disabled: boolean;
        pending: boolean;
        invalid: boolean;
        feedback: string;
        setInput(input: string): void;
        setFocused(focused: boolean): void;
        clear(): void;
    };
const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Clock presentation only; the borrowed scalar owns input, units and focus state. */
export function DurationControl(props: DurationControlProps): ReactNode {
    const id = useId();
    const input = useRef<HTMLInputElement>(null);
    return createElement(
        'span',
        {
            className: ['mx-sdk-duration-field', props.className]
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
                  { className: 'mx-sdk-duration-label', htmlFor: id },
                  props.title
              )
            : null,
        createElement(
            'span',
            { className: 'mx-sdk-duration-control' },
            createElement('input', {
                ref: input,
                id,
                className: 'mx-sdk-duration',
                type: props.password ? 'password' : 'text',
                inputMode: 'text',
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
                onFocus: (event: SyntheticEvent) => {
                    event.stopPropagation();
                    if (!props.disabled) props.setFocused(true);
                },
                onBlur: (event: SyntheticEvent) => {
                    event.stopPropagation();
                    if (!props.disabled) props.setFocused(false);
                },
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
                    className: 'mx-sdk-duration-clear',
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
                className: 'mx-sdk-duration-feedback',
                role: 'status',
                'aria-live': 'polite',
                'aria-atomic': true,
            },
            props.feedback
        )
    );
}

/** Readonly slots have no scalar bridge. Format native seconds without creating an owner. */
const readonlyDuration = (value: unknown, format: unknown) => {
    if (!isDurationFormat(format))
        return { input: '', error: 'This duration format is unavailable.' };
    if (value == null) return { input: '', error: null };
    if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        !Number.isFinite(value * 1000)
    )
        return {
            input: '',
            error: 'This field has an unsupported native value.',
        };
    try {
        return {
            input: getFormattedDuration(String(value), format, true),
            error: null,
        };
    } catch {
        return {
            input: '',
            error: 'This field has an unsupported native value.',
        };
    }
};

/** Shared Form/Grid/List slot. Editing requires the accepted Duration focus/input bridge. */
export function renderDurationField(
    props: FieldRendererProps<'duration'>,
    options: DurationFieldOptions = {}
): ReactNode {
    const candidate =
        props.capability.type === 'editable'
            ? props.capability.scalar
            : undefined;
    if (candidate?.state.retired) return null;
    const scalar =
        candidate?.state.kind === 'duration' &&
        typeof candidate.setFocused === 'function'
            ? candidate
            : undefined;
    const metadata = props.field.config;
    const metadataFormat =
        metadata.type === 'duration'
            ? metadata.options?.durationFormat
            : undefined;
    const fallback = readonlyDuration(props.value, metadataFormat);
    const format =
        scalar?.state.durationFormat ??
        (isDurationFormat(metadataFormat) ? metadataFormat : null);
    const config = durationConfiguration(
        props.displayConfig,
        props.writeConfig,
        format
    );
    const error = scalar ? scalar.state.error : fallback.error;
    return createElement(DurationControl, {
        ...config,
        ...options,
        title: props.title.trim() ? props.title : props.field.name,
        input: scalar?.state.input ?? fallback.input,
        disabled:
            config.configuredReadOnly ||
            props.computed ||
            props.pending ||
            !scalar?.state.canEdit ||
            !isDurationFormat(scalar.state.durationFormat),
        pending: props.pending,
        invalid:
            scalar?.state.valid === false ||
            error !== null ||
            props.error !== null ||
            props.validation.length > 0,
        feedback:
            error ??
            props.error ??
            props.validation.map((error) => error.errorMessage).join('\n'),
        setInput: (input) => scalar?.setInput(input),
        setFocused: (focused) => scalar?.setFocused(focused),
        clear: () => scalar?.setInput(''),
    });
}
