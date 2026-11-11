import type * as React from 'react';
import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import moment from 'moment-timezone';
import 'moment/min/locales.js';
import Datetime from '../../vendor/date-time/index.cjs';
import {
    formatDateInputValue,
    getDateInputFormat,
    getDateInputMomentLocale,
    getDateInputPickerValue,
    getDateInputTimeZone,
    getDateInputValueOnBlur,
    getDateInputValueOnChange,
    isDateInputValueWithinRange,
    type DateInputCompatibilityConfig,
    type DateInputRange,
} from '../ui/dateInputCompatibility.js';
import type { RuntimeLanguage } from '../runtime/types.js';
import { TextInput } from './TextInput.js';
import {
    DatePopover,
    DatePopoverAnchor,
    DatePopoverContent,
} from './datePopoverRuntime.js';

export type CompleteDateFieldProps = {
    airtableDateConfig: DateInputCompatibilityConfig;
    id: string;
    /** Canonical native bytes. Date and DateTime have distinct grammars. */
    value: string | null;
    setValue(value: string | null): void | boolean;
    language: RuntimeLanguage;
    readOnly?: boolean;
    dateRange?: DateInputRange;
    sessionId?: string;
    /** Optional actual host generation; canonical storage and Save stay outside. */
    owner?: { token: unknown; isCurrent(): boolean };
    placeholder?: string;
    className?: string;
    formId?: string;
    ariaDescribedBy?: string;
    ariaInvalid?: boolean;
    calendarAlign?: 'start' | 'end';
    title?: string;
    description?: React.ReactNode;
    error?: string;
    calendarLabel?: string;
    inputRef?: React.Ref<HTMLInputElement>;
    inputTestId?: string;
};

/** Complete native-compatible picker; the legacy ISO-only controls stay separate. */
export function CompleteDateField(
    props: CompleteDateFieldProps
): React.ReactElement {
    const calendarId = `${useId()}-calendar`;
    const clientTimeZone = useMemo(() => moment.tz.guess(), []);
    const format = getDateInputFormat(props.airtableDateConfig);
    const zone =
        props.airtableDateConfig.type === 'dateTime'
            ? getDateInputTimeZone(props.airtableDateConfig)
            : undefined;
    const lease = useMemo(
        () => ({}),
        [
            props.id,
            props.sessionId,
            props.airtableDateConfig.type,
            format,
            zone,
            props.owner?.token,
            props.readOnly,
        ]
    );
    const accepted = useRef<{
        lease: object;
        props: CompleteDateFieldProps;
    } | null>(null);
    const commitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        accepted.current = { lease, props };
        return () => {
            if (accepted.current?.lease === lease) accepted.current = null;
        };
    });
    const current = () => {
        const active = accepted.current;
        if (
            active?.lease !== lease ||
            active.props.readOnly ||
            !(active.props.owner?.isCurrent() ?? true)
        )
            return null;
        return accepted.current === active ? active.props : null;
    };
    const commit = (value: string | null) => {
        const active = current();
        return active !== null && active.setValue(value) !== false;
    };
    const canonicalText = () =>
        formatDateInputValue({
            airtableValue: props.value,
            airtableFieldConfig: props.airtableDateConfig,
        });
    const [draft, setDraft] = useState(() => ({
        lease,
        value: props.value,
        text: canonicalText(),
    }));
    if (draft.lease !== lease || draft.value !== props.value)
        setDraft({ lease, value: props.value, text: canonicalText() });
    const pickerRef = useRef<Datetime>(null);
    const anchorRef = useRef<HTMLDivElement>(null);
    const view = useRef('days');
    const [popup, setPopup] = useState<{
        lease: object;
        open: boolean;
        theme: React.CSSProperties;
    }>({ lease, open: false, theme: {} });
    const open = popup.lease === lease && popup.open && !props.readOnly;
    const close = () => {
        if (current()) setPopup((old) => ({ ...old, open: false }));
    };
    commitEffect(() => {
        if (!open) return;
        const anchor = anchorRef.current;
        const document = anchor?.ownerDocument;
        const window = document?.defaultView;
        if (!anchor || !document || !window) return;
        // A consuming dialog can use a separate Radix module/context. Own the
        // focused popup's Escape before its document-level dismissal listener.
        const escape = (event: KeyboardEvent) => {
            const target = event.target;
            if (
                event.key !== 'Escape' ||
                event.defaultPrevented ||
                event.isComposing ||
                !(target instanceof window.Node) ||
                (!anchor.contains(target) &&
                    !document.getElementById(calendarId)?.contains(target)) ||
                !current()
            )
                return;
            event.preventDefault();
            event.stopPropagation();
            // Focus while still open, so the picker's focus handler cannot
            // reopen it during dismissal. Do not move unrelated outside focus.
            anchor.querySelector('input')?.focus({ preventScroll: true });
            close();
        };
        window.addEventListener('keydown', escape, true);
        return () => window.removeEventListener('keydown', escape, true);
    }, [open, lease, calendarId]);
    const blur = () => {
        const active = current();
        if (!active) return;
        const parsed = getDateInputValueOnBlur({
            inputValue: draft.text,
            config: active.airtableDateConfig,
            dateRange: active.dateRange,
            clientTimeZone,
        });
        if (parsed.isValid) commit(parsed.value);
        else
            setDraft({
                lease,
                value: active.value,
                text: formatDateInputValue({
                    airtableValue: active.value,
                    airtableFieldConfig: active.airtableDateConfig,
                }),
            });
    };
    const onOpen = () => {
        if (!current()) return;
        view.current = 'days';
        const anchor = anchorRef.current;
        const theme = anchor
            ? anchor.ownerDocument.defaultView?.getComputedStyle(anchor)
            : null;
        const style: React.CSSProperties & Record<string, string> = {};
        for (const property of [
            '--theme-500',
            '--mx-sdk-accent',
            '--mx-sdk-accent-rgb',
        ]) {
            const value = theme?.getPropertyValue(property);
            if (value) style[property] = value;
        }
        setPopup({ lease, open: true, theme: style });
        pickerRef.current?.navigate('days');
        if (props.value === null) pickerRef.current?.setViewDate(new Date());
    };
    const onChange = (value: string | moment.Moment) => {
        const active = current();
        if (!active) return;
        const date = moment(value);
        if (!date.isValid()) {
            commit(null);
            return;
        }
        const native = getDateInputValueOnChange(
            date,
            active.airtableDateConfig.type
        );
        if (
            !isDateInputValueWithinRange({
                airtableFieldConfig: active.airtableDateConfig,
                airtableValue: native,
                clientTimeZone,
                dateRange: active.dateRange,
            })
        )
            return;
        if (commit(native) && view.current === 'days') close();
    };
    const describedBy =
        [
            props.ariaDescribedBy,
            props.description != null && `${props.id}-description`,
            props.error && `${props.id}-error`,
        ]
            .filter(Boolean)
            .join(' ') || undefined;
    return h(
        DatePopover,
        {
            open,
            onOpenChange(next) {
                if (next) onOpen();
                else close();
            },
        },
        h(
            'div',
            {
                className: ['mx-sdk-complete-date', props.className]
                    .filter(Boolean)
                    .join(' '),
            },
            props.title ? h('label', { htmlFor: props.id }, props.title) : null,
            h(Datetime, {
                ref: pickerRef,
                open,
                closeOnClickOutside: false,
                renderInput(inputProps) {
                    return h(
                        DatePopoverAnchor,
                        { asChild: true },
                        h(
                            'div',
                            {
                                ref: anchorRef,
                                className: 'mx-sdk-complete-date-control',
                            },
                            h(
                                'svg',
                                {
                                    className: 'mx-sdk-complete-date-icon',
                                    viewBox: '0 0 24 24',
                                    fill: 'none',
                                    stroke: 'currentColor',
                                    strokeWidth: 1.8,
                                    'aria-hidden': true,
                                },
                                h('rect', {
                                    x: 3,
                                    y: 5,
                                    width: 18,
                                    height: 16,
                                    rx: 2,
                                }),
                                h('path', { d: 'M16 3v4M8 3v4M3 11h18' })
                            ),
                            h(TextInput, {
                                ...inputProps,
                                ref: props.inputRef,
                                id: props.id,
                                value: draft.text,
                                ...{ 'data-testid': props.inputTestId },
                                onChange(event) {
                                    if (current())
                                        setDraft({
                                            lease,
                                            value: props.value,
                                            text: event.currentTarget.value,
                                        });
                                },
                                onBlur: blur,
                                onKeyDown(event) {
                                    if (event.key === ' ')
                                        event.stopPropagation();
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        if (!event.nativeEvent.isComposing)
                                            blur();
                                    }
                                    inputProps.onKeyDown?.(event);
                                },
                                readOnly: props.readOnly,
                                disabled: props.readOnly,
                                className: 'mx-sdk-complete-date-input',
                                autoComplete: 'off',
                                placeholder: props.placeholder,
                                form: props.formId,
                                'aria-describedby': describedBy,
                                'aria-invalid':
                                    props.ariaInvalid || !!props.error,
                                'aria-controls': calendarId,
                                'aria-expanded': open,
                                'aria-haspopup': 'dialog',
                            })
                        )
                    );
                },
                renderDay(dayProps, date) {
                    const { key, ...attributes } = dayProps;
                    return h('td', { key }, h('div', attributes, date.date()));
                },
                renderView(_view, renderCalendar) {
                    return h(
                        DatePopoverContent,
                        {
                            id: calendarId,
                            align: props.calendarAlign ?? 'start',
                            container:
                                anchorRef.current?.closest<HTMLElement>(
                                    '[role="dialog"]'
                                ) ?? undefined,
                            className: 'mx-sdk-complete-date-popup',
                            style: popup.theme,
                            'aria-label':
                                props.calendarLabel ??
                                props.title ??
                                props.placeholder ??
                                'Calendar',
                            onOpenAutoFocus: (event) => event.preventDefault(),
                            onCloseAutoFocus: (event) => event.preventDefault(),
                            onInteractOutside(event) {
                                const target = event.target;
                                if (
                                    target instanceof
                                        (anchorRef.current?.ownerDocument
                                            .defaultView?.Node ?? Node) &&
                                    anchorRef.current?.contains(target)
                                )
                                    event.preventDefault();
                            },
                        },
                        h('div', { className: 'rdtPicker' }, renderCalendar())
                    );
                },
                value: getDateInputPickerValue(props.value),
                onChange,
                onBeforeNavigate(next, _previous, date) {
                    const active = current();
                    if (!active) return '';
                    if (
                        next === 'time' &&
                        active.airtableDateConfig.type === 'dateTime' &&
                        active.value === null
                    ) {
                        const native = getDateInputValueOnChange(
                            date.clone().startOf('day'),
                            'dateTime'
                        );
                        if (
                            !isDateInputValueWithinRange({
                                airtableFieldConfig: active.airtableDateConfig,
                                airtableValue: native,
                                clientTimeZone,
                                dateRange: active.dateRange,
                            }) ||
                            !commit(native)
                        )
                            return '';
                    }
                    return next;
                },
                dateFormat: props.airtableDateConfig.options.dateFormat.format,
                timeFormat:
                    props.airtableDateConfig.type === 'dateTime'
                        ? props.airtableDateConfig.options.timeFormat.format ===
                          'h:mma'
                            ? 'h:mm a'
                            : props.airtableDateConfig.options.timeFormat.format
                        : false,
                isValidDate(date) {
                    return isDateInputValueWithinRange({
                        airtableFieldConfig: props.airtableDateConfig,
                        airtableValue: getDateInputValueOnChange(
                            date,
                            props.airtableDateConfig.type
                        ),
                        clientTimeZone,
                        dateRange: props.dateRange,
                    });
                },
                closeOnSelect: true,
                updateOnView:
                    props.airtableDateConfig.type === 'dateTime' && !props.value
                        ? 'time'
                        : 'days',
                onOpen,
                onClose: close,
                onNavigate(next) {
                    if (current()) view.current = next;
                },
                locale: getDateInputMomentLocale(props.language) ?? 'en',
                displayTimeZone: zone,
            }),
            props.description != null
                ? h('div', { id: `${props.id}-description` }, props.description)
                : null,
            props.error
                ? h(
                      'div',
                      { id: `${props.id}-error`, role: 'alert' },
                      props.error
                  )
                : null
        )
    );
}
