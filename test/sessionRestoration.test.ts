import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { withLoginToken } from '../src/runtime/index.js';
import {
    createSessionRestoration,
    type SessionRestorationStorage,
} from '../src/auth/index.js';
import {
    authFixture,
    deferred,
    loginPage,
    passwordPage,
} from './authFixtures.js';
import {
    formResult,
    loadInput as fixtureLoadInput,
} from './runtimeFixtures.js';
if (!('shareId' in fixtureLoadInput)) throw new Error('Root fixture required');
const loadInput = fixtureLoadInput;

const memory = (mode: 'tab' | 'persistent' = 'tab') => {
    const data = new Map<string, string>();
    const listeners = new Set<(key: string | null) => void>();
    const storage: SessionRestorationStorage = {
        mode,
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
            data.set(key, value);
        },
        removeItem: (key) => {
            data.delete(key);
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
    return {
        storage,
        data,
        emit(key: string | null) {
            for (const listener of [...listeners]) listener(key);
        },
    };
};
const setup = (store = memory(), page = loginPage()) => {
    const fixture = authFixture();
    let scope = { ownerId: 'visitor-a', revision: 0 };
    const owner = createSessionRestoration({
        client: fixture.client,
        page,
        loadInput,
        apiOrigin: 'https://sdk.example.test',
        context: 'share_example',
        storage: store.storage,
        getScope: () => scope,
    });
    return {
        ...fixture,
        owner,
        store,
        replace() {
            scope = { ownerId: 'visitor-b', revision: 1 };
        },
        aba() {
            scope = { ownerId: 'visitor-a', revision: 2 };
        },
    };
};
const remember = async (fixture: ReturnType<typeof setup>) => {
    assert.equal(fixture.owner.flow.screen, 'login_page');
    if (fixture.owner.flow.screen !== 'login_page') throw new Error();
    const result = await fixture.owner.flow.login({
        loginCredentials: { Password: 'RAW_SECRET_NOT_STORED' },
    });
    assert.equal(result.type, 'found-record');
    if (result.type !== 'found-record') throw new Error();
    fixture.owner.applySession(result.grant);
};

describe('explicit canonical-scoped session restoration', () => {
    it('setter clear/destroy reentry cannot publish restored or remember after retirement', async () => {
        for (const action of ['clear', 'destroy'] as const) {
            for (const operation of ['apply', 'restore'] as const) {
                const original = setup();
                await remember(original);
                const f = setup(original.store);
                f.client.loadExtension = async () =>
                    structuredClone(formResult);
                const setter = f.client.setSession;
                let entered = false;
                f.client.setSession = (next) => {
                    setter(next);
                    if (!entered) {
                        entered = true;
                        f.owner[action]();
                    }
                };
                if (operation === 'restore')
                    assert.equal(await f.owner.restore(), null);
                else {
                    f.client.auth.login = async () => ({
                        type: 'found-record',
                        encryptedLoginToken: 'SYNTHETIC_NEW_CREDENTIAL',
                    });
                    if (f.owner.flow.screen !== 'login_page') throw new Error();
                    const result = await f.owner.flow.login({
                        loginCredentials: { Password: 'SYNTHETIC' },
                    });
                    if (result.type !== 'found-record') throw new Error();
                    f.owner.applySession(result.grant);
                }
                assert.equal(f.owner.getSnapshot().phase, 'retired');
                if (action === 'clear') {
                    assert.equal(f.store.data.size, 0);
                    assert.deepEqual(f.client.getSession(), {
                        previous: 'encrypted_previous',
                    });
                } else assert.equal(f.store.data.size, 1);
            }
        }
    });
    it('logout clears its written credential even when write verification failed', async () => {
        const seed = setup();
        await remember(seed);
        const f = setup(seed.store);
        f.client.auth.login = async () => ({
            type: 'found-record',
            encryptedLoginToken: 'SYNTHETIC_NEW_CREDENTIAL',
        });
        const get = f.store.storage.getItem;
        const set = f.store.storage.setItem;
        let deny = false;
        f.store.storage.getItem = (k) => {
            if (deny) throw new Error('denied');
            return get(k);
        };
        f.store.storage.setItem = (k, v) => {
            set(k, v);
            deny = true;
        };
        if (f.owner.flow.screen !== 'login_page') throw new Error();
        const result = await f.owner.flow.login({
            loginCredentials: { Password: 'SYNTHETIC' },
        });
        if (result.type !== 'found-record') throw new Error();
        f.owner.applySession(result.grant);
        assert.equal(f.owner.getSnapshot().phase, 'storage-unavailable');
        deny = false;
        f.owner.clear();
        assert.equal(f.store.data.size, 0);
        assert.deepEqual(f.client.getSession(), {
            previous: 'encrypted_previous',
        });
    });
    it('accepted root handoff preserves logout while retained old methods cannot touch the successor', async () => {
        const fixture = authFixture();
        const store = memory();
        let scope = { ownerId: 'visitor-a', revision: 0 };
        const owner = createSessionRestoration({
            client: fixture.client,
            page: loginPage(),
            loadInput,
            apiOrigin: 'https://sdk.example.test',
            context: 'share_example',
            storage: store.storage,
            getScope: () => scope,
        });
        if (owner.flow.screen !== 'login_page') throw new Error();
        const result = await owner.flow.login({
            loginCredentials: { Password: 'SYNTHETIC' },
        });
        if (result.type !== 'found-record') throw new Error();
        owner.applySession(result.grant);
        scope = { ownerId: 'visitor-a', revision: 1 };
        assert.equal(
            owner.handoff(formResult, scope, () => false),
            null
        );
        const successor = owner.handoff(formResult, { ...scope }, () => true);
        assert.ok(successor);
        owner.clear();
        owner.destroy();
        assert.equal(store.data.size, 1);
        assert.equal(successor.getSnapshot().phase, 'idle');
        successor.clear();
        assert.equal(store.data.size, 0);
        assert.deepEqual(fixture.client.getSession(), {
            previous: 'encrypted_previous',
        });
        assert.equal(await setup(store).owner.restore(), null);
    });
    it('accepted-load handoff retains exact storage ownership after denied remembering', async () => {
        for (const replace of [false, true]) {
            const seed = setup();
            await remember(seed);
            const f = authFixture();
            let scope = { ownerId: 'a', revision: 0 };
            const owner = createSessionRestoration({
                client: f.client,
                page: loginPage(),
                loadInput,
                apiOrigin: 'https://sdk.example.test',
                context: 'share_example',
                storage: seed.store.storage,
                getScope: () => scope,
            });
            f.client.auth.login = async () => ({
                type: 'found-record',
                encryptedLoginToken: 'SYNTHETIC_NEW_CREDENTIAL',
            });
            const set = seed.store.storage.setItem;
            seed.store.storage.setItem = () => {
                throw new Error('denied');
            };
            if (owner.flow.screen !== 'login_page') throw new Error();
            const result = await owner.flow.login({
                loginCredentials: { Password: 'SYNTHETIC' },
            });
            if (result.type !== 'found-record') throw new Error();
            owner.applySession(result.grant);
            seed.store.storage.setItem = set;
            scope = { ownerId: 'a', revision: 1 };
            const lease = owner.handoff(formResult, { ...scope }, () => true);
            assert.ok(lease);
            const key = [...seed.store.data.keys()][0];
            const newer = JSON.stringify({
                version: 1,
                credential: 'SYNTHETIC_THIRD',
            });
            if (replace) seed.store.data.set(key, newer);
            lease.clear();
            if (replace) assert.equal(seed.store.data.get(key), newer);
            else assert.equal(seed.store.data.size, 0);
            assert.deepEqual(f.client.getSession(), {
                previous: 'encrypted_previous',
            });
        }
    });
    it('logout during held validation removes only the observed remembered envelope', async () => {
        for (const replace of [false, true]) {
            const original = setup();
            await remember(original);
            const f = setup(original.store);
            const held = deferred<typeof formResult>();
            f.client.loadExtension = async () => held.promise;
            const pending = f.owner.restore();
            const key = [...f.store.data.keys()][0];
            const newer = JSON.stringify({
                version: 1,
                credential: 'SYNTHETIC_NEWER',
            });
            if (replace) f.store.data.set(key, newer);
            f.owner.clear();
            held.resolve(structuredClone(formResult));
            assert.equal(await pending, null);
            assert.equal(f.owner.getSnapshot().phase, 'retired');
            assert.deepEqual(f.client.getSession(), {
                previous: 'encrypted_previous',
            });
            if (replace) assert.equal(f.store.data.get(key), newer);
            else assert.equal(f.store.data.size, 0);
        }
    });
    it('rejected restoration preserves a newer stored credential before its cross-tab event', async () => {
        const original = setup();
        await remember(original);
        const f = setup(original.store);
        const key = [...f.store.data.keys()][0];
        const replacement = JSON.stringify({
            version: 1,
            credential: 'SYNTHETIC_SUCCESSOR',
        });
        f.client.loadExtension = async () => {
            f.store.data.set(key, replacement);
            return loginPage();
        };
        assert.equal(await f.owner.restore(), null);
        assert.equal(f.store.data.get(key), replacement);
        assert.deepEqual(f.client.getSession(), {
            previous: 'encrypted_previous',
        });
    });

    it('matches the executed pinned canonical key and committed expiry/logout provenance', () => {
        const fixture = JSON.parse(
            readFileSync(
                'test/fixtures/sessionRestorationCanonical.json',
                'utf8'
            )
        );
        assert.equal(
            fixture.canonicalRevision,
            '58f73d575ab10baa0a10693660d8002f204368e1'
        );
        assert.equal(
            fixture.generatorSha256,
            createHash('sha256')
                .update(
                    readFileSync(
                        'scripts/generate-session-restoration-fixtures.mjs'
                    )
                )
                .digest('hex')
        );
        assert.equal(fixture.sources.length, 2);
        for (const source of fixture.sources)
            assert.match(source.sha256, /^[0-9a-f]{64}$/);
        const key = Object.keys(
            withLoginToken(
                {},
                {
                    extensionId: fixture.input.extensionId,
                    tableId: fixture.input.tableId,
                    loginFieldNames: fixture.input.fieldNames,
                    encryptedLoginToken: 'key-only',
                }
            )
        )[0];
        assert.equal(key, fixture.result.key);
        assert.deepEqual(fixture.result.remembered, {
            [key]: 'SYNTHETIC_ENCRYPTED_LOGIN',
        });
        assert.deepEqual(
            fixture.result.afterExpired,
            fixture.result.remembered
        );
        assert.deepEqual(fixture.result.otherContext, {});
        assert.deepEqual(fixture.result.afterLogout, {});
    });
    it('setter disposal after grant application cannot persist a retired credential', async () => {
        const f = setup();
        if (f.owner.flow.screen !== 'login_page') throw new Error();
        const result = await f.owner.flow.login({ loginCredentials: {} });
        if (result.type !== 'found-record') throw new Error();
        const set = f.client.setSession;
        f.client.setSession = (session) => {
            set(session);
            f.owner.destroy();
        };
        f.owner.applySession(result.grant);
        assert.equal(f.store.data.size, 0);
        assert.equal(f.owner.getSnapshot().phase, 'retired');
    });
    it('session getter scope reentry cannot commit a late credential into a successor', async () => {
        const original = setup();
        await remember(original);
        const f = setup(original.store);
        const held = deferred<typeof formResult>();
        f.client.loadExtension = async () => held.promise;
        const pending = f.owner.restore();
        const get = f.client.getSession;
        let once = true;
        f.client.getSession = () => {
            if (once) {
                once = false;
                f.replace();
                f.client.setSession({ successor: 'new_encrypted_credential' });
            }
            return get();
        };
        held.resolve(structuredClone(formResult));
        assert.equal(await pending, null);
        assert.deepEqual(f.client.getSession(), {
            successor: 'new_encrypted_credential',
        });
        assert.equal(f.owner.getSnapshot().phase, 'retired');
    });
    it('remembers only the accepted encrypted credential and validates a fresh read before committing after refresh', async () => {
        const original = setup();
        await remember(original);
        const serialized = [...original.store.data.values()][0];
        assert.deepEqual(JSON.parse(serialized), {
            version: 1,
            credential: 'encrypted_login_example',
        });
        assert.ok(
            !serialized.includes('RAW_SECRET') &&
                !serialized.includes('encrypted_previous')
        );
        const refreshed = setup(original.store);
        const held = deferred<typeof formResult>();
        let reads = 0;
        refreshed.client.loadExtension = async (input, options) => {
            reads += 1;
            assert.deepEqual(input, loadInput);
            assert.ok(
                Object.values(options?.session ?? {}).includes(
                    'encrypted_login_example'
                )
            );
            return held.promise;
        };
        assert.equal(reads, 0);
        const restoring = refreshed.owner.restore();
        assert.equal(refreshed.owner.getSnapshot().phase, 'restoring');
        assert.deepEqual(refreshed.client.getSession(), {
            previous: 'encrypted_previous',
        });
        assert.equal(await refreshed.owner.restore(), null);
        held.resolve(structuredClone(formResult));
        assert.deepEqual(await restoring, formResult);
        assert.equal(reads, 1);
        assert.ok(
            Object.values(refreshed.client.getSession()).includes(
                'encrypted_login_example'
            )
        );
        const snapshot = refreshed.owner.getSnapshot();
        snapshot.phase = 'error';
        assert.equal(refreshed.owner.getSnapshot().phase, 'restored');
    });
    it('revoked/expired credentials returning an auth prompt clear storage; transport failures require explicit retry', async () => {
        const original = setup();
        await remember(original);
        const retry = setup(original.store);
        let reads = 0;
        retry.client.loadExtension = async () => {
            reads += 1;
            throw new Error('sensitive transport message');
        };
        assert.equal(await retry.owner.restore(), null);
        assert.equal(retry.owner.getSnapshot().phase, 'error');
        assert.ok(
            !JSON.stringify(retry.owner.getSnapshot()).includes('sensitive')
        );
        assert.equal(reads, 1);
        assert.equal(original.store.data.size, 1);
        retry.client.loadExtension = async () => {
            reads += 1;
            return loginPage();
        };
        assert.equal(await retry.owner.restore(), null);
        assert.equal(reads, 2);
        assert.equal(original.store.data.size, 0);
        assert.equal(retry.owner.getSnapshot().phase, 'login-required');
        assert.deepEqual(retry.client.getSession(), {
            previous: 'encrypted_previous',
        });
    });
    it('visitor replacement and observed ABA reject late reads without touching successor state', async () => {
        for (const aba of [false, true]) {
            const original = setup();
            await remember(original);
            const refresh = setup(original.store);
            const held = deferred<typeof formResult>();
            refresh.client.loadExtension = async () => held.promise;
            const pending = refresh.owner.restore();
            refresh.replace();
            if (aba) refresh.aba();
            refresh.client.setSession({
                successor: 'new_encrypted_credential',
            });
            held.resolve(structuredClone(formResult));
            assert.equal(await pending, null);
            refresh.owner.clear();
            assert.deepEqual(refresh.client.getSession(), {
                successor: 'new_encrypted_credential',
            });
            assert.equal(refresh.owner.getSnapshot().phase, 'retired');
            assert.equal(original.store.data.size, 1);
        }
    });
    it('denied storage preserves memory login and reports failure without credential disclosure', async () => {
        const store = memory();
        store.storage.setItem = () => {
            throw new Error('denied');
        };
        const f = setup(store);
        await remember(f);
        assert.equal(f.owner.getSnapshot().phase, 'storage-unavailable');
        assert.ok(
            Object.values(f.client.getSession()).includes(
                'encrypted_login_example'
            )
        );
        store.storage.removeItem = () => {
            throw new Error('denied');
        };
        f.owner.clear();
        assert.deepEqual(f.client.getSession(), {
            previous: 'encrypted_previous',
        });
        assert.equal(f.owner.getSnapshot().phase, 'storage-unavailable');
        store.storage.getItem = () => {
            throw new Error('denied');
        };
        assert.equal(await setup(store).owner.restore(), null);
    });
    it('corrupt and non-allowlisted envelopes are removed without a request', async () => {
        for (const raw of [
            'invalid',
            'null',
            '[]',
            '{"version":1,"credential":""}',
            '{"version":1,"credential":"encrypted","password":"secret"}',
            '{"version":2,"credential":"encrypted"}',
        ]) {
            const original = setup();
            await remember(original);
            original.store.data.set([...original.store.data.keys()][0], raw);
            const f = setup(original.store);
            assert.equal(await f.owner.restore(), null);
            assert.equal(f.loads, 0);
            assert.equal(original.store.data.size, 0);
        }
    });
    it('context and origin namespaces isolate stored identities and input snapshots are detached', async () => {
        const original = setup();
        await remember(original);
        for (const change of [
            { context: 'other' },
            { apiOrigin: 'https://other.example.test' },
        ]) {
            const f = authFixture();
            const owner = createSessionRestoration({
                client: f.client,
                page: loginPage(),
                loadInput,
                apiOrigin: 'https://sdk.example.test',
                context: 'share_example',
                storage: original.store.storage,
                getScope: () => ({ ownerId: 'a', revision: 0 }),
                ...change,
            });
            assert.equal(await owner.restore(), null);
            assert.equal(f.loads, 0);
        }
        const f = authFixture();
        const input = structuredClone(loadInput);
        const page = loginPage();
        const owner = createSessionRestoration({
            client: f.client,
            page,
            loadInput: input,
            apiOrigin: 'https://sdk.example.test',
            context: 'share_example',
            storage: original.store.storage,
            getScope: () => ({ ownerId: 'a', revision: 0 }),
        });
        input.shareId = 'mutated';
        page.extensionId = 'mutated';
        f.client.loadExtension = async (actual) => {
            assert.deepEqual(actual, loadInput);
            return structuredClone(formResult);
        };
        assert.deepEqual(await owner.restore(), formResult);
    });
    it('persistent cross-tab logout aborts held validation and clears only the owned memory credential', async () => {
        const store = memory('persistent');
        const first = setup(store);
        await remember(first);
        const second = setup(store);
        const held = deferred<typeof formResult>();
        let signal: AbortSignal | undefined;
        second.client.loadExtension = async (_input, options) => {
            signal = options?.signal;
            return held.promise;
        };
        const pending = second.owner.restore();
        const key = [...store.data.keys()][0];
        first.owner.clear();
        store.emit(key);
        assert.equal(signal?.aborted, true);
        held.resolve(structuredClone(formResult));
        assert.equal(await pending, null);
        assert.deepEqual(second.client.getSession(), {
            previous: 'encrypted_previous',
        });
        assert.equal(second.owner.getSnapshot().phase, 'retired');
        const third = setup(store);
        await remember(third);
        store.emit(null);
        assert.deepEqual(third.client.getSession(), {
            previous: 'encrypted_previous',
        });
    });
    it('persistent mode fails closed without working change notification', async () => {
        const store = memory('persistent');
        delete store.storage.subscribe;
        assert.throws(() => setup(store), /cross-tab/);
        store.storage.subscribe = () => {
            throw new Error();
        };
        const f = setup(store);
        await remember(f);
        assert.equal(store.data.size, 0);
        assert.equal(await f.owner.restore(), null);
        assert.equal(f.loads, 0);
    });
    it('unmount preserves the remembered credential but late work and old grants cannot apply', async () => {
        const original = setup();
        await remember(original);
        original.owner.destroy();
        assert.equal(original.store.data.size, 1);
        const f = setup(original.store);
        const held = deferred<typeof formResult>();
        f.client.loadExtension = async () => held.promise;
        const pending = f.owner.restore();
        f.owner.destroy();
        held.resolve(structuredClone(formResult));
        assert.equal(await pending, null);
        assert.deepEqual(f.client.getSession(), {
            previous: 'encrypted_previous',
        });
        assert.equal(f.owner.getSnapshot().phase, 'retired');
    });
    it('password flow stores only the server encrypted credential, never entered password or access capability', async () => {
        const f = authFixture();
        const store = memory();
        const owner = createSessionRestoration({
            client: f.client,
            page: passwordPage(),
            loadInput,
            apiOrigin: 'https://sdk.example.test',
            context: 'share_example',
            storage: store.storage,
            getScope: () => ({ ownerId: 'a', revision: 0 }),
        });
        assert.equal(owner.flow.screen, 'password');
        if (owner.flow.screen !== 'password') throw new Error();
        const result = await owner.flow.verifyPassword({
            extensionPassword: 'RAW_PASSWORD',
        });
        if (result.type !== 'correct') throw new Error();
        owner.applySession(result.grant);
        assert.deepEqual(JSON.parse([...store.data.values()][0]), {
            version: 1,
            credential: 'encrypted_password_example',
        });
        owner.clear();
        assert.deepEqual(f.client.getSession(), {
            previous: 'encrypted_previous',
        });
    });
});
