/// <reference lib="es2023.intl" />
import {
    cloneElement,
    createElement as h,
    useMemo,
    useRef,
    type ReactElement,
    type ReactNode,
} from 'react';
import moment from 'moment-timezone';
import type { RuntimeAirtableField } from '../runtime/types.js';
import {
    createCalendarRecordPickerController,
    type CalendarActionResult,
    type CalendarClock,
    type CalendarOwnerFrame,
    type CalendarPickerRead,
    type CalendarRecordPickerFrame,
    type CalendarSelection,
} from '../ui/calendarController.js';
import {
    projectCalendarRecordPickerDays,
    type CalendarProjectionRecord,
} from '../ui/calendarDateProjection.js';
import { CalendarMonthGrid } from './CalendarMonthGrid.js';
import {
    Item,
    I18nProvider,
    mergeProps,
    useFocusRing,
    useListBox,
    useListState,
    useLocale,
    useOption,
    type AriaListBoxProps,
    type ListState,
    type Node,
} from './CalendarRuntime.js';
import {
    LinkedFinderRichLeaf,
    type LinkedFinderCardField,
} from './LinkedFinderCard.js';
import {
    isCalendarFrameReadable,
    useCalendarComposition,
} from './calendarComposition.js';

export type CalendarPickerRecordPresentation =
    | { readonly type: 'loading'; readonly label: string }
    | { readonly type: 'unavailable'; readonly label: string }
    | {
          readonly type: 'calendar';
          readonly primary: string;
          readonly subtitle: string;
      }
    | {
          readonly type: 'list';
          readonly primary: string;
          readonly details: readonly LinkedFinderCardField[];
          readonly showPreviewFieldTitle: boolean;
      };

/** Stable native query/control scope; display publications do not replace it. */
export type CalendarRecordPickerControl = CalendarOwnerFrame & {
    scheduleRead(request: CalendarPickerRead): CalendarActionResult;
};

/**
 * Immutable accepted native data, not an SDK client/page or a cache handle.
 * The presentation owner advances for record/schema/config/view publications,
 * including ABA. The separate control owner retains native read scheduling.
 */
export type CalendarRecordPickerAcceptedFrame = {
    readonly control: CalendarRecordPickerControl;
    readonly presentationOwner: CalendarOwnerFrame;
    readonly records: readonly CalendarProjectionRecord[];
    readonly startField: RuntimeAirtableField | null;
    readonly endField: RuntimeAirtableField | null;
    readonly clientTimeZone?: string;
    readonly selectedRecordIds: readonly string[];
    readonly presentationByRecordId: Readonly<
        Record<string, CalendarPickerRecordPresentation | undefined>
    >;
    readonly selectionEnabled: boolean;
    /** Final host admission uses current canonical membership and native caps. */
    toggleRecord(recordId: string): CalendarActionResult;
    readonly errorMessage: string | null;
    readonly isLoading: boolean;
    readonly isLoadingMore: boolean;
    readonly canLoadMore: boolean;
};

export type CalendarRecordPickerLabels = {
    readonly calendar: string;
    readonly previous: string;
    readonly next: string;
    readonly events: string;
    readonly noEvents: string;
    readonly loading: string;
    readonly loadMore: string;
    readonly unavailable: string;
    readonly unnamedRecord: string;
};

export type CalendarRecordPickerProps = {
    readonly frame: CalendarRecordPickerAcceptedFrame;
    readonly clock?: CalendarClock;
    readonly locale?: string;
    readonly labels?: Partial<CalendarRecordPickerLabels>;
    readonly className?: string;
};

const defaultLabels: CalendarRecordPickerLabels = {
    calendar: 'Calendar',
    previous: 'Previous',
    next: 'Next',
    events: 'events',
    noEvents: 'No events',
    loading: 'Loading',
    loadMore: 'Load more',
    unavailable: 'Record unavailable',
    unnamedRecord: 'Unnamed record',
};

type Controller = ReturnType<typeof createCalendarRecordPickerController>;
type Snapshot = ReturnType<Controller['getSnapshot']>;
type CompositionFrame = CalendarRecordPickerAcceptedFrame & CalendarOwnerFrame;
type SelectionIntent = {
    frame: CompositionFrame;
    isCurrent(): boolean;
};
type Binding = {
    frame: CompositionFrame;
    control: CalendarRecordPickerControl;
    controller: Controller;
    selection: SelectionIntent | null;
};
const bindings = new WeakMap<Controller, Binding>();
const refuse = (reason: string): CalendarActionResult => ({
    type: 'refused',
    reason,
});
const readable = (frame: CalendarRecordPickerAcceptedFrame) =>
    isCalendarFrameReadable(frame.control) &&
    isCalendarFrameReadable(frame.presentationOwner) &&
    isCalendarFrameReadable(frame.control);
const daysFor = (frame: CalendarRecordPickerAcceptedFrame, month: string) =>
    projectCalendarRecordPickerDays({
        records: readable(frame) ? frame.records : [],
        startField: frame.startField,
        endField: frame.endField,
        queryMonth: month,
        clientTimeZone: frame.clientTimeZone,
    });

function controlFrame(binding: Binding): CalendarRecordPickerFrame {
    const data = () => binding.selection?.frame ?? binding.frame;
    const snapshot = () => binding.controller.getSnapshot();
    return {
        owner: binding.control.owner,
        isCurrent: () => isCalendarFrameReadable(binding.control),
        get selectedRecordIds() {
            return data().selectedRecordIds;
        },
        get visibleDay() {
            return snapshot().selectedDay;
        },
        get visibleDayRecordIds() {
            const value = snapshot();
            return (
                daysFor(data(), value.queryMonth).get(value.selectedDay) ?? []
            ).map((record) => record.id);
        },
        scheduleRead: (request) => binding.control.scheduleRead(request),
        toggleRecord(recordId) {
            const intent = binding.selection;
            if (
                !intent ||
                !intent.isCurrent() ||
                !readable(intent.frame) ||
                !intent.frame.selectionEnabled ||
                !intent.isCurrent()
            )
                return refuse('stale-display-or-selection');
            return intent.frame.toggleRecord(recordId);
        },
    };
}

function createController(frame: CompositionFrame, clock: CalendarClock) {
    // Construction reads only the native-compatible initial clocks. Admission
    // remains disabled until the real component commit publishes this binding.
    const initial: CalendarRecordPickerFrame = {
        owner: frame.control.owner,
        isCurrent: () => isCalendarFrameReadable(frame.control),
        selectedRecordIds: frame.selectedRecordIds,
        visibleDay: '',
        visibleDayRecordIds: [],
        scheduleRead: (request) => frame.control.scheduleRead(request),
        toggleRecord: () => refuse('uncommitted'),
    };
    const controller = createCalendarRecordPickerController(initial, clock);
    const binding: Binding = {
        frame,
        control: frame.control,
        controller,
        selection: null,
    };
    bindings.set(controller, binding);
    controller.updateFrame(controlFrame(binding));
    return controller;
}

function synchronize(controller: Controller, frame: CompositionFrame) {
    const binding = bindings.get(controller)!;
    binding.frame = frame;
    if (binding.control !== frame.control) {
        binding.control = frame.control;
        controller.updateFrame(controlFrame(binding));
    }
}

function changeSelection(
    controller: Controller,
    frame: CompositionFrame,
    isCurrent: () => boolean,
    selection: CalendarSelection
) {
    const binding = bindings.get(controller)!;
    if (!isCurrent() || !readable(frame) || !frame.selectionEnabled)
        return refuse('stale-display-or-selection');
    if (binding.selection) return refuse('busy');
    const intent = { frame, isCurrent };
    binding.selection = intent;
    try {
        return controller.changeSelection(selection);
    } finally {
        if (binding.selection === intent) binding.selection = null;
    }
}

/** Complete Calendar record picker; canonical links and reads remain native. */
export function CalendarRecordPicker(
    props: CalendarRecordPickerProps
): ReactElement {
    const { locale } = useLocale();
    return h(I18nProvider, {
        // React Aria uses different provider component types for explicit and
        // default locales. Keep this provider explicit so a cosmetic locale
        // prop change cannot remount the native-compatible local controller.
        locale: props.locale || locale,
        children: h(Picker, props),
    });
}

function Picker(props: CalendarRecordPickerProps): ReactElement {
    const accepted = props.frame;
    const frame = useMemo<CompositionFrame>(
        () => ({
            ...accepted,
            owner: accepted.control.owner,
            isCurrent: () => isCalendarFrameReadable(accepted.control),
        }),
        [accepted]
    );
    const composition = useCalendarComposition<
        CompositionFrame,
        Snapshot,
        Controller
    >(frame, createController, synchronize, props.clock);
    const snapshot = composition.snapshot;
    const labels = { ...defaultLabels, ...props.labels };
    const allowed = readable(accepted);
    const days = daysFor(accepted, snapshot.queryMonth);
    const selectedDayRecords = days.get(snapshot.selectedDay) ?? [];
    const rows = selectedDayRecords.map((record) => ({
        id: record.id,
        presentation: accepted.presentationByRecordId[record.id],
    }));
    const counts = Object.fromEntries(
        [...days].map(([day, records]) => [day, records.length])
    );
    const today = moment.utc(snapshot.today, 'YYYY-MM-DD', true);
    const dayLabel = moment
        .utc(snapshot.selectedDay, 'YYYY-MM-DD', true)
        .locale(props.locale ?? moment.locale())
        .format('LL');
    return h(
        'div',
        {
            className: ['mx-sdk-calendar-picker', props.className]
                .filter(Boolean)
                .join(' '),
        },
        h(
            'div',
            { className: 'mx-sdk-calendar-picker__month' },
            h(CalendarMonthGrid, {
                surface: 'picker',
                selectedDay: snapshot.selectedDay,
                focusedDay: composition.focusedDay,
                localToday: {
                    year: today.year(),
                    month: today.month() + 1,
                    day: today.date(),
                },
                labels,
                onDayChange: composition.selectDay,
                onFocusChange: composition.focusDay,
                eventCounts: accepted.isLoading ? {} : counts,
            }),
            allowed && accepted.canLoadMore
                ? h(
                      'button',
                      {
                          type: 'button',
                          className: 'mx-sdk-calendar-picker__more',
                          disabled: accepted.isLoadingMore,
                          onClick: () =>
                              composition.act((controller) => {
                                  if (
                                      !composition.current() ||
                                      !readable(accepted) ||
                                      !accepted.canLoadMore ||
                                      accepted.isLoadingMore
                                  )
                                      return refuse('stale-pagination');
                                  return controller.loadMore();
                              }),
                      },
                      accepted.isLoadingMore ? labels.loading : labels.loadMore
                  )
                : null
        ),
        h(PickerRecords, {
            rows,
            selectedIds: allowed ? accepted.selectedRecordIds : [],
            disabled: !allowed || !accepted.selectionEnabled,
            error: allowed ? accepted.errorMessage : null,
            loading: allowed && accepted.isLoading,
            unavailable: !allowed,
            label: dayLabel,
            labels,
            onSelectionChange: (selection: CalendarSelection) =>
                composition.act((controller) =>
                    changeSelection(
                        controller,
                        frame,
                        composition.current,
                        selection
                    )
                ),
        })
    );
}

type PickerRow = {
    id: string;
    presentation: CalendarPickerRecordPresentation | undefined;
};

function PickerRecords(props: {
    rows: readonly PickerRow[];
    selectedIds: readonly string[];
    disabled: boolean;
    error: string | null;
    loading: boolean;
    unavailable: boolean;
    label: string;
    labels: CalendarRecordPickerLabels;
    onSelectionChange(selection: CalendarSelection): void;
}): ReactElement {
    const listProps: AriaListBoxProps<PickerRow> = {
        'aria-label': props.label,
        items: props.rows,
        selectedKeys: props.selectedIds,
        onSelectionChange: props.onSelectionChange,
        selectionMode: 'multiple',
        disabledKeys: props.disabled ? props.rows.map((row) => row.id) : [],
        children: (row) => {
            const presentation = row.presentation;
            const primary =
                presentation &&
                (presentation.type === 'list' ||
                    presentation.type === 'calendar')
                    ? presentation.primary
                    : '';
            return h(Item<PickerRow>, {
                key: row.id,
                textValue: primary || props.labels.unnamedRecord,
                children: [
                    h(
                        'div',
                        {
                            key: 'primary',
                            className: 'mx-sdk-calendar-picker__primary',
                            'data-empty': primary === '',
                        },
                        primary || props.labels.unnamedRecord
                    ),
                    h(
                        'div',
                        {
                            key: 'details',
                            className: 'mx-sdk-calendar-picker__details',
                        },
                        presentDetails(presentation, props.labels)
                    ),
                ],
            });
        },
    };
    const state = useListState(listProps);
    const ref = useRef<HTMLUListElement | null>(null);
    const { listBoxProps, labelProps } = useListBox(listProps, state, ref);
    let body: ReactNode;
    // Calendar's native error-before-loading precedence is deliberate.
    if (props.error) body = h('div', { role: 'alert' }, props.error);
    else if (props.loading)
        body = h('div', { role: 'status' }, props.labels.loading);
    else if (props.unavailable)
        body = h('div', { role: 'status' }, props.labels.unavailable);
    else if (state.collection.size === 0)
        body = h('div', null, props.labels.noEvents);
    else
        body = h(
            'ul',
            {
                ...listBoxProps,
                ref,
                className: 'mx-sdk-calendar-picker__records',
            },
            [...state.collection].map((item) =>
                h(PickerOption, { key: item.key, item, state })
            )
        );
    return h(
        'section',
        { className: 'mx-sdk-calendar-picker__list' },
        h(
            'div',
            { ...labelProps, className: 'mx-sdk-calendar-picker__day-label' },
            props.label
        ),
        body
    );
}

function presentDetails(
    presentation: CalendarPickerRecordPresentation | undefined,
    labels: CalendarRecordPickerLabels
): ReactNode {
    if (!presentation) return labels.unavailable;
    if (presentation.type === 'loading' || presentation.type === 'unavailable')
        return h('span', { role: 'status' }, presentation.label);
    if (presentation.type === 'calendar') return presentation.subtitle;
    return h(
        'dl',
        { className: 'mx-sdk-calendar-picker__rich-details' },
        presentation.details.map((detail) =>
            h(
                'div',
                { key: detail.key },
                presentation.showPreviewFieldTitle && detail.title !== null
                    ? h('dt', null, detail.title)
                    : null,
                h('dd', null, h(LinkedFinderRichLeaf, { leaf: detail.leaf }))
            )
        )
    );
}

function PickerOption({
    item,
    state,
}: {
    item: Node<PickerRow>;
    state: ListState<PickerRow>;
}): ReactElement {
    const ref = useRef<HTMLLIElement | null>(null);
    const { optionProps, labelProps, descriptionProps, isSelected } = useOption(
        { key: item.key },
        state,
        ref
    );
    const { isFocusVisible, focusProps } = useFocusRing();
    const rendered = item.rendered;
    if (!Array.isArray(rendered))
        throw new Error('Calendar option requires primary and description.');
    return h(
        'li',
        {
            ...mergeProps(optionProps, focusProps),
            ref,
            className: 'mx-sdk-calendar-picker__record',
            'data-selected': isSelected,
            'data-focus-visible': isFocusVisible,
        },
        h(
            'div',
            { className: 'mx-sdk-calendar-picker__record-content' },
            cloneElement(rendered[0], labelProps),
            cloneElement(rendered[1], descriptionProps)
        ),
        isSelected
            ? h(
                  'span',
                  {
                      className: 'mx-sdk-calendar-picker__check',
                      'aria-hidden': true,
                  },
                  '✓'
              )
            : null
    );
}
