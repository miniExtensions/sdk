import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const canonicalFormTypedConsumer = `
import {createCanonicalFormFrame,transitionCanonicalFormFrame,type CanonicalFormFrame,type CanonicalFormEvent,type CanonicalFormTransitionPorts,type CanonicalFormTransitionResult} from '@miniextensions/sdk/forms';
import {transitionCanonicalFormCompute,type CanonicalFormComputeFrame,type CanonicalFormComputeOutcome,type CanonicalFormComputePorts,type CanonicalFormComputeRequest} from '@miniextensions/sdk/forms';
type CanonicalConsumerAuthority={request:'accepted-native-action'};
type CanonicalConsumerAllocation={requestId:string};
declare const canonicalConsumerFrame:CanonicalFormFrame;
declare const canonicalConsumerAuthority:CanonicalConsumerAuthority;
declare const canonicalConsumerEvent:CanonicalFormEvent<CanonicalConsumerAuthority,CanonicalConsumerAllocation>;
declare const canonicalConsumerPorts:CanonicalFormTransitionPorts<CanonicalConsumerAuthority,CanonicalConsumerAllocation>;
const canonicalConsumerSnapshot:CanonicalFormFrame=createCanonicalFormFrame(canonicalConsumerFrame);
const canonicalConsumerResult:CanonicalFormTransitionResult=transitionCanonicalFormFrame(canonicalConsumerSnapshot,canonicalConsumerEvent,canonicalConsumerPorts);
// @ts-expect-error canonical values are readonly compatibility views
canonicalConsumerSnapshot.values.fld_amount=2;
// @ts-expect-error dirty order cannot be mutated by a consumer
canonicalConsumerSnapshot.dirtyFieldIds.push('fld_amount');
const canonicalUndefinedWrite={type:'edit' as const,authority:canonicalConsumerAuthority,fieldId:'fld_amount',value:undefined,dirty:'append' as const};
// @ts-expect-error undefined is not a new canonical UI-write operation
transitionCanonicalFormFrame(canonicalConsumerSnapshot,canonicalUndefinedWrite,canonicalConsumerPorts);
// @ts-expect-error matching-looking plain metadata cannot replace mandatory host admission
transitionCanonicalFormFrame(canonicalConsumerSnapshot,canonicalConsumerEvent,{...canonicalConsumerPorts,admit:undefined});
// @ts-expect-error the frame is not a second controller or transport client
canonicalConsumerSnapshot.client.forms.save({});
void canonicalConsumerResult;
declare const computeFrame:CanonicalFormComputeFrame;
declare const computeRequest:CanonicalFormComputeRequest<CanonicalConsumerAllocation>;
declare const computePorts:CanonicalFormComputePorts<CanonicalConsumerAllocation>;
declare const computeOutcome:CanonicalFormComputeOutcome<{code:'HOST_FAILURE'}>;
const computeSettlement=transitionCanonicalFormCompute(computeFrame,computeRequest,computeOutcome,computePorts);
if(computeSettlement.disposition==='computeFailed'){
    const code:'HOST_FAILURE'=computeSettlement.failure.code;
    void code;
}
// @ts-expect-error the existing non-Compute frame never grants Compute admission
transitionCanonicalFormCompute(canonicalConsumerFrame,computeRequest,computeOutcome,computePorts);
`;

function checkComputeSettlement(api) {
    const frame = {
        owner: {
            cohort: 'public-direct-root-compute',
            installation: 'accepted_native_installation',
        },
        record: { type: 'create' },
        values: { answer: 'A', cleared: null, omitted: [] },
        dirtyFieldIds: ['cleared', 'answer', 'omitted'],
        errors: { answer: 'Existing error' },
        loadedPolicyBaseline: { answer: 'Loaded' },
        isFormReadOnly: false,
        provenance: {
            instanceGeneration: 1,
            fieldGenerations: { answer: 5, cleared: 6, omitted: 7 },
            complete: true,
        },
        renderLease: { ownerGeneration: 1 },
    };
    const allocation = Symbol('actual allocated Compute');
    const request = {
        allocation,
        owner: frame.owner,
        requestId: 'request-a',
        record: frame.record,
        provenance: {
            ...frame.provenance,
            fieldGenerations: { answer: 2, cleared: 3, omitted: 4 },
        },
        submittedValues: { answer: 'A', cleared: 'Old' },
        validationValues: { answer: 'A', cleared: 'Old', omitted: [] },
        addOnlyTextFieldIds: [],
    };
    const ports = {
        isCurrent: (_frame, captured) => captured.allocation === allocation,
        areValuesEquivalent: (current, captured) =>
            JSON.stringify(current) === JSON.stringify(captured),
        allocateInstanceGeneration: () => 8,
        retainRenderLease: () => true,
    };
    const reply = {
        type: 'returned',
        record: { type: 'edit', recordId: 'rec_adopted', tableId: 'tbl_form' },
        values: {
            answer: 'Server',
            cleared: 'Old',
            omitted: ['old'],
            total: 12,
        },
    };
    const success = api.transitionCanonicalFormCompute(
        frame,
        request,
        reply,
        ports
    );
    assert.equal(success.disposition, 'computeSettled');
    assert.deepEqual(success.frame.record, reply.record);
    assert.deepEqual(success.frame.values, {
        answer: 'A',
        cleared: null,
        omitted: [],
        total: 12,
    });
    assert.deepEqual(success.frame.dirtyFieldIds, frame.dirtyFieldIds);
    assert.equal(
        success.frame.loadedPolicyBaseline,
        frame.loadedPolicyBaseline
    );
    assert.equal(success.frame.renderLease, frame.renderLease);
    assert.ok(Object.isFrozen(success.frame.values.omitted));

    const verificationError = new Error('synthetic validation error');
    const verification = {
        type: 'validationFailed',
        errors: { cleared: 'Refused' },
        failure: verificationError,
    };
    const changed = api.transitionCanonicalFormCompute(
        frame,
        request,
        verification,
        ports
    );
    assert.equal(changed.disposition, 'computeValidationSuperseded');
    assert.equal(changed.frame.errors, frame.errors);
    const current = api.transitionCanonicalFormCompute(
        frame,
        { ...request, validationValues: frame.values },
        verification,
        ports
    );
    assert.equal(current.disposition, 'computeFailed');
    assert.equal(current.failure, verificationError);
    assert.deepEqual(current.frame.errors, verification.errors);

    const successor = {
        ...frame,
        provenance: { ...frame.provenance, instanceGeneration: 20 },
    };
    for (const outcome of [reply, verification]) {
        const stale = api.transitionCanonicalFormCompute(
            successor,
            request,
            outcome,
            ports
        );
        assert.deepEqual(stale, { disposition: 'stale', frame: successor });
        assert.equal(stale.frame, successor);
    }
}

/** Actual packed public ESM and CJS entrypoints, without React or host transport. */
export async function checkCanonicalFormConsumer({ consumerDirectory }) {
    const loader = join(consumerDirectory, 'canonical-form-public.mjs');
    writeFileSync(
        loader,
        "export {createCanonicalFormFrame,transitionCanonicalFormFrame,transitionCanonicalFormCompute} from '@miniextensions/sdk/forms';\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    for (const api of [esm, require('@miniextensions/sdk/forms')]) {
        const authority = {};
        const allocation = { requestId: 'native_request' };
        let current = false;
        let generation = 2;
        let allocations = 0;
        let validations = 0;
        const input = {
            owner: {
                cohort: 'public-direct-root-non-compute',
                installation: 'accepted_native_installation',
            },
            record: { type: 'edit', recordId: 'rec_a', tableId: 'tbl_a' },
            values: { amount: 1, adjacent: 'Keep' },
            dirtyFieldIds: [],
            errors: { amount: 'Existing error' },
            loadedPolicyBaseline: { amount: 0, adjacent: 'Loaded' },
            isFormReadOnly: false,
            provenance: {
                instanceGeneration: 1,
                fieldGenerations: { amount: 2 },
                complete: true,
            },
            renderLease: { ownerGeneration: 1 },
            manualReadonlyCompute: {
                requestId: 'presentation_only',
                phase: 'settled',
                candidateFieldIds: ['amount'],
                settledFieldIds: ['amount'],
            },
        };
        const frame = api.createCanonicalFormFrame(input);
        input.values.adjacent = 'Caller changed';
        assert.equal(frame.values.adjacent, 'Keep');
        const ports = {
            admit: (_frame, event) =>
                current &&
                event.authority === authority &&
                ((event.type !== 'settleSave' && event.type !== 'saveFailed') ||
                    event.allocation === allocation),
            areValuesEquivalent: (_fieldId, before, after) => before === after,
            isReadonlyUrlPrefill: () => false,
            allocateGeneration: () => {
                allocations++;
                return ++generation;
            },
            validateEdit: (_before, next) => {
                validations++;
                assert.equal(next.values.amount, 2);
                assert.equal(
                    next.loadedPolicyBaseline,
                    frame.loadedPolicyBaseline
                );
                return {};
            },
            retainRenderLease: () => true,
        };
        const edit = {
            type: 'edit',
            authority,
            fieldId: 'amount',
            value: 2,
            dirty: 'append',
        };
        const stale = api.transitionCanonicalFormFrame(frame, edit, ports);
        assert.equal(stale.disposition, 'stale');
        assert.equal(stale.frame, frame);
        assert.equal(allocations, 0);
        assert.equal(validations, 0);
        current = true;
        const equal = api.transitionCanonicalFormFrame(
            frame,
            { ...edit, value: 1 },
            ports
        );
        assert.equal(equal.disposition, 'unchanged');
        assert.equal(equal.frame.values, frame.values);
        assert.equal(equal.frame.errors, frame.errors);
        assert.equal(equal.frame.dirtyFieldIds, frame.dirtyFieldIds);
        assert.equal(equal.frame.manualReadonlyCompute, undefined);
        assert.equal(allocations, 0);
        assert.equal(validations, 0);
        const edited = api.transitionCanonicalFormFrame(frame, edit, ports);
        assert.equal(edited.disposition, 'edited');
        assert.deepEqual(edited.frame.values, { amount: 2, adjacent: 'Keep' });
        assert.deepEqual(edited.frame.dirtyFieldIds, ['amount']);
        assert.equal(validations, 1);
        assert.equal(allocations, 1);
        const settlement = api.transitionCanonicalFormFrame(
            edited.frame,
            {
                type: 'settleSave',
                authority,
                allocation,
                record: { type: 'edit', recordId: 'rec_a', tableId: 'tbl_a' },
                values: { amount: 1.5, adjacent: 'Keep' },
                dirtyFieldIdsToKeep: ['adjacent', 'adjacent'],
            },
            ports
        );
        assert.equal(settlement.disposition, 'saveSettled');
        assert.equal(settlement.frame.values.amount, 1.5);
        assert.deepEqual(settlement.frame.dirtyFieldIds, ['adjacent']);
        assert.equal(
            settlement.frame.loadedPolicyBaseline,
            frame.loadedPolicyBaseline
        );
        assert.equal(settlement.frame.renderLease, edited.frame.renderLease);
        assert.equal(Object.isFrozen(settlement.frame.values), true);
        assert.equal(settlement.frame.client, undefined);
        assert.equal(settlement.frame.subscribe, undefined);
        const failure = { kind: 'native-validation' };
        const failedEvent = {
            type: 'saveFailed',
            authority,
            allocation,
            failure,
            errors: { amount: 'Rejected' },
        };
        const staleFailure = api.transitionCanonicalFormFrame(
            edited.frame,
            { ...failedEvent, allocation: { ...allocation } },
            ports
        );
        assert.equal(staleFailure.disposition, 'stale');
        assert.equal(staleFailure.frame, edited.frame);
        assert.equal(staleFailure.failure, undefined);
        const acceptedFailure = api.transitionCanonicalFormFrame(
            edited.frame,
            failedEvent,
            ports
        );
        assert.equal(acceptedFailure.disposition, 'saveFailed');
        assert.equal(acceptedFailure.failure, failure);
        assert.deepEqual(acceptedFailure.frame.errors, { amount: 'Rejected' });
        assert.equal(acceptedFailure.frame.values, edited.frame.values);
        assert.equal(Object.isFrozen(acceptedFailure.frame.errors), true);
        checkComputeSettlement(api);
    }
    return 2;
}
