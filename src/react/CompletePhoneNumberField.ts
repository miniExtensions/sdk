import {
    createContext,
    createElement as h,
    forwardRef,
    useCallback,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type ChangeEvent,
    type InputHTMLAttributes,
    type Ref,
} from 'react';
import { UAParser } from 'ua-parser-js';
import { PhoneInput, getCountries } from './phoneVendor.js';
import { TextInput } from './TextInput.js';
import { InputClearButton } from './InputClearButton.js';

export type CompletePhoneEditOwner = {
    /** Opaque target/policy generation; a committed A → B → A renews it. */
    token: unknown;
    /** The host checks the captured session/field/record/table and edit policy. */
    isCurrent(): boolean;
};

export type CompletePhoneCommit = {
    ownerToken: unknown;
    reason: 'input' | 'blur' | 'enter' | 'clear' | 'unmount';
};

type InputMetadata = Omit<
    InputHTMLAttributes<HTMLInputElement>,
    | 'value'
    | 'defaultValue'
    | 'children'
    | 'type'
    | 'disabled'
    | 'readOnly'
    | 'onChange'
    | 'onFocus'
    | 'onBlur'
    | 'onKeyDown'
>;

type CommonProps = {
    value: string | null | undefined;
    /** Country mode uses the real vendor's canonical string/undefined; plain
     * mode preserves literal strings, including the empty string. */
    onValueChange(value: string | undefined, commit: CompletePhoneCommit): void;
    showCountryCodes?: boolean;
    /** Unknown codes use International; saved E.164 values retain inference. */
    defaultCountry?: string;
    disabled?: boolean;
    readOnly?: boolean;
    input?: InputMetadata;
    inputRef?: Ref<HTMLInputElement>;
    className?: string;
    inputClassName?: string;
    clearLabel?: string;
    clearButton?: 'mobile' | 'always' | 'never';
    /** Native inline editors may settle a current draft on actual unmount. */
    settleOnUnmount?: boolean;
};

export type CompletePhoneNumberFieldProps = CommonProps &
    (
        | { commit?: 'immediate'; owner?: CompletePhoneEditOwner }
        | { commit: 'deferred'; owner: CompletePhoneEditOwner }
    );

type Reason = CompletePhoneCommit['reason'];
type Value = string | undefined;
type Lease = { mounted: boolean };
type Action = { lease: Lease; reason: Reason; detached: boolean };
type CanonicalTicket = { detached: boolean; deliver(value: Value): void };
type Replay = () => void;
type PhoneTextProps = Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'onChange' | 'defaultValue' | 'children'
> & {
    onChange?: (event: ChangeEvent<HTMLInputElement> | string) => void;
    /** Private input-format hook; captured only while its actual ref is alive. */
    sdkCapturePhoneReplay?: () => Replay;
};
type Draft = { lease: Lease; value: string; dirty: boolean; external: string };
type Bridge = {
    lease: Lease;
    country: boolean;
    deferred: boolean;
    mobile: boolean;
    disabled: boolean;
    clearLabel: string;
    clearButton: 'mobile' | 'always' | 'never';
    inputRef: Ref<HTMLInputElement> | undefined;
    inputClassName: string | undefined;
    current(detached?: boolean): boolean;
    withAction(reason: Reason, invoke: () => void, detached?: boolean): void;
    writePlain(value: string, reason: Reason, detached?: boolean): void;
    settleOnUnmount(): boolean;
};

const PhoneBridge = createContext<Bridge | null>(null);
const phoneDraft = /^\+?[\d\s().-]*$/;
const classes = (...names: (string | false | undefined)[]) =>
    names.filter(Boolean).join(' ');

function assignRef(
    ref: Ref<HTMLInputElement> | undefined,
    node: HTMLInputElement | null
) {
    if (typeof ref === 'function') ref(node);
    else if (ref != null) Object.assign(ref, { current: node });
}

/** One stable custom input retains the real vendor's DOM/ref/caret path. */
const PhoneTextInput = forwardRef<HTMLInputElement, PhoneTextProps>(
    function PhoneTextInput(
        {
            value,
            onChange,
            onFocus,
            onBlur,
            onKeyDown,
            className,
            sdkCapturePhoneReplay,
            ...input
        },
        ref
    ) {
        const bridge = useContext(PhoneBridge);
        if (bridge == null)
            throw new Error('Complete Phone input requires its owner.');
        const external = String(value ?? '');
        const [localValue, setLocalValue] = useState(external);
        const draft = useRef<Draft>({
            lease: bridge.lease,
            value: external,
            dirty: false,
            external,
        });
        const committed = useRef({ bridge, onChange, sdkCapturePhoneReplay });
        const cleanupEpoch = useRef(0);
        const enter = useRef(false);
        const useCommitEffect =
            typeof document === 'undefined' ? useEffect : useLayoutEffect;

        useCommitEffect(() => {
            committed.current = { bridge, onChange, sdkCapturePhoneReplay };
            if (draft.current.lease !== bridge.lease) {
                draft.current = {
                    lease: bridge.lease,
                    value: external,
                    dirty: false,
                    external,
                };
                setLocalValue(external);
            } else if (draft.current.external !== external) {
                draft.current.external = external;
                // Preserve a newer deferred draft across canonical value echoes.
                if (!draft.current.dirty) {
                    draft.current.value = external;
                    setLocalValue(external);
                }
            }
        });

        useCommitEffect(() => {
            const epoch = ++cleanupEpoch.current;
            return () => {
                const pending = draft.current;
                const current = committed.current;
                // Capture the original real node/formatter before ref detachment.
                // No parser, callback, DOM mutation or state update runs here.
                const replay =
                    pending.dirty && current.bridge.country
                        ? current.sdkCapturePhoneReplay?.()
                        : undefined;
                queueMicrotask(() => {
                    // StrictMode re-setup or a committed successor cancels this
                    // cleanup without consuming the still-current draft.
                    if (
                        cleanupEpoch.current !== epoch ||
                        draft.current !== pending ||
                        !pending.dirty ||
                        pending.lease !== current.bridge.lease
                    )
                        return;
                    pending.dirty = false;
                    if (
                        !current.bridge.settleOnUnmount() ||
                        !current.bridge.current(true)
                    )
                        return;
                    if (current.bridge.country) {
                        if (replay == null) return;
                        current.bridge.withAction('unmount', replay, true);
                    } else {
                        current.bridge.writePlain(
                            pending.value,
                            'unmount',
                            true
                        );
                    }
                });
            };
        }, [bridge.lease]);

        const setRef = useCallback(
            (node: HTMLInputElement | null) => {
                assignRef(ref, node);
                assignRef(bridge.inputRef, node);
            },
            [ref, bridge.inputRef]
        );
        const shown = bridge.deferred ? localValue : external;
        const settle = (reason: Reason) => {
            const pending = draft.current;
            if (!pending.dirty || pending.lease !== bridge.lease) return;
            // Consume first: blur, Enter, Clear and actual unmount cannot settle
            // the same draft twice. Clear has its own separate vendor action.
            pending.dirty = false;
            if (pending.value === external || !bridge.current()) return;
            if (bridge.country) {
                bridge.withAction(reason, () => onChange?.(pending.value));
            } else bridge.writePlain(pending.value, reason);
        };

        return h(
            'div',
            { className: 'mx-sdk-phone-text-wrap' },
            h(TextInput, {
                ...input,
                ref: setRef,
                value: shown,
                disabled: bridge.disabled,
                className: classes(
                    'mx-sdk-phone-input',
                    className,
                    bridge.inputClassName,
                    bridge.mobile && 'mx-sdk-phone-mobile'
                ),
                onChange(event) {
                    if (!bridge.current()) return;
                    const next = event.currentTarget.value;
                    if (bridge.deferred) {
                        if (bridge.country && !phoneDraft.test(next)) return;
                        draft.current.value = next;
                        draft.current.dirty = true;
                        setLocalValue(next);
                    } else if (bridge.country) {
                        bridge.withAction('input', () => onChange?.(event));
                    } else bridge.writePlain(next, 'input');
                },
                onFocus(event) {
                    onFocus?.(event);
                },
                onBlur(event) {
                    if (bridge.deferred) {
                        // Native deferred input replaces (does not forward) the
                        // vendor blur handler, including during composition.
                        settle(enter.current ? 'enter' : 'blur');
                    } else onBlur?.(event);
                },
                onKeyDown(event) {
                    if (!bridge.current()) return;
                    if (bridge.deferred) {
                        // All deferred keys use browser default editing. Only
                        // non-IME Enter blurs; never invoke vendor key surgery.
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            if (!event.nativeEvent.isComposing) {
                                enter.current = true;
                                event.currentTarget.blur();
                                enter.current = false;
                            }
                        }
                    } else {
                        bridge.withAction('input', () => onKeyDown?.(event));
                    }
                },
            }),
            bridge.clearButton !== 'never' &&
                shown !== '' &&
                (bridge.clearButton === 'always' || bridge.mobile)
                ? h(InputClearButton, {
                      label: bridge.clearLabel,
                      disabled: bridge.disabled,
                      className: 'mx-sdk-phone-clear',
                      indicatorClassName: 'mx-sdk-phone-clear-indicator',
                      iconClassName: 'mx-sdk-phone-clear-icon',
                      onClick() {
                          if (!bridge.current()) return;
                          draft.current.dirty = false;
                          draft.current.value = '';
                          if (bridge.deferred) setLocalValue('');
                          if (bridge.country) {
                              // input-format reads the still-existing actual DOM
                              // value here. Preserve native old-canonical re-emission.
                              bridge.withAction('clear', () => onChange?.(''));
                          } else bridge.writePlain('', 'clear');
                      },
                  })
                : null
        );
    }
);

function PhoneArrow() {
    return h(
        'svg',
        {
            className: 'mx-sdk-phone-country-arrow',
            viewBox: '0 0 20 20',
            width: 12,
            height: 12,
            fill: 'currentColor',
            'aria-hidden': true,
        },
        h('path', { d: 'm5 7.5 5 5 5-5-1.5-1.5-3.5 3.5L6.5 6z' })
    );
}

function PhoneIcon() {
    return h(
        'svg',
        {
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            'aria-hidden': true,
        },
        h('path', {
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            d: 'M4 3h4l2 5-2.5 1.5a16 16 0 0 0 7 7L16 14l5 2v4a1 1 0 0 1-1 1C10.6 21 3 13.4 3 4a1 1 0 0 1 1-1Z',
        })
    );
}

type ControllerProps = CompletePhoneNumberFieldProps & {
    inputId: string;
    configuredCountry: string | undefined;
    generationIsCurrent(): boolean;
};

function PhoneController(props: ControllerProps) {
    const country = props.showCountryCodes === true;
    const deferred = props.commit === 'deferred';
    const disabled = props.disabled === true || props.readOnly === true;
    const id = props.inputId;
    const configuredCountry = props.configuredCountry;
    const [mobile, setMobile] = useState(false);
    const [lease] = useState((): Lease => ({ mounted: false }));
    const live = useRef<{
        lease: Lease;
        props: CompletePhoneNumberFieldProps;
    } | null>(null);
    const action = useRef<Action | null>(null);
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;

    useCommitEffect(() => {
        live.current = { lease, props };
    });
    useCommitEffect(() => {
        lease.mounted = true;
        return () => {
            lease.mounted = false;
        };
    }, [lease]);
    useEffect(() => {
        setMobile(
            typeof navigator !== 'undefined' &&
                new UAParser(navigator.userAgent).getDevice().type === 'mobile'
        );
    }, []);

    const current = (detached = false) => {
        const now = live.current;
        return (
            now?.lease === lease &&
            props.generationIsCurrent() &&
            (lease.mounted || detached) &&
            !now.props.disabled &&
            !now.props.readOnly &&
            (!deferred || now.props.owner != null) &&
            (now.props.owner?.isCurrent() ?? true)
        );
    };
    const emit = (value: Value, reason: Reason, detached = false) => {
        if (!current(detached)) return;
        const now = live.current;
        if (now == null) return;
        now.props.onValueChange(value, {
            ownerToken: now.props.owner?.token,
            reason,
        });
    };
    const withAction = (
        reason: Reason,
        invoke: () => void,
        detached = false
    ) => {
        if (!current(detached)) return;
        const previous = action.current;
        action.current = { lease, reason, detached };
        try {
            invoke();
        } finally {
            action.current = previous;
        }
    };
    const captureChange = (kind: 'country' | 'input'): CanonicalTicket => {
        // Read this synchronous action context only at the real vendor handler
        // entry. The scheduled continuation closes over this immutable ticket.
        // Selecting a country is always its own immediate native action, even
        // if a host reenters selection during another input callback.
        const origin: Action =
            kind === 'input' && action.current?.lease === lease
                ? action.current
                : { lease, reason: 'input', detached: false };
        let consumed = false;
        return {
            detached: origin.detached,
            deliver(value) {
                if (consumed) return;
                consumed = true;
                emit(value, origin.reason, origin.detached);
            },
        };
    };
    const bridge: Bridge = {
        lease,
        country,
        deferred,
        mobile,
        disabled,
        clearButton: props.clearButton ?? 'mobile',
        clearLabel: props.clearLabel?.trim() ? props.clearLabel : 'Clear',
        inputRef: props.inputRef,
        inputClassName: props.inputClassName,
        current,
        withAction,
        writePlain: emit,
        settleOnUnmount: () => live.current?.props.settleOnUnmount !== false,
    };
    const input = { ...props.input, id };
    return h(
        PhoneBridge.Provider,
        { value: bridge },
        h(
            'div',
            { className: classes('mx-sdk-complete-phone', props.className) },
            country
                ? h(PhoneInput, {
                      ...input,
                      value: props.value ?? undefined,
                      // The private capture path is sole delivery. Missing adaptation
                      // must fail actual-vendor tests, not guess provenance here.
                      onChange() {},
                      sdkCapturePhoneChange: captureChange,
                      defaultCountry: configuredCountry,
                      international: true,
                      disabled,
                      inputComponent: PhoneTextInput,
                      numberInputProps: {
                          className: 'mx-sdk-phone-number-input',
                          sdkEnableReplay: true,
                      },
                      countrySelectProps: {
                          arrowComponent: PhoneArrow,
                          unicodeFlags: true,
                      },
                  })
                : h(
                      'div',
                      { className: 'mx-sdk-phone-plain' },
                      h(PhoneTextInput, {
                          ...input,
                          type: 'tel',
                          value: props.value ?? '',
                          disabled,
                          autoComplete: props.input?.autoComplete ?? 'off',
                      }),
                      h(
                          'span',
                          {
                              className: 'mx-sdk-phone-icon',
                              'aria-hidden': true,
                          },
                          h(PhoneIcon)
                      )
                  )
        )
    );
}

type Boundary = { signature: readonly unknown[]; generation: number };
const sameSignature = (left: readonly unknown[], right: readonly unknown[]) =>
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));

/** Complete Phone editor. Canonical data and authority stay with its host. */
export function CompletePhoneNumberField(props: CompletePhoneNumberFieldProps) {
    const generatedId = useId();
    const id = props.input?.id ?? `mx-sdk-phone-${generatedId}`;
    const configuredCountry = getCountries().find(
        (code) => code === props.defaultCountry?.toUpperCase()
    );
    const signature = [
        props.owner?.token,
        props.showCountryCodes === true,
        props.commit === 'deferred',
        props.disabled === true || props.readOnly === true,
        props.input?.form,
        id,
    ];
    const [boundary, setBoundary] = useState<Boundary>(() => ({
        signature,
        generation: 0,
    }));
    let selected = boundary;
    if (!sameSignature(boundary.signature, signature)) {
        // React discards this render and retries with the adjusted state. Never
        // publish a lease/ref belonging to an uncommitted render. A → B → A
        // receives a distinct inner controller even when the token returns to A.
        selected = { signature, generation: boundary.generation + 1 };
        setBoundary(selected);
    }
    const committed = useRef<Boundary | null>(null);
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommitEffect(() => {
        committed.current = selected;
        // Retain the last committed generation on genuine outer unmount so its
        // deferred settlement can still consult the actual host authority.
    }, [selected]);
    return h(PhoneController, {
        ...props,
        key: selected.generation,
        inputId: id,
        configuredCountry,
        generationIsCurrent: () => committed.current === selected,
    });
}
