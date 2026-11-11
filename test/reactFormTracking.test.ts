import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { createElement as h, act, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { CompleteFormTrackingDisclosure } from '../src/react/index.js';
import {
    captureFormTrackingPolicy,
    readBrowserFormLocation,
} from '../src/forms/index.js';

const policy = captureFormTrackingPolicy({
    enableTracking: true,
    userIPAddressField: 'ip',
    userLatitudeField: 'lat',
});
const props = {
    policy,
    isLastPage: true,
    readOnly: false,
    preview: false,
    labels: {
        ipAddress: 'Adresse IP collectée',
        location: '<b>Position collectée</b>',
    },
};
it('renders complete localized literal IP and location alerts without browser access', () => {
    const html = renderToString(h(CompleteFormTrackingDisclosure, props));
    assert.equal((html.match(/role="alert"/g) ?? []).length, 2);
    assert(html.indexOf(props.labels.ipAddress) < html.indexOf('&lt;b&gt;'));
    assert(!html.includes('<b>'));
    for (const patch of [
        { isLastPage: false },
        { readOnly: true },
        { preview: true },
        {
            policy: captureFormTrackingPolicy({
                enableTracking: false,
                userLatitudeField: 'lat',
            }),
        },
    ])
        assert.equal(
            renderToString(
                h(CompleteFormTrackingDisclosure, { ...props, ...patch })
            ),
            ''
        );
});
it('lazy browser reader requests once with native timeout, then preserves zero or falls back', async (t) => {
    const window = new Window();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    let success: PositionCallback | undefined,
        failure: PositionErrorCallback | null | undefined;
    let calls = 0;
    const geolocation = {
        getCurrentPosition(
            ok: PositionCallback,
            no?: PositionErrorCallback | null,
            options?: PositionOptions
        ) {
            calls++;
            success = ok;
            failure = no;
            assert.deepEqual(options, { timeout: 15000 });
        },
    };
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { geolocation },
    });
    t.after(() => {
        if (original) Object.defineProperty(globalThis, 'navigator', original);
        else Reflect.deleteProperty(globalThis, 'navigator');
        window.happyDOM.abort();
    });
    renderToString(
        h(StrictMode, null, h(CompleteFormTrackingDisclosure, props))
    );
    assert.equal(calls, 0);
    const first = readBrowserFormLocation();
    assert.equal(calls, 1);
    success!({ coords: { latitude: 0, longitude: 0 } } as GeolocationPosition);
    assert.deepEqual(await first, { lat: 0, long: 0 });
    let logs = 0;
    const denied = readBrowserFormLocation(() => {
        logs++;
        throw new Error('synthetic logging failure');
    });
    failure!({ code: 1 } as GeolocationPositionError);
    assert.deepEqual(await denied, {});
    assert.equal(calls, 2);
    assert.equal(logs, 1);
    geolocation.getCurrentPosition = () => {
        calls++;
        throw new Error('synthetic provider throw');
    };
    assert.deepEqual(await readBrowserFormLocation(), {});
    assert.equal(calls, 3);
});
it('hydrates and replaces disclosure configuration with no permission side effect', async (t) => {
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
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        });
    const { hydrateRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    container.innerHTML = renderToString(
        h(CompleteFormTrackingDisclosure, props)
    );
    const originalAlert = container.firstChild;
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
        root = hydrateRoot(
            container as unknown as HTMLElement,
            h(CompleteFormTrackingDisclosure, props)
        );
    });
    t.after(async () => {
        await act(async () => root.unmount());
        for (let i = 0; i < keys.length; i++) {
            const descriptor = originals[i];
            if (descriptor)
                Object.defineProperty(globalThis, keys[i], descriptor);
            else Reflect.deleteProperty(globalThis, keys[i]);
        }
        await window.happyDOM.abort();
    });
    assert.equal(container.firstChild, originalAlert);
    assert.equal(container.querySelectorAll('[role=alert]').length, 2);
    await act(async () => {
        root.render(
            h(CompleteFormTrackingDisclosure, {
                ...props,
                labels: { ipAddress: 'IP', location: '位置情報が収集されます' },
                policy: captureFormTrackingPolicy({
                    enableTracking: true,
                    userLongitudeField: 'long',
                }),
            })
        );
    });
    assert.equal(container.textContent, '位置情報が収集されます');
    assert.equal(container.querySelectorAll('[role=alert]').length, 1);
    await act(async () => {
        root.render(
            h(CompleteFormTrackingDisclosure, { ...props, preview: true })
        );
    });
    assert.equal(container.textContent, '');
});
