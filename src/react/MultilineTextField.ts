import {
    createElement,
    useCallback,
    useId,
    useRef,
    useState,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import type { RuntimeFieldSchema } from '../runtime/types.js';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';
import { textConfiguration, type TextFieldOptions } from './TextField.js';

export type MultilineTextFieldOptions = TextFieldOptions;

type TextConfig = RuntimeFieldSchema['miniExtConfig'] | null;
/** These modes need their own accepted presentation contract. Never infer one. */
export function multilineTextConfiguration(
    display: TextConfig,
    write?: TextConfig
) {
    const configs = [display, write].filter((config) => config != null);
    const requested = (key: string) =>
        configs.some((config) => {
            const value = (config as Record<string, unknown>)[key];
            return value !== undefined && value !== false;
        });
    const unavailable =
        requested('obscurePassword') || requested('maskPasswordOnLoginScreen')
            ? 'Masked multiline fields require a custom renderer.'
            : requested('addOnlyMode')
              ? 'Append-only multiline fields require a custom renderer.'
              : requested('displayAsAttachments')
                ? 'Multiline attachment displays require a custom renderer.'
                : null;
    return { ...textConfiguration(display, write), unavailable };
}

/** No native value or value-derived feedback is exposed for unsupported modes. */
export function multilineTextUnavailable(
    title: string,
    message: string,
    className?: string,
    showTitle = true
): ReactNode {
    return createElement(
        'span',
        {
            className: ['mx-sdk-text-field', className]
                .filter(Boolean)
                .join(' '),
            role: 'group',
            'aria-label': title,
        },
        showTitle
            ? createElement('span', { className: 'mx-sdk-text-label' }, title)
            : null,
        createElement(
            'span',
            { role: 'status', className: 'mx-sdk-text-feedback' },
            message
        )
    );
}

type MultilineTextControlProps = MultilineTextFieldOptions &
    Omit<ReturnType<typeof textConfiguration>, 'password'> & {
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
    maxLength: number | undefined;
    setValue: MultilineTextControlProps['setValue'];
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
export function MultilineTextControl(
    props: MultilineTextControlProps
): ReactNode {
    const id = useId();
    const input = useRef<HTMLTextAreaElement | null>(null);
    const active = useRef(false);
    const committed = useRef(props);
    const pendingComposition = useRef<Composition | null>(null);
    const [composition, setCompositionState] = useState<Composition | null>(
        null
    );
    const trailingCompositionInput = useRef<string | null>(null);
    const setComposition = (next: Composition | null) => {
        pendingComposition.current = next;
        setCompositionState(next);
    };
    const current = (draft: Composition, context = props) =>
        !draft.cancelled &&
        !context.disabled &&
        draft.source === context.source &&
        draft.baseline === context.value &&
        draft.maxLength === context.maxLength;
    // Ref attachment runs only for committed DOM, never a speculative render.
    // A detached textarea immediately loses its authority to invoke the setter.
    const attach = useCallback(
        (node: HTMLTextAreaElement | null) => {
            input.current = node;
            active.current = node !== null;
            if (node) {
                committed.current = props;
                const draft = pendingComposition.current;
                if (draft && !current(draft, props))
                    pendingComposition.current = { ...draft, cancelled: true };
            }
        },
        [props.source, props.value, props.disabled, props.maxLength]
    );
    // Cancellation is sticky across observed A→B→A replacements. This only
    // retires the local composition buffer; it never changes the owner draft.
    if (composition && !composition.cancelled && !current(composition)) {
        setCompositionState({ ...composition, cancelled: true });
    }
    const value =
        composition && current(composition) ? composition.value : props.value;
    const live = () =>
        active.current &&
        !committed.current.disabled &&
        props.source === committed.current.source &&
        props.value === committed.current.value &&
        props.maxLength === committed.current.maxLength;
    const commit = (raw: string, write = props.setValue) => {
        if (!live()) return committed.current.value;
        const next = limitText(raw, props.maxLength);
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
            createElement('textarea', {
                ref: attach,
                id,
                className: 'mx-sdk-text mx-sdk-multiline-text',
                rows: 4,
                value,
                disabled: props.disabled,
                placeholder: props.placeholder,
                autoComplete: 'off',
                maxLength: composition ? undefined : props.maxLength,
                'aria-label': props.showTitle ? undefined : props.title,
                'aria-required': props.required || undefined,
                'aria-invalid': props.invalid,
                'aria-busy': props.pending,
                'aria-describedby': describedBy,
                onChange: (
                    event: import('react').ChangeEvent<HTMLTextAreaElement>
                ) => {
                    event.stopPropagation();
                    if (!live()) return;
                    const raw = event.currentTarget.value;
                    const draft = pendingComposition.current;
                    if (draft) {
                        if (active.current && current(draft, committed.current))
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
                    event: SyntheticEvent<HTMLTextAreaElement>
                ) => {
                    event.stopPropagation();
                    if (!live()) return;
                    trailingCompositionInput.current = null;
                    setComposition({
                        source: props.source,
                        baseline: props.value,
                        value: event.currentTarget.value,
                        maxLength: props.maxLength,
                        setValue: props.setValue,
                    });
                },
                onCompositionEnd: (
                    event: SyntheticEvent<HTMLTextAreaElement>
                ) => {
                    event.stopPropagation();
                    if (!live()) return;
                    const raw = event.currentTarget.value;
                    const draft = pendingComposition.current;
                    setComposition(null);
                    trailingCompositionInput.current = raw;
                    event.currentTarget.value =
                        draft &&
                        active.current &&
                        current(draft, committed.current)
                            ? commit(raw, draft.setValue)
                            : props.value;
                },
                onBlur: () => {
                    if (live()) setComposition(null);
                },
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
                            live() &&
                            !pendingComposition.current &&
                            props.value !== ''
                        ) {
                            commit('');
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

/** Shared plain-text Form/Grid/List slot; the owner retains write and Save authority. */
export function renderMultilineTextField(
    props: FieldRendererProps<'multilineText'>,
    options: MultilineTextFieldOptions = {}
): ReactNode {
    const config = multilineTextConfiguration(
        props.displayConfig,
        props.writeConfig
    );
    const title = props.title.trim() ? props.title : props.field.name;
    if (config.unavailable)
        return multilineTextUnavailable(
            title,
            config.unavailable,
            options.className,
            config.showTitle
        );
    const capability = props.capability;
    return createElement(MultilineTextControl, {
        ...config,
        ...options,
        source:
            capability.type === 'editable' ? capability.setValue : capability,
        title,
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
