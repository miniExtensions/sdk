import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type InputHTMLAttributes,
    type ReactNode,
    type Ref,
} from 'react';
import { UAParser } from 'ua-parser-js';
import { Options as LinkifyOptions, tokenize } from 'linkifyjs';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';
import {
    formatNumberInputCompatibility,
    parseNumberInputCompatibility,
    type NumberInputSeparator,
} from '../ui/numberInputCompatibility.js';
import {
    createLocalizedNumericInputAdapter,
    isLocalizedNumericInputValid,
    type LocalizedNumericInputOwner,
} from '../ui/localizedNumericInput.js';
import { TextInput } from './TextInput.js';
import { InputClearButton } from './InputClearButton.js';

export type CompleteLocalizedNumericRendererProps =
    | FieldRendererProps<'number'>
    | FieldRendererProps<'percent'>
    | FieldRendererProps<'currency'>;

export type CompleteLocalizedNumericFieldOptions = {
    /** The host's actual owner/configuration token; ordinary value echoes retain it. */
    owner?: { token: unknown; isCurrent(): boolean };
    presentation?: 'editor' | 'display';
    commit?: 'immediate' | 'deferred';
    className?: string;
    inputClassName?: string;
    inputRef?: Ref<HTMLInputElement>;
    /** Existing enclosing field labels may own this association instead. */
    showLabel?: boolean;
    clearLabel?: string;
    emptyLabel?: string;
    input?: Omit<
        InputHTMLAttributes<HTMLInputElement>,
        | 'value'
        | 'defaultValue'
        | 'children'
        | 'type'
        | 'inputMode'
        | 'onChange'
        | 'onFocus'
        | 'onBlur'
        | 'onKeyDown'
        | 'disabled'
        | 'readOnly'
    >;
};

export type CompleteLocalizedNumericFieldProps = {
    field: CompleteLocalizedNumericRendererProps;
    options?: CompleteLocalizedNumericFieldOptions;
};

const classes = (...values: (string | false | undefined)[]) =>
    values.filter(Boolean).join(' ');
const displayValue = (field: CompleteLocalizedNumericRendererProps) =>
    field.value == null
        ? ''
        : field.physicalKind === 'percent'
          ? field.value * 100
          : field.value;

function configuration(field: CompleteLocalizedNumericRendererProps) {
    const config = field.displayConfig;
    const write = field.writeConfig;
    return {
        separator:
            config != null && 'numberSeparator' in config
                ? config.numberSeparator
                : undefined,
        grouping:
            config != null &&
            'showThousandsSeparator' in config &&
            config.showThousandsSeparator === true,
        allowNegative:
            (write != null && 'allowNegativeNumbers' in write
                ? write.allowNegativeNumbers
                : undefined) ??
            (config != null && 'allowNegativeNumbers' in config
                ? config.allowNegativeNumbers
                : undefined) ??
            false,
        readonly:
            field.capability.type !== 'editable' ||
            field.computed ||
            field.pending ||
            (config != null &&
                'readOnly' in config &&
                config.readOnly === true) ||
            (write != null && 'readOnly' in write && write.readOnly === true),
        placeholder:
            config != null && 'placeholderText' in config
                ? (config.placeholderText ?? undefined)
                : undefined,
        required: [config, write].some(
            (item) =>
                item != null && 'required' in item && item.required === true
        ),
        progress:
            field.physicalKind === 'percent' &&
            config != null &&
            'showAsProgressBar' in config &&
            config.showAsProgressBar === true,
    };
}

function formatted(field: CompleteLocalizedNumericRendererProps) {
    const config = configuration(field);
    return formatNumberInputCompatibility(
        displayValue(field),
        field.field.config,
        config.separator,
        config.grouping
    );
}

function ungroup(input: string, separator: NumberInputSeparator | undefined) {
    return input.replace(
        separator === 'period-comma'
            ? /\./g
            : separator === 'space-comma' || separator === 'space-period'
              ? / /g
              : /,/g,
        ''
    );
}

/** Numeric width never comes from parsing localized rendered text. */
function Progress({ value, label }: { value: number; label: string }) {
    const fill = value <= 0 ? 0 : value >= 100 ? 100 : value;
    return h(
        'div',
        { className: 'mx-sdk-localized-numeric-progress' },
        h(
            'div',
            { className: 'mx-sdk-localized-numeric-track' },
            h(
                'div',
                {
                    className: 'mx-sdk-localized-numeric-fill',
                    style: { width: `${fill || 0}%` },
                },
                h(
                    'span',
                    {
                        className: classes(
                            'mx-sdk-localized-numeric-progress-label',
                            value < 8 &&
                                'mx-sdk-localized-numeric-progress-outside'
                        ),
                    },
                    label
                )
            )
        )
    );
}

function EmptyValue({ label }: { label: string }) {
    return h(
        'p',
        { className: 'mx-sdk-localized-numeric-empty' },
        h(
            'svg',
            {
                className: 'mx-sdk-localized-numeric-empty-icon',
                viewBox: '0 0 24 24',
                fill: 'currentColor',
                'aria-hidden': true,
            },
            h('path', {
                fillRule: 'evenodd',
                clipRule: 'evenodd',
                d: 'm6.72 5.66 11.62 11.62A8.25 8.25 0 0 0 6.72 5.66Zm10.56 12.68L5.66 6.72a8.25 8.25 0 0 0 11.62 11.62ZM5.105 5.106c3.807-3.808 9.98-3.808 13.788 0 3.808 3.807 3.808 9.98 0 13.788-3.807 3.808-9.98 3.808-13.788 0-3.808-3.807-3.808-9.98 0-13.788Z',
            })
        ),
        label
    );
}

// Use the same native Linkify token/option policy without making React a
// required transitive peer for headless SDK consumers. React escapes every
// token; a currency symbol is never interpreted as HTML.
function NumericText({ text }: { text: string }) {
    const options = new LinkifyOptions({ target: '_blank' });
    return h(
        'p',
        null,
        tokenize(text).map((token, index) => {
            if (!token.isLink || !options.check(token)) return token.toString();
            const link = options.resolve(token);
            return h(
                'a',
                {
                    key: index,
                    href: link.formattedHref,
                    target: link.target || undefined,
                    rel: link.rel || undefined,
                    onClick: (
                        event: import('react').MouseEvent<HTMLAnchorElement>
                    ) => event.stopPropagation(),
                },
                link.formatted
            );
        })
    );
}

/**
 * Complete native-unit numeric presentation. This owns only the transient UI
 * draft. Host-guarded callbacks retain canonical value, permissions and Save.
 * Legacy raw NumberField/PercentField/CurrencyField contracts are unchanged.
 */
export function CompleteLocalizedNumericField({
    field,
    options = {},
}: CompleteLocalizedNumericFieldProps): ReactNode {
    // Select at render, not module import: SSR may import this module before
    // a later DOM consumer exists. Browser commits must precede old passive
    // cleanup so a retired deferred draft cannot reach its successor owner.
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    const config = configuration(field);
    const generatedId = useId();
    const id = options.input?.id ?? `${field.fieldId}-${generatedId}`;
    const title = field.title.trim() ? field.title : field.field.name;
    const [focused, setFocused] = useState(false);
    const [input, setInput] = useState(() => formatted(field));
    const [mobile, setMobile] = useState(false);
    const live = useRef<{
        lease: object;
        source: object;
        field: CompleteLocalizedNumericRendererProps;
        options: CompleteLocalizedNumericFieldOptions;
    } | null>(null);
    const pending = useRef<{
        lease: object;
        input: string;
        baseline: string;
    } | null>(null);
    const source = useMemo(
        () => ({}),
        [
            options.owner?.token,
            field.fieldId,
            field.context,
            field.physicalKind,
            options.input?.form,
        ]
    );
    const lease = useMemo(
        () => ({}),
        [
            source,
            field.field.config.options.precision,
            field.field.config.type === 'currency'
                ? field.field.config.options.symbol
                : '',
            config.separator,
            config.grouping,
            config.allowNegative,
            config.readonly,
            options.presentation,
            options.commit,
            options.input?.form,
        ]
    );

    const current = () =>
        live.current?.lease === lease &&
        !configuration(live.current.field).readonly &&
        (live.current.options.owner?.isCurrent() ?? true);
    const readOwner = (): LocalizedNumericInputOwner | null => {
        const owner = live.current;
        if (owner == null) return null;
        const settings = configuration(owner.field);
        return {
            airtableField: owner.field.field,
            miniExtFieldConfig: {
                numberSeparator: settings.separator,
                allowNegativeNumbers: settings.allowNegative,
                readOnly: settings.readonly,
            },
            value: owner.field.value ?? null,
            setValue: (value) =>
                owner.field.capability.type === 'editable' &&
                owner.field.capability.setValue(value).accepted,
        };
    };
    const adapter = useMemo(
        () =>
            createLocalizedNumericInputAdapter({
                read: readOwner,
                isCurrent: current,
            }),
        [lease]
    );
    const write = (text: string) => adapter.setInput(text);
    const valid = (text: string) => {
        const owner = readOwner();
        return (
            current() &&
            owner != null &&
            isLocalizedNumericInputValid(text, owner)
        );
    };

    useCommitEffect(() => {
        if (live.current != null && live.current.lease !== lease) {
            pending.current = null;
            if (live.current.source !== source) {
                const next = formatted(field);
                setInput(
                    focused && !config.readonly
                        ? ungroup(next, config.separator)
                        : next
                );
            }
            if (config.readonly) setFocused(false);
        }
        live.current = { lease, source, field, options };
    });
    useCommitEffect(() => {
        if (!focused) setInput(formatted(field));
    }, [
        field.value,
        focused,
        field.physicalKind,
        field.field.config.options.precision,
        config.separator,
        config.grouping,
    ]);
    useEffect(() => {
        setMobile(
            typeof navigator !== 'undefined' &&
                new UAParser(navigator.userAgent).getDevice().type === 'mobile'
        );
    }, []);
    useEffect(
        () => () => {
            const draft = pending.current;
            if (draft?.lease === lease) {
                pending.current = null;
                write(draft.input);
            }
            // A replacement's layout commit already installed its successor lease.
            // Genuine unmount finalizes once before retiring this UI lifetime.
            if (live.current?.lease === lease) live.current = null;
        },
        [lease]
    );

    const symbol =
        field.physicalKind === 'currency' &&
        field.field.config.type === 'currency'
            ? field.field.config.options.symbol
            : field.physicalKind === 'percent'
              ? '%'
              : '';
    const symbolId =
        field.physicalKind === 'currency' ? `${id}-currency-symbol` : undefined;
    const error =
        field.error ??
        field.validation.map((item) => item.errorMessage).join('\n');
    const hasError = field.error !== null || field.validation.length > 0;
    const feedbackId = hasError ? `${id}-feedback` : undefined;
    const showLabel =
        options.showLabel !== false &&
        !(
            field.displayConfig != null &&
            'showTitle' in field.displayConfig &&
            field.displayConfig.showTitle === false
        );
    const showProgress = config.progress && !focused;
    const label = formatted(field);
    const progressValue = field.value == null ? 0 : field.value * 100;
    const displayedProgress =
        parseNumberInputCompatibility(
            formatNumberInputCompatibility(
                progressValue,
                field.field.config,
                config.separator,
                false
            ),
            { type: 'number', options: field.field.config.options }
        ) ?? 0;

    if (options.presentation === 'display') {
        const text =
            field.value == null
                ? ''
                : field.physicalKind === 'percent'
                  ? `${label}%`
                  : field.physicalKind === 'currency'
                    ? `${label.startsWith('-') ? '-' : ''}${symbol}${label.startsWith('-') ? label.slice(1) : label}`
                    : label;
        return h(
            'div',
            {
                className: classes(
                    'mx-sdk-localized-numeric-display',
                    options.className
                ),
            },
            field.value == null
                ? h(EmptyValue, { label: options.emptyLabel ?? 'No value' })
                : config.progress
                  ? h(Progress, { value: progressValue, label: text })
                  : h(NumericText, { text })
        );
    }

    return h(
        'div',
        { className: classes('mx-sdk-localized-numeric', options.className) },
        showLabel ? h('label', { htmlFor: id }, title) : null,
        h(
            'div',
            { className: 'mx-sdk-localized-numeric-control' },
            field.physicalKind !== 'number'
                ? h(
                      'span',
                      {
                          id: symbolId,
                          className: classes(
                              'mx-sdk-localized-numeric-symbol',
                              field.physicalKind === 'percent' &&
                                  'mx-sdk-localized-numeric-percent-symbol'
                          ),
                      },
                      symbol
                  )
                : null,
            h(
                'div',
                { className: 'mx-sdk-localized-numeric-input-wrap' },
                h(TextInput, {
                    ...options.input,
                    ref: options.inputRef,
                    id,
                    type: 'text',
                    inputMode: 'decimal',
                    value: input,
                    form: options.input?.form,
                    autoComplete: options.input?.autoComplete ?? 'off',
                    placeholder: config.placeholder,
                    disabled: config.readonly,
                    className: classes(
                        'mx-sdk-localized-numeric-input',
                        options.inputClassName,
                        mobile && 'mx-sdk-localized-numeric-mobile',
                        showProgress && 'mx-sdk-localized-numeric-covered'
                    ),
                    'aria-label':
                        options.input?.['aria-label'] ??
                        (showLabel ? undefined : title),
                    'aria-describedby':
                        [
                            symbolId,
                            options.input?.['aria-describedby'],
                            feedbackId,
                        ]
                            .filter(Boolean)
                            .join(' ') || undefined,
                    'aria-invalid': hasError
                        ? true
                        : (options.input?.['aria-invalid'] ?? false),
                    'aria-required':
                        options.input?.['aria-required'] ??
                        (config.required || undefined),
                    onFocus: () => {
                        if (current()) {
                            setFocused(true);
                            setInput(ungroup(input, config.separator));
                        }
                    },
                    onChange: (event) => {
                        const text = event.currentTarget.value;
                        if (options.commit === 'deferred') {
                            if (!valid(text)) return;
                            pending.current = {
                                lease,
                                input: text,
                                baseline:
                                    pending.current?.lease === lease
                                        ? pending.current.baseline
                                        : input,
                            };
                            setInput(text);
                        } else if (write(text)) setInput(text);
                    },
                    onBlur: () => {
                        if (!current()) return;
                        const draft = pending.current;
                        pending.current = null;
                        if (
                            draft?.lease === lease &&
                            draft.input !== draft.baseline
                        )
                            write(draft.input);
                        // Preserve the characterized deferred overlay boundary:
                        // its native deferred input owns blur and did not invoke
                        // the parent's reformat/focus callback.
                        if (options.commit !== 'deferred') setFocused(false);
                    },
                    onKeyDown: (event) => {
                        if (
                            options.commit === 'deferred' &&
                            event.key === 'Enter'
                        ) {
                            event.preventDefault();
                            if (!event.nativeEvent.isComposing)
                                event.currentTarget.blur();
                        }
                    },
                }),
                mobile && input !== ''
                    ? h(InputClearButton, {
                          label: options.clearLabel ?? 'Clear',
                          disabled: config.readonly,
                          className: 'mx-sdk-localized-numeric-clear',
                          indicatorClassName:
                              'mx-sdk-localized-numeric-clear-indicator',
                          iconClassName: 'mx-sdk-localized-numeric-clear-icon',
                          onMouseDown: (event) => event.preventDefault(),
                          onClick: () => {
                              if (write('')) {
                                  pending.current = null;
                                  setInput('');
                              }
                          },
                      })
                    : null
            ),
            showProgress
                ? h(
                      'div',
                      {
                          className: 'mx-sdk-localized-numeric-overlay',
                          'aria-hidden': true,
                      },
                      h(Progress, {
                          value: displayedProgress,
                          label: `${displayedProgress}%`,
                      })
                  )
                : null
        ),
        hasError
            ? h(
                  'span',
                  {
                      id: feedbackId,
                      className: 'mx-sdk-localized-numeric-feedback',
                      role: 'status',
                  },
                  error
              )
            : null
    );
}

export function renderCompleteLocalizedNumericField(
    field: CompleteLocalizedNumericRendererProps,
    options?: CompleteLocalizedNumericFieldOptions
): ReactNode {
    return h(CompleteLocalizedNumericField, { field, options });
}
