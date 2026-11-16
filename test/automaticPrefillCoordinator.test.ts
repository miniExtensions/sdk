import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createAutomaticPrefillCoordinator,
    type AutomaticPrefillFrame,
    type AutomaticPrefillHost,
    type AutomaticPrefillAllocation,
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
    for (const callback of ['read', 'final authority'] as const) {
        it(`issues at most one permit across reentrant ${callback}`, () => {
            const f = fixture();
            f.model.connect(() => {});
            const request = f.requests[0];
            const nested: string[] = [];
            if (callback === 'read') {
                const original = f.host.read;
                let entered = false;
                f.host.read = (scope) => {
                    if (!entered) {
                        entered = true;
                        nested.push(request.admitAllocation().status);
                    }
                    return original(scope);
                };
            } else {
                let checks = 0;
                f.host.isCurrent = () => {
                    if (++checks === 2)
                        nested.push(request.admitAllocation().status);
                    return true;
                };
            }
            const admission = request.admitAllocation();
            assert.equal(admission.status, 'admitted');
            assert.deepEqual(nested, ['refused']);
            assert.equal(request.admitAllocation().status, 'refused');
        });
    }
    for (const status of ['coalesced', 'refused'] as const) {
        it(`refuses allocation if its last authority callback reports ${status}`, () => {
            const f = fixture();
            f.model.connect(() => {});
            let checks = 0;
            f.host.isCurrent = () => {
                if (++checks === 2) f.requests[0].didSettle({ status });
                return true;
            };
            assert.equal(f.requests[0].admitAllocation().status, 'refused');
            assert.equal(f.model.getSnapshot().allocated, false);
        });
    }
    it('keeps consecutive admitted native error messages current while observing', () => {
        const f = fixture();
        f.model.connect(() => {});
        f.requests[0].didSettle({ status: 'coalesced' });
        f.update({ saveState: { type: 'error', message: 'First error' } });
        f.update({ saveState: { type: 'error', message: 'Second error' } });
        assert.equal(f.model.getSnapshot().message, 'Second error');
        assert.equal(f.requests.length, 1);
        assert.equal(f.model.getSnapshot().outcome, null);
    });
    it('clears an observed native error when the current operation becomes pending', () => {
        const f = fixture();
        f.model.connect(() => {});
        f.requests[0].didSettle({ status: 'coalesced' });
        f.update({ saveState: { type: 'error', message: 'Prior error' } });
        f.update({ saveState: { type: 'pending' } });
        assert.equal(f.model.getSnapshot().phase, 'observing');
        assert.equal(f.model.getSnapshot().message, undefined);
        assert.equal(f.model.getSnapshot().error, undefined);
        assert.equal(f.requests.length, 1);
    });
    it('does not overwrite retirement caused by the committed authority read', () => {
        const f = fixture();
        f.host.isCurrent = () => {
            f.model.retire();
            return true;
        };
        f.model.connect(() => {});
        assert.equal(f.model.getSnapshot().phase, 'retired');
        assert.equal(f.requests.length, 0);
    });
    it('does not consume an intent after the authority read disconnects the last view', () => {
        const f = fixture();
        f.update({ facts: { ...f.frame().facts, preview: true } }, false);
        const connection = f.model.connect(() => {});
        f.update({ facts: { ...f.frame().facts, preview: false } }, false);
        const original = f.host.read;
        f.host.read = (scope) => {
            connection.disconnect();
            f.host.read = original;
            return original(scope);
        };
        connection.refresh();
        assert.equal(f.requests.length, 0);
        f.model.connect(() => {});
        assert.equal(f.requests.length, 1);
    });
    it('observes a late explicit coalescing result without joining or claiming the primary Save', () => {
        const f = fixture();
        f.model.connect(() => {});
        f.requests[0].didSettle({ status: 'coalesced' });
        assert.equal(f.model.getSnapshot().phase, 'observing');
        assert.equal(f.model.getSnapshot().allocated, false);
        f.update({ saveState: { type: 'complete' } });
        assert.equal(f.model.getSnapshot().outcome, null);
        f.update({ saveState: { type: 'idle' } });
        assert.equal(f.requests.length, 1);
    });
    it('preserves a current native error while observing a coalesced primary', () => {
        const f = fixture();
        f.model.connect(() => {});
        f.requests[0].didSettle({ status: 'coalesced' });
        f.update({
            saveState: { type: 'error', message: 'Admitted native message.' },
        });
        assert.equal(f.model.getSnapshot().phase, 'error');
        assert.equal(f.model.getSnapshot().message, 'Admitted native message.');
        assert.equal(f.model.getSnapshot().outcome, null);
    });
    for (const close of ['disconnect', 'retire'] as const) {
        it(`rechecks activity when the last authority callback causes ${close}`, () => {
            const f = fixture();
            const connection = f.model.connect(() => {});
            let checks = 0;
            f.host.isCurrent = () => {
                if (++checks === 2) {
                    if (close === 'disconnect') connection.disconnect();
                    else f.model.retire();
                }
                return true;
            };
            assert.equal(f.requests[0].admitAllocation().status, 'refused');
        });
    }
    it('does not accept a Promise carrying an accepted-looking status as admission', () => {
        const f = fixture();
        f.run(
            () =>
                Object.assign(Promise.resolve(), {
                    status: 'accepted',
                }) as unknown as AutomaticPrefillRequestReceipt
        );
        f.model.connect(() => {});
        assert.equal(f.model.getSnapshot().outcome, 'unknown');
        assert.equal(f.requests[0].admitAllocation().status, 'refused');
    });
    for (const mode of ['throw', 'refused', 'coalesced'] as const) {
        it(`preserves actual allocation and later tagged settlement after host ${mode}`, () => {
            const f = fixture();
            let allocation!: AutomaticPrefillAllocation;
            f.run((request) => {
                const admission = request.admitAllocation();
                assert.equal(admission.status, 'admitted');
                if (admission.status !== 'admitted')
                    throw new Error('missing permit');
                allocation = admission.allocation;
                request.didAllocate(allocation);
                if (mode === 'throw')
                    throw new Error('host failed after actual allocation');
                return { status: mode };
            });
            f.model.connect(() => {});
            assert.equal(f.model.getSnapshot().allocated, true);
            assert.equal(f.model.getSnapshot().outcome, 'unknown');
            f.requests[0].didSettle({ status: 'saved', allocation });
            assert.equal(f.model.getSnapshot().outcome, 'saved');
        });
    }
    it('retains a synchronous confirmed outcome even when the host subsequently throws', () => {
        const f = fixture();
        f.run((request) => {
            const admission = request.admitAllocation();
            if (admission.status !== 'admitted')
                throw new Error('missing permit');
            request.didAllocate(admission.allocation);
            request.didSettle({
                status: 'saved',
                allocation: admission.allocation,
            });
            throw new Error('host failed after settled effect');
        });
        f.model.connect(() => {});
        assert.equal(f.model.getSnapshot().allocated, true);
        assert.equal(f.model.getSnapshot().outcome, 'saved');
    });
    it('keeps a confirmed Saved outcome stable under duplicate allocation notifications', () => {
        const f = fixture();
        f.model.connect(() => {});
        const request = f.requests[0],
            admission = request.admitAllocation();
        if (admission.status !== 'admitted') throw new Error('missing permit');
        request.didAllocate(admission.allocation);
        request.didSettle({
            status: 'saved',
            allocation: admission.allocation,
        });
        request.didAllocate(admission.allocation);
        assert.equal(f.model.getSnapshot().outcome, 'saved');
        assert.equal(f.model.getSnapshot().phase, 'saved');
    });
    for (const receipt of [
        { status: 'refused' },
        { status: 'coalesced' },
        undefined,
        Promise.resolve({ status: 'accepted' }),
    ]) {
        it(`refuses a late allocation gate after ${receipt === undefined ? 'void' : receipt instanceof Promise ? 'Promise' : receipt.status} request admission`, () => {
            const f = fixture();
            f.run(() => receipt as unknown as AutomaticPrefillRequestReceipt);
            f.model.connect(() => {});
            assert.equal(f.requests[0].admitAllocation().status, 'refused');
            assert.equal(f.model.getSnapshot().allocated, false);
        });
    }
    it('cannot manufacture allocated/saved using a null ticket without admission', () => {
        const f = fixture();
        f.model.connect(() => {});
        const forged = null as unknown as AutomaticPrefillAllocation;
        f.requests[0].didAllocate(forged);
        f.requests[0].didSettle({ status: 'saved', allocation: forged });
        assert.equal(f.model.getSnapshot().allocated, false);
        assert.equal(f.model.getSnapshot().outcome, 'unknown');
    });
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
