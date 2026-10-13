import {
    createElement,
    useId,
    useRef,
    useState,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import type { RuntimeFieldSchema } from '../runtime/types.js';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';

export type TextFieldOptions = {
    className?: string;
    /** Accessible Clear label; defaults to "Clear <field title>". */
    clearLabel?: string;
};

type TextConfig = RuntimeFieldSchema['miniExtConfig'] | null;
export function textConfiguration(display: TextConfig, write?: TextConfig) {
    const configs = [display, write].filter((config) => config != null);
    const limits = configs.flatMap((config) => {
        const limit =
            'characterLimit' in config ? config.characterLimit : undefined;
        return typeof limit === 'number' &&
            Number.isSafeInteger(limit) &&
            limit >= 0
            ? [limit]
            : [];
    });
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
        maxLength: limits.length ? Math.min(...limits) : undefined,
    };
}

type TextControlProps = TextFieldOptions &
    ReturnType<typeof textConfiguration> & {
        /** Accepted binding/action identity. A replacement cannot inherit composition. */
        source: object;
        title: string;
        value: string;
        disabled: boolean;
        pending: boolean;
        invalid: boolean;
        feedback: string;
        setValue(value: string | null): boolean;
    };
type Composition = {
    cancelled?: boolean;
    source: object;
    baseline: string;
    value: string;
    password: boolean;
    maxLength: number | undefined;
    setValue: TextControlProps['setValue'];
};
const stop = (event: SyntheticEvent) => event.stopPropagation();
const limitText = (value: string, limit: number | undefined): string => {
    if (limit === undefined || value.length <= limit) return value;
    // Match native UTF-16 maxlength without cutting a surrogate pair in half.
    const end =
        limit > 0 &&
        /[\uD800-\uDBFF]/.test(value[limit - 1]) &&
        /[\uDC00-\uDFFF]/.test(value[limit])
            ? limit - 1
            : limit;
    return value.slice(0, end);
};

/** Presentation plus an unfinished DOM composition buffer; the owner holds native drafts. */
export function TextControl(props: TextControlProps): ReactNode {
    const id = useId();
    const input = useRef<HTMLInputElement>(null);
    const pendingComposition = useRef<Composition | null>(null);
    const [composition, setCompositionState] = useState<Composition | null>(
        null
    );
    const trailingCompositionInput = useRef<string | null>(null);
    const setComposition = (next: Composition | null) => {
        pendingComposition.current = next;
        setCompositionState(next);
    };
    const current = (draft: Composition) =>
        !draft.cancelled &&
        !props.disabled &&
        draft.source === props.source &&
        draft.baseline === props.value &&
        draft.password === props.password &&
        draft.maxLength === props.maxLength;
    // Cancellation is sticky across observed A→B→A replacements. This only
    // retires the local composition buffer; it never changes the owner draft.
    if (composition && !composition.cancelled && !current(composition)) {
        setComposition({ ...composition, cancelled: true });
    }
    const value =
        composition && current(composition) ? composition.value : props.value;
    const commit = (raw: string, write = props.setValue) => {
        const next = limitText(raw, props.maxLength);
        if (props.disabled) return props.value;
        if (next === props.value) return next;
        return write(next === '' ? null : next) ? next : props.value;
    };
    const describedBy =
        [
            props.feedback ? `${id}-feedback` : null,
            props.maxLength !== undefined ? `${id}-count` : null,
        ]
            .filter(Boolean)
            .join(' ') || undefined;
    return createElement(
        'span',
        {
            className: ['mx-sdk-text-field', props.className]
                .filter(Boolean)
                .join(' '),
            onClick: stop,
            onAuxClick: stop,
            onDoubleClick: stop,
            onPointerDown: stop,
            onKeyDown: stop,
            onKeyUp: stop,
        },
        props.showTitle
            ? createElement(
                  'label',
                  { className: 'mx-sdk-text-label', htmlFor: id },
                  props.title
              )
            : null,
        createElement(
            'span',
            { className: 'mx-sdk-text-control' },
            createElement('input', {
                ref: input,
                id,
                className: 'mx-sdk-text',
                type: props.password ? 'password' : 'text',
                value,
                disabled: props.disabled,
                placeholder: props.placeholder,
                autoComplete: 'off',
                spellCheck: props.password ? false : undefined,
                maxLength: composition ? undefined : props.maxLength,
                'aria-label': props.showTitle ? undefined : props.title,
                'aria-required': props.required || undefined,
                'aria-invalid': props.invalid,
                'aria-busy': props.pending,
                'aria-describedby': describedBy,
                onChange: (
                    event: import('react').ChangeEvent<HTMLInputElement>
                ) => {
                    event.stopPropagation();
                    const raw = event.currentTarget.value;
                    const draft = pendingComposition.current;
                    if (draft) {
                        if (current(draft))
                            setComposition({ ...draft, value: raw });
                        else event.currentTarget.value = props.value;
                        return;
                    }
                    const trailing = trailingCompositionInput.current;
                    trailingCompositionInput.current = null;
                    if (trailing === raw) {
                        event.currentTarget.value = props.value;
                        return;
                    }
                    event.currentTarget.value = commit(raw);
                },
                onCompositionStart: (
                    event: SyntheticEvent<HTMLInputElement>
                ) => {
                    event.stopPropagation();
                    trailingCompositionInput.current = null;
                    if (!props.disabled)
                        setComposition({
                            source: props.source,
                            baseline: props.value,
                            value: event.currentTarget.value,
                            password: props.password,
                            maxLength: props.maxLength,
                            setValue: props.setValue,
                        });
                },
                onCompositionEnd: (event: SyntheticEvent<HTMLInputElement>) => {
                    event.stopPropagation();
                    const raw = event.currentTarget.value;
                    const draft = pendingComposition.current;
                    setComposition(null);
                    trailingCompositionInput.current = raw;
                    event.currentTarget.value =
                        draft && current(draft)
                            ? commit(raw, draft.setValue)
                            : props.value;
                },
                onBlur: () => setComposition(null),
            }),
            createElement(
                'button',
                {
                    type: 'button',
                    className: 'mx-sdk-text-clear',
                    'aria-label': props.clearLabel?.trim()
                        ? props.clearLabel
                        : `Clear ${props.title}`,
                    'aria-controls': id,
                    disabled:
                        props.disabled || value === '' || composition !== null,
                    onMouseDown: (event: SyntheticEvent) =>
                        event.preventDefault(),
                    onClick: (event: SyntheticEvent) => {
                        event.stopPropagation();
                        if (
                            !props.disabled &&
                            !pendingComposition.current &&
                            props.value !== ''
                        ) {
                            props.setValue(null);
                            input.current?.focus();
                        }
                    },
                },
                createElement('span', { 'aria-hidden': true }, '×')
            )
        ),
        props.maxLength !== undefined
            ? createElement(
                  'span',
                  { id: `${id}-count`, className: 'mx-sdk-text-count' },
                  `${value.length}/${props.maxLength}`
              )
            : null,
        createElement(
            'span',
            {
                id: `${id}-feedback`,
                className: 'mx-sdk-text-feedback',
                role: 'status',
                'aria-live': 'polite',
                'aria-atomic': true,
            },
            props.feedback
        )
    );
}

/** Shared Form/Grid/List slot. Raw values cannot grant edit or navigation authority. */
export function renderSingleLineTextField(
    props: FieldRendererProps<'singleLineText'>,
    options: TextFieldOptions = {}
): ReactNode {
    const config = textConfiguration(props.displayConfig, props.writeConfig);
    const capability = props.capability;
    return createElement(TextControl, {
        ...config,
        ...options,
        source:
            capability.type === 'editable' ? capability.setValue : capability,
        title: props.title.trim() ? props.title : props.field.name,
        value: props.value ?? '',
        disabled:
            config.configuredReadOnly ||
            capability.type !== 'editable' ||
            props.computed ||
            props.pending,
        pending: props.pending,
        invalid: props.error !== null || props.validation.length > 0,
        feedback:
            props.error ??
            props.validation.map((error) => error.errorMessage).join('\n'),
        setValue: (value) =>
            capability.type === 'editable' &&
            capability.setValue(value).accepted,
    });
}
