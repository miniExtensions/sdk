import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import {
    createAddressAutocompleteRequests,
    type AddressAutocompleteRequestOptions,
    type AddressAutocompleteRequests,
} from '../src/ui/index.js';
import type { AddressPrediction } from '../src/runtime/types.js';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const settle = async () => {
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
};
const prediction = { description: 'Selected address', placeId: 'place-a' };
const fixture = (
    test: TestContext,
    reads: AddressAutocompleteRequestOptions['reads'],
    overrides: Partial<Omit<AddressAutocompleteRequestOptions, 'reads'>> = {}
) => {
    test.mock.timers.enable({ apis: ['setTimeout'] });
    const values: string[] = [];
    const phases: string[] = [];
    const model = createAddressAutocompleteRequests({
        reads,
        isCurrent: () => true,
        onValue: (value) => {
            values.push(value);
        },
        onStateChange: (state) => {
            phases.push(state.phase);
        },
        ...overrides,
    });
    test.after(() => {
        model.destroy();
        test.mock.timers.reset();
    });
    const load = async (query = 'Query') => {
        model.schedulePredictions(query);
        test.mock.timers.tick(800);
        await settle();
    };
    return { model, values, phases, load };
};

describe('headless address requests', { concurrency: false }, () => {
    it('debounces exact caller queries without acquiring a draft, cap or whitespace policy', async (test) => {
        const queries: string[] = [];
        const h = fixture(test, {
            listPredictions: async (query) => {
                queries.push(query);
                return [];
            },
            getFormattedAddress: async () => 'Unused',
        });
        h.model.schedulePredictions('First');
        test.mock.timers.tick(700);
        h.model.schedulePredictions('   caller-approved raw query   ');
        test.mock.timers.tick(799);
        assert.deepEqual(queries, []);
        test.mock.timers.tick(1);
        await settle();
        assert.deepEqual(queries, ['   caller-approved raw query   ']);
        assert.deepEqual(h.values, []);
        assert.equal(h.model.getState().phase, 'predictions');
    });

    it('rejects stale prediction success and failure even when abort is ignored', async (test) => {
        const old = deferred<AddressPrediction[]>();
        const fresh = deferred<AddressPrediction[]>();
        const staleFailure = deferred<AddressPrediction[]>();
        const replies = [old, fresh, staleFailure];
        const signals: AbortSignal[] = [];
        const h = fixture(test, {
            listPredictions: async (_query, options) => {
                signals.push(options.signal);
                return replies.shift()!.promise;
            },
            getFormattedAddress: async () => 'Unused',
        });
        await h.load('Old');
        await h.load('Fresh');
        assert.equal(signals[0]?.aborted, true);
        fresh.resolve([prediction]);
        await settle();
        const current = h.model.getState();
        old.resolve([{ description: 'Stale', placeId: 'old' }]);
        await settle();
        assert.equal(h.model.getState(), current);
        await h.load('Will fail late');
        h.model.retire();
        staleFailure.reject(new Error('Private provider diagnostic'));
        await settle();
        assert.equal(h.model.getState().phase, 'idle');
        assert.equal(signals[2]?.aborted, true);
        assert.deepEqual(h.values, []);
    });

    it('accepts a description before details and retries only the selected failed place', async (test) => {
        const order: string[] = [];
        let attempts = 0;
        const h = fixture(
            test,
            {
                listPredictions: async () => [prediction],
                getFormattedAddress: async (placeId) => {
                    order.push(`read:${placeId}`);
                    if (++attempts === 1)
                        throw new Error('Provider unavailable');
                    return 'Canonical address';
                },
            },
            {
                onValue: (value, source) => {
                    order.push(`${source}:${value}`);
                },
            }
        );
        await h.load();
        h.model.select(h.model.getState().predictions[0]!);
        assert.deepEqual(order, ['selection:Selected address', 'read:place-a']);
        await settle();
        assert.equal(h.model.getState().phase, 'failed-details');
        h.model.retry('A different query does not change the failed place');
        await settle();
        assert.deepEqual(order, [
            'selection:Selected address',
            'read:place-a',
            'read:place-a',
            'detail:Canonical address',
        ]);
        assert.equal(h.model.getState().phase, 'details');
    });

    it('retries failed predictions immediately with the caller current query', async (test) => {
        const queries: string[] = [];
        const h = fixture(test, {
            listPredictions: async (query) => {
                queries.push(query);
                if (queries.length === 1) throw new Error('Unavailable');
                return [prediction];
            },
            getFormattedAddress: async () => 'Unused',
        });
        await h.load('Initial');
        assert.equal(h.model.getState().phase, 'failed-predictions');
        h.model.retry('Caller current value');
        await settle();
        assert.deepEqual(queries, ['Initial', 'Caller current value']);
        assert.equal(h.model.getState().phase, 'predictions');
        h.model.retry('No failed read');
        assert.equal(queries.length, 2);
    });

    it('retires details across external replacement and same-place A-B-A without reviving an old snapshot', async (test) => {
        const old = deferred<string>();
        const next = deferred<string>();
        const signals: AbortSignal[] = [];
        const replies = [old, next];
        const h = fixture(test, {
            listPredictions: async () => [prediction],
            getFormattedAddress: async (_place, options) => {
                signals.push(options.signal);
                return replies.shift()!.promise;
            },
        });
        await h.load();
        const staleOption = h.model.getState().predictions[0]!;
        h.model.select(staleOption);
        h.model.retire(); // host applies its external draft independently
        assert.equal(signals[0]?.aborted, true);
        await h.load('Same address after replacement');
        h.model.select(staleOption);
        assert.equal(signals.length, 1);
        h.model.select(h.model.getState().predictions[0]!);
        old.resolve('Stale canonical A');
        next.resolve('Current canonical A');
        await settle();
        assert.deepEqual(h.values, [
            'Selected address',
            'Selected address',
            'Current canonical A',
        ]);
    });

    it('freezes isolated prediction snapshots and rejects forged or retired choices', async (test) => {
        const raw = { ...prediction };
        const h = fixture(test, {
            listPredictions: async () => [raw],
            getFormattedAddress: async () => 'Canonical',
        });
        await h.load();
        const snapshot = h.model.getState();
        raw.description = 'Changed by transport';
        assert.equal(snapshot.predictions[0]?.description, 'Selected address');
        assert.equal(Object.isFrozen(snapshot), true);
        assert.equal(Object.isFrozen(snapshot.predictions), true);
        assert.equal(Object.isFrozen(snapshot.predictions[0]), true);
        h.model.select({ ...prediction });
        assert.deepEqual(h.values, []);
        h.model.retire();
        h.model.select(snapshot.predictions[0]!);
        assert.deepEqual(h.values, []);
    });

    it('drops a pending detail after destroy even if the transport ignores abort', async (test) => {
        const pending = deferred<string>();
        let signal: AbortSignal | undefined;
        const h = fixture(test, {
            listPredictions: async () => [prediction],
            getFormattedAddress: async (_place, options) => {
                signal = options.signal;
                return pending.promise;
            },
        });
        await h.load();
        h.model.select(h.model.getState().predictions[0]!);
        const notifications = h.phases.length;
        h.model.destroy();
        assert.equal(signal?.aborted, true);
        pending.resolve('Late disposed detail');
        await settle();
        assert.deepEqual(h.values, ['Selected address']);
        assert.equal(h.phases.length, notifications);
        assert.equal(h.model.getState().phase, 'idle');
    });

    it('does not publish a completed detail after its value callback retires the intent', async (test) => {
        let model!: AddressAutocompleteRequests;
        const accepted: string[] = [];
        const h = fixture(
            test,
            {
                listPredictions: async () => [prediction],
                getFormattedAddress: async () => 'Current canonical value',
            },
            {
                onValue: (value, source) => {
                    accepted.push(value);
                    if (source === 'detail') model.retire();
                },
            }
        );
        model = h.model;
        await h.load();
        model.select(model.getState().predictions[0]!);
        await settle();
        assert.deepEqual(accepted, [
            'Selected address',
            'Current canonical value',
        ]);
        assert.equal(model.getState().phase, 'idle');
        assert.equal(h.phases.includes('details'), false);
    });

    it('prevents reads after state or acceptance callbacks retire the intent', async (test) => {
        let model!: AddressAutocompleteRequests;
        let reads = 0;
        const h = fixture(
            test,
            {
                listPredictions: async () => {
                    reads++;
                    return [prediction];
                },
                getFormattedAddress: async () => {
                    reads++;
                    return 'Forbidden';
                },
            },
            {
                onStateChange: (state) => {
                    if (state.phase === 'loading-predictions') model.retire();
                },
            }
        );
        model = h.model;
        await h.load();
        assert.equal(reads, 0);
    });

    it('does not dispatch details after acceptance retires the selection', async (test) => {
        let reads = 0;
        let selectionModel!: AddressAutocompleteRequests;
        const selected = fixture(
            test,
            {
                listPredictions: async () => [prediction],
                getFormattedAddress: async () => {
                    reads++;
                    return 'Forbidden';
                },
            },
            {
                onValue: () => {
                    selectionModel.retire();
                },
            }
        );
        selectionModel = selected.model;
        await selected.load();
        selected.model.select(selected.model.getState().predictions[0]!);
        await settle();
        assert.equal(reads, 0);
        assert.equal(selected.model.getState().phase, 'idle');
    });

    for (const declined of ['selection', 'detail'] as const)
        it(`allows a caller to decline ${declined} without an automatic retry`, async (test) => {
            let reads = 0;
            const h = fixture(
                test,
                {
                    listPredictions: async () => [prediction],
                    getFormattedAddress: async () => {
                        reads++;
                        return 'Canonical';
                    },
                },
                {
                    onValue: (_value, source) =>
                        source === declined ? false : undefined,
                }
            );
            await h.load();
            h.model.select(h.model.getState().predictions[0]!);
            await settle();
            assert.equal(reads, declined === 'selection' ? 0 : 1);
            assert.equal(h.model.getState().phase, 'idle');
        });

    it('treats malformed transport payloads as read failures without accepting a value', async (test) => {
        let predictionsFail = true;
        const h = fixture(test, {
            listPredictions: async () =>
                predictionsFail
                    ? JSON.parse('[{"placeId":"one","description":42}]')
                    : [prediction],
            getFormattedAddress: async () => JSON.parse('42'),
        });
        await h.load();
        assert.equal(h.model.getState().phase, 'failed-predictions');
        predictionsFail = false;
        h.model.retry('Current');
        await settle();
        h.model.select(h.model.getState().predictions[0]!);
        await settle();
        assert.equal(h.model.getState().phase, 'failed-details');
        assert.deepEqual(h.values, ['Selected address']);
    });

    it('rejects work for a false or throwing owner and makes destroy permanent', async (test) => {
        let current = true;
        let reads = 0;
        const h = fixture(
            test,
            {
                listPredictions: async () => {
                    reads++;
                    return [prediction];
                },
                getFormattedAddress: async () => 'Unused',
            },
            {
                isCurrent: () => {
                    if (!current) throw new Error('Retired');
                    return true;
                },
            }
        );
        h.model.schedulePredictions('Pending');
        current = false;
        test.mock.timers.tick(800);
        await settle();
        assert.equal(reads, 0);
        current = true;
        await h.load('Current');
        const option = h.model.getState().predictions[0]!;
        const stateCalls = h.phases.length;
        h.model.destroy();
        h.model.destroy();
        h.model.schedulePredictions('Disposed');
        h.model.select(option);
        h.model.retry('Disposed');
        test.mock.timers.tick(800);
        await settle();
        assert.equal(reads, 1);
        assert.equal(h.phases.length, stateCalls);
        assert.deepEqual(h.values, []);
    });
});
