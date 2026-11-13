import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { JSDOM } from 'jsdom';
import {
    act,
    createElement as h,
    memo,
    StrictMode,
    useCallback,
    useState,
} from 'react';
import { renderToString } from 'react-dom/server';
import { I18nProvider } from '../src/react/CalendarRuntime.js';
import type { Root } from 'react-dom/client';
import type { RuntimeAirtableField } from '../src/runtime/types.js';
import type { CalendarClock } from '../src/ui/calendarController.js';
import {
    PortalCalendar,
    type PortalCalendarAcceptedFrame,
    type PortalCalendarProps,
    type PortalCalendarRecord,
    type PortalCalendarVisibleRecords,
} from '../src/react/PortalCalendar.js';

// Synthetic host ports prove public component lifetimes only. They establish no
// private SDK provenance, real native accepted-frame authority or persistence.

const clock: CalendarClock = {
    utcDay: () => '2026-02-13',
    localDay: () => '2026-02-12',
    localMonth: () => '2026-02',
    localToday: () => '2026-02-12',
    clientUtcOffset: () => 0,
};
const field: RuntimeAirtableField = {
    id: 'date',
    name: 'Date',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: {
        type: 'date',
        options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
    },
};
const records: readonly PortalCalendarRecord[] = [
    {
        id: 'first',
        fields: { date: ['2026-02-12', '2026-02-12'] },
        display: {
            status: 'present',
            primary: '<b>Literal first</b>',
            subtitle: 'First subtitle',
        },
    },
    {
        id: 'second',
        fields: { date: '2026-02-13' },
        display: { status: 'present', primary: 'Second', subtitle: 'Next day' },
    },
];

function host() {
    const state = {
        current: true,
        activePresentation: {},
        retainedMonth: '2026-02',
        events: [] as unknown[],
        retireDisplayOnRetain: false,
        beforePresentationRead: undefined as (() => void) | undefined,
        onRetain: undefined as ((month: string) => void) | undefined,
        onRead: undefined as (() => void) | undefined,
        refuseOpen: false,
    };
    const control = {
        owner: {},
        isCurrent: () => state.current,
        retainMonth(month: string) {
            state.events.push(['retain', month]);
            state.retainedMonth = month;
            if (state.retireDisplayOnRetain) state.activePresentation = {};
            state.onRetain?.(month);
            return { type: 'admitted' } as const;
        },
        readFirstPage(request: {
            type: 'firstPage';
            onlyFetchIfNotAlreadyFetched: false;
        }) {
            state.events.push(['read', request]);
            state.onRead?.();
            return { type: 'admitted' } as const;
        },
    };
    const frame = (
        patch: Partial<PortalCalendarAcceptedFrame> = {}
    ): PortalCalendarAcceptedFrame => {
        const token = {};
        state.activePresentation = token;
        return {
            control,
            retainedMonth: state.retainedMonth,
            presentationOwner: {
                token,
                isCurrent() {
                    state.beforePresentationRead?.();
                    return state.activePresentation === token;
                },
            },
            records,
            dateField: field,
            fallbackClientUtcOffset: 0,
            shouldShowToTheSide: true,
            status: 'ready',
            recordActions: records.map((record) => ({
                recordId: record.id,
                open(request) {
                    state.events.push(['open', record.id, request]);
                    return state.refuseOpen
                        ? { type: 'refused', reason: 'native-readonly' }
                        : { type: 'admitted' };
                },
                remove() {
                    state.events.push(['remove', record.id]);
                    return { type: 'admitted' };
                },
            })),
            ...patch,
        };
    };
    return { state, control, frame };
}

it('Portal SSR uses literal compact records, local retained-month day and zero read/action ports', () => {
    assert.equal(typeof document, 'undefined');
    const native = host();
    let registrations = 0;
    const html = renderToString(
        h(PortalCalendar, {
            frame: native.frame(),
            isWide: false,
            clock,
            locale: 'en-US',
            registerVisibleRecords() {
                registrations += 1;
                return () => assert.fail('SSR has no visibility disposal');
            },
        })
    );
    assert.match(html, /&lt;b&gt;Literal first&lt;\/b&gt;/);
    assert.match(html, /First subtitle/);
    assert.doesNotMatch(html, /<b>/);
    assert.doesNotMatch(html, /<img/);
    assert.equal((html.match(/data-record-id="first"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /data-record-id="second"/);
    assert.deepEqual(native.state.events, []);
    assert.equal(registrations, 0);
    const repeated = renderToString(
        h(PortalCalendar, {
            frame: native.frame({ records: [records[0], records[0]] }),
            isWide: false,
            clock,
            locale: 'en-US',
        })
    );
    assert.equal((repeated.match(/data-record-id="first"/g) ?? []).length, 2);
    assert.equal(typeof document, 'undefined');
});

async function fixture(
    t: TestContext,
    propsPatch: Partial<PortalCalendarProps> = {},
    hydrate = false,
    Component: typeof PortalCalendar = PortalCalendar
) {
    // Happy DOM 20 only decodes quote/amp entities in parsed attributes. The
    // hydration case must retain the real literal primary in title/ARIA names,
    // so use the existing standards HTML parser/DOM rather than rewriting
    // either the server markup, attributes, or the expected accessible name.
    const browserWindow = new Window();
    // One Node implementation also preserves React Aria's live-announcer
    // lifetime across mounts, as in one browser document.
    const parsed = new JSDOM('', { pretendToBeVisual: true });
    // JSDOM's parser is standards based, but its window omits CSS.escape.
    // Use the existing DOM harness's real CSS namespace, not a custom escape.
    Object.defineProperty(parsed.window, 'CSS', {
        configurable: true,
        value: browserWindow.CSS,
    });
    const window = parsed.window as unknown as Window;
    const keys = [
        'window',
        'document',
        'navigator',
        'Window',
        'Document',
        'DocumentFragment',
        'Node',
        'NodeFilter',
        'Element',
        'HTMLElement',
        'SVGElement',
        'ShadowRoot',
        'Event',
        'CustomEvent',
        'CSS',
        'MouseEvent',
        'PointerEvent',
        'KeyboardEvent',
        'FocusEvent',
        'HTMLInputElement',
        'HTMLButtonElement',
        'HTMLSelectElement',
        'HTMLTextAreaElement',
        'HTMLAnchorElement',
        'MutationObserver',
        'ResizeObserver',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'getComputedStyle',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const descriptors = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys) {
        const value =
            key === 'IS_REACT_ACT_ENVIRONMENT'
                ? true
                : key === 'Window'
                  ? parsed
                      ? parsed.window.Window
                      : Window
                  : key === 'requestAnimationFrame'
                    ? window.requestAnimationFrame.bind(window)
                    : key === 'cancelAnimationFrame'
                      ? window.cancelAnimationFrame.bind(window)
                      : key === 'getComputedStyle'
                        ? window.getComputedStyle.bind(window)
                        : window[key as keyof Window];
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    }
    const native = host();
    let props: PortalCalendarProps = {
        frame: native.frame(),
        isWide: false,
        clock,
        locale: 'en-US',
        ...propsPatch,
    };
    const view = () => h(StrictMode, null, h(Component, props));
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const errors: unknown[] = [];
    if (hydrate) container.innerHTML = renderToString(view());
    const serverTable = container.querySelector('table');
    const { createRoot, hydrateRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');
    let root: Root;
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
        parsed.window.close();
        await browserWindow.happyDOM.close();
    });
    await act(async () => {
        root = hydrate
            ? hydrateRoot(container as unknown as HTMLElement, view(), {
                  onRecoverableError: (error) => errors.push(error),
              })
            : createRoot(container as unknown as HTMLElement);
        if (!hydrate) root.render(view());
    });
    const button = (name: string) => {
        const node = [...container.querySelectorAll('button')].find(
            (candidate) => candidate.getAttribute('aria-label') === name
        );
        assert.ok(node, `Expected button ${name}`);
        return node;
    };
    const click = async (
        node: NonNullable<ReturnType<typeof container.querySelector>>
    ) => {
        await act(async () => {
            node.dispatchEvent(
                new window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    detail: 0,
                })
            );
        });
    };
    return {
        native,
        container,
        errors,
        serverTable,
        button,
        click,
        unmount,
        async update(patch: Partial<PortalCalendarProps>) {
            props = { ...props, ...patch };
            await act(async () => root.render(view()));
        },
        updateSync(patch: Partial<PortalCalendarProps>) {
            props = { ...props, ...patch };
            flushSync(() => root.render(view()));
        },
    };
}

it('StrictMode hydration remains actionable and responsive presentation preserves day without reads or relationship writes', async (t) => {
    const f = await fixture(t, {}, true);
    assert.deepEqual(f.errors, []);
    assert.equal(f.container.querySelector('table'), f.serverTable);
    assert.deepEqual(f.native.state.events, []);
    await f.click(f.button('Open record: <b>Literal first</b>'));
    assert.deepEqual(f.native.state.events, [
        ['open', 'first', { shouldShowToTheSide: false }],
    ]);
    await f.update({ isWide: true });
    await f.click(f.button('Open record: Second'));
    assert.deepEqual(f.native.state.events[1], [
        'open',
        'second',
        { shouldShowToTheSide: true },
    ]);
    await f.update({ isWide: false });
    assert.ok(f.container.querySelector('[data-record-id="first"]'));
    assert.equal(f.container.querySelector('[data-record-id="second"]'), null);
    const nextDay = f.container.querySelector(
        '[data-date="2026-02-13"] .mx-sdk-calendar__day'
    );
    assert.ok(nextDay);
    await f.click(nextDay);
    assert.equal(f.container.querySelector('[data-record-id="first"]'), null);
    assert.ok(f.container.querySelector('[data-record-id="second"]'));
    assert.equal(f.native.state.events.length, 2);
    await f.click(f.button('Remove record: Second'));
    assert.deepEqual(f.native.state.events[2], ['remove', 'second']);
    assert.ok(
        f.container.querySelector('[data-record-id="second"]'),
        'Only a new accepted native frame removes a record from presentation'
    );
});

it('a stable native month control continues its forced read after exact display admission retires', async (t) => {
    const f = await fixture(t);
    f.native.state.retireDisplayOnRetain = true;
    await f.click(f.button('Next'));
    assert.equal(f.native.state.events.length, 2);
    assert.deepEqual(f.native.state.events[0], ['retain', '2026-03']);
    assert.deepEqual(f.native.state.events[1], [
        'read',
        { type: 'firstPage', onlyFetchIfNotAlreadyFetched: false },
    ]);
    assert.match(
        f.container.querySelector('h2')?.textContent ?? '',
        /March 2026/
    );
    assert.equal(f.container.querySelector('[data-record-id]'), null);
    assert.doesNotMatch(
        f.container.textContent ?? '',
        /Literal first|First subtitle/
    );
});

it('a synchronous same-control React display publication during retain preserves the ordered forced read and paints its admitted selected day', async (t) => {
    const f = await fixture(t);
    const replacement: PortalCalendarRecord = {
        ...records[0],
        fields: { date: '2026-03-12' },
        display: { status: 'present', primary: 'March replacement' },
    };
    f.native.state.onRetain = () => {
        f.native.state.onRetain = undefined;
        f.updateSync({
            frame: f.native.frame({ records: [replacement] }),
        });
    };
    await f.click(f.button('Next'));
    assert.deepEqual(f.native.state.events, [
        ['retain', '2026-03'],
        ['read', { type: 'firstPage', onlyFetchIfNotAlreadyFetched: false }],
    ]);
    assert.match(
        f.container.querySelector('h2')?.textContent ?? '',
        /March 2026/
    );
    const selected = f.container.querySelector(
        '[data-date="2026-03-12"] .mx-sdk-calendar__day'
    );
    assert.ok(selected);
    assert.equal(selected.getAttribute('data-selected'), 'true');
    assert.equal(selected.getAttribute('tabindex'), '0');
    assert.match(f.container.textContent ?? '', /March replacement/);
    assert.doesNotMatch(
        f.container.textContent ?? '',
        /Literal first|First subtitle/
    );
});

it('synchronous control ABA during month retention retires the old read and local focus despite a reused owner', async (t) => {
    const f = await fixture(t);
    const a = f.native.control;
    const b = { ...a };
    f.native.state.onRetain = () => {
        f.native.state.onRetain = undefined;
        for (const control of [b, a])
            f.updateSync({
                frame: f.native.frame({
                    control,
                    retainedMonth: '2026-03',
                    records: [],
                    recordActions: [],
                }),
            });
    };
    await f.click(f.button('Next'));
    assert.deepEqual(f.native.state.events, [['retain', '2026-03']]);
    assert.equal(f.native.state.retainedMonth, '2026-03');
    assert.match(
        f.container.querySelector('h2')?.textContent ?? '',
        /February 2026/
    );
    const unchanged = f.container.querySelector(
        '[data-date="2026-02-12"] .mx-sdk-calendar__day'
    );
    assert.ok(unchanged);
    assert.equal(unchanged.getAttribute('data-selected'), 'true');
    assert.equal(unchanged.getAttribute('tabindex'), '0');
    assert.equal(f.container.querySelector('[data-record-id]'), null);
});

it('an already admitted read cannot publish an old local focus after synchronous control ABA with the same owner', async (t) => {
    const f = await fixture(t);
    const a = f.native.control;
    const b = { ...a };
    f.native.state.onRead = () => {
        f.native.state.onRead = undefined;
        for (const control of [b, a])
            f.updateSync({
                frame: f.native.frame({
                    control,
                    retainedMonth: '2026-03',
                    records: [],
                    recordActions: [],
                }),
            });
    };
    await f.click(f.button('Next'));
    assert.deepEqual(f.native.state.events, [
        ['retain', '2026-03'],
        ['read', { type: 'firstPage', onlyFetchIfNotAlreadyFetched: false }],
    ]);
    assert.match(
        f.container.querySelector('h2')?.textContent ?? '',
        /February 2026/
    );
    const unchanged = f.container.querySelector(
        '[data-date="2026-02-12"] .mx-sdk-calendar__day'
    );
    assert.ok(unchanged);
    assert.equal(unchanged.getAttribute('data-selected'), 'true');
    assert.equal(unchanged.getAttribute('tabindex'), '0');
    assert.equal(f.container.querySelector('[data-record-id]'), null);
});

it('record action admission rejects a synchronous presentation replacement before the captured native open', async (t) => {
    const f = await fixture(t);
    const open = f.button('Open record: <b>Literal first</b>');
    f.native.state.beforePresentationRead = () => {
        f.native.state.beforePresentationRead = undefined;
        f.updateSync({
            frame: f.native.frame({
                records: [],
                recordActions: [],
            }),
        });
    };
    await f.click(open);
    assert.deepEqual(f.native.state.events, []);
    assert.equal(f.container.querySelector('[data-record-id]'), null);
});

it('metadata repair, current action grants and explicit paging never recover hidden records or issue mount reads', async (t) => {
    const f = await fixture(t);
    await f.update({
        frame: f.native.frame({ dateField: null, recordActions: [] }),
    });
    assert.equal(f.container.querySelector('[data-record-id]'), null);
    await f.update({
        frame: f.native.frame({
            recordActions: [],
            hasMore: true,
            loadMore() {
                f.native.state.events.push(['more']);
                return { type: 'admitted' };
            },
        }),
    });
    assert.ok(f.container.querySelector('[data-record-id="first"]'));
    assert.equal(
        f.container.querySelector('.mx-sdk-portal-calendar__open'),
        null
    );
    assert.equal(
        f.container.querySelector('.mx-sdk-portal-calendar__remove'),
        null
    );
    assert.deepEqual(f.native.state.events, []);
    const more = f.container.querySelector('.mx-sdk-portal-calendar__more');
    assert.ok(more);
    await f.click(more);
    assert.deepEqual(f.native.state.events, [['more']]);
    await f.update({
        frame: f.native.frame({
            records: [],
            recordActions: [],
            status: 'error',
            errorMessage: 'Accepted native error',
        }),
    });
    assert.match(
        f.container.querySelector('[role="alert"]')?.textContent ?? '',
        /Accepted native error/
    );
    assert.doesNotMatch(
        f.container.textContent ?? '',
        /Literal first|First subtitle/
    );
    await f.unmount();
    assert.equal(f.container.childNodes.length, 0);
    assert.deepEqual(f.native.state.events, [['more']]);
});

it('pending or removed paging capability never dispatches a retained More control', async (t) => {
    const f = await fixture(t);
    const loadMore = () => {
        f.native.state.events.push(['more']);
        return { type: 'admitted' } as const;
    };
    await f.update({
        frame: f.native.frame({ hasMore: true, isLoadingMore: true, loadMore }),
    });
    const pending = f.container.querySelector('.mx-sdk-portal-calendar__more');
    assert.ok(pending);
    assert.equal(pending.getAttribute('disabled'), '');
    await f.click(pending);
    assert.deepEqual(f.native.state.events, []);
    await f.update({
        frame: f.native.frame({ hasMore: false, loadMore }),
    });
    assert.equal(
        f.container.querySelector('.mx-sdk-portal-calendar__more'),
        null
    );
    await f.update({
        frame: f.native.frame({ hasMore: true, loadMore: undefined }),
    });
    assert.equal(
        f.container.querySelector('.mx-sdk-portal-calendar__more'),
        null
    );
    assert.deepEqual(f.native.state.events, []);
});

it('committed visible membership survives registration-driven wrapper renders and retires across narrow day and width ABA', async (t) => {
    const native = host();
    const admittedRecords = [
        ...records,
        records[0],
        {
            ...records[0],
            id: 'outside-month',
            fields: { date: '2026-01-31' },
        },
        { ...records[0], id: 'invalid-date', fields: { date: 'not-a-date' } },
    ];
    const frame = native.frame({ records: admittedRecords });
    const publications: PortalCalendarVisibleRecords[] = [];
    const disposals: PortalCalendarVisibleRecords[] = [];
    function Host(props: PortalCalendarProps) {
        const [visible, setVisible] =
            useState<PortalCalendarVisibleRecords | null>(null);
        const registerVisibleRecords = useCallback(
            (presentation: PortalCalendarVisibleRecords) => {
                assert.equal(presentation.isCurrent(), true);
                assert.equal(Object.isFrozen(presentation), true);
                assert.equal(Object.isFrozen(presentation.recordIds), true);
                assert.deepEqual(presentation.recordIds, [
                    ...new Set(
                        [...document.querySelectorAll('[data-record-id]')].map(
                            (node) => node.getAttribute('data-record-id')
                        )
                    ),
                ]);
                publications.push(presentation);
                assert.ok(publications.length < 12, 'registration must settle');
                setVisible(presentation);
                return () => {
                    assert.equal(presentation.isCurrent(), false);
                    disposals.push(presentation);
                    setVisible((current) =>
                        current === presentation ? null : current
                    );
                };
            },
            []
        );
        return h(
            'div',
            { 'data-visible-records': visible?.recordIds.join(',') ?? '' },
            h(PortalCalendar, {
                ...props,
                frame: {
                    ...props.frame,
                    presentationOwner: { ...props.frame.presentationOwner },
                    recordActions: props.frame.recordActions.map((actions) => ({
                        ...actions,
                    })),
                },
                registerVisibleRecords,
            })
        );
    }
    const f = await fixture(t, { frame }, false, Host);
    const latest = () => publications[publications.length - 1]!;
    assert.ok(
        publications.length >= 2,
        'StrictMode creates fresh publications'
    );
    assert.equal(publications[0]!.isCurrent(), false);
    assert.deepEqual(latest().recordIds, ['first']);
    const first = latest();
    const settled = publications.length;
    await f.update({
        frame: { ...frame, recordActions: [...frame.recordActions] },
    });
    assert.equal(publications.length, settled);
    assert.equal(first.isCurrent(), true);
    const day = (value: string) => {
        const node = f.container.querySelector(
            `[data-date="${value}"] .mx-sdk-calendar__day`
        );
        assert.ok(node);
        return node;
    };
    await f.click(day('2026-02-13'));
    assert.equal(first.isCurrent(), false);
    assert.deepEqual(latest().recordIds, ['second']);
    const second = latest();
    await f.click(day('2026-02-12'));
    assert.equal(second.isCurrent(), false);
    assert.equal(first.isCurrent(), false);
    assert.deepEqual(latest().recordIds, ['first']);
    const narrow = latest();
    await f.update({ isWide: true });
    assert.equal(narrow.isCurrent(), false);
    assert.deepEqual(latest().recordIds, ['first', 'second']);
    assert.equal(
        f.container.querySelector('[data-record-id="outside-month"]'),
        null
    );
    assert.equal(
        f.container.querySelector('[data-record-id="invalid-date"]'),
        null
    );
    const wide = latest();
    await f.update({ isWide: false });
    assert.equal(wide.isCurrent(), false);
    assert.equal(narrow.isCurrent(), false);
    assert.deepEqual(latest().recordIds, ['first']);
    assert.deepEqual(native.state.events, []);
    await f.unmount();
    assert.equal(
        publications.every((value) => !value.isCurrent()),
        true
    );
    assert.deepEqual(disposals, publications);
});

it('visible descriptors permanently retire for committed data, schema, status, control and presentation replacement', async (t) => {
    const native = host();
    const frame = native.frame();
    const publications: PortalCalendarVisibleRecords[] = [];
    const disposed: PortalCalendarVisibleRecords[] = [];
    const registerVisibleRecords = (value: PortalCalendarVisibleRecords) => {
        publications.push(value);
        return () => {
            assert.equal(value.isCurrent(), false);
            disposed.push(value);
        };
    };
    const f = await fixture(t, { frame, registerVisibleRecords });
    const latest = () => publications[publications.length - 1]!;
    const replace = async (next: PortalCalendarAcceptedFrame) => {
        const held = latest();
        await f.update({ frame: next });
        assert.equal(held.isCurrent(), false);
        assert.ok(disposed.includes(held));
        assert.notEqual(latest(), held);
        assert.equal(latest().isCurrent(), true);
        return held;
    };
    const initial = latest();
    await replace({ ...frame, status: 'loading' });
    assert.deepEqual(
        latest().recordIds,
        ['first'],
        'retained cards remain visible'
    );
    await replace(frame);
    assert.equal(
        initial.isCurrent(),
        false,
        'status ABA cannot revive a lease'
    );
    await replace({ ...frame, dateField: null });
    assert.deepEqual(latest().recordIds, []);
    await replace(frame);
    await replace({ ...frame, dateField: { ...field } });
    await replace(frame);
    const changedRecords = records.map((record) => ({
        ...record,
        display: { status: 'present', primary: 'Replacement' } as const,
    }));
    await replace({ ...frame, records: changedRecords });
    assert.match(f.container.textContent ?? '', /Replacement/);
    await replace(frame);
    const beforeControl = latest();
    await replace({ ...frame, control: { ...frame.control } });
    await replace(frame);
    assert.equal(beforeControl.isCurrent(), false, 'control ABA cannot revive');
    const newPresentation = native.frame();
    await replace(newPresentation);
    const observed = latest();
    native.state.current = false;
    assert.equal(observed.isCurrent(), false);
    native.state.current = true;
    assert.equal(observed.isCurrent(), false, 'a failed guard is permanent');
    await f.update({ frame: { ...newPresentation } });
    assert.notEqual(latest(), observed);
    assert.equal(latest().isCurrent(), true);
    const removed = latest();
    await f.update({ registerVisibleRecords: undefined });
    assert.equal(removed.isCurrent(), false);
    assert.ok(disposed.includes(removed));
    assert.deepEqual(native.state.events, []);
});

it('a visibility currentness read rejects a synchronous replacement and never borrows its successor membership', async (t) => {
    const native = host();
    const publications: PortalCalendarVisibleRecords[] = [];
    const f = await fixture(t, {
        frame: native.frame(),
        registerVisibleRecords(value) {
            publications.push(value);
            return () => assert.equal(value.isCurrent(), false);
        },
    });
    const held = publications[publications.length - 1]!;
    native.state.beforePresentationRead = () => {
        native.state.beforePresentationRead = undefined;
        f.updateSync({
            frame: native.frame({ records: [], recordActions: [] }),
        });
    };
    await act(async () => assert.equal(held.isCurrent(), false));
    const successor = publications[publications.length - 1]!;
    assert.notEqual(successor, held);
    assert.deepEqual(successor.recordIds, []);
    assert.equal(successor.isCurrent(), true);
    assert.equal(held.isCurrent(), false);
    assert.deepEqual(native.state.events, []);
});

it('equivalent synchronous wrapper guard refresh keeps a descriptor current and bounds an unsettled observation', async (t) => {
    const native = host();
    const frame = native.frame();
    const publications: PortalCalendarVisibleRecords[] = [];
    const f = await fixture(t, {
        frame,
        registerVisibleRecords(value) {
            publications.push(value);
            return () => assert.equal(value.isCurrent(), false);
        },
    });
    const held = publications[publications.length - 1]!;
    const count = publications.length;
    const equivalentFrame = () => ({
        ...frame,
        presentationOwner: { ...frame.presentationOwner },
        recordActions: frame.recordActions.map((actions) => ({ ...actions })),
    });
    native.state.beforePresentationRead = () => {
        native.state.beforePresentationRead = undefined;
        f.updateSync({ frame: equivalentFrame() });
    };
    await act(async () => assert.equal(held.isCurrent(), true));
    assert.equal(publications.length, count);
    assert.equal(publications[publications.length - 1], held);
    assert.equal(held.isCurrent(), true);
    let reentries = 0;
    const unsettled = () => {
        native.state.beforePresentationRead = undefined;
        reentries++;
        f.updateSync({ frame: equivalentFrame() });
        native.state.beforePresentationRead = unsettled;
    };
    await act(async () => {
        native.state.beforePresentationRead = unsettled;
        assert.equal(held.isCurrent(), false);
        native.state.beforePresentationRead = undefined;
    });
    assert.ok(
        reentries > 0 && reentries <= 2,
        'an unsettled read must terminate'
    );
    assert.equal(held.isCurrent(), false);
    const successor = publications[publications.length - 1]!;
    assert.notEqual(successor, held);
    assert.equal(successor.isCurrent(), true);
    assert.deepEqual(native.state.events, []);
});

it('wide visibility follows actual mounted locale-calendar cards, including inherited child-only locale updates', async (t) => {
    const native = host();
    const spanningRecords: PortalCalendarRecord[] = Array.from(
        { length: 90 },
        (_, index) => {
            const date = new Date(Date.UTC(2026, 0, index + 1))
                .toISOString()
                .slice(0, 10);
            return {
                id: date,
                fields: { date },
                display: { status: 'present', primary: date },
            };
        }
    );
    const publications: PortalCalendarVisibleRecords[] = [];
    const StablePortal = memo(PortalCalendar);
    let setLocale: (locale: string) => void = () =>
        assert.fail('unmounted locale host');
    function LocaleHost(props: PortalCalendarProps) {
        const [locale, updateLocale] = useState('en-US');
        setLocale = updateLocale;
        return h(I18nProvider, {
            locale,
            children: h(StablePortal, props),
        });
    }
    const f = await fixture(
        t,
        {
            frame: native.frame({
                records: spanningRecords,
                recordActions: [],
            }),
            isWide: true,
            locale: undefined,
            registerVisibleRecords(value) {
                publications.push(value);
                return () => assert.equal(value.isCurrent(), false);
            },
        },
        false,
        LocaleHost
    );
    const gregorian = publications[publications.length - 1]!;
    for (const locale of [
        'en-US-u-ca-islamic-umalqura',
        'ar-SA-u-ca-islamic-umalqura',
    ]) {
        await act(async () => setLocale(locale));
        const current = publications[publications.length - 1]!;
        const mounted = [
            ...f.container.querySelectorAll('article[data-record-id]'),
        ].map((node) => node.getAttribute('data-record-id')!);
        assert.equal(current.isCurrent(), true);
        assert.deepEqual(
            [...current.recordIds].sort(),
            [...new Set(mounted)].sort()
        );
        assert.ok(
            new Set(mounted.map((id) => id.slice(0, 7))).size > 1,
            `${locale} displays one real calendar month spanning ISO months: ${JSON.stringify(mounted)}; ${f.container.querySelector('h2')?.textContent}`
        );
    }
    assert.equal(gregorian.isCurrent(), false);
    assert.deepEqual(
        native.state.events,
        [],
        'locale changes do not allocate query reads'
    );
    await f.click(f.button('Next'));
    const next = publications[publications.length - 1]!;
    assert.deepEqual(
        [...next.recordIds].sort(),
        [
            ...new Set(
                [
                    ...f.container.querySelectorAll('article[data-record-id]'),
                ].map((node) => node.getAttribute('data-record-id')!)
            ),
        ].sort()
    );
    assert.equal(next.isCurrent(), true);
    await f.unmount();
    assert.equal(
        publications.every((value) => !value.isCurrent()),
        true
    );
});
