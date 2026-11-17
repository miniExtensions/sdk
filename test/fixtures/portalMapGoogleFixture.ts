import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';

/** Fake only the Google API. Vendor React components/portals and their DOM ownership stay real. */
export async function portalMapGoogleFixture(t: TestContext) {
    const window = new Window();
    const globals = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'Element',
        'Node',
        'HTMLButtonElement',
        'HTMLDivElement',
        'IS_REACT_ACT_ENVIRONMENT',
        'google',
    ] as const;
    const originals = globals.map((name) =>
        Object.getOwnPropertyDescriptor(globalThis, name)
    );
    for (const name of globals.filter((name) => name !== 'google'))
        Object.defineProperty(globalThis, name, {
            configurable: true,
            writable: true,
            value:
                name === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[name as keyof Window],
        });
    // Explicit bounded DOM measurement for the real vendor offset calculation.
    Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get: () => 100,
    });
    Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get: () => 40,
    });
    let requests = 0;
    const noRequest = () => {
        requests++;
        throw new Error('Provider network forbidden in hermetic fixture');
    };
    t.mock.method(window, 'fetch', noRequest);
    t.mock.method(globalThis, 'fetch', noRequest);
    const maps: FakeMap[] = [],
        overlays: FakeOverlay[] = [];
    const listeners: {
        instance: unknown;
        event: string;
        callback: () => void;
        removed: boolean;
        remove: () => void;
    }[] = [];
    const panes = [
        'floatPane',
        'mapPane',
        'markerLayer',
        'overlayLayer',
        'overlayMouseTarget',
    ] as const;
    class LatLng {
        constructor(
            private latitude: number,
            private longitude: number
        ) {}
        lat() {
            return this.latitude;
        }
        lng() {
            return this.longitude;
        }
        toString() {
            return `${this.latitude},${this.longitude}`;
        }
    }
    class LatLngBounds {
        points: { lat: number; lng: number }[] = [];
        extend(point: LatLng | { lat: number; lng: number }) {
            this.points.push(
                point instanceof LatLng
                    ? { lat: point.lat(), lng: point.lng() }
                    : { ...point }
            );
            return this;
        }
        isEmpty() {
            return this.points.length === 0;
        }
        toString() {
            return JSON.stringify(this.points);
        }
    }
    const event = {
        addListener(instance: unknown, name: string, callback: () => void) {
            const handle = {
                instance,
                event: name,
                callback,
                removed: false,
                remove() {
                    handle.removed = true;
                },
            };
            listeners.push(handle);
            return handle;
        },
        removeListener(handle: { remove: () => void }) {
            handle.remove();
        },
        clearInstanceListeners(instance: unknown) {
            for (const handle of listeners)
                if (handle.instance === instance) handle.remove();
        },
        trigger(instance: unknown, name: string) {
            for (const handle of [...listeners])
                if (
                    !handle.removed &&
                    handle.instance === instance &&
                    handle.event === name
                )
                    handle.callback();
        },
    };
    class FakeMap {
        panes: Record<string, HTMLElement> = {};
        fits: { lat: number; lng: number }[][] = [];
        optionUpdates: unknown[] = [];
        constructor(
            readonly element: HTMLElement,
            readonly options: unknown
        ) {
            maps.push(this);
            // Never erase a prior map's nodes to hide StrictMode allocation/cleanup behavior.
            for (const name of panes) {
                const pane = window.document.createElement('div');
                pane.setAttribute('data-synthetic-pane', name);
                element.append(pane as unknown as Node);
                this.panes[name] = pane as unknown as HTMLElement;
            }
        }
        getDiv() {
            return this.element;
        }
        setOptions(options: unknown) {
            this.optionUpdates.push(options);
        }
        fitBounds(bounds: LatLngBounds) {
            this.fits.push(bounds.points.map((point) => ({ ...point })));
        }
        getProjection() {
            return {
                fromLatLngToDivPixel: (point: LatLng) => ({
                    x: 300 + point.lng() * 10,
                    y: 200 + point.lat() * 10,
                }),
            };
        }
    }
    let deferredAttachments = false;
    const queued: (() => void)[] = [];
    class FakeOverlay {
        map: FakeMap | null = null;
        generation = 0;
        declare onAdd?: () => void;
        declare draw?: () => void;
        declare onRemove?: () => void;
        constructor() {
            overlays.push(this);
        }
        setMap(map: FakeMap | null) {
            if (map === this.map) return;
            if (this.map) this.onRemove?.();
            this.map = map;
            const generation = ++this.generation;
            if (!map) return;
            const attach = () => {
                if (this.map !== map || this.generation !== generation) return;
                // The real vendor onAdd/draw/onRemove own its container. This fake never does.
                this.onAdd?.();
                this.draw?.();
            };
            if (deferredAttachments) queued.push(attach);
            else attach();
        }
        getPanes() {
            return this.map?.panes ?? null;
        }
        getProjection() {
            return this.map?.getProjection() ?? null;
        }
    }
    const google = {
        maps: {
            Map: FakeMap,
            OverlayView: FakeOverlay,
            LatLng,
            LatLngBounds,
            event,
        },
    };
    Object.defineProperty(globalThis, 'google', {
        configurable: true,
        writable: true,
        value: google,
    });
    Object.defineProperty(window, 'google', {
        configurable: true,
        writable: true,
        value: google,
    });
    const { createRoot } = await import('react-dom/client');
    const roots: { root: Root; container: HTMLElement; mounted: boolean }[] =
        [];
    const create = () => {
        const hostElement = window.document.createElement('div');
        window.document.body.append(hostElement);
        const container = hostElement as unknown as HTMLElement;
        const item = { root: createRoot(container), container, mounted: true };
        roots.push(item);
        return {
            container,
            async render(node: ReactNode, strict = true) {
                await act(async () => {
                    item.root.render(strict ? h(StrictMode, null, node) : node);
                });
            },
            async unmount() {
                if (!item.mounted) return;
                item.mounted = false;
                await act(async () => item.root.unmount());
                container.remove();
            },
        };
    };
    t.after(async () => {
        for (const item of roots)
            if (item.mounted) {
                item.mounted = false;
                await act(async () => item.root.unmount());
                item.container.remove();
            }
        for (const run of queued.splice(0)) run();
        assert.equal(
            overlays.filter((overlay) => overlay.map !== null).length,
            0,
            'Every vendor overlay detached'
        );
        assert.equal(
            listeners.filter((listener) => !listener.removed).length,
            0,
            'Every reached owned event handle removed'
        );
        assert.equal(
            window.document.querySelectorAll('script[src*="maps.google"]')
                .length,
            0
        );
        assert.equal(requests, 0);
        globals.forEach((name, index) => {
            const original = originals[index];
            if (original) Object.defineProperty(globalThis, name, original);
            else Reflect.deleteProperty(globalThis, name);
        });
        await window.happyDOM.close();
    });
    return {
        window,
        google,
        maps,
        overlays,
        listeners,
        create,
        deferAttachments() {
            deferredAttachments = true;
        },
        flushAttachments() {
            for (const run of queued.splice(0)) run();
        },
        requests: () => requests,
        async waitFor(predicate: () => boolean) {
            for (let index = 0; index < 100 && !predicate(); index++)
                await act(
                    async () =>
                        new Promise((resolve) => setTimeout(resolve, 10))
                );
            assert(
                predicate(),
                'Expected bounded actual vendor lifecycle transition'
            );
        },
    };
}
