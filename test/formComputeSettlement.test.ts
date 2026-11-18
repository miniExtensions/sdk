import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    transitionCanonicalFormCompute,
    type CanonicalFormComputeFrame,
    type CanonicalFormComputeOutcome,
    type CanonicalFormComputePorts,
    type CanonicalFormComputeRequest,
} from '../src/forms/index.js';

test('retains ABA and clear edits when an allocated Compute adopts a record', () => {
    const owner = {
        cohort: 'public-direct-root-compute',
        installation: 'first installation',
    } as const;
    const allocation = Symbol('allocated request');
    const current: CanonicalFormComputeFrame = {
        owner,
        record: { type: 'create' },
        values: { text: 'A', cleared: null, append: 'Add this' },
        dirtyFieldIds: ['text', 'cleared', 'append'],
        errors: { text: 'Current error' },
        loadedPolicyBaseline: { text: 'Loaded' },
        isFormReadOnly: false,
        provenance: {
            instanceGeneration: 1,
            fieldGenerations: { text: 6, cleared: 5, append: 4 },
            complete: true,
        },
        renderLease: { ownerGeneration: 1 },
    };
    const request = {
        allocation,
        requestId: 'compute-a',
        owner,
        record: current.record,
        provenance: {
            instanceGeneration: 1,
            fieldGenerations: { text: 2, cleared: 3, append: 4 },
            complete: true,
        },
        submittedValues: {
            text: 'A',
            cleared: 'Before clear',
            append: 'Add this',
        },
        validationValues: {
            text: 'A',
            cleared: 'Before clear',
            append: 'Add this',
        },
        addOnlyTextFieldIds: ['append'],
    };
    const response = {
        type: 'returned',
        record: { type: 'edit', recordId: 'rec_created', tableId: 'tbl_form' },
        values: {
            text: 'Server text',
            cleared: 'Before clear',
            append: 'History',
        },
    } as const;
    const result = transitionCanonicalFormCompute(current, request, response, {
        isCurrent: (_frame, captured) => captured.allocation === allocation,
        areValuesEquivalent: (currentValue, submittedValue) =>
            currentValue === submittedValue,
        allocateInstanceGeneration: () => 7,
        retainRenderLease: () => true,
    });
    assert.equal(result.disposition, 'computeSettled');
    assert.deepEqual(result.frame.record, response.record);
    assert.deepEqual(result.frame.values, {
        text: 'A',
        cleared: null,
        append: '',
    });
    assert.deepEqual(result.frame.dirtyFieldIds, ['text', 'cleared']);
    assert.equal(
        result.frame.loadedPolicyBaseline,
        current.loadedPolicyBaseline
    );
    assert.equal(result.frame.errors, current.errors);
    assert.equal(result.frame.renderLease, current.renderLease);
    assert.deepEqual(result.frame.provenance, {
        instanceGeneration: 7,
        fieldGenerations: {},
        complete: true,
    });
    assert.deepEqual(current.dirtyFieldIds, ['text', 'cleared', 'append']);
});

function manualReadonlyFixture() {
    const frame = {
        owner: { cohort: 'public-direct-root-compute', installation: 'form A' },
        record: { type: 'edit', recordId: 'rec_a', tableId: 'tbl_form' },
        values: { url: 'https://example.invalid/prefilled', other: 'Keep' },
        dirtyFieldIds: ['url'],
        errors: { other: 'Previous error' },
        loadedPolicyBaseline: { other: 'Loaded' },
        isFormReadOnly: true,
        provenance: {
            instanceGeneration: 9,
            fieldGenerations: {},
            complete: true,
        },
        renderLease: { ownerGeneration: 9 },
        manualReadonlyCompute: {
            requestId: 'compute-a',
            phase: 'pending',
            candidateFieldIds: ['url'],
            settledFieldIds: [],
        },
    } as const satisfies CanonicalFormComputeFrame;
    const allocation = Symbol('host allocated Compute');
    const request = {
        allocation,
        requestId: 'compute-a',
        owner: frame.owner,
        record: frame.record,
        provenance: frame.provenance,
        submittedValues: {},
        validationValues: { url: frame.values.url },
        addOnlyTextFieldIds: [],
        readonlyEchoValues: { url: frame.values.url },
    } satisfies CanonicalFormComputeRequest<symbol>;
    const returned = {
        type: 'returned',
        record: frame.record,
        values: { url: frame.values.url, other: 'Server' },
    } as const satisfies CanonicalFormComputeOutcome<Error>;
    const ports = {
        isCurrent: (_frame, event) => event.allocation === allocation,
        allocateInstanceGeneration: () => 10,
        retainRenderLease: () => true,
        admitsReadonlyReceipt: () => true,
        areReadonlyValuesEqual: Object.is,
        areValuesEquivalent: (left, right) => left === right,
    } satisfies CanonicalFormComputePorts<symbol>;
    return { frame, request, returned, ports };
}

test('refuses late success and failure after a same-record instance is replaced', () => {
    const { frame, request, returned, ports } = manualReadonlyFixture();
    const replacement = {
        ...frame,
        provenance: { ...frame.provenance, instanceGeneration: 20 },
        values: { ...frame.values, other: 'Successor edit' },
    };
    const failure = {
        type: 'failed',
        failure: new Error('Late failure'),
    } as const;
    for (const outcome of [returned, failure]) {
        const result = transitionCanonicalFormCompute(
            replacement,
            request,
            outcome,
            ports
        );
        assert.deepEqual(result, { disposition: 'stale', frame: replacement });
        assert.equal(result.frame, replacement);
    }
});

test('settles only the matching manual readonly receipt with returned echoes', () => {
    const { frame, request, returned, ports } = manualReadonlyFixture();
    const accepted = transitionCanonicalFormCompute(
        frame,
        request,
        returned,
        ports
    );
    assert.equal(accepted.disposition, 'computeSettled');
    assert.deepEqual(accepted.frame.manualReadonlyCompute, {
        ...frame.manualReadonlyCompute,
        phase: 'settled',
        settledFieldIds: ['url'],
    });
    assert.deepEqual(accepted.frame.dirtyFieldIds, ['url']);
    assert.equal(accepted.frame.values.url, frame.values.url);

    const absentEcho = transitionCanonicalFormCompute(
        frame,
        request,
        { ...returned, values: { other: 'Server' } },
        ports
    );
    assert.equal(absentEcho.disposition, 'computeSettled');
    assert.equal(absentEcho.frame.manualReadonlyCompute, undefined);
    const cosmeticEcho = transitionCanonicalFormCompute(
        frame,
        request,
        {
            ...returned,
            values: { ...returned.values, url: `${frame.values.url} ` },
        },
        { ...ports, areValuesEquivalent: () => true }
    );
    assert.equal(cosmeticEcho.disposition, 'computeSettled');
    assert.equal(cosmeticEcho.frame.manualReadonlyCompute, undefined);

    const otherReceipt = {
        ...frame.manualReadonlyCompute,
        requestId: 'compute-b',
    };
    const other = { ...frame, manualReadonlyCompute: otherReceipt };
    const differentRequest = transitionCanonicalFormCompute(
        other,
        request,
        returned,
        ports
    );
    assert.equal(differentRequest.frame.manualReadonlyCompute, otherReceipt);

    const presentationRetired = transitionCanonicalFormCompute(
        { ...frame, renderLease: null },
        request,
        returned,
        ports
    );
    assert.equal(presentationRetired.disposition, 'computeSettled');
    assert.equal(presentationRetired.frame.manualReadonlyCompute, undefined);
    assert.equal(presentationRetired.frame.values.other, 'Server');
});

test('releases only the matching readonly origin and preserves it only while intact', () => {
    const { frame, request, returned, ports } = manualReadonlyFixture();
    const origin = {
        ownerGeneration: frame.renderLease.ownerGeneration,
        fieldIds: ['url'],
        values: { url: frame.values.url },
        activeRequestId: request.requestId,
        activeOriginBinding: 'configuration-a',
    };
    const withOrigin = { ...frame, manualReadonlyOrigin: origin };
    const bound = { ...ports, retainsReadonlyOrigin: () => true };
    const result = transitionCanonicalFormCompute(
        withOrigin,
        request,
        returned,
        bound
    );
    const inactive = {
        ownerGeneration: origin.ownerGeneration,
        fieldIds: origin.fieldIds,
        values: origin.values,
    };
    assert.deepEqual(result.frame.manualReadonlyOrigin, inactive);

    const reopened = transitionCanonicalFormCompute(
        withOrigin,
        request,
        returned,
        { ...bound, retainRenderLease: () => false }
    );
    assert.deepEqual(reopened.frame.manualReadonlyOrigin, {
        ...inactive,
        ownerGeneration: 10,
    });
    assert.equal(reopened.frame.manualReadonlyCompute, undefined);

    const changed = {
        ...withOrigin,
        values: { ...frame.values, url: 'Different' },
    };
    const discarded = transitionCanonicalFormCompute(
        changed,
        request,
        returned,
        bound
    );
    assert.equal(discarded.frame.manualReadonlyOrigin, undefined);

    const failure = {
        type: 'failed',
        failure: new Error('Host failed'),
    } as const;
    const failed = transitionCanonicalFormCompute(
        withOrigin,
        request,
        failure,
        bound
    );
    assert.deepEqual(failed.frame.manualReadonlyOrigin, inactive);

    const unrelated = { ...origin, activeRequestId: 'another-request' };
    const protectedFrame = { ...frame, manualReadonlyOrigin: unrelated };
    assert.equal(
        transitionCanonicalFormCompute(protectedFrame, request, failure, bound)
            .frame.manualReadonlyOrigin,
        unrelated
    );
});

test('preserves current validation failures and ignores errors for replaced values', () => {
    const { frame, request, ports } = manualReadonlyFixture();
    const failure = new Error('Validation failed');
    const outcome = {
        type: 'validationFailed',
        failure,
        errors: { url: 'Invalid URL' },
    } as const;
    const accepted = transitionCanonicalFormCompute(
        frame,
        request,
        outcome,
        ports
    );
    assert.equal(accepted.disposition, 'computeFailed');
    assert.equal(accepted.failure, failure);
    assert.deepEqual(accepted.frame.errors, outcome.errors);
    assert.equal(accepted.frame.manualReadonlyCompute, undefined);
    assert.equal(accepted.frame.values, frame.values);
    assert.equal(accepted.frame.provenance, frame.provenance);

    const edited = { ...frame, values: { ...frame.values, url: null } };
    const superseded = transitionCanonicalFormCompute(
        edited,
        request,
        outcome,
        ports
    );
    assert.equal(superseded.disposition, 'computeValidationSuperseded');
    assert.equal(superseded.frame.errors, frame.errors);
    assert.equal(superseded.frame.values.url, null);
    assert.equal(superseded.frame.manualReadonlyCompute, undefined);
});

test('rechecks the original host frame before publishing reconciliation', () => {
    const { frame, request, returned, ports } = manualReadonlyFixture();
    let isCurrent = true;
    const result = transitionCanonicalFormCompute(frame, request, returned, {
        ...ports,
        isCurrent: () => isCurrent,
        admitsReadonlyReceipt: () => {
            isCurrent = false;
            return true;
        },
    });
    assert.equal(result.disposition, 'stale');
    assert.equal(result.frame, frame);
    assert.equal(result.frame.manualReadonlyCompute.phase, 'pending');
});
