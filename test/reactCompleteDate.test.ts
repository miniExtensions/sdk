import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { execFileSync } from 'node:child_process';
import type { CompleteDateFieldProps } from '../src/react/CompleteDateField.js';

const iso = {
    type: 'date',
    options: { dateFormat: { format: 'YYYY-MM-DD' } },
} as const;
const datetime = {
    type: 'dateTime',
    options: {
        dateFormat: { format: 'YYYY-MM-DD' },
        timeFormat: { name: '24hour', format: 'HH:mm' },
        timeZone: 'UTC',
    },
} as const;

it('renders a complete native input without document, stylesheet, browser globals or a canonical write', () => {
    assert.equal(typeof document, 'undefined');
    // Server and browser execute in independent realms. Keep ReactDOM's client
    // feature detection out of a fabricated document-free -> browser transition.
    const html = execFileSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `
        import {createElement as h} from 'react';
        import {renderToString} from 'react-dom/server';
        import {CompleteDateField} from ${JSON.stringify(new URL('../src/react/CompleteDateField.js', import.meta.url).href)};
        let writes=0;
        console.log(renderToString(h(CompleteDateField, ${JSON.stringify({
            id: 'ssr',
            airtableDateConfig: datetime,
            value: '2024-07-01T10:30:12.345-04:00',
            language: 'en',
            title: 'Appointment',
            description: 'Synthetic help',
            error: 'Synthetic error',
            formId: 'native-form',
        }).slice(0, -1)},setValue(){writes++;}})));
        if(writes || typeof document !== 'undefined')throw Error('SSR side effect');
    `,
        ],
        { encoding: 'utf8' }
    );
    assert.match(html, /value="2024-07-01 14:30"/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-describedby="ssr-description ssr-error"/);
    assert.match(html, /form="native-form"/);
});

async function fixture(
    t: TestContext,
    overrides: Partial<CompleteDateFieldProps> = {}
) {
    const window = new Window();
    const globals = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'Node',
        'Element',
        'CustomEvent',
        'MutationObserver',
        'ResizeObserver',
        'getComputedStyle',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = globals.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of globals)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : key === 'getComputedStyle'
                      ? window.getComputedStyle.bind(window)
                      : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const { CompleteDateField } = await import(
        '../src/react/CompleteDateField.js'
    );
    const form = window.document.createElement('form');
    form.id = 'native-form';
    const container = window.document.createElement('div');
    form.append(container);
    window.document.body.append(form);
    const root = createRoot(container as unknown as HTMLElement);
    const writes: (string | null)[] = [];
    let submits = 0,
        active = true,
        mounted = true;
    let props: CompleteDateFieldProps = {
        id: 'date',
        sessionId: 'session',
        airtableDateConfig: iso,
        value: '2024-02-01',
        language: 'en',
        formId: 'native-form',
        title: 'Date',
        owner: { token: {}, isCurrent: () => active },
        setValue(value) {
            writes.push(value);
            props = { ...props, value };
            publish();
        },
        ...overrides,
    };
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    const publish = () => {
        if (mounted)
            root.render(h(StrictMode, null, h(CompleteDateField, props)));
    };
    const render = async (patch: Partial<CompleteDateFieldProps> = {}) => {
        props = { ...props, ...patch };
        await act(async () => publish());
    };
    const replace = (patch: Partial<CompleteDateFieldProps>) => {
        props = { ...props, ...patch };
        publish();
    };
    const input = () => {
        const node = container.querySelector('input');
        assert.ok(node);
        return node;
    };
    const edit = async (value: string) => {
        await act(async () => {
            Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )!.set!.call(input(), value);
            input().dispatchEvent(new window.Event('input', { bubbles: true }));
        });
    };
    const key = async (key: string, isComposing = false) => {
        const event = new window.KeyboardEvent('keydown', {
            key,
            isComposing,
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            input().dispatchEvent(event);
        });
        return event;
    };
    const blur = async () => {
        await act(async () => {
            input().dispatchEvent(
                new window.FocusEvent('focusout', { bubbles: true })
            );
        });
    };
    const open = async () => {
        await act(async () => {
            input().dispatchEvent(
                new window.FocusEvent('focusin', { bubbles: true })
            );
        });
    };
    const click = async (selector: string) => {
        const node = window.document.querySelector(selector);
        assert.ok(node instanceof window.HTMLElement, selector);
        await act(async () => {
            node.dispatchEvent(
                new window.MouseEvent('click', { bubbles: true })
            );
        });
    };
    t.after(async () => {
        mounted = false;
        await act(async () => root.unmount());
        assert.equal(
            submits,
            0,
            'Enter and picker edits cannot implicitly Save'
        );
        globals.forEach((key, index) => {
            const original = originals[index];
            if (original) Object.defineProperty(globalThis, key, original);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    await render();
    return {
        window,
        form,
        input,
        edit,
        key,
        blur,
        open,
        click,
        render,
        replace,
        writes,
        retire() {
            active = false;
        },
        props: () => props,
    };
}

for (const row of [
    { config: iso, typed: '2024-02-29', expected: '2024-02-29' },
    {
        config: datetime,
        typed: '2024-02-29 13:45',
        expected: '2024-02-29T13:45:00.000Z',
    },
    {
        config: {
            ...datetime,
            options: { ...datetime.options, timeZone: 'Africa/Asmara' },
        },
        typed: '2024-02-29 13:45',
        expected: '2024-02-29T10:45:00.000Z',
    },
    { config: iso, typed: '', expected: null },
])
    it(`commits native ${row.config.type} ${row.typed} through Enter, suppresses IME and never submits`, async (t) => {
        const f = await fixture(t, { airtableDateConfig: row.config });
        await f.edit(row.typed);
        assert.deepEqual(f.writes, []);
        assert.equal((await f.key('Enter', true)).defaultPrevented, true);
        assert.deepEqual(f.writes, []);
        assert.equal(f.input().value, row.typed);
        assert.equal((await f.key('Enter')).defaultPrevented, true);
        assert.deepEqual(f.writes, [row.expected]);
    });

it('recovers partial and invalid drafts on blur, while equivalent/cosmetic metadata preserves the same input and caret', async (t) => {
    const f = await fixture(t);
    const input = f.input();
    await f.edit('2024-02-');
    input.setSelectionRange(5, 5);
    await f.render({
        airtableDateConfig: {
            ...iso,
            options: { dateFormat: { ...iso.options.dateFormat } },
        },
        placeholder: 'New hint',
    });
    assert.equal(f.input(), input);
    assert.equal(input.value, '2024-02-');
    assert.equal(input.selectionStart, 5);
    assert.equal(input.selectionEnd, 5);
    await f.blur();
    assert.equal(input.value, '2024-02-01');
    assert.deepEqual(f.writes, []);
    await f.edit('2023-02-29');
    await f.blur();
    assert.equal(input.value, '2024-02-01');
    assert.deepEqual(f.writes, []);
});

for (const row of [
    {
        original: datetime,
        replacement: {
            ...datetime,
            options: { ...datetime.options, timeZone: 'America/New_York' },
        },
        value: '2024-07-01T14:30:00.000Z',
        display: '2024-07-01 10:30',
    },
    {
        original: datetime,
        replacement: {
            ...datetime,
            options: { ...datetime.options, timeFormat: { format: 'h:mma' } },
        },
        value: '2024-07-01T14:30:00.000Z',
        display: '2024-07-01 2:30pm',
    },
    {
        original: {
            type: 'date',
            options: { dateFormat: { format: 'M/D/YYYY' } },
        },
        replacement: {
            type: 'date',
            options: { dateFormat: { format: 'D/M/YYYY' } },
        },
        value: '2024-07-01',
        display: '1/7/2024',
    },
] satisfies {
    original: CompleteDateFieldProps['airtableDateConfig'];
    replacement: CompleteDateFieldProps['airtableDateConfig'];
    value: string;
    display: string;
}[])
    it(`resets drafts on semantic metadata replacement to ${row.display} without writing`, async (t) => {
        const f = await fixture(t, {
            airtableDateConfig: row.original,
            value: row.value,
        });
        const input = f.input();
        await f.edit('2024-07-02 08:15');
        await f.render({ airtableDateConfig: row.replacement });
        assert.equal(f.input(), input);
        assert.equal(input.value, row.display);
        assert.deepEqual(f.writes, []);
        await f.blur();
        assert.deepEqual(f.writes, [row.value]);
    });

it('preserves readonly existing out-of-range bytes and refuses commits after host retirement', async (t) => {
    const f = await fixture(t, {
        readOnly: true,
        dateRange: 'today or in the future',
    });
    assert.equal(f.input().value, '2024-02-01');
    assert.equal(f.input().disabled, true);
    await f.key('Enter');
    await f.blur();
    assert.deepEqual(f.writes, []);
    await f.render({ readOnly: false });
    await f.edit('2024-02-02');
    f.retire();
    await f.key('Enter');
    await f.blur();
    assert.deepEqual(f.writes, []);
});

it('uses the current committed writer for same-owner cosmetic updates', async (t) => {
    const f = await fixture(t);
    const old = f.props().setValue;
    const writes: (string | null)[] = [];
    await f.edit('2024-02-29');
    await f.render({
        setValue(value) {
            writes.push(value);
        },
    });
    await f.key('Enter');
    assert.deepEqual(f.writes, []);
    assert.deepEqual(writes, ['2024-02-29']);
    assert.notEqual(f.props().setValue, old);
});

it('refuses an edit when checking the host owner synchronously commits a replacement', async (t) => {
    const f = await fixture(t);
    const { flushSync } = await import('react-dom');
    let replaceOwner = false;
    const successorWrites: (string | null)[] = [];
    await f.render({
        owner: {
            token: f.props().owner?.token,
            isCurrent() {
                if (replaceOwner) {
                    replaceOwner = false;
                    flushSync(() =>
                        f.replace({
                            owner: { token: {}, isCurrent: () => true },
                            value: '2024-03-15',
                            setValue(value) {
                                successorWrites.push(value);
                            },
                        })
                    );
                }
                return true;
            },
        },
    });
    await f.edit('2024-02-29');
    replaceOwner = true;
    await f.key('Enter');
    assert.deepEqual(f.writes, []);
    assert.deepEqual(successorWrites, []);
    assert.equal(f.input().value, '2024-03-15');
    await f.edit('2024-03-16');
    await f.key('Enter');
    assert.deepEqual(successorWrites, ['2024-03-16']);
});

for (const [language, month] of [
    ['fr', 'février'],
    ['zh-Hans', '二月'],
] as const)
    it(`ships the actual ${language} calendar locale without a host locale import`, async (t) => {
        const f = await fixture(t, { language });
        await f.open();
        const heading = f.window.document.querySelector('.rdtDays .rdtSwitch');
        assert.ok(heading?.textContent.includes(month));
        assert.equal(f.input().value, '2024-02-01');
        assert.deepEqual(f.writes, []);
    });

for (const year of [2024, 2025])
    it(`selects January 31 from February 1 in the actual fork calendar (${year})`, async (t) => {
        const f = await fixture(t, { value: `${year}-02-01` });
        await f.open();
        assert.equal(f.input().getAttribute('aria-expanded'), 'true');
        await f.click('.rdtOld[data-value="31"]');
        assert.deepEqual(f.writes, [`${year}-01-31`]);
        assert.equal(f.input().getAttribute('aria-expanded'), 'false');
        await f.open();
        assert.equal(f.input().getAttribute('aria-expanded'), 'true');
        await f.click('.rdtNext');
        await f.click('.rdtPrev');
        assert.deepEqual(f.writes, [`${year}-01-31`]);
    });

it('owns focused-popup Escape, restores input focus and removes its listener on close', async (t) => {
    const f = await fixture(t);
    await f.open();
    const popup = f.window.document.getElementById(
        f.input().getAttribute('aria-controls')!
    );
    assert.ok(popup instanceof f.window.HTMLElement);
    await act(async () => popup.focus());
    const cancelledEscape = new f.window.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
    });
    // An earlier application handler can already own this keyboard event.
    cancelledEscape.preventDefault();
    await act(async () => popup.dispatchEvent(cancelledEscape));
    assert.equal(
        cancelledEscape.defaultPrevented,
        true,
        'A prior Escape cancellation remains respected'
    );
    assert.equal(f.input().getAttribute('aria-expanded'), 'true');
    const escape = new f.window.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
    });
    await act(async () => popup.dispatchEvent(escape));
    assert.equal(escape.defaultPrevented, true);
    assert.equal(f.input().getAttribute('aria-expanded'), 'false');
    assert.equal(f.window.document.activeElement, f.input());
    const later = await f.key('Escape');
    assert.equal(
        later.defaultPrevented,
        false,
        'Closed picker leaves later Escape to its owner'
    );
});

it('commits a blank DateTime day at midnight, edits real time counters and clears to null', async (t) => {
    const f = await fixture(t, { value: null, airtableDateConfig: datetime });
    await f.open();
    const day = f.window.document.querySelector(
        '.rdtDay:not(.rdtOld):not(.rdtNew)[data-value="15"]'
    );
    assert.ok(day);
    const date = `${day.getAttribute('data-year')}-${String(Number(day.getAttribute('data-month')) + 1).padStart(2, '0')}-15`;
    await f.click('.rdtDay:not(.rdtOld):not(.rdtNew)[data-value="15"]');
    assert.deepEqual(f.writes, [`${date}T00:00:00.000Z`]);
    assert.ok(f.window.document.querySelector('.rdtTime'));
    const increase = f.window.document.querySelector('.rdtCounter .rdtBtn');
    assert.ok(increase);
    await act(async () => {
        increase.dispatchEvent(
            new f.window.MouseEvent('mousedown', { bubbles: true })
        );
    });
    await act(async () => {
        f.window.document.body.dispatchEvent(
            new f.window.MouseEvent('mouseup', { bubbles: true })
        );
    });
    assert.equal(f.writes.at(-1), `${date}T01:00:00.000Z`);
    await f.edit('');
    await f.blur();
    assert.equal(f.writes.at(-1), null);
});

it('navigates actual year/month controls without an early commit and can interrupt and reopen in days', async (t) => {
    const f = await fixture(t, { value: '2025-02-01' });
    await f.open();
    await f.click('.rdtDays .rdtSwitch');
    await f.click('.rdtMonths .rdtSwitch');
    assert.deepEqual(f.writes, []);
    await f.click('.rdtYear[data-value="2024"]');
    await f.click('.rdtMonth[data-value="0"]');
    assert.deepEqual(f.writes, []);
    await f.click('.rdtDay:not(.rdtOld):not(.rdtNew)[data-value="31"]');
    assert.deepEqual(f.writes, ['2024-01-31']);
    await f.open();
    await f.click('.rdtDays .rdtSwitch');
    await f.render({ sessionId: 'replacement', value: '2025-02-01' });
    assert.equal(f.input().getAttribute('aria-expanded'), 'false');
    await f.open();
    assert.ok(f.window.document.querySelector('.rdtDays'));
    assert.deepEqual(f.writes, ['2024-01-31']);
});

for (const identity of ['field', 'session', 'kind', 'owner'] as const)
    it(`resets unfinished drafts across committed ${identity} A-to-B-to-A without writing`, async (t) => {
        const f = await fixture(t);
        const original = f.props();
        await f.edit('2024-02-');
        const patch =
            identity === 'field'
                ? { id: 'other-date' }
                : identity === 'session'
                  ? { sessionId: 'other-session' }
                  : identity === 'kind'
                    ? { airtableDateConfig: datetime }
                    : { owner: { token: {}, isCurrent: () => true } };
        await f.render(patch);
        await f.render(original);
        assert.equal(f.input().value, '2024-02-01');
        assert.deepEqual(f.writes, []);
        await f.edit('2024-02-29');
        await f.key('Enter');
        assert.deepEqual(f.writes, ['2024-02-29']);
    });
