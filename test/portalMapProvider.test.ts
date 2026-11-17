import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    createPortalMapProviderCoordinator,
    createPortalMapProviderOwnerScope,
    bindPortalMapProvider,
    type PortalMapProviderAcquisition,
    type PortalMapProviderConfiguration,
    type PortalMapProviderCoordinator,
    type PortalMapProviderDriver,
    type PortalMapProviderLease,
} from '../src/portals/map/providerCoordinator.js';

const key = 'synthetic-provider-key-never-sent';
const config = (): PortalMapProviderConfiguration => ({ apiKey: key });
const owner = () => createPortalMapProviderOwnerScope().capture();
const accepted = (
    result: PortalMapProviderAcquisition
): PortalMapProviderLease => {
    assert.equal(result.kind, 'lease');
    if (result.kind !== 'lease') throw new Error('Expected an admitted lease');
    return result.lease;
};
const refused = (result: PortalMapProviderAcquisition, code: string): void => {
    assert.deepEqual(result, { kind: 'refused', code });
};
function deferred() {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
};
function fixture() {
    const pending = deferred();
    let constructors = 0;
    let loads = 0;
    let inspections = 0;
    const coordinator = createPortalMapProviderCoordinator({
        inspectRealm: () => {
            inspections++;
            return { kind: 'empty' };
        },
        createLoader: (captured) => {
            constructors++;
            assert.equal(captured.apiKey, key);
            assert.equal(captured.retries, 0);
            assert.ok(Object.isFrozen(captured));
            assert.ok(Object.isFrozen(captured.libraries));
            assert.ok(Object.isFrozen(captured.mapIds));
            return {
                load: () => {
                    loads++;
                    return pending.promise;
                },
            };
        },
    });
    return {
        coordinator,
        pending,
        counts: () => ({ constructors, loads, inspections }),
    };
}

test('factory and owner capture perform no provider inspection/construction/load', () => {
    const f = fixture();
    createPortalMapProviderOwnerScope().capture();
    assert.deepEqual(f.counts(), { constructors: 0, loads: 0, inspections: 0 });
});

test('equal effective native defaults across independent roots share one load', async () => {
    const f = fixture();
    const first = accepted(f.coordinator.acquire(owner(), config()));
    const second = accepted(
        f.coordinator.acquire(owner(), {
            apiKey: key,
            id: 'script-loader',
            version: 'weekly',
            language: 'en',
            region: 'US',
            libraries: ['maps'],
            mapIds: [],
            nonce: '',
            authReferrerPolicy: 'origin',
        })
    );
    assert.notEqual(first, second);
    assert.equal(f.coordinator.getSnapshot(first).status, 'loading');
    f.pending.resolve();
    await settle();
    assert.equal(f.coordinator.getSnapshot(first).status, 'ready');
    assert.equal(f.coordinator.getSnapshot(second).status, 'ready');
    assert.deepEqual(f.counts(), { constructors: 1, loads: 1, inspections: 1 });
    assert.equal(
        JSON.stringify([
            first,
            second,
            f.coordinator.getSnapshot(first),
        ]).includes(key),
        false
    );
});

test('each unequal effective option refuses before another constructor', () => {
    const variants: PortalMapProviderConfiguration[] = [
        { apiKey: 'other-synthetic-key' },
        { apiKey: key, id: 'other-script' },
        { apiKey: key, version: 'quarterly' },
        { apiKey: key, language: 'fr' },
        { apiKey: key, region: 'FR' },
        { apiKey: key, libraries: [] },
        { apiKey: key, mapIds: ['map-one'] },
        { apiKey: key, nonce: 'nonce-one' },
    ];
    for (const variant of variants) {
        const f = fixture();
        accepted(f.coordinator.acquire(owner(), config()));
        refused(
            f.coordinator.acquire(owner(), variant),
            'configuration-conflict'
        );
        assert.deepEqual(f.counts(), {
            constructors: 1,
            loads: 1,
            inspections: 1,
        });
    }
});

test('captured arrays are immutable and ordered rather than sorted/coerced', () => {
    const f = fixture();
    const options: PortalMapProviderConfiguration = {
        apiKey: key,
        libraries: ['places', 'maps'],
        mapIds: ['a', 'b'],
    };
    accepted(f.coordinator.acquire(owner(), options));
    (options.libraries as string[])[0] = 'geometry';
    (options.mapIds as string[]).reverse();
    accepted(
        f.coordinator.acquire(owner(), {
            apiKey: key,
            libraries: ['places', 'maps'],
            mapIds: ['a', 'b'],
        })
    );
    refused(f.coordinator.acquire(owner(), options), 'configuration-conflict');
    refused(
        f.coordinator.acquire(owner(), {
            apiKey: key,
            libraries: ['maps', 'places'],
            mapIds: ['a', 'b'],
        }),
        'configuration-conflict'
    );
    assert.equal(f.counts().constructors, 1);
});

test('zero exact leases retain ready authority and never rotate/reload the realm', async () => {
    const f = fixture();
    const first = accepted(f.coordinator.acquire(owner(), config()));
    assert.equal(f.coordinator.release(first), true);
    assert.equal(f.coordinator.release(first), false);
    f.pending.resolve();
    await settle();
    refused(
        f.coordinator.acquire(owner(), { apiKey: 'different-key' }),
        'configuration-conflict'
    );
    const next = accepted(f.coordinator.acquire(owner(), config()));
    assert.equal(f.coordinator.getSnapshot(next).status, 'ready');
    assert.deepEqual(f.counts(), { constructors: 1, loads: 1, inspections: 1 });
});

test('constructor errors are sanitized, pin the failed configuration and never retry', () => {
    let constructors = 0;
    const c = createPortalMapProviderCoordinator({
        inspectRealm: () => ({ kind: 'empty' }),
        createLoader: () => {
            constructors++;
            throw new Error(`raw options apiKey=${key}`);
        },
    });
    const first = accepted(c.acquire(owner(), config()));
    assert.deepEqual(c.getSnapshot(first), { status: 'provider-failed' });
    c.release(first);
    const second = accepted(c.acquire(owner(), config()));
    assert.equal(c.getSnapshot(second).status, 'provider-failed');
    refused(c.acquire(owner(), { apiKey: 'other' }), 'configuration-conflict');
    assert.equal(constructors, 1);
    assert.equal(
        JSON.stringify([first, second, c.getSnapshot(second)]).includes(key),
        false
    );
});

test('async rejection is sanitized and retained across unmount/remount', async () => {
    const f = fixture();
    const first = accepted(f.coordinator.acquire(owner(), config()));
    f.pending.reject(new Error(`raw vendor key ${key}`));
    await settle();
    assert.deepEqual(f.coordinator.getSnapshot(first), {
        status: 'provider-failed',
    });
    f.coordinator.release(first);
    const second = accepted(f.coordinator.acquire(owner(), config()));
    assert.equal(f.coordinator.getSnapshot(second).status, 'provider-failed');
    assert.equal(f.counts().loads, 1);
});

test('unmanaged provider refuses without constructor or implicit global adoption', () => {
    let constructors = 0;
    const c = createPortalMapProviderCoordinator({
        inspectRealm: () => ({ kind: 'unmanaged-provider' }),
        createLoader: () => {
            constructors++;
            throw new Error('Must not construct');
        },
    });
    refused(c.acquire(owner(), config()), 'unmanaged-provider');
    assert.equal(constructors, 0);
});

test('explicit compatible host attestation shares its readiness with zero constructors', async () => {
    const pending = deferred();
    let constructors = 0;
    const c = createPortalMapProviderCoordinator({
        inspectRealm: () => ({
            kind: 'attested-provider',
            configuration: config(),
            ready: pending.promise,
        }),
        createLoader: () => {
            constructors++;
            throw new Error('Must not construct');
        },
    });
    const first = accepted(c.acquire(owner(), config()));
    const second = accepted(c.acquire(owner(), config()));
    pending.resolve();
    await settle();
    assert.equal(c.getSnapshot(first).status, 'ready');
    assert.equal(c.getSnapshot(second).status, 'ready');
    assert.equal(constructors, 0);
});

test('incompatible or malformed attestation never falls through to a new loader', () => {
    let constructors = 0;
    const createLoader = () => {
        constructors++;
        throw new Error('Must not construct');
    };
    const mismatch = createPortalMapProviderCoordinator({
        createLoader,
        inspectRealm: () => ({
            kind: 'attested-provider',
            configuration: { apiKey: 'other' },
            ready: Promise.resolve(),
        }),
    });
    refused(mismatch.acquire(owner(), config()), 'configuration-conflict');
    const malformed = createPortalMapProviderCoordinator({
        createLoader,
        inspectRealm: () => ({
            kind: 'attested-provider',
            configuration: config(),
            ready: undefined as unknown as Promise<void>,
        }),
    });
    refused(malformed.acquire(owner(), config()), 'provider-failed');
    assert.equal(constructors, 0);
});

test('owner ABA, retirement during capture and late load cannot acquire successor authority', async () => {
    const scope = createPortalMapProviderOwnerScope();
    const firstA = scope.capture();
    scope.advance();
    const nextA = scope.advance();
    const f = fixture();
    refused(f.coordinator.acquire(firstA, config()), 'owner-retired');
    const lease = accepted(f.coordinator.acquire(nextA, config()));
    let calls = 0;
    f.coordinator.subscribe(lease, () => {
        calls++;
    });
    scope.retire();
    f.pending.resolve();
    await settle();
    assert.equal(calls, 0);
    assert.equal(f.coordinator.getSnapshot(lease).status, 'owner-retired');
    const other = createPortalMapProviderOwnerScope();
    const retiring = {
        get apiKey() {
            other.retire();
            return key;
        },
    };
    refused(f.coordinator.acquire(other.capture(), retiring), 'owner-retired');
    assert.equal(f.counts().constructors, 1);
});

test('exact release and unsubscribe preserve another root and silence late callbacks', async () => {
    const f = fixture();
    const a = accepted(f.coordinator.acquire(owner(), config()));
    const b = accepted(f.coordinator.acquire(owner(), config()));
    let callsA = 0;
    let callsB = 0;
    f.coordinator.subscribe(a, () => {
        callsA++;
    });
    const stop = f.coordinator.subscribe(b, () => {
        callsB++;
    });
    stop();
    stop();
    f.coordinator.subscribe(b, () => {
        callsB++;
    });
    const other = fixture();
    assert.equal(other.coordinator.release(a), false);
    f.coordinator.release(a);
    f.pending.resolve();
    await settle();
    assert.deepEqual([callsA, callsB], [0, 1]);
    assert.equal(f.coordinator.getSnapshot(a).status, 'released');
    assert.equal(f.coordinator.getSnapshot(b).status, 'ready');
});

test('host reentrancy never constructs a second loader and subscriber failures stay isolated', async () => {
    const pending = deferred();
    let constructors = 0;
    let c!: PortalMapProviderCoordinator;
    let duringProbe: PortalMapProviderAcquisition | undefined;
    let duringConstruction: PortalMapProviderLease | undefined;
    c = createPortalMapProviderCoordinator({
        inspectRealm: () => {
            duringProbe = c.acquire(owner(), config());
            return { kind: 'empty' };
        },
        createLoader: () => {
            constructors++;
            duringConstruction = accepted(c.acquire(owner(), config()));
            return { load: () => pending.promise };
        },
    });
    const first = accepted(c.acquire(owner(), config()));
    refused(duringProbe!, 'provider-failed');
    let survivingCalls = 0;
    c.subscribe(first, () => {
        throw new Error(`private subscriber ${key}`);
    });
    c.subscribe(duringConstruction!, () => {
        survivingCalls++;
    });
    pending.resolve();
    await settle();
    assert.equal(constructors, 1);
    assert.equal(survivingCalls, 1);
    assert.equal(c.getSnapshot(first).status, 'ready');
});

test('invalid options and failed probes expose only stable codes before loading', () => {
    const f = fixture();
    for (const invalid of [
        { apiKey: '' },
        { apiKey: key, libraries: ['unknown'] },
        { apiKey: key, url: 'https://unselected.example' },
        { apiKey: key, authReferrerPolicy: 'invalid' },
        {
            get apiKey() {
                throw new Error(key);
            },
        },
    ])
        refused(
            f.coordinator.acquire(
                owner(),
                invalid as PortalMapProviderConfiguration
            ),
            'invalid-configuration'
        );
    assert.deepEqual(f.counts(), { constructors: 0, loads: 0, inspections: 0 });
    const c = createPortalMapProviderCoordinator({
        inspectRealm: () => {
            throw new Error(`private ${key}`);
        },
        createLoader: () => {
            throw new Error('Must not construct');
        },
    });
    refused(c.acquire(owner(), config()), 'provider-failed');
    assert.equal(c.release({} as PortalMapProviderLease), false);
    assert.equal(
        c.getSnapshot({} as PortalMapProviderLease).status,
        'released'
    );
});

test('a malformed load result is failure rather than invented provider readiness', () => {
    const c = createPortalMapProviderCoordinator({
        inspectRealm: () => ({ kind: 'empty' }),
        createLoader: () => ({
            load: () => undefined as unknown as Promise<void>,
        }),
    } satisfies PortalMapProviderDriver);
    const lease = accepted(c.acquire(owner(), config()));
    assert.equal(c.getSnapshot(lease).status, 'provider-failed');
});

test('empty hook values retain the selected hook and Loader distinction', () => {
    const defaults = fixture();
    accepted(defaults.coordinator.acquire(owner(), config()));
    accepted(
        defaults.coordinator.acquire(owner(), {
            apiKey: key,
            language: '',
            region: '',
            nonce: '',
        })
    );
    refused(
        defaults.coordinator.acquire(owner(), { apiKey: key, id: '' }),
        'configuration-conflict'
    );
    refused(
        defaults.coordinator.acquire(owner(), { apiKey: key, version: '' }),
        'configuration-conflict'
    );
    const emptyId = fixture();
    accepted(emptyId.coordinator.acquire(owner(), { apiKey: key, id: '' }));
    accepted(
        emptyId.coordinator.acquire(owner(), {
            apiKey: key,
            id: '__googleMapsScriptId',
        })
    );
    refused(
        emptyId.coordinator.acquire(owner(), config()),
        'configuration-conflict'
    );
    assert.equal(defaults.counts().constructors, 1);
    assert.equal(emptyId.counts().constructors, 1);
});

test('retirement inside realm inspection constructs nothing and does not pin a refused configuration', () => {
    const scope = createPortalMapProviderOwnerScope();
    let inspections = 0;
    let constructors = 0;
    const c = createPortalMapProviderCoordinator({
        inspectRealm: () => {
            if (++inspections === 1) scope.retire();
            return { kind: 'empty' };
        },
        createLoader: () => {
            constructors++;
            return { load: () => Promise.resolve() };
        },
    });
    refused(c.acquire(scope.capture(), config()), 'owner-retired');
    assert.equal(constructors, 0);
    accepted(c.acquire(owner(), { apiKey: key, language: 'fr' }));
    assert.equal(constructors, 1);
});

test('a subscriber releasing another exact lease suppresses its queued publication', async () => {
    const f = fixture();
    const a = accepted(f.coordinator.acquire(owner(), config()));
    const b = accepted(f.coordinator.acquire(owner(), config()));
    let callsB = 0;
    f.coordinator.subscribe(a, () => {
        f.coordinator.release(b);
    });
    f.coordinator.subscribe(b, () => {
        callsB++;
    });
    f.pending.resolve();
    await settle();
    assert.equal(callsB, 0);
    assert.equal(f.coordinator.getSnapshot(a).status, 'ready');
    assert.equal(f.coordinator.getSnapshot(b).status, 'released');
});

test('immutable request binding captures private options before later mutation and performs no eager load', () => {
    const f = fixture();
    const scope = createPortalMapProviderOwnerScope();
    const options = { apiKey: key, libraries: ['maps' as const] };
    const binding = bindPortalMapProvider(
        f.coordinator,
        scope.capture(),
        options
    );
    options.apiKey = 'changed-after-publication';
    options.libraries.length = 0;
    assert.deepEqual(f.counts(), { constructors: 0, loads: 0, inspections: 0 });
    accepted(binding.acquire());
    assert.equal(f.counts().constructors, 1);
    assert.equal(JSON.stringify(binding).includes(key), false);
    scope.retire();
    refused(binding.acquire(), 'owner-retired');
});
