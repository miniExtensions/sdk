import assert from 'node:assert/strict';
import test from 'node:test';
import type { AirtableValue } from '../src/runtime/types.js';
import { getPortalMapCoordinates } from '../src/portals/map/coordinates.js';

const valid: readonly [
    AirtableValue,
    AirtableValue,
    { lat: number; lng: number },
][] = [
    [42.3601, -71.0589, { lat: 42.3601, lng: -71.0589 }],
    [' **42.3601** ', ['`-71.0589`'], { lat: 42.3601, lng: -71.0589 }],
    [['+90', '45'], ['-.5', '80'], { lat: 90, lng: -0.5 }],
    [0, 0, { lat: 0, lng: 0 }],
    ['-90', '+180', { lat: -90, lng: 180 }],
    [['.5'], ['-180.'], { lat: 0.5, lng: -180 }],
];
for (const [latitude, longitude, expected] of valid)
    test(`native coordinate vector ${JSON.stringify([latitude, longitude])}`, () => {
        assert.deepEqual(
            getPortalMapCoordinates(latitude, longitude),
            expected
        );
    });
const invalid: readonly [AirtableValue, AirtableValue][] = [
    [null, '10'],
    ['10', null],
    ['', '10'],
    ['42 north', '10'],
    ['1e2', '10'],
    [[], '10'],
    [false, '10'],
    [{ error: 'invalid_formula' }, '10'],
    [Infinity, '10'],
    ['90.0001', '10'],
    ['-90.0001', '10'],
    ['10', '180.0001'],
    ['10', '-180.0001'],
    [['bad', '42'], ['10']],
    [NaN, 10],
    ['0x20', '10'],
    [['', '42'], '10'],
    ['10', '1,2'],
];
for (const [latitude, longitude] of invalid)
    test(`native rejected coordinate vector ${JSON.stringify([latitude, longitude])}`, () => {
        assert.equal(getPortalMapCoordinates(latitude, longitude), null);
    });
test('first-member traversal safely declines non-JSON cyclic external arrays', () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    assert.equal(
        getPortalMapCoordinates(cyclic as unknown as AirtableValue, 0),
        null
    );
});
