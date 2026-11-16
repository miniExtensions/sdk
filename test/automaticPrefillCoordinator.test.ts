import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createAutomaticPrefillCoordinator,
    type AutomaticPrefillFrame,
    type AutomaticPrefillHost,
    type AutomaticPrefillRequest,
    type AutomaticPrefillRequestReceipt,
} from '../src/forms/automaticPrefillCoordinator.js';

function fixture() {
    const scope = { owner: {}, configuration: {} };
    let frame: AutomaticPrefillFrame = {
        scope,
        read: {},
        facts: {
            enabled: true,
            captchaEnabled: false,
            suppressed: false,
            preview: false,
            hasNonemptyURLPrefill: true,
            acceptedURLFieldIds: ['a'],
            projectedValues: { a: 0 },
        },
        saveState: { type: 'idle' },
    };
    const listeners = new Set<() => void>();
    const requests: AutomaticPrefillRequest[] = [];
    let run: AutomaticPrefillHost['requestFinalSave'] = () => ({
        status: 'accepted',
    });
    let reads = 0;
    const host: AutomaticPrefillHost = {
        read: () => {
            reads++;
            return frame;
        },
        isCurrent: (candidate) => candidate === frame,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        requestFinalSave: (request) => {
            requests.push(request);
            return run(request);
        },
    };
    const model = createAutomaticPrefillCoordinator(host, scope);
    return {
        model,
        scope,
        host,
        requests,
        listeners,
        reads: () => reads,
        frame: () => frame,
        update(change: Partial<AutomaticPrefillFrame>, notify = true) {
            frame = { ...frame, ...change };
            if (notify) for (const listener of [...listeners]) listener();
        },
        run(next: AutomaticPrefillHost['requestFinalSave']) {
            run = next;
        },
    };
}

describe('clientless automatic one-shot and canonical allocation receipts', () => {
    it('is inert before a committed connection', () => {
        const f = fixture();
        assert.equal(f.reads(), 0);
        assert.equal(f.requests.length, 0);
        assert.equal(f.model.getSnapshot().phase, 'idle');
    });
    it('retains only the two opaque scope stamps, not extra host metadata', () => {
        const f = fixture();
        const model = createAutomaticPrefillCoordinator(f.host, {
            ...f.scope,
            extraHostMetadata: 'must stay native',
        } as typeof f.scope);
        model.connect(() => {});
        assert.deepEqual(Object.keys(f.requests[0].intent.scope), [
            'owner',
            'configuration',
        ]);
        assert.equal(f.requests[0].intent.scope.owner, f.scope.owner);
    });
    it('creates one final-Save intent across refresh and StrictMode-style reconnect', () => {
        const f = fixture();
        const a = f.model.connect(() => {});
        a.refresh();
        a.disconnect();
        const b = f.model.connect(() => {});
        b.refresh();
        assert.equal(f.requests.length, 1);
        assert.equal(f.requests[0].intent.action, 'save');
        assert.equal(f.requests[0].intent.reason, 'automatic-prefill');
        b.disconnect();
        assert.equal(f.listeners.size, 0);
    });
    it('consumes intent before synchronous subscriber reentry', () => {
        const f = fixture();
        let reentered = false;
        f.model.connect(() => {
            if (reentered) return;
            reentered = true;
            f.model.connect(() => {});
        });
        assert.equal(reentered, true);
        assert.equal(f.requests.length, 1);
    });
    it('cleans a subscription returned after synchronous retirement during subscribe', () => {
        const f = fixture();
        let stops = 0;
        f.host.subscribe = (changed) => {
            f.update({ scope: { owner: {}, configuration: {} } }, false);
            changed();
            return () => {
                stops++;
            };
        };
        f.model.connect(() => {});
        assert.equal(f.model.getSnapshot().phase, 'retired');
        assert.equal(stops, 1);
        assert.equal(f.requests.length, 0);
    });
    it('rechecks the original owner after publication without adopting its replacement', () => {
        const f = fixture();
        f.model.connect(() => {
            if (f.model.getSnapshot().phase === 'submitting')
                f.update({ scope: { owner: {}, configuration: {} } }, false);
        });
        assert.equal(f.requests.length, 0);
        assert.equal(f.model.getSnapshot().phase, 'retired');
        assert.equal(f.model.getSnapshot().requested, false);
        f.update({ scope: f.scope });
        assert.equal(
            f.requests.length,
            0,
            'ABA cannot revive the retired model'
        );
    });
    it('checks changed final projection after publication before requesting Save', () => {
        const f = fixture();
        f.model.connect(() => {
            if (f.model.getSnapshot().phase === 'submitting')
                f.update(
                    { facts: { ...f.frame().facts, projectedValues: {} } },
                    false
                );
        });
        assert.equal(f.requests.length, 0);
        assert.equal(f.model.getSnapshot().error, 'no-prefills');
    });
    for (const type of ['pending', 'complete', 'error'] as const) {
        it(`does not start or retry an initially ${type} mount when it later becomes idle`, () => {
            const f = fixture();
            f.update({ saveState: { type } }, false);
            f.model.connect(() => {});
            f.update({ saveState: { type: 'idle' } });
            assert.equal(f.requests.length, 0);
        });
    }
    it('lets a separate genuine idle remount make its own explicit attempt', () => {
        const f = fixture();
        f.model.connect(() => {}).disconnect();
        const next = createAutomaticPrefillCoordinator(f.host, f.scope);
        next.connect(() => {});
        assert.equal(
            f.requests.length,
            2,
            'native still owns any transport coalescing'
        );
    });
    it('rereads current values after native waits without freezing pre-Compute record identity', () => {
        const f = fixture();
        f.model.connect(() => {});
        const latest = {};
        f.update({
            read: latest,
            facts: { ...f.frame().facts, projectedValues: { a: false } },
        });
        const admission = f.requests[0].admitAllocation();
        assert.equal(admission.status, 'admitted');
        if (admission.status === 'admitted')
            assert.equal(admission.read, latest);
        assert.equal(f.requests.length, 1);
        assert.equal(
            f.requests[0].admitAllocation().status,
            'refused',
            'one permit for one intent'
        );
    });
    it('refuses allocation after accepted provenance disappears during the native wait', () => {
        const f = fixture();
        f.model.connect(() => {});
        f.update({ facts: { ...f.frame().facts, acceptedURLFieldIds: [] } });
        assert.equal(f.requests[0].admitAllocation().status, 'refused');
        assert.equal(f.model.getSnapshot().allocated, false);
    });
    it('refuses a disconnected view before allocation, without issuing a replacement intent on reconnect', () => {
        const f = fixture();
        const view = f.model.connect(() => {});
        view.disconnect();
        assert.equal(f.requests[0].admitAllocation().status, 'refused');
        f.model.connect(() => {});
        assert.equal(f.requests.length, 1);
        assert.equal(f.requests[0].admitAllocation().status, 'admitted');
    });
    it('does not join a coalesced primary or infer saved from later untagged complete state', () => {
        const f = fixture();
        f.run(() => ({ status: 'coalesced' }));
        f.model.connect(() => {});
        f.update({ saveState: { type: 'complete' } });
        assert.equal(f.model.getSnapshot().phase, 'observing');
        assert.equal(f.model.getSnapshot().outcome, null);
        f.update({ saveState: { type: 'idle' } });
        assert.equal(f.requests.length, 1);
    });
    it('accepts only tagged allocated success, even with synchronous native callbacks', () => {
        const f = fixture();
        f.run((request) => {
            const admission = request.admitAllocation();
            assert.equal(admission.status, 'admitted');
            if (admission.status === 'admitted') {
                request.didAllocate(admission.allocation);
                request.didSettle({
                    status: 'saved',
                    allocation: admission.allocation,
                });
            }
            return { status: 'accepted' };
        });
        f.model.connect(() => {});
        assert.equal(f.model.getSnapshot().phase, 'saved');
        assert.equal(f.model.getSnapshot().allocated, true);
    });
    it('allows already-allocated native effects to settle after terminal presentation retirement', () => {
        const f = fixture();
        const connection = f.model.connect(() => {});
        const request = f.requests[0];
        const admission = request.admitAllocation();
        assert.equal(admission.status, 'admitted');
        if (admission.status !== 'admitted') return;
        request.didAllocate(admission.allocation);
        connection.disconnect();
        f.model.retire();
        let nativeSettlements = 0;
        nativeSettlements++;
        request.didSettle({
            status: 'saved',
            allocation: admission.allocation,
        });
        assert.equal(nativeSettlements, 1);
        assert.equal(f.model.getSnapshot().phase, 'retired');
        assert.equal(f.model.getSnapshot().outcome, 'saved');
        assert.equal(request.admitAllocation().status, 'refused');
    });
    it('does not accept a saved receipt without actual native allocation', () => {
        const f = fixture();
        f.model.connect(() => {});
        const request = f.requests[0];
        const admission = request.admitAllocation();
        assert.equal(admission.status, 'admitted');
        if (admission.status !== 'admitted') return;
        request.didSettle({
            status: 'saved',
            allocation: admission.allocation,
        });
        assert.equal(f.model.getSnapshot().outcome, 'unknown');
        assert.equal(f.model.getSnapshot().allocated, false);
    });
    for (const result of [undefined, Promise.resolve({ status: 'accepted' })]) {
        it(`refuses ${result === undefined ? 'void' : 'Promise'} as synchronous admission`, () => {
            const f = fixture();
            f.run(() => result as unknown as AutomaticPrefillRequestReceipt);
            f.model.connect(() => {});
            assert.equal(f.model.getSnapshot().outcome, 'unknown');
            assert.equal(f.requests.length, 1);
        });
    }
    it('does not automatically retry explicit refusal or failure', () => {
        const f = fixture();
        f.run(() => ({
            status: 'refused',
            message: 'Native validation refused.',
        }));
        const view = f.model.connect(() => {});
        assert.equal(f.model.getSnapshot().error, 'host-refused');
        assert.equal(
            f.model.getSnapshot().message,
            'Native validation refused.'
        );
        view.refresh();
        assert.equal(f.requests.length, 1);
    });
});
