import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    createCalendarRecordPickerController,
    createPortalCalendarController,
    nativeCalendarClock,
    type CalendarActionResult,
    type CalendarClock,
    type CalendarPickerRead,
    type CalendarRecordPickerFrame,
    type PortalCalendarFrame,
} from '../src/ui/calendarController.js';

const admitted: CalendarActionResult = { type: 'admitted' };
const clock = (): CalendarClock => ({
    utcDay: () => '2026-09-01',
    localDay: () => '2026-08-31',
    localMonth: () => '2026-08',
    localToday: () => '2026-08-31',
    clientUtcOffset: () => -420,
});

function pickerFrame(
    changes: Partial<CalendarRecordPickerFrame> = {}
): CalendarRecordPickerFrame {
    return {
        owner: {},
        isCurrent: () => true,
        selectedRecordIds: ['other-day', 'visible-selected'],
        visibleDay: '2026-09-01',
        visibleDayRecordIds: ['visible-selected', 'visible-new'],
        scheduleRead: () => admitted,
        toggleRecord: () => admitted,
        ...changes,
    };
}

function portalFrame(
    changes: Partial<PortalCalendarFrame> = {}
): PortalCalendarFrame {
    return {
        owner: {},
        isCurrent: () => true,
        retainedMonth: '2026-08',
        retainMonth: () => admitted,
        readFirstPage: () => admitted,
        ...changes,
    };
}

test('picker keeps UTC selected day, local query month and local today separate without reading', () => {
    let reads = 0;
    const picker = createCalendarRecordPickerController(
        pickerFrame({
            scheduleRead() {
                reads++;
                return admitted;
            },
        }),
        clock()
    );
    const snapshot = picker.getSnapshot();
    assert.equal(snapshot.selectedDay, '2026-09-01');
    assert.equal(snapshot.focusMonth, '2026-09');
    assert.equal(snapshot.queryMonth, '2026-08');
    assert.equal(snapshot.today, '2026-08-31');
    assert.equal(reads, 0);
    picker.focusDay('2026-09-09');
    assert.equal(reads, 0);
    assert.equal(picker.getSnapshot().selectedDay, '2026-09-01');
});

test('picker cross-month focus updates both guards before one scheduled reset read, then day', () => {
    const reads: CalendarPickerRead[] = [];
    let offset = -420;
    const picker = createCalendarRecordPickerController(
        pickerFrame({
            scheduleRead(request) {
                reads.push(request);
                assert.equal(picker.getSnapshot().queryMonth, request.month);
                assert.equal(picker.getSnapshot().focusMonth, request.month);
                assert.equal(picker.getSnapshot().selectedDay, '2026-09-01');
                return admitted;
            },
        }),
        { ...clock(), clientUtcOffset: () => offset }
    );
    assert.deepEqual(picker.focusDay('2026-10-03'), admitted);
    assert.deepEqual(reads, [
        { month: '2026-10', resetOffset: true, clientUtcOffset: -420 },
    ]);
    assert.equal(picker.getSnapshot().selectedDay, '2026-10-03');
    offset = -480;
    picker.updateFrame(
        pickerFrame({
            scheduleRead(request) {
                reads.push(request);
                return admitted;
            },
        })
    );
    assert.deepEqual(picker.loadMore(), admitted);
    assert.deepEqual(reads[1], {
        month: '2026-10',
        resetOffset: false,
        clientUtcOffset: -480,
    });
    picker.focusDay('2026-10-31');
    assert.equal(reads.length, 2);
});

test('picker refused focus restores both guards, keeps load-more on the prior query, and permits an explicit second focus', () => {
    const reads: CalendarPickerRead[] = [];
    const refused: CalendarActionResult = {
        type: 'refused',
        reason: 'native-read-not-admitted',
    };
    const picker = createCalendarRecordPickerController(
        pickerFrame({
            scheduleRead(request) {
                reads.push(request);
                return reads.length === 1 ? refused : admitted;
            },
        }),
        clock()
    );
    assert.equal(picker.focusDay('2026-10-03'), refused);
    assert.equal(picker.getSnapshot().focusMonth, '2026-09');
    assert.equal(picker.getSnapshot().queryMonth, '2026-08');
    assert.equal(picker.getSnapshot().selectedDay, '2026-09-01');
    assert.equal(reads.length, 1);
    assert.deepEqual(picker.loadMore(), admitted);
    assert.deepEqual(reads[1], {
        month: '2026-08',
        resetOffset: false,
        clientUtcOffset: -420,
    });
    assert.deepEqual(picker.focusDay('2026-10-03'), admitted);
    assert.deepEqual(reads[2], {
        month: '2026-10',
        resetOffset: true,
        clientUtcOffset: -420,
    });
    assert.equal(reads.length, 3);
    assert.equal(picker.getSnapshot().selectedDay, '2026-10-03');
});

test('calendar day selection changes only local day and never queries or toggles records', () => {
    const calls: string[] = [];
    const picker = createCalendarRecordPickerController(
        pickerFrame({
            scheduleRead: () => {
                calls.push('read');
                return admitted;
            },
            toggleRecord: () => {
                calls.push('write');
                return admitted;
            },
        }),
        clock()
    );
    assert.deepEqual(picker.selectDay('2026-09-06'), admitted);
    assert.equal(picker.getSnapshot().selectedDay, '2026-09-06');
    assert.equal(picker.getSnapshot().queryMonth, '2026-08');
    assert.deepEqual(calls, []);
    assert.deepEqual(picker.selectDay('2026-02-30'), {
        type: 'refused',
        reason: 'invalid-day',
    });
    assert.deepEqual(picker.focusDay('not-a-day'), {
        type: 'refused',
        reason: 'invalid-day',
    });
    assert.equal(picker.getSnapshot().selectedDay, '2026-09-06');
});

test('R30 toggles exactly one visible delta while retaining canonical off-day membership', () => {
    const toggles: string[] = [];
    const original = Object.freeze(['other-day', 'visible-selected']);
    const picker = createCalendarRecordPickerController(
        pickerFrame({
            selectedRecordIds: original,
            toggleRecord(id) {
                toggles.push(id);
                return admitted;
            },
        }),
        clock()
    );
    assert.deepEqual(
        picker.changeSelection(
            new Set(['other-day', 'visible-selected', 'visible-new'])
        ),
        admitted
    );
    assert.deepEqual(picker.changeSelection(new Set(['other-day'])), admitted);
    assert.deepEqual(toggles, ['visible-new', 'visible-selected']);
    assert.deepEqual(original, ['other-day', 'visible-selected']);
});

test('picker day transitions retire held selection callbacks and require a matching new visible-day frame', () => {
    const writes: string[] = [];
    const first = pickerFrame({
        toggleRecord(id) {
            writes.push(id);
            return admitted;
        },
    });
    const picker = createCalendarRecordPickerController(first, clock());
    const previousDayActions = picker.captureActions();
    const selection = new Set(['other-day', 'visible-selected', 'visible-new']);
    assert.deepEqual(picker.selectDay('2026-09-02'), admitted);
    assert.deepEqual(previousDayActions.changeSelection(selection), {
        type: 'refused',
        reason: 'stale-day',
    });
    assert.deepEqual(picker.changeSelection(selection), {
        type: 'refused',
        reason: 'stale-day',
    });
    assert.deepEqual(writes, []);

    picker.updateFrame({
        ...first,
        visibleDay: '2026-09-02',
        visibleDayRecordIds: ['second-day'],
    });
    assert.deepEqual(
        picker.changeSelection(
            new Set(['other-day', 'visible-selected', 'second-day'])
        ),
        admitted
    );
    assert.deepEqual(writes, ['second-day']);
});

test('local day ABA retires held selection independently of the unchanged owner frame', () => {
    const writes: string[] = [];
    const picker = createCalendarRecordPickerController(
        pickerFrame({
            toggleRecord(id) {
                writes.push(id);
                return admitted;
            },
        }),
        clock()
    );
    const held = picker.captureActions();
    const selection = new Set(['other-day', 'visible-selected', 'visible-new']);
    picker.selectDay('2026-09-02');
    picker.selectDay('2026-09-01');
    assert.deepEqual(held.changeSelection(selection), {
        type: 'refused',
        reason: 'stale-day',
    });
    assert.deepEqual(writes, []);
    assert.deepEqual(picker.changeSelection(selection), admitted);
    assert.deepEqual(writes, ['visible-new']);
});

test('admitted cross-month focus also retires prior-day selection actions', () => {
    let writes = 0;
    const picker = createCalendarRecordPickerController(
        pickerFrame({
            toggleRecord() {
                writes++;
                return admitted;
            },
        }),
        clock()
    );
    const held = picker.captureActions();
    assert.deepEqual(picker.focusDay('2026-10-01'), admitted);
    assert.equal(
        held.changeSelection(
            new Set(['other-day', 'visible-selected', 'visible-new'])
        ).type,
        'refused'
    );
    assert.equal(
        picker.changeSelection(
            new Set(['other-day', 'visible-selected', 'visible-new'])
        ).type,
        'refused'
    );
    assert.equal(writes, 0);
});

test('R30 refuses all, bulk, no-op, off-day removals, and foreign or numeric keys without partial writes', () => {
    const toggles: string[] = [];
    const picker = createCalendarRecordPickerController(
        pickerFrame({
            toggleRecord(id) {
                toggles.push(id);
                return admitted;
            },
        }),
        clock()
    );
    for (const selection of [
        'all' as const,
        new Set<string>(),
        new Set(['other-day', 'visible-selected']),
        new Set(['visible-selected']),
        new Set(['other-day', 'visible-selected', 'foreign']),
        new Set<string | number>(['other-day', 'visible-selected', 1]),
    ]) {
        assert.equal(picker.changeSelection(selection).type, 'refused');
    }
    const numeric = createCalendarRecordPickerController(
        pickerFrame({
            selectedRecordIds: ['1'],
            visibleDayRecordIds: ['1'],
            toggleRecord: (id) => {
                toggles.push(id);
                return admitted;
            },
        }),
        clock()
    );
    assert.equal(numeric.changeSelection(new Set([1])).type, 'refused');
    assert.deepEqual(toggles, []);
});

test('host selection-cap and native action refusals remain explicit without changing native membership', () => {
    const refusal: CalendarActionResult = {
        type: 'refused',
        reason: 'native-selection-limit',
    };
    let attempts = 0;
    const picker = createCalendarRecordPickerController(
        pickerFrame({
            toggleRecord() {
                attempts++;
                return refusal;
            },
        }),
        clock()
    );
    assert.equal(
        picker.changeSelection(
            new Set(['other-day', 'visible-selected', 'visible-new'])
        ),
        refusal
    );
    assert.equal(attempts, 1);
    assert.equal(picker.getSnapshot().selectedDay, '2026-09-01');
});

test('picker captured actions retire across owner, configuration or view frame ABA', () => {
    let calls = 0;
    const a = pickerFrame({
        toggleRecord: () => {
            calls++;
            return admitted;
        },
    });
    const picker = createCalendarRecordPickerController(a, clock());
    const old = picker.captureActions();
    picker.updateFrame({ ...a });
    picker.updateFrame(a);
    assert.equal(
        old.changeSelection(
            new Set(['other-day', 'visible-selected', 'visible-new'])
        ).type,
        'refused'
    );
    assert.equal(old.loadMore().type, 'refused');
    assert.equal(old.focusDay('2026-10-01').type, 'refused');
    assert.equal(old.selectDay('2026-09-04').type, 'refused');
    assert.equal(calls, 0);
    picker.updateFrame(a);
    assert.equal(
        picker
            .captureActions()
            .changeSelection(
                new Set(['other-day', 'visible-selected', 'visible-new'])
            ).type,
        'admitted'
    );
    assert.equal(calls, 1);
});

test('native owner rejection and reentrant validation cannot dispatch a picker successor action', () => {
    let allowed = false;
    let writes = 0;
    const a = pickerFrame({
        isCurrent: () => allowed,
        toggleRecord: () => {
            writes++;
            return admitted;
        },
    });
    const picker = createCalendarRecordPickerController(a, clock());
    assert.equal(picker.loadMore().type, 'refused');
    allowed = true;
    const b = pickerFrame({
        isCurrent() {
            picker.updateFrame(a);
            return true;
        },
    });
    picker.updateFrame(b);
    assert.equal(
        picker.changeSelection(
            new Set(['other-day', 'visible-selected', 'visible-new'])
        ).type,
        'refused'
    );
    assert.equal(writes, 0);
});

test('nested picker actions refuse reentry while one native semantic writer runs', () => {
    const nested: CalendarActionResult[] = [];
    let calls = 0;
    const picker = createCalendarRecordPickerController(
        pickerFrame({
            toggleRecord() {
                calls++;
                nested.push(picker.loadMore());
                nested.push(picker.selectDay('2026-10-01'));
                return admitted;
            },
        }),
        clock()
    );
    picker.changeSelection(
        new Set(['other-day', 'visible-selected', 'visible-new'])
    );
    assert.equal(calls, 1);
    assert.deepEqual(nested, [
        { type: 'refused', reason: 'busy' },
        { type: 'refused', reason: 'busy' },
    ]);
    assert.equal(picker.getSnapshot().selectedDay, '2026-09-01');
});

test('Portal initializes local today only inside the retained month, otherwise day one', () => {
    const august = createPortalCalendarController(portalFrame(), clock());
    const september = createPortalCalendarController(
        portalFrame({ retainedMonth: '2026-09' }),
        clock()
    );
    assert.equal(august.getSnapshot().selectedDay, '2026-08-31');
    assert.equal(september.getSnapshot().selectedDay, '2026-09-01');
});

test('Portal cross-month focus orders guard, retained month, forced first read, then selected day', () => {
    const events: unknown[] = [];
    const portal = createPortalCalendarController(
        portalFrame({
            retainMonth(month) {
                events.push(['retain', month]);
                assert.equal(portal.getSnapshot().focusMonth, '2026-09');
                assert.equal(portal.getSnapshot().selectedDay, '2026-08-31');
                return admitted;
            },
            readFirstPage(request) {
                events.push(['read', request]);
                assert.equal(portal.getSnapshot().selectedDay, '2026-08-31');
                return admitted;
            },
        }),
        clock()
    );
    assert.deepEqual(portal.focusDay('2026-09-06'), admitted);
    assert.deepEqual(events, [
        ['retain', '2026-09'],
        ['read', { type: 'firstPage', onlyFetchIfNotAlreadyFetched: false }],
    ]);
    assert.equal(portal.getSnapshot().selectedDay, '2026-09-06');
    assert.equal(portal.getSnapshot().appliedMonth, '2026-08');
    portal.focusDay('2026-09-10');
    portal.selectDay('2026-09-11');
    assert.equal(events.length, 2);
    assert.equal(portal.getSnapshot().selectedDay, '2026-09-11');
});

test('Portal keeps chosen day separate from externally applied month until remount', () => {
    let reads = 0;
    const a = portalFrame({
        readFirstPage: () => {
            reads++;
            return admitted;
        },
    });
    const portal = createPortalCalendarController(a, clock());
    portal.selectDay('2026-08-22');
    const oldActions = portal.captureActions();
    const january = { ...a, retainedMonth: '2027-01' };
    portal.updateFrame(january);
    assert.equal(portal.getSnapshot().appliedMonth, '2027-01');
    assert.equal(portal.getSnapshot().selectedDay, '2026-08-22');
    assert.equal(oldActions.selectDay('2026-08-23').type, 'refused');
    assert.equal(reads, 0);
    const remount = createPortalCalendarController(january, clock());
    assert.equal(remount.getSnapshot().selectedDay, '2027-01-01');
    assert.equal(reads, 0);
});

test('Portal frame ABA retires held callbacks even when opaque owner identity is reused', () => {
    let reads = 0;
    const a = portalFrame({
        readFirstPage: () => {
            reads++;
            return admitted;
        },
    });
    const portal = createPortalCalendarController(a, clock());
    const held = portal.getSnapshot().actions;
    portal.updateFrame({ ...a });
    portal.updateFrame(a);
    assert.equal(held.focusDay('2026-09-01').type, 'refused');
    assert.equal(held.selectDay('2026-08-15').type, 'refused');
    assert.equal(reads, 0);
    assert.equal(portal.getSnapshot().selectedDay, '2026-08-31');
});

test('Portal native refusal prevents downstream reads and selected-day changes', () => {
    let reads = 0;
    const refused: CalendarActionResult = {
        type: 'refused',
        reason: 'native-view-retired',
    };
    const portal = createPortalCalendarController(
        portalFrame({
            retainMonth: () => refused,
            readFirstPage: () => {
                reads++;
                return admitted;
            },
        }),
        clock()
    );
    assert.equal(portal.focusDay('2026-09-01'), refused);
    assert.equal(reads, 0);
    assert.equal(portal.getSnapshot().selectedDay, '2026-08-31');
    assert.equal(portal.focusDay('2026-02-30').type, 'refused');
    assert.equal(portal.selectDay('2026-02-30').type, 'refused');
});

test('Portal refused retained-month admission can be retried only by a new explicit focus', () => {
    const events: string[] = [];
    let attempts = 0;
    const portal = createPortalCalendarController(
        portalFrame({
            retainMonth(month) {
                attempts++;
                events.push(`retain:${month}`);
                return attempts === 1
                    ? { type: 'refused', reason: 'native-month-not-admitted' }
                    : admitted;
            },
            readFirstPage() {
                events.push('read');
                return admitted;
            },
        }),
        clock()
    );
    assert.equal(portal.focusDay('2026-09-06').type, 'refused');
    assert.equal(portal.getSnapshot().focusMonth, '2026-08');
    assert.equal(portal.getSnapshot().selectedDay, '2026-08-31');
    assert.deepEqual(events, ['retain:2026-09']);
    assert.deepEqual(portal.focusDay('2026-09-06'), admitted);
    assert.deepEqual(events, ['retain:2026-09', 'retain:2026-09', 'read']);
    assert.equal(portal.getSnapshot().selectedDay, '2026-09-06');
});

test('Portal admitted month with a refused first read keeps a deliberate same-target focus retry possible', () => {
    const events: string[] = [];
    let reads = 0;
    const first = portalFrame({
        retainMonth(month) {
            events.push(`retain:${month}`);
            return admitted;
        },
        readFirstPage() {
            reads++;
            events.push('read');
            return reads === 1
                ? { type: 'refused', reason: 'native-first-read-not-admitted' }
                : admitted;
        },
    });
    const portal = createPortalCalendarController(first, clock());
    assert.equal(portal.focusDay('2026-09-06').type, 'refused');
    assert.equal(portal.getSnapshot().focusMonth, '2026-08');
    assert.equal(portal.getSnapshot().selectedDay, '2026-08-31');
    assert.deepEqual(events, ['retain:2026-09', 'read']);
    // The host may already have committed that retained month despite refusing
    // the read. Receiving it is presentation only and starts no second request.
    portal.updateFrame({ ...first, retainedMonth: '2026-09' });
    assert.equal(portal.getSnapshot().appliedMonth, '2026-09');
    assert.equal(reads, 1);
    assert.deepEqual(portal.focusDay('2026-09-06'), admitted);
    assert.deepEqual(events, [
        'retain:2026-09',
        'read',
        'retain:2026-09',
        'read',
    ]);
    assert.equal(portal.getSnapshot().selectedDay, '2026-09-06');
});

test('Portal retirement during retained-month dispatch prevents the old forced read', () => {
    let reads = 0;
    const portal = createPortalCalendarController(
        portalFrame({
            retainMonth() {
                portal.updateFrame(portalFrame());
                return admitted;
            },
            readFirstPage: () => {
                reads++;
                return admitted;
            },
        }),
        clock()
    );
    assert.equal(portal.focusDay('2026-09-01').type, 'refused');
    assert.equal(reads, 0);
    assert.equal(portal.getSnapshot().selectedDay, '2026-08-31');
});

test('disposed controllers refuse local changes and every read or record action', () => {
    const picker = createCalendarRecordPickerController(pickerFrame(), clock());
    const portal = createPortalCalendarController(portalFrame(), clock());
    const heldPicker = picker.captureActions();
    const heldPortal = portal.captureActions();
    picker.dispose();
    portal.dispose();
    picker.updateFrame(pickerFrame());
    portal.updateFrame(portalFrame());
    for (const result of [
        heldPicker.selectDay('2026-09-02'),
        heldPicker.loadMore(),
        heldPicker.changeSelection(new Set(['other-day'])),
        heldPortal.focusDay('2026-09-01'),
        portal.selectDay('2026-08-15'),
    ])
        assert.deepEqual(result, { type: 'refused', reason: 'disposed' });
    assert.equal(picker.getSnapshot().selectedDay, '2026-09-01');
    assert.equal(portal.getSnapshot().selectedDay, '2026-08-31');
});

test('native default clock exposes the distinct native Date and Moment reads', () => {
    const now = new Date();
    const localDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    assert.equal(nativeCalendarClock.utcDay(), now.toISOString().slice(0, 10));
    assert.equal(nativeCalendarClock.localDay(), localDay);
    assert.equal(nativeCalendarClock.localMonth(), localDay.slice(0, 7));
    assert.equal(nativeCalendarClock.localToday(), localDay);
    assert.equal(
        nativeCalendarClock.clientUtcOffset() + now.getTimezoneOffset(),
        0
    );
});

test('a host Promise or void return never substitutes for explicit read admission', () => {
    for (const result of [undefined, Promise.resolve(admitted)]) {
        const picker = createCalendarRecordPickerController(
            pickerFrame({
                // Exercise an invalid external JavaScript port implementation.
                scheduleRead: () => result as unknown as CalendarActionResult,
            }),
            clock()
        );
        assert.deepEqual(picker.focusDay('2026-10-01'), {
            type: 'refused',
            reason: 'missing-admission',
        });
        assert.equal(picker.getSnapshot().selectedDay, '2026-09-01');
    }
});

test('a native synchronous failure remains an error and releases the reentry guard', () => {
    const failure = new Error('native scheduled read failed');
    let calls = 0;
    const picker = createCalendarRecordPickerController(
        pickerFrame({
            scheduleRead() {
                calls++;
                if (calls === 1) throw failure;
                return admitted;
            },
        }),
        clock()
    );
    assert.throws(
        () => picker.loadMore(),
        (error) => error === failure
    );
    assert.deepEqual(picker.loadMore(), admitted);
    assert.equal(calls, 2);
});
