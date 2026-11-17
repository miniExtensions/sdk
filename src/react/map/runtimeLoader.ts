import type { ComponentType } from 'react';
import type { PortalMapEffectiveProviderConfiguration } from '../../portals/map/providerCoordinator.js';
import type { PortalMapRuntimeProps } from './types.js';

type Runtime = Readonly<{
    PortalMapRuntime: ComponentType<PortalMapRuntimeProps>;
    loadPortalMapProvider: (
        configuration: PortalMapEffectiveProviderConfiguration
    ) => Promise<void>;
}>;
let pending: Promise<Runtime> | undefined;
export function loadPortalMapRuntime(): Promise<Runtime> {
    return (pending ??= import('./GoogleMapsRuntime.js'));
}
