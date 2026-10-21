import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, cloneElement, createElement as h, StrictMode } from 'react';
import {
    composeCalendlyUrl,
    useCalendlyBooking,
    type CalendlyBooking,
    type CalendlyBookingOptions,
} from '../src/react/index.js';

const defaults: CalendlyBookingOptions = {
    configuredUrl: 'https://calendly.com/synthetic/no-bookings?keep=yes',
    email: null,
    name: null,
    embedDomain: 'https://synthetic.invalid',
    ownerKey: 'record-A/session-A',
    onScheduled() {},
};

async function fixture(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
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
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    let current: CalendlyBooking | undefined;
    function Host(options: CalendlyBookingOptions) {
        current = useCalendlyBooking(options);
        // Replace only the external navigation boundary. The SDK still owns the
        // actual iframe element, ref, key and lifecycle; no Calendly is contacted.
        return current.session
            ? cloneElement(current.session.frame, { src: 'about:blank' })
            : null;
    }
    t.after(async () => {
        await act(async () => root.unmount());
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    return {
        window,
        container,
        get booking() {
            assert(current);
            return current;
        },
        get frame() {
            const node = container.querySelector('iframe');
            assert(node);
            return node;
        },
        render: async (options: Partial<CalendlyBookingOptions> = {}) => {
            await act(async () =>
                root.render(
                    h(StrictMode, null, h(Host, { ...defaults, ...options }))
                )
            );
        },
        unmount: async () => {
            await act(async () => root.render(null));
        },
        send: (
            source: MessageEventSource | null,
            origin = 'https://calendly.com',
            data: unknown = { event: 'calendly.event_scheduled' }
        ) => {
            window.dispatchEvent(
                new window.MessageEvent('message', {
                    source: source as unknown as Window | null,
                    origin,
                    data,
                })
            );
        },
    };
}

it('preserves URL queries and exact ID-resolved prefill bytes while rejecting untrusted destinations', () => {
    const url = composeCalendlyUrl({
        ...defaults,
        email: 'ada+schedule&team@example.invalid',
        name: 'Ada & Grace = Team',
    });
    assert(url);
    assert.equal(url.searchParams.get('keep'), 'yes');
    assert.equal(
        url.searchParams.get('email'),
        'ada+schedule&team@example.invalid'
    );
    assert.equal(url.searchParams.get('name'), 'Ada & Grace = Team');
    assert.equal(url.searchParams.get('embed_domain'), defaults.embedDomain);
    assert.equal(url.searchParams.get('embed_type'), 'PopupText');
    assert.equal(
        composeCalendlyUrl({
            ...defaults,
            configuredUrl: 'https://team.calendly.com/synthetic',
        })?.origin,
        'https://team.calendly.com'
    );
    for (const configuredUrl of [
        'not-a-url',
        'http://calendly.com/synthetic',
        'https://calendly.com.attacker.invalid/synthetic',
        'https://attacker.invalid/calendly.com',
        'javascript:alert(1)',
    ]) {
        assert.equal(composeCalendlyUrl({ ...defaults, configuredUrl }), null);
    }
});

it('admits only the active native frame, exact composed origin and typed scheduled event once', async (t) => {
    const f = await fixture(t);
    let writes = 0;
    await f.render({
        configuredUrl: 'https://team.calendly.com:443/synthetic',
        onScheduled() {
            writes++;
        },
    });
    await act(async () => {
        assert.equal(f.booking.open(), true);
        assert.equal(f.booking.open(), false);
    });
    const frame = f.frame;
    const source = frame.contentWindow as unknown as MessageEventSource;
    assert.equal(frame.title, 'Schedule with Calendly');
    assert.equal(
        frame.getAttribute('referrerpolicy'),
        'strict-origin-when-cross-origin'
    );
    assert.equal(
        frame.getAttribute('sandbox'),
        'allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts'
    );
    await act(async () => {
        f.send(source, 'https://calendly.com');
        f.send(source, 'https://team.calendly.com:444');
        f.send(null, 'https://team.calendly.com');
        for (const data of [
            null,
            'calendly.event_scheduled',
            {},
            { event: 'calendly.profile_page_viewed' },
        ])
            f.send(source, 'https://team.calendly.com', data);
    });
    assert.equal(writes, 0);
    assert.equal(f.frame, frame);
    await act(async () => {
        f.send(source, 'https://team.calendly.com');
        f.send(source, 'https://team.calendly.com');
    });
    assert.equal(writes, 1);
    assert.equal(f.booking.session, null);
    assert.equal(f.container.querySelector('iframe'), null);
});

it('cancels without writes, recreates native frames and rejects old events and cancel handles after reopen', async (t) => {
    const f = await fixture(t);
    let writes = 0;
    await f.render({
        onScheduled() {
            writes++;
        },
    });
    await act(async () => {
        f.booking.open();
    });
    const first = f.frame;
    const firstSource = first.contentWindow as unknown as MessageEventSource;
    const oldSession = f.booking.session!;
    await act(async () => {
        assert.equal(oldSession.cancel(), true);
        f.send(firstSource);
    });
    assert.equal(writes, 0);
    await act(async () => {
        assert.equal(f.booking.open(), true);
    });
    const second = f.frame;
    assert.notEqual(second, first);
    assert.notEqual(second.contentWindow, firstSource);
    await act(async () => {
        assert.equal(oldSession.cancel(), false);
        f.send(firstSource);
    });
    assert.equal(writes, 0);
    assert.equal(f.frame, second);
    await act(async () => {
        f.send(second.contentWindow as unknown as MessageEventSource);
    });
    assert.equal(writes, 1);
});

it('retires owner and URL generations including A-B-A without letting stale open handles write', async (t) => {
    const f = await fixture(t);
    const writes: string[] = [];
    await f.render({
        onScheduled() {
            writes.push('A');
        },
    });
    const oldOpen = f.booking.open;
    await act(async () => {
        oldOpen();
    });
    const oldSource = f.frame.contentWindow as unknown as MessageEventSource;
    const oldSession = f.booking.session!;
    await f.render({
        ownerKey: 'record-B/session-A',
        onScheduled() {
            writes.push('B');
        },
    });
    assert.equal(f.booking.session, null);
    await act(async () => {
        assert.equal(oldOpen(), false);
        assert.equal(oldSession.cancel(), false);
        f.send(oldSource);
        f.booking.open();
    });
    const bSource = f.frame.contentWindow as unknown as MessageEventSource;
    await act(async () => {
        f.send(bSource);
    });
    assert.deepEqual(writes, ['B']);
    await f.render({
        onScheduled() {
            writes.push('A-new');
        },
    });
    await act(async () => {
        assert.equal(oldOpen(), false);
        f.booking.open();
        f.send(oldSource);
    });
    assert.deepEqual(writes, ['B']);
    const aNewSource = f.frame.contentWindow as unknown as MessageEventSource;
    await f.render({ configuredUrl: 'https://calendly.com/synthetic/changed' });
    assert.equal(f.booking.session, null);
    await act(async () => {
        f.send(aNewSource);
    });
    assert.deepEqual(writes, ['B']);
});

it('blocks disabled, booked and invalid owners and retires active frames on those transitions and unmount', async (t) => {
    const f = await fixture(t);
    let writes = 0;
    const onScheduled = () => {
        writes++;
    };
    for (const blocked of [
        { enabled: false },
        { booked: true },
        { configuredUrl: 'https://attacker.invalid/' },
    ]) {
        await f.render({ onScheduled });
        await act(async () => {
            f.booking.open();
        });
        const source = f.frame.contentWindow as unknown as MessageEventSource;
        await f.render({ ...blocked, onScheduled });
        assert.equal(f.booking.session, null);
        await act(async () => {
            assert.equal(f.booking.open(), false);
            f.send(source);
        });
        assert.equal(writes, 0);
    }
    await f.render({ onScheduled });
    await act(async () => {
        assert.equal(f.booking.open(), true);
    });
    const source = f.frame.contentWindow as unknown as MessageEventSource;
    const staleOpen = f.booking.open;
    await f.unmount();
    await act(async () => {
        assert.equal(staleOpen(), false);
        f.send(source);
    });
    assert.equal(writes, 0);
});

it('uses the latest native writer for the same owner without retiring its active frame', async (t) => {
    const f = await fixture(t);
    const writes: string[] = [];
    await f.render({
        onScheduled() {
            writes.push('old');
        },
    });
    await act(async () => {
        f.booking.open();
    });
    const frame = f.frame;
    await f.render({
        onScheduled() {
            writes.push('latest');
        },
        frameTitle: 'Localized schedule',
        frameClassName: 'host-style',
    });
    assert.equal(f.frame, frame);
    assert.equal(f.frame.title, 'Localized schedule');
    assert.equal(f.frame.className, 'host-style');
    await act(async () => {
        f.send(frame.contentWindow as unknown as MessageEventSource);
    });
    assert.deepEqual(writes, ['latest']);
});

it('consumes before reentrant native writes and prevents an old frame or close from settling its successor', async (t) => {
    const f = await fixture(t);
    let writes = 0;
    let oldSource: MessageEventSource | null = null;
    await f.render({
        onScheduled() {
            writes++;
            if (writes === 1) {
                assert.equal(f.booking.open(), true);
                f.send(oldSource);
            }
        },
    });
    await act(async () => {
        f.booking.open();
    });
    const oldFrame = f.frame;
    oldSource = oldFrame.contentWindow as unknown as MessageEventSource;
    const oldSession = f.booking.session!;
    await act(async () => {
        f.send(oldSource);
        f.send(oldSource);
    });
    assert.equal(writes, 1);
    const next = f.frame;
    assert.notEqual(next, oldFrame);
    await act(async () => {
        assert.equal(oldSession.cancel(), false);
        f.send(oldSource);
    });
    assert.equal(writes, 1);
    assert.equal(f.frame, next);
    await act(async () => {
        f.send(next.contentWindow as unknown as MessageEventSource);
    });
    assert.equal(writes, 2);
    assert.equal(f.booking.session, null);
});
