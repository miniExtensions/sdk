/** Host-owned realm arbitration. This module imports no vendor, browser or React code. */
export type PortalMapLibrary =
    | 'core'
    | 'maps'
    | 'places'
    | 'geocoding'
    | 'routes'
    | 'marker'
    | 'geometry'
    | 'elevation'
    | 'streetView'
    | 'journeySharing'
    | 'drawing'
    | 'visualization';

export type PortalMapProviderConfiguration = {
    apiKey: string;
    id?: string;
    version?: string;
    language?: string;
    region?: string;
    libraries?: readonly PortalMapLibrary[];
    mapIds?: readonly string[];
    nonce?: string;
    authReferrerPolicy?: 'origin';
};

/** Effective options of the selected api2.20.7 hook and loader1.16.8. */
export type PortalMapEffectiveProviderConfiguration = Readonly<{
    apiKey: string;
    id: string;
    version: string;
    language: string;
    region: string;
    libraries: readonly PortalMapLibrary[];
    mapIds: readonly string[];
    nonce: string;
    authReferrerPolicy: 'origin';
    url: 'https://maps.googleapis.com/maps/api/js';
}>;

export type PortalMapProviderOwner = Readonly<{ isCurrent: () => boolean }>;

/** Each native request/scope transition advances even when a prior ID recurs. */
export function createPortalMapProviderOwnerScope(): {
    capture: () => PortalMapProviderOwner;
    advance: () => PortalMapProviderOwner;
    retire: () => void;
} {
    let generation = {};
    let active = true;
    const capture = (): PortalMapProviderOwner => {
        const captured = generation;
        return Object.freeze({
            isCurrent: () => active && generation === captured,
        });
    };
    return Object.freeze({
        capture,
        advance: () => {
            generation = {};
            return capture();
        },
        retire: () => {
            active = false;
        },
    });
}

export type PortalMapProviderRealm =
    | { kind: 'empty' }
    | { kind: 'unmanaged-provider' }
    | {
          kind: 'attested-provider';
          configuration: PortalMapProviderConfiguration;
          /** Host attests this already-owned provider, including readiness. */
          ready: Promise<void>;
      };

export type PortalMapProviderDriver = {
    inspectRealm: () => PortalMapProviderRealm;
    createLoader: (configuration: PortalMapEffectiveProviderConfiguration) => {
        load: () => Promise<void>;
    };
};

/** Structural across ESM/CJS/duplicate copies; runtime identity is checked by WeakMap. */
export type PortalMapProviderLease = Readonly<{
    kind: 'portal-map-provider-lease';
}>;
export type PortalMapProviderRefusal =
    | 'owner-retired'
    | 'invalid-configuration'
    | 'configuration-conflict'
    | 'unmanaged-provider'
    | 'provider-failed';
export type PortalMapProviderAcquisition =
    | { kind: 'lease'; lease: PortalMapProviderLease }
    | { kind: 'refused'; code: PortalMapProviderRefusal };
export type PortalMapProviderSnapshot = Readonly<{
    status:
        | 'loading'
        | 'ready'
        | 'provider-failed'
        | 'owner-retired'
        | 'released';
}>;
export type PortalMapProviderCoordinator = {
    acquire: (
        capturedOwner: PortalMapProviderOwner,
        authorizedConfiguration: PortalMapProviderConfiguration
    ) => PortalMapProviderAcquisition;
    getSnapshot: (lease: PortalMapProviderLease) => PortalMapProviderSnapshot;
    subscribe: (
        lease: PortalMapProviderLease,
        listener: () => void
    ) => () => void;
    release: (lease: PortalMapProviderLease) => boolean;
};

const libraries = new Set<string>([
    'core',
    'maps',
    'places',
    'geocoding',
    'routes',
    'marker',
    'geometry',
    'elevation',
    'streetView',
    'journeySharing',
    'drawing',
    'visualization',
]);
const configurationKeys = new Set([
    'apiKey',
    'id',
    'version',
    'language',
    'region',
    'libraries',
    'mapIds',
    'nonce',
    'authReferrerPolicy',
]);

function normalize(
    input: PortalMapProviderConfiguration
): PortalMapEffectiveProviderConfiguration | null {
    try {
        if (
            !input ||
            typeof input !== 'object' ||
            Object.keys(input).some((key) => !configurationKeys.has(key))
        )
            return null;
        // Read each value once; keep all captured material inside the coordinator/driver.
        const {
            apiKey,
            id,
            version,
            language,
            region,
            nonce,
            authReferrerPolicy,
            libraries: requestedLibraries,
            mapIds: requestedMapIds,
        } = input;
        if (typeof apiKey !== 'string' || !apiKey) return null;
        if (
            [id, version, language, region, nonce].some(
                (value) => value !== undefined && typeof value !== 'string'
            )
        )
            return null;
        if (authReferrerPolicy !== undefined && authReferrerPolicy !== 'origin')
            return null;
        const selectedLibraries =
            requestedLibraries === undefined ? ['maps'] : requestedLibraries;
        const selectedMapIds =
            requestedMapIds === undefined ? [] : requestedMapIds;
        if (!Array.isArray(selectedLibraries) || !Array.isArray(selectedMapIds))
            return null;
        const copiedLibraries = Array.from(selectedLibraries);
        const copiedMapIds = Array.from(selectedMapIds);
        if (
            !copiedLibraries.every((value): value is PortalMapLibrary =>
                libraries.has(value)
            ) ||
            !copiedMapIds.every((value) => typeof value === 'string')
        )
            return null;
        return Object.freeze({
            apiKey,
            id:
                id === undefined
                    ? 'script-loader'
                    : id || '__googleMapsScriptId',
            version: version === undefined ? 'weekly' : version,
            language: language || 'en',
            region: region || 'US',
            nonce: nonce || '',
            libraries: Object.freeze(copiedLibraries),
            mapIds: Object.freeze(copiedMapIds),
            authReferrerPolicy: authReferrerPolicy || 'origin',
            url: 'https://maps.googleapis.com/maps/api/js',
        });
    } catch {
        return null;
    }
}

function equal(
    left: PortalMapEffectiveProviderConfiguration,
    right: PortalMapEffectiveProviderConfiguration
): boolean {
    return (
        left.apiKey === right.apiKey &&
        left.id === right.id &&
        left.version === right.version &&
        left.language === right.language &&
        left.region === right.region &&
        left.nonce === right.nonce &&
        left.authReferrerPolicy === right.authReferrerPolicy &&
        left.url === right.url &&
        left.libraries.length === right.libraries.length &&
        left.libraries.every(
            (value, index) => value === right.libraries[index]
        ) &&
        left.mapIds.length === right.mapIds.length &&
        left.mapIds.every((value, index) => value === right.mapIds[index])
    );
}

const snapshots = Object.freeze({
    loading: Object.freeze({ status: 'loading' } as const),
    ready: Object.freeze({ status: 'ready' } as const),
    'provider-failed': Object.freeze({ status: 'provider-failed' } as const),
    'owner-retired': Object.freeze({ status: 'owner-retired' } as const),
    released: Object.freeze({ status: 'released' } as const),
});

/** Install exactly once by the host and pass the same object to every participating root. */
export function createPortalMapProviderCoordinator(
    driver: PortalMapProviderDriver
): PortalMapProviderCoordinator {
    type Phase = 'loading' | 'ready' | 'provider-failed';
    type Record = {
        owner: PortalMapProviderOwner;
        released: boolean;
        retired: boolean;
        listeners: Set<() => void>;
    };
    const records = new WeakMap<PortalMapProviderLease, Record>();
    const active = new Set<Record>();
    let pinned: PortalMapEffectiveProviderConfiguration | undefined;
    let phase: Phase = 'loading';
    let initializing = false;
    const current = (owner: PortalMapProviderOwner): boolean => {
        try {
            return owner.isCurrent() === true;
        } catch {
            return false;
        }
    };
    const retire = (record: Record): void => {
        record.retired = true;
        record.listeners.clear();
        active.delete(record);
    };
    const live = (record: Record): boolean => {
        if (record.released || record.retired) return false;
        if (!current(record.owner)) {
            retire(record);
            return false;
        }
        return !record.released && !record.retired;
    };
    const publish = (next: Phase): void => {
        phase = next;
        for (const record of Array.from(active)) {
            if (!live(record)) continue;
            for (const listener of Array.from(record.listeners)) {
                if (!live(record)) break;
                if (record.listeners.has(listener)) {
                    try {
                        listener();
                    } catch {
                        /* A subscriber cannot break another lease. */
                    }
                }
            }
        }
    };
    const refuse = (
        code: PortalMapProviderRefusal
    ): PortalMapProviderAcquisition => Object.freeze({ kind: 'refused', code });
    const lease = (
        owner: PortalMapProviderOwner
    ): PortalMapProviderAcquisition => {
        const token = Object.freeze({
            kind: 'portal-map-provider-lease',
        } as const);
        const record: Record = {
            owner,
            released: false,
            retired: false,
            listeners: new Set(),
        };
        records.set(token, record);
        active.add(record);
        return Object.freeze({ kind: 'lease', lease: token });
    };
    return Object.freeze({
        acquire(owner, configuration) {
            if (!current(owner)) return refuse('owner-retired');
            const captured = normalize(configuration);
            if (!captured) return refuse('invalid-configuration');
            if (!current(owner)) return refuse('owner-retired');
            if (pinned)
                return equal(pinned, captured)
                    ? lease(owner)
                    : refuse('configuration-conflict');
            // A host probe/constructor must not reenter initial admission and create two loaders.
            if (initializing) return refuse('provider-failed');
            initializing = true;
            try {
                const realm = driver.inspectRealm();
                if (!current(owner)) return refuse('owner-retired');
                if (realm.kind === 'unmanaged-provider')
                    return refuse('unmanaged-provider');
                let ready: Promise<void> | undefined;
                let attested = false;
                if (realm.kind === 'attested-provider') {
                    const effective = normalize(realm.configuration);
                    if (!effective || !equal(effective, captured))
                        return refuse('configuration-conflict');
                    attested = true;
                    ready = realm.ready;
                    if (!ready || typeof ready.then !== 'function')
                        return refuse('provider-failed');
                } else if (realm.kind !== 'empty') {
                    return refuse('unmanaged-provider');
                }
                if (!current(owner)) return refuse('owner-retired');
                pinned = captured;
                const result = lease(owner);
                try {
                    if (!attested) ready = driver.createLoader(captured).load();
                    if (!ready || typeof ready.then !== 'function') {
                        publish('provider-failed');
                        return result;
                    }
                    Promise.resolve(ready).then(
                        () => publish('ready'),
                        () => publish('provider-failed')
                    );
                } catch {
                    publish('provider-failed');
                }
                return result;
            } catch {
                return refuse('provider-failed');
            } finally {
                initializing = false;
            }
        },
        getSnapshot(token) {
            const record = records.get(token);
            if (!record || record.released) return snapshots.released;
            if (!live(record)) return snapshots['owner-retired'];
            return snapshots[phase];
        },
        subscribe(token, listener) {
            const record = records.get(token);
            if (!record || !live(record)) return () => {};
            record.listeners.add(listener);
            return () => {
                record.listeners.delete(listener);
            };
        },
        release(token) {
            const record = records.get(token);
            if (!record || record.released) return false;
            record.released = true;
            record.listeners.clear();
            active.delete(record);
            // The realm configuration, shared load and terminal result deliberately survive.
            return true;
        },
    });
}
