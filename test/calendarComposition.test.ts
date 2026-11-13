import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, useLayoutEffect } from 'react';
import {
    createPortalCalendarController,
    type CalendarActionResult,
    type CalendarClock,
    type PortalCalendarFrame,
} from '../src/ui/calendarController.js';
import { useCalendarComposition } from '../src/react/calendarComposition.js';

const clock: CalendarClock = {
    utcDay: () => '2026-02-13',
    localDay: () => '2026-02-12',
    localMonth: () => '2026-02',
    localToday: () => '2026-02-12',
    clientUtcOffset: () => 0,
};
type Controller = ReturnType<typeof createPortalCalendarController>;
const createController = (frame: PortalCalendarFrame, clock: CalendarClock) =>
    createPortalCalendarController(frame, clock);
const synchronizeController = (
    controller: Controller,
    frame: PortalCalendarFrame,
    _current: () => boolean
) => controller.updateFrame(frame);

type ProbeActions = {
    current(): boolean;
    focusDay(day: string): CalendarActionResult;
    selectDay(day: string): CalendarActionResult;
    invokePort(): CalendarActionResult;
};

/** Test-only committed capture of the real hook; no React internals or DOM handler extraction. */
function CalendarCompositionProbe(props: {
    frame: PortalCalendarFrame;
    port(): CalendarActionResult;
    committed(actions: ProbeActions): void;
}) {
    const composition = useCalendarComposition(
        props.frame,
        createController,
        synchronizeController,
        clock
    );
    useLayoutEffect(() => {
        props.committed({
            current: composition.current,
            focusDay: composition.focusDay,
            selectDay: composition.selectDay,
            invokePort: () => composition.act(() => props.port()),
        });
    });
    return h('output', null, composition.snapshot.selectedDay);
}

async function fixture(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const descriptors = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        });
    const calls: unknown[] = [];
    const frame = (owner: object): PortalCalendarFrame => ({
        owner,
        isCurrent: () => true,
        retainedMonth: '2026-02',
        retainMonth(month) {
            calls.push(['retain', month]);
            return { type: 'admitted' };
        },
        readFirstPage(request) {
            calls.push(['read', request]);
            return { type: 'admitted' };
        },
    });
    const a = frame({});
    const b = frame({});
    let active = a;
    let captured: ProbeActions | undefined;
    const view = () =>
        h(
            StrictMode,
            null,
            h(CalendarCompositionProbe, {
                frame: active,
                port: () => {
                    calls.push(['port']);
                    return { type: 'admitted' as const };
                },
                committed(actions) {
                    captured = actions;
                },
            })
        );
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(container as unknown as HTMLElement);
    let mounted = true;
    const unmount = async () => {
        if (!mounted) return;
        mounted = false;
        await act(async () => root.unmount());
    };
    t.after(async () => {
        await unmount();
        keys.forEach((key, index) => {
            const descriptor = descriptors[index];
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    const render = async () => {
        await act(async () => root.render(view()));
        assert.ok(captured);
        assert.equal(captured.current(), true);
        return captured;
    };
    return {
        a,
        b,
        calls,
        container,
        unmount,
        async update(frame: PortalCalendarFrame) {
            active = frame;
            return render();
        },
        render,
    };
}

it('direct committed action captures retire across exact frame ABA without invoking any native port', async (t) => {
    const f = await fixture(t);
    const old = await f.render();
    await f.update(f.b);
    const current = await f.update(f.a);
    assert.equal(old.current(), false);
    assert.equal(old.focusDay('2026-03-12').type, 'refused');
    assert.equal(old.selectDay('2026-02-20').type, 'refused');
    assert.equal(old.invokePort().type, 'refused');
    assert.deepEqual(f.calls, []);
    let result: CalendarActionResult | undefined;
    await act(async () => {
        result = current.invokePort();
    });
    assert.deepEqual(result, { type: 'admitted' });
    assert.deepEqual(f.calls, [['port']]);
    assert.equal(
        f.container.querySelector('output')?.textContent,
        '2026-02-12'
    );
});

it('StrictMode recreates an actionable controller and every held callback refuses after unmount', async (t) => {
    const f = await fixture(t);
    const committed = await f.render();
    let result: CalendarActionResult | undefined;
    await act(async () => {
        result = committed.focusDay('2026-03-12');
    });
    assert.deepEqual(result, { type: 'admitted' });
    assert.deepEqual(f.calls, [
        ['retain', '2026-03'],
        ['read', { type: 'firstPage', onlyFetchIfNotAlreadyFetched: false }],
    ]);
    assert.equal(
        f.container.querySelector('output')?.textContent,
        '2026-03-12'
    );
    const latest = await f.render();
    await f.unmount();
    for (const capture of [committed, latest]) {
        assert.equal(capture.current(), false);
        assert.equal(capture.focusDay('2026-04-12').type, 'refused');
        assert.equal(capture.selectDay('2026-03-20').type, 'refused');
        assert.equal(capture.invokePort().type, 'refused');
    }
    assert.equal(f.calls.length, 2);
});
