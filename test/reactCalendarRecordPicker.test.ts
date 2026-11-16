import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import type { Root } from 'react-dom/client';
import type { RuntimeAirtableField } from '../src/runtime/types.js';
import type { CalendarClock } from '../src/ui/calendarController.js';
import {
    CalendarRecordPicker,
    type CalendarRecordPickerAcceptedFrame,
    type CalendarRecordPickerProps,
} from '../src/react/CalendarRecordPicker.js';

// Explicit synthetic borrowed host ports, not private accepted SDK provenance.
const clock: CalendarClock = {
    utcDay: () => '2026-02-12',
    localDay: () => '2026-02-11',
    localMonth: () => '2026-02',
    localToday: () => '2026-02-11',
    clientUtcOffset: () => -480,
};
const date: RuntimeAirtableField = {
    id: 'start',
    name: 'Start',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: {
        type: 'date',
        options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
    },
};
const records = [
    { id: 'first', fields: { start: '2026-02-12', end: '2026-02-12' } },
    { id: 'second', fields: { start: '2026-02-13', end: '2026-02-13' } },
];
function host() {
    const state = {
        current: true,
        presentation: {},
        events: [] as unknown[],
        refuseRead: false,
        refuseToggle: false,
    };
    const control = {
        owner: {},
        isCurrent: () => state.current,
        scheduleRead(request: unknown) {
            state.events.push(['read', request]);
            return state.refuseRead
                ? { type: 'refused' as const, reason: 'native-read-refused' }
                : { type: 'admitted' as const };
        },
    };
    const frame = (
        patch: Partial<CalendarRecordPickerAcceptedFrame> = {}
    ): CalendarRecordPickerAcceptedFrame => {
        const owner = {};
        state.presentation = owner;
        return {
            control,
            presentationOwner: {
                owner,
                isCurrent: () => state.presentation === owner,
            },
            records,
            startField: date,
            endField: { ...date, id: 'end', name: 'End' },
            selectedRecordIds: ['hidden-selected'],
            presentationByRecordId: {
                first: {
                    type: 'list',
                    primary: 'First event',
                    showPreviewFieldTitle: true,
                    details: [
                        {
                            key: 'detail',
                            title: 'Rich detail',
                            leaf: {
                                kind: 'literal',
                                text: '<b>Literal rich leaf</b>',
                            },
                        },
                    ],
                },
                second: {
                    type: 'calendar',
                    primary: 'Second event',
                    subtitle: 'Second subtitle',
                },
            },
            selectionEnabled: true,
            toggleRecord(recordId) {
                state.events.push(['toggle', recordId]);
                return state.refuseToggle
                    ? { type: 'refused', reason: 'native-limit' }
                    : { type: 'admitted' };
            },
            errorMessage: null,
            isLoading: false,
            isLoadingMore: false,
            canLoadMore: true,
            ...patch,
        };
    };
    return { state, control, frame };
}

it('picker SSR renders complete grid and shared rich leaves without reads, hidden-ID labels or canonical writes', () => {
    const native = host();
    assert.equal(typeof document, 'undefined');
    const html = renderToString(
        h(CalendarRecordPicker, {
            frame: native.frame(),
            clock,
            locale: 'en-US',
        })
    );
    assert.match(html, /role="listbox"/);
    assert.match(html, /First event/);
    assert.match(html, /Rich detail/);
    assert.match(html, /&lt;b&gt;Literal rich leaf&lt;\/b&gt;/);
    assert.doesNotMatch(html, /<b>|hidden-selected|Second subtitle/);
    assert.equal(
        (html.split('<tbody>')[1].split('</tbody>')[0].match(/<tr/g) ?? [])
            .length,
        6
    );
    assert.deepEqual(native.state.events, []);
    assert.equal(typeof document, 'undefined');
});

async function fixture(
    t: TestContext,
    patch: Partial<CalendarRecordPickerProps> = {},
    hydrate = false
) {
    const window = new Window();
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
                  ? Window
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
    let props: CalendarRecordPickerProps = {
        frame: native.frame(),
        clock,
        locale: 'en-US',
        ...patch,
    };
    const view = () => h(StrictMode, null, h(CalendarRecordPicker, props));
    const container = window.document.createElement('div');
    window.document.body.append(container);
    if (hydrate) container.innerHTML = renderToString(view());
    const serverTable = container.querySelector('table');
    const errors: unknown[] = [];
    const { createRoot, hydrateRoot } = await import('react-dom/client');
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
            const old = descriptors[index];
            if (old) Object.defineProperty(globalThis, key, old);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    await act(async () => {
        root = hydrate
            ? hydrateRoot(container as unknown as HTMLElement, view(), {
                  onRecoverableError: (error) => errors.push(error),
              })
            : createRoot(container as unknown as HTMLElement);
        if (!hydrate) root.render(view());
    });
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
    const option = () => {
        const node = container.querySelector('[role="option"]');
        assert.ok(node);
        return node;
    };
    const next = () => {
        const node = container.querySelector('button[aria-label="Next"]');
        assert.ok(node);
        return node;
    };
    return {
        native,
        container,
        errors,
        serverTable,
        click,
        option,
        next,
        unmount,
        async update(changes: Partial<CalendarRecordPickerProps>) {
            props = { ...props, ...changes };
            await act(async () => root.render(view()));
        },
    };
}

it('real listbox R30 retains off-day membership, invokes one native toggle and waits for the canonical echo', async (t) => {
    const f = await fixture(t, {}, true);
    assert.deepEqual(f.errors, []);
    assert.equal(f.container.querySelector('table'), f.serverTable);
    assert.deepEqual(f.native.state.events, []);
    await f.click(f.option());
    assert.deepEqual(f.native.state.events, [['toggle', 'first']]);
    assert.notEqual(f.option().getAttribute('aria-selected'), 'true');
    await f.update({
        frame: f.native.frame({
            selectedRecordIds: ['hidden-selected', 'first'],
        }),
    });
    assert.equal(f.option().getAttribute('aria-selected'), 'true');
    await f.click(f.option());
    assert.deepEqual(f.native.state.events[1], ['toggle', 'first']);
    const secondDay = f.container.querySelector(
        '[data-date="2026-02-13"] .mx-sdk-calendar__day'
    );
    assert.ok(secondDay);
    await f.click(secondDay);
    assert.match(f.option().textContent ?? '', /Second event/);
    assert.doesNotMatch(f.container.textContent ?? '', /Literal rich leaf/);
    assert.equal(
        f.native.state.events.length,
        2,
        'Day selection is neither a record write nor a query'
    );
    await f.click(f.option());
    assert.deepEqual(f.native.state.events[2], ['toggle', 'second']);
});

it('Calendar error precedes loading, metadata repair is immediate, and missing displays use no hidden fallback', async (t) => {
    const f = await fixture(t);
    assert.ok(f.container.querySelector('.mx-sdk-calendar__badge'));
    await f.update({
        frame: f.native.frame({
            errorMessage: 'Native Calendar error',
            isLoading: true,
        }),
    });
    assert.equal(
        f.container.querySelector('[role="alert"]')?.textContent,
        'Native Calendar error'
    );
    assert.equal(f.container.querySelector('[role="listbox"]'), null);
    assert.equal(f.container.querySelector('.mx-sdk-calendar__badge'), null);
    await f.update({ frame: f.native.frame({ startField: null }) });
    assert.equal(f.container.querySelector('[role="option"]'), null);
    await f.update({ frame: f.native.frame() });
    assert.match(f.option().textContent ?? '', /Literal rich leaf/);
    assert.ok(f.container.querySelector('.mx-sdk-calendar__badge'));
    await f.update({ frame: f.native.frame({ presentationByRecordId: {} }) });
    assert.match(f.option().textContent ?? '', /Record unavailable/);
    assert.doesNotMatch(
        f.container.textContent ?? '',
        /Literal rich leaf|Rich detail/
    );
    assert.deepEqual(f.native.state.events, []);
});

it('explicit More uses resetOffset false, admitted month focus reads once, and refusal leaves controlled focus in the old month', async (t) => {
    const f = await fixture(t);
    const more = f.container.querySelector('.mx-sdk-calendar-picker__more');
    assert.ok(more);
    await f.click(more);
    assert.deepEqual(f.native.state.events[0], [
        'read',
        { month: '2026-02', resetOffset: false, clientUtcOffset: -480 },
    ]);
    f.native.state.refuseRead = true;
    await f.click(f.next());
    assert.match(
        f.container.querySelector('h2')?.textContent ?? '',
        /February 2026/
    );
    assert.equal(f.native.state.events.length, 2);
    f.native.state.refuseRead = false;
    await f.click(f.next());
    assert.match(
        f.container.querySelector('h2')?.textContent ?? '',
        /March 2026/
    );
    assert.equal(f.native.state.events.length, 3);
    assert.deepEqual(f.native.state.events[2], [
        'read',
        { month: '2026-03', resetOffset: true, clientUtcOffset: -480 },
    ]);
    await f.update({ frame: f.native.frame({ isLoadingMore: true }) });
    const pending = f.container.querySelector('.mx-sdk-calendar-picker__more');
    assert.ok(pending);
    assert.equal(pending.getAttribute('disabled'), '');
    await f.click(pending);
    assert.equal(f.native.state.events.length, 3);
});

it('selection limits and retired display grants refuse without optimistic canonical changes', async (t) => {
    const f = await fixture(t);
    f.native.state.refuseToggle = true;
    await f.click(f.option());
    assert.deepEqual(f.native.state.events, [['toggle', 'first']]);
    assert.notEqual(f.option().getAttribute('aria-selected'), 'true');
    await f.update({ frame: f.native.frame({ selectionEnabled: false }) });
    await f.click(f.option());
    assert.equal(f.native.state.events.length, 1);
    f.native.state.presentation = {};
    await f.update({ labels: { unnamedRecord: 'Unnamed' } });
    assert.equal(f.container.querySelector('[role="option"]'), null);
    assert.doesNotMatch(
        f.container.textContent ?? '',
        /First event|Literal rich leaf/
    );
    assert.equal(f.native.state.events.length, 1);
});

it('a parent clock-object or locale presentation change never recenters the chosen local day or starts a query', async (t) => {
    const f = await fixture(t);
    const nextDay = f.container.querySelector(
        '[data-date="2026-02-13"] .mx-sdk-calendar__day'
    );
    assert.ok(nextDay);
    await f.click(nextDay);
    assert.match(f.option().textContent ?? '', /Second event/);
    await f.update({
        clock: {
            ...clock,
            utcDay: () => '2026-02-20',
            localDay: () => '2026-02-19',
            localToday: () => '2026-02-19',
        },
        locale: undefined,
    });
    assert.match(f.option().textContent ?? '', /Second event/);
    assert.equal(
        f.container
            .querySelector('[data-date="2026-02-13"] .mx-sdk-calendar__day')
            ?.getAttribute('data-selected'),
        'true'
    );
    assert.deepEqual(f.native.state.events, []);
});
