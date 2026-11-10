import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    StrictMode,
    type FormEvent,
    type ReactNode,
} from 'react';
import {
    CompleteCalendlyWidget,
    type CompleteCalendlyWidgetProps,
} from '../src/react/index.js';

type Props = CompleteCalendlyWidgetProps;

const defaults: Props = {
    configuredUrl: 'https://calendly.com/synthetic/no-bookings?keep=yes',
    email: null,
    name: null,
    embedDomain: 'https://synthetic.invalid',
    ownerKey: 'record-A/session-A/field-A',
    onScheduled() {},
};

async function fixture(
    t: TestContext,
    patch: Partial<Props> = {},
    wrap: (widget: ReactNode) => ReactNode = (widget) => widget
) {
    // Only the external navigation boundary is disabled. The production widget
    // renders its actual hook-owned iframe, including its original key and ref.
    const window = new Window({
        settings: { navigation: { disableChildFrameNavigation: true } },
    });
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLButtonElement',
        'HTMLIFrameElement',
        'HTMLDialogElement',
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
    const writes: string[] = [];
    let props: Props = {
        ...defaults,
        onScheduled() {
            writes.push('scheduled');
        },
        ...patch,
    };
    let mounted = true;
    const render = async () => {
        await act(async () =>
            root.render(
                h(StrictMode, null, wrap(h(CompleteCalendlyWidget, props)))
            )
        );
    };
    const unmount = async () => {
        if (!mounted) return;
        mounted = false;
        await act(async () => root.unmount());
    };
    t.after(async () => {
        try {
            await unmount();
        } finally {
            keys.forEach((key, index) => {
                const original = originals[index];
                if (original) Object.defineProperty(globalThis, key, original);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    });
    const button = (label: string) => {
        const node = [...container.querySelectorAll('button')].find(
            (entry) =>
                entry.getAttribute('aria-label') === label ||
                entry.textContent === label
        );
        assert.ok(node, `Expected button ${label}`);
        return node;
    };
    const frame = () => {
        const node = container.querySelector('iframe');
        assert.ok(node, 'Expected the supplied Calendly iframe');
        assert.ok(node.contentWindow, 'The real iframe owns a window');
        return node;
    };
    const dialog = () => {
        const node = container.querySelector('dialog');
        assert.ok(node, 'Expected the complete widget dialog');
        return node;
    };
    const source = () => frame().contentWindow as unknown as MessageEventSource;
    const click = async (label: string) => {
        await act(async () => button(label).click());
    };
    const send = async (
        sender: MessageEventSource | null,
        origin = 'https://calendly.com',
        data: unknown = { event: 'calendly.event_scheduled' }
    ) => {
        await act(async () => {
            window.dispatchEvent(
                new window.MessageEvent('message', {
                    source: sender as unknown as Window | null,
                    origin,
                    data,
                })
            );
        });
    };
    await render();
    return {
        window,
        container,
        root,
        writes,
        button,
        frame,
        dialog,
        source,
        click,
        send,
        unmount,
        async update(next: Partial<Props>) {
            props = { ...props, ...next };
            await render();
        },
    };
}

function dialogName(node: {
    getAttribute(name: string): string | null;
    ownerDocument: {
        getElementById(id: string): { textContent: string | null } | null;
    };
}): string {
    const label = node.getAttribute('aria-label');
    if (label != null) return label;
    return (node.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => node.ownerDocument.getElementById(id)?.textContent ?? '')
        .join(' ');
}

it('renders the real hook frame with exact resolved prefill bytes, query preservation and frame policy', async (t) => {
    // Schema-ID resolution remains the native adapter's contract. These are
    // its resolved values, not a second SDK record/schema resolver.
    const f = await fixture(t, {
        email: 'ada+schedule&team@example.invalid',
        name: 'Ada & Grace = Team',
    });
    assert.equal(f.container.querySelector('iframe'), null);
    await f.click('Schedule');
    const frame = f.frame();
    const url = new URL(frame.src);
    assert.equal(url.searchParams.get('keep'), 'yes');
    assert.equal(
        url.searchParams.get('email'),
        'ada+schedule&team@example.invalid'
    );
    assert.equal(url.searchParams.get('name'), 'Ada & Grace = Team');
    assert.equal(url.searchParams.get('embed_domain'), defaults.embedDomain);
    assert.equal(url.searchParams.get('embed_type'), 'PopupText');
    assert.equal(frame.title, 'Schedule with Calendly');
    assert.equal(
        frame.getAttribute('sandbox'),
        'allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts'
    );
    assert.equal(
        frame.getAttribute('referrerpolicy'),
        'strict-origin-when-cross-origin'
    );
    assert.deepEqual(f.writes, []);
});

it('consumes duplicate scheduled events from the admitted iframe once before removing its modal', async (t) => {
    const f = await fixture(t);
    await act(async () => {
        const trigger = f.button('Schedule');
        trigger.click();
        trigger.click();
    });
    assert.equal(f.container.querySelectorAll('iframe').length, 1);
    const sender = f.source();
    await f.send(sender);
    await f.send(sender);
    assert.deepEqual(f.writes, ['scheduled']);
    assert.equal(f.container.querySelector('iframe'), null);
    assert.equal(f.container.querySelector('dialog'), null);
});

it('rejects closed, wrong-source, wrong-origin, wrong-port and malformed messages before a current positive control', async (t) => {
    const f = await fixture(t, {
        configuredUrl: 'https://team.calendly.com:443/synthetic',
    });
    await f.send(
        f.window as unknown as MessageEventSource,
        'https://team.calendly.com'
    );
    assert.deepEqual(f.writes, []);
    await f.click('Schedule');
    const frame = f.frame();
    const sender = f.source();
    await f.send(sender, 'https://calendly.com');
    await f.send(sender, 'https://team.calendly.com:444');
    await f.send(null, 'https://team.calendly.com');
    await f.send(
        f.window as unknown as MessageEventSource,
        'https://team.calendly.com'
    );
    for (const data of [
        null,
        'calendly.event_scheduled',
        {},
        { event: 'calendly.profile_page_viewed' },
    ])
        await f.send(sender, 'https://team.calendly.com', data);
    assert.deepEqual(f.writes, []);
    assert.equal(f.frame(), frame);
    await f.send(sender, 'https://team.calendly.com');
    assert.deepEqual(f.writes, ['scheduled']);
});

for (const configuredUrl of [
    'http://calendly.com/example/meeting',
    'https://attacker.example/calendly',
    'not a URL',
])
    it(`shows the invalid URL feedback without a booking control or write: ${configuredUrl}`, async (t) => {
        const f = await fixture(t, { configuredUrl });
        const alert = f.container.querySelector('[role="alert"]');
        assert.ok(alert);
        assert.match(alert.textContent, /HTTPS.*Calendly|Calendly.*HTTPS/);
        assert.equal(f.container.querySelector('button'), null);
        assert.equal(f.container.querySelector('iframe'), null);
        assert.deepEqual(f.writes, []);
    });

it('accepts the adapter null-prefill vector without substituting another field value', async (t) => {
    // Native tests retain the deleted-ID and duplicate-name resolver proofs.
    // This public component only consumes the resulting null prefill vector.
    const f = await fixture(t, { email: null, name: null });
    await f.click('Schedule');
    const url = new URL(f.frame().src);
    assert.equal(url.searchParams.has('email'), false);
    assert.equal(url.searchParams.has('name'), false);
    assert.equal(url.searchParams.get('keep'), 'yes');
    assert.deepEqual(f.writes, []);
});

it('closes an unfinished custom-title booking without a write and leaves its trigger available', async (t) => {
    const f = await fixture(t, { schedulingTitle: 'Book an onboarding call' });
    const trigger = f.button('Book an onboarding call');
    await f.click('Book an onboarding call');
    assert.equal(dialogName(f.dialog()), 'Book an onboarding call');
    await f.click('Close');
    assert.equal(f.container.querySelector('iframe'), null);
    assert.equal(f.container.querySelector('dialog'), null);
    assert.equal(f.button('Book an onboarding call'), trigger);
    assert.deepEqual(f.writes, []);
});

it('cancels Escape and an actual outside-pointer gesture without treating inside or cancelled gestures as dismissal', async (t) => {
    const f = await fixture(t);
    await f.click('Schedule');
    const firstSource = f.source();
    const cancel = new f.window.Event('cancel', { cancelable: true });
    await act(async () => f.dialog().dispatchEvent(cancel));
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(f.container.querySelector('dialog'), null);
    await f.send(firstSource);
    assert.deepEqual(f.writes, []);
    await f.click('Schedule');
    const frame = f.frame();
    const dialog = f.dialog();
    const overlay = dialog.querySelector('.mx-sdk-calendly-overlay');
    const panel = dialog.querySelector('section');
    assert.ok(overlay && panel);
    const pointer = (target: NonNullable<typeof overlay>, type: string) =>
        target.dispatchEvent(
            new f.window.PointerEvent(type, { bubbles: true })
        );
    const click = () =>
        overlay.dispatchEvent(
            new f.window.MouseEvent('click', { bubbles: true })
        );
    await act(async () => {
        pointer(panel, 'pointerdown');
        click();
    });
    assert.equal(
        f.frame(),
        frame,
        'an inside-origin gesture is not a dismissal'
    );
    await act(async () => {
        pointer(overlay, 'pointerdown');
        pointer(overlay, 'pointercancel');
        click();
    });
    assert.equal(f.frame(), frame, 'pointer cancellation retires the gesture');
    await act(async () => {
        pointer(overlay, 'pointerdown');
        click();
    });
    assert.equal(f.container.querySelector('dialog'), null);
    assert.deepEqual(f.writes, []);
});

it('keeps the iframe-aware parent focus boundaries local without a booking write', async (t) => {
    const f = await fixture(t);
    await f.click('Schedule');
    const frame = f.frame();
    const close = f.button('Close');
    const key = async (shiftKey: boolean) => {
        const event = new f.window.KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey,
            bubbles: true,
            cancelable: true,
        });
        await act(async () =>
            f.window.document.activeElement?.dispatchEvent(event)
        );
        return event;
    };
    await act(async () => close.focus());
    assert.equal((await key(false)).defaultPrevented, true);
    assert.equal(f.window.document.activeElement, frame);
    assert.equal((await key(true)).defaultPrevented, true);
    assert.equal(f.window.document.activeElement, close);
    const boundaries = [...f.dialog().querySelectorAll('span')].filter(
        (node) => node.tabIndex === 0
    );
    assert.equal(boundaries.length, 2);
    await act(async () => boundaries[0].focus());
    assert.equal(f.window.document.activeElement, close);
    await act(async () => boundaries[1].focus());
    assert.equal(f.window.document.activeElement, frame);
    assert.deepEqual(f.writes, []);
    // This exercises the parent document's boundary handlers. Keyboard events
    // inside the provider frame and native traversal remain browser-proof work.
});

it('keeps opening and closing non-submit actions inside a native form', async (t) => {
    let submits = 0;
    const f = await fixture(t, {}, (widget) =>
        h(
            'form',
            {
                onSubmit(event: FormEvent<HTMLFormElement>) {
                    event.preventDefault();
                    submits++;
                },
            },
            widget
        )
    );
    assert.equal(f.button('Schedule').type, 'button');
    await f.click('Schedule');
    assert.equal(f.button('Close').type, 'button');
    await f.click('Close');
    assert.equal(submits, 0);
    assert.deepEqual(f.writes, []);
});

it('retires session ownership through A-B-A and admits only the fresh current writer', async (t) => {
    const writes: string[] = [];
    const f = await fixture(t, { onScheduled: () => writes.push('A-old') });
    await f.click('Schedule');
    const oldSource = f.source();
    await f.update({
        ownerKey: 'record-A/session-B/field-A',
        onScheduled: () => writes.push('B'),
    });
    assert.equal(f.container.querySelector('iframe'), null);
    await f.send(oldSource);
    assert.deepEqual(writes, []);
    await f.click('Schedule');
    await f.send(f.source());
    assert.deepEqual(writes, ['B']);
    await f.update({
        ownerKey: defaults.ownerKey,
        onScheduled: () => writes.push('A-new'),
    });
    await f.click('Schedule');
    const current = f.frame();
    await f.send(oldSource);
    assert.equal(f.frame(), current);
    assert.deepEqual(writes, ['B']);
    await f.send(f.source());
    assert.deepEqual(writes, ['B', 'A-new']);
});

it('retires active URL and prefill generations without reusing an old frame source', async (t) => {
    const f = await fixture(t);
    for (const change of [
        { configuredUrl: 'https://calendly.com/synthetic/changed' },
        { email: 'new+email@example.invalid' },
        { name: 'New & Name' },
        { embedDomain: 'https://replacement.invalid' },
    ]) {
        await f.click('Schedule');
        const old = f.frame();
        const sender = f.source();
        await f.update(change);
        assert.equal(f.container.querySelector('iframe'), null);
        await f.send(sender);
        assert.deepEqual(f.writes, []);
        await f.click('Schedule');
        assert.notEqual(f.frame(), old);
        await f.click('Close');
    }
    await f.click('Schedule');
    const url = new URL(f.frame().src);
    assert.equal(url.pathname, '/synthetic/changed');
    assert.equal(url.searchParams.get('email'), 'new+email@example.invalid');
    assert.equal(url.searchParams.get('name'), 'New & Name');
    assert.equal(
        url.searchParams.get('embed_domain'),
        'https://replacement.invalid'
    );
});

it('retires an open frame when the native booked value arrives without treating a message as persistence', async (t) => {
    const f = await fixture(t);
    await f.click('Schedule');
    const sender = f.source();
    await f.update({ booked: true });
    assert.equal(f.container.querySelector('iframe'), null);
    assert.equal(f.container.querySelector('dialog'), null);
    assert.ok(f.container.textContent.includes('✅ Booked'));
    await f.send(sender);
    assert.deepEqual(f.writes, []);
});

it('cancels and reopens with a fresh iframe while preserving the successor after detached old Close activation', async (t) => {
    const f = await fixture(t);
    await f.click('Schedule');
    const first = f.frame();
    const oldSource = f.source();
    const oldClose = f.button('Close');
    await f.click('Close');
    await f.send(oldSource);
    await f.click('Schedule');
    const second = f.frame();
    assert.notEqual(second, first);
    assert.notEqual(second.contentWindow, oldSource);
    // Detached DOM activation proves successor preservation here. The existing
    // public hook test separately calls a captured stale cancel handle directly.
    await act(async () => oldClose.click());
    await f.send(oldSource);
    assert.equal(f.frame(), second);
    assert.deepEqual(f.writes, []);
    const sender = f.source();
    await f.send(sender);
    await f.send(sender);
    assert.deepEqual(f.writes, ['scheduled']);
});

it('uses the latest writer and cosmetic props without replacing the current iframe, then retires on unmount', async (t) => {
    const writes: string[] = [];
    const f = await fixture(t, { onScheduled: () => writes.push('old') });
    await f.click('Schedule');
    const frame = f.frame();
    const sender = f.source();
    await f.update({
        onScheduled: () => writes.push('latest'),
        schedulingTitle: 'Localized schedule',
        frameTitle: 'Localized Calendly frame',
        className: 'native-widget',
        accentColor: '#334455',
        hoverColor: '#445566',
        focusColor: '#556677',
        reservedInlineEndWidth: '440px',
    });
    assert.equal(f.frame(), frame);
    assert.equal(f.source(), sender);
    assert.equal(frame.title, 'Localized Calendly frame');
    assert.equal(dialogName(f.dialog()), 'Localized schedule');
    await f.send(sender);
    assert.deepEqual(writes, ['latest']);
    await f.click('Localized schedule');
    const lateSource = f.source();
    await f.unmount();
    await f.send(lateSource);
    assert.deepEqual(writes, ['latest']);
});

for (const example of [
    {
        title: 'Book an onboarding call',
        labels: undefined,
        expected: 'Book an onboarding call',
    },
    {
        title: undefined,
        labels: { schedule: 'Programme' },
        expected: 'Programme',
    },
])
    it(`names exactly one dialog and focuses its real iframe for ${example.expected}`, async (t) => {
        const f = await fixture(t, {
            schedulingTitle: example.title,
            labels: example.labels,
        });
        const trigger = f.button(example.expected);
        await f.click(example.expected);
        assert.equal(f.container.querySelectorAll('dialog').length, 1);
        assert.equal(dialogName(f.dialog()), example.expected);
        assert.equal(f.window.document.activeElement, f.frame());
        await f.click('Close');
        assert.equal(f.container.querySelector('dialog'), null);
        assert.equal(f.container.querySelector('iframe'), null);
        assert.equal(trigger.isConnected, true);
        assert.deepEqual(f.writes, []);
        // Happy DOM has no native opener-restoration algorithm. The independent
        // installed-browser proof must retain exact trigger-focus restoration.
    });

it('uses supplied literal copy with native title fallback and non-submit localized Close', async (t) => {
    const f = await fixture(t, {
        schedulingTitle: '',
        labels: {
            schedule: 'Programme',
            booked: 'Réservé',
            close: 'Fermer',
            invalidUrl: 'Lien Calendly invalide',
        },
    });
    await f.click('Programme');
    assert.equal(dialogName(f.dialog()), 'Programme');
    assert.equal(f.button('Fermer').type, 'button');
    await f.click('Fermer');
    await f.update({ schedulingTitle: '<script>Custom title</script>' });
    await f.click('<script>Custom title</script>');
    assert.equal(dialogName(f.dialog()), '<script>Custom title</script>');
    assert.equal(f.container.querySelector('script'), null);
    await f.update({ booked: true });
    assert.ok(f.container.textContent.includes('Réservé'));
    await f.update({ booked: false, configuredUrl: 'not a URL' });
    assert.equal(
        f.container.querySelector('[role="alert"]')?.textContent,
        'Lien Calendly invalide'
    );
    assert.deepEqual(f.writes, []);
});

it('keeps disabled and invalid transitions authoritative through a later enabled generation', async (t) => {
    const f = await fixture(t, { enabled: false });
    assert.equal(f.button('Schedule').disabled, true);
    await f.click('Schedule');
    assert.equal(f.container.querySelector('iframe'), null);
    for (const blocked of [
        { enabled: false },
        { configuredUrl: 'https://attacker.invalid/' },
    ]) {
        await f.update({
            enabled: true,
            configuredUrl: defaults.configuredUrl,
        });
        await f.click('Schedule');
        const oldSource = f.source();
        await f.update(blocked);
        assert.equal(f.container.querySelector('iframe'), null);
        await f.send(oldSource);
        assert.deepEqual(f.writes, []);
    }
    await f.update({ enabled: true, configuredUrl: defaults.configuredUrl });
    await f.click('Schedule');
    await f.send(f.source());
    assert.deepEqual(f.writes, ['scheduled']);
});

it('preserves the iframe for a semantically equal URL and same owner publication', async (t) => {
    const f = await fixture(t);
    await f.click('Schedule');
    const frame = f.frame();
    await f.update({
        configuredUrl:
            'https://calendly.com:443/synthetic/no-bookings?keep=yes',
        enabled: true,
        booked: false,
    });
    assert.equal(f.frame(), frame);
    assert.deepEqual(f.writes, []);
});

it('does not resurrect a retired frame after observed URL or booked A-B-A publication', async (t) => {
    const f = await fixture(t);
    for (const replacement of [
        { configuredUrl: 'https://calendly.com/synthetic/B' },
        { booked: true },
    ]) {
        await f.click('Schedule');
        const old = f.frame();
        const oldSource = f.source();
        const before = f.writes.length;
        await f.update(replacement);
        await f.update({
            configuredUrl: defaults.configuredUrl,
            booked: false,
        });
        assert.equal(f.container.querySelector('iframe'), null);
        await f.send(oldSource);
        assert.equal(f.writes.length, before);
        await f.click('Schedule');
        assert.notEqual(f.frame(), old);
        await f.send(oldSource);
        assert.equal(f.writes.length, before);
        await f.send(f.source());
        assert.equal(f.writes.length, before + 1);
    }
});

it('consumes a frame before a reentrant native writer opens its successor through the actual trigger', async (t) => {
    let writes = 0;
    let reopen: () => void = () => assert.fail('Trigger is not available yet');
    let emitOld: () => void = () =>
        assert.fail('Old iframe is not available yet');
    const f = await fixture(t, {
        onScheduled() {
            writes++;
            if (writes === 1) {
                reopen();
                emitOld();
            }
        },
    });
    const trigger = f.button('Schedule');
    reopen = () => trigger.click();
    await f.click('Schedule');
    const old = f.frame();
    const oldSource = f.source();
    emitOld = () => {
        f.window.dispatchEvent(
            new f.window.MessageEvent('message', {
                source: oldSource as unknown as Window,
                origin: 'https://calendly.com',
                data: { event: 'calendly.event_scheduled' },
            })
        );
    };
    await f.send(oldSource);
    assert.equal(writes, 1);
    const next = f.frame();
    assert.notEqual(next, old);
    await f.send(oldSource);
    assert.equal(f.frame(), next);
    assert.equal(writes, 1);
    await f.send(f.source());
    assert.equal(writes, 2);
    assert.equal(f.container.querySelector('iframe'), null);
});

it('isolates two complete widget instances and retires both message admissions on unmount', async (t) => {
    const f = await fixture(t);
    const writes: string[] = [];
    await act(async () =>
        f.root.render(
            h(
                StrictMode,
                null,
                h(CompleteCalendlyWidget, {
                    ...defaults,
                    key: 'A',
                    ownerKey: 'A',
                    labels: { schedule: 'Schedule A' },
                    onScheduled: () => writes.push('A'),
                }),
                h(CompleteCalendlyWidget, {
                    ...defaults,
                    key: 'B',
                    ownerKey: 'B',
                    labels: { schedule: 'Schedule B' },
                    onScheduled: () => writes.push('B'),
                })
            )
        )
    );
    await f.click('Schedule A');
    await f.click('Schedule B');
    const frames = [...f.container.querySelectorAll('iframe')];
    assert.equal(frames.length, 2);
    assert.notEqual(frames[0], frames[1]);
    assert.notEqual(frames[0].contentWindow, frames[1].contentWindow);
    const first = frames[0].contentWindow as unknown as MessageEventSource;
    const second = frames[1].contentWindow as unknown as MessageEventSource;
    await f.send(first);
    assert.deepEqual(writes, ['A']);
    assert.equal(f.container.querySelector('iframe'), frames[1]);
    await f.unmount();
    await f.send(first);
    await f.send(second);
    assert.deepEqual(writes, ['A']);
});
