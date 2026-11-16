import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import type { Root } from 'react-dom/client';
import {
    CalendarMonthGrid,
    type CalendarMonthGridProps,
} from '../src/react/CalendarMonthGrid.js';

const defaults: CalendarMonthGridProps = {
    surface: 'picker',
    selectedDay: '2026-02-12',
    localToday: { year: 2026, month: 2, day: 11 },
    locale: 'en-US',
    onDayChange() {},
    onFocusChange() {},
};

it('SSR renders six picker weeks and native variable Portal weeks with explicit local highlight', () => {
    assert.equal(typeof document, 'undefined');
    let intents = 0;
    const props = {
        ...defaults,
        onDayChange() {
            intents++;
        },
        onFocusChange() {
            intents++;
        },
    };
    const picker = renderToString(h(CalendarMonthGrid, props));
    const portal = renderToString(
        h(CalendarMonthGrid, { ...props, surface: 'portal' })
    );
    const rows = (html: string) =>
        html.split('<tbody>')[1].split('</tbody>')[0].match(/<tr/g)?.length;
    assert.equal(rows(picker), 6);
    assert.equal(rows(portal), 4);
    assert.match(picker, /data-date="2026-02-11"/);
    assert.equal((picker.match(/data-today="true"/g) ?? []).length, 1);
    assert.equal((picker.match(/data-selected="true"/g) ?? []).length, 1);
    assert.match(picker, /aria-label="Previous"/);
    assert.match(picker, /aria-label="Next"/);
    assert.equal(intents, 0);
    assert.equal(typeof document, 'undefined');
});

async function fixture(
    t: TestContext,
    patch: Partial<CalendarMonthGridProps> = {},
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
    const previous = keys.map((key) =>
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
    const days: string[] = [];
    const focuses: string[] = [];
    const hydrationErrors: unknown[] = [];
    let props: CalendarMonthGridProps = {
        ...defaults,
        onDayChange(day) {
            days.push(day);
            props = { ...props, selectedDay: day };
            root.render(view());
        },
        onFocusChange(day) {
            focuses.push(day);
        },
        ...patch,
    };
    const view = () => h(StrictMode, null, h(CalendarMonthGrid, props));
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const { createRoot, hydrateRoot } = await import('react-dom/client');
    if (hydrate) container.innerHTML = renderToString(view());
    const serverTable = container.querySelector('table');
    let root: Root;
    let mounted = true;
    const render = async () => {
        await act(async () => root.render(view()));
    };
    const unmount = async () => {
        if (!mounted) return;
        mounted = false;
        await act(async () => root.unmount());
    };
    t.after(async () => {
        await unmount();
        keys.forEach((key, index) => {
            const descriptor = previous[index];
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    await act(async () => {
        root = hydrate
            ? hydrateRoot(container as unknown as HTMLElement, view(), {
                  onRecoverableError: (error) => hydrationErrors.push(error),
              })
            : createRoot(container as unknown as HTMLElement);
        if (!hydrate) root.render(view());
    });
    const cell = (date: string) => {
        const node = container.querySelector(`[data-date="${date}"]`);
        assert.ok(node, `Expected ${date} in the grid`);
        return node;
    };
    const day = (date: string) => {
        const node = cell(date).querySelector('.mx-sdk-calendar__day');
        assert.ok(node, `Expected ${date} day control`);
        return node;
    };
    const click = async (node: ReturnType<typeof day>) => {
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
        window,
        container,
        days,
        focuses,
        hydrationErrors,
        serverTable,
        cell,
        day,
        click,
        unmount,
        async update(next: Partial<CalendarMonthGridProps>) {
            props = { ...props, ...next };
            await render();
        },
    };
}

it('picker forwards real selection/focus controls, six weeks, capped badges and localized navigation', async (t) => {
    const f = await fixture(t, {
        eventCounts: { '2026-02-13': 12 },
        labels: { calendar: 'Dates', previous: 'Précédent', next: 'Suivant' },
    });
    assert.equal(f.container.querySelectorAll('tbody tr').length, 6);
    assert.equal(
        f.cell('2026-02-13').querySelector('.mx-sdk-calendar__badge')
            ?.textContent,
        '9+'
    );
    assert.equal(f.day('2026-02-12').getAttribute('tabindex'), '0');
    assert.equal(f.day('2026-02-11').getAttribute('data-today'), 'true');
    assert.equal(f.day('2026-02-12').getAttribute('data-today'), 'false');
    assert.equal(f.days.length, 0);
    await f.click(f.day('2026-02-13'));
    assert.deepEqual(f.days, ['2026-02-13']);
    assert.equal(f.day('2026-02-13').getAttribute('data-selected'), 'true');
    const next = f.container.querySelector('button[aria-label="Suivant"]');
    assert.ok(next);
    await f.click(next);
    assert.equal(
        f.focuses.filter((day) => day.startsWith('2026-03')).length,
        1
    );
    assert.match(
        f.container.querySelector('h2')?.textContent ?? '',
        /March 2026/
    );
    assert.deepEqual(f.days, ['2026-02-13']);
});

it('Portal renders blank outside days and retains selected day across narrow/wide/narrow with zero extra intents', async (t) => {
    let cardActions = 0;
    const f = await fixture(t, {
        surface: 'portal',
        selectedDay: '2026-05-12',
        eventCounts: { '2026-05-12': 2 },
        labels: { events: 'événements' },
        dayContent: {
            '2026-05-12': h(
                'button',
                { type: 'button', onClick: () => cardActions++ },
                'Wide SDK card composition'
            ),
        },
        selectedDayContent: h('p', null, 'Narrow SDK card composition'),
    });
    assert.equal(f.container.querySelectorAll('tbody tr').length, 6);
    assert.equal(f.cell('2026-04-30').childNodes.length, 0);
    assert.equal(
        f.cell('2026-05-12').querySelectorAll('.mx-sdk-calendar__dot').length,
        2
    );
    assert.match(f.cell('2026-05-12').textContent ?? '', /2 événements/);
    assert.equal(f.day('2026-05-12').getAttribute('tabindex'), '0');
    const before = [...f.focuses];
    await f.update({ isWide: true });
    assert.equal(f.day('2026-05-12').getAttribute('tabindex'), null);
    assert.equal(f.day('2026-05-12').getAttribute('role'), null);
    assert.ok(f.day('2026-05-12').getAttribute('aria-label'));
    await f.click(f.day('2026-05-13'));
    assert.deepEqual(f.days, []);
    const card = f.cell('2026-05-12').querySelector('button');
    assert.ok(card);
    await f.click(card);
    assert.equal(cardActions, 1);
    assert.deepEqual(f.days, []);
    assert.deepEqual(f.focuses, before);
    await f.update({ isWide: false });
    assert.equal(f.day('2026-05-12').getAttribute('data-selected'), 'true');
    assert.match(
        f.container.querySelector('.mx-sdk-calendar__selected-day')
            ?.textContent ?? '',
        /Narrow SDK card/
    );
    assert.deepEqual(f.days, []);
    assert.deepEqual(f.focuses, before);
});

it('picker grid retains arrow navigation while Portal deliberately suppresses grid keydown', async (t) => {
    const f = await fixture(t, { selectedDay: '2026-02-12' });
    const arrow = async () => {
        await act(async () => {
            f.day('2026-02-12').dispatchEvent(
                new f.window.KeyboardEvent('keydown', {
                    key: 'ArrowRight',
                    bubbles: true,
                    cancelable: true,
                })
            );
        });
    };
    await arrow();
    assert.deepEqual(f.focuses, ['2026-02-13']);
    assert.deepEqual(f.days, []);
    await f.update({ surface: 'portal' });
    const before = [...f.focuses];
    await arrow();
    assert.deepEqual(f.focuses, before);
    assert.deepEqual(f.days, []);
});

it('hydrates actual controlled markup in StrictMode without replacing its table or emitting intents', async (t) => {
    const f = await fixture(t, { surface: 'portal', isWide: false }, true);
    assert.deepEqual(f.hydrationErrors, []);
    assert.equal(f.container.querySelector('table'), f.serverTable);
    assert.deepEqual(f.days, []);
    assert.deepEqual(f.focuses, []);
    await f.click(f.day('2026-02-14'));
    assert.deepEqual(f.days, ['2026-02-14']);
    assert.equal(f.day('2026-02-14').getAttribute('data-selected'), 'true');
    await f.unmount();
    assert.equal(f.container.childNodes.length, 0);
});
