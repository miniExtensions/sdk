import {
    Component,
    createElement as h,
    useEffect,
    useMemo,
    useState,
    type ComponentType,
    type ReactElement,
    type ReactNode,
} from 'react';
import type { PortalMapCoordinates } from '../portals/map/coordinates.js';
import { capturePortalMapProviderConfiguration } from '../portals/map/providerCoordinator.js';
import type {
    PortalMapProviderBinding,
    PortalMapProviderConfiguration,
    PortalMapProviderDriver,
    PortalMapProviderRefusal,
    PortalMapProviderSnapshot,
} from '../portals/map/providerCoordinator.js';
import { PortalMapCard, type PortalMapCardData } from './PortalMapCard.js';
import { loadPortalMapRuntime } from './map/runtimeLoader.js';
import type { PortalMapRuntimeProps } from './map/types.js';

export type PortalMapMarker = Readonly<{
    /** Stable occurrence key in the already-admitted ordered visible vector. */
    key: string;
    position: PortalMapCoordinates;
    card: PortalMapCardData;
}>;
export type PortalMapProps = Readonly<{
    /** Replace on authorized key/field/view owner transitions, not ordinary row updates. */
    provider: PortalMapProviderBinding;
    markers: readonly PortalMapMarker[];
    label: string;
    loadingLabel: string;
    /** Stable code only; native may intentionally retain its existing spinner policy. */
    failureLabel: (code: PortalMapProviderRefusal | 'released') => string;
    /** Preserve the native spinner policy while still exposing a stable status code. */
    providerFailureDisplay?: 'message' | 'loading';
    className?: string;
}>;

/** Lazy default driver; the host installs its one coordinator and injects it into roots. */
export function createGoogleMapsPortalMapDriver(
    options: Readonly<{
        /** Read only during admitted effect acquisition. Never read a native workspace key. */
        getRealm: () => Window | null;
        attestation?: Readonly<{
            configuration: PortalMapProviderConfiguration;
            ready: Promise<void>;
        }>;
    }>
): PortalMapProviderDriver {
    const getRealm = options.getRealm;
    const suppliedAttestation = options.attestation;
    const attestation = suppliedAttestation
        ? Object.freeze({
              configuration: capturePortalMapProviderConfiguration(
                  suppliedAttestation.configuration
              ),
              ready: suppliedAttestation.ready,
          })
        : null;
    const inspectRealm: PortalMapProviderDriver['inspectRealm'] = (
        configuration
    ) => {
        const realm = getRealm();
        if (!realm || typeof window === 'undefined' || realm !== window)
            return { kind: 'unmanaged-provider' as const };
        if (attestation)
            return attestation.configuration
                ? {
                      kind: 'attested-provider' as const,
                      configuration: attestation.configuration,
                      ready: attestation.ready,
                  }
                : { kind: 'unmanaged-provider' as const };
        const known = Reflect.get(realm, 'google') as
            | { maps?: unknown }
            | undefined;
        const script = Array.from(realm.document.scripts).some(
            (node) =>
                node.src.startsWith(
                    'https://maps.googleapis.com/maps/api/js'
                ) || node.src.startsWith('https://maps.google.com/maps/api/js')
        );
        return known?.maps ||
            script ||
            realm.document.getElementById(configuration.id)
            ? { kind: 'unmanaged-provider' as const }
            : { kind: 'empty' as const };
    };
    return Object.freeze({
        inspectRealm,
        createLoader(configuration) {
            return {
                load: async () => {
                    const runtime = await loadPortalMapRuntime();
                    // A foreign provider may arrive while the selected vendor chunk loads.
                    // Never let Loader's implicit global adoption cross the admission check.
                    if (inspectRealm(configuration).kind !== 'empty')
                        throw new Error(
                            'Portal Map provider admission changed'
                        );
                    await runtime.loadPortalMapProvider(configuration);
                },
            };
        },
    });
}

class MapBoundary extends Component<
    { children?: ReactNode; fallback: ReactElement },
    { failed: boolean }
> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch() {
        /* Never forward raw vendor diagnostics into SDK UI/telemetry. */
    }
    render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

/** Keep provider retirement effective before React publishes another card commit. */
function ProviderBoundMapCard({
    provider,
    card,
}: {
    provider: PortalMapProviderBinding;
    card: PortalMapCardData;
}): ReactElement {
    const owner = useMemo(
        () => ({
            isCurrent: () =>
                provider.owner.isCurrent() &&
                card.owner.isCurrent() &&
                provider.owner.isCurrent(),
        }),
        [provider, card.owner]
    );
    return h(PortalMapCard, {
        card: {
            recordId: card.recordId,
            identity: card.identity,
            owner,
            accessibleLabel: card.accessibleLabel,
            projection: card.projection,
            open: card.open,
            needsReviewLabel: card.needsReviewLabel,
        },
    });
}

/** Complete SDK Map over admitted coordinates/cards and explicit provider ownership. */
export function PortalMap(props: PortalMapProps): ReactElement {
    const binding = props.provider;
    type Status =
        | PortalMapProviderSnapshot['status']
        | PortalMapProviderRefusal;
    const [provider, setProvider] = useState<{
        binding: PortalMapProviderBinding;
        status: Status;
    } | null>(null);
    const [runtime, setRuntime] =
        useState<ComponentType<PortalMapRuntimeProps> | null>(null);
    const [runtimeFailed, setRuntimeFailed] = useState(false);
    useEffect(() => {
        let mounted = true;
        const result = binding.acquire();
        if (result.kind === 'refused') {
            setProvider({ binding, status: result.code });
            return () => {
                mounted = false;
            };
        }
        const update = () => {
            if (mounted)
                setProvider({
                    binding,
                    status: binding.coordinator.getSnapshot(result.lease)
                        .status,
                });
        };
        const unsubscribe = binding.coordinator.subscribe(result.lease, update);
        update();
        return () => {
            mounted = false;
            unsubscribe();
            binding.coordinator.release(result.lease);
        };
    }, [binding]);
    let ownerCurrent = false;
    try {
        ownerCurrent = binding.owner.isCurrent() === true;
    } catch {
        // External ownership observations fail closed without exposing diagnostics.
    }
    const status: Status = !ownerCurrent
        ? 'owner-retired'
        : provider?.binding === binding
          ? provider.status
          : 'loading';
    useEffect(() => {
        if (status !== 'ready') return;
        let mounted = true;
        loadPortalMapRuntime().then(
            (module) => {
                if (mounted) setRuntime(() => module.PortalMapRuntime);
            },
            () => {
                if (mounted) setRuntimeFailed(true);
            }
        );
        return () => {
            mounted = false;
        };
    }, [status]);
    const failure = (code: PortalMapProviderRefusal | 'released') =>
        props.providerFailureDisplay === 'loading'
            ? h(
                  'div',
                  { role: 'status', 'data-map-status': code },
                  props.loadingLabel
              )
            : h(
                  'div',
                  { role: 'alert', 'data-map-status': code },
                  props.failureLabel(code)
              );
    const content = runtimeFailed
        ? failure('provider-failed')
        : status === 'loading'
          ? h('div', { role: 'status' }, props.loadingLabel)
          : status !== 'ready'
            ? failure(status)
            : !runtime
              ? h('div', { role: 'status' }, props.loadingLabel)
              : h(
                    MapBoundary,
                    {
                        key: 'mounted-map',
                        fallback: failure('provider-failed'),
                    },
                    h(runtime, {
                        markers: props.markers
                            .filter(
                                (marker) =>
                                    Number.isFinite(marker.position.lat) &&
                                    Math.abs(marker.position.lat) <= 90 &&
                                    Number.isFinite(marker.position.lng) &&
                                    Math.abs(marker.position.lng) <= 180
                            )
                            .map((marker) => ({
                                key: marker.key,
                                position: marker.position,
                                content: h(
                                    'div',
                                    null,
                                    h(ProviderBoundMapCard, {
                                        provider: binding,
                                        card: marker.card,
                                    }),
                                    h('div', {
                                        className: 'mx-sdk-portal-map-pointer',
                                        'aria-hidden': true,
                                    })
                                ),
                            })),
                    })
                );
    return h(
        'section',
        {
            className: ['mx-sdk-portal-map', props.className ?? ''].join(' '),
            'aria-label': props.label,
        },
        content
    );
}
