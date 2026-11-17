import type { ReactNode } from 'react';
import type { PortalMapCoordinates } from '../../portals/map/coordinates.js';

/** Private SDK bridge only; public callers supply typed shared Map-card data. */
export type PortalMapRuntimeMarker = Readonly<{
    key: string;
    position: PortalMapCoordinates;
    content: ReactNode;
}>;
export type PortalMapRuntimeProps = Readonly<{
    markers: readonly PortalMapRuntimeMarker[];
}>;
