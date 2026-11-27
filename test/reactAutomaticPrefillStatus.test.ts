import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { act, createElement as h, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { Window } from 'happy-dom';
import { AutomaticPrefillStatus } from '../src/react/AutomaticPrefillStatus.js';
import {
    createAutomaticPrefillCoordinator,
    type AutomaticPrefillFrame,
    type AutomaticPrefillHost,
    type AutomaticPrefillRequest,
} from '../src/forms/automaticPrefillCoordinator.js';

function fixture() {
    const scope = { owner: {}, configuration: {} };
    let frame: AutomaticPrefillFrame = {
        scope,
        read: {},
        saveState: { type: 'idle' },
        facts: {
            enabled: true,
            captchaEnabled: false,
            preview: false,
            suppressed: false,
            hasNonemptyURLPrefill: true,
            acceptedURLFieldIds: ['url'],
            projectedValues: { url: false },
        },
    };
    const requests: AutomaticPrefillRequest[] = [];
    const listeners = new Set<() => void>();
    let reads = 0;
    const host: AutomaticPrefillHost = {
        read: () => {
            reads++;
            return frame;
        },
        isCurrent: (candidate) => candidate === frame,
        subscribe: (changed) => {
            listeners.add(changed);
            return () => {
                listeners.delete(changed);
            };
        },
        requestFinalSave: (request) => {
            requests.push(request);
            return { status: 'accepted' };
        },
    };
    return {
        scope,
        frame,
        requests,
        listeners,
        reads: () => reads,
        updateFacts(facts: Partial<AutomaticPrefillFrame['facts']>) {
            frame = { ...frame, facts: { ...frame.facts, ...facts } };
        },
        coordinator: createAutomaticPrefillCoordinator(host, scope),
    };
}

async function dom(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const original = keys.map((key) =>
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
    t.after(async () => {
        keys.forEach((key, i) =>
            original[i]
                ? Object.defineProperty(globalThis, key, original[i]!)
                : Reflect.deleteProperty(globalThis, key)
        );
        await window.happyDOM.close();
    });
    return { window, container, createRoot };
}

test('status SSR is localized and inert without reading host authority', () => {
    const f = fixture();
    const html = renderToString(
        h(AutomaticPrefillStatus, {
            coordinator: f.coordinator,
            labels: { submitting: 'Envoi automatique…' },
        })
    );
    assert.match(html, /Envoi automatique/);
    assert.match(html, /role="status"/);
    assert.equal(f.reads(), 0);
    assert.equal(f.requests.length, 0);
});

test('actual StrictMode status commits one intent, stays passive and removes its owned subscription', async (t) => {
    const d = await dom(t),
        f = fixture();
    const focus = d.window.document.createElement('button');
    d.window.document.body.prepend(focus);
    focus.focus();
    const root = d.createRoot(d.container as unknown as HTMLElement);
    await act(async () =>
        root.render(
            h(
                StrictMode,
                null,
                h(AutomaticPrefillStatus, {
                    coordinator: f.coordinator,
                    labels: { submitting: 'Envoi automatique…' },
                })
            )
        )
    );
    assert.equal(f.requests.length, 1);
    assert.equal(f.listeners.size, 1);
    assert.equal(
        d.container.querySelector('[role="status"]')?.textContent,
        'Envoi automatique…'
    );
    assert.equal(d.container.querySelector('input,button,a'), null);
    assert.equal(d.window.document.activeElement, focus);
    await act(async () => root.unmount());
    assert.equal(f.listeners.size, 0);
    assert.equal(f.requests[0].admitAllocation().status, 'refused');
});

test('SDK owns the allocated success and error status leaves', async (t) => {
    const d = await dom(t),
        f = fixture();
    const root = d.createRoot(d.container as unknown as HTMLElement);
    await act(async () =>
        root.render(
            h(AutomaticPrefillStatus, {
                coordinator: f.coordinator,
                labels: { saved: 'Envoyé.' },
            })
        )
    );
    const request = f.requests[0],
        admission = request.admitAllocation();
    assert.equal(admission.status, 'admitted');
    if (admission.status !== 'admitted') return;
    await act(async () => {
        request.didAllocate(admission.allocation);
        request.didSettle({
            status: 'saved',
            allocation: admission.allocation,
        });
    });
    assert.equal(
        d.container.querySelector('[data-state="saved"]')?.textContent,
        'Envoyé.'
    );
    assert.equal(
        d.container.querySelector('.mx-sdk-automatic-prefill-spinner'),
        null
    );
    await act(async () => root.unmount());
});

const errorLabels = {
    failedToSave: 'Échec de l’envoi.',
    unknown: 'État de l’envoi inconnu.',
};
const errorMessages = [
    { name: 'missing host text', message: undefined },
    { name: 'empty host text', message: '' },
    { name: 'whitespace-only host text', message: ' \t\n ' },
    { name: 'meaningful host text', message: '  Erreur admise <img src=x>  ' },
] as const;

for (const status of ['failed', 'unknown'] as const) {
    for (const { name, message } of errorMessages) {
        const fallback =
            status === 'unknown'
                ? errorLabels.unknown
                : errorLabels.failedToSave;
        const expected = name === 'meaningful host text' ? message : fallback;
        test(`presents ${status} with ${name} while preserving focus and one submission`, async (t) => {
            const d = await dom(t),
                f = fixture();
            const focus = d.window.document.createElement('button');
            d.window.document.body.prepend(focus);
            focus.focus();
            const root = d.createRoot(d.container as unknown as HTMLElement);
            try {
                await act(async () =>
                    root.render(
                        h(AutomaticPrefillStatus, {
                            coordinator: f.coordinator,
                            labels: errorLabels,
                        })
                    )
                );
                assert.equal(f.requests.length, 1);
                assert.ok(
                    d.container.querySelector(
                        '.mx-sdk-automatic-prefill-spinner'
                    )
                );
                const request = f.requests[0],
                    admission = request.admitAllocation();
                assert.equal(admission.status, 'admitted');
                if (admission.status !== 'admitted')
                    throw new Error('Missing allocation permit');
                await act(async () => {
                    request.didAllocate(admission.allocation);
                    request.didSettle({
                        status,
                        allocation: admission.allocation,
                        message,
                    });
                });
                const alert = d.container.querySelector('[role="alert"]');
                assert.ok(alert);
                assert.equal(alert.textContent, expected);
                assert.equal(alert.getAttribute('aria-live'), 'assertive');
                assert.equal(alert.hasAttribute('aria-busy'), false);
                assert.equal(
                    alert.getAttribute('data-state'),
                    status === 'failed' ? 'error' : 'unknown'
                );
                assert.equal(
                    d.container.querySelector(
                        '.mx-sdk-automatic-prefill-spinner'
                    ),
                    null
                );
                assert.equal(d.container.querySelector('img'), null);
                assert.equal(f.coordinator.getSnapshot().outcome, status);
                assert.ok(d.window.document.activeElement === focus);
                assert.equal(f.requests.length, 1);
            } finally {
                await act(async () => root.unmount());
            }
        });
    }
}

test('an old allocated outcome cannot replace a new coordinator presentation', async (t) => {
    const d = await dom(t),
        old = fixture(),
        next = fixture();
    const root = d.createRoot(d.container as unknown as HTMLElement);
    await act(async () =>
        root.render(h(AutomaticPrefillStatus, { coordinator: old.coordinator }))
    );
    const request = old.requests[0],
        admission = request.admitAllocation();
    assert.equal(admission.status, 'admitted');
    if (admission.status !== 'admitted') return;
    await act(async () => request.didAllocate(admission.allocation));
    // Deliberate host fact change before this new model's first committed read.
    next.updateFacts({ acceptedURLFieldIds: [] });
    await act(async () =>
        root.render(
            h(AutomaticPrefillStatus, {
                coordinator: next.coordinator,
                labels: { noPrefills: 'Aucune donnée URL.' },
            })
        )
    );
    assert.equal(next.requests.length, 0);
    await act(async () =>
        request.didSettle({ status: 'saved', allocation: admission.allocation })
    );
    assert.equal(
        old.coordinator.getSnapshot().outcome,
        'saved',
        'native settlement remains recorded'
    );
    assert.equal(
        d.container.querySelector('[role="alert"]')?.textContent,
        'Aucune donnée URL.'
    );
    await act(async () => root.unmount());
});
