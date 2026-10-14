import {
    createElement,
    useId,
    useRef,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import type { RuntimeFieldSchema } from '../runtime/types.js';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';

export type CurrencyFieldOptions = {
    /** Applied to the wrapper; the optional stylesheet can be replaced entirely. */
    className?: string;
    /** Accessible Clear label; defaults to "Clear <field title>". */
    clearLabel?: string;
};

type CurrencyConfig = RuntimeFieldSchema['miniExtConfig'] | null;
export function currencyConfiguration(
    display: CurrencyConfig,
    write?: CurrencyConfig
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
                ? (display.placeholderText ?? undefined)
                : undefined,
    };
}

type CurrencyControlProps = CurrencyFieldOptions &
    ReturnType<typeof currencyConfiguration> & {
        title: string;
        input: string;
        symbol: string;
        disabled: boolean;
        pending: boolean;
        invalid: boolean;
        feedback: string;
        setInput(input: string): void;
        clear(): void;
    };
const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Native numeric input only; the borrowed scalar owns parsing and unfinished text. */
export function CurrencyControl(props: CurrencyControlProps): ReactNode {
    const id = useId();
    const input = useRef<HTMLInputElement>(null);
    return createElement(
        'span',
        {
            className: ['mx-sdk-currency-field', props.className]
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
                  { className: 'mx-sdk-currency-label', htmlFor: id },
                  props.title
              )
            : null,
        createElement(
            'span',
            { className: 'mx-sdk-currency-control' },
            props.symbol
                ? createElement(
                      'span',
                      {
                          id: `${id}-currency`,
                          className: 'mx-sdk-currency-symbol',
                      },
                      props.symbol
                  )
                : null,
            createElement('input', {
                ref: input,
                id,
                className: 'mx-sdk-currency',
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
                'aria-describedby':
                    [
                        props.symbol ? `${id}-currency` : '',
                        props.feedback ? `${id}-feedback` : '',
                    ]
                        .filter(Boolean)
                        .join(' ') || undefined,
                onFocus: stop,
                onBlur: stop,
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
                    className: 'mx-sdk-currency-clear',
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
                className: 'mx-sdk-currency-feedback',
                role: 'status',
                'aria-live': 'polite',
                'aria-atomic': true,
            },
            props.feedback
        )
    );
}

/** Shared Form/Grid/List slot. Editing requires the accepted numeric scalar bridge. */
export function renderCurrencyField(
    props: FieldRendererProps<'currency'>,
    options: CurrencyFieldOptions = {}
): ReactNode {
    const candidate =
        props.capability.type === 'editable'
            ? props.capability.scalar
            : undefined;
    if (candidate?.state.retired) return null;
    const scalar = candidate?.state.kind === 'number' ? candidate : undefined;
    const metadata = props.field.config;
    const config = currencyConfiguration(
        props.displayConfig,
        props.writeConfig
    );
    return createElement(CurrencyControl, {
        ...config,
        ...options,
        title: props.title.trim() ? props.title : props.field.name,
        symbol: metadata.type === 'currency' ? metadata.options.symbol : '',
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
        clear: () => scalar?.setInput(''),
    });
}
