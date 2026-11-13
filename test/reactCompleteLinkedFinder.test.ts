import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    CompleteLinkedFinder,
    CompleteLinkedFinderView,
    type CompleteLinkedFinderProps,
    type CompleteLinkedFinderViewProps,
} from '../src/react/index.js';
import {
    createCompleteLinkedFinderCoordinator,
    type CompleteLinkedFinderCoordinator,
    CompleteLinkedFinderHost,
    CompleteLinkedFinderPage,
} from '../src/ui/index.js';
import { scannerDom, deferred } from './fixtures/scannerDom.js';
type Row = { id: string };
const labels = {
    search: 'Buscar',
    loading: 'Cargando',
    noMatches: 'Sin resultados',
    unavailable: 'No disponible',
    loadMore: 'Más',
};
async function fixture(
    t: TestContext,
    strict = false,
    options: { external?: boolean; preview?: boolean } = {}
) {
    const f = await scannerDom(t);
    let owner = {};
    const canonical = ['hidden', 'A', 'A'];
    const listeners = new Set<() => void>();
    const reads: {
        filter: string;
        offset: string | null;
        result: ReturnType<typeof deferred<CompleteLinkedFinderPage<Row>>>;
    }[] = [];
    const toggles: string[] = [];
    const published: CompleteLinkedFinderPage<Row>[] = [];
    let closes = 0;
    const observers: {
        callback: IntersectionObserverCallback;
        options?: IntersectionObserverInit;
        disconnected: boolean;
    }[] = [];
    class Observer {
        entry: (typeof observers)[number];
        constructor(
            callback: IntersectionObserverCallback,
            options?: IntersectionObserverInit
        ) {
            this.entry = { callback, options, disconnected: false };
            observers.push(this.entry);
        }
        observe() {}
        disconnect() {
            this.entry.disconnected = true;
        }
    }
    const original = Object.getOwnPropertyDescriptor(
        globalThis,
        'IntersectionObserver'
    );
    Object.defineProperty(globalThis, 'IntersectionObserver', {
        configurable: true,
        value: Observer,
    });
    t.after(() => {
        if (original)
            Object.defineProperty(globalThis, 'IntersectionObserver', original);
        else Reflect.deleteProperty(globalThis, 'IntersectionObserver');
    });
    let enabled = true;
    const notify = () => {
        for (const listener of listeners) listener();
    };
    const host: CompleteLinkedFinderHost<Row, string, object> = {
        captureOwner: () => owner,
        isOwnerCurrent: (expected) => expected === owner,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        captureRead(expected, request) {
            return {
                mode: options.preview ? 'authenticated-preview' : 'public',
                isCurrent: () => expected === owner,
                query() {
                    const result = deferred<CompleteLinkedFinderPage<Row>>();
                    reads.push({ ...request, result });
                    return result.promise;
                },
                publish(page) {
                    published.push(page);
                    return { status: 'admitted' };
                },
            };
        },
        selection: () => ({
            ids: canonical,
            enabled,
            autoSelectScannedRecord: true,
        }),
        recordId: (row) => row.id,
        isOptionEnabled: () => true,
        toggle(expected, id) {
            if (expected !== owner || !enabled) return { status: 'refused' };
            toggles.push(id);
            const next = canonical.includes(id)
                ? canonical.filter((value) => value !== id)
                : [...canonical, id];
            canonical.splice(0, canonical.length, ...next);
            notify();
            return { status: 'admitted' };
        },
        close: () => {
            closes++;
            return { status: 'admitted' };
        },
        errorMessage: () => 'Query unavailable',
    };
    const external = options.external
        ? createCompleteLinkedFinderCoordinator(host, { testing: true })
        : null;
    t.after(() => external?.destroy());
    let props: CompleteLinkedFinderViewProps<Row, string, object> = {
        coordinator: external,
        queryOnMount: !options.external,
        host,
        filter: '',
        queryKey: 'context',
        searchTerm: '',
        onSearchTermChange() {},
        filterForSearch: (term) => term,
        labels,
        testing: true,
        candidates: (_owner, ids) =>
            ids
                .filter((id) => id !== 'private')
                .map((id) => ({
                    id,
                    projection: {
                        status: 'present',
                        primary: `Card ${id}`,
                        fields: [],
                        images: [],
                        language: 'en',
                        layout: 'list',
                        imageFit: 'cover',
                        imageHeight: 80,
                        shouldRenderThumbnail: true,
                        thumbnailLocation: 'right',
                        fieldsPerCardRow: 1,
                        labels: {
                            previousImage: 'Previous',
                            nextImage: 'Next',
                            noImage: 'No image',
                        },
                    },
                })),
    };
    const render = async (patch: Partial<typeof props> = {}) => {
        props = { ...props, ...patch };
        await f.render(
            options.external
                ? h(CompleteLinkedFinderView<Row, string, object>, props)
                : h(CompleteLinkedFinder<Row, string, object>, props),
            strict
        );
    };
    await render();
    const settle = async () =>
        act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
    const resolve = async (
        ids: string[],
        offset: string | null = null,
        index = reads.length - 1
    ) =>
        act(async () =>
            reads[index].result.resolve({
                records: ids.map((id) => ({ id })),
                offset,
            })
        );
    return {
        ...f,
        ports: host,
        canonical,
        reads,
        toggles,
        published,
        coordinator: external as CompleteLinkedFinderCoordinator<
            Row,
            string,
            object
        > | null,
        closeCount: () => closes,
        observers,
        render,
        settle,
        resolve,
        replace: () => {
            owner = {};
            notify();
        },
        disable: () => {
            enabled = false;
            notify();
        },
    };
}

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
    await f.render({ queryKey: 'native-open' });
    assert.equal(f.reads.length, 1);
    assert.equal(f.host.querySelectorAll('[role="option"]').length, 2);
    await f.render({ closeAfterToggle: true });
    await act(async () =>
        (
            f.host.querySelectorAll(
                '[role="option"]'
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
