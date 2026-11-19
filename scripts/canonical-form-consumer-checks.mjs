import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const canonicalFormTypedConsumer = `
import {createCanonicalFormFrame,transitionCanonicalFormFrame,type CanonicalFormFrame,type CanonicalFormOwner,type CanonicalFormEvent,type CanonicalFormTransitionPorts,type CanonicalFormTransitionResult} from '@miniextensions/sdk/forms';
import {transitionCanonicalFormCompute,type CanonicalFormComputeFrame,type CanonicalFormComputeOutcome,type CanonicalFormComputePorts,type CanonicalFormComputeRequest} from '@miniextensions/sdk/forms';
type CanonicalConsumerAuthority={request:'accepted-native-action'};
type CanonicalConsumerAllocation={requestId:string};
declare const canonicalConsumerFrame:CanonicalFormFrame;
declare const canonicalConsumerAuthority:CanonicalConsumerAuthority;
declare const canonicalConsumerEvent:CanonicalFormEvent<CanonicalConsumerAuthority,CanonicalConsumerAllocation>;
declare const canonicalConsumerPorts:CanonicalFormTransitionPorts<CanonicalConsumerAuthority,CanonicalConsumerAllocation>;
const canonicalConsumerSnapshot:CanonicalFormFrame=createCanonicalFormFrame(canonicalConsumerFrame);
const canonicalConsumerResult:CanonicalFormTransitionResult=transitionCanonicalFormFrame(canonicalConsumerSnapshot,canonicalConsumerEvent,canonicalConsumerPorts);
const childOwner:CanonicalFormOwner={cohort:'public-child-or-portal',installation:'accepted_child_installation'};
const childInstall=transitionCanonicalFormFrame(null,{type:'install',authority:canonicalConsumerAuthority,frame:{...canonicalConsumerSnapshot,owner:childOwner}},canonicalConsumerPorts);
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
void childInstall;
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

export function checkCanonicalChildPortalOwnership(api) {
    const installation = {
        owner: {
            cohort: 'public-child-or-portal',
            installation: 'accepted_portal_child',
        },
        record: { type: 'edit', tableId: 'tbl_child', recordId: 'rec_child' },
        values: { notes: 'Loaded child', title: 'Loaded title' },
        dirtyFieldIds: [],
        errors: {},
        loadedPolicyBaseline: { notes: 'Loaded child', title: 'Loaded title' },
        isFormReadOnly: false,
        provenance: null,
        renderLease: null,
        manualReadonlyRetiredUrlFieldIds: ['notes'],
    };
    let current = null;
    let editAuthority = {};
    let nextGeneration = 0;
    let validationCalls = 0;
    let retireDuringValidation = false;
    const dispatch = (event) => {
        const before = current;
        let generation = nextGeneration;
        const result = api.transitionCanonicalFormFrame(before, event, {
            admit: (frame, action) =>
                frame === current && action.authority === editAuthority,
            allocateGeneration: () => ++generation,
            areValuesEquivalent: (_fieldId, left, right) => left === right,
            isReadonlyUrlPrefill: () => false,
            validateEdit: (_prior, next, fieldId) => {
                validationCalls++;
                if (retireDuringValidation) editAuthority = {};
                assert.deepEqual(
                    next.loadedPolicyBaseline,
                    installation.loadedPolicyBaseline
                );
                return fieldId === 'notes'
                    ? { notes: 'Review child notes' }
                    : next.errors;
            },
            retainRenderLease: () => false,
        });
        if (
            ['installed', 'edited', 'editInstanceReplaced'].includes(
                result.disposition
            )
        ) {
            current = result.frame;
            nextGeneration = generation;
        }
        return result;
    };
    assert.equal(
        dispatch({
            type: 'install',
            authority: editAuthority,
            frame: installation,
        }).disposition,
        'installed'
    );
    assert.deepEqual(current.manualReadonlyRetiredUrlFieldIds, ['notes']);
    for (const event of [
        {
            type: 'settleSave',
            allocation: {},
            record: installation.record,
            values: { notes: 'Unexpected Save' },
            dirtyFieldIdsToKeep: [],
        },
        { type: 'saveFailed', failure: new Error('Unexpected Save') },
    ]) {
        const frame = current;
        const refused = dispatch({ ...event, authority: editAuthority });
        assert.equal(refused.disposition, 'unsupportedCohort');
        assert.equal(refused.frame, frame);
    }
    const edit = (authority, fieldId, value) =>
        dispatch({ type: 'edit', authority, fieldId, value, dirty: 'append' });
    assert.equal(
        edit(editAuthority, 'notes', 'Draft child').disposition,
        'edited'
    );
    assert.equal(
        edit(editAuthority, 'title', 'Draft title').disposition,
        'edited'
    );
    const edited = current;
    const generationBeforePage = nextGeneration;
    // The host has verified that the appended page retained this installed child.
    const retained = dispatch({ type: 'preserve', authority: editAuthority });
    assert.equal(retained.disposition, 'preserved');
    assert.equal(retained.frame, edited);
    assert.equal(retained.frame.renderLease, edited.renderLease);
    assert.deepEqual(edited.dirtyFieldIds, ['notes', 'title']);
    assert.deepEqual(edited.errors, { notes: 'Review child notes' });
    assert.deepEqual(
        edited.loadedPolicyBaseline,
        installation.loadedPolicyBaseline
    );
    assert.equal(nextGeneration, generationBeforePage);
    assert.equal(validationCalls, 2);

    const oldAuthority = editAuthority;
    const replacement = dispatch({
        type: 'replaceEditInstance',
        authority: oldAuthority,
    });
    assert.equal(replacement.disposition, 'editInstanceReplaced');
    editAuthority = {};
    assert.equal(replacement.frame.values, edited.values);
    assert.equal(replacement.frame.dirtyFieldIds, edited.dirtyFieldIds);
    assert.equal(replacement.frame.errors, edited.errors);
    assert.equal(
        replacement.frame.loadedPolicyBaseline,
        edited.loadedPolicyBaseline
    );
    assert.notEqual(
        replacement.frame.renderLease.ownerGeneration,
        edited.renderLease.ownerGeneration
    );
    const generationAfterReplacement = nextGeneration;
    const stale = edit(oldAuthority, 'notes', 'Late old edit');
    assert.equal(stale.disposition, 'stale');
    assert.equal(stale.frame, replacement.frame);
    assert.equal(current, replacement.frame);
    assert.equal(nextGeneration, generationAfterReplacement);
    assert.equal(validationCalls, 2);
    assert.equal(
        edit(editAuthority, 'notes', 'Fresh child edit').disposition,
        'edited'
    );
    assert.equal(current.values.notes, 'Fresh child edit');
    assert.equal(current.values.title, 'Draft title');
    assert.deepEqual(current.dirtyFieldIds, ['notes', 'title']);
    assert.equal(validationCalls, 3);

    const beforeValidation = current;
    const beforeAllocation = nextGeneration;
    retireDuringValidation = true;
    const retired = edit(editAuthority, 'notes', 'Retired during validation');
    assert.equal(retired.disposition, 'stale');
    assert.equal(retired.frame, beforeValidation);
    assert.equal(current, beforeValidation);
    assert.equal(nextGeneration, beforeAllocation);
    assert.equal(validationCalls, 4);
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
        checkCanonicalChildPortalOwnership(api);
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
