import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createElement as h } from 'react';
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

test('registration cleanup belongs to its exact presentation and cannot clear a successor', async (t) => {
    const f = await htmlPresentationFixture(t);
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
    await f.render(h(PortalMapCard, { card: card({ identity: {}, open }) }));
    assert(active);
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
