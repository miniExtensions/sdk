/** Native-compatible configured tracking. IP collection remains backend-owned. */
export type FormTrackingState = Readonly<{
    enableTracking?: boolean | null;
    userIPAddressField?: string | null;
    userLatitudeField?: string | null;
    userLongitudeField?: string | null;
}>;

export type EffectiveFormTracking = Readonly<{
    collectIPAddress: boolean;
    collectLocation: boolean;
}>;

export function getEffectiveFormTracking(
    state: FormTrackingState
): EffectiveFormTracking {
    const enabled = state.enableTracking === true;
    return {
        collectIPAddress: enabled && state.userIPAddressField != null,
        collectLocation:
            enabled &&
            (state.userLatitudeField != null ||
                state.userLongitudeField != null),
    };
}

/** Capture at the host's admitted allocation, before any asynchronous work. */
export type CapturedFormTrackingPolicy = EffectiveFormTracking &
    Readonly<{ collectLatitude: boolean; collectLongitude: boolean }>;

export function captureFormTrackingPolicy(
    state: FormTrackingState
): CapturedFormTrackingPolicy {
    const effective = getEffectiveFormTracking(state);
    return Object.freeze({
        ...effective,
        // Native projection uses truthiness, while disclosure uses non-nullness.
        collectLatitude: effective.collectLocation && !!state.userLatitudeField,
        collectLongitude:
            effective.collectLocation && !!state.userLongitudeField,
    });
}

export type FormLocation = Readonly<{ lat?: number; long?: number }>;
export type FormLocationReader = () => Promise<FormLocation>;
export type PreparedFormTracking = Readonly<{
    latitude?: number;
    longitude?: number;
}>;
export type FormLocationErrorReporter = (error: unknown) => void;

function report(error: unknown, onError?: FormLocationErrorReporter): void {
    try {
        onError?.(error);
    } catch {
        // Diagnostics must not turn optional tracking into a failed Save.
    }
}

/**
 * Explicit, lazy browser boundary. Import, render and policy evaluation never
 * call this function. One request, native 15-second timeout, no cache or retry.
 * Only the host may authorize invoking it inside an allocated final Save.
 */
export async function readBrowserFormLocation(
    onError?: FormLocationErrorReporter
): Promise<FormLocation> {
    try {
        const position = await new Promise<GeolocationPosition>(
            (resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    timeout: 15000,
                });
            }
        );
        return {
            lat: position.coords.latitude,
            long: position.coords.longitude,
        };
    } catch (error) {
        report(error, onError);
        return {};
    }
}

/**
 * Prepare only an already allocated final Save's captured policy. The host owns
 * authorization, coalescing, original request identity, transport and settlement.
 * FormController does not invoke this helper automatically; never acquire a
 * location before controller.save() as a substitute for an allocation hook.
 */
export async function prepareAllocatedFormTracking(
    input: Readonly<{
        policy: CapturedFormTrackingPolicy;
        readLocation: FormLocationReader;
        onError?: FormLocationErrorReporter;
    }>
): Promise<PreparedFormTracking> {
    // Snapshot before awaiting even if a JS caller supplies an unfrozen policy.
    const { collectLocation, collectLatitude, collectLongitude } = input.policy;
    if (!collectLocation) return {};
    try {
        const coords = await input.readLocation();
        return {
            latitude: collectLatitude ? coords.lat : undefined,
            longitude: collectLongitude ? coords.long : undefined,
        };
    } catch (error) {
        report(error, input.onError);
        return {};
    }
}
