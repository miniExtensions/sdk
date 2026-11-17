import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    LinkedFinderCard,
    type LinkedFinderMapCardProjection,
} from '../src/react/LinkedFinderCard.js';
import {
    PortalMapCard,
    type PortalMapCardData,
} from '../src/react/PortalMapCard.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const projection = (
    primary = 'Visible primary',
    primaryIsEmpty = false
): LinkedFinderMapCardProjection => ({
    status: 'present',
    layout: 'map',
    primary,
    primaryIsEmpty,
});
const card = (patch: Partial<PortalMapCardData> = {}): PortalMapCardData => ({
    recordId: 'visible-record',
    identity: {},
    owner: { isCurrent: () => true },
    accessibleLabel: 'Admitted Map record',
    projection: projection(),
    ...patch,
});
function retainedClick(element: object): () => void {
    const property = Object.keys(element).find((name) =>
        name.startsWith('__reactProps$')
    );
    assert(property, 'Capture the actual mounted SDK React callback');
    const props = Reflect.get(element, property);
    assert.equal(typeof props.onClick, 'function');
    return props.onClick;
}

test('Map shared-card branch renders escaped primary/title/ARIA and no hidden details/images', async (t) => {
    const f = await htmlPresentationFixture(t);
    assert(f.window instanceof Window);
    const value = 'Unnamed <script>not markup</script>';
    const admitted = {
        ...projection(value, true),
        get images() {
            throw new Error('Map must not recover thumbnails');
        },
        get fields() {
            throw new Error('Map must not recover details');
        },
    };
    await f.render(h(LinkedFinderCard, { projection: admitted }));
    const primary = f.container.querySelector('p')!;
    assert.equal(primary.textContent, value);
    assert.equal(primary.getAttribute('title'), value);
    assert.equal(primary.getAttribute('aria-label'), value);
    assert(primary.classList.contains('mx-sdk-finder-map-primary-empty'));
    assert.equal(
        f.container.querySelector('img,script,a,.mx-sdk-finder-card-fields'),
        null
    );
    const html = renderToString(h(LinkedFinderCard, { projection: admitted }));
    assert(html.includes('&lt;script&gt;'));
});

test('Map loading/unavailable do not recover present data or infer an opener/review authority', async (t) => {
    const f = await htmlPresentationFixture(t);
    for (const status of ['loading', 'unavailable'] as const) {
        await f.render(
            h(PortalMapCard, {
                card: card({
                    projection: { status, label: `${status} localized` },
                    needsReviewLabel: 'Needs review',
                }),
            })
        );
        assert.equal(f.container.querySelector('button,img,a'), null);
        assert(f.container.textContent?.includes(`${status} localized`));
        assert.equal(
            f.container
                .querySelector('[role="img"]')
                ?.getAttribute('aria-label'),
            'Needs review'
        );
    }
});

test('real admitted opener is a non-submit keyboard button and no unlink surface exists', async (t) => {
    const f = await htmlPresentationFixture(t);
    let opened = 0;
    await f.render(
        h(PortalMapCard, {
            card: card({
                open: {
                    label: 'Open current child',
                    activate: () => {
                        opened++;
                    },
                },
                needsReviewLabel: 'Needs review',
                ...({
                    unlink: {
                        label: 'Forbidden unlink',
                        activate: () => {
                            throw new Error('Forbidden');
                        },
                    },
                } as object),
            }),
        })
    );
    const buttons = f.container.querySelectorAll('button');
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0]!.type, 'button');
    assert.equal(buttons[0]!.getAttribute('aria-label'), 'Open current child');
    buttons[0]!.click();
    assert.equal(opened, 1);
    assert.equal(f.container.textContent?.includes('Forbidden unlink'), false);
});

test('Map presentation A/B/A and owner retirement fence retained actual click callbacks', async (t) => {
    const f = await htmlPresentationFixture(t);
    const a = {},
        b = {};
    let active = true,
        opened = 0;
    const current = { isCurrent: () => active };
    const open = {
        label: 'Open',
        activate: () => {
            opened++;
        },
    };
    const render = (identity: object) =>
        f.render(
            h(PortalMapCard, { card: card({ identity, owner: current, open }) })
        );
    await render(a);
    const firstA = retainedClick(f.container.querySelector('button')!);
    await render(b);
    const firstB = retainedClick(f.container.querySelector('button')!);
    await render(a);
    const nextA = retainedClick(f.container.querySelector('button')!);
    firstA();
    firstB();
    assert.equal(opened, 0);
    nextA();
    assert.equal(opened, 1);
    active = false;
    nextA();
    assert.equal(opened, 1);
    await f.render(null);
    nextA();
    assert.equal(opened, 1);
});

test('delayed A/B/A registration belongs to its exact presentation and cannot clear a successor', async (t) => {
    const f = await htmlPresentationFixture(t);
    f.container.remove();
    let active: object | null = null;
    const disposers: (() => void)[] = [];
    const registerTrigger = (element: HTMLButtonElement) => {
        assert(element.isConnected);
        const lease = {};
        active = lease;
        const dispose = () => {
            if (active === lease) active = null;
        };
        disposers.push(dispose);
        return dispose;
    };
    const open = { label: 'Open', activate() {}, registerTrigger };
    const a = {},
        b = {};
    for (const identity of [a, b, a]) {
        await f.render(h(PortalMapCard, { card: card({ identity, open }) }));
        assert.equal(active, null);
        assert.equal(disposers.length, 0);
    }
    f.window.document.body.append(f.container);
    await act(async () => f.window.happyDOM.waitUntilComplete());
    assert(active);
    assert.equal(disposers.length, 1);
    const old = disposers[0]!;
    await f.render(h(PortalMapCard, { card: card({ identity: {}, open }) }));
    const successor = active;
    assert(successor);
    old();
    assert.equal(active, successor);
    await f.render(null);
    assert.equal(active, null);
});

test('captured host admission guard fences synchronous retirement before allocation', async (t) => {
    const f = await htmlPresentationFixture(t);
    let checks = 0,
        opened = 0,
        activationAttempts = 0;
    let active = true;
    const current = {
        isCurrent: () => {
            checks++;
            const value = active;
            active = false;
            return value;
        },
    };
    // Reset after effect registration (there is intentionally no registration port here).
    await f.render(
        h(PortalMapCard, {
            card: card({
                owner: current,
                open: {
                    label: 'Open',
                    activate: () => {
                        activationAttempts++;
                        if (current.isCurrent()) opened++;
                    },
                },
            }),
        })
    );
    active = true;
    checks = 0;
    f.container.querySelector('button')!.click();
    assert.equal(opened, 0);
    assert.equal(activationAttempts, 1);
    assert.equal(checks, 2);
});

async function detachedRegistration(t: TestContext) {
    const f = await htmlPresentationFixture(t);
    f.container.remove();
    const disconnect = t.mock.method(
        f.window.MutationObserver.prototype,
        'disconnect'
    );
    const registrations: HTMLButtonElement[] = [];
    let releases = 0;
    const registerTrigger = (element: HTMLButtonElement) => {
        assert(
            element.isConnected,
            'Never ask the host to admit a detached trigger'
        );
        registrations.push(element);
        return () => {
            releases++;
        };
    };
    const settle = () => act(async () => f.window.happyDOM.waitUntilComplete());
    return {
        ...f,
        registrations,
        registerTrigger,
        disconnect,
        settle,
        releases: () => releases,
    };
}

test('same detached Map button registers once on actual connection without a rerender', async (t) => {
    const f = await detachedRegistration(t);
    await f.render(
        h(PortalMapCard, {
            card: card({
                open: {
                    label: 'Open',
                    activate() {},
                    registerTrigger: f.registerTrigger,
                },
            }),
        }),
        false
    );
    const button = f.container.querySelector('button')!;
    assert.equal(button.isConnected, false);
    assert.equal(f.registrations.length, 0);
    assert.equal(f.disconnect.mock.calls.length, 0);
    f.window.document.body.append(f.container);
    await f.settle();
    assert.equal(f.registrations.length, 1);
    assert.equal(f.registrations[0], button);
    assert.equal(f.disconnect.mock.calls.length, 1);
    f.window.document.body.append(f.window.document.createElement('div'));
    await f.settle();
    assert.equal(f.registrations.length, 1);
    await f.render(null, false);
    assert.equal(f.releases(), 1);
});

test('owner retirement before attachment never registers or revives a queued trigger', async (t) => {
    const f = await detachedRegistration(t);
    let current = true;
    await f.render(
        h(PortalMapCard, {
            card: card({
                owner: { isCurrent: () => current },
                open: {
                    label: 'Open',
                    activate() {},
                    registerTrigger: f.registerTrigger,
                },
            }),
        }),
        false
    );
    current = false;
    f.window.document.body.append(f.container);
    await f.settle();
    assert.equal(f.registrations.length, 0);
    assert.equal(f.disconnect.mock.calls.length, 1);
    current = true;
    f.window.document.body.append(f.window.document.createElement('div'));
    await f.settle();
    assert.equal(f.registrations.length, 0);
    assert.equal(f.releases(), 0);
});

test('unmount before attachment disconnects the waiter and cannot register later', async (t) => {
    const f = await detachedRegistration(t);
    await f.render(
        h(PortalMapCard, {
            card: card({
                open: {
                    label: 'Open',
                    activate() {},
                    registerTrigger: f.registerTrigger,
                },
            }),
        }),
        false
    );
    await f.render(null, false);
    assert.equal(f.disconnect.mock.calls.length, 1);
    f.window.document.body.append(f.container);
    await f.settle();
    assert.equal(f.registrations.length, 0);
    assert.equal(f.releases(), 0);
});

test('connection registration immediately disposes its exact lease on synchronous retirement', async (t) => {
    const f = await detachedRegistration(t);
    let current = true;
    await f.render(
        h(PortalMapCard, {
            card: card({
                owner: { isCurrent: () => current },
                open: {
                    label: 'Open',
                    activate() {},
                    registerTrigger: (element) => {
                        const dispose = f.registerTrigger(element);
                        current = false;
                        return dispose;
                    },
                },
            }),
        }),
        false
    );
    f.window.document.body.append(f.container);
    await f.settle();
    assert.equal(f.registrations.length, 1);
    assert.equal(f.releases(), 1);
    assert.equal(f.disconnect.mock.calls.length, 1);
    await f.render(null, false);
    assert.equal(
        f.releases(),
        1,
        'Retired registration must not dispose twice'
    );
});

test('delayed registration preserves the current Open method receiver', async (t) => {
    const f = await detachedRegistration(t);
    let receiver: unknown;
    const open = {
        label: 'Current Open receiver',
        activate() {},
        registerTrigger(element: HTMLButtonElement) {
            receiver = this;
            assert.equal(this.label, 'Current Open receiver');
            return f.registerTrigger(element);
        },
    };
    await f.render(h(PortalMapCard, { card: card({ open }) }), false);
    assert.equal(f.registrations.length, 0);
    f.window.document.body.append(f.container);
    await f.settle();
    assert.equal(receiver, open);
    assert.equal(f.registrations.length, 1);
    await f.render(null, false);
    assert.equal(f.releases(), 1);
});
