import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    PortalPagingControls,
    type PortalPagingControlsState,
    type PortalPagingIntent,
    type PortalPagingOffer,
} from '../src/react/PortalPagingControls.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const ready = { type: 'ready', hasNextPage: true } as const;
const labels = { loadMore: 'Plus de résultats', retry: 'Réessayer' };

it('presents each host status without starting a read', () => {
    const offer: PortalPagingOffer = {
        activate: () => assert.fail('unexpected activation'),
    };
    const html = (state: PortalPagingControlsState, includeOffer = true) =>
        renderToString(
            h(PortalPagingControls, {
                state,
                offer: includeOffer ? offer : undefined,
            })
        );
    assert.equal(html({ type: 'initial-loading' }), '');
    assert.equal(html({ type: 'ready', hasNextPage: false }), '');
    assert.match(html(ready), /type="button".*>Load more</);
    assert.match(html(ready, false), /disabled/);
    assert.match(
        html({ type: 'next-loading' }),
        /disabled.*aria-busy="true".*>Load more</
    );
    for (const type of ['first-error', 'next-error'] as const) {
        assert.match(
            html({ type, message: 'Unavailable' }),
            /role="alert">Unavailable.*>Retry</
        );
    }
    const configuration = html({
        type: 'configuration-error',
        message: 'Invalid view',
    });
    assert.match(configuration, /role="alert">Invalid view/);
    assert.doesNotMatch(configuration, /button/);
});

it('delivers at most one intent per offer while the host retains admission and rearming', async (t) => {
    const f = await htmlPresentationFixture(t);
    const received: PortalPagingIntent[] = [];
    const guards: Array<() => boolean> = [];
    const action = (): PortalPagingOffer => ({
        activate(intent, isCurrent) {
            received.push(intent);
            guards.push(isCurrent);
        },
    });
    const render = (
        state: PortalPagingControlsState,
        offer?: PortalPagingOffer
    ) => f.render(h(PortalPagingControls, { state, offer, labels }));
    const button = () => f.container.querySelector('button')!;
    const first = action();
    await render(ready, first);
    assert.equal(button().textContent, labels.loadMore);
    await act(async () => {
        button().click();
        button().click();
    });
    assert.deepEqual(received, ['next-page']);
    assert.equal(guards[0](), true);
    await render({ type: 'next-loading' });
    assert.equal(button().disabled, true);
    assert.equal(guards[0](), false);

    await render({ type: 'next-error', message: 'Page unavailable' }, action());
    assert.equal(button().textContent, labels.retry);
    await act(async () => button().click());
    await render(
        { type: 'first-error', message: 'First unavailable' },
        action()
    );
    await act(async () => button().click());
    assert.deepEqual(received, [
        'next-page',
        'retry-next-page',
        'retry-first-page',
    ]);
    assert.equal(guards[1](), false);
    await render(ready, first);
    await act(async () => button().click());
    assert.equal(received.length, 3);
    assert.equal(guards[0](), false);
});

it('retires a held pointer or key activation when the host replaces its offer', async (t) => {
    const f = await htmlPresentationFixture(t);
    const calls: string[] = [];
    const render = (owner: string) =>
        f.render(
            h(PortalPagingControls, {
                state: ready,
                offer: { activate: () => calls.push(owner) },
            })
        );
    await render('old');
    const button = f.container.querySelector('button')!;
    button.focus();
    const pointer = (type: string) =>
        button.dispatchEvent(
            new f.window.PointerEvent(type, {
                bubbles: true,
                button: 0,
                isPrimary: true,
            })
        );
    const key = (name: string, repeat = false) =>
        button.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: name,
                repeat,
            })
        );
    const click = (detail: number) =>
        button.dispatchEvent(
            new f.window.MouseEvent('click', { bubbles: true, detail })
        );

    await act(async () => {
        pointer('pointerdown');
    });
    await render('current');
    await act(async () => {
        click(1);
        key(' ');
    });
    await render('newer');
    await act(async () => {
        click(0);
    });
    assert.deepEqual(calls, []);
    assert.equal(f.window.document.activeElement, button);
    await act(async () => {
        pointer('pointerdown');
        pointer('pointercancel');
        click(1);
        key('Escape');
        assert.equal(key('Enter', true), false);
        key('Enter');
        click(0);
    });
    assert.deepEqual(calls, ['newer']);
});
