import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createCachedDeviceFingerprintProvider,
    createMiniExtensionsClient,
    getDeviceFingerprint,
    loadExtensionWithCapabilities,
    LimitedFormLoadError,
    requiresFormDeviceFingerprint,
    type DeviceFingerprintProvider,
    type LoadExtensionInput,
    type LoadExtensionResult,
} from '../src/runtime/index.js';
import {
    formResult,
    loadInput,
    saveInput,
    publicPortalFields,
} from './runtimeFixtures.js';

const identity = { version: 1, visitorId: 'synthetic-visitor-00000001' };
const limited = () => {
    const form = structuredClone(formResult);
    form.payload.publicFields.state.allowCreatingOnlyOneRecord = true;
    return form;
};
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const capabilityError = (error: unknown) =>
    error instanceof LimitedFormLoadError &&
    error.code === 'capability_unavailable';
const retiredError = (error: unknown) =>
    error instanceof LimitedFormLoadError && error.code === 'retired';

const screenResults = (): LoadExtensionResult[] => {
    const { payload: _payload, ...common } = formResult;
    const gatePayload = {
        baseId: 'base_example',
        loggedInUserCanEditExtension: false,
        showMiniExtensionsBranding: true,
        onFreePlan: true,
        trialExpiresAtUnixEpoch: null,
    };
    return [
        structuredClone(formResult),
        {
            ...common,
            extensionScreen: 'password',
            payload: gatePayload,
        },
        {
            ...common,
            extensionScreen: 'login_page',
            payload: {
                ...gatePayload,
                publicFields: formResult.payload.publicFields,
                hasParentExtension: false,
                shareId: 'share_example',
                loginFieldNames: [],
                loginFieldIds: [],
                fieldNamesToSchemas: {},
                fieldIdsToSchemas: {},
                tableId: 'table_example',
                prefillFieldNamesToValues: {},
                prefillLoginRecordId: null,
            },
        },
        {
            ...common,
            extensionScreen: 'portal_loaded',
            payload: {
                ...gatePayload,
                extensionType: 'portal',
                extensionName: null,
                extensionAccessToken: 'synthetic_portal',
                viewIdsToAirtableViews: {},
                publicFields: publicPortalFields(),
                formRecord: {
                    type: 'edit',
                    data: {},
                    recordId: 'rec_example',
                    tableId: 'table_example',
                },
                fieldNamesToSchemas: {},
                fieldIdsToSchemas: {},
                linkedRecordFieldIdToDetailFields: {},
                linkedRecordFieldIdToFieldsTitles: {},
                cookieKeyForLoginToken: null,
                fieldIdsInPortal: [],
                usersTableFields: [],
                initialLinkedTableStates: {},
            },
        },
        { type: 'redirect', url: 'https://example.test/final' },
    ];
};

/** Only HTTP and the explicit host collector are synthetic. The client,
 * canonical protocol, orchestration and provider cache execute unchanged. */
const harness = (
    respond: (
        body: Record<string, unknown>,
        index: number
    ) => LoadExtensionResult | Promise<LoadExtensionResult> = () => formResult
) => {
    const requests: Record<string, unknown>[] = [];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://synthetic.example.test',
        session: { visitor: 'original-session' },
        fetch: async (_url, init) => {
            const body: Record<string, unknown> = JSON.parse(
                String(init?.body)
            );
            requests.push(body);
            return new Response(
                JSON.stringify(await respond(body, requests.length)),
                {
                    headers: { 'content-type': 'application/json' },
                }
            );
        },
    });
    return { client, requests };
};

describe('explicit provider scope', () => {
    for (const invalid of [
        undefined,
        null,
        'identifier',
        {},
        { version: 2, visitorId: identity.visitorId },
        { version: 1, visitorId: null },
        { version: 1, visitorId: 12345 },
        { version: 1, visitorId: 'x'.repeat(15) },
        { version: 1, visitorId: 'x'.repeat(129) },
    ]) {
        it(`rejects invalid identity ${JSON.stringify(invalid)}`, async () => {
            const provider = createCachedDeviceFingerprintProvider(
                () => invalid
            );
            await assert.rejects(
                getDeviceFingerprint(provider),
                capabilityError
            );
        });
    }
    for (const length of [16, 128]) {
        it(`accepts identity length ${length}`, async () => {
            const provider = createCachedDeviceFingerprintProvider(() => ({
                version: 1,
                visitorId: 'x'.repeat(length),
            }));
            assert.equal(
                (await getDeviceFingerprint(provider)).visitorId.length,
                length
            );
        });
    }
    it('coalesces pending work and caches a detached validated success per instance', async () => {
        const pending = deferred<unknown>();
        let calls = 0;
        const provider = createCachedDeviceFingerprintProvider(() => {
            calls++;
            return pending.promise;
        });
        const one = getDeviceFingerprint(provider);
        const two = getDeviceFingerprint(provider);
        const value = { ...identity };
        pending.resolve(value);
        assert.deepEqual(await one, identity);
        value.visitorId = 'changed';
        assert.deepEqual(await two, identity);
        assert.deepEqual(await getDeviceFingerprint(provider), identity);
        assert.equal(calls, 1);
        const separate = createCachedDeviceFingerprintProvider(() => {
            calls++;
            return identity;
        });
        await getDeviceFingerprint(separate);
        assert.equal(calls, 2);
    });
    it('evicts synchronous failure, rejection and invalid success for an explicit retry only', async () => {
        for (const failure of ['throw', 'reject', 'invalid']) {
            let calls = 0;
            const provider = createCachedDeviceFingerprintProvider(() => {
                calls++;
                if (calls > 1) return identity;
                if (failure === 'throw') throw new Error('synthetic failure');
                if (failure === 'reject')
                    return Promise.reject(new Error('synthetic failure'));
                return { version: 1, visitorId: 'short' };
            });
            await assert.rejects(
                getDeviceFingerprint(provider),
                capabilityError
            );
            assert.equal(calls, 1);
            assert.deepEqual(await getDeviceFingerprint(provider), identity);
            assert.equal(calls, 2);
        }
    });
});

describe('capability-first extension loading', () => {
    for (const result of screenResults()) {
        it(`publishes only the ordinary ${result.extensionScreen ?? 'redirect'} union without a provider`, async () => {
            const { client, requests } = harness(() => result);
            const published: LoadExtensionResult[] = [];
            const actual = await loadExtensionWithCapabilities({
                client,
                input: loadInput,
                isCurrent: () => true,
                publish: (final) => published.push(final),
            });
            assert.deepEqual(actual, result);
            assert.deepEqual(published, [result]);
            assert.equal(requests.length, 1);
            assert.deepEqual(requests[0].deviceFingerprint, {
                version: 1,
                visitorId: null,
            });
        });
        it(`returns the final ${result.extensionScreen ?? 'redirect'} unchanged after two logical loads`, async () => {
            const { client, requests } = harness((_body, index) =>
                index === 1 ? limited() : result
            );
            let collections = 0;
            const provider = createCachedDeviceFingerprintProvider(() => {
                collections++;
                return identity;
            });
            const published: LoadExtensionResult[] = [];
            assert.deepEqual(
                await loadExtensionWithCapabilities({
                    client,
                    input: loadInput,
                    provider,
                    isCurrent: () => true,
                    publish: (final) => published.push(final),
                }),
                result
            );
            assert.deepEqual(published, [result]);
            assert.equal(requests.length, 2);
            assert.deepEqual(requests[1].deviceFingerprint, identity);
            assert.equal(collections, 1);
        });
    }
    for (const kind of ['edit', 'parent', 'nonlimited', 'modal', 'child']) {
        it(`does not collect for ${kind}`, async () => {
            const first = limited();
            let input: LoadExtensionInput = structuredClone(loadInput);
            if (kind === 'edit')
                first.payload.formRecord = {
                    type: 'edit',
                    recordId: 'rec_example',
                    tableId: 'table_example',
                    data: {},
                };
            if (kind === 'parent') first.payload.hasParentExtension = true;
            if (kind === 'nonlimited')
                first.payload.publicFields.state.allowCreatingOnlyOneRecord = false;
            if (kind === 'modal')
                input.context = {
                    type: 'modal',
                    linkedTableIdOfLinkedRecordField: 'table_child',
                    prefillDataForLinkedRecordsForm: null,
                };
            if (kind === 'child')
                input = {
                    childExtensionAccessData: {
                        parentExtensionAccessToken: 'synthetic_parent',
                        fieldIdUsedToAccessExtension: null,
                    },
                    childExtensionInfo: {
                        childExtensionId: 'ext_child',
                        accessType: { type: 'create' },
                    },
                    query: {},
                    context: { type: 'direct-url' },
                };
            const { client, requests } = harness(() => first);
            let collections = 0;
            await loadExtensionWithCapabilities({
                client,
                input,
                isCurrent: () => true,
                provider: createCachedDeviceFingerprintProvider(() => {
                    collections++;
                    return identity;
                }),
            });
            assert.equal(requests.length, 1);
            assert.equal(collections, 0);
        });
    }
    for (const provider of [
        undefined,
        {} as DeviceFingerprintProvider,
        {
            getFingerprint: async () => ({
                version: 2,
                visitorId: identity.visitorId,
            }),
        },
        {
            getFingerprint: async () => {
                throw new Error('synthetic provider failure');
            },
        },
    ]) {
        it('fails eligible capability explicitly without exposing the first Form or retrying', async () => {
            const { client, requests } = harness(() => limited());
            const published: LoadExtensionResult[] = [];
            await assert.rejects(
                loadExtensionWithCapabilities({
                    client,
                    input: loadInput,
                    provider,
                    isCurrent: () => true,
                    publish: (result) => published.push(result),
                }),
                capabilityError
            );
            assert.equal(requests.length, 1);
            assert.deepEqual(published, []);
        });
    }
    it('captures original logical request, progress and client session once across provider delay', async () => {
        const pending = deferred<unknown>();
        const started = deferred<void>();
        const { client, requests } = harness((_body, index) =>
            index === 1 ? limited() : formResult
        );
        const input = structuredClone(loadInput);
        input.context = {
            type: 'direct-url',
            localStorageRecord: { fld_title: 'original-draft' },
        };
        input.query = Object.fromEntries(
            new URLSearchParams('prefill_X=old&prefill_X=last')
        );
        input.viewMode = 'draft';
        input.clientTimeZone = 'Asia/Tokyo';
        const original = structuredClone(input);
        const loading = loadExtensionWithCapabilities({
            client,
            input,
            isCurrent: () => true,
            provider: createCachedDeviceFingerprintProvider(() => {
                started.resolve();
                return pending.promise;
            }),
        });
        await started.promise;
        input.context.localStorageRecord = { fld_title: 'newer-draft' };
        input.query = { prefill_X: 'changed' };
        input.viewMode = 'published';
        input.clientTimeZone = 'UTC';
        client.setSession({ visitor: 'new-session' });
        pending.resolve(identity);
        await loading;
        for (const request of requests) {
            assert.deepEqual(request.context, original.context);
            assert.deepEqual(request.query, { prefill_X: 'last' });
            assert.equal(request.viewMode, 'draft');
            assert.equal(request.clientTimeZone, 'Asia/Tokyo');
            assert.deepEqual(request.miniExtStorageV4, {
                visitor: 'original-session',
            });
        }
        assert.deepEqual(input.context.localStorageRecord, {
            fld_title: 'newer-draft',
        });
        assert.deepEqual(client.getSession(), { visitor: 'new-session' });
    });
    it('gives mutating native adapters a fresh body without replaying injected host context', async () => {
        const bodies: LoadExtensionInput[] = [];
        await loadExtensionWithCapabilities({
            input: loadInput,
            isCurrent: () => true,
            provider: createCachedDeviceFingerprintProvider(() => identity),
            transport: async (input) => {
                bodies.push(structuredClone(input));
                input.query = { hostInjected: 'first-only' };
                return bodies.length === 1 ? limited() : formResult;
            },
        });
        assert.deepEqual(bodies[0].query, loadInput.query);
        assert.deepEqual(bodies[1].query, loadInput.query);
        assert.deepEqual(loadInput.query, {
            prefill_Title: 'Example',
            repeated: ['First', 'Second'],
        });
    });
    it('shares provider provenance through load, allocated Compute and Save and drops it after edit', async () => {
        let collections = 0;
        const provider = createCachedDeviceFingerprintProvider(() => {
            collections++;
            return identity;
        });
        const { client, requests } = harness(() => limited());
        await loadExtensionWithCapabilities({
            client,
            input: loadInput,
            provider,
            isCurrent: () => true,
        });
        for (const isComputeMode of [true, false]) {
            const form = limited().payload;
            await client.forms.save({
                ...saveInput,
                isComputeMode,
                deviceFingerprint: requiresFormDeviceFingerprint(
                    saveInput.context,
                    form
                )
                    ? await getDeviceFingerprint(provider)
                    : undefined,
            });
        }
        const edited = limited().payload;
        edited.formRecord = {
            type: 'edit',
            recordId: 'rec_example',
            tableId: 'table_example',
            data: {},
        };
        await client.forms.save({
            ...saveInput,
            formRecord: edited.formRecord,
            deviceFingerprint: requiresFormDeviceFingerprint(
                saveInput.context,
                edited
            )
                ? await getDeviceFingerprint(provider)
                : undefined,
        });
        assert.equal(collections, 1);
        assert.deepEqual(
            requests.slice(1, 4).map((request) => request.deviceFingerprint),
            [identity, identity, identity]
        );
        assert.equal(requests[4].deviceFingerprint, undefined);
    });
});

describe('load retirement never owns shared provider work', () => {
    for (const mode of ['abort', 'ABA', 'unmount']) {
        for (const wait of ['before', 'first', 'provider', 'second']) {
            it(`${mode} at ${wait} suppresses remaining work and final publication`, async () => {
                const held = deferred<LoadExtensionResult>();
                const heldProvider = deferred<unknown>();
                const entered = deferred<void>();
                const controller = new AbortController();
                let epoch = 1;
                let mounted = true;
                let collections = 0;
                let requests = 0;
                const published: LoadExtensionResult[] = [];
                const retire = () => {
                    if (mode === 'abort') controller.abort();
                    if (mode === 'ABA') {
                        epoch++;
                        epoch++;
                    }
                    if (mode === 'unmount') mounted = false;
                };
                if (wait === 'before') retire();
                const loading = loadExtensionWithCapabilities({
                    input: loadInput,
                    signal: controller.signal,
                    isCurrent: () => mounted && epoch === 1,
                    provider: createCachedDeviceFingerprintProvider(() => {
                        collections++;
                        if (wait === 'provider') {
                            entered.resolve();
                            return heldProvider.promise;
                        }
                        return identity;
                    }),
                    transport: async () => {
                        requests++;
                        if (
                            (wait === 'first' && requests === 1) ||
                            (wait === 'second' && requests === 2)
                        ) {
                            entered.resolve();
                            return held.promise;
                        }
                        return limited();
                    },
                    publish: (result) => published.push(result),
                });
                const rejection = assert.rejects(loading, retiredError);
                if (wait !== 'before') {
                    await entered.promise;
                    retire();
                    held.resolve(limited());
                    heldProvider.resolve(identity);
                }
                await rejection;
                assert.deepEqual(published, []);
                assert.equal(
                    requests,
                    wait === 'before' ? 0 : wait === 'second' ? 2 : 1
                );
                assert.equal(
                    collections,
                    wait === 'provider' || wait === 'second' ? 1 : 0
                );
            });
        }
    }
    it('one retired caller cannot cancel a current load or clear their shared success', async () => {
        const collection = deferred<unknown>();
        const entered = deferred<void>();
        let collections = 0;
        const provider = createCachedDeviceFingerprintProvider(() => {
            collections++;
            entered.resolve();
            return collection.promise;
        });
        const first = harness(() => limited());
        const second = harness(() => limited());
        const controller = new AbortController();
        const retired = loadExtensionWithCapabilities({
            client: first.client,
            input: loadInput,
            provider,
            signal: controller.signal,
            isCurrent: () => true,
        });
        const rejection = assert.rejects(retired, retiredError);
        const current = loadExtensionWithCapabilities({
            client: second.client,
            input: loadInput,
            provider,
            isCurrent: () => true,
        });
        await entered.promise;
        controller.abort();
        collection.resolve(identity);
        await rejection;
        await current;
        assert.equal(first.requests.length, 1);
        assert.equal(second.requests.length, 2);
        assert.equal(collections, 1);
        assert.deepEqual(await getDeviceFingerprint(provider), identity);
    });
});

for (const stage of ['first', 'provider', 'final']) {
    for (const retired of [false, true]) {
        it(`preserves ${stage} rejection semantics while ${retired ? 'retired' : 'current'}`, async () => {
            const failure = new Error('synthetic boundary failure');
            const held = deferred<never>();
            const entered = deferred<void>();
            let current = true;
            let requests = 0;
            let published = 0;
            const loading = loadExtensionWithCapabilities({
                input: loadInput,
                session: { visitor: 'native-session' },
                isCurrent: () => current,
                transport: async (_input, options) => {
                    assert.deepEqual(options.session, {
                        visitor: 'native-session',
                    });
                    requests++;
                    if (
                        stage === 'first' ||
                        (stage === 'final' && requests === 2)
                    ) {
                        entered.resolve();
                        return held.promise;
                    }
                    return limited();
                },
                provider: createCachedDeviceFingerprintProvider(() => {
                    if (stage === 'provider') {
                        entered.resolve();
                        return held.promise;
                    }
                    return identity;
                }),
                publish: () => {
                    published++;
                },
            });
            const expected = retired
                ? retiredError
                : stage === 'provider'
                  ? capabilityError
                  : (error: unknown) => error === failure;
            const rejection = assert.rejects(loading, expected);
            await entered.promise;
            if (retired) current = false;
            held.reject(failure);
            await rejection;
            assert.equal(requests, stage === 'final' ? 2 : 1);
            assert.equal(published, 0);
        });
    }
}

it('captures provider accessors once and never exposes a mutable cached identity', async () => {
    let reads = 0;
    const provider = createCachedDeviceFingerprintProvider(() => ({
        version: 1,
        get visitorId() {
            reads++;
            return reads === 1 ? identity.visitorId : 'invalid';
        },
    }));
    const result = await provider.getFingerprint();
    assert.ok(Object.isFrozen(result));
    assert.deepEqual(await getDeviceFingerprint(provider), identity);
    assert.equal(reads, 1);
});
