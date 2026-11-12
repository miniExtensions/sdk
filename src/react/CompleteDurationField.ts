import type * as React from 'react';
import {
    createElement as h,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type Ref,
} from 'react';
import { getFormattedDuration } from '../formulas/durationFormatting.js';
import { isDurationFormat } from '../ui/durationInput.js';
import {
    useDurationInputAdapter,
    type DurationInputAdapterProps,
} from './useDurationInputAdapter.js';
import { TextInput } from './TextInput.js';
import { InputClearButton } from './InputClearButton.js';

export type CompleteDurationFieldProps = DurationInputAdapterProps & {
    title?: string;
    /** Existing native enclosing labels can retain their own association. */
    showLabel?: boolean;
    inputId?: string;
    formId?: string;
    placeholder?: string | null;
    description?: ReactNode;
    error?: string | null;
    invalid?: boolean;
    /** Associations supplied by an enclosing native field renderer. */
    describedBy?: string;
    className?: string;
    inputClassName?: string;
    inputRef?: Ref<HTMLInputElement>;
    /** Optional extra affordance. Native clock presentation has no Clear button. */
    clearLabel?: string;
};

const classes = (...values: (string | false | undefined)[]) =>
    values.filter(Boolean).join(' ');
const canonicalText = (props: DurationInputAdapterProps) =>
    props.value == null ||
    !Number.isFinite(props.value) ||
    !Number.isFinite(props.value * 1000) ||
    !isDurationFormat(props.format)
        ? ''
        : getFormattedDuration(String(props.value), props.format, true);

/** Complete native-compatible clock editor. Canonical seconds and Save stay outside. */
export function CompleteDurationField(props: CompleteDurationFieldProps) {
    const generatedId = useId();
    const id = props.inputId ?? generatedId;
    const adapter = useDurationInputAdapter(props);
    const input = useRef<HTMLInputElement | null>(null);
    useImperativeHandle(props.inputRef, () => input.current!, []);
    // Focus belongs to this DOM input, independently of canonical ownership.
    // A new owner resets text and retires callbacks without inventing a blur.
    // SSR has no node and never reads a browser global.
    const node = input.current;
    const focused =
        !props.readOnly &&
        isDurationFormat(props.format) &&
        node != null &&
        node.ownerDocument.activeElement === node;
    const identity = useMemo(
        () => ({}),
        [props.fieldId, props.sessionId, props.owner.token]
    );
    const [draft, setDraft] = useState(() => ({
        identity,
        format: props.format,
        value: props.value,
        text: canonicalText(props),
    }));
    // Derive before commit, rather than painting an old grammar/owner for an effect.
    // Equivalent metadata and canonical echoes never replace a focused draft/caret.
    if (
        draft.identity !== identity ||
        draft.format !== props.format ||
        (!focused && !Object.is(draft.value, props.value))
    ) {
        setDraft({
            identity,
            format: props.format,
            value: props.value,
            text: canonicalText(props),
        });
    }
    const invalid = props.invalid === true || Boolean(props.error);
    const describedBy =
        [
            props.describedBy,
            props.description != null && `${id}-description`,
            props.error && `${id}-error`,
        ]
            .filter(Boolean)
            .join(' ') || undefined;
    const change = (text: string) => {
        if (!adapter.setInput(text)) return;
        setDraft((previous) => ({
            ...previous,
            text,
            value: props.value,
        }));
    };
    return h(
        'div',
        { className: classes('mx-sdk-complete-duration', props.className) },
        props.title && props.showLabel !== false
            ? h('label', { htmlFor: id }, props.title)
            : null,
        h(
            'div',
            { className: 'mx-sdk-complete-duration-control' },
            h(TextInput, {
                ref: input,
                type: 'text',
                className: classes(
                    'mx-sdk-complete-duration-input',
                    props.clearLabel && 'mx-sdk-complete-duration-clearable',
                    props.inputClassName
                ),
                value: draft.text,
                id,
                form: props.formId ?? `form-${props.sessionId}`,
                autoComplete: 'off',
                placeholder: props.placeholder ?? props.format,
                disabled: props.readOnly || !isDurationFormat(props.format),
                'aria-label':
                    props.showLabel === false ? props.title : undefined,
                'aria-describedby': describedBy,
                'aria-invalid': invalid,
                onChange: (event) => change(event.target.value),
                onBlur: () => {
                    if (!adapter.isCurrent()) return;
                    setDraft((previous) => ({
                        ...previous,
                        value: props.value,
                        // Native blur leaves the focused draft and re-reads the
                        // controlled canonical value, including delayed/refused echoes.
                        text: canonicalText(props),
                    }));
                },
            }),
            h(
                'span',
                {
                    className: 'mx-sdk-complete-duration-clock',
                    'aria-hidden': true,
                },
                h(
                    'svg',
                    {
                        viewBox: '0 0 24 24',
                        fill: 'currentColor',
                        focusable: 'false',
                        'aria-hidden': true,
                    },
                    h('path', {
                        fillRule: 'evenodd',
                        clipRule: 'evenodd',
                        d: 'M12 2.25a9.75 9.75 0 1 0 0 19.5 9.75 9.75 0 0 0 0-19.5Zm.75 4.5a.75.75 0 0 0-1.5 0V12c0 .199.079.39.22.53l3.75 3.75a.75.75 0 1 0 1.06-1.06l-3.53-3.53V6.75Z',
                    })
                )
            ),
            props.clearLabel && !props.readOnly && draft.text !== ''
                ? h(InputClearButton, {
                      className: 'mx-sdk-complete-duration-clear',
                      indicatorClassName:
                          'mx-sdk-complete-duration-clear-indicator',
                      iconClassName: 'mx-sdk-complete-duration-clear-icon',
                      label: props.clearLabel,
                      onClick: () => change(''),
                  })
                : null
        ),
        props.description != null
            ? h('div', { id: `${id}-description` }, props.description)
            : null,
        props.error
            ? h('div', { id: `${id}-error`, role: 'alert' }, props.error)
            : null
    );
}
