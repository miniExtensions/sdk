import type { AirtableValue } from '../../runtime/types.js';
import { removeMarkdown } from '../../formulas/removeMarkdown.js';

export type PortalMapCoordinates = Readonly<{ lat: number; lng: number }>;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function coordinate(input: AirtableValue): number | null {
    // Native semantics select only the first nested array member. Do not search
    // later entries, coerce objects/booleans, or accept exponent/partial values.
    const seen = new Set<unknown>();
    while (Array.isArray(input)) {
        if (seen.has(input)) return null;
        seen.add(input);
        input = input[0] ?? null;
    }
    if (typeof input === 'number') return Number.isFinite(input) ? input : null;
    if (typeof input !== 'string') return null;
    const normalized = removeMarkdown(input).trim();
    if (!decimal.test(normalized)) return null;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
}

/** Complete pairs only, inclusive native latitude/longitude limits; preserve zero. */
export function getPortalMapCoordinates(
    latitude: AirtableValue,
    longitude: AirtableValue
): PortalMapCoordinates | null {
    const lat = coordinate(latitude);
    const lng = coordinate(longitude);
    return lat == null ||
        lng == null ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
        ? null
        : { lat, lng };
}
