import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createPortalReadCoordinator,
    PortalCollectionError,
    type PortalReadCoordinator,
    type PortalReadCoordinatorOptions,
    type PortalReadReceipt,
} from '../src/portals/index.js';
import { deferredPortal } from './portalFixtures.js';

type Input = { criteria: { searchTerm: string } };
type Result = { recordIds: string[] };
const input = (searchTerm = 'Current') => ({ criteria: { searchTerm } });
const result = (recordId = 'record_current') => ({ recordIds: [recordId] });
const withoutThrowIfAborted = (signal: AbortSignal): AbortSignal => {
    Object.defineProperty(signal, 'throwIfAborted', {
        value: undefined,
        configurable: true,
    });
    return signal;
};
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
    it('does not dispatch after a configured loader getter destroys its owner', async () => {
        let calls = 0;
        let coordinator: PortalReadCoordinator<Input, Result>;
        coordinator = createPortalReadCoordinator<Input, Result>({
            concurrency: 'reject',
            getScope: () => ({ ownerId: 'visitor_A', revision: 1 }),
            get load() {
                coordinator.destroy();
                return async () => {
                    calls++;
                    return result('record_never_dispatched');
                };
            },
        });
        assert.deepEqual(await coordinator.read(input()), { type: 'retired' });
        assert.equal(calls, 0);
        assert.equal(coordinator.isCurrent(), false);
        assert.equal(coordinator.hasPendingRead(), false);
    });

    for (const reason of [
        new Error('Synthetic loader getter cancellation'),
        null,
    ]) {
        it(`does not dispatch after a configured loader getter cancels with ${reason === null ? 'null' : 'the first Error object'}`, async () => {
            let calls = 0;
            let cancelled = 0;
            let coordinator: PortalReadCoordinator<Input, Result>;
            coordinator = createPortalReadCoordinator<Input, Result>({
                concurrency: 'reject',
                getScope: () => ({ ownerId: 'visitor_A', revision: 1 }),
                get load() {
                    coordinator.cancel(reason);
                    return async () => {
                        calls++;
                        throw new Error(
                            'Synthetic ignored-abort loader failure'
                        );
                    };
                },
            });
            await assert.rejects(
                coordinator.read(input(), {
                    onCancelledAfterDispatch: () => {
                        cancelled++;
                        coordinator.cancel(
                            new Error('Synthetic nested reason')
                        );
                    },
                }),
                (error) => error === reason
            );
            assert.equal(calls, 0);
            assert.equal(cancelled, 1);
            assert.equal(coordinator.hasPendingRead(), false);
        });
    }

    it('does not dispatch an older intent after a configured loader getter starts a successor', async () => {
        const calls: Array<{ input: Input; signal: AbortSignal }> = [];
        let getters = 0;
        let successor: Promise<PortalReadReceipt<Result>> | undefined;
        let coordinator: PortalReadCoordinator<Input, Result>;
        coordinator = createPortalReadCoordinator<Input, Result>({
            concurrency: 'supersede',
            getScope: () => ({ ownerId: 'visitor_A', revision: 1 }),
            get load() {
                if (++getters === 1)
                    successor = coordinator.read(input('Successor'));
                return async (
                    value: Input,
                    { signal }: { signal: AbortSignal }
                ) => {
                    calls.push({ input: value, signal });
                    return result(value.criteria.searchTerm);
                };
            },
        });
        assert.deepEqual(await coordinator.read(input('Older')), {
            type: 'retired',
        });
        assert.ok(successor);
        const receipt = accepted(await successor);
        assert.deepEqual(receipt.raw, result('Successor'));
        assert.equal(receipt.isCurrent(), true);
        assert.equal(getters, 2);
        assert.deepEqual(
            calls.map((call) => call.input),
            [input('Successor')]
        );
        assert.equal(calls[0].signal.aborted, false);
        assert.equal(coordinator.hasPendingRead(), false);
    });

    it('retains the configured loader receiver and resolves its current function for each read', async () => {
        let version = 1;
        let getters = 0;
        const receivers: Array<PortalReadCoordinatorOptions<Input, Result>> =
            [];
        const options: PortalReadCoordinatorOptions<Input, Result> = {
            concurrency: 'reject',
            getScope: () => ({ ownerId: 'visitor_A', revision: 1 }),
            get load() {
                getters++;
                const captured = version;
                const load = async function (
                    this: PortalReadCoordinatorOptions<Input, Result>
                ) {
                    receivers.push(this);
                    return result(`record_version_${captured}`);
                };
                Object.defineProperty(load, 'call', {
                    get() {
                        throw new Error(
                            'Configured loader.call must not be read'
                        );
                    },
                });
                return load;
            },
        };
        const coordinator = createPortalReadCoordinator(options);
        const first = accepted(await coordinator.read(input()));
        version = 2;
        const second = accepted(await coordinator.read(input('Next')));
        assert.deepEqual(first.raw, result('record_version_1'));
        assert.deepEqual(second.raw, result('record_version_2'));
        assert.equal(first.isCurrent(), false);
        assert.equal(second.isCurrent(), true);
        assert.equal(getters, 2);
        assert.deepEqual(receivers, [options, options]);
    });

    for (const reason of [
        new Error('Synthetic acceptance cancellation'),
        null,
    ]) {
        const label = reason === null ? 'null' : 'Error object';
        it(`preserves explicit ${label} cancellation during raw receipt cloning`, async () => {
            const s = setup();
            let cancelled = 0;
            const pending = s.coordinator.read(input(), {
                onCancelledAfterDispatch: () => {
                    cancelled++;
                },
            });
            const rejected = assert.rejects(
                pending,
                (error) => error === reason
            );
            s.calls[0].pending.resolve({
                get recordIds() {
                    s.coordinator.cancel(reason);
                    return ['record_never_accepted'];
                },
            });
            await rejected;
            assert.equal(cancelled, 1);
            assert.equal(s.calls[0].signal.reason, reason);
            assert.equal(s.coordinator.hasPendingRead(), false);
        });
        it(`preserves explicit ${label} cancellation during an acceptance lease check`, async () => {
            const reply = deferredPortal<Result>();
            let armed = false;
            let cancelled = 0;
            let coordinator: PortalReadCoordinator<Input, Result>;
            coordinator = createPortalReadCoordinator<Input, Result>({
                concurrency: 'reject',
                getScope: () => ({ ownerId: 'visitor_A', revision: 1 }),
                isContextCurrent: () => {
                    if (armed) {
                        armed = false;
                        coordinator.cancel(reason);
                    }
                    return true;
                },
                load: async () => reply.promise,
            });
            const pending = coordinator.read(input(), {
                onCancelledAfterDispatch: () => {
                    cancelled++;
                },
            });
            const rejected = assert.rejects(
                pending,
                (error) => error === reason
            );
            armed = true;
            reply.resolve(result());
            await rejected;
            assert.equal(cancelled, 1);
            assert.equal(coordinator.hasPendingRead(), false);
        });
    }
    for (const source of ['external', 'internal'] as const) {
        it(`accepts a read when the real ${source} signal has no throwIfAborted method`, async () => {
            const s = setup();
            const external = new AbortController();
            if (source === 'external') withoutThrowIfAborted(external.signal);
            const read = s.coordinator.read(input(), {
                signal: external.signal,
            });
            assert.equal(s.calls.length, 1);
            if (source === 'internal') withoutThrowIfAborted(s.calls[0].signal);
            s.calls[0].pending.resolve(result());
            const receipt = accepted(await read);
            assert.deepEqual(receipt.raw, result());
            assert.equal(receipt.isCurrent(), true);
            assert.equal(s.calls[0].signal.aborted, false);
        });

        for (const reason of [new Error('Synthetic abort identity'), null]) {
            it(`preserves the ${reason === null ? 'null' : 'Error object'} reason when the real ${source} signal lacks throwIfAborted`, async () => {
                const s = setup();
                const external = new AbortController();
                if (source === 'external')
                    withoutThrowIfAborted(external.signal);
                const read = s.coordinator.read(input(), {
                    signal: external.signal,
                });
                assert.equal(s.calls.length, 1);
                if (source === 'internal')
                    withoutThrowIfAborted(s.calls[0].signal);
                const rejected = assert.rejects(
                    read,
                    (error) => error === reason
                );
                if (source === 'external') external.abort(reason);
                else s.coordinator.cancel(reason);
                assert.equal(s.calls[0].signal.aborted, true);
                assert.equal(s.calls[0].signal.reason, reason);
                // An abort-ignoring loader failure must not replace a present null reason.
                s.calls[0].pending.reject(
                    new Error('Synthetic ignored-abort failure')
                );
                await rejected;
                assert.equal(s.coordinator.hasPendingRead(), false);
                assert.equal(s.calls.length, 1);
            });
        }
    }

    it('preserves a pre-aborted null reason without invoking the transport or signal method', async () => {
        const s = setup();
        const controller = new AbortController();
        withoutThrowIfAborted(controller.signal);
        controller.abort(null);
        await assert.rejects(
            s.coordinator.read(input(), { signal: controller.signal }),
            (error) => error === null
        );
        assert.equal(s.calls.length, 0);
        assert.equal(s.coordinator.hasPendingRead(), false);
    });

    it('uses AbortError only when an older pre-aborted signal has no reason property', async () => {
        const s = setup();
        const controller = new AbortController();
        withoutThrowIfAborted(controller.signal);
        controller.abort();
        const olderSignal = new Proxy(controller.signal, {
            has: (target, key) => key !== 'reason' && Reflect.has(target, key),
            get: (target, key) => {
                if (key === 'reason') return undefined;
                if (key === 'addEventListener')
                    return target.addEventListener.bind(target);
                if (key === 'removeEventListener')
                    return target.removeEventListener.bind(target);
                return Reflect.get(target, key, target);
            },
        });
        await assert.rejects(
            s.coordinator.read(input(), { signal: olderSignal }),
            (error) =>
                error instanceof DOMException && error.name === 'AbortError'
        );
        assert.equal(s.calls.length, 0);
        assert.equal(s.coordinator.hasPendingRead(), false);
    });

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

    for (const firstReason of [
        new Error('Synthetic first cancellation'),
        null,
    ]) {
        const reasonLabel = firstReason === null ? 'null' : 'Error object';

        it(`invokes a nested cancellation callback once and preserves the first ${reasonLabel} reason`, async () => {
            const s = setup();
            const nestedReason = new Error('Synthetic nested cancellation');
            const events: string[] = [];
            let callbacks = 0;
            const read = s.coordinator.read(input(), {
                onCancelledAfterDispatch: () => {
                    callbacks++;
                    events.push('callback:start');
                    assert.equal(s.calls[0].signal.aborted, false);
                    // Bound recursion so a missing latch fails without exhausting the stack.
                    if (callbacks === 1) s.coordinator.cancel(nestedReason);
                    events.push('callback:end');
                },
            });
            const settled = read.then(
                (receipt) => receipt,
                (error: unknown) => error
            );
            s.calls[0].signal.addEventListener('abort', () =>
                events.push('abort')
            );
            s.coordinator.cancel(firstReason);
            assert.equal(s.coordinator.hasPendingRead(), true);
            s.calls[0].pending.resolve(result('record_late'));
            const outcome = await settled;
            assert.equal(callbacks, 1);
            assert.deepEqual(events, [
                'callback:start',
                'callback:end',
                'abort',
            ]);
            assert.equal(s.calls[0].signal.reason, firstReason);
            assert.equal(outcome, firstReason);
            assert.equal(s.coordinator.hasPendingRead(), false);
        });

        it(`preserves the original callback error and first ${reasonLabel} reason during nested cancellation`, async () => {
            const s = setup();
            const callbackError = new Error(
                'Synthetic original callback failure'
            );
            const unexpectedNestedError = new Error(
                'A nested callback must not run'
            );
            const events: string[] = [];
            let callbacks = 0;
            const read = s.coordinator.read(input(), {
                onCancelledAfterDispatch: () => {
                    callbacks++;
                    events.push('callback:start');
                    assert.equal(s.calls[0].signal.aborted, false);
                    if (callbacks > 1) throw unexpectedNestedError;
                    s.coordinator.cancel(
                        new Error('Synthetic nested cancellation')
                    );
                    events.push('callback:throw');
                    throw callbackError;
                },
            });
            const settled = read.then(
                (receipt) => receipt,
                (error: unknown) => error
            );
            s.calls[0].signal.addEventListener('abort', () =>
                events.push('abort')
            );
            let observedError: unknown;
            try {
                s.coordinator.cancel(firstReason);
            } catch (error) {
                observedError = error;
            }
            s.calls[0].pending.resolve(result('record_late'));
            const outcome = await settled;
            assert.equal(observedError, callbackError);
            assert.equal(callbacks, 1);
            assert.deepEqual(events, [
                'callback:start',
                'callback:throw',
                'abort',
            ]);
            assert.equal(s.calls[0].signal.reason, firstReason);
            assert.equal(outcome, firstReason);
            assert.equal(s.coordinator.hasPendingRead(), false);
        });

        it(`preserves the first ${reasonLabel} reason when a cancellation callback starts a successor`, async () => {
            const s = setup('supersede');
            let successor: Promise<PortalReadReceipt<Result>> | undefined;
            let callbacks = 0;
            const old = s.coordinator.read(input('Old'), {
                onCancelledAfterDispatch: () => {
                    callbacks++;
                    assert.equal(s.calls[0].signal.aborted, false);
                    successor = s.coordinator.read(input('Successor'));
                },
            });
            s.coordinator.cancel(firstReason);
            assert.equal(callbacks, 1);
            assert.equal(s.calls.length, 2);
            assert.equal(s.calls[1].signal.aborted, false);
            assert.equal(s.coordinator.hasPendingRead(), true);
            assert.equal(s.coordinator.isCurrent(), true);
            s.calls[0].pending.resolve(result('record_old'));
            s.calls[1].pending.resolve(result('record_successor'));
            assert.deepEqual(await old, { type: 'retired' });
            const receipt = accepted(await successor!);
            assert.equal(s.calls[0].signal.reason, firstReason);
            assert.equal(s.calls[1].signal.aborted, false);
            assert.equal(receipt.isCurrent(), true);
            assert.deepEqual(receipt.raw, result('record_successor'));
            assert.equal(s.coordinator.hasPendingRead(), false);
        });

        it(`preserves the first ${reasonLabel} reason when a cancellation callback destroys its owner`, async () => {
            const s = setup();
            let callbacks = 0;
            const read = s.coordinator.read(input(), {
                onCancelledAfterDispatch: () => {
                    callbacks++;
                    assert.equal(s.calls[0].signal.aborted, false);
                    s.coordinator.destroy(
                        new Error('Synthetic owner disposal')
                    );
                },
            });
            s.coordinator.cancel(firstReason);
            s.calls[0].pending.resolve(result('record_late'));
            assert.deepEqual(await read, { type: 'retired' });
            assert.equal(callbacks, 1);
            assert.equal(s.calls[0].signal.reason, firstReason);
            assert.equal(s.coordinator.isCurrent(), false);
            assert.equal(s.coordinator.hasPendingRead(), false);
        });
    }

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
