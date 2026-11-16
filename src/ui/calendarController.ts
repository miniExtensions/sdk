import moment from 'moment-timezone';

/** Separate native lifecycle reads; there is no midnight subscription. */
export type CalendarClock = Readonly<{
    utcDay(): string;
    localDay(): string;
    localMonth(): string;
    localToday(): string;
    clientUtcOffset(): number;
}>;

export const nativeCalendarClock: CalendarClock = Object.freeze({
    utcDay: () => new Date().toISOString().slice(0, 10),
    localDay: () => moment().format('YYYY-MM-DD'),
    localMonth: () => moment().format('YYYY-MM'),
    localToday: () => {
        const today = new Date();
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    },
    clientUtcOffset: () => moment().utcOffset(),
});

export type CalendarActionResult =
    | Readonly<{ type: 'admitted' }>
    | Readonly<{ type: 'refused'; reason: string }>;

const admitted: CalendarActionResult = Object.freeze({ type: 'admitted' });
const refuse = (reason: string): CalendarActionResult => ({
    type: 'refused',
    reason,
});
const validDay = (day: string) =>
    typeof day === 'string' && moment.utc(day, 'YYYY-MM-DD', true).isValid();

/**
 * Borrow a real committed host identity, never construct SDK accepted authority.
 * isCurrent must include field/configuration/view/privacy generations, including
 * ABA. Every host port must also fence its own final synchronous dispatch.
 */
export type CalendarOwnerFrame = Readonly<{
    owner: object;
    isCurrent(): boolean;
}>;

export type CalendarPickerRead = Readonly<{
    month: string;
    resetOffset: boolean;
    clientUtcOffset: number;
}>;

export type CalendarRecordPickerFrame = CalendarOwnerFrame &
    Readonly<{
        selectedRecordIds: readonly string[];
        /** The day whose accepted visible record IDs are projected below. */
        visibleDay: string;
        /** Only records actually visible on visibleDay. */
        visibleDayRecordIds: readonly string[];
        scheduleRead(request: CalendarPickerRead): CalendarActionResult;
        toggleRecord(recordId: string): CalendarActionResult;
    }>;

export type PortalCalendarFrame = CalendarOwnerFrame &
    Readonly<{
        /** Applied canonical query month; local selection is separate. */
        retainedMonth: string;
        retainMonth(month: string): CalendarActionResult;
        readFirstPage(request: {
            type: 'firstPage';
            onlyFetchIfNotAlreadyFetched: false;
        }): CalendarActionResult;
    }>;

export type CalendarSelection = 'all' | ReadonlySet<string | number>;

export type CalendarDayActions = Readonly<{
    focusDay(day: string): CalendarActionResult;
    selectDay(day: string): CalendarActionResult;
}>;
export type CalendarRecordPickerActions = CalendarDayActions &
    Readonly<{
        loadMore(): CalendarActionResult;
        changeSelection(selection: CalendarSelection): CalendarActionResult;
    }>;

/** One local controller lifetime; replacing a frame retires its old callbacks. */
function createFrameGuard<Frame extends CalendarOwnerFrame>(initial: Frame) {
    let frame = initial;
    let generation = 0;
    let disposed = false;
    let acting = false;
    return {
        frame: () => frame,
        update(next: Frame) {
            if (!disposed && next !== frame) {
                frame = next;
                generation++;
            }
        },
        dispose() {
            disposed = true;
            generation++;
        },
        capture() {
            const captured = frame;
            const capturedGeneration = generation;
            const owner = captured.owner;
            const current = () =>
                !disposed &&
                frame === captured &&
                generation === capturedGeneration &&
                captured.owner === owner &&
                captured.isCurrent() === true &&
                !disposed &&
                frame === captured &&
                generation === capturedGeneration;
            return {
                frame: captured,
                run(
                    action: (isCurrent: () => boolean) => CalendarActionResult
                ) {
                    if (disposed) return refuse('disposed');
                    if (acting) return refuse('busy');
                    acting = true;
                    try {
                        if (!current()) return refuse('stale');
                        return action(current);
                    } finally {
                        acting = false;
                    }
                },
            };
        },
    };
}

const dispatch = (
    isCurrent: () => boolean,
    action: () => CalendarActionResult
): CalendarActionResult => {
    if (!isCurrent()) return refuse('stale');
    const result = action();
    // A Promise or void return is not evidence that native admission occurred.
    return result?.type === 'admitted' || result?.type === 'refused'
        ? result
        : refuse('missing-admission');
};

export function createCalendarRecordPickerController(
    initialFrame: CalendarRecordPickerFrame,
    clock: CalendarClock = nativeCalendarClock
) {
    const guard = createFrameGuard(initialFrame);
    let selectedDay = clock.utcDay();
    let selectedDayGeneration = 0;
    let queryMonth = clock.localMonth();
    let focusMonth = selectedDay.slice(0, 7);
    const select = (day: string) => {
        if (day !== selectedDay) {
            selectedDay = day;
            selectedDayGeneration++;
        }
    };
    const captureActions = (): CalendarRecordPickerActions => {
        const lease = guard.capture();
        const capturedDayGeneration = selectedDayGeneration;
        const read = (resetOffset: boolean, current: () => boolean) => {
            const request = {
                month: queryMonth,
                resetOffset,
                clientUtcOffset: clock.clientUtcOffset(),
            };
            return dispatch(current, () => lease.frame.scheduleRead(request));
        };
        return Object.freeze({
            focusDay: (day: string) =>
                lease.run((current) => {
                    if (!validDay(day)) return refuse('invalid-day');
                    const month = day.slice(0, 7);
                    if (month === focusMonth) return admitted;
                    // Match the inner widget guard, outer query ref, scheduled
                    // first read, then selected-day ordering.
                    const previousFocusMonth = focusMonth;
                    const previousQueryMonth = queryMonth;
                    focusMonth = month;
                    queryMonth = month;
                    let result: CalendarActionResult | undefined;
                    try {
                        result = read(true, current);
                        if (result.type === 'admitted' && current())
                            select(day);
                        return result;
                    } finally {
                        // A refusal cannot turn a later explicit focus into a
                        // false same-month success, or move load-more's query.
                        if (result?.type !== 'admitted') {
                            focusMonth = previousFocusMonth;
                            queryMonth = previousQueryMonth;
                        }
                    }
                }),
            selectDay: (day: string) =>
                lease.run((current) => {
                    if (!validDay(day)) return refuse('invalid-day');
                    if (!current()) return refuse('stale');
                    select(day);
                    return admitted;
                }),
            loadMore: () => lease.run((current) => read(false, current)),
            changeSelection: (selection: CalendarSelection) =>
                lease.run((current) => {
                    if (
                        capturedDayGeneration !== selectedDayGeneration ||
                        lease.frame.visibleDay !== selectedDay
                    )
                        return refuse('stale-day');
                    if (selection === 'all')
                        return refuse('unsupported-selection');
                    const selected = lease.frame.selectedRecordIds;
                    const keys = Array.from(selection);
                    const changed = [
                        ...keys.filter(
                            (key) => !selected.some((id) => id === key)
                        ),
                        ...selected.filter((id) => !selection.has(id)),
                    ];
                    if (changed.length !== 1)
                        return refuse('unsupported-selection');
                    const id = changed[0];
                    if (
                        typeof id !== 'string' ||
                        !lease.frame.visibleDayRecordIds.includes(id)
                    )
                        return refuse('off-day-selection');
                    return dispatch(current, () =>
                        lease.frame.toggleRecord(id)
                    );
                }),
        });
    };
    return {
        getSnapshot: () =>
            Object.freeze({
                selectedDay,
                queryMonth,
                focusMonth,
                today: clock.localToday(),
                actions: captureActions(),
            }),
        captureActions,
        updateFrame: guard.update,
        focusDay: (day: string) => captureActions().focusDay(day),
        selectDay: (day: string) => captureActions().selectDay(day),
        loadMore: () => captureActions().loadMore(),
        changeSelection: (selection: CalendarSelection) =>
            captureActions().changeSelection(selection),
        dispose: guard.dispose,
    };
}

export function createPortalCalendarController(
    initialFrame: PortalCalendarFrame,
    clock: CalendarClock = nativeCalendarClock
) {
    const guard = createFrameGuard(initialFrame);
    const localDay = clock.localDay();
    let selectedDay = localDay.startsWith(initialFrame.retainedMonth)
        ? localDay
        : `${initialFrame.retainedMonth}-01`;
    let focusMonth = initialFrame.retainedMonth;
    const captureActions = (): CalendarDayActions => {
        const lease = guard.capture();
        return Object.freeze({
            focusDay: (day: string) =>
                lease.run((current) => {
                    if (!validDay(day)) return refuse('invalid-day');
                    const month = day.slice(0, 7);
                    if (month === focusMonth) return admitted;
                    const previousFocusMonth = focusMonth;
                    focusMonth = month;
                    let read: CalendarActionResult | undefined;
                    try {
                        const retained = dispatch(current, () =>
                            lease.frame.retainMonth(month)
                        );
                        if (retained.type === 'refused') return retained;
                        read = dispatch(current, () =>
                            lease.frame.readFirstPage({
                                type: 'firstPage',
                                onlyFetchIfNotAlreadyFetched: false,
                            })
                        );
                        if (read.type === 'admitted' && current())
                            selectedDay = day;
                        return read;
                    } finally {
                        // Native retained month may already have changed. Keep
                        // a deliberate focus retry possible without retrying it
                        // automatically or pretending the first read happened.
                        if (read?.type !== 'admitted')
                            focusMonth = previousFocusMonth;
                    }
                }),
            selectDay: (day: string) =>
                lease.run((current) => {
                    if (!validDay(day)) return refuse('invalid-day');
                    if (!current()) return refuse('stale');
                    selectedDay = day;
                    return admitted;
                }),
        });
    };
    return {
        getSnapshot: () =>
            Object.freeze({
                selectedDay,
                focusMonth,
                appliedMonth: guard.frame().retainedMonth,
                today: clock.localToday(),
                actions: captureActions(),
            }),
        captureActions,
        updateFrame: guard.update,
        focusDay: (day: string) => captureActions().focusDay(day),
        selectDay: (day: string) => captureActions().selectDay(day),
        dispose: guard.dispose,
    };
}
