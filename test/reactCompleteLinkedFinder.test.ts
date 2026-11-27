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
    const search = '.mx-sdk-finder-search';
    const presentation = '.mx-sdk-native-form-list-finder';
    assert.equal(f.host.querySelector(presentation), null);
    assert.equal(f.host.querySelector(`${search} > span`)?.textContent, '⌕');
    assert.equal(
        f.host.querySelector('[role="option"] p')?.getAttribute('title'),
        null
    );
    await f.render({ nativeFormListPresentation: true });
    assert.equal(f.host.querySelector('input'), input);
    assert.equal(
        f.host
            .querySelector(`${presentation} ${search} > svg`)
            ?.getAttribute('aria-hidden'),
        'true'
    );
    assert.equal(
        f.host.querySelector('[role="option"] p')?.getAttribute('title'),
        'Card A'
    );
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

test('native Form List Finder offers refresh after ten seconds of its first read', async (t) => {
    const f = await fixture(t, false, { external: true });
    const coordinator = f.coordinator!;
    await f.render({ nativeFormListPresentation: true });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => t.mock.timers.reset());
    const refreshButtons = () =>
        Array.from(f.host.querySelectorAll('button')).filter(
            (button) => button.textContent === 'Click here to refresh'
        );
    const refreshCount = () => refreshButtons().length;
    const reload = t.mock.method(f.window.location, 'reload', () => {});

    let pending!: ReturnType<typeof coordinator.queryNow>;
    await act(async () => {
        pending = coordinator.queryNow({ filter: '', resetOffset: true });
    });
    const loadingStatus = () =>
        f.host.querySelector('[role="status"]')?.textContent;
    const initialStatus = loadingStatus();
    assert.equal(
        f.host
            .querySelector('.mx-sdk-finder-initial-loading svg')
            ?.getAttribute('aria-hidden'),
        'true'
    );
    await act(async () => t.mock.timers.tick(9_999));
    const beforeDeadline = { status: loadingStatus(), refresh: refreshCount() };
    await act(async () => t.mock.timers.tick(1));
    const atDeadline = { status: loadingStatus(), refresh: refreshCount() };
    const button = refreshButtons()[0];
    assert(button);
    assert.equal(button.type, 'button');
    await act(async () => {
        button.focus();
        button.click();
    });
    assert.equal(f.document.activeElement, button);
    assert.equal(reload.mock.callCount(), 1);
    assert.equal(f.reads.length, 1);
    await f.resolve(['B']);
    assert.equal((await pending).status, 'accepted');
    const result = f.host.querySelector('[role="option"]')?.textContent;

    assert.equal(initialStatus, labels.loading);
    assert.deepEqual(
        { beforeDeadline, atDeadline, result, reads: f.reads.length },
        {
            beforeDeadline: { status: labels.loading, refresh: 0 },
            atDeadline: { status: labels.loading, refresh: 1 },
            result: 'Card B',
            reads: 1,
        }
    );
    assert.equal(refreshCount(), 0);
    assert.deepEqual(f.toggles, []);
});

test('native Form List Finder drops initial recovery after early settlement or close', async (t) => {
    const f = await fixture(t, false, { external: true });
    const coordinator = f.coordinator!;
    await f.render({ nativeFormListPresentation: true });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => t.mock.timers.reset());
    const loading = () =>
        f.host.querySelector('.mx-sdk-finder-initial-loading');
    const reload = t.mock.method(f.window.location, 'reload', () => {});
    const start = async () => {
        await act(async () => {
            void coordinator.queryNow({ filter: '', resetOffset: true });
        });
    };

    await start();
    assert(loading());
    await act(async () => t.mock.timers.tick(9_999));
    await f.resolve([]);
    await act(async () => t.mock.timers.tick(1));
    assert.equal(loading(), null);

    await start();
    await act(async () => t.mock.timers.tick(10_000));
    assert.equal(loading(), null);
    assert.equal(
        f.host.querySelector('[role="status"]')?.textContent,
        labels.loading
    );
    await f.resolve(['B']);

    await act(async () => f.replace());
    await start();
    assert(loading());
    await f.unmount();
    await act(async () => t.mock.timers.tick(10_000));
    assert.equal(loading(), null);
    assert.equal(reload.mock.callCount(), 0);
    assert.equal(f.reads.length, 3);
    assert.deepEqual(f.toggles, []);
});

test('native Form List Finder marks only settled no-match searches', async (t) => {
    const f = await fixture(t, false, { external: true });
    const coordinator = f.coordinator!;
    const terminal = () =>
        f.host.querySelector('.mx-sdk-finder-feedback--terminal');
    await f.render({ nativeFormListPresentation: true, searchTerm: 'missing' });
    assert.equal(terminal(), null);

    let pending!: ReturnType<typeof coordinator.queryNow>;
    await act(async () => {
        pending = coordinator.queryNow({
            filter: 'missing',
            resetOffset: true,
        });
    });
    assert.equal(
        f.host.querySelector('[role="status"]')?.textContent,
        labels.loading
    );
    assert.equal(terminal(), null);
    await f.resolve([], 'next');
    assert.equal((await pending).status, 'accepted');
    assert.equal(terminal(), null);
    assert(!f.host.textContent.includes(labels.noMatches));

    await act(async () => {
        pending = coordinator.queryNow({
            filter: 'missing',
            resetOffset: false,
        });
    });
    await f.resolve([]);
    assert.equal((await pending).status, 'accepted');
    assert.equal(terminal()?.textContent, labels.noMatches);

    await f.render({ searchTerm: '' });
    assert.equal(terminal(), null);
    await f.render({
        nativeFormListPresentation: false,
        searchTerm: 'missing',
    });
    assert.equal(terminal(), null);
    assert(f.host.textContent.includes(labels.noMatches));
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
