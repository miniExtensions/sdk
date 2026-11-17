import { createElement as h, useCallback, type ReactElement } from 'react';
import { GoogleMap, OverlayViewF } from '@react-google-maps/api';
import * as selectedLoader from '@googlemaps/js-api-loader';
import type { PortalMapEffectiveProviderConfiguration } from '../../portals/map/providerCoordinator.js';
import type { PortalMapRuntimeProps } from './types.js';

const container = { width: '100%', height: '100%' };
const options = { fullscreenControl: false, streetViewControl: false };
const offset = (width: number, height: number) => ({
    x: -width / 2,
    y: -height,
});

/** This is the ONLY SDK loader path. Never call the API package's embedded loader hook. */
export async function loadPortalMapProvider(
    configuration: PortalMapEffectiveProviderConfiguration
): Promise<void> {
    // The selected package publishes ESM for bundlers and a UMD CommonJS main.
    // Node's namespace exposes that UMD export through default; production keeps
    // the same audited ESM input and one direct Loader constructor.
    const Loader =
        (selectedLoader as Partial<Pick<typeof selectedLoader, 'Loader'>>)
            .Loader ??
        (
            Reflect.get(selectedLoader, 'default') as Pick<
                typeof selectedLoader,
                'Loader'
            >
        ).Loader;
    const loaded = await new Loader({
        ...configuration,
        retries: 0,
        libraries: [...configuration.libraries],
        mapIds: [...configuration.mapIds],
    }).load();
    if (
        typeof loaded?.maps?.Map !== 'function' ||
        typeof loaded.maps.OverlayView !== 'function' ||
        typeof loaded.maps.LatLngBounds !== 'function'
    )
        throw new Error('provider-failed');
}

/** Reached native combination: class GoogleMap and functional OverlayViewF. */
export function PortalMapRuntime({
    markers,
}: PortalMapRuntimeProps): ReactElement {
    const onLoad = useCallback(
        (map: google.maps.Map) => {
            const bounds = new google.maps.LatLngBounds();
            for (const marker of markers) bounds.extend(marker.position);
            // Preserve the native empty case and initial-onLoad-only behavior.
            map.fitBounds(bounds);
        },
        [markers]
    );
    return h(
        GoogleMap,
        { mapContainerStyle: container, options, onLoad },
        markers.map((marker) =>
            h(
                OverlayViewF,
                {
                    key: marker.key,
                    mapPaneName: 'overlayMouseTarget',
                    position: marker.position,
                    getPixelPositionOffset: offset,
                },
                marker.content
            )
        )
    );
}
