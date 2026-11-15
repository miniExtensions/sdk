import { Window } from 'happy-dom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    CompleteLinkedFinder,
    type CompleteLinkedFinderProps,
} from '../src/react/index.js';
import {
    fixture,
    labels,
    type Row,
} from './fixtures/completeLinkedFinderDom.js';

test('finder SSR exposes localized search text without client/transport allocation', () => {
    const props = {
        searchTerm: 'Initial scan',
        labels,
    } as CompleteLinkedFinderProps<Row, string, object>;
    const html = renderToString(
        h(CompleteLinkedFinder<Row, string, object>, props)
    );
    assert.match(html, /aria-label="Buscar"/);
    assert.match(html, /value="Initial scan"/);
});

test('external view reuses native prefetch, preserves one coordinator through StrictMode and leaves its lifetime with the host', async (t) => {
    const f = await fixture(t, true, { external: true });
    assert(f.window instanceof Window);
    await f.settle();
    assert.equal(f.reads.length, 0);
    let pending!: ReturnType<NonNullable<typeof f.coordinator>['queryNow']>;
    await act(async () => {
        pending = f.coordinator!.queryNow({
            filter: 'native-prefetch',
            resetOffset: true,
        });
    });
    await f.resolve(['A', 'B']);
    assert.equal((await pending).status, 'accepted');
    assert.equal(
        f.host.querySelectorAll('[data-testid="linked-record-selector-item"]')
            .length,
        0
    );
    await f.render({
        queryKey: 'native-open',
        optionTestId: 'linked-record-selector-item',
    });
    assert.equal(f.reads.length, 1);
    assert.equal(f.host.querySelectorAll('[role="option"]').length, 2);
    const nativeRows = f.host.querySelectorAll(
        '[data-testid="linked-record-selector-item"]'
    );
    assert.equal(nativeRows.length, 2);
    assert.equal(nativeRows[0].getAttribute('role'), 'option');
    await f.render({
        closeAfterToggle: true,
        optionTestId: 'linked-record-selector-item',
    });
    await act(async () =>
        (
            f.host.querySelectorAll(
                '[data-testid="linked-record-selector-item"]'
            )[0] as unknown as HTMLElement
        ).click()
    );
    assert.deepEqual(f.toggles, ['A']);
    assert.equal(f.closeCount(), 0);
    await act(async () =>
        (
            f.host.querySelectorAll(
                '[role="option"]'
            )[1] as unknown as HTMLElement
        ).click()
    );
    assert.deepEqual(f.toggles, ['A', 'B']);
    assert.equal(f.closeCount(), 1);
    await f.unmount();
    assert.notEqual(f.coordinator!.getSnapshot().owner, null);
    assert.equal(f.coordinator!.model.getState().options.length, 2);
});

test('owner-bound authenticated preview renders native cards and paging without a candidate model or loading presentation', async (t) => {
    const f = await fixture(t, false, { external: true, preview: true });
    const coordinator = f.coordinator!;
    let pending!: ReturnType<typeof coordinator.queryNow>;
    await act(async () => {
        pending = coordinator.queryNow({
            filter: 'preview',
            resetOffset: true,
        });
    });
    assert.equal(f.host.querySelector('[role="status"]'), null);
    await f.resolve(['A', 'B'], 'native-next');
    const result = await pending;
    assert.equal(result.status, 'accepted');
    if (result.status !== 'accepted')
        throw new Error('Expected preview receipt');
    assert.equal(result.preview, true);
    await f.render({
        previewPresentation: {
            expectedOwner: result.owner,
            candidateIds: ['A', 'private', 'B', 'A'],
            offset: 'native-next',
            error: null,
        },
    });
    assert.equal(f.host.querySelectorAll('[role="option"]').length, 2);
    assert.equal(f.host.querySelector('[role="status"]'), null);
    assert.deepEqual(coordinator.model.getState().options, []);
    assert.deepEqual(coordinator.getSnapshot().rawRecords, []);
    assert.equal(f.observers.length, 1);
    await act(async () => f.replace());
    assert.equal(f.host.querySelectorAll('[role="option"]').length, 0);
    assert.equal(f.observers[0].disconnected, true);
    assert.equal(f.reads.length, 1);
});

test('real multi-combobox shows admitted rows, preserves hidden canonical duplicates and toggles one duplicate ID', async (t) => {
    const f = await fixture(t, true);
    await f.settle();
    assert.equal(f.reads.length, 1);
    await f.resolve(['A', 'private', 'B', 'A']);
    const options = [...f.host.querySelectorAll('[role="option"]')];
    assert.equal(options.length, 2);
    assert.equal(options[0].getAttribute('aria-selected'), 'true');
    assert.equal(options[1].getAttribute('aria-selected'), 'false');
    await act(async () => (options[0] as unknown as HTMLElement).click());
    assert.deepEqual(f.toggles, ['A']);
    assert.deepEqual(f.canonical, ['hidden']);
    assert.equal(
        f.host.querySelector('[role="option"]')?.getAttribute('aria-selected'),
        'false'
    );
});

test('keyboard/focus and programmatic controlled search echoes preserve current query and canonical membership', async (t) => {
    const f = await fixture(t);
    await f.settle();
    await f.resolve(['A', 'B']);
    const input = f.host.querySelector('input')!;
    await act(async () => {
        input.focus();
        input.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'ArrowDown',
                bubbles: true,
            })
        );
    });
    await f.tick();
    await act(async () =>
        input.dispatchEvent(
            new f.window.KeyboardEvent('keydown', { key: 'End', bubbles: true })
        )
    );
    await f.tick();
    await act(async () =>
        input.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
            })
        )
    );
    assert.deepEqual(f.toggles, ['B']);
    assert.deepEqual(f.canonical, ['hidden', 'A', 'A', 'B']);
    await f.render({ searchTerm: 'Scanned value', filter: 'Scanned value' });
    assert.equal(input.value, 'Scanned value');
    assert.equal(f.reads.length, 1);
    assert.equal(f.document.activeElement, input);
});

test('400px observer paginates exact offset and retires callbacks on owner replacement without cancelling allocated reads', async (t) => {
    const f = await fixture(t);
    await f.settle();
    await f.resolve(['A'], 'next');
    const observed = f.observers.at(-1)!;
    assert.equal(observed.options?.rootMargin, '400px');
    assert.equal(
        observed.options?.root,
        f.host.querySelector('.mx-sdk-finder-scroll')
    );
    await act(async () =>
        observed.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver
        )
    );
    assert.equal(f.reads[1].offset, 'next');
    assert.equal(
        f.host
            .querySelector('[role="option"]')
            ?.textContent?.includes('Card A'),
        true
    );
    await act(async () => f.replace());
    assert.equal(observed.disconnected, true);
    await f.resolve(['old-private'], null, 1);
    assert.equal(f.host.textContent.includes('old-private'), false);
    await f.settle();
    assert.equal(f.reads.length, 3);
    await f.resolve(['new-owner']);
    assert.match(f.host.textContent, /Card new-owner/);
});

test('disabled selection still permits searching and blocks scanner and canonical writes', async (t) => {
    const f = await fixture(t);
    await f.settle();
    await f.resolve(['A']);
    await act(async () => f.disable());
    assert.equal(f.host.querySelector('input')?.disabled, false);
    assert.equal(
        f.host.querySelector('[role="option"]')?.getAttribute('aria-disabled'),
        'true'
    );
    await act(async () =>
        (
            f.host.querySelector('[role="option"]') as unknown as HTMLElement
        ).click()
    );
    assert.deepEqual(f.toggles, []);
    assert.deepEqual(f.canonical, ['hidden', 'A', 'A']);
    assert.equal(
        f.host.querySelector('[data-testid="qr-scanner-button"]'),
        null
    );
});
