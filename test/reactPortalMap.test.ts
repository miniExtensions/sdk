import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    PortalMap,
    createGoogleMapsPortalMapDriver,
    type PortalMapMarker,
    type PortalMapProps,
} from '../src/react/PortalMap.js';
import {
    bindPortalMapProvider,
    createPortalMapProviderCoordinator,
    createPortalMapProviderOwnerScope,
    type PortalMapProviderConfiguration,
} from '../src/portals/map/providerCoordinator.js';
import { portalMapGoogleFixture } from './fixtures/portalMapGoogleFixture.js';

const configuration = { apiKey: 'synthetic-map-fixture-no-request' };
const marker = (key: string, lat = 1, lng = 2): PortalMapMarker => ({
    key,
    position: { lat, lng },
    card: {
        recordId: key,
        identity: {},
        owner: { isCurrent: () => true },
        accessibleLabel: `Record ${key}`,
        projection: {
            status: 'present',
            layout: 'map',
            primary: key,
            primaryIsEmpty: false,
        },
    },
});
const props = (
    provider: PortalMapProps['provider'],
    markers: readonly PortalMapMarker[] = []
): PortalMapProps => ({
    provider,
    markers,
    label: 'Admitted Map',
    loadingLabel: 'Provider loading',
    failureLabel: (code) => `Map unavailable: ${code}`,
});
const fitCount = (maps: { fits: unknown[] }[]) =>
    maps.reduce((sum, map) => sum + map.fits.length, 0);

test('SSR never inspects/constructs a provider or reaches GoogleMap/Overlay DOM', () => {
    let inspections = 0,
        constructions = 0;
    const c = createPortalMapProviderCoordinator({
        inspectRealm: () => {
            inspections++;
            return { kind: 'empty' };
        },
        createLoader: () => {
            constructions++;
            return { load: async () => {} };
        },
    });
    const provider = bindPortalMapProvider(
        c,
        createPortalMapProviderOwnerScope().capture(),
        configuration
    );
    const html = renderToString(
        h(PortalMap, props(provider, [marker('SSR row')]))
    );
    assert(html.includes('Provider loading'));
    assert(!html.includes('SSR row'));
    assert.deepEqual([inspections, constructions], [0, 0]);
});

test('actual class Map and OverlayViewF preserve controls, initial ordered bounds and bottom-center anchoring', async (t) => {
    const f = await portalMapGoogleFixture(t);
    const root = f.create();
    let constructors = 0;
    const c = createPortalMapProviderCoordinator({
        inspectRealm: () => ({
            kind: 'attested-provider',
            configuration,
            ready: Promise.resolve(),
        }),
        createLoader: () => {
            constructors++;
            throw new Error('Attestation must not construct a loader');
        },
    });
    const provider = bindPortalMapProvider(
        c,
        createPortalMapProviderOwnerScope().capture(),
        configuration
    );
    await root.render(
        h(PortalMap, props(provider, [marker('one'), marker('two', 3, 4)]))
    );
    await f.waitFor(
        () =>
            root.container.querySelectorAll('.mx-sdk-portal-map-card')
                .length === 2
    );
    assert(
        f.maps.length >= 1,
        'Do not assume one map allocation under StrictMode'
    );
    const loaded = f.maps.filter((map) => map.fits.length > 0);
    assert(loaded.length >= 1);
    for (const map of loaded) {
        assert.deepEqual(map.options, {
            fullscreenControl: false,
            streetViewControl: false,
        });
        assert.equal(map.fits.length, 1);
        assert.deepEqual(map.fits[0], [
            { lat: 1, lng: 2 },
            { lat: 3, lng: 4 },
        ]);
    }
    const first = root.container.querySelector(
        '[data-synthetic-pane="overlayMouseTarget"] > div'
    ) as HTMLElement;
    assert(first);
    assert.equal(first.style.left, '270px');
    assert.equal(first.style.top, '170px');
    assert.equal(
        root.container.querySelectorAll('.mx-sdk-portal-map-pointer').length,
        2
    );
    assert.equal(constructors, 0);
    assert.equal(f.requests(), 0);
    const count = f.maps.length,
        fits = fitCount(f.maps);
    await root.render(h(PortalMap, props(provider, [marker('updated', 8, 9)])));
    await f.waitFor(
        () =>
            root.container.querySelectorAll('.mx-sdk-portal-map-card')
                .length === 1
    );
    assert.equal(f.maps.length, count);
    assert.equal(fitCount(f.maps), fits, 'No ordinary-data recenter');
    assert.equal(root.container.querySelector('p')?.textContent, 'updated');
    assert.equal(
        f.overlays.filter((overlay) => overlay.map !== null).length,
        1
    );
    await root.unmount();
    assert.equal(
        f.overlays.filter((overlay) => overlay.map !== null).length,
        0
    );
});

test('touch chooses a titled co-located Map card once and retires dismissed or removed choices', async (t) => {
    const f = await portalMapGoogleFixture(t);
    const root = f.create();
    const container = root.container as unknown as InstanceType<
        typeof f.window.HTMLDivElement
    >;
    type FixtureButton = InstanceType<typeof f.window.HTMLButtonElement>;
    const coordinator = createPortalMapProviderCoordinator({
        inspectRealm: () => ({
            kind: 'attested-provider',
            configuration,
            ready: Promise.resolve(),
        }),
        createLoader: () => {
            throw new Error('Attestation must not construct a loader');
        },
    });
    const provider = bindPortalMapProvider(
        coordinator,
        createPortalMapProviderOwnerScope().capture(),
        configuration
    );
    const opened: string[] = [];
    const openable = (row: PortalMapMarker): PortalMapMarker => ({
        ...row,
        card: {
            ...row.card,
            open: { label: 'Open', activate: () => opened.push(row.key) },
        },
    });
    const bay = openable(marker('Bay A'));
    const warehouse = openable(marker('Warehouse B'));
    const depot = openable(marker('Depot C', 3, 4));
    const render = (rows: readonly PortalMapMarker[]) =>
        // Happy DOM emits close synchronously. The packed Chromium test covers
        // native dialog timing with StrictMode enabled.
        root.render(h(PortalMap, props(provider, rows)), false);
    const buttons = () =>
        [...container.querySelectorAll('.mx-sdk-portal-map-open')].filter(
            (button) => button instanceof f.window.HTMLButtonElement
        );
    const touch = async (button: FixtureButton) => {
        await act(async () => {
            button.dispatchEvent(
                new f.window.PointerEvent('pointerdown', {
                    bubbles: true,
                    button: 0,
                    isPrimary: true,
                    pointerType: 'touch',
                })
            );
            button.dispatchEvent(
                new f.window.MouseEvent('click', { bubbles: true, detail: 1 })
            );
        });
    };
    const openDialog = () => {
        const dialog = container.querySelector('dialog[open]');
        assert.ok(dialog);
        return dialog;
    };

    await render([bay, warehouse, depot]);
    await f.waitFor(() => buttons().length === 3);
    const [bayButton, warehouseButton, depotButton] = buttons();
    assert.deepEqual(
        [...buttons()].map((button) => button.getAttribute('aria-label')),
        ['Open', 'Open', 'Open']
    );
    await touch(warehouseButton);
    const choices = [...openDialog().querySelectorAll('button')];
    assert.deepEqual(
        choices.map((button) => button.textContent),
        ['Bay A', 'Warehouse B']
    );
    assert.deepEqual(opened, []);
    await act(async () => choices[0].click());
    assert.deepEqual(opened, ['Bay A']);
    assert.equal(container.querySelector('dialog'), null);

    await touch(warehouseButton);
    await act(async () => {
        openDialog().dispatchEvent(
            new f.window.MouseEvent('click', { bubbles: true })
        );
    });
    assert.equal(container.querySelector('dialog'), null);
    assert.deepEqual(opened, ['Bay A']);

    await touch(warehouseButton);
    const removedChoice = openDialog().querySelectorAll('button')[1];
    await render([bay, depot]);
    assert.equal(container.querySelector('dialog'), null);
    await act(async () => removedChoice.click());
    assert.deepEqual(opened, ['Bay A']);

    await touch(bayButton);
    await touch(depotButton);
    assert.equal(container.querySelector('dialog'), null);
    assert.deepEqual(opened, ['Bay A', 'Bay A', 'Depot C']);
    assert.equal(f.requests(), 0);
});

test('actual vendor initial empty bounds are retained when records arrive later', async (t) => {
    const f = await portalMapGoogleFixture(t);
    const root = f.create();
    const driver = createGoogleMapsPortalMapDriver({
        getRealm: () => window,
        attestation: { configuration, ready: Promise.resolve() },
    });
    const c = createPortalMapProviderCoordinator(driver);
    const provider = bindPortalMapProvider(
        c,
        createPortalMapProviderOwnerScope().capture(),
        configuration
    );
    await root.render(h(PortalMap, props(provider)));
    await f.waitFor(() => fitCount(f.maps) > 0);
    for (const map of f.maps)
        for (const bounds of map.fits) assert.deepEqual(bounds, []);
    const fits = fitCount(f.maps),
        instances = f.maps.length;
    await root.render(h(PortalMap, props(provider, [marker('later', 10, 11)])));
    await f.waitFor(
        () => root.container.querySelector('p')?.textContent === 'later'
    );
    assert.equal(fitCount(f.maps), fits);
    assert.equal(f.maps.length, instances);
});

test('two real roots share provider readiness while releasing one leaves the other overlay and lease alive', async (t) => {
    const f = await portalMapGoogleFixture(t);
    const first = f.create(),
        second = f.create();
    let constructors = 0,
        inspections = 0;
    const c = createPortalMapProviderCoordinator({
        inspectRealm: () => {
            inspections++;
            return {
                kind: 'attested-provider',
                configuration,
                ready: Promise.resolve(),
            };
        },
        createLoader: () => {
            constructors++;
            throw new Error('No loader');
        },
    });
    const a = bindPortalMapProvider(
        c,
        createPortalMapProviderOwnerScope().capture(),
        configuration
    );
    const b = bindPortalMapProvider(
        c,
        createPortalMapProviderOwnerScope().capture(),
        configuration
    );
    await first.render(h(PortalMap, props(a, [marker('A')])));
    await second.render(h(PortalMap, props(b, [marker('B')])));
    await f.waitFor(
        () =>
            first.container.querySelectorAll('.mx-sdk-portal-map-card')
                .length === 1 &&
            second.container.querySelectorAll('.mx-sdk-portal-map-card')
                .length === 1
    );
    const bMaps = f.maps.filter((map) =>
        second.container.contains(map.element)
    );
    await first.unmount();
    assert.equal(second.container.querySelector('p')?.textContent, 'B');
    assert.equal(f.overlays.filter((overlay) => overlay.map != null).length, 1);
    assert(bMaps.every((map) => second.container.contains(map.element)));
    assert.deepEqual([inspections, constructors], [1, 0]);
});

test('pending vendor attachment retired by actual Overlay cleanup never attaches to a successor pane', async (t) => {
    const f = await portalMapGoogleFixture(t);
    const root = f.create();
    f.deferAttachments();
    const c = createPortalMapProviderCoordinator({
        inspectRealm: () => ({
            kind: 'attested-provider',
            configuration,
            ready: Promise.resolve(),
        }),
        createLoader: () => {
            throw new Error('No loader');
        },
    });
    const provider = bindPortalMapProvider(
        c,
        createPortalMapProviderOwnerScope().capture(),
        configuration
    );
    await root.render(h(PortalMap, props(provider, [marker('retiring')])));
    await f.waitFor(() => f.overlays.some((overlay) => overlay.map !== null));
    await root.unmount();
    f.flushAttachments();
    assert.equal(
        f.overlays.filter((overlay) => overlay.map !== null).length,
        0
    );
    assert.equal(
        f.window.document.querySelectorAll('.mx-sdk-portal-map-card').length,
        0
    );
});

test('default driver refuses an unmanaged realm without scripts, loaders or Map construction', async (t) => {
    const f = await portalMapGoogleFixture(t);
    const root = f.create();
    const c = createPortalMapProviderCoordinator(
        createGoogleMapsPortalMapDriver({ getRealm: () => window })
    );
    const provider = bindPortalMapProvider(
        c,
        createPortalMapProviderOwnerScope().capture(),
        configuration
    );
    await root.render(
        h(PortalMap, props(provider, [marker('must remain absent')]))
    );
    assert.equal(
        root.container.querySelector('[role="alert"]')?.textContent,
        'Map unavailable: unmanaged-provider'
    );
    assert.equal(f.maps.length, 0);
    assert.equal(f.overlays.length, 0);
    assert.equal(f.requests(), 0);
});

test('default driver protects an occupied selected script ID and native may retain its loading policy', async (t) => {
    const f = await portalMapGoogleFixture(t);
    const root = f.create();
    Reflect.deleteProperty(globalThis, 'google');
    Reflect.deleteProperty(f.window, 'google');
    const existing = f.window.document.createElement('script');
    existing.id = 'script-loader';
    f.window.document.head.append(existing);
    const options = { getRealm: () => window };
    const driver = createGoogleMapsPortalMapDriver(options);
    // Replacing the caller's options cannot silently grant adoption after factory creation.
    Object.assign(options, {
        attestation: { configuration, ready: Promise.resolve() },
    });
    const c = createPortalMapProviderCoordinator(driver);
    const provider = bindPortalMapProvider(
        c,
        createPortalMapProviderOwnerScope().capture(),
        configuration
    );
    await root.render(
        h(PortalMap, { ...props(provider), providerFailureDisplay: 'loading' })
    );
    assert.equal(root.container.querySelector('[role="alert"]'), null);
    assert.equal(
        root.container
            .querySelector('[role="status"]')
            ?.getAttribute('data-map-status'),
        'unmanaged-provider'
    );
    assert.equal(root.container.textContent, 'Provider loading');
    assert.equal(f.window.document.getElementById('script-loader'), existing);
    assert.equal(f.maps.length, 0);
    assert.equal(f.requests(), 0);
});

test('retiring provider authority immediately fences an otherwise-current mounted card action', async (t) => {
    const f = await portalMapGoogleFixture(t);
    const root = f.create();
    const c = createPortalMapProviderCoordinator({
        inspectRealm: () => ({
            kind: 'attested-provider',
            configuration,
            ready: Promise.resolve(),
        }),
        createLoader: () => {
            throw new Error('No loader');
        },
    });
    const scope = createPortalMapProviderOwnerScope();
    const provider = bindPortalMapProvider(c, scope.capture(), configuration);
    let opened = 0;
    const row = marker('current-card');
    const admitted = {
        ...row,
        card: {
            ...row.card,
            open: {
                label: 'Open current card',
                activate: () => {
                    opened++;
                },
            },
        },
    };
    await root.render(h(PortalMap, props(provider, [admitted])));
    await f.waitFor(() => root.container.querySelector('button') !== null);
    const button = root.container.querySelector('button')!;
    scope.retire();
    button.click();
    assert.equal(
        opened,
        0,
        'Provider retirement must intersect record/card admission before another React commit'
    );
    const constructed = f.maps.length;
    await root.render(
        h(PortalMap, props(provider, [marker('new retired data')]))
    );
    assert.equal(
        root.container.querySelector('[data-map-status="owner-retired"]')
            ?.textContent,
        'Map unavailable: owner-retired'
    );
    assert.equal(
        root.container.querySelectorAll('.mx-sdk-portal-map-card').length,
        0
    );
    assert.equal(f.maps.length, constructed);
    assert.equal(
        f.overlays.filter((overlay) => overlay.map !== null).length,
        0
    );
});

for (const field of ['apiKey', 'region', 'libraries', 'mapIds'] as const) {
    test(`driver captures nested attestation ${field} before mutable host inputs change`, async (t) => {
        const f = await portalMapGoogleFixture(t);
        const original: PortalMapProviderConfiguration = {
            apiKey: 'original-synthetic-key',
            region: 'US',
            libraries: ['maps'],
            mapIds: ['one'],
        };
        const attestation = {
            configuration: original,
            ready: Promise.resolve(),
        };
        const driver = createGoogleMapsPortalMapDriver({
            getRealm: () => window,
            attestation,
        });
        if (field === 'apiKey') original.apiKey = 'changed-synthetic-key';
        if (field === 'region') original.region = 'GB';
        if (field === 'libraries')
            (original.libraries as string[]).push('places');
        if (field === 'mapIds') (original.mapIds as string[]).push('two');
        const c = createPortalMapProviderCoordinator(driver);
        assert.deepEqual(
            c.acquire(createPortalMapProviderOwnerScope().capture(), original),
            { kind: 'refused', code: 'configuration-conflict' }
        );
        assert.equal(f.maps.length, 0);
        assert.equal(f.requests(), 0);
    });
}

test('driver captures attested readiness rather than a later replacement promise', async (t) => {
    const f = await portalMapGoogleFixture(t);
    let resolve!: () => void;
    const ready = new Promise<void>((yes) => {
        resolve = yes;
    });
    const attestation = { configuration, ready };
    const c = createPortalMapProviderCoordinator(
        createGoogleMapsPortalMapDriver({ getRealm: () => window, attestation })
    );
    attestation.ready = Promise.resolve();
    const acquired = c.acquire(
        createPortalMapProviderOwnerScope().capture(),
        configuration
    );
    assert.equal(acquired.kind, 'lease');
    if (acquired.kind !== 'lease')
        throw new Error('Expected captured attestation lease');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(c.getSnapshot(acquired.lease).status, 'loading');
    resolve();
    await f.waitFor(() => c.getSnapshot(acquired.lease).status === 'ready');
    c.release(acquired.lease);
});

test('default driver refuses a foreign provider arriving during the lazy runtime gap', async (t) => {
    const f = await portalMapGoogleFixture(t);
    Reflect.deleteProperty(f.window, 'google');
    const c = createPortalMapProviderCoordinator(
        createGoogleMapsPortalMapDriver({ getRealm: () => window })
    );
    const acquired = c.acquire(
        createPortalMapProviderOwnerScope().capture(),
        configuration
    );
    assert.equal(acquired.kind, 'lease');
    if (acquired.kind !== 'lease')
        throw new Error('Expected initially empty realm lease');
    Reflect.set(f.window, 'google', {
        ...f.google,
        maps: { ...f.google.maps, version: 'synthetic-foreign-provider' },
    });
    await f.waitFor(
        () => c.getSnapshot(acquired.lease).status === 'provider-failed'
    );
    assert.equal(f.window.document.scripts.length, 0);
    assert.equal(f.maps.length, 0);
    assert.equal(f.requests(), 0);
    c.release(acquired.lease);
});

test('actual selected default Loader boots once through a synthetic script response and rejects incomplete ready API shapes', async (t) => {
    const f = await portalMapGoogleFixture(t);
    const root = f.create();
    Reflect.deleteProperty(f.window, 'google');
    // A browser's free `google` identifier and window.google are the same slot.
    // Preserve that relation in happy-dom while Loader installs its bootstrap.
    Object.defineProperty(globalThis, 'google', {
        configurable: true,
        get: () => Reflect.get(f.window, 'google'),
        set: (value: unknown) => {
            Reflect.set(f.window, 'google', value);
        },
    });
    const head = f.window.document.head;
    const append = head.append.bind(head);
    let providerScripts = 0;
    head.append = (...nodes: Parameters<typeof head.append>) => {
        const scripts = nodes.filter(
            (node): node is InstanceType<typeof f.window.HTMLScriptElement> =>
                node instanceof f.window.HTMLScriptElement &&
                node.src.startsWith('https://maps.googleapis.com/maps/api/js')
        );
        for (const script of scripts) {
            // This owned unit transport fulfills the response below. Keep the
            // external-resource engine inert; real script semantics are separately
            // exercised by the intercepted packed Chromium/default-Loader proof.
            script.type = 'application/x-sdk-google-fixture';
        }
        append(...nodes);
        for (const script of scripts) {
            f.expectProviderScript(script);
            providerScripts++;
            assert.equal(
                new URL(script.src).searchParams.get('key'),
                configuration.apiKey
            );
            queueMicrotask(() => {
                const current = Reflect.get(f.window, 'google') as {
                    maps: typeof f.google.maps & {
                        __ib__: () => void;
                        importLibrary: () => Promise<unknown>;
                    };
                };
                const callback = current.maps.__ib__;
                Object.assign(current.maps, f.google.maps);
                current.maps.importLibrary = async () => current.maps;
                callback();
            });
        }
    };
    const rawDriver = createGoogleMapsPortalMapDriver({
        getRealm: () => window,
    });
    let fault: { name: string; sites: string[] } | null = null;
    const c = createPortalMapProviderCoordinator({
        inspectRealm: rawDriver.inspectRealm,
        createLoader(effective) {
            const loader = rawDriver.createLoader(effective);
            return {
                load: async () => {
                    try {
                        await loader.load();
                    } catch (error) {
                        fault = {
                            name:
                                error instanceof Error ? error.name : 'Unknown',
                            sites:
                                error instanceof Error
                                    ? (error.stack ?? '')
                                          .split('\n')
                                          .slice(1, 4)
                                    : [],
                        };
                        throw error;
                    }
                },
            };
        },
    });
    const binding = bindPortalMapProvider(
        c,
        createPortalMapProviderOwnerScope().capture(),
        configuration
    );
    await root.render(
        h(PortalMap, props(binding, [marker('default-loader row')]))
    );
    try {
        await f.waitFor(
            () =>
                root.container.querySelector('.mx-sdk-portal-map-card') !== null
        );
    } catch {
        assert.fail(
            JSON.stringify({
                providerScripts,
                status: root.container
                    .querySelector('[data-map-status]')
                    ?.getAttribute('data-map-status'),
                fault,
            })
        );
    }
    assert.equal(providerScripts, 1);
    assert.equal(f.requests(), 0);
    assert(root.container.textContent?.includes('default-loader row'));
    const effective = {
        ...configuration,
        id: 'script-loader',
        version: 'weekly',
        language: 'en',
        region: 'US',
        libraries: ['maps'] as const,
        mapIds: [],
        nonce: '',
        authReferrerPolicy: 'origin' as const,
        retries: 0 as const,
        url: 'https://maps.googleapis.com/maps/api/js' as const,
    };
    const runtime = await import('../src/react/map/GoogleMapsRuntime.js');
    const current = Reflect.get(f.window, 'google') as typeof f.google;
    for (const key of ['Map', 'OverlayView', 'LatLngBounds'] as const) {
        const value = current.maps[key];
        Reflect.deleteProperty(current.maps, key);
        try {
            await assert.rejects(runtime.loadPortalMapProvider(effective), {
                message: 'provider-failed',
            });
        } finally {
            Reflect.set(current.maps, key, value);
        }
    }
    assert.equal(
        providerScripts,
        1,
        'Readiness validation never resets or retries the pinned loader'
    );
});
