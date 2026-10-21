import {
    createElement,
    Fragment,
    forwardRef,
    useId,
    useEffect,
    useLayoutEffect,
    useMemo,
    useImperativeHandle,
    useRef,
    useState,
    type InputHTMLAttributes,
    type ReactNode,
} from 'react';

export type RatingIconState = {
    index: number;
    filled: boolean;
    focused: boolean;
    disabled: boolean;
    activate(): void;
};
export type RatingWarningState = {
    value: number;
    max: number;
};
export type RatingInputProps = {
    value: number | null;
    /** Airtable rating maximum, independently supplied from the current value. */
    max: number;
    onChange(value: number | null): void;
    disabled?: boolean;
    grid?: boolean;
    title?: string;
    showTitle?: boolean;
    className?: string;
    iconsClassName?: string;
    gridSummaryClassName?: string;
    printSummaryClassName?: string;
    warningId?: string;
    empty?: ReactNode;
    feedback?: string;
    renderIcon?(state: RatingIconState): ReactNode;
    warningMessage?(state: RatingWarningState): ReactNode;
    warningClassName?: string;
    repairLabel?: string;
    repairClassName?: string;
    inputProps?: Omit<
        InputHTMLAttributes<HTMLInputElement>,
        | 'type'
        | 'value'
        | 'defaultValue'
        | 'children'
        | 'min'
        | 'max'
        | 'step'
        | 'disabled'
        | 'readOnly'
        | 'onChange'
    >;
};

const useBrowserLayoutEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

/** Controlled rating presentation; native drafts, persistence and authority stay with its caller. */
export const RatingInput = forwardRef<HTMLInputElement, RatingInputProps>(
    function RatingInput(props, ref) {
        const generated = useId();
        // Only callbacks from the committed presentation can propose native intent.
        // The caller still owns record identity, write policy and persistence.
        const presentation = useMemo(() => ({ props }), [props]);
        const committed = useRef<typeof presentation | null>(null);
        useBrowserLayoutEffect(() => {
            committed.current = presentation;
            return () => {
                if (committed.current === presentation)
                    committed.current = null;
            };
        }, [presentation]);
        const current = () => committed.current === presentation;
        const input = useRef<HTMLInputElement | null>(null);
        const [focused, setFocused] = useState(false);
        useImperativeHandle(ref, () => input.current!, [props.grid]);
        const disabled = props.disabled ?? false;
        const warning =
            !props.grid && props.value != null && props.value > props.max;
        const warningId = props.warningId ?? `${generated}-range`;
        const id = props.inputProps?.id ?? generated;
        const feedbackId = `${generated}-feedback`;
        const summary = `(${props.value}/${props.max})`;
        const commit = (value: number | null) => {
            if (
                current() &&
                !disabled &&
                (value === null || Number.isFinite(value))
            )
                props.onChange(value);
        };
        const describedBy =
            [
                props.inputProps?.['aria-describedby'],
                warning && warningId,
                props.feedback && feedbackId,
            ]
                .filter(Boolean)
                .join(' ') || undefined;
        return createElement(
            'div',
            { className: props.className },
            props.showTitle && props.title
                ? createElement('label', { htmlFor: id }, props.title)
                : null,
            props.grid
                ? createElement(
                      'span',
                      { className: props.gridSummaryClassName },
                      summary
                  )
                : createElement('input', {
                      ...props.inputProps,
                      type: 'range',
                      id,
                      ref: input,
                      value: props.value ?? 0,
                      max: props.max,
                      min: 1,
                      disabled,
                      'aria-describedby': describedBy,
                      onChange: (
                          event: import('react').ChangeEvent<HTMLInputElement>
                      ) => {
                          if (!current()) return;
                          setFocused(true);
                          const value = Number(event.currentTarget.value);
                          commit(value === 0 ? null : value);
                      },
                      onFocus: (
                          event: import('react').FocusEvent<HTMLInputElement>
                      ) => {
                          setFocused(true);
                          props.inputProps?.onFocus?.(event);
                      },
                      onBlur: (
                          event: import('react').FocusEvent<HTMLInputElement>
                      ) => {
                          setFocused(false);
                          props.inputProps?.onBlur?.(event);
                      },
                  }),
            createElement(
                'div',
                { className: props.iconsClassName, 'aria-hidden': true },
                disabled && props.value == null
                    ? props.empty
                    : Array.from({ length: props.max }, (_, i) => {
                          const index = i + 1;
                          const state: RatingIconState = {
                              index,
                              filled: Boolean(
                                  props.value && index <= props.value
                              ),
                              focused:
                                  focused &&
                                  ((index === 1 && !props.value) ||
                                      index === props.value),
                              disabled,
                              activate: () => {
                                  if (!current()) return;
                                  input.current?.focus();
                                  setFocused(false);
                                  commit(index === props.value ? null : index);
                              },
                          };
                          return createElement(
                              Fragment,
                              { key: index },
                              props.renderIcon
                                  ? props.renderIcon(state)
                                  : createElement(
                                        'span',
                                        { onClick: state.activate },
                                        state.filled ? '★' : '☆'
                                    )
                          );
                      })
            ),
            !props.grid && props.value != null
                ? createElement(
                      'span',
                      {
                          'aria-hidden': true,
                          className: props.printSummaryClassName,
                      },
                      summary
                  )
                : null,
            warning && props.value != null
                ? createElement(
                      'p',
                      { id: warningId, className: props.warningClassName },
                      props.warningMessage
                          ? props.warningMessage({
                                value: props.value,
                                max: props.max,
                            })
                          : `The current rating exceeds the maximum ${summary}.`,
                      !disabled
                          ? createElement(
                                'button',
                                {
                                    type: 'button',
                                    className: props.repairClassName,
                                    onClick: () => commit(props.max),
                                },
                                props.repairLabel ?? 'Fix it'
                            )
                          : null
                  )
                : null,
            props.feedback
                ? createElement(
                      'span',
                      { id: feedbackId, role: 'status', 'aria-live': 'polite' },
                      props.feedback
                  )
                : null
        );
    }
);
