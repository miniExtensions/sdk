import { createAuthFlow } from './flow.js';
import type {
    AuthCredentialGrant,
    AuthFlow,
    AuthOwnerScope,
    AuthPage,
} from './types.js';
import {
    copyVisitorSession,
    withExtensionPassword,
    withLoginToken,
} from '../runtime/session.js';
import type {
    LoadExtensionInput,
    LoadExtensionResult,
    MiniExtensionsClient,
    RuntimeSession,
} from '../runtime/types.js';

/** Explicitly supplied storage. Persistent implementations must report cross-tab changes. */
export type SessionRestorationStorage = {
    mode: 'tab' | 'persistent';
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    subscribe?(listener: (key: string | null) => void): () => void;
};
export type SessionRestorationSnapshot = {
    phase:
        | 'idle'
        | 'restoring'
        | 'restored'
        | 'login-required'
        | 'storage-unavailable'
        | 'error'
        | 'retired';
    message: string | null;
};
export type SessionRestorationOptions = {
    client: MiniExtensionsClient;
    page: AuthPage;
    /** Origin used to construct this client; the caller must supply it accurately. */
    apiOrigin: string;
    /** Canonical hosted context (first pathname segment), supplied explicitly by the app. */
    context: string;
    loadInput: Extract<LoadExtensionInput, { shareId: string }>;
    getScope(): AuthOwnerScope;
    storage: SessionRestorationStorage;
};
export type SessionRestorationLease = {
    getSnapshot(): SessionRestorationSnapshot;
    subscribe(listener: () => void): () => void;
    clear(): void;
    destroy(): void;
    handoff(
        page: LoadExtensionResult,
        scope: AuthOwnerScope,
        isCurrent: () => boolean
    ): SessionRestorationLease | null;
};
export type SessionRestoration = {
    readonly flow: AuthFlow;
    getSnapshot(): SessionRestorationSnapshot;
    subscribe(listener: () => void): () => void;
    /** Apply a grant owned by this adapter's flow and remember only its encrypted credential. */
    applySession(grant: AuthCredentialGrant): void;
    /** Explicit fresh read; never retries a mutation or applies credentials before validation. */
    restore(): Promise<LoadExtensionResult | null>;
    /** Logout/disconnect: remove the scoped stored credential and its still-owned memory entry. */
    clear(): void;
    /** Explicit accepted-root-load ownership transfer; old methods become inert. */
    handoff(
        page: LoadExtensionResult,
        scope: AuthOwnerScope,
        isCurrent: () => boolean
    ): SessionRestorationLease | null;
    /** Unmount alone does not log out. */
    destroy(): void;
};

const sameSession = (a: RuntimeSession, b: RuntimeSession) =>
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => a[key] === b[key] && Object.hasOwn(b, key));

const createSessionRestorationInternal = (
    options: SessionRestorationOptions,
    inheritedStored?: { observed: string | null; attempted: string | null }
): SessionRestoration => {
    const { client, storage, getScope } = options;
    const context = options.context;
    const page = structuredClone(options.page);
    const input = structuredClone(options.loadInput);
    if (
        typeof input.shareId !== 'string' ||
        !input.shareId ||
        input.context.type !== 'direct-url'
    )
        throw new TypeError(
            'Restoration requires an explicit root share load.'
        );
    if (
        page.extensionScreen === 'login_page' &&
        page.payload.shareId !== input.shareId
    )
        throw new TypeError('The login page and root share must match.');
    const origin = new URL(options.apiOrigin);
    if (
        origin.origin !== options.apiOrigin ||
        !['http:', 'https:'].includes(origin.protocol) ||
        typeof options.context !== 'string' ||
        options.context.length === 0
    )
        throw new TypeError(
            'An exact API origin and explicit nonempty context are required.'
        );
    if (
        !['tab', 'persistent'].includes(storage.mode) ||
        (storage.mode === 'persistent' &&
            typeof storage.subscribe !== 'function')
    )
        throw new TypeError(
            'Persistent storage requires cross-tab change notification.'
        );
    const initialScope = { ...getScope() };
    if (
        typeof initialScope.ownerId !== 'string' ||
        !initialScope.ownerId ||
        !Number.isSafeInteger(initialScope.revision) ||
        initialScope.revision < 0
    )
        throw new TypeError('An owner and monotonic revision are required.');
    const placeholder =
        page.extensionScreen === 'login_page'
            ? withLoginToken(
                  {},
                  {
                      extensionId: page.extensionId,
                      tableId: page.payload.tableId,
                      loginFieldNames: page.payload.loginFieldNames,
                      encryptedLoginToken: 'key-only',
                  }
              )
            : withExtensionPassword(
                  {},
                  {
                      extensionId: page.extensionId,
                      encryptedExtensionPassword: 'key-only',
                  }
              );
    const credentialKey = Object.keys(placeholder)[0];
    const storageKey = `miniExtensions-sdk-session-v1:${JSON.stringify([origin.origin, context, input.shareId, credentialKey])}`;
    let expectedSession = copyVisitorSession(client.getSession());
    let ownedCredential: string | null = expectedSession[credentialKey] ?? null;
    let observedStored: string | null = inheritedStored?.observed ?? null;
    let attemptedStored: string | null = inheritedStored?.attempted ?? null;
    let retired = false;
    let generation = 0;
    let request: AbortController | null = null;
    let writing = false;
    let storageReady = true;
    let checkingFreshness = false;
    let unsubscribe = () => {};
    let snapshot: SessionRestorationSnapshot = { phase: 'idle', message: null };
    const listeners = new Set<() => void>();
    // Establish ownership before an app-provided setter can synchronously reenter.
    const flow = createAuthFlow({
        client: {
            ...client,
            getSession: () => client.getSession(),
            setSession(next) {
                expectedSession = copyVisitorSession(next);
                ownedCredential = expectedSession[credentialKey] ?? null;
                client.setSession(next);
            },
        },
        page,
        getScope,
    });
    const publish = (
        phase: SessionRestorationSnapshot['phase'],
        message: string | null = null
    ) => {
        snapshot = { phase, message };
        for (const listener of [...listeners]) {
            try {
                listener();
            } catch {
                /* Rendering cannot change credential acceptance. */
            }
        }
    };
    const retire = () => {
        if (retired) return;
        retired = true;
        generation += 1;
        const old = request;
        request = null;
        flow.destroy();
        const detach = unsubscribe;
        unsubscribe = () => {};
        try {
            detach();
        } catch {
            /* Retirement must still abort the old read. */
        }
        old?.abort();
        publish('retired');
    };
    const current = () => {
        if (retired || checkingFreshness) return false;
        const observedGeneration = generation;
        const sameScope = (scope: AuthOwnerScope) =>
            scope.ownerId === initialScope.ownerId &&
            scope.revision === initialScope.revision;
        const unchanged = () => !retired && generation === observedGeneration;
        checkingFreshness = true;
        try {
            const first = { ...getScope() };
            if (!unchanged()) return false;
            const second = { ...getScope() };
            if (!unchanged()) return false;
            const session = copyVisitorSession(client.getSession());
            if (!unchanged()) return false;
            const last = { ...getScope() };
            if (!unchanged()) return false;
            if (
                sameScope(first) &&
                sameScope(second) &&
                sameScope(last) &&
                sameSession(expectedSession, session)
            )
                return true;
        } catch {
            /* Unreadable app-owned scope/session is stale. */
        } finally {
            checkingFreshness = false;
        }
        if (unchanged()) retire();
        return false;
    };
    const storageFailure = () =>
        publish(
            'storage-unavailable',
            'Remembered login storage is unavailable. Continue with an explicit login.'
        );
    const removeStored = (
        expected: string | null | readonly (string | null)[]
    ) => {
        writing = true;
        try {
            const actual = storage.getItem(storageKey);
            if (!current()) return false;
            if (
                actual !== null &&
                !(Array.isArray(expected)
                    ? expected.includes(actual)
                    : actual === expected)
            )
                return true;
            storage.removeItem(storageKey);
            return true;
        } catch {
            return false;
        } finally {
            writing = false;
        }
    };
    const clearOwnedMemory = () => {
        const session = copyVisitorSession(client.getSession());
        if (!current()) return;
        if (
            ownedCredential !== null &&
            session[credentialKey] === ownedCredential
        ) {
            const next = session;
            delete next[credentialKey];
            expectedSession = copyVisitorSession(next);
            ownedCredential = null;
            client.setSession(next);
        }
        ownedCredential = null;
    };
    if (storage.subscribe) {
        try {
            unsubscribe = storage.subscribe((key) => {
                if (
                    writing ||
                    (key !== null && key !== storageKey) ||
                    !current()
                )
                    return;
                // Any external replacement retires this visitor, even a same-value rewrite.
                clearOwnedMemory();
                retire();
            });
            if (retired) unsubscribe();
        } catch {
            storageReady = false;
            storageFailure();
        }
    }
    const encode = (credential: string) =>
        JSON.stringify({ version: 1, credential });
    return {
        flow,
        getSnapshot: () => ({ ...snapshot }),
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        applySession(grant) {
            if (!current() || request)
                throw new Error(
                    'A current idle restoration owner is required.'
                );
            const ticket = generation;
            // Remember the old envelope before setter reentry can request logout.
            try {
                observedStored = storage.getItem(storageKey);
            } catch {
                /* Memory login remains available. */
            }
            if (!current() || generation !== ticket) return;
            const next = flow.applySession(grant);
            if (retired || generation !== ticket) return;
            expectedSession = copyVisitorSession(next);
            if (!current()) return;
            const credential = next[credentialKey];
            if (typeof credential !== 'string' || !credential)
                throw new Error('No accepted credential is available.');
            ownedCredential = credential;
            const serialized = encode(credential);
            writing = true;
            let stored = false;
            try {
                if (storageReady) {
                    attemptedStored = serialized;
                    storage.setItem(storageKey, serialized);
                    stored = storage.getItem(storageKey) === serialized;
                }
            } catch {
                /* Login remains in memory when storage is denied. */
            } finally {
                writing = false;
            }
            if (!current()) return;
            if (stored) {
                observedStored = serialized;
                publish('restored');
            } else storageFailure();
        },
        async restore() {
            if (!current() || request) return null;
            if (!storageReady) {
                storageFailure();
                return null;
            }
            let raw: string | null;
            try {
                raw = storage.getItem(storageKey);
            } catch {
                storageFailure();
                return null;
            }
            if (!current()) return null;
            observedStored = raw;
            if (raw === null) {
                publish('login-required');
                return null;
            }
            let credential: string;
            try {
                const data: unknown = JSON.parse(raw);
                if (
                    data === null ||
                    typeof data !== 'object' ||
                    Array.isArray(data) ||
                    Object.keys(data).sort().join(',') !==
                        'credential,version' ||
                    (data as { version?: unknown }).version !== 1 ||
                    typeof (data as { credential?: unknown }).credential !==
                        'string' ||
                    !(data as { credential: string }).credential.trim()
                )
                    throw new Error();
                credential = (data as { credential: string }).credential;
            } catch {
                const removed = removeStored(raw);
                if (current()) {
                    if (removed)
                        publish(
                            'login-required',
                            'Remembered login is invalid. Log in again.'
                        );
                    else storageFailure();
                }
                return null;
            }
            const candidate = {
                ...expectedSession,
                [credentialKey]: credential,
            };
            const ticket = ++generation;
            const controller = new AbortController();
            request = controller;
            publish('restoring');
            const owns = () =>
                current() &&
                generation === ticket &&
                request === controller &&
                !controller.signal.aborted;
            try {
                if (!owns()) return null;
                const result = await client.loadExtension(
                    structuredClone(input),
                    { signal: controller.signal, session: { ...candidate } }
                );
                if (!owns()) return null;
                if (
                    (result.extensionScreen === 'form_loaded' ||
                        result.extensionScreen === 'portal_loaded') &&
                    result.extensionId === page.extensionId
                ) {
                    // Commit only after this read accepts the encrypted credential.
                    expectedSession = copyVisitorSession(candidate);
                    ownedCredential = credential;
                    client.setSession(candidate);
                    if (!owns()) return null;
                    request = null;
                    flow.destroy();
                    publish('restored');
                    return current() ? result : null;
                }
                const removed = removeStored(raw);
                if (owns()) {
                    if (removed)
                        publish(
                            'login-required',
                            'Remembered login was not accepted. Log in again.'
                        );
                    else storageFailure();
                }
                return null;
            } catch {
                if (owns())
                    publish(
                        'error',
                        'Login restoration could not be validated. Retry explicitly or log in again.'
                    );
                return null;
            } finally {
                if (request === controller) request = null;
            }
        },
        clear() {
            if (!current()) return;
            const removed = removeStored([
                observedStored,
                attemptedStored,
                ownedCredential === null ? null : encode(ownedCredential),
            ]);
            if (!current()) return;
            clearOwnedMemory();
            retire();
            if (!removed) storageFailure();
        },
        handoff(acceptedPage, capturedScope, isCurrent) {
            if (
                retired ||
                request ||
                checkingFreshness ||
                (acceptedPage.extensionScreen !== 'form_loaded' &&
                    acceptedPage.extensionScreen !== 'portal_loaded') ||
                acceptedPage.extensionId !== page.extensionId ||
                capturedScope.ownerId !== initialScope.ownerId ||
                capturedScope.revision <= initialScope.revision
            )
                return null;
            const ticket = generation;
            const matches = () => {
                const scope = { ...getScope() };
                return (
                    scope.ownerId === capturedScope.ownerId &&
                    scope.revision === capturedScope.revision
                );
            };
            let successor: SessionRestoration | null = null;
            let adopted = false;
            try {
                if (
                    !isCurrent() ||
                    !matches() ||
                    !sameSession(
                        expectedSession,
                        copyVisitorSession(client.getSession())
                    ) ||
                    !matches() ||
                    !isCurrent() ||
                    retired ||
                    generation !== ticket
                )
                    return null;
                successor = createSessionRestorationInternal(
                    {
                        client,
                        storage,
                        getScope,
                        apiOrigin: origin.origin,
                        context,
                        page,
                        loadInput: input,
                    },
                    { observed: observedStored, attempted: attemptedStored }
                );
                if (
                    retired ||
                    generation !== ticket ||
                    !matches() ||
                    !isCurrent() ||
                    !matches() ||
                    retired ||
                    generation !== ticket
                )
                    return null;
                retire();
                adopted = true;
                return {
                    getSnapshot: successor.getSnapshot,
                    subscribe: successor.subscribe,
                    clear: successor.clear,
                    destroy: successor.destroy,
                    handoff: successor.handoff,
                };
            } catch {
                return null;
            } finally {
                if (!adopted) successor?.destroy();
            }
        },
        destroy: retire,
    };
};

export const createSessionRestoration = (
    options: SessionRestorationOptions
): SessionRestoration => createSessionRestorationInternal(options);

/** Browser bridge without reading globals: choose localStorage or sessionStorage explicitly. */
export const createBrowserSessionStorage = (
    storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
    mode: SessionRestorationStorage['mode'],
    events: Pick<Window, 'addEventListener' | 'removeEventListener'>
): SessionRestorationStorage => ({
    mode,
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
    subscribe(listener) {
        const handler = (event: Event) => {
            const change = event as StorageEvent;
            if (change.storageArea === storage) listener(change.key);
        };
        events.addEventListener('storage', handler);
        return () => events.removeEventListener('storage', handler);
    },
});
