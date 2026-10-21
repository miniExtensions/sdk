import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const addressRequestsTypedConsumer = `
import {createAddressAutocompleteRequests,type AddressAutocompleteRequests,type AddressAutocompleteRequestOptions,type AddressAutocompleteRequestState} from '@miniextensions/sdk/ui';
const addressReads:AddressAutocompleteRequestOptions['reads']={
    listPredictions:async(query,{signal})=>{const exactQuery:string=query;const cancellation:AbortSignal=signal;void [exactQuery,cancellation];return [{description:'Address',placeId:'one'}];},
    getFormattedAddress:async(placeId,{signal})=>{void signal;return placeId;},
};
const addressRequests:AddressAutocompleteRequests=createAddressAutocompleteRequests({reads:addressReads,isCurrent:()=>true,onValue(value,source){const accepted:string=value;const kind:'selection'|'detail'=source;void [accepted,kind];},onStateChange(state){const snapshot:AddressAutocompleteRequestState=state;void snapshot;}});
const addressRequestSnapshot=addressRequests.getState();
addressRequests.schedulePredictions('Caller query');
addressRequests.retry('Caller current query');
if(addressRequestSnapshot.predictions[0])addressRequests.select(addressRequestSnapshot.predictions[0]);
// @ts-expect-error request snapshots are not a mutable option store
addressRequestSnapshot.predictions.push({description:'Other',placeId:'two'});
// @ts-expect-error queries remain strings chosen by the caller
addressRequests.schedulePredictions(42);
// @ts-expect-error acceptance is synchronous, not a deferred permission decision
createAddressAutocompleteRequests({reads:addressReads,isCurrent:()=>true,onValue:async()=>{}});
addressRequests.retire();addressRequests.destroy();
`;

const deferred = () => {
    let resolve;
    const promise = new Promise((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
};
const settle = async () => {
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
};

/** Exercise only the installed archive, in both published module formats. */
export async function checkAddressRequestsConsumer({ consumerDirectory }) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/ui/index.js'
            )
        ).href
    );
    let groups = 0;
    for (const api of [esm, require('@miniextensions/sdk/ui')]) {
        let predictionsReady = deferred();
        const completed = deferred();
        const oldDetail = deferred();
        const values = [];
        const queries = [];
        const signals = [];
        let details = 0;
        let owner = true;
        let deadline;
        const timeout = new Promise((_, reject) => {
            deadline = setTimeout(
                () =>
                    reject(new Error('Installed address lifecycle timed out.')),
                10000
            );
        });
        const model = api.createAddressAutocompleteRequests({
            reads: {
                listPredictions: async (query) => {
                    queries.push(query);
                    return [
                        {
                            description: 'Selected address',
                            placeId: 'same-place',
                        },
                    ];
                },
                getFormattedAddress: async (_placeId, { signal }) => {
                    signals.push(signal);
                    return ++details === 1
                        ? oldDetail.promise
                        : 'Current canonical';
                },
            },
            isCurrent: () => owner,
            onValue: (value, source) => {
                values.push([source, value]);
            },
            onStateChange: (state) => {
                if (state.phase === 'predictions') predictionsReady.resolve();
                if (state.phase === 'details') completed.resolve();
            },
        });
        try {
            await Promise.race([
                (async () => {
                    model.schedulePredictions('Raw caller query');
                    await predictionsReady.promise;
                    const oldOption = model.getState().predictions[0];
                    assert.equal(Object.isFrozen(oldOption), true);
                    model.select(oldOption);
                    assert.deepEqual(values, [
                        ['selection', 'Selected address'],
                    ]);
                    model.retire();
                    assert.equal(signals[0].aborted, true);
                    oldDetail.resolve('Retired canonical');
                    await settle();
                    assert.deepEqual(values, [
                        ['selection', 'Selected address'],
                    ]);
                    predictionsReady = deferred();
                    model.schedulePredictions('Current caller query');
                    await predictionsReady.promise;
                    model.select(oldOption);
                    assert.equal(details, 1);
                    model.select(model.getState().predictions[0]);
                    await completed.promise;
                    assert.deepEqual(values, [
                        ['selection', 'Selected address'],
                        ['selection', 'Selected address'],
                        ['detail', 'Current canonical'],
                    ]);
                    assert.deepEqual(queries, [
                        'Raw caller query',
                        'Current caller query',
                    ]);
                    owner = false;
                    model.schedulePredictions('Foreign owner');
                    model.retry('Foreign owner');
                    assert.equal(queries.length, 2);
                    model.destroy();
                    model.select(oldOption);
                    assert.equal(details, 2);
                    assert.equal(model.getState().phase, 'idle');
                })(),
                timeout,
            ]);
            groups++;
        } finally {
            clearTimeout(deadline);
            model.destroy();
        }
        for (const replacement of ['retire', 'newer-query']) {
            const ready = deferred();
            const queries = [];
            let armed = false;
            let reentryDeadline;
            const timeout = new Promise((_, reject) => {
                reentryDeadline = setTimeout(
                    () =>
                        reject(new Error('Installed idle reentry timed out.')),
                    10000
                );
            });
            const reentrant = api.createAddressAutocompleteRequests({
                reads: {
                    listPredictions: async (query) => {
                        queries.push(query);
                        return [
                            {
                                description: 'Synthetic address',
                                placeId: 'one',
                            },
                        ];
                    },
                    getFormattedAddress: async () => 'Unused',
                },
                isCurrent: () => true,
                onValue: () => {
                    throw new Error(
                        'Prediction scheduling cannot accept a value.'
                    );
                },
                onStateChange: (state) => {
                    if (state.phase === 'predictions') ready.resolve();
                    if (armed && state.phase === 'idle') {
                        armed = false;
                        if (replacement === 'retire') reentrant.retire();
                        else reentrant.schedulePredictions('Newer query');
                    }
                },
            });
            try {
                await Promise.race([
                    (async () => {
                        reentrant.schedulePredictions('Initial query');
                        await ready.promise;
                        armed = true;
                        reentrant.schedulePredictions('Obsolete query');
                        await new Promise((resolve) =>
                            setTimeout(resolve, 850)
                        );
                        assert.deepEqual(
                            queries,
                            replacement === 'retire'
                                ? ['Initial query']
                                : ['Initial query', 'Newer query']
                        );
                    })(),
                    timeout,
                ]);
            } finally {
                clearTimeout(reentryDeadline);
                reentrant.destroy();
            }
        }
    }
    return groups;
}
