import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    getEffectiveFormTracking,
    captureFormTrackingPolicy,
    prepareAllocatedFormTracking,
    readBrowserFormLocation,
    type FormTrackingState,
    type FormLocation,
} from '../src/forms/index.js';

for (const [state, expected] of [
    [{}, [false, false]],
    [
        {
            enableTracking: false,
            userIPAddressField: 'ip',
            userLatitudeField: 'lat',
        },
        [false, false],
    ],
    [{ enableTracking: true }, [false, false]],
    [{ enableTracking: true, userIPAddressField: 'ip' }, [true, false]],
    [{ enableTracking: true, userLatitudeField: 'lat' }, [false, true]],
    [{ enableTracking: true, userLongitudeField: 'long' }, [false, true]],
    [
        {
            enableTracking: true,
            userIPAddressField: 'ip',
            userLatitudeField: 'lat',
            userLongitudeField: 'long',
        },
        [true, true],
    ],
] satisfies [FormTrackingState, boolean[]][]) {
    it(`preserves effective native tracking policy ${JSON.stringify(state)}`, async () => {
        const policy = getEffectiveFormTracking(state);
        assert.deepEqual(policy, {
            collectIPAddress: expected[0],
            collectLocation: expected[1],
        });
        let calls = 0;
        await prepareAllocatedFormTracking({
            policy: captureFormTrackingPolicy(state),
            async readLocation() {
                calls++;
                return {};
            },
        });
        assert.equal(calls, expected[1] ? 1 : 0);
    });
}
for (const [lat, long] of [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
]) {
    it(`projects exact zero for configured axes ${lat}/${long}`, async () => {
        const policy = captureFormTrackingPolicy({
            enableTracking: true,
            userLatitudeField: lat ? 'lat' : null,
            userLongitudeField: long ? 'long' : null,
        });
        const actual = await prepareAllocatedFormTracking({
            policy,
            readLocation: async () => ({ lat: 0, long: 0 }),
        });
        assert.deepEqual(
            actual,
            lat || long
                ? {
                      latitude: lat ? 0 : undefined,
                      longitude: long ? 0 : undefined,
                  }
                : {}
        );
        assert.equal(Object.isFrozen(policy), true);
    });
}
it('captures destinations before the reader settles without owning successor or draft', async () => {
    const config = {
        enableTracking: true,
        userLatitudeField: 'original-lat',
        userLongitudeField: null as string | null,
    };
    let resolve!: (value: FormLocation) => void;
    const pending = prepareAllocatedFormTracking({
        policy: captureFormTrackingPolicy(config),
        readLocation: () =>
            new Promise((r) => {
                resolve = r;
            }),
    });
    config.enableTracking = false;
    config.userLatitudeField = 'successor-lat';
    config.userLongitudeField = 'successor-long';
    resolve({ lat: 0, long: 7 });
    assert.deepEqual(await pending, { latitude: 0, longitude: undefined });
});
it('preserves native empty destination disclosure versus projection', async () => {
    const policy = captureFormTrackingPolicy({
        enableTracking: true,
        userLatitudeField: '',
    });
    assert.equal(policy.collectLocation, true);
    assert.deepEqual(
        await prepareAllocatedFormTracking({
            policy,
            readLocation: async () => ({ lat: 1, long: 2 }),
        }),
        { latitude: undefined, longitude: undefined }
    );
});
it('falls back once on rejected reader even when diagnostic reporting throws', async () => {
    const failure = new Error('synthetic reader failure');
    let calls = 0,
        logs = 0;
    assert.deepEqual(
        await prepareAllocatedFormTracking({
            policy: captureFormTrackingPolicy({
                enableTracking: true,
                userLatitudeField: 'lat',
            }),
            async readLocation() {
                calls++;
                throw failure;
            },
            onError(error) {
                logs++;
                assert.equal(error, failure);
                throw new Error('synthetic diagnostic failure');
            },
        }),
        {}
    );
    assert.equal(calls, 1);
    assert.equal(logs, 1);
});
it('browserless explicit reader invocation falls back without a DOM', async () => {
    assert.equal(typeof document, 'undefined');
    let failures = 0;
    assert.deepEqual(
        await readBrowserFormLocation(() => {
            failures++;
        }),
        {}
    );
    assert.equal(failures, 1);
});
