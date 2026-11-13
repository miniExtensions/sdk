import { Window } from 'happy-dom';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { act, createElement as h } from 'react';
import {
    CompleteLinkedFinder,
    CompleteLinkedFinderView,
    type CompleteLinkedFinderViewProps,
} from '../../src/react/CompleteLinkedFinder.js';
import {
    createCompleteLinkedFinderCoordinator,
    type CompleteLinkedFinderCoordinator,
    type CompleteLinkedFinderHost,
    type CompleteLinkedFinderPage,
} from '../../src/ui/completeLinkedFinder.js';
import { scannerDom, deferred } from './scannerDom.js';
export type Row = { id: string };
export const labels = {
    search: 'Buscar',
    loading: 'Cargando',
    noMatches: 'Sin resultados',
    unavailable: 'No disponible',
    loadMore: 'Más',
};
export async function fixture(
    t: TestContext,
    strict = false,
    options: { external?: boolean; preview?: boolean } = {}
) {
    const f = await scannerDom(t);
    assert(
        f.window instanceof Window,
        'Use the real owned happy-dom fixture realm'
    );
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
