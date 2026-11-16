import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createNativePortalCollectionKernel,
    runNativePortalCollectionRead,
    type NativePortalCollectionHostPort,
    type NativePortalCollectionReadOutcome,
    type NativePortalCollectionResponse,
    type NativePortalCollectionScope,
    type NativePortalCollectionState,
    type NativePortalCollectionTransition,
} from '../src/portals/index.js';

type Row = { id: string; value: { text: string } };
type Schema = { id: string };
type Detail = { fieldId: string };
type Projection = { cache: string; details: string };
type State = NativePortalCollectionState<Row, Schema, Detail>;
type Transition = NativePortalCollectionTransition<
    Row,
    Schema,
    Detail,
    Projection
>;
type Outcome = NativePortalCollectionReadOutcome<
    Row,
    Schema,
    Detail,
    Projection
>;
type Response = NativePortalCollectionResponse<Row, Schema, Detail, Projection>;

const scope: NativePortalCollectionScope = {
    sessionId: 'session',
    fieldId: 'field',
    linkedTableId: 'table',
    bindingKey: 'binding',
    fetchOwnerKey: 'token',
    cacheOwnerEpoch: 1,
};
const response = (nextOffset: string | null = 'cursor'): Response => ({
    recordIds: ['one'],
    recordsById: { one: { id: 'one', value: { text: 'response' } } },
    schema: [{ id: 'title' }],
    linkedTableId: 'table',
    details: { presence: 'present', fields: [{ fieldId: 'title' }] },
    primary: { fieldId: 'title' },
    nextOffset,
    projection: { cache: 'response-cache', details: 'response-details' },
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

/** One canonical host snapshot; publication effects are installed before observers. */
function fixture() {
    const kernel = createNativePortalCollectionKernel<
        Row,
        Schema,
        Detail,
        Projection
    >();
    let state = kernel.createState(scope);
    const events: string[] = [];
    const commits: Transition[] = [];
    const requests: {
        requestId: string;
        mode: string;
        cursor: string | null;
    }[] = [];
    const notices: (() => boolean)[] = [];
    let compatibility: Projection | undefined;
    let nextId = 0;
    const hooks: {
        afterCommit?: (transition: Transition) => void;
        reject?: (transition: Transition) => boolean;
        allocate?: (requestId: string) => Promise<Outcome>;
        notice?: () => void;
    } = {};
    const host: NativePortalCollectionHostPort<
        Row,
        Schema,
        Detail,
        Projection
    > = {
        snapshot: () => state,
        commit(expected, transition) {
            assert.equal(
                expected,
                state,
                'host CAS uses its actual current snapshot'
            );
            if (hooks.reject?.(transition)) return false;
            state = transition.state;
            if (transition.compatibility)
                compatibility = transition.compatibility.projection;
            commits.push(transition);
            events.push(
                transition.cleanup
                    ? `correction:${transition.cleanup.kind}`
                    : transition.compatibility
                      ? 'success'
                      : state.active
                        ? `begin:${state.active.requestId}`
                        : state.cleanup
                          ? 'cleanup-state'
                          : 'continuation'
            );
            hooks.afterCommit?.(transition);
            return true;
        },
        allocate(receipt, plan) {
            assert.equal(
                state.active,
                receipt,
                'receipt is installed before external I/O'
            );
            assert.equal(kernel.isCurrent(state, receipt), true);
            requests.push({
                requestId: receipt.requestId,
                mode: plan.mode,
                cursor: plan.cursor,
            });
            events.push(`allocate:${receipt.requestId}`);
            return (
                hooks.allocate?.(receipt.requestId) ??
                Promise.resolve({ type: 'response', response: response() })
            );
        },
        cleanupScope(current) {
            return { ...current.scope, bindingKey: 'corrected' };
        },
        scheduleNotice(kind, isCurrent) {
            events.push(`notice:${kind}`);
            notices.push(isCurrent);
            hooks.notice?.();
        },
        nextRequestId() {
            events.push('request-id');
            return `follow-${++nextId}`;
        },
    };
    return {
        kernel,
        host,
        hooks,
        events,
        commits,
        requests,
        notices,
        snapshot: () => state,
        projection: () => compatibility,
        replace() {
            state = kernel.observe(state, {
                ...state.scope,
                bindingKey: 'replacement',
            });
        },
        install(next: State) {
            state = next;
        },
    };
}

describe('native Portal host transaction boundaries', () => {
    it('F: publishes receipt before I/O and cache/details/frame in one observed success', async () => {
        const f = fixture();
        let observedSuccess = 0;
        f.hooks.afterCommit = (transition) => {
            if (!transition.compatibility) return;
            observedSuccess++;
            assert.equal(f.snapshot(), transition.state);
            assert.deepEqual(f.projection(), {
                cache: 'response-cache',
                details: 'response-details',
            });
            assert.deepEqual(f.snapshot().frame?.recordIds, ['one']);
            assert.equal(f.snapshot().active, null);
        };
        assert.equal(
            await runNativePortalCollectionRead(f.kernel, f.host, {
                requestId: 'first',
                mode: 'first',
            }),
            'committed'
        );
        assert.equal(observedSuccess, 1);
        assert.deepEqual(f.events, [
            'begin:first',
            'allocate:first',
            'success',
        ]);
    });

    it('F: rejected begin commit performs no transport', async () => {
        const f = fixture();
        f.hooks.reject = () => true;
        assert.equal(
            await runNativePortalCollectionRead(f.kernel, f.host, {
                requestId: 'rejected',
                mode: 'first',
            }),
            'skipped'
        );
        assert.deepEqual(f.requests, []);
        assert.equal(f.snapshot().paging.type, 'notLoaded');
    });

    it('F: reentrant begin observer supersedes before the outer transport', async () => {
        const f = fixture();
        f.hooks.afterCommit = (transition) => {
            if (transition.state.active?.requestId === 'outer') {
                f.install(
                    f.kernel.begin(f.snapshot(), {
                        requestId: 'inner',
                        mode: 'first',
                    })!.state
                );
            }
        };
        assert.equal(
            await runNativePortalCollectionRead(f.kernel, f.host, {
                requestId: 'outer',
                mode: 'first',
            }),
            'stale'
        );
        assert.deepEqual(f.requests, []);
        assert.equal(f.snapshot().active?.requestId, 'inner');
    });

    for (const boundary of ['begin', 'success'] as const) {
        it(`F: an observer throwing after ${boundary} publication cannot strand or undo the committed state`, async () => {
            const f = fixture();
            f.hooks.afterCommit = (transition) => {
                if (
                    boundary === 'begin'
                        ? !!transition.state.active
                        : !!transition.compatibility
                )
                    throw new Error('observer failure');
            };
            assert.equal(
                await runNativePortalCollectionRead(f.kernel, f.host, {
                    requestId: 'first',
                    mode: 'first',
                }),
                'committed'
            );
            assert.equal(f.snapshot().paging.type, 'loaded');
            assert.equal(f.requests.length, 1);
        });
    }

    it('F: replacement then observer throw still suppresses the outer allocation', async () => {
        const f = fixture();
        f.hooks.afterCommit = (transition) => {
            if (transition.state.active?.requestId === 'outer') {
                f.install(
                    f.kernel.begin(f.snapshot(), {
                        requestId: 'inner',
                        mode: 'first',
                    })!.state
                );
                throw new Error('observer failure after replacement');
            }
        };
        assert.equal(
            await runNativePortalCollectionRead(f.kernel, f.host, {
                requestId: 'outer',
                mode: 'first',
            }),
            'stale'
        );
        assert.equal(f.snapshot().active?.requestId, 'inner');
        assert.deepEqual(f.requests, []);
    });

    it('F: commit throwing before publication refuses admission without I/O', async () => {
        const f = fixture();
        f.host.commit = () => {
            throw new Error('prepublication rejection');
        };
        assert.equal(
            await runNativePortalCollectionRead(f.kernel, f.host, {
                requestId: 'first',
                mode: 'first',
            }),
            'skipped'
        );
        assert.equal(f.snapshot().paging.type, 'notLoaded');
        assert.deepEqual(f.requests, []);
    });

    it('A: cached First and exhausted Next do not commit or allocate', async () => {
        const f = fixture();
        f.hooks.allocate = async () => ({
            type: 'response',
            response: response(null),
        });
        await runNativePortalCollectionRead(f.kernel, f.host, {
            requestId: 'first',
            mode: 'first',
        });
        const commits = f.commits.length;
        for (const command of [
            {
                requestId: 'cached',
                mode: 'first' as const,
                onlyIfNotFetched: true,
            },
            { requestId: 'exhausted', mode: 'next' as const },
        ]) {
            assert.equal(
                await runNativePortalCollectionRead(f.kernel, f.host, command),
                'skipped'
            );
        }
        assert.equal(f.commits.length, commits);
        assert.equal(f.requests.length, 1);
    });

    for (const outcome of [
        { type: 'response', response: response() },
        { type: 'failure', message: 'stale failure' },
        { type: 'cleanup', sort: [] },
    ] satisfies Outcome[]) {
        it(`E: allocated stale ${outcome.type} has no publication, notice or follow-up`, async () => {
            const f = fixture();
            const transport = deferred<Outcome>();
            f.hooks.allocate = () => transport.promise;
            const run = runNativePortalCollectionRead(f.kernel, f.host, {
                requestId: 'old',
                mode: 'first',
            });
            assert.equal(f.requests.length, 1);
            f.replace();
            const current = f.snapshot();
            transport.resolve(outcome);
            assert.equal(await run, 'stale');
            assert.equal(f.snapshot(), current);
            assert.equal(f.commits.length, 1);
            assert.deepEqual(f.events, ['begin:old', 'allocate:old']);
        });
    }

    for (const thrown of [
        new Error('transport rejected'),
        'transport rejected',
    ]) {
        it(`B: allocated ${typeof thrown} rejection settles ordinary failure`, async () => {
            const f = fixture();
            f.hooks.allocate = async () => {
                throw thrown;
            };
            assert.equal(
                await runNativePortalCollectionRead(f.kernel, f.host, {
                    requestId: 'failure',
                    mode: 'first',
                }),
                'committed'
            );
            assert.equal(f.snapshot().paging.type, 'failed');
            assert.equal(
                f.snapshot().paging.errorMessage,
                'transport rejected'
            );
            assert.equal(f.snapshot().active, null);
        });
    }

    it('F: rejected settlement commit does not publish compatibility', async () => {
        const f = fixture();
        f.hooks.reject = (transition) => !!transition.compatibility;
        assert.equal(
            await runNativePortalCollectionRead(f.kernel, f.host, {
                requestId: 'first',
                mode: 'first',
            }),
            'stale'
        );
        assert.equal(f.projection(), undefined);
        assert.equal(f.snapshot().paging.type, 'loading');
        assert.equal(f.commits.length, 1);
    });

    it('G: applies sort before notice and forced First; cleanup rows are never published', async () => {
        const f = fixture();
        f.hooks.allocate = async (requestId) =>
            requestId === 'cleanup'
                ? {
                      type: 'cleanup',
                      sort: [{ field: 'safe-sort' }],
                      filter: [{ field: 'ignored-filter' }],
                  }
                : { type: 'response', response: response(null) };
        assert.equal(
            await runNativePortalCollectionRead(f.kernel, f.host, {
                requestId: 'cleanup',
                mode: 'first',
            }),
            'committed'
        );
        assert.deepEqual(f.events, [
            'begin:cleanup',
            'allocate:cleanup',
            'correction:sort',
            'notice:sort',
            'continuation',
            'request-id',
            'begin:follow-1',
            'allocate:follow-1',
            'success',
        ]);
        assert.deepEqual(
            f.requests.map((request) => request.mode),
            ['first', 'first']
        );
        assert.deepEqual(
            f.commits
                .filter((commit) => commit.compatibility)
                .map((commit) => commit.state.frame?.id),
            ['follow-1']
        );
        assert.equal(f.snapshot().scope.bindingKey, 'corrected');
    });

    it('G: uses filter cleanup when no sort correction is present', async () => {
        const f = fixture();
        f.hooks.allocate = async (requestId) =>
            requestId === 'cleanup'
                ? { type: 'cleanup', filter: [] }
                : { type: 'response', response: response() };
        assert.equal(
            await runNativePortalCollectionRead(f.kernel, f.host, {
                requestId: 'cleanup',
                mode: 'first',
            }),
            'committed'
        );
        assert.ok(f.events.includes('correction:filter'));
        assert.ok(f.events.includes('notice:filter'));
        assert.equal(f.requests.length, 2);
    });

    it('G: deferred notice delivery remains guarded after forced First and later retirement', async () => {
        const f = fixture();
        f.hooks.allocate = async (requestId) =>
            requestId === 'cleanup'
                ? { type: 'cleanup', filter: [] }
                : { type: 'response', response: response() };
        await runNativePortalCollectionRead(f.kernel, f.host, {
            requestId: 'cleanup',
            mode: 'first',
        });
        assert.equal(f.notices.length, 1);
        assert.equal(
            f.notices[0](),
            true,
            'a current forced First does not discard the cleanup notice'
        );
        f.replace();
        assert.equal(
            f.notices[0](),
            false,
            'a replacement before deferred delivery suppresses the notice'
        );
        f.install(f.kernel.retire(f.snapshot()));
        assert.equal(f.notices[0](), false);
    });

    it('G: accepted response metadata echo does not discard a still-current deferred cleanup notice', async () => {
        const f = fixture();
        f.hooks.allocate = async (requestId) =>
            requestId === 'cleanup'
                ? { type: 'cleanup', filter: [] }
                : {
                      type: 'response',
                      response: {
                          ...response(),
                          scopeAfter: {
                              ...scope,
                              bindingKey: 'accepted-detail-metadata-echo',
                          },
                      },
                  };
        assert.equal(
            await runNativePortalCollectionRead(f.kernel, f.host, {
                requestId: 'cleanup',
                mode: 'first',
            }),
            'committed'
        );
        assert.equal(
            f.snapshot().scope.bindingKey,
            'accepted-detail-metadata-echo'
        );
        assert.equal(f.notices[0](), true);
        f.replace();
        assert.equal(f.notices[0](), false);
    });

    for (const boundary of ['correction', 'continuation'] as const) {
        it(`G: observer throwing after ${boundary} publication preserves ordered continuation`, async () => {
            const f = fixture();
            f.hooks.allocate = async (requestId) =>
                requestId === 'cleanup'
                    ? { type: 'cleanup', sort: [] }
                    : { type: 'response', response: response() };
            f.hooks.afterCommit = (transition) => {
                if (
                    boundary === 'correction'
                        ? !!transition.cleanup
                        : !transition.compatibility &&
                          !transition.state.active &&
                          !transition.state.cleanup
                )
                    throw new Error('observer failure');
            };
            assert.equal(
                await runNativePortalCollectionRead(f.kernel, f.host, {
                    requestId: 'cleanup',
                    mode: 'first',
                }),
                'committed'
            );
            assert.equal(f.requests.length, 2);
            assert.equal(
                f.events.filter((event) => event.startsWith('notice:')).length,
                1
            );
        });
    }

    it('D: malformed response data settles a safe failure rather than stranding loading', async () => {
        const f = fixture();
        f.hooks.allocate = async () => ({
            type: 'response',
            response: {
                ...response(),
                projection: new Map() as unknown as Projection,
            },
        });
        assert.equal(
            await runNativePortalCollectionRead(f.kernel, f.host, {
                requestId: 'bad-response',
                mode: 'first',
            }),
            'committed'
        );
        assert.equal(f.snapshot().paging.type, 'failed');
        assert.equal(
            f.snapshot().paging.errorMessage,
            'Invalid Portal response'
        );
        assert.equal(f.snapshot().active, null);
        assert.equal(f.projection(), undefined);
    });

    for (const boundary of ['correction', 'notice', 'continuation'] as const) {
        it(`G: reentrant ${boundary} replacement prevents remaining cleanup effects`, async () => {
            const f = fixture();
            f.hooks.allocate = async () => ({ type: 'cleanup', sort: [] });
            if (boundary === 'notice') f.hooks.notice = () => f.replace();
            else
                f.hooks.afterCommit = (transition) => {
                    if (
                        boundary === 'correction'
                            ? !!transition.cleanup
                            : transition.state.cleanup === null &&
                              transition.state.active === null
                    )
                        f.replace();
                };
            assert.equal(
                await runNativePortalCollectionRead(f.kernel, f.host, {
                    requestId: 'cleanup',
                    mode: 'first',
                }),
                'stale'
            );
            assert.equal(f.requests.length, 1);
            assert.equal(f.events.includes('request-id'), false);
            assert.equal(
                f.events.includes('notice:sort'),
                boundary !== 'correction'
            );
        });
    }

    for (const boundary of ['correction', 'continuation'] as const) {
        it(`G: rejected ${boundary} commit never allocates fresh First`, async () => {
            const f = fixture();
            f.hooks.allocate = async () => ({ type: 'cleanup', sort: [] });
            f.hooks.reject = (transition) =>
                boundary === 'correction'
                    ? !!transition.cleanup
                    : !transition.state.active && !transition.state.cleanup;
            assert.equal(
                await runNativePortalCollectionRead(f.kernel, f.host, {
                    requestId: 'cleanup',
                    mode: 'first',
                }),
                'stale'
            );
            assert.equal(f.requests.length, 1);
            assert.equal(f.events.includes('request-id'), false);
            assert.equal(
                f.events.includes('notice:sort'),
                boundary === 'continuation'
            );
        });
    }

    for (const outcome of [
        { type: 'cleanup' },
        { type: 'cleanup', sort: new Map() },
    ] satisfies Outcome[]) {
        it('G: malformed cleanup settles a safe failure before correction', async () => {
            const f = fixture();
            f.hooks.allocate = async () => outcome;
            assert.equal(
                await runNativePortalCollectionRead(f.kernel, f.host, {
                    requestId: 'cleanup',
                    mode: 'first',
                }),
                'committed'
            );
            assert.equal(f.snapshot().paging.type, 'failed');
            assert.equal(
                f.snapshot().paging.errorMessage,
                'Invalid Portal response'
            );
            assert.equal(f.snapshot().active, null);
            assert.equal(f.requests.length, 1);
            assert.equal(
                f.events.some(
                    (event) =>
                        event.startsWith('correction:') ||
                        event.startsWith('notice:')
                ),
                false
            );
        });
    }
});

describe('native Portal kernel edge contracts', () => {
    it('C: observed token A to B to A cannot resurrect previously accepted cache authority', () => {
        const f = fixture();
        const first = f.kernel.begin(f.snapshot(), {
            requestId: 'first',
            mode: 'first',
        })!;
        const accepted = f.kernel.succeed(
            first.state,
            first.receipt,
            response()
        )!.state;
        const tokenB = f.kernel.observe(accepted, {
            ...scope,
            bindingKey: 'token-b',
            fetchOwnerKey: 'token-b',
        });
        const tokenA = f.kernel.observe(tokenB, scope);
        assert.equal(tokenA.frame, null);
        assert.equal(
            f.kernel.begin(tokenA, {
                requestId: 'cache-after-aba',
                mode: 'first',
                onlyIfNotFetched: true,
            })?.plan.mode,
            'reload'
        );
        assert.equal(
            f.kernel.begin(tokenA, {
                requestId: 'next-after-aba',
                mode: 'next',
            })?.plan.mode,
            'reload'
        );
    });

    it('D: nonplain/cyclic payloads cannot escape snapshot immutability', () => {
        const f = fixture();
        const begin = f.kernel.begin(f.snapshot(), {
            requestId: 'first',
            mode: 'first',
        })!;
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        for (const invalid of [
            new Map(),
            new Set(),
            new Date(),
            new Uint8Array(1),
            () => 'function',
            Symbol('symbol'),
            BigInt(1),
            cyclic,
        ]) {
            assert.throws(
                () =>
                    f.kernel.succeed(begin.state, begin.receipt, {
                        ...response(),
                        projection: invalid as unknown as Projection,
                    }),
                /plain data/
            );
        }
        const shared = { cache: 'shared', details: 'shared' };
        const generic = createNativePortalCollectionKernel<
            Row,
            Schema,
            Detail,
            unknown
        >();
        const initial = generic.begin(generic.createState(scope), {
            requestId: 'first',
            mode: 'first',
        })!;
        const accepted = generic.succeed(initial.state, initial.receipt, {
            ...response(),
            projection: { a: shared, b: shared },
        })!;
        assert.ok(Object.isFrozen(accepted.compatibility?.projection));
        assert.equal(
            f.snapshot().active,
            null,
            'plan validation never mutates the original host state'
        );
    });

    it('C: session/field/cache owner replacement cannot reuse accepted fetch authority', () => {
        const f = fixture();
        const begin = f.kernel.begin(f.snapshot(), {
            requestId: 'first',
            mode: 'first',
        })!;
        const accepted = f.kernel.succeed(
            begin.state,
            begin.receipt,
            response()
        )!.state;
        for (const changedScope of [
            { ...scope, sessionId: 'other-session' },
            { ...scope, fieldId: 'other-field' },
            { ...scope, linkedTableId: 'other-table' },
            { ...scope, cacheOwnerEpoch: 2 },
        ]) {
            const changed = f.kernel.observe(accepted, changedScope);
            assert.equal(
                f.kernel.begin(changed, {
                    requestId: 'cached',
                    mode: 'first',
                    onlyIfNotFetched: true,
                })?.plan.mode,
                'reload'
            );
        }
    });

    it('G: corrected binding retires the prior accepted frame before notice', () => {
        const f = fixture();
        const initial = f.kernel.begin(f.snapshot(), {
            requestId: 'first',
            mode: 'first',
        })!;
        const accepted = f.kernel.succeed(
            initial.state,
            initial.receipt,
            response()
        )!.state;
        const begin = f.kernel.begin(accepted, {
            requestId: 'cleanup',
            mode: 'next',
        })!;
        const cleanup = f.kernel.cleanup(
            begin.state,
            begin.receipt,
            'filter',
            [],
            { ...scope, bindingKey: 'corrected' }
        )!;
        assert.equal(cleanup.state.frame, null);
        assert.equal(cleanup.state.paging.type, 'loaded');
        assert.equal(
            f.kernel.isCleanupCurrent(cleanup.state, cleanup.cleanup!.receipt),
            true
        );
        assert.equal(
            f.kernel.isCleanupCurrent(cleanup.state, {
                ...cleanup.cleanup!.receipt,
            }),
            false
        );
    });

    it('D: null/missing/empty details survive separately and append metadata mismatches fail closed', () => {
        for (const presence of ['null', 'missing', 'present'] as const) {
            const f = fixture();
            const first = f.kernel.begin(f.snapshot(), {
                requestId: 'first',
                mode: 'first',
            })!;
            const accepted = f.kernel.succeed(first.state, first.receipt, {
                ...response(),
                details: { presence, fields: [] },
            })!.state;
            assert.deepEqual(accepted.frame?.details, { presence, fields: [] });
            const append = f.kernel.begin(accepted, {
                requestId: 'next',
                mode: 'next',
            })!;
            const mismatch = f.kernel.succeed(append.state, append.receipt, {
                ...response(),
                details: {
                    presence: presence === 'present' ? 'missing' : 'present',
                    fields: [],
                },
            })!;
            assert.equal(mismatch.state.frame, null);
            assert.equal(mismatch.state.paging.type, 'loaded');
        }
    });

    it('D: wrong table, withheld schema, wrong row identity and append schema/primary mismatch do not invent frames', () => {
        for (const change of [
            { linkedTableId: 'wrong-table' },
            { schema: null },
            {
                recordsById: {
                    one: { id: 'wrong-row', value: { text: 'wrong' } },
                },
            },
        ]) {
            const f = fixture();
            const begin = f.kernel.begin(f.snapshot(), {
                requestId: 'first',
                mode: 'first',
            })!;
            assert.equal(
                f.kernel.succeed(begin.state, begin.receipt, {
                    ...response(),
                    ...change,
                })!.state.frame,
                null
            );
        }
        for (const change of [
            { schema: [{ id: 'other-schema' }] },
            { primary: null },
        ]) {
            const f = fixture();
            const first = f.kernel.begin(f.snapshot(), {
                requestId: 'first',
                mode: 'first',
            })!;
            const accepted = f.kernel.succeed(
                first.state,
                first.receipt,
                response()
            )!.state;
            const append = f.kernel.begin(accepted, {
                requestId: 'append',
                mode: 'next',
            })!;
            assert.equal(
                f.kernel.succeed(append.state, append.receipt, {
                    ...response(),
                    ...change,
                })!.state.frame,
                null
            );
        }
    });

    it('E: checks exact parent and cursor independently of generation', () => {
        const f = fixture();
        const first = f.kernel.begin(f.snapshot(), {
            requestId: 'first',
            mode: 'first',
        })!;
        const accepted = f.kernel.succeed(
            first.state,
            first.receipt,
            response()
        )!.state;
        const append = f.kernel.begin(accepted, {
            requestId: 'append',
            mode: 'next',
        })!;
        for (const frame of [
            { ...append.state.frame!, id: 'other-parent' },
            { ...append.state.frame!, nextOffset: 'other-cursor' },
            null,
        ]) {
            const current = { ...append.state, frame };
            assert.equal(f.kernel.isCurrent(current, append.receipt), false);
            assert.equal(
                f.kernel.succeed(current, append.receipt, response()),
                null
            );
        }
    });

    it('E: legacy-only pagination can remain current but cannot manufacture a frame', () => {
        const f = fixture();
        const first = f.kernel.begin(f.snapshot(), {
            requestId: 'first',
            mode: 'first',
        })!;
        const accepted = f.kernel.succeed(first.state, first.receipt, {
            ...response(),
            recordsById: {},
        })!.state;
        const append = f.kernel.begin(accepted, {
            requestId: 'append',
            mode: 'next',
        })!;
        assert.equal(f.kernel.isCurrent(append.state, append.receipt), true);
        assert.equal(
            f.kernel.isCurrent(
                {
                    ...append.state,
                    paging: { ...append.state.paging, nextOffset: 'other' },
                },
                append.receipt
            ),
            false
        );
        assert.equal(
            f.kernel.succeed(append.state, append.receipt, response())!.state
                .frame,
            null
        );
    });

    it('C: metadata echoes cannot substitute session/token/cache authority', () => {
        const f = fixture();
        const begin = f.kernel.begin(f.snapshot(), {
            requestId: 'first',
            mode: 'first',
        })!;
        for (const scopeAfter of [
            { ...scope, sessionId: 'other' },
            { ...scope, fetchOwnerKey: 'other-token' },
            { ...scope, cacheOwnerEpoch: 2 },
        ]) {
            assert.equal(
                f.kernel.succeed(begin.state, begin.receipt, {
                    ...response(),
                    scopeAfter,
                }),
                null
            );
            assert.equal(
                f.kernel.cleanup(
                    begin.state,
                    begin.receipt,
                    'sort',
                    [],
                    scopeAfter
                ),
                null
            );
        }
        const echo = f.kernel.succeed(begin.state, begin.receipt, {
            ...response(),
            scopeAfter: { ...scope, bindingKey: 'metadata-echo' },
        })!;
        assert.equal(echo.state.scope.bindingKey, 'metadata-echo');
        assert.equal(echo.state.frame?.id, 'first');
    });

    it('A: receipt issuance is instance-local and failed First can retry', () => {
        const f = fixture();
        const begin = f.kernel.begin(f.snapshot(), {
            requestId: 'first',
            mode: 'first',
        })!;
        const other = createNativePortalCollectionKernel<
            Row,
            Schema,
            Detail,
            Projection
        >();
        assert.equal(other.isCurrent(begin.state, begin.receipt), false);
        const failed = f.kernel.fail(
            begin.state,
            begin.receipt,
            'failure'
        )!.state;
        assert.ok(
            f.kernel.begin(failed, {
                requestId: 'retry',
                mode: 'first',
                onlyIfNotFetched: true,
            })
        );
        assert.equal(
            f.kernel.begin(begin.state, {
                requestId: 'duplicate',
                mode: 'first',
                onlyIfNotFetched: true,
            }),
            null
        );
    });

    it('H: disposed state is stable and rejects new observation or duplicate retirement', () => {
        const f = fixture();
        const retired = f.kernel.retire(f.snapshot());
        assert.equal(f.kernel.retire(retired), retired);
        assert.equal(
            f.kernel.observe(retired, { ...scope, bindingKey: 'replacement' }),
            retired
        );
    });

    it('C: invalid epochs and generation exhaustion fail before an unsafe transition', () => {
        const f = fixture();
        for (const cacheOwnerEpoch of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1]) {
            assert.throws(
                () => f.kernel.createState({ ...scope, cacheOwnerEpoch }),
                /epoch/
            );
            assert.throws(
                () =>
                    f.kernel.observe(f.snapshot(), {
                        ...scope,
                        cacheOwnerEpoch,
                    }),
                /epoch/
            );
        }
        const exhausted = {
            ...f.snapshot(),
            generation: Number.MAX_SAFE_INTEGER,
        };
        assert.throws(
            () =>
                f.kernel.observe(exhausted, {
                    ...scope,
                    bindingKey: 'replacement',
                }),
            /generation/
        );
        assert.throws(() => f.kernel.retire(exhausted), /generation/);
    });
});
