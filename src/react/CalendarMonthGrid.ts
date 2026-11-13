/// <reference lib="es2023.intl" />
import {
    createElement as h,
    useRef,
    type ReactElement,
    type ReactNode,
} from 'react';
import {
    I18nProvider,
    mergeProps,
    useButton,
    useCalendar,
    useCalendarCell,
    useCalendarGrid,
    useFocusRing,
    useLocale,
    type AriaButtonOptions,
} from 'calendar-react-aria';
import { useCalendarState, type CalendarState } from 'react-stately';
import {
    createCalendar,
    getWeeksInMonth,
    parseDate,
    type CalendarDate,
} from '@internationalized/date';

export type CalendarMonthGridLabels = {
    calendar: string;
    previous: string;
    next: string;
    events: string;
};

export type CalendarMonthGridProps = {
    surface: 'picker' | 'portal';
    /** An accepted ISO calendar day. Selection and query ownership stay outside. */
    selectedDay: string;
    /** Portal's >=1024 presentation snapshot. Viewport changes perform no read. */
    isWide?: boolean;
    /** Local Date components used only for the native visual today highlight. */
    localToday?: { year: number; month: number; day: number };
    locale?: string;
    labels?: Partial<CalendarMonthGridLabels>;
    onDayChange(day: string): void;
    /** Focus intent only; the captured host/controller owns month/read ordering. */
    onFocusChange(day: string): void;
    eventCounts?: Readonly<Record<string, number | undefined>>;
    /** SDK composition seam for the shared rich-card owner, not a card renderer. */
    dayContent?: Readonly<Record<string, ReactNode>>;
    /** SDK composition seam; the narrow Portal's cards retain separate authority. */
    selectedDayContent?: ReactNode;
    className?: string;
};

const defaultLabels: CalendarMonthGridLabels = {
    calendar: 'Calendar',
    previous: 'Previous',
    next: 'Next',
    events: 'events',
};

/**
 * Actual native-compatible month grids only. No record store, action grant,
 * transport or complete rich-card parity is created by this foundation.
 */
export function CalendarMonthGrid(props: CalendarMonthGridProps): ReactElement {
    return props.locale
        ? h(I18nProvider, {
              locale: props.locale,
              children: h(MonthGrid, props),
          })
        : h(MonthGrid, props);
}

function MonthGrid(props: CalendarMonthGridProps): ReactElement {
    const labels = { ...defaultLabels, ...props.labels };
    const selectedDay = parseDate(props.selectedDay);
    const value =
        props.surface === 'portal' && props.isWide ? null : selectedDay;
    const { locale } = useLocale();
    const onChange = (day: CalendarDate) => props.onDayChange(day.toString());
    const state = useCalendarState({
        value,
        defaultFocusedValue: selectedDay,
        onChange,
        onFocusChange: (day) => props.onFocusChange(day.toString()),
        locale,
        createCalendar,
    });
    const { calendarProps, prevButtonProps, nextButtonProps, title } =
        useCalendar({ value, onChange, 'aria-label': labels.calendar }, state);
    const { gridProps, headerProps, weekDays } = useCalendarGrid(
        props.surface === 'portal' ? { weekdayStyle: 'short' } : {},
        state
    );
    const weeks =
        props.surface === 'picker'
            ? 6
            : getWeeksInMonth(state.visibleRange.start, locale);
    const localToday =
        props.localToday ??
        (() => {
            const now = new Date();
            return {
                year: now.getFullYear(),
                month: now.getMonth() + 1,
                day: now.getDate(),
            };
        })();
    return h(
        'div',
        {
            ...calendarProps,
            className: ['mx-sdk-calendar', props.className]
                .filter(Boolean)
                .join(' '),
            'data-surface': props.surface,
            'data-wide': props.surface === 'portal' && !!props.isWide,
        },
        h(
            'header',
            { className: 'mx-sdk-calendar__header' },
            h('h2', null, title),
            h(
                'div',
                { className: 'mx-sdk-calendar__navigation' },
                h(CalendarButton, {
                    ...prevButtonProps,
                    'aria-label': labels.previous,
                    direction: 'previous',
                }),
                h(CalendarButton, {
                    ...nextButtonProps,
                    'aria-label': labels.next,
                    direction: 'next',
                })
            )
        ),
        h(
            'table',
            {
                ...gridProps,
                // Preserve the native Portal keyboard policy, including wide mode.
                ...(props.surface === 'portal' ? { onKeyDown: undefined } : {}),
                className: 'mx-sdk-calendar__grid',
            },
            h(
                'thead',
                headerProps,
                h(
                    'tr',
                    null,
                    weekDays.map((day, index) => h('th', { key: index }, day))
                )
            ),
            h(
                'tbody',
                null,
                Array.from({ length: weeks }, (_, week) =>
                    h(
                        'tr',
                        { key: week },
                        state.getDatesInWeek(week).map((day, index) =>
                            day
                                ? h(DayCell, {
                                      key: index,
                                      state,
                                      day,
                                      props,
                                      labels,
                                      localToday,
                                  })
                                : h('td', { key: index })
                        )
                    )
                )
            )
        ),
        props.surface === 'portal' && !props.isWide
            ? h(
                  'div',
                  { className: 'mx-sdk-calendar__selected-day' },
                  props.selectedDayContent
              )
            : null
    );
}

function DayCell({
    state,
    day,
    props,
    labels,
    localToday,
}: {
    state: CalendarState;
    day: CalendarDate;
    props: CalendarMonthGridProps;
    labels: CalendarMonthGridLabels;
    localToday: { year: number; month: number; day: number };
}): ReactElement {
    const ref = useRef<HTMLDivElement | null>(null);
    const {
        cellProps,
        buttonProps,
        isSelected,
        isOutsideVisibleRange,
        isDisabled,
        formattedDate,
    } = useCalendarCell({ date: day }, state, ref);
    const { focusProps, isFocusVisible } = useFocusRing();
    const date = day.toString();
    const today =
        day.year === localToday.year &&
        day.month === localToday.month &&
        day.day === localToday.day;
    if (props.surface === 'portal' && isOutsideVisibleRange)
        return h('td', {
            ...cellProps,
            'data-date': date,
            'data-outside': true,
            className: 'mx-sdk-calendar__outside',
        });
    const rawCount = props.eventCounts?.[date];
    const count =
        rawCount != null && Number.isSafeInteger(rawCount) && rawCount > 0
            ? rawCount
            : 0;
    const wide = props.surface === 'portal' && props.isWide;
    const dayProps =
        props.surface === 'picker'
            ? mergeProps(buttonProps, focusProps)
            : wide
              ? { 'aria-label': buttonProps['aria-label'] }
              : buttonProps;
    return h(
        'td',
        {
            ...cellProps,
            'data-date': date,
            'data-outside': isOutsideVisibleRange,
            className: 'mx-sdk-calendar__cell',
        },
        h(
            'div',
            {
                ...dayProps,
                ref,
                className: 'mx-sdk-calendar__day',
                'data-selected': isSelected,
                'data-today': today,
                'data-disabled': isDisabled,
                'data-focus-visible':
                    props.surface === 'picker' && isFocusVisible,
            },
            h('span', { className: 'mx-sdk-calendar__number' }, formattedDate),
            props.surface === 'picker' && count > 0
                ? h(
                      'span',
                      { className: 'mx-sdk-calendar__badge' },
                      count > 9 ? '9+' : count
                  )
                : null
        ),
        props.surface === 'picker' || wide
            ? h(
                  'div',
                  { className: 'mx-sdk-calendar__content' },
                  props.dayContent?.[date]
              )
            : h(
                  'div',
                  { className: 'mx-sdk-calendar__events' },
                  h(
                      'span',
                      { className: 'mx-sdk-calendar__sr-only' },
                      `${count} ${labels.events}`
                  ),
                  h(
                      'span',
                      {
                          'aria-hidden': true,
                          className: 'mx-sdk-calendar__dots',
                      },
                      Array.from({ length: count }, (_, index) =>
                          h('span', {
                              key: index,
                              className: 'mx-sdk-calendar__dot',
                          })
                      )
                  )
              )
    );
}

function CalendarButton(
    props: AriaButtonOptions<'button'> & { direction: 'previous' | 'next' }
): ReactElement {
    const ref = useRef<HTMLButtonElement | null>(null);
    const { buttonProps } = useButton(props, ref);
    return h(
        'button',
        {
            ...buttonProps,
            ref,
            className: 'mx-sdk-calendar__nav-button',
        },
        h(
            'svg',
            {
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2,
                'aria-hidden': true,
                focusable: 'false',
            },
            h('path', {
                d:
                    props.direction === 'previous'
                        ? 'm15 18-6-6 6-6'
                        : 'm9 18 6-6-6-6',
            })
        )
    );
}
