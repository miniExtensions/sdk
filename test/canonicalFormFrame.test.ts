import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createCanonicalFormFrame,
    transitionCanonicalFormFrame,
    type CanonicalFormEvent,
    type CanonicalFormFrame,
    type CanonicalFormTransitionPorts,
} from '../src/forms/canonicalFrame.js';

type Authority = { current: boolean };
type Allocation = { requestId: string };

function frame(extra: Partial<CanonicalFormFrame> = {}): CanonicalFormFrame {
    return createCanonicalFormFrame({
        owner: {
            cohort: 'public-direct-root-non-compute',
            installation: 'accepted-installation-a',
        },
        record: { type: 'edit', recordId: 'rec_a', tableId: 'tbl_a' },
        values: { text: 'A', links: ['rec_link'] },
        dirtyFieldIds: [],
        errors: { text: 'Retained error' },
        loadedPolicyBaseline: { text: 'Loaded' },
        isFormReadOnly: false,
        provenance: {
            instanceGeneration: 9,
            fieldGenerations: { text: 10 },
            complete: true,
        },
        renderLease: { ownerGeneration: 9 },
        ...extra,
    });
}

function host(authority: Authority) {
    const calls = { equality: 0, validation: 0, generations: 0, url: 0 };
    let generation = 10;
    const ports: CanonicalFormTransitionPorts<Authority, Allocation> = {
        admit: (_frame, event) =>
            event.authority === authority && authority.current,
        areValuesEquivalent: (_id, before, after) => {
            calls.equality++;
            return JSON.stringify(before) === JSON.stringify(after);
        },
        isReadonlyUrlPrefill: (_frame, id) => {
            calls.url++;
            return id === 'text';
        },
        allocateGeneration: () => {
            calls.generations++;
            return ++generation;
        },
        validateEdit: (_before, next) => {
            calls.validation++;
            return next.errors;
        },
        retainRenderLease: () => false,
    };
    return { ports, calls };
}

type GenerationOperation = 'instance' | 'field' | 'policy';

function generationEvent(
    operation: GenerationOperation,
    authority: Authority
): CanonicalFormEvent<Authority, Allocation> {
    switch (operation) {
        case 'instance':
            return { type: 'replaceEditInstance', authority };
        case 'field':
            return {
                type: 'edit',
                authority,
                fieldId: 'text',
                value: 'Changed',
                dirty: 'append',
            };
        case 'policy':
            return { type: 'setReadOnly', authority, readOnly: true };
    }
}

describe('canonical Form host boundary', () => {
    it('detaches an immutable frame without freezing caller-owned input', () => {
        const values = { links: ['rec_a', 'rec_b'] };
        const dirtyFieldIds = ['links'];
        const input = { ...frame(), values, dirtyFieldIds };
        const snapshot = createCanonicalFormFrame(input);
        values.links.push('rec_c');
        dirtyFieldIds.push('text');
        assert.deepEqual(snapshot.values, { links: ['rec_a', 'rec_b'] });
        assert.deepEqual(snapshot.dirtyFieldIds, ['links']);
        assert.equal(Object.isFrozen(values), false);
        assert.equal(Object.isFrozen(values.links), false);
        assert.equal(Object.isFrozen(snapshot), true);
        const links = snapshot.values.links;
        assert.ok(Array.isArray(links));
        assert.equal(Object.isFrozen(links), true);
        assert.equal(Reflect.set(links, '0', 'bad'), false);
        assert.deepEqual(snapshot.values.links, ['rec_a', 'rec_b']);
    });

    it('rejects stale authority before retirement or callbacks, then accepts the fresh control', () => {
        const authority = { current: false };
        const f = frame({
            manualReadonlyCompute: {
                requestId: 'request_a',
                phase: 'settled',
                candidateFieldIds: ['text'],
                settledFieldIds: ['text'],
            },
        });
        const h = host(authority);
        const event = {
            type: 'edit',
            authority,
            fieldId: 'text',
            value: 'Changed',
            dirty: 'append',
        } as const;
        const stale = transitionCanonicalFormFrame(f, event, h.ports);
        assert.equal(stale.disposition, 'stale');
        assert.equal(stale.frame, f);
        assert.deepEqual(h.calls, {
            equality: 0,
            validation: 0,
            generations: 0,
            url: 0,
        });
        authority.current = true;
        const current = transitionCanonicalFormFrame(f, event, h.ports);
        assert.equal(current.disposition, 'edited');
        assert.equal(current.frame?.values.text, 'Changed');
        assert.deepEqual(current.frame?.dirtyFieldIds, ['text']);
        assert.equal(current.frame?.manualReadonlyCompute, undefined);
        assert.equal(h.calls.validation, 1);
        assert.equal(h.calls.generations, 1);
    });

    it('retires an equal accepted intent while preserving canonical no-op references', () => {
        const authority = { current: true };
        const f = frame({
            manualReadonlyOrigin: {
                ownerGeneration: 9,
                fieldIds: ['text'],
                values: { text: 'A' },
            },
            manualReadonlyRetiredUrlFieldIds: ['other'],
        });
        const h = host(authority);
        const result = transitionCanonicalFormFrame(
            f,
            {
                type: 'edit',
                authority,
                fieldId: 'text',
                value: 'A',
                dirty: 'append',
            },
            h.ports
        );
        assert.equal(result.disposition, 'unchanged');
        assert.notEqual(result.frame, f);
        assert.equal(result.frame?.values, f.values);
        assert.equal(result.frame?.errors, f.errors);
        assert.equal(result.frame?.dirtyFieldIds, f.dirtyFieldIds);
        assert.equal(result.frame?.provenance, f.provenance);
        assert.equal(result.frame?.manualReadonlyOrigin, undefined);
        assert.deepEqual(result.frame?.manualReadonlyRetiredUrlFieldIds, [
            'other',
            'text',
        ]);
        assert.equal(h.calls.validation, 0);
        assert.equal(h.calls.generations, 0);
    });

    it('does not publish a successor after a host callback retires authority', () => {
        const authority = { current: true };
        const f = frame();
        const h = host(authority);
        const result = transitionCanonicalFormFrame(
            f,
            {
                type: 'edit',
                authority,
                fieldId: 'text',
                value: 'Changed',
                dirty: 'append',
            },
            {
                ...h.ports,
                validateEdit: (before, next, id, value) => {
                    assert.equal(before, f);
                    assert.equal(id, 'text');
                    assert.equal(value, 'Changed');
                    assert.equal(next.values.text, 'Changed');
                    assert.equal(
                        next.loadedPolicyBaseline,
                        f.loadedPolicyBaseline
                    );
                    authority.current = false;
                    return {};
                },
            }
        );
        assert.equal(result.disposition, 'stale');
        assert.equal(result.frame, f);
        assert.equal(f.values.text, 'A');
        assert.equal(f.errors.text, 'Retained error');
    });

    it('propagates the real host failure without mutating the input frame', () => {
        const authority = { current: true };
        const f = frame();
        const h = host(authority);
        const failure = new Error('Host validation failed');
        assert.throws(
            () =>
                transitionCanonicalFormFrame(
                    f,
                    {
                        type: 'edit',
                        authority,
                        fieldId: 'text',
                        value: 'Changed',
                        dirty: 'preserve',
                    },
                    {
                        ...h.ports,
                        validateEdit: () => {
                            throw failure;
                        },
                    }
                ),
            (actual) => actual === failure
        );
        assert.equal(f.values.text, 'A');
        assert.deepEqual(f.dirtyFieldIds, []);
        assert.equal(f.provenance?.fieldGenerations?.text, 10);
    });

    it('publishes validation failure only for the actual allocated request', () => {
        const authority = { current: true };
        const allocation = { requestId: 'allocated-request' };
        const f = frame({ dirtyFieldIds: ['links', 'text'] });
        const h = host(authority);
        const errors = { text: 'Native validation failure' };
        const failure = { kind: 'validation', message: 'Native failure' };
        const event = {
            type: 'saveFailed',
            authority,
            allocation,
            failure,
            errors,
        } as const;
        const ports: CanonicalFormTransitionPorts<Authority, Allocation> = {
            ...h.ports,
            admit: (captured, candidate) =>
                captured === f &&
                candidate.authority === authority &&
                authority.current &&
                (candidate.type !== 'saveFailed' ||
                    candidate.allocation === allocation),
        };
        const stale = transitionCanonicalFormFrame(
            f,
            { ...event, allocation: { ...allocation } },
            ports
        );
        assert.equal(stale.disposition, 'stale');
        assert.equal(stale.frame, f);
        assert.equal(Object.hasOwn(stale, 'failure'), false);
        assert.equal(f.errors.text, 'Retained error');
        const accepted = transitionCanonicalFormFrame(f, event, ports);
        assert.ok(accepted.disposition === 'saveFailed');
        assert.equal(accepted.failure, failure);
        assert.deepEqual(accepted.frame.errors, errors);
        assert.notEqual(accepted.frame.errors, errors);
        assert.equal(Object.isFrozen(accepted.frame.errors), true);
        errors.text = 'Caller changed';
        assert.equal(accepted.frame.errors.text, 'Native validation failure');
        assert.equal(accepted.frame.values, f.values);
        assert.equal(accepted.frame.dirtyFieldIds, f.dirtyFieldIds);
        assert.equal(
            accepted.frame.loadedPolicyBaseline,
            f.loadedPolicyBaseline
        );
        assert.equal(accepted.frame.provenance, f.provenance);
        assert.equal(accepted.frame.renderLease, f.renderLease);
        assert.deepEqual(h.calls, {
            equality: 0,
            validation: 0,
            generations: 0,
            url: 0,
        });
    });

    it('returns an accepted generic Save failure without changing field state', () => {
        const authority = { current: true };
        const allocation = { requestId: 'generic-failure-request' };
        const failure = new Error('Native transport failure');
        const f = frame();
        const h = host(authority);
        const result = transitionCanonicalFormFrame(
            f,
            { type: 'saveFailed', authority, allocation, failure },
            {
                ...h.ports,
                admit: (captured, event) =>
                    captured === f &&
                    event.authority === authority &&
                    event.type === 'saveFailed' &&
                    event.allocation === allocation,
            }
        );
        assert.ok(result.disposition === 'saveFailed');
        assert.equal(result.failure, failure);
        assert.equal(result.frame, f);
        assert.equal(h.calls.generations, 0);
        assert.equal(h.calls.validation, 0);
    });

    it('withholds failure and field errors when final admission retires the request', () => {
        const authority = { current: true };
        const allocation = { requestId: 'retired-during-failure' };
        const failure = new Error('Must not reach successor UI');
        const f = frame();
        const h = host(authority);
        let admissions = 0;
        let failureReads = 0;
        const event = {
            type: 'saveFailed',
            authority,
            allocation,
            errors: { text: 'Must not reach successor errors' },
            get failure() {
                failureReads++;
                return failure;
            },
        } as const;
        const result = transitionCanonicalFormFrame(f, event, {
            ...h.ports,
            admit: (_captured, candidate) => {
                admissions++;
                return (
                    candidate.authority === authority &&
                    candidate.type === 'saveFailed' &&
                    candidate.allocation === allocation &&
                    admissions === 1
                );
            },
        });
        assert.equal(admissions, 2);
        assert.equal(result.disposition, 'stale');
        assert.equal(result.frame, f);
        assert.equal(Object.hasOwn(result, 'failure'), false);
        assert.equal(failureReads, 0);
        assert.equal(f.errors.text, 'Retained error');
        const control = transitionCanonicalFormFrame(f, event, {
            ...h.ports,
            admit: (_captured, candidate) =>
                candidate.authority === authority &&
                candidate.type === 'saveFailed' &&
                candidate.allocation === allocation,
        });
        assert.ok(control.disposition === 'saveFailed');
        assert.equal(control.failure, failure);
        assert.equal(failureReads, 1);
        assert.equal(
            control.frame.errors.text,
            'Must not reach successor errors'
        );
        assert.equal(h.calls.generations, 0);
        assert.equal(h.calls.validation, 0);
    });

    for (const operation of ['instance', 'field', 'policy'] as const) {
        it(`preserves native ${operation} exhaustion and its separate render-lease disposition`, () => {
            const authority = { current: true };
            const f = frame({
                dirtyFieldIds: ['links'],
                manualReadonlyRetiredUrlFieldIds: ['other'],
            });
            const h = host(authority);
            const allocated: GenerationOperation[] = [];
            const result = transitionCanonicalFormFrame(
                f,
                generationEvent(operation, authority),
                {
                    ...h.ports,
                    allocateGeneration: (use) => {
                        allocated.push(use);
                        return null;
                    },
                }
            );
            assert.deepEqual(allocated, [operation]);
            assert.ok(result.frame);
            assert.equal(result.frame.provenance, null);
            assert.equal(
                result.frame.renderLease,
                operation === 'field' ? f.renderLease : null
            );
            assert.equal(result.frame.owner, f.owner);
            assert.equal(result.frame.record, f.record);
            assert.equal(
                result.frame.loadedPolicyBaseline,
                f.loadedPolicyBaseline
            );
            if (operation === 'field') {
                assert.equal(result.disposition, 'edited');
                assert.equal(result.frame.values.text, 'Changed');
                assert.deepEqual(result.frame.dirtyFieldIds, ['links', 'text']);
                assert.equal(h.calls.validation, 1);
            } else {
                assert.equal(result.frame.values, f.values);
                assert.equal(result.frame.dirtyFieldIds, f.dirtyFieldIds);
                assert.equal(result.frame.errors, f.errors);
                assert.equal(
                    result.frame.manualReadonlyRetiredUrlFieldIds,
                    f.manualReadonlyRetiredUrlFieldIds
                );
                assert.equal(h.calls.validation, 0);
                assert.equal(
                    result.disposition,
                    operation === 'instance'
                        ? 'editInstanceReplaced'
                        : 'policyChanged'
                );
            }
            assert.equal(result.frame.isFormReadOnly, operation === 'policy');
            assert.equal(f.values.text, 'A');
            assert.equal(f.provenance?.instanceGeneration, 9);
            assert.deepEqual(f.dirtyFieldIds, ['links']);
        });

        for (const invalid of [
            { name: 'NaN', value: Number.NaN },
            { name: 'negative', value: -1 },
            { name: 'fractional', value: 1.5 },
            { name: 'unsafe', value: Number.MAX_SAFE_INTEGER + 1 },
        ]) {
            it(`refuses ${invalid.name} ${operation} allocation without publishing invalid authority`, () => {
                const authority = { current: true };
                const f = frame();
                const h = host(authority);
                const allocated: GenerationOperation[] = [];
                assert.throws(
                    () =>
                        transitionCanonicalFormFrame(
                            f,
                            generationEvent(operation, authority),
                            {
                                ...h.ports,
                                allocateGeneration: (use) => {
                                    allocated.push(use);
                                    return invalid.value;
                                },
                            }
                        ),
                    {
                        name: 'RangeError',
                        message:
                            'Canonical Form allocator returned an invalid generation',
                    }
                );
                assert.deepEqual(allocated, [operation]);
                assert.equal(h.calls.validation, 0);
                assert.equal(f.values.text, 'A');
                assert.equal(f.errors.text, 'Retained error');
                assert.deepEqual(f.dirtyFieldIds, []);
                assert.equal(f.provenance?.instanceGeneration, 9);
                assert.equal(f.provenance?.fieldGenerations?.text, 10);
                assert.equal(f.renderLease?.ownerGeneration, 9);
            });
        }
    }

    it('accepts a valid zero generation at the allocator boundary', () => {
        const authority = { current: true };
        const f = frame();
        const h = host(authority);
        const result = transitionCanonicalFormFrame(
            f,
            { type: 'replaceEditInstance', authority },
            { ...h.ports, allocateGeneration: () => 0 }
        );
        assert.equal(result.disposition, 'editInstanceReplaced');
        assert.equal(result.frame?.provenance?.instanceGeneration, 0);
        assert.equal(result.frame?.renderLease?.ownerGeneration, 0);
    });

    it('preserves exact frames for preservation and same-reference policy updates', () => {
        const authority = { current: true };
        const f = frame();
        const h = host(authority);
        const events: CanonicalFormEvent<Authority, Allocation>[] = [
            { type: 'preserve', authority },
            { type: 'replaceErrors', authority, errors: f.errors },
            {
                type: 'setLoadedBaseline',
                authority,
                values: f.loadedPolicyBaseline,
            },
            { type: 'setReadOnly', authority, readOnly: f.isFormReadOnly },
        ];
        let current = f;
        for (const event of events) {
            const result = transitionCanonicalFormFrame(
                current,
                event,
                h.ports
            );
            assert.equal(result.frame, current);
            assert.ok(result.frame);
            current = result.frame;
        }
        assert.equal(current, f);
        assert.deepEqual(h.calls, {
            equality: 0,
            validation: 0,
            generations: 0,
            url: 0,
        });
        const retired = transitionCanonicalFormFrame(
            current,
            { type: 'retire', authority },
            h.ports
        );
        assert.equal(retired.disposition, 'retired');
        assert.equal(retired.frame, null);
        assert.equal(current.values.text, 'A');
    });

    it('refuses a foreign cohort before host callbacks and retains a valid control', () => {
        const authority = { current: true };
        const f = frame();
        const foreign = { ...f, owner: { ...f.owner } };
        assert.equal(
            Reflect.set(foreign.owner, 'cohort', 'config-preview'),
            true
        );
        const h = host(authority);
        let admissions = 0;
        const ports: CanonicalFormTransitionPorts<Authority, Allocation> = {
            ...h.ports,
            admit: () => {
                admissions++;
                return true;
            },
        };
        const result = transitionCanonicalFormFrame(
            foreign,
            { type: 'preserve', authority },
            ports
        );
        assert.equal(result.disposition, 'unsupportedCohort');
        assert.equal(result.frame, foreign);
        assert.equal(admissions, 0);
        const control = transitionCanonicalFormFrame(
            f,
            { type: 'preserve', authority },
            ports
        );
        assert.equal(control.disposition, 'preserved');
        assert.equal(control.frame, f);
        assert.equal(admissions, 2);
    });

    it('reports an unavailable frame without allocating or projecting an edit', () => {
        const authority = { current: true };
        const h = host(authority);
        const result = transitionCanonicalFormFrame(
            null,
            generationEvent('field', authority),
            h.ports
        );
        assert.equal(result.disposition, 'unavailable');
        assert.equal(result.frame, null);
        assert.deepEqual(h.calls, {
            equality: 0,
            validation: 0,
            generations: 0,
            url: 0,
        });
    });
});
