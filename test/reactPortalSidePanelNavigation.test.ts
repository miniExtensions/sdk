import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    PortalSidePanelNavigation,
    type PortalSidePanelNavigationFrame,
    type PortalSidePanelNavigationProps,
    type PortalSidePanelNavigationRequest,
} from '../src/react/PortalSidePanelNavigation.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const middle: PortalSidePanelNavigationFrame = {
    ownerToken: {},
    sourceExtensionSessionId: 'sessionB',
    sourceRecordId: 'B',
    previousRecordId: 'A',
    nextRecordId: 'C',
};
const labels = { previous: 'Précédent', next: 'Suivant', group: 'Fiches' };
const defaults: PortalSidePanelNavigationProps = {
    frame: middle,
    labels,
    isCurrent: () => true,
    confirmDismissal: () => true,
    openAdjacent: () => assert.fail('Unexpected open'),
};
const deferred = () => {
    let resolve!: (accept: boolean) => void;
    const promise = new Promise<boolean>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
};

it('renders localized non-submitting controls, disables missing directions and hides direct links', () => {
    assert.equal(
        renderToString(
            h(PortalSidePanelNavigation, { ...defaults, frame: null })
        ),
        ''
    );
    assert.equal(
        renderToString(
            h(PortalSidePanelNavigation, {
                ...defaults,
                frame: {
                    ...middle,
                    previousRecordId: null,
                    nextRecordId: null,
                },
            })
        ),
        ''
    );
    const first = renderToString(
        h(PortalSidePanelNavigation, {
            ...defaults,
            frame: { ...middle, previousRecordId: null },
        })
    );
    assert.match(first, /aria-label="Fiches" role="group"/);
    assert.match(first, /type="button" disabled="".*Précédent/);
    assert.match(first, /type="button" class="[^"]+">Suivant/);

    const iconButtons = renderToString(
        h(PortalSidePanelNavigation, {
            ...defaults,
            icons: { previous: h('svg'), next: h('svg') },
        })
    );
    assert.match(iconButtons, /type="button" aria-label="Précédent"/);
    assert.match(iconButtons, /type="button" aria-label="Suivant"/);
    assert.equal(
        (
            iconButtons.match(
                /<span aria-hidden="true"><svg><\/svg><\/span>/g
            ) ?? []
        ).length,
        2
    );
});

it('refuses accepted dismissal from a replaced same-record frame, coalesces repeat activation and opens exactly once from the fresh frame', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    let offered = middle;
    const confirmations: Array<ReturnType<typeof deferred>> = [];
    const requests: PortalSidePanelNavigationRequest[] = [];
    const opened: string[] = [];
    const props: PortalSidePanelNavigationProps = {
        ...defaults,
        isCurrent: (request) => request.ownerToken === offered.ownerToken,
        confirmDismissal: (request) => {
            requests.push(request);
            const gate = deferred();
            confirmations.push(gate);
            return gate.promise;
        },
        openAdjacent: (request) => {
            assert.equal(request.signal.aborted, false);
            opened.push(request.recordId);
        },
    };
    const render = () =>
        fixture.render(
            h(PortalSidePanelNavigation, { ...props, frame: offered })
        );
    await render();
    const next = fixture.container.querySelectorAll('button')[1];
    assert(next);
    await act(async () => {
        next.focus();
        next.click();
        next.click();
    });
    assert.equal(confirmations.length, 1);
    assert.equal(requests[0]?.recordId, 'C');
    const replaced = offered;
    offered = { ...offered, ownerToken: {} };
    await render();
    assert.equal(requests[0]?.signal.aborted, true);
    assert.equal(next, fixture.window.document.activeElement);
    await act(async () => confirmations[0]?.resolve(true));
    assert.deepEqual(opened, []);
    await act(async () => next.click());
    assert.equal(confirmations.length, 2);
    assert.notEqual(requests[1]?.ownerToken, replaced.ownerToken);
    await act(async () => confirmations[1]?.resolve(true));
    assert.deepEqual(opened, ['C']);
    assert.equal(requests[1]?.signal.aborted, true);
});

it('rejects a retired host currentness lease, cancelled dismissal and completion after unmount', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const requests: PortalSidePanelNavigationRequest[] = [];
    const confirmations: Array<ReturnType<typeof deferred>> = [];
    const opened: string[] = [];
    let current = true;
    await fixture.render(
        h(PortalSidePanelNavigation, {
            ...defaults,
            isCurrent: () => current,
            openAdjacent: (request) => {
                opened.push(request.recordId);
            },
            confirmDismissal: (request) => {
                const gate = deferred();
                confirmations.push(gate);
                requests.push(request);
                return gate.promise;
            },
        })
    );
    const previous = fixture.container.querySelector('button');
    assert(previous);
    await act(async () => previous.click());
    assert.equal(requests[0]?.type, 'previous');
    assert.equal(requests[0]?.recordId, 'A');
    current = false;
    await act(async () => confirmations[0]?.resolve(true));
    current = true;
    await act(async () => previous.click());
    await act(async () => confirmations[1]?.resolve(false));
    await act(async () => previous.click());
    assert.equal(requests.length, 3);
    await fixture.render(null);
    assert.equal(requests[2]?.signal.aborted, true);
    await act(async () => confirmations[2]?.resolve(true));
    assert.deepEqual(opened, []);
});

for (const outcome of ['opened', 'rejected', 'focus moved'] as const)
    it(`hands off the keyboard arrow only after its boundary open succeeds: ${outcome}`, async (t) => {
        const fixture = await htmlPresentationFixture(t);
        const completion = deferred();
        const opened: string[] = [];
        const props: PortalSidePanelNavigationProps = {
            ...defaults,
            async openAdjacent(request) {
                opened.push(request.recordId);
                if (!(await completion.promise))
                    throw new Error('Synthetic open rejection');
            },
        };
        const render = (frame: PortalSidePanelNavigationFrame) =>
            fixture.render(h(PortalSidePanelNavigation, { ...props, frame }));
        await render(middle);
        const [previous, next] = fixture.container.querySelectorAll('button');
        assert(previous && next);
        await act(async () => {
            next.focus();
            next.dispatchEvent(
                new fixture.window.KeyboardEvent('keydown', {
                    key: 'Enter',
                    bubbles: true,
                })
            );
            next.dispatchEvent(
                new fixture.window.MouseEvent('click', {
                    bubbles: true,
                    detail: 0,
                })
            );
        });
        assert.deepEqual(opened, ['C']);
        const document = fixture.window.document;
        if (outcome === 'focus moved') {
            const outside = document.createElement('button');
            document.body.append(outside);
            outside.focus();
            assert.ok(document.activeElement === outside);
            outside.remove();
        }
        await render({
            ownerToken: {},
            sourceExtensionSessionId: 'sessionC',
            sourceRecordId: 'C',
            previousRecordId: 'B',
            nextRecordId: null,
        });
        assert.equal(next.disabled, true);
        assert.ok(document.activeElement !== previous);
        await act(async () => completion.resolve(outcome !== 'rejected'));
        assert.equal(document.activeElement === previous, outcome === 'opened');
        fixture.unchangedEffects();
    });

it('drops a pending key or pointer press when the exact offered target changes', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const opened: string[] = [];
    const render = (next: string) =>
        fixture.render(
            h(PortalSidePanelNavigation, {
                ...defaults,
                frame: { ...middle, nextRecordId: next },
                openAdjacent: (request) => {
                    opened.push(request.recordId);
                },
            })
        );
    await render('C');
    const next = fixture.container.querySelectorAll('button')[1];
    assert(next);
    const click = (detail: number) =>
        next.dispatchEvent(
            new fixture.window.MouseEvent('click', {
                bubbles: true,
                button: 0,
                detail,
            })
        );
    await act(async () => {
        next.focus();
        next.dispatchEvent(
            new fixture.window.KeyboardEvent('keydown', {
                key: ' ',
                bubbles: true,
            })
        );
    });
    await render('D');
    await act(async () => {
        click(0);
    });
    assert.deepEqual(opened, []);
    await act(async () => {
        next.dispatchEvent(
            new fixture.window.PointerEvent('pointerdown', {
                bubbles: true,
                button: 0,
                isPrimary: true,
                pointerId: 1,
            })
        );
    });
    await render('C');
    await act(async () => {
        click(1);
    });
    assert.deepEqual(opened, []);
    assert.equal(next, fixture.window.document.activeElement);
    await act(async () => next.click());
    assert.deepEqual(opened, ['C']);
});
