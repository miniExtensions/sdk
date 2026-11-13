import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    type ReactElement,
    type ReactNode,
    type MouseEvent,
} from 'react';
import { parseDate } from './CalendarRuntime.js';
import type { RuntimeAirtableField } from '../runtime/types.js';
import {
    createPortalCalendarController,
    nativeCalendarClock,
    type CalendarActionResult,
    type CalendarClock,
    type CalendarOwnerFrame,
    type PortalCalendarFrame,
} from '../ui/calendarController.js';
import {
    projectPortalCalendarDays,
    type CalendarProjectionRecord,
} from '../ui/calendarDateProjection.js';
import { CalendarMonthGrid } from './CalendarMonthGrid.js';
import {
    isCalendarFrameReadable,
    useCalendarComposition,
} from './calendarComposition.js';

export type PortalCalendarRecordDisplay =
    | Readonly<{ status: 'loading' | 'unavailable' }>
    | Readonly<{
          status: 'present';
          /** Native compact Calendar primary is literal, including an empty value. */
          primary: string;
          subtitle?: string;
      }>;

export type PortalCalendarRecord = CalendarProjectionRecord &
    Readonly<{ display: PortalCalendarRecordDisplay }>;

/** Captured native grants are separate from the record's display projection. */
export type PortalCalendarRecordActions = Readonly<{
    recordId: string;
    /** The native captured port retains readonly/custom-view admission and child ownership. */
    open?(
        request: Readonly<{ shouldShowToTheSide: boolean }>
    ): CalendarActionResult;
    /** Already-captured native relationship removal; never inferred from a card. */
    remove?(): CalendarActionResult;
    removing?: boolean;
}>;

export type PortalCalendarControl = Readonly<{
    owner: object;
    isCurrent(): boolean;
    retainMonth: PortalCalendarFrame['retainMonth'];
    readFirstPage: PortalCalendarFrame['readFirstPage'];
}>;

export type PortalCalendarAcceptedFrame = Readonly<{
    /** Stable native month/read scope; survives a returned display publication. */
    control: PortalCalendarControl;
    retainedMonth: string;
    /** Exact returned display/record admission, distinct from stable control ownership. */
    presentationOwner: Readonly<{ token: object; isCurrent(): boolean }>;
    /** Only the current accepted visible records, schema and display policy. */
    records: readonly PortalCalendarRecord[];
    dateField: RuntimeAirtableField | null;
    clientTimeZone?: string;
    fallbackClientUtcOffset: number;
    shouldShowToTheSide: boolean;
    recordActions: readonly PortalCalendarRecordActions[];
    status: 'loading' | 'ready' | 'error';
    /** Already-normalized native presentation error, never a raw transport object. */
    errorMessage?: string | null;
    isReloading?: boolean;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    loadMore?(): CalendarActionResult;
}>;

export type PortalCalendarLabels = {
    calendar: string;
    previous: string;
    next: string;
    events: string;
    loading: string;
    empty: string;
    unavailable: string;
    unnamed: string;
    openRecord: string;
    removeRecord: string;
    loadMore: string;
};

/** Committed SDK card membership only; never a native child or action grant. */
export type PortalCalendarVisibleRecords = Readonly<{
    /** Unique IDs of cards actually rendered in this day/width/month presentation. */
    recordIds: readonly string[];
    /** Permanently false after this committed presentation is retired. */
    isCurrent(): boolean;
}>;

export type PortalCalendarProps = {
    frame: PortalCalendarAcceptedFrame;
    /** Actual host >=1024 breakpoint snapshot, independent of query and local day. */
    isWide: boolean;
    clock?: CalendarClock;
    locale?: string;
    labels?: Partial<PortalCalendarLabels>;
    className?: string;
    /**
     * Stable host registration, called after commit. Its disposer runs after
     * retirement, before replacement or unmount. Native ownership stays native.
     */
    registerVisibleRecords?(
        presentation: PortalCalendarVisibleRecords
    ): () => void;
};

const defaults: PortalCalendarLabels = {
    calendar: 'Calendar',
    previous: 'Previous',
    next: 'Next',
    events: 'events',
    loading: 'Loading',
    empty: 'No events',
    unavailable: 'Unavailable',
    unnamed: 'Unnamed record',
    openRecord: 'Open record',
    removeRecord: 'Remove record',
    loadMore: 'Load more',
};
const refused = (reason: string): CalendarActionResult => ({
    type: 'refused',
    reason,
});
const normalizeAdmission = (result: CalendarActionResult) =>
    result?.type === 'admitted' || result?.type === 'refused'
        ? result
        : refused('missing-admission');

type Controller = ReturnType<typeof createPortalCalendarController>;
type CompositionFrame = PortalCalendarAcceptedFrame & CalendarOwnerFrame;
const controllerControls = new WeakMap<Controller, PortalCalendarControl>();
const createController = (frame: CompositionFrame, clock: CalendarClock) => {
    const controller = createPortalCalendarController(
        {
            ...frame.control,
            retainedMonth: frame.retainedMonth,
            isCurrent: () => frame.control.isCurrent(),
        },
        clock
    );
    controllerControls.set(controller, frame.control);
    return controller;
};
const synchronizeController = (
    controller: Controller,
    frame: CompositionFrame,
    _isCurrent: () => boolean
) => {
    if (controllerControls.get(controller) === frame.control) return;
    controller.updateFrame({
        ...frame.control,
        retainedMonth: frame.retainedMonth,
        isCurrent: () => frame.control.isCurrent(),
    });
    controllerControls.set(controller, frame.control);
};

const useCommittedEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Complete native-compatible Portal month board. Canonical retained month,
 * transport, child forms and relationship writes remain the captured host's.
 */
export function PortalCalendar(props: PortalCalendarProps): ReactElement {
    const { frame } = props;
    const labels = { ...defaults, ...props.labels };
    const compositionFrame = useMemo(
        () => ({
            ...frame,
            owner: frame.control.owner,
            isCurrent: () => frame.control.isCurrent(),
        }),
        [frame]
    );
    const composition = useCalendarComposition(
        compositionFrame,
        createController,
        synchronizeController,
        props.clock ?? nativeCalendarClock
    );
    const snapshot = composition.snapshot;
    const presentationLease = useMemo(
        () => ({}),
        [props.isWide, snapshot.selectedDay]
    );
    const committedPresentation = useRef<object | null>(null);
    useCommittedEffect(() => {
        committedPresentation.current = presentationLease;
        return () => {
            if (committedPresentation.current === presentationLease)
                committedPresentation.current = null;
        };
    });
    const presentationToken = frame.presentationOwner.token;
    const displayCurrent = () =>
        frame.presentationOwner.token === presentationToken &&
        isCalendarFrameReadable({
            owner: presentationToken,
            isCurrent: () => frame.presentationOwner.isCurrent(),
        }) &&
        frame.presentationOwner.token === presentationToken;
    const controlReadable = isCalendarFrameReadable(compositionFrame);
    const displayReadable = controlReadable && displayCurrent();
    // Per-record repeated day keys are deduplicated by the native date policy.
    // Preserve every supplied record occurrence and its first-seen ordering.
    const records = displayReadable ? frame.records : [];
    const days = projectPortalCalendarDays({
        records,
        field: frame.dateField,
        clientTimeZone: frame.clientTimeZone,
        fallbackClientUtcOffset: frame.fallbackClientUtcOffset,
    });
    const today = parseDate(snapshot.today);
    const mode = props.isWide;
    const recordCurrent = (record: PortalCalendarRecord) => {
        if (
            !composition.current() ||
            committedPresentation.current !== presentationLease ||
            !records.includes(record) ||
            (!mode &&
                !(days.get(snapshot.selectedDay) ?? []).includes(record)) ||
            !displayCurrent()
        )
            return false;
        // The native display check can synchronously publish another frame.
        return (
            composition.current() &&
            committedPresentation.current === presentationLease
        );
    };
    const actionsFor = (recordId: string) => {
        const matching = frame.recordActions.filter(
            (actions) => actions.recordId === recordId
        );
        return matching.length === 1 ? matching[0] : undefined;
    };
    const renderRecord = (
        record: PortalCalendarRecord,
        occurrence: number
    ): ReactElement => {
        const actions = actionsFor(record.id);
        const projection = record.display;
        const primary =
            projection.status === 'present'
                ? projection.primary || labels.unnamed
                : projection.status === 'loading'
                  ? labels.loading
                  : labels.unavailable;
        const content =
            projection.status === 'present'
                ? h(
                      'div',
                      {
                          className: 'mx-sdk-portal-calendar__compact-content',
                          'aria-label': projection.primary,
                      },
                      h(
                          'p',
                          {
                              className: 'mx-sdk-portal-calendar__primary',
                              title: primary,
                              'data-empty': projection.primary === '',
                          },
                          primary
                      ),
                      projection.subtitle !== undefined
                          ? h(
                                'p',
                                {
                                    className:
                                        'mx-sdk-portal-calendar__subtitle',
                                    title: projection.subtitle,
                                },
                                projection.subtitle
                            )
                          : null
                  )
                : h(
                      'div',
                      {
                          className: 'mx-sdk-portal-calendar__compact-content',
                          role:
                              projection.status === 'loading'
                                  ? 'status'
                                  : undefined,
                      },
                      primary
                  );
        const invoke = (kind: 'open' | 'remove') =>
            composition.act(() => {
                if (!recordCurrent(record)) return refused('stale-card');
                if (!actions || !actions[kind] || actions.removing)
                    return refused('missing-capability');
                if (!recordCurrent(record)) return refused('stale-card');
                return normalizeAdmission(
                    kind === 'open'
                        ? actions.open!({
                              shouldShowToTheSide:
                                  mode && frame.shouldShowToTheSide,
                          })
                        : actions.remove!()
                );
            });
        return h(
            'article',
            {
                key: `${record.id}:${occurrence}`,
                className: 'mx-sdk-portal-calendar__record',
                'data-record-id': record.id,
                'aria-busy': actions?.removing || undefined,
            },
            actions?.open
                ? h(
                      'button',
                      {
                          type: 'button',
                          className: 'mx-sdk-portal-calendar__open',
                          'aria-label': `${labels.openRecord}: ${primary}`,
                          disabled: actions.removing,
                          onClick: (event: MouseEvent<HTMLButtonElement>) => {
                              event.stopPropagation();
                              invoke('open');
                          },
                      },
                      content
                  )
                : content,
            actions?.remove
                ? h(
                      'button',
                      {
                          type: 'button',
                          className: 'mx-sdk-portal-calendar__remove',
                          'aria-label': `${labels.removeRecord}: ${primary}`,
                          disabled: actions.removing,
                          onClick: (event: MouseEvent<HTMLButtonElement>) => {
                              event.stopPropagation();
                              invoke('remove');
                          },
                      },
                      h('span', { 'aria-hidden': true }, '×')
                  )
                : null
        );
    };
    const eventCounts: Record<string, number> = {};
    const dayContent: Record<string, ReactNode> = {};
    for (const [day, values] of days) {
        eventCounts[day] = values.length;
        if (props.isWide)
            dayContent[day] = h(
                'div',
                { className: 'mx-sdk-portal-calendar__records' },
                values.map(renderRecord)
            );
    }
    const selectedRecords = days.get(snapshot.selectedDay) ?? [];
    const visibleMonth = composition.focusedDay.slice(0, 7);
    const visibleRecords = mode
        ? [...days]
              .filter(([day]) => day.slice(0, 7) === visibleMonth)
              .flatMap(([, values]) => values)
        : selectedRecords;
    // Frame/action wrappers may change when registration itself rerenders the
    // host. Immutable data, schema and real owner/presentation changes must
    // instead allocate a fresh lease, including a committed A -> B -> A.
    const visibilityLease = useMemo(
        () => ({}),
        [
            frame.control,
            frame.control.owner,
            presentationToken,
            frame.records,
            frame.dateField,
            frame.clientTimeZone,
            frame.fallbackClientUtcOffset,
            frame.retainedMonth,
            frame.status,
            frame.errorMessage,
            frame.isReloading,
            frame.shouldShowToTheSide,
            mode,
            snapshot.selectedDay,
            visibleMonth,
            props.locale,
        ]
    );
    type VisibilityContext = { lease: object; current(): boolean };
    type VisibilityPublication = {
        lease: object;
        register: NonNullable<PortalCalendarProps['registerVisibleRecords']>;
        active: boolean;
        descriptor: PortalCalendarVisibleRecords;
        dispose?: () => void;
    };
    const committedVisibility = useRef<VisibilityContext | null>(null);
    const visibilityPublication = useRef<VisibilityPublication | null>(null);
    const retireVisibility = (publication: VisibilityPublication | null) => {
        if (!publication) return;
        publication.active = false;
        if (visibilityPublication.current === publication)
            visibilityPublication.current = null;
        const dispose = publication.dispose;
        publication.dispose = undefined;
        dispose?.();
    };
    useCommittedEffect(
        () => () => {
            committedVisibility.current = null;
            retireVisibility(visibilityPublication.current);
        },
        []
    );
    useCommittedEffect(() => {
        const context: VisibilityContext = {
            lease: visibilityLease,
            current: () =>
                composition.current() &&
                committedPresentation.current === presentationLease &&
                displayCurrent() &&
                composition.current() &&
                committedPresentation.current === presentationLease,
        };
        committedVisibility.current = context;
        const register = props.registerVisibleRecords;
        const previous = visibilityPublication.current;
        if (
            previous?.active &&
            previous.lease === visibilityLease &&
            previous.register === register &&
            previous.descriptor.isCurrent()
        )
            return;
        // A currentness check or disposer can synchronously commit a successor.
        if (committedVisibility.current !== context) return;
        retireVisibility(previous);
        if (
            committedVisibility.current !== context ||
            !register ||
            !context.current() ||
            committedVisibility.current !== context
        )
            return;
        let publication: VisibilityPublication;
        const descriptor: PortalCalendarVisibleRecords = Object.freeze({
            recordIds: Object.freeze([
                ...new Set(visibleRecords.map((record) => record.id)),
            ]),
            isCurrent() {
                const latest = committedVisibility.current;
                const committed = () =>
                    publication.active &&
                    visibilityPublication.current === publication &&
                    latest !== null &&
                    latest.lease === publication.lease &&
                    committedVisibility.current === latest;
                if (committed() && latest!.current() && committed())
                    return true;
                // A failed observation can never revive through a later guard
                // refresh, even if the host reuses an old data/owner identity.
                publication.active = false;
                return false;
            },
        });
        publication = {
            lease: visibilityLease,
            register,
            active: true,
            descriptor,
        };
        visibilityPublication.current = publication;
        try {
            const dispose = register(descriptor);
            if (
                publication.active &&
                visibilityPublication.current === publication
            )
                publication.dispose = dispose;
            else dispose();
        } catch (error) {
            retireVisibility(publication);
            throw error;
        }
    });
    const capturedLoadMore = frame.loadMore;
    const moreCapabilityCurrent = () =>
        frame.hasMore === true &&
        frame.isLoadingMore !== true &&
        capturedLoadMore !== undefined &&
        frame.loadMore === capturedLoadMore;
    const moreCurrent = () => {
        if (
            !composition.current() ||
            !moreCapabilityCurrent() ||
            !displayCurrent()
        )
            return false;
        return composition.current() && moreCapabilityCurrent();
    };
    const selectedDayContent = !displayReadable
        ? h('p', { role: 'status' }, labels.unavailable)
        : selectedRecords.length
          ? h(
                'div',
                { className: 'mx-sdk-portal-calendar__records' },
                selectedRecords.map(renderRecord)
            )
          : frame.status === 'ready'
            ? h(
                  'p',
                  { className: 'mx-sdk-portal-calendar__empty' },
                  labels.empty
              )
            : null;
    if (!controlReadable)
        return h(
            'section',
            { className: 'mx-sdk-portal-calendar' },
            h('p', { role: 'status' }, labels.unavailable)
        );
    return h(
        'section',
        {
            className: ['mx-sdk-portal-calendar', props.className]
                .filter(Boolean)
                .join(' '),
            'aria-busy':
                frame.status === 'loading' || frame.isReloading || undefined,
        },
        displayReadable && frame.status === 'error' && frame.errorMessage
            ? h('div', { role: 'alert' }, frame.errorMessage)
            : null,
        displayReadable && (frame.status === 'loading' || frame.isReloading)
            ? h('div', { role: 'status' }, labels.loading)
            : null,
        h(CalendarMonthGrid, {
            surface: 'portal',
            selectedDay: snapshot.selectedDay,
            focusedDay: composition.focusedDay,
            isWide: props.isWide,
            localToday: {
                year: today.year,
                month: today.month,
                day: today.day,
            },
            locale: props.locale,
            labels,
            onDayChange: composition.selectDay,
            onFocusChange: composition.focusDay,
            eventCounts,
            dayContent,
            selectedDayContent,
        }),
        displayReadable && frame.hasMore && frame.loadMore
            ? h(
                  'button',
                  {
                      type: 'button',
                      className: 'mx-sdk-portal-calendar__more',
                      disabled: frame.isLoadingMore,
                      onClick: () =>
                          composition.act(() => {
                              if (!moreCurrent())
                                  return refused('stale-presentation');
                              if (!moreCurrent())
                                  return refused('stale-presentation');
                              return normalizeAdmission(
                                  capturedLoadMore!.call(frame)
                              );
                          }),
                  },
                  frame.isLoadingMore ? labels.loading : labels.loadMore
              )
            : null
    );
}
