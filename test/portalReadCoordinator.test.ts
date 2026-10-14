import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createPortalReadCoordinator,
    PortalCollectionError,
    type PortalReadCoordinator,
    type PortalReadReceipt,
} from '../src/portals/index.js';
import { deferredPortal } from './portalFixtures.js';

type Input = { criteria: { searchTerm: string } };
type Result = { recordIds: string[] };
const input = (searchTerm = 'Current') => ({ criteria: { searchTerm } });
const result = (recordId = 'record_current') => ({ recordIds: [recordId] });
const accepted = (receipt: PortalReadReceipt<Result>) => {
    assert.equal(receipt.type, 'accepted');
    if (receipt.type !== 'accepted')
        throw new Error('Expected fixture receipt.');
    return receipt;
};
const setup = (concurrency: 'reject' | 'supersede' = 'reject') => {
    const scope = { ownerId: 'visitor_A', revision: 1 };
    const calls: Array<{
        input: Input;
        signal: AbortSignal;
        pending: ReturnType<typeof deferredPortal<Result>>;
    }> = [];
    const coordinator = createPortalReadCoordinator<Input, Result>({
        getScope: () => scope,
        concurrency,
        load: async (value, { signal }) => {
            const pending = deferredPortal<Result>();
            calls.push({ input: value, signal, pending });
            return pending.promise;
        },
    });
    return { scope, calls, coordinator };
};

describe('shared Portal read-attempt ownership', () => {
    it('detaches the requested criteria and raw incoming page without accumulating pages', async () => {
        const s = setup();
        const request = input();
        const read = s.coordinator.read(request);
        request.criteria.searchTerm = 'Changed';
        assert.deepEqual(s.calls[0].input, input());
        const page = result();
        s.calls[0].pending.resolve(page);
        const receipt = accepted(await read);
        page.recordIds.push('record_external_mutation');
        assert.deepEqual(receipt.raw, result());
        assert.equal(receipt.isCurrent(), true);
        const next = s.coordinator.read(input('Next page'));
        assert.equal(receipt.isCurrent(), false);
        s.calls[1].pending.resolve(result('record_next'));
        assert.deepEqual(accepted(await next).raw, result('record_next'));
    });

    it('preserves an accepted receipt when a pre-aborted request dispatches nothing', async () => {
        const s = setup();
        const first = s.coordinator.read(input());
        s.calls[0].pending.resolve(result());
        const receipt = accepted(await first);
        const controller = new AbortController();
        const reason = new Error('Synthetic pre-abort');
        controller.abort(reason);
        await assert.rejects(
            s.coordinator.read(input(), { signal: controller.signal }),
            (error) => error === reason
        );
        assert.equal(s.calls.length, 1);
        assert.equal(receipt.isCurrent(), true);
    });

    for (const getter of ['input', 'options'] as const) {
        it(`reserves reject-mode ownership before a reentrant ${getter} getter`, async () => {
            const s = setup();
            let nested: Promise<PortalReadReceipt<Result>> | undefined;
            const reenter = () => {
                nested = s.coordinator.read(input('Nested'));
                void nested.catch(() => undefined);
            };
            const request =
                getter === 'input'
                    ? {
                          get criteria() {
                              reenter();
                              return input().criteria;
                          },
                      }
                    : input();
            const options =
                getter === 'options'
                    ? {
                          get signal() {
                              reenter();
                              return undefined;
                          },
                      }
                    : {};
            const read = s.coordinator.read(request, options);
            await assert.rejects(
                nested!,
                (error) =>
                    error instanceof PortalCollectionError &&
                    error.code === 'read-in-progress'
            );
            assert.equal(s.calls.length, 1);
            assert.deepEqual(s.calls[0].input, input());
            s.calls[0].pending.resolve(result());
            assert.equal(accepted(await read).isCurrent(), true);
        });

        it(`does not revive an older superseded intent after a reentrant ${getter} getter`, async () => {
            const s = setup('supersede');
            let nested: Promise<PortalReadReceipt<Result>> | undefined;
            const reenter = () => {
                nested = s.coordinator.read(input('Newest'));
            };
            const request =
                getter === 'input'
                    ? {
                          get criteria() {
                              reenter();
                              return input('Old').criteria;
                          },
                      }
                    : input('Old');
            const options =
                getter === 'options'
                    ? {
                          get signal() {
                              reenter();
                              return undefined;
                          },
                      }
                    : {};
            const old = s.coordinator.read(request, options);
            assert.deepEqual(await old, { type: 'retired' });
            assert.equal(s.calls.length, 1);
            assert.deepEqual(s.calls[0].input, input('Newest'));
            s.calls[0].pending.resolve(result('record_newest'));
            assert.deepEqual(
                accepted(await nested!).raw,
                result('record_newest')
            );
        });
    }

    it('preserves the older supersede-mode transport when a new request is pre-aborted or uncloneable', async () => {
        const s = setup('supersede');
        const read = s.coordinator.read(input());
        const controller = new AbortController();
        const reason = new Error('Synthetic pre-abort');
        controller.abort(reason);
        await assert.rejects(
            s.coordinator.read(input(), { signal: controller.signal }),
            (error) => error === reason
        );
        const uncloneable = {
            criteria: { searchTerm: 'Invalid' },
            unsupported: () => undefined,
        };
        await assert.rejects(
            s.coordinator.read(uncloneable),
            (error) => error instanceof Error && error.name === 'DataCloneError'
        );
        assert.equal(s.calls[0].signal.aborted, false);
        assert.equal(s.calls.length, 1);
        s.calls[0].pending.resolve(result());
        assert.equal(accepted(await read).isCurrent(), true);
    });

    it('holds reject-mode ownership until an abort-ignoring read settles', async () => {
        const s = setup();
        const controller = new AbortController();
        const reason = new Error('Synthetic cancellation');
        const read = s.coordinator.read(input(), { signal: controller.signal });
        controller.abort(reason);
        assert.equal(s.calls[0].signal.aborted, true);
        assert.equal(s.coordinator.hasPendingRead(), true);
        await assert.rejects(
            s.coordinator.read(input()),
            (error) =>
                error instanceof PortalCollectionError &&
                error.code === 'read-in-progress'
        );
        assert.equal(s.calls.length, 1);
        s.calls[0].pending.resolve(result('record_late'));
        await assert.rejects(read, (error) => error === reason);
        assert.equal(s.coordinator.hasPendingRead(), false);
        const fresh = s.coordinator.read(input());
        s.calls[1].pending.resolve(result());
        assert.deepEqual(accepted(await fresh).raw, result());
    });

    it('still aborts transport when the cancellation callback throws', async () => {
        const s = setup();
        const callbackError = new Error('Synthetic cancellation callback');
        const reason = new Error('Synthetic cancellation');
        const read = s.coordinator.read(input(), {
            onCancelledAfterDispatch: () => {
                throw callbackError;
            },
        });
        assert.throws(
            () => s.coordinator.cancel(reason),
            (error) => error === callbackError
        );
        assert.equal(s.calls[0].signal.aborted, true);
        assert.equal(s.calls[0].signal.reason, reason);
        assert.equal(s.coordinator.hasPendingRead(), true);
        s.calls[0].pending.resolve(result('record_late'));
        await assert.rejects(read, (error) => error === reason);
        assert.equal(s.coordinator.hasPendingRead(), false);
    });

    for (const oldOutcome of ['success', 'error'] as const) {
        it(`retires an abort-ignoring superseded ${oldOutcome} without affecting its successor`, async () => {
            const s = setup('supersede');
            const old = s.coordinator.read(input('Old'));
            const newest = s.coordinator.read(input('Newest'));
            assert.equal(s.calls[0].signal.aborted, true);
            s.calls[1].pending.resolve(result('record_newest'));
            const receipt = accepted(await newest);
            if (oldOutcome === 'success')
                s.calls[0].pending.resolve(result('record_old'));
            else
                s.calls[0].pending.reject(new Error('Synthetic stale failure'));
            assert.deepEqual(await old, { type: 'retired' });
            assert.equal(receipt.isCurrent(), true);
            assert.deepEqual(receipt.raw, result('record_newest'));
            assert.equal(s.calls.length, 2);
        });
    }

    it('installs successor ownership before an old abort callback starts a third read', async () => {
        const s = setup('supersede');
        const old = s.coordinator.read(input('Old'));
        let reentrant: Promise<PortalReadReceipt<Result>> | undefined;
        s.calls[0].signal.addEventListener(
            'abort',
            () => {
                reentrant = s.coordinator.read(input('From abort callback'));
            },
            { once: true }
        );
        const middle = s.coordinator.read(input('Middle'));
        assert.equal(s.calls.length, 2);
        assert.deepEqual(s.calls[1].input, input('From abort callback'));
        assert.deepEqual(await middle, { type: 'retired' });
        s.calls[1].pending.resolve(result('record_reentrant'));
        assert.deepEqual(
            accepted(await reentrant!).raw,
            result('record_reentrant')
        );
        s.calls[0].pending.resolve(result('record_old'));
        assert.deepEqual(await old, { type: 'retired' });
    });

    it('latches an observed context loss across A-B-A restoration', async () => {
        let contextCurrent = true;
        const pending = deferredPortal<Result>();
        const coordinator = createPortalReadCoordinator<Input, Result>({
            concurrency: 'reject',
            getScope: () => ({ ownerId: 'visitor_A', revision: 1 }),
            isContextCurrent: () => contextCurrent,
            load: async () => pending.promise,
        });
        const read = coordinator.read(input());
        contextCurrent = false;
        assert.equal(coordinator.isCurrent(), false);
        contextCurrent = true;
        pending.resolve(result('record_old'));
        assert.deepEqual(await read, { type: 'retired' });
        await assert.rejects(
            coordinator.read(input()),
            (error) =>
                error instanceof PortalCollectionError &&
                error.code === 'scope-changed'
        );
    });

    it('rejects an owner revision ABA without an intermediate freshness check', async () => {
        const s = setup();
        const read = s.coordinator.read(input());
        s.scope.ownerId = 'visitor_B';
        s.scope.revision++;
        s.scope.ownerId = 'visitor_A';
        s.scope.revision++;
        s.calls[0].pending.resolve(result('record_old'));
        assert.deepEqual(await read, { type: 'retired' });
        assert.equal(s.coordinator.isCurrent(), false);
        assert.equal(s.calls[0].signal.aborted, true);
    });

    it('does not accept a page whose value getter retires its owner', async () => {
        const s = setup();
        const read = s.coordinator.read(input());
        const page = {
            get recordIds() {
                s.coordinator.destroy();
                return ['record_old'];
            },
        };
        s.calls[0].pending.resolve(page);
        assert.deepEqual(await read, { type: 'retired' });
        assert.equal(s.coordinator.isCurrent(), false);
    });

    it('retires acceptance reentry while letting the newly requested page win', async () => {
        const s = setup('supersede');
        let next: Promise<PortalReadReceipt<Result>> | undefined;
        let observed:
            | Extract<PortalReadReceipt<Result>, { type: 'accepted' }>
            | undefined;
        const first = s.coordinator.read(input(), {
            onAccepted: (receipt) => {
                observed = receipt;
                assert.equal(receipt.isCurrent(), true);
                next = s.coordinator.read(input('Next'));
                assert.equal(receipt.isCurrent(), false);
            },
        });
        s.calls[0].pending.resolve(result());
        assert.deepEqual(await first, { type: 'retired' });
        assert.equal(observed!.isCurrent(), false);
        s.calls[1].pending.resolve(result('record_next'));
        assert.deepEqual(accepted(await next!).raw, result('record_next'));
    });

    it('releases single-flight after acceptance throws and leaves error handling to its caller', async () => {
        const s = setup();
        const error = new Error('Synthetic acceptance failure');
        const read = s.coordinator.read(input(), {
            onAccepted: () => {
                throw error;
            },
        });
        s.calls[0].pending.resolve(result());
        await assert.rejects(read, (caught) => caught === error);
        assert.equal(s.coordinator.hasPendingRead(), false);
        const next = s.coordinator.read(input());
        s.calls[1].pending.resolve(result('record_next'));
        assert.equal(accepted(await next).isCurrent(), true);
    });

    it('does not dispatch when the pre-dispatch callback fails', async () => {
        const s = setup();
        const error = new Error('Synthetic dispatch failure');
        await assert.rejects(
            s.coordinator.read(input(), {
                onDispatch: () => {
                    throw error;
                },
            }),
            (caught) => caught === error
        );
        assert.equal(s.calls.length, 0);
        assert.equal(s.coordinator.hasPendingRead(), false);
    });

    it('surfaces a current transport error once and releases the slot for a deliberate fresh read', async () => {
        const s = setup();
        const error = new Error('Synthetic current transport failure');
        const read = s.coordinator.read(input());
        s.calls[0].pending.reject(error);
        await assert.rejects(read, (caught) => caught === error);
        assert.equal(s.calls.length, 1);
        assert.equal(s.coordinator.isCurrent(), true);
        assert.equal(s.coordinator.hasPendingRead(), false);
        const fresh = s.coordinator.read(input());
        s.calls[1].pending.resolve(result());
        assert.equal(accepted(await fresh).isCurrent(), true);
    });

    it('fails closed when a scope getter destroys the owner during freshness checks', () => {
        let retire = false;
        let coordinator: PortalReadCoordinator<Input, Result> | undefined;
        coordinator = createPortalReadCoordinator<Input, Result>({
            concurrency: 'reject',
            getScope: () => {
                if (retire) coordinator!.destroy();
                return { ownerId: 'visitor_A', revision: 1 };
            },
            load: async () => result(),
        });
        retire = true;
        assert.equal(coordinator.isCurrent(), false);
        assert.equal(coordinator.hasPendingRead(), false);
    });
});
