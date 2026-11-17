# Portal Map

`PortalMap` and `PortalMapCard` are complete `/react` presentations. Import
`@miniextensions/sdk/react/portal-map.css`. The Map card uses the genuine
`LinkedFinderCard` primary-only branch: escaped primary text, native empty styling,
no hidden field/image recovery, and no unlink control. The Map has no native JSX
renderer slot, record cache, workspace-key lookup, transport, or child-form store.

The host supplies an ordered, already-admitted vector of `PortalMapMarker` values.
Each occurrence has its own stable key, numeric coordinates, and an independently
admitted card projection/action. `getPortalMapCoordinates` from `/portals` preserves
native first-array-member/markdown/decimal conversion, complete pairs, zero, and
inclusive latitude/longitude limits. Invalid markers are omitted without sorting
or searching later array entries.

## Provider custody

Create **one host-owned coordinator per browser realm**, then inject that exact
object into every participating native root, SDK root, and duplicate SDK copy.
The pure `/portals` coordinator never reads the browser or constructs a vendor.
The React default driver inspects its admitted realm only on acquisition. Do not
create independent coordinators for roots sharing the same Google namespace.

```ts
import {
    createPortalMapProviderCoordinator,
    createPortalMapProviderOwnerScope,
    bindPortalMapProvider,
} from '@miniextensions/sdk/portals';
import {
    PortalMap,
    createGoogleMapsPortalMapDriver,
    type PortalMapMarker,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/portal-map.css';

// Publish once from the host's realm owner and share with all its roots.
const coordinator = createPortalMapProviderCoordinator(
    createGoogleMapsPortalMapDriver({
        getRealm: () => (typeof window === 'undefined' ? null : window),
    })
);
const scope = createPortalMapProviderOwnerScope();
// The host obtains this only from its authorized, generation-fenced key result.
function authorizedBinding(apiKey: string) {
    return bindPortalMapProvider(coordinator, scope.capture(), { apiKey });
}
```

Binding publication is pure and captures configuration immutably. Acquiring a
binding occurs after mount; SSR/import/render never loads Google, allocates a Map,
or creates an Overlay. Key, field, view, configuration, and owner ABA transitions
must advance the host generation and publish a new binding. Ordinary row echoes
reuse the binding. Retirement fences card actions immediately and a subsequent
render cannot publish fresh rows through a retired provider owner.

The first admitted exact configuration pins the realm permanently. Equal requests
share one readiness operation, including after all leases release. Ordered
libraries/map IDs, key, version, language, region, nonce, script ID and referrer
policy participate in equality. Defaults match the selected native hook: language
`en`, region `US`, version `weekly`, libraries `['maps']`, script ID `script-loader`.
An explicit empty script ID normalizes to the Loader's `__googleMapsScriptId`.
Retries are fixed at zero. No reset, silent retry, script removal, or global
namespace deletion is provided. Conflicts refuse before vendor construction.

An existing Google namespace, matching Maps script, or occupied script ID is
unmanaged and refuses. The host may explicitly attest an already-owned compatible
provider with an exact configuration and readiness promise; both are captured at
driver creation. Presence alone is never an attestation. The default loader
rechecks for foreign resources after its lazy import, before vendor construction.
Failures expose stable codes without forwarding raw provider errors/options/keys.
`providerFailureDisplay: 'loading'` supports the native spinner policy while
retaining a stable `data-map-status`; key-fetch failures remain host presentation.

## Card and native action boundary

`PortalMapMarker.card` requires a fresh opaque presentation identity on record,
field, view or configuration ABA and a synchronous `owner.isCurrent` observation.
`open` is a separately admitted host capability, never inferred from record data.
Its real non-submit button supports keyboard activation and optional exact trigger
registration/disposal. The SDK intersects provider and card ownership and refuses
stale committed callbacks. The host callback must retain and recheck its captured
native owner through child-context admission and allocation; the SDK cannot undo
an already allocated host action. A projection does not authorize editing,
resource loading, opening, cache hydration, or unlinking.

The native adapter must preserve the workspace key request's actual token,
`portalFieldId`, and `selectedCustomViewId`, associating each response with its
captured request generation. Relabelling an older key response with current state
is unsafe. Keep current child-form and disabled-action checks in the native host.

## Selected vendor and proof scope

The private lazy runtime uses the real class `GoogleMap` and `OverlayViewF` from
MIT `@react-google-maps/api` 2.20.7 (release commit
`093860a4b25c4ed5a9d94316a2587f2c375eced3`) and the direct
`@googlemaps/js-api-loader` 1.16.8. It does not use unfinished `GoogleMapF` or the
package's independently prebundled Loader hook. Full notices, reviewed upstream
inventory, physical-input hashes and exact output receipts ship beside both
runtime formats under `react/map/`.

Only the mounted ready path reaches the vendor. Initial `onLoad` fits the ordered
valid coordinates even when empty; ordinary row changes do not recenter. Fullscreen
and street-view controls remain disabled. Real overlay portals use
`overlayMouseTarget` and the bottom-center offset `(-width / 2, -height)`. Cleanup
releases only the captured lease, owned overlay/listener and trigger registration.
It never removes the shared provider script or namespace.

The maintained package matrix verifies React 18/19, ESM/CJS, strict declarations,
CSS/notices/output integrity, peer identity, and cold headless/SSR behavior. The
registered browser proof uses the actual packed SDK and selected vendor/default
Loader with Google's response/API intercepted locally. Its assertions cover real
browser layout/keyboard and lifecycle boundaries; that synthetic engine is not
real Google geography, gestures, service availability, billing, native key delivery,
or hosted Map acceptance. Whole native delivery retains its own current-revision
acceptance, checks, review and receiving gates.
