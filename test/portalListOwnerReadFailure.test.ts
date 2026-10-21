import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createMiniExtensionsClient, SDKError } from '../src/runtime/index.js';
import {
    createPortalListOwner,
    type PortalCollectionCriteria,
    type PortalListReadFailure,
    type PortalListSnapshot,
} from '../src/portals/index.js';
import {
    deferredPortal,
    portalListPage,
    portalPage,
} from './portalFixtures.js';

const criteria = (): PortalCollectionCriteria => ({
    selectedCustomViewId: 'view_example',
    searchTerm: '',
    searchParamsMap: {},
    sortFieldsByEndUser: null,
    filtersByEndUser: null,
    supportsEndUserSortCleanup: true,
    supportsEndUserFilterCleanup: true,
});
const readOptions = { pagesToFetch: 1, refreshLoggedInPortalRecord: false };
const genericError =
    'The Portal read did not complete. Use an explicit fresh Load.';
const cancelledError =
    'The Portal read was cancelled. Use an explicit fresh Load.';
const session = Object.freeze({ visitor: 'synthetic_session_secret' });
const apiOrigin = 'https://sdk.example.test';
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
const setup = (
    respond: () => Response | Promise<Response>,
    getScope = () => ({ ownerId: 'synthetic_A', revision: 0 })
) => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const client = createMiniExtensionsClient({
        apiOrigin,
        session,
        fetch: async (url, init) => {
            requests.push({ url: String(url), init });
            return respond();
        },
    });
    const portal = portalPage();
    portal.payload.extensionAccessToken = 'synthetic_portal_secret';
    const owner = createPortalListOwner({
        client,
        portal,
        portalFieldId: 'fld_children',
        criteria: criteria(),
        getScope,
    });
    return { client, owner, requests };
};
const assertExplicitRead = (fixture: ReturnType<typeof setup>, count = 1) => {
    assert.equal(fixture.requests.length, count);
    for (const request of fixture.requests) {
        const url = new URL(request.url);
        assert.equal(url.origin, apiOrigin);
        assert.equal(url.pathname, '/api/v1');
        assert.deepEqual(
            [...url.searchParams],
            [['route', 'fetchRecordsForLinkedTableOnPortal']]
        );
        assert.equal(request.init?.method, 'POST');
        const body = JSON.parse(String(request.init?.body));
        assert.equal(body.portalFieldId, 'fld_children');
        assert.equal(body.selectedCustomViewId, 'view_example');
        assert.equal(body.pagesToFetch, 1);
        assert.equal(body.refreshLoggedInPortalRecord, false);
        assert.deepEqual(body.miniExtStorageV4, session);
    }
    assert.deepEqual(fixture.client.getSession(), session);
};
const assertErrorState = (state: PortalListSnapshot) => {
    assert.equal(state.phase, 'error');
    assert.equal(state.error, genericError);
    assert.equal(state.pending, false);
    assert.equal(state.page, null);
    assert.equal(state.cleanup, null);
    assert.equal(state.hasNext, false);
    assert.equal(state.readRequired, true);
    assert.doesNotMatch(
        JSON.stringify(state),
        /raw_network_secret|raw_cause_secret|raw_server_secret|raw_body_secret|raw_code_secret|synthetic_session_secret|synthetic_portal_secret/
    );
};
const assertFailedRead = (fixture: ReturnType<typeof setup>) => {
    const state = fixture.owner.getSnapshot();
    assertErrorState(state);
    assertExplicitRead(fixture);
    return state;
};

it('publishes sanitized network facts from an actual failed public-client read while preserving generic recovery', async () => {
    const fixture = setup(async () => {
        throw new TypeError('raw_network_secret', {
            cause: new Error('raw_cause_secret'),
        });
    });
    try {
        const initial = fixture.owner.getSnapshot();
        assert.equal(initial.phase, 'idle');
        assert.equal(fixture.requests.length, 0);
        assert.equal(
            await fixture.owner.readFirst(initial.revision, readOptions),
            false
        );
        const state = assertFailedRead(fixture);
        assert.deepEqual(state.failure, {
            kind: 'network',
            status: null,
        });
    } finally {
        fixture.owner.destroy();
    }
});

it('distinguishes HTTP 503 and 403 without copying server messages, codes or bodies', async () => {
    for (const status of [503, 403]) {
        const fixture = setup(
            () =>
                new Response(
                    JSON.stringify({
                        message: 'raw_server_secret',
                        code: 'raw_code_secret',
                        token: 'raw_body_secret',
                    }),
                    { status, headers: { 'Content-Type': 'application/json' } }
                )
        );
        try {
            const initial = fixture.owner.getSnapshot();
            assert.equal(fixture.requests.length, 0);
            assert.equal(
                await fixture.owner.readFirst(initial.revision, readOptions),
                false
            );
            const state = assertFailedRead(fixture);
            assert.deepEqual(state.failure, {
                kind: 'http',
                status,
            });
        } finally {
            fixture.owner.destroy();
        }
    }
});

it('preserves API and protocol distinctions through the public client without exposing their payloads', async () => {
    const cases: {
        respond(): Response;
        failure: PortalListReadFailure;
    }[] = [
        {
            respond: () =>
                json(
                    {
                        error: true,
                        message: 'raw_server_secret',
                        code: 'raw_code_secret',
                        token: 'raw_body_secret',
                    },
                    403
                ),
            failure: { kind: 'api', status: 403 },
        },
        {
            respond: () => new Response('raw_body_secret invalid JSON'),
            failure: { kind: 'protocol', status: 200 },
        },
        {
            respond: () => json(null),
            failure: { kind: 'protocol', status: 200 },
        },
    ];
    for (const example of cases) {
        const fixture = setup(example.respond);
        try {
            assert.equal(await fixture.owner.readFirst(0, readOptions), false);
            assert.deepEqual(
                assertFailedRead(fixture).failure,
                example.failure
            );
        } finally {
            fixture.owner.destroy();
        }
    }
});

it('detaches failure facts from direct, immediate-subscriber and later-subscriber snapshots', async () => {
    const fixture = setup(() => json({ message: 'raw_server_secret' }, 503));
    const delivered: PortalListSnapshot[] = [];
    const stops = [
        fixture.owner.subscribe((state) => {
            if (state.failure) {
                Reflect.set(state.failure, 'kind', 'api');
                Reflect.set(state.failure, 'status', 401);
            }
        }),
        fixture.owner.subscribe((state) => delivered.push(state)),
    ];
    try {
        assert.equal(fixture.owner.getSnapshot().failure, null);
        assert.equal(await fixture.owner.readFirst(0, readOptions), false);
        const first = assertFailedRead(fixture);
        const second = fixture.owner.getSnapshot();
        assert.deepEqual(first.failure, { kind: 'http', status: 503 });
        assert.notEqual(first.failure, second.failure);
        assert.notEqual(first.failure, delivered.at(-1)!.failure);
        assert.deepEqual(delivered.at(-1)!.failure, {
            kind: 'http',
            status: 503,
        });
        assert.ok(first.failure);
        Reflect.set(first.failure, 'kind', 'unknown');
        Reflect.set(first.failure, 'status', null);
        const immediateFacts: (PortalListReadFailure | null | undefined)[] = [];
        stops.push(
            fixture.owner.subscribe((state) => {
                immediateFacts.push(structuredClone(state.failure));
                if (state.failure) Reflect.set(state.failure, 'status', 418);
            })
        );
        assert.deepEqual(immediateFacts, [{ kind: 'http', status: 503 }]);
        assert.deepEqual(second.failure, { kind: 'http', status: 503 });
        assert.deepEqual(fixture.owner.getSnapshot().failure, {
            kind: 'http',
            status: 503,
        });
        assertExplicitRead(fixture);
    } finally {
        for (const stop of stops) stop();
        fixture.owner.destroy();
    }
});

it('clears a failed read only through an explicit fresh first read without changing session or retrying', async () => {
    const held = deferredPortal<Response>();
    let count = 0;
    const fixture = setup(() => (++count === 1 ? json({}, 503) : held.promise));
    try {
        assert.equal(await fixture.owner.readFirst(0, readOptions), false);
        const failed = assertFailedRead(fixture);
        assert.equal(
            await fixture.owner.readNext(failed.revision, readOptions),
            false
        );
        assert.deepEqual(fixture.owner.getSnapshot(), failed);
        assertExplicitRead(fixture);

        const recovering = fixture.owner.readFirst(
            failed.revision,
            readOptions
        );
        const loading = fixture.owner.getSnapshot();
        assert.equal(loading.phase, 'loading');
        assert.equal(loading.pending, true);
        assert.equal(loading.error, null);
        assert.equal(loading.failure, null);
        assert.deepEqual(failed.failure, { kind: 'http', status: 503 });
        assertExplicitRead(fixture, 2);
        held.resolve(json(portalListPage()));
        assert.equal(await recovering, true);
        assert.equal(fixture.owner.getSnapshot().phase, 'empty');
        assert.equal(fixture.owner.getSnapshot().failure, null);
        for (const request of fixture.requests) {
            const body = JSON.parse(String(request.init?.body));
            assert.equal(body.airtableOffset, null);
            assert.deepEqual(body.alreadyLoadedRecordIds, []);
        }
        assertExplicitRead(fixture, 2);
    } finally {
        fixture.owner.destroy();
    }
});

it('criteria and field replacement clear failure metadata without dispatching a read', async () => {
    const fixture = setup(() => json({}, 403));
    try {
        assert.equal(await fixture.owner.readFirst(0, readOptions), false);
        assert.deepEqual(assertFailedRead(fixture).failure, {
            kind: 'http',
            status: 403,
        });
        assert.equal(
            fixture.owner.setCriteria(fixture.owner.getSnapshot().revision, {
                ...criteria(),
                searchTerm: 'New synthetic search',
            }),
            true
        );
        assert.equal(fixture.owner.getSnapshot().phase, 'idle');
        assert.equal(fixture.owner.getSnapshot().failure, null);
        assert.equal(fixture.owner.getSnapshot().error, null);
        assertExplicitRead(fixture);

        assert.equal(
            await fixture.owner.readFirst(
                fixture.owner.getSnapshot().revision,
                readOptions
            ),
            false
        );
        assert.deepEqual(fixture.owner.getSnapshot().failure, {
            kind: 'http',
            status: 403,
        });
        assert.equal(
            fixture.owner.setField(
                fixture.owner.getSnapshot().revision,
                'fld_children',
                criteria()
            ),
            true
        );
        assert.equal(fixture.owner.getSnapshot().phase, 'idle');
        assert.equal(fixture.owner.getSnapshot().failure, null);
        assertExplicitRead(fixture, 2);
        fixture.owner.destroy();
        assert.equal(fixture.owner.getSnapshot().phase, 'retired');
        assert.equal(fixture.owner.getSnapshot().failure, null);
    } finally {
        fixture.owner.destroy();
    }
});

it('publishes explicit cancellation and ignores a late rejection while a fresh successor owns loading', async () => {
    const old = deferredPortal<Response>();
    const fresh = deferredPortal<Response>();
    let count = 0;
    const fixture = setup(() => (++count === 1 ? old.promise : fresh.promise));
    try {
        const abandoned = fixture.owner.readFirst(0, readOptions);
        fixture.owner.cancel(fixture.owner.getSnapshot().revision);
        const cancelled = fixture.owner.getSnapshot();
        assert.equal(cancelled.phase, 'error');
        assert.equal(cancelled.error, cancelledError);
        assert.deepEqual(cancelled.failure, {
            kind: 'cancelled',
            status: null,
        });
        assertExplicitRead(fixture);

        const successor = fixture.owner.readFirst(
            cancelled.revision,
            readOptions
        );
        const loading = fixture.owner.getSnapshot();
        assert.equal(loading.phase, 'loading');
        assert.equal(loading.failure, null);
        old.reject(new Error('raw_network_secret'));
        assert.equal(await abandoned, false);
        assert.deepEqual(fixture.owner.getSnapshot(), loading);
        fresh.resolve(json(portalListPage()));
        assert.equal(await successor, true);
        assert.equal(fixture.owner.getSnapshot().failure, null);
        assertExplicitRead(fixture, 2);
    } finally {
        fixture.owner.destroy();
    }
});

it('preserves the existing zero-dispatch pre-aborted owner replacement and explicit signal cancellation', async () => {
    for (const preAborted of [true, false]) {
        const held = deferredPortal<Response>();
        const fixture = setup(() => held.promise);
        const controller = new AbortController();
        if (preAborted) controller.abort(new Error('raw_cause_secret'));
        try {
            const reading = fixture.owner.readFirst(0, {
                ...readOptions,
                signal: controller.signal,
            });
            if (!preAborted) {
                controller.abort(new Error('raw_cause_secret'));
                held.reject(new Error('raw_network_secret'));
            }
            assert.equal(await reading, false);
            const state = fixture.owner.getSnapshot();
            assert.ok(state.revision > 0);
            assert.equal(state.phase, 'error');
            assert.equal(state.error, cancelledError);
            assert.deepEqual(state.failure, {
                kind: 'cancelled',
                status: null,
            });
            assert.equal(state.pending, false);
            assert.doesNotMatch(JSON.stringify(state), /raw_cause_secret/);
            assertExplicitRead(fixture, preAborted ? 0 : 1);
        } finally {
            fixture.owner.destroy();
        }
    }
});

it('a stale rejection cannot overwrite an already-settled successor failure after criteria replacement', async () => {
    const old = deferredPortal<Response>();
    const fresh = deferredPortal<Response>();
    let count = 0;
    const fixture = setup(() => (++count === 1 ? old.promise : fresh.promise));
    try {
        const abandoned = fixture.owner.readFirst(0, readOptions);
        assert.equal(
            fixture.owner.setCriteria(fixture.owner.getSnapshot().revision, {
                ...criteria(),
                searchTerm: 'Successor synthetic search',
            }),
            true
        );
        assert.equal(fixture.owner.getSnapshot().failure, null);
        assertExplicitRead(fixture);
        const successor = fixture.owner.readFirst(
            fixture.owner.getSnapshot().revision,
            readOptions
        );
        fresh.resolve(json({ message: 'raw_server_secret' }, 503));
        assert.equal(await successor, false);
        const accepted = fixture.owner.getSnapshot();
        assertErrorState(accepted);
        assert.deepEqual(accepted.failure, { kind: 'http', status: 503 });
        old.reject(new Error('raw_network_secret'));
        assert.equal(await abandoned, false);
        assert.deepEqual(fixture.owner.getSnapshot(), accepted);
        assertExplicitRead(fixture, 2);
    } finally {
        fixture.owner.destroy();
    }
});

it('observed owner A to B to A replacement permanently retires a held failure', async () => {
    const held = deferredPortal<Response>();
    let scope = { ownerId: 'synthetic_A', revision: 0 };
    const fixture = setup(
        () => held.promise,
        () => scope
    );
    const delivered: PortalListSnapshot[] = [];
    const stop = fixture.owner.subscribe((state) => delivered.push(state));
    try {
        const reading = fixture.owner.readFirst(0, readOptions);
        scope = { ownerId: 'synthetic_B', revision: 1 };
        assert.equal(fixture.owner.getSnapshot().phase, 'retired');
        scope = { ownerId: 'synthetic_A', revision: 2 };
        held.reject(new Error('raw_network_secret'));
        assert.equal(await reading, false);
        const state = fixture.owner.getSnapshot();
        assert.equal(state.phase, 'retired');
        assert.equal(state.failure, null);
        assert.equal(state.error, null);
        assert.equal(state.page, null);
        assert.equal(
            delivered.some((item) => item.failure !== null),
            false
        );
        assertExplicitRead(fixture);
    } finally {
        stop();
        fixture.owner.destroy();
    }
});

it('classifies only safe own SDKError data without invoking hostile accessors or inferring cancellation', async () => {
    let getterCalls = 0;
    const accessorKind = new SDKError('raw_server_secret', { kind: 'http' });
    Object.defineProperty(accessorKind, 'kind', {
        get() {
            getterCalls++;
            throw new Error('raw_cause_secret');
        },
    });
    const accessorStatus = new SDKError('raw_server_secret', { kind: 'http' });
    Object.defineProperty(accessorStatus, 'status', {
        get() {
            getterCalls++;
            throw new Error('raw_cause_secret');
        },
    });
    const poisonedNonFacts = new SDKError('raw_server_secret', {
        kind: 'api',
        status: 403,
    });
    for (const key of ['message', 'cause', 'code']) {
        Object.defineProperty(poisonedNonFacts, key, {
            get() {
                getterCalls++;
                throw new Error('raw_code_secret');
            },
        });
    }
    const malformedKind = new SDKError('raw_server_secret', { kind: 'http' });
    Reflect.set(malformedKind, 'kind', 'cancelled');
    const stringStatus = new SDKError('raw_server_secret', { kind: 'http' });
    Reflect.set(stringStatus, 'status', '403');
    const throwingDescriptor = new Proxy(
        new SDKError('raw_server_secret', { kind: 'http', status: 403 }),
        {
            getOwnPropertyDescriptor() {
                throw new Error('raw_cause_secret');
            },
        }
    );
    const inheritedKind = new SDKError('raw_server_secret', { kind: 'http' });
    Reflect.deleteProperty(inheritedKind, 'kind');
    Object.setPrototypeOf(
        inheritedKind,
        Object.assign(Object.create(SDKError.prototype), { kind: 'http' })
    );
    const cases: { reason: unknown; failure: PortalListReadFailure }[] = [
        {
            reason: new Error('raw_network_secret'),
            failure: { kind: 'unknown', status: null },
        },
        {
            reason: new DOMException('raw_network_secret', 'AbortError'),
            failure: { kind: 'unknown', status: null },
        },
        {
            reason: { kind: 'http', status: 403, message: 'raw_server_secret' },
            failure: { kind: 'unknown', status: null },
        },
        { reason: accessorKind, failure: { kind: 'unknown', status: null } },
        { reason: accessorStatus, failure: { kind: 'http', status: null } },
        { reason: poisonedNonFacts, failure: { kind: 'api', status: 403 } },
        { reason: malformedKind, failure: { kind: 'unknown', status: null } },
        { reason: stringStatus, failure: { kind: 'http', status: null } },
        {
            reason: throwingDescriptor,
            failure: { kind: 'unknown', status: null },
        },
        { reason: inheritedKind, failure: { kind: 'unknown', status: null } },
        {
            reason: new SDKError('raw_server_secret', {
                kind: 'network',
                status: 403,
            }),
            failure: { kind: 'network', status: null },
        },
    ];
    for (const status of [99, 600, 403.5, Infinity, NaN])
        cases.push({
            reason: new SDKError('raw_server_secret', { kind: 'http', status }),
            failure: { kind: 'http', status: null },
        });
    for (const example of cases) {
        const fixture = setup(() => {
            throw new Error('Unexpected injected fetch.');
        });
        let adapterCalls = 0;
        fixture.client.portals.listLinkedRecords = async () => {
            adapterCalls++;
            throw example.reason;
        };
        try {
            assert.equal(await fixture.owner.readFirst(0, readOptions), false);
            const state = fixture.owner.getSnapshot();
            assertErrorState(state);
            assert.deepEqual(state.failure, example.failure);
            assert.equal(adapterCalls, 1);
            assertExplicitRead(fixture, 0);
            assert.equal(getterCalls, 0);
        } finally {
            fixture.owner.destroy();
        }
    }
});

it('rechecks the accepted lease after hostile descriptor traps cancel, replace or retire ownership', async () => {
    for (const transition of ['cancel', 'criteria', 'destroy'] as const) {
        const fixture = setup(() => {
            throw new Error('Unexpected injected fetch.');
        });
        let traps = 0;
        const reason = new Proxy(
            new SDKError('raw_server_secret', { kind: 'http', status: 503 }),
            {
                getOwnPropertyDescriptor(target, key) {
                    if (key === 'kind') {
                        traps++;
                        const revision = fixture.owner.getSnapshot().revision;
                        if (transition === 'cancel')
                            fixture.owner.cancel(revision);
                        if (transition === 'criteria')
                            fixture.owner.setCriteria(revision, criteria());
                        if (transition === 'destroy') fixture.owner.destroy();
                    }
                    return Reflect.getOwnPropertyDescriptor(target, key);
                },
            }
        );
        let adapterCalls = 0;
        fixture.client.portals.listLinkedRecords = async () => {
            adapterCalls++;
            throw reason;
        };
        try {
            assert.equal(await fixture.owner.readFirst(0, readOptions), false);
            const state = fixture.owner.getSnapshot();
            assert.equal(traps, 1);
            assert.equal(adapterCalls, 1);
            assert.equal(state.pending, false);
            if (transition === 'cancel') {
                assert.equal(state.phase, 'error');
                assert.equal(state.error, cancelledError);
                assert.deepEqual(state.failure, {
                    kind: 'cancelled',
                    status: null,
                });
            } else {
                assert.equal(
                    state.phase,
                    transition === 'destroy' ? 'retired' : 'idle'
                );
                assert.equal(state.error, null);
                assert.equal(state.failure, null);
            }
            assertExplicitRead(fixture, 0);
        } finally {
            fixture.owner.destroy();
        }
    }
});
