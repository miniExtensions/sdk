import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { realpathSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Original installed archive only; synthetic credentials and read responses, no live authentication. */
export async function checkSessionRestoration({
    consumerDirectory,
    authPage,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const root = realpathSync(
        join(consumerDirectory, 'node_modules/@miniextensions/sdk')
    );
    const authPath = require.resolve('@miniextensions/sdk/auth');
    assert.ok(realpathSync(authPath).startsWith(`${root}/dist/cjs/`));
    const auth = await import(
        pathToFileURL(join(root, 'dist/esm/auth/index.js')).href
    );
    const runtime = await import(
        pathToFileURL(join(root, 'dist/esm/runtime/index.js')).href
    );
    assert.equal(
        typeof require('@miniextensions/sdk/auth').createSessionRestoration,
        'function'
    );
    const page = {
        ...authPage,
        extensionScreen: 'login_page',
        payload: {
            ...authPage.payload,
            shareId: 'share_example',
            tableId: 'table_example',
            loginFieldNames: ['Émail', 'Password'],
        },
    };
    const input = {
        shareId: 'share_example',
        recordId: null,
        query: {},
        context: { type: 'direct-url' },
    };
    const accepted = { ...authPage, extensionScreen: 'portal_loaded' };
    const store = () => {
        const data = new Map();
        const listeners = new Set();
        return {
            data,
            storage: {
                mode: 'persistent',
                getItem: (key) => data.get(key) ?? null,
                setItem: (key, value) => data.set(key, value),
                removeItem: (key) => data.delete(key),
                subscribe(listener) {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
            },
            emit(key) {
                for (const fn of [...listeners]) fn(key);
            },
        };
    };
    const setup = (shared = store(), overrides = {}) => {
        const client = runtime.createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async () => {
                throw new Error('Unexpected network');
            },
        });
        let scope = { ownerId: 'a', revision: 0 };
        let reads = 0;
        client.auth.login = async () => ({
            type: 'found-record',
            encryptedLoginToken: 'SYNTHETIC_ENCRYPTED_LOGIN',
        });
        client.loadExtension = async (_input, options) => {
            reads += 1;
            assert.ok(
                Object.values(options.session).includes(
                    'SYNTHETIC_ENCRYPTED_LOGIN'
                )
            );
            return structuredClone(accepted);
        };
        const owner = auth.createSessionRestoration({
            client,
            page,
            apiOrigin: 'https://sdk.example.test',
            context: 'share_example',
            loadInput: input,
            storage: shared.storage,
            getScope: () => scope,
            ...overrides,
        });
        return {
            client,
            owner,
            shared,
            reads: () => reads,
            replace() {
                scope = { ownerId: 'a', revision: 2 };
                return { ...scope };
            },
        };
    };
    const remember = async (f) => {
        const result = await f.owner.flow.login({
            loginCredentials: { Password: 'RAW_PASSWORD_NOT_STORED' },
        });
        f.owner.applySession(result.grant);
        assert.deepEqual(JSON.parse([...f.shared.data.values()][0]), {
            version: 1,
            credential: 'SYNTHETIC_ENCRYPTED_LOGIN',
        });
    };
    let checks = 0;
    for (const action of ['clear', 'destroy']) {
        for (const operation of ['apply', 'restore']) {
            const seed = setup();
            await remember(seed);
            const f = setup(seed.shared);
            const setter = f.client.setSession;
            let entered = false;
            f.client.setSession = (value) => {
                setter(value);
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
                const result = await f.owner.flow.login({
                    loginCredentials: { Password: 'SYNTHETIC' },
                });
                f.owner.applySession(result.grant);
            }
            assert.equal(f.owner.getSnapshot().phase, 'retired');
            if (action === 'clear') {
                assert.equal(f.shared.data.size, 0);
                assert.deepEqual(f.client.getSession(), {});
            } else assert.equal(f.shared.data.size, 1);
            seed.owner.destroy();
            f.owner.destroy();
            checks += 1;
        }
    }
    {
        const f = setup();
        await remember(f);
        const scope = f.replace();
        const successor = f.owner.handoff(accepted, scope, () => true);
        assert.ok(successor);
        f.owner.clear();
        f.owner.destroy();
        assert.equal(f.shared.data.size, 1);
        successor.clear();
        assert.equal(f.shared.data.size, 0);
        assert.deepEqual(f.client.getSession(), {});
        assert.equal(await setup(f.shared).owner.restore(), null);
        checks += 1;
    }
    {
        const seed = setup();
        await remember(seed);
        const f = setup(seed.shared);
        const key = [...f.shared.data.keys()][0];
        const replacement = JSON.stringify({
            version: 1,
            credential: 'SYNTHETIC_NEWER',
        });
        f.client.loadExtension = async () => {
            f.shared.data.set(key, replacement);
            return page;
        };
        assert.equal(await f.owner.restore(), null);
        assert.equal(f.shared.data.get(key), replacement);
        assert.deepEqual(f.client.getSession(), {});
        seed.owner.destroy();
        f.owner.destroy();
        checks += 1;
    }

    for (const replace of [false, true]) {
        const seed = setup();
        await remember(seed);
        const f = setup(seed.shared);
        let resolve;
        f.client.loadExtension = () =>
            new Promise((done) => {
                resolve = done;
            });
        const pending = f.owner.restore();
        const key = [...f.shared.data.keys()][0];
        const newer = JSON.stringify({
            version: 1,
            credential: 'SYNTHETIC_NEWER',
        });
        if (replace) f.shared.data.set(key, newer);
        f.owner.clear();
        resolve(accepted);
        assert.equal(await pending, null);
        assert.equal(f.owner.getSnapshot().phase, 'retired');
        assert.deepEqual(f.client.getSession(), {});
        if (replace) assert.equal(f.shared.data.get(key), newer);
        else assert.equal(f.shared.data.size, 0);
        seed.owner.destroy();
        checks += 1;
    }
    {
        const seed = setup();
        await remember(seed);
        const f = setup(seed.shared);
        f.client.auth.login = async () => ({
            type: 'found-record',
            encryptedLoginToken: 'SYNTHETIC_NEW_CREDENTIAL',
        });
        const get = f.shared.storage.getItem,
            set = f.shared.storage.setItem;
        let deny = false;
        f.shared.storage.getItem = (k) => {
            if (deny) throw new Error('denied');
            return get(k);
        };
        f.shared.storage.setItem = (k, v) => {
            set(k, v);
            deny = true;
        };
        const result = await f.owner.flow.login({
            loginCredentials: { Password: 'SYNTHETIC' },
        });
        f.owner.applySession(result.grant);
        assert.equal(f.owner.getSnapshot().phase, 'storage-unavailable');
        deny = false;
        f.owner.clear();
        assert.equal(f.shared.data.size, 0);
        assert.deepEqual(f.client.getSession(), {});
        seed.owner.destroy();
        checks += 1;
    }
    for (const replace of [false, true]) {
        const seed = setup();
        await remember(seed);
        const f = setup(seed.shared);
        f.client.auth.login = async () => ({
            type: 'found-record',
            encryptedLoginToken: 'SYNTHETIC_NEW_CREDENTIAL',
        });
        const set = f.shared.storage.setItem;
        f.shared.storage.setItem = () => {
            throw new Error('denied');
        };
        const result = await f.owner.flow.login({
            loginCredentials: { Password: 'SYNTHETIC' },
        });
        f.owner.applySession(result.grant);
        f.shared.storage.setItem = set;
        const lease = f.owner.handoff(accepted, f.replace(), () => true);
        assert.ok(lease);
        const key = [...f.shared.data.keys()][0],
            newer = JSON.stringify({
                version: 1,
                credential: 'SYNTHETIC_THIRD',
            });
        if (replace) f.shared.data.set(key, newer);
        lease.clear();
        if (replace) assert.equal(f.shared.data.get(key), newer);
        else assert.equal(f.shared.data.size, 0);
        assert.deepEqual(f.client.getSession(), {});
        seed.owner.destroy();
        checks += 1;
    }
    const first = setup();
    await remember(first);
    checks += 1;
    const key = [...first.shared.data.keys()][0];
    // Unicode canonical key authority is shared with the existing runtime helper.
    const canonicalKey = Object.keys(
        runtime.withLoginToken(
            {},
            {
                extensionId: page.extensionId,
                tableId: page.payload.tableId,
                loginFieldNames: page.payload.loginFieldNames,
                encryptedLoginToken: 'key-only',
            }
        )
    )[0];
    const canonical = JSON.parse(
        readFileSync('test/fixtures/sessionRestorationCanonical.json', 'utf8')
    );
    assert.equal(canonicalKey, canonical.result.key);
    assert.deepEqual(
        JSON.parse(key.slice('miniExtensions-sdk-session-v1:'.length)),
        [
            'https://sdk.example.test',
            'share_example',
            'share_example',
            canonicalKey,
        ]
    );
    assert.ok(
        !JSON.stringify([...first.shared.data]).includes(
            'RAW_PASSWORD_NOT_STORED'
        )
    );
    const fresh = setup(first.shared);
    let notifications = 0;
    fresh.owner.subscribe(() => {
        notifications += 1;
    });
    assert.equal(fresh.reads(), 0);
    assert.deepEqual(fresh.client.getSession(), {});
    assert.deepEqual(await fresh.owner.restore(), accepted);
    assert.equal(fresh.reads(), 1);
    assert.equal(fresh.owner.getSnapshot().phase, 'restored');
    assert.ok(notifications >= 2);
    checks += 1;
    fresh.owner.clear();
    assert.equal(first.shared.data.size, 0);
    assert.deepEqual(fresh.client.getSession(), {});
    checks += 1;
    const retry = setup();
    await remember(retry);
    const retryFresh = setup(retry.shared);
    let attempts = 0;
    retryFresh.client.loadExtension = async () => {
        attempts += 1;
        throw new Error('private error');
    };
    assert.equal(await retryFresh.owner.restore(), null);
    assert.equal(attempts, 1);
    assert.equal(retryFresh.owner.getSnapshot().phase, 'error');
    assert.equal(retry.shared.data.size, 1);
    checks += 1;
    retryFresh.client.loadExtension = async () => structuredClone(page);
    assert.equal(await retryFresh.owner.restore(), null);
    assert.equal(retry.shared.data.size, 0);
    checks += 1;
    for (const raw of [
        'bad json',
        '{"version":1,"credential":""}',
        '{"version":1,"credential":"token","otp":"secret"}',
    ]) {
        const f = setup();
        await remember(f);
        f.shared.data.set([...f.shared.data.keys()][0], raw);
        const next = setup(f.shared);
        assert.equal(await next.owner.restore(), null);
        assert.equal(next.reads(), 0);
        assert.equal(f.shared.data.size, 0);
    }
    checks += 1;
    const heldOwner = setup();
    await remember(heldOwner);
    const held = setup(heldOwner.shared);
    let resolve;
    held.client.loadExtension = () =>
        new Promise((accept) => {
            resolve = accept;
        });
    const pending = held.owner.restore();
    held.replace();
    held.client.setSession({ successor: 'SYNTHETIC_SUCCESSOR' });
    resolve(accepted);
    assert.equal(await pending, null);
    assert.deepEqual(held.client.getSession(), {
        successor: 'SYNTHETIC_SUCCESSOR',
    });
    checks += 1;
    const loggedOut = setup();
    await remember(loggedOut);
    const other = setup(loggedOut.shared);
    await other.owner.restore();
    loggedOut.owner.clear();
    loggedOut.shared.emit([...other.shared.data.keys()][0] ?? null);
    assert.deepEqual(other.client.getSession(), {});
    assert.equal(other.owner.getSnapshot().phase, 'retired');
    checks += 1;
    const denied = store();
    denied.storage.setItem = () => {
        throw new Error('denied');
    };
    const deniedOwner = setup(denied);
    const grant = await deniedOwner.owner.flow.login({ loginCredentials: {} });
    deniedOwner.owner.applySession(grant.grant);
    assert.equal(deniedOwner.owner.getSnapshot().phase, 'storage-unavailable');
    assert.ok(
        Object.values(deniedOwner.client.getSession()).includes(
            'SYNTHETIC_ENCRYPTED_LOGIN'
        )
    );
    checks += 1;
    const source = setup();
    await remember(source);
    const isolated = setup(source.shared, { context: 'other_share' });
    assert.equal(await isolated.owner.restore(), null);
    assert.equal(isolated.reads(), 0);
    checks += 1;
    const disposal = setup();
    const result = await disposal.owner.flow.login({ loginCredentials: {} });
    const set = disposal.client.setSession;
    disposal.client.setSession = (session) => {
        set(session);
        disposal.owner.destroy();
    };
    disposal.owner.applySession(result.grant);
    assert.equal(disposal.shared.data.size, 0);
    checks += 1;
    const reentrySeed = setup();
    await remember(reentrySeed);
    const reentry = setup(reentrySeed.shared);
    let accept;
    reentry.client.loadExtension = () =>
        new Promise((resolve) => {
            accept = resolve;
        });
    const late = reentry.owner.restore();
    const get = reentry.client.getSession;
    let once = true;
    reentry.client.getSession = () => {
        if (once) {
            once = false;
            reentry.replace();
            reentry.client.setSession({ successor: 'SYNTHETIC_SUCCESSOR' });
        }
        return get();
    };
    accept(accepted);
    assert.equal(await late, null);
    assert.deepEqual(reentry.client.getSession(), {
        successor: 'SYNTHETIC_SUCCESSOR',
    });
    checks += 1;
    // Browser bridge executes against explicit local DOM storage, never real user storage.
    const { Window } = await import(pathToFileURL(happyDomModulePath).href);
    const window = new Window({ url: 'https://consumer.example.test' });
    const backend = auth.createBrowserSessionStorage(
        window.localStorage,
        'persistent',
        window
    );
    let eventKey;
    const detach = backend.subscribe((changed) => {
        eventKey = changed;
    });
    backend.setItem('synthetic', 'value');
    assert.equal(backend.getItem('synthetic'), 'value');
    window.dispatchEvent(
        new window.StorageEvent('storage', {
            key: 'synthetic',
            storageArea: window.localStorage,
        })
    );
    assert.equal(eventKey, 'synthetic');
    detach();
    eventKey = null;
    window.dispatchEvent(
        new window.StorageEvent('storage', {
            key: 'other',
            storageArea: window.localStorage,
        })
    );
    assert.equal(eventKey, null);
    backend.removeItem('synthetic');
    assert.equal(backend.getItem('synthetic'), null);
    await window.happyDOM.abort();
    checks += 1;
    for (const f of [
        first,
        fresh,
        retry,
        retryFresh,
        heldOwner,
        held,
        loggedOut,
        other,
        deniedOwner,
        source,
        isolated,
        disposal,
        reentrySeed,
        reentry,
    ])
        f.owner.destroy();
    console.log(
        `Installed session restoration: ${checks} synthetic refresh/storage/ownership checkpoints passed (no live auth or mutation replay).`
    );
    return checks;
}
