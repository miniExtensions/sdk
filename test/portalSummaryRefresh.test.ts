import assert from 'node:assert/strict';
import { it } from 'node:test';
import { refreshPortalSummaryFields } from '../src/portals/index.js';
import type { PortalSummaryRefreshOptions } from '../src/portals/index.js';

const setup = () => {
    const fresh: { value: string }[] = [];
    let stale = 0;
    let reads = 0;
    let current = 1;
    const record = { value: 'Synthetic summary' };
    const options: PortalSummaryRefreshOptions<typeof record> = {
        generation: 1,
        isLatestGeneration: (generation) => generation === current,
        fetchRecord: async () => {
            reads++;
            return record;
        },
        onFresh: (value) => {
            fresh.push(value);
        },
        onStale: () => {
            stale++;
        },
    };
    return {
        options,
        record,
        fresh,
        retire: () => {
            current++;
        },
        counts: () => ({ reads, stale }),
    };
};
const deferred = () => {
    let resolve!: (value: { value: string }) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<{ value: string }>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};

it('applies the exact returned record once without a second read', async () => {
    const state = setup();
    await refreshPortalSummaryFields(Object.freeze(state.options));
    assert.deepEqual(state.counts(), { reads: 1, stale: 0 });
    assert.equal(state.fresh.length, 1);
    assert.equal(state.fresh[0], state.record);
});
it('retries a failed read once and applies only its successful replacement', async () => {
    const state = setup();
    let calls = 0;
    await refreshPortalSummaryFields({
        ...state.options,
        fetchRecord: async () => {
            if (++calls === 1) throw new Error('Synthetic temporary failure');
            return state.record;
        },
    });
    assert.equal(calls, 2);
    assert.deepEqual(state.fresh, [state.record]);
    assert.equal(state.counts().stale, 0);
});
it('reports stale once after two failed reads without applying a record', async () => {
    const state = setup();
    let calls = 0;
    await refreshPortalSummaryFields({
        ...state.options,
        fetchRecord: async () => {
            calls++;
            throw new Error('Synthetic failure');
        },
    });
    assert.equal(calls, 2);
    assert.deepEqual(state.fresh, []);
    assert.equal(state.counts().stale, 1);
});
it('does no work when the captured owner has already retired', async () => {
    const state = setup();
    state.retire();
    await refreshPortalSummaryFields(state.options);
    assert.deepEqual(state.counts(), { reads: 0, stale: 0 });
    assert.deepEqual(state.fresh, []);
});
for (const outcome of ['success', 'failure'] as const) {
    it(`ignores an older ${outcome} after a newer refresh owns the summary`, async () => {
        const state = setup();
        const older = deferred();
        let calls = 0;
        const pending = refreshPortalSummaryFields({
            ...state.options,
            fetchRecord: () => {
                calls++;
                return older.promise;
            },
        });
        state.retire();
        await refreshPortalSummaryFields({ ...state.options, generation: 2 });
        if (outcome === 'success') older.resolve({ value: 'Retired summary' });
        else older.reject(new Error('Retired read failed'));
        await pending;
        assert.equal(calls, 1);
        assert.deepEqual(state.fresh, [state.record]);
        assert.deepEqual(state.counts(), { reads: 1, stale: 0 });
    });
}
it('rechecks ownership before the retry even if the failure was current', async () => {
    const state = setup();
    let checks = 0;
    let calls = 0;
    await refreshPortalSummaryFields({
        ...state.options,
        isLatestGeneration: () => ++checks < 3,
        fetchRecord: async () => {
            calls++;
            throw new Error('Read failed');
        },
    });
    assert.equal(calls, 1);
    assert.equal(checks, 3);
    assert.deepEqual(state.fresh, []);
    assert.equal(state.counts().stale, 0);
});
it('propagates application failures without replaying a read or reporting stale', async () => {
    const state = setup();
    const failure = new Error('Host dispatch failed');
    let applications = 0;
    await assert.rejects(
        refreshPortalSummaryFields({
            ...state.options,
            onFresh: () => {
                applications++;
                throw failure;
            },
        }),
        (error) => error === failure
    );
    assert.equal(applications, 1);
    assert.deepEqual(state.counts(), { reads: 1, stale: 0 });
});
it('propagates warning and guard failures rather than treating them as transport failures', async () => {
    const state = setup();
    const failure = new Error('Host callback failed');
    let calls = 0;
    await assert.rejects(
        refreshPortalSummaryFields({
            ...state.options,
            fetchRecord: async () => {
                calls++;
                throw new Error('Read failed');
            },
            onStale: () => {
                throw failure;
            },
        }),
        (error) => error === failure
    );
    assert.equal(calls, 2);
    await assert.rejects(
        refreshPortalSummaryFields({
            ...state.options,
            isLatestGeneration: () => {
                throw failure;
            },
        }),
        (error) => error === failure
    );
    assert.equal(state.counts().reads, 0);
});
