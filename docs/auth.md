# Optional authentication flow

`@miniextensions/sdk/auth` binds the existing password, login, verification-code
and sign-up operations to a loaded authentication screen. It adds no backend
operation or authorization layer. Importing it requires no DOM or React;
importing the core client does not import it. Install a supplied built TGZ
as shown in the [runtime quickstart](runtime.md#packaged-form-quickstart).
This development preview has not been published to npm. A source checkout must
be [installed, checked and packed](../README.md#build-an-archive-from-source) before
installing its built TGZ.

The application owns loading, rendering, visitor identity and credential
persistence. A successful helper returns an opaque grant, not a public session
token. Apply that grant explicitly, advance your application scope, clear old
drafts/authentication UI, then let the visitor explicitly Reload. Applying a
session does not automatically load a Form or Portal.

## React client panel

This recipe uses your application's React 19 installation. The SDK's `/react`
components have an optional React peer; core and `/auth` imports do not require
React. Pass the `ownerScope` captured with this particular loaded `page`,
plus the owner's live `getScope` function. `onSessionApplied` must synchronously
advance the revision and clear the old page/drafts. `onReload` is an app-owned
manual action; also keep a Reload control outside this panel because applying
a session removes the old authentication page. The next recipe supplies those
owner and load boundaries.

Use `shouldMaskLoginFieldInput` for the hosted input mask rules and
`getLoginVerificationDestination` for verification notices. Explicitly masked
fields hide the matching email/phone destination when that verification mode is
configured. A caller-supplied fallback phone destination stays visible, matching
the hosted flow; pass the same `fallbackPhoneVerificationNumber` to the helper.
These helpers affect presentation only: preserve the original credentials,
challenge, and backend result. Title-inferred password/PIN inputs alone do not
redact a verification destination.

`signUpFieldNames` is explicit application input for your configured sign-up
form. Omit it if sign-up is unavailable. The backend enforces the published
rules; never infer navigation URLs from untyped `publicFields`.

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import {
    SDKError,
    type LoginPageResult,
    type MiniExtensionsClient,
    type PasswordRequiredResult,
} from '@miniextensions/sdk';
import {
    createAuthFlow,
    shouldMaskLoginFieldInput,
    getLoginVerificationDestination,
    type AuthOwnerScope as Scope,
    type AuthFlow as Flow,
    type AuthCredentialGrant as Grant,
    type AuthVerificationChallenge as Challenge,
} from '@miniextensions/sdk/auth';
type Props = {
    client: MiniExtensionsClient;
    page: PasswordRequiredResult | LoginPageResult;
    ownerScope: Scope;
    getScope: () => Scope;
    onSessionApplied: () => void;
    onReload: () => void;
    signUpFieldNames?: readonly string[];
};
type Entry = {
    flow: Flow;
    page: Props['page'];
    client: MiniExtensionsClient;
    scope: Scope;
    generation: number;
    disposed: boolean;
    busy: boolean;
    grant: Grant | null;
    challenge: Challenge | null;
};
const initial = {
    ready: false,
    busy: false,
    message: '',
    canApply: false,
    canConfirm: false,
    recovery: false,
};

export function AuthPanel(props: Props) {
    const latest = useRef(props);
    latest.current = props;
    const entry = useRef<Entry | null>(null);
    const inputs = useRef<Record<string, HTMLInputElement | null>>({});
    const password = useRef<HTMLInputElement>(null);
    const code = useRef<HTMLInputElement>(null);
    const [view, setView] = useState(initial);
    const notice = (message: string, patch: Partial<typeof initial> = {}) =>
        setView((state) => ({ ...state, ...patch, message }));
    const clearInputs = () => {
        for (const input of Object.values(inputs.current))
            if (input) input.value = '';
        if (password.current) password.current.value = '';
        if (code.current) code.current.value = '';
    };
    const owns = (e: Entry, generation = e.generation): boolean => {
        const p = latest.current;
        if (
            entry.current !== e ||
            e.disposed ||
            e.generation !== generation ||
            p.page !== e.page ||
            p.client !== e.client ||
            p.ownerScope.ownerId !== e.scope.ownerId ||
            p.ownerScope.revision !== e.scope.revision
        )
            return false;
        try {
            const scope = p.getScope();
            return (
                scope.ownerId === e.scope.ownerId &&
                scope.revision === e.scope.revision &&
                entry.current === e &&
                !e.disposed &&
                e.generation === generation
            );
        } catch {
            return false;
        }
    };
    const current = (e: Entry, generation = e.generation) =>
        owns(e, generation) && e.flow.isCurrent();
    useEffect(() => {
        const scope = props.getScope();
        if (
            scope.ownerId !== props.ownerScope.ownerId ||
            scope.revision !== props.ownerScope.revision
        )
            return;
        const e: Entry = {
            flow: createAuthFlow({
                client: props.client,
                page: props.page,
                getScope: () => latest.current.getScope(),
            }),
            page: props.page,
            client: props.client,
            scope: { ...props.ownerScope },
            generation: 0,
            disposed: false,
            busy: false,
            grant: null,
            challenge: null,
        };
        entry.current = e;
        clearInputs();
        setView({ ...initial, ready: true });
        return () => {
            e.disposed = true;
            e.generation++;
            e.grant = null;
            e.challenge = null;
            e.flow.destroy();
            if (entry.current === e) entry.current = null;
        };
    }, [
        props.client,
        props.page,
        props.ownerScope.ownerId,
        props.ownerScope.revision,
    ]);

    const run = async (
        operation: 'password' | 'login' | 'code' | 'signup',
        action: (e: Entry, active: () => boolean) => Promise<void>
    ) => {
        const e = entry.current;
        if (!e || !current(e) || e.busy || view.recovery) return;
        e.busy = true;
        const generation = ++e.generation;
        const active = () => current(e, generation);
        e.grant = null;
        if (operation !== 'code') e.challenge = null;
        setView({ ...initial, ready: true, busy: true, message: 'Working…' });
        try {
            await action(e, active);
            if (!active()) return;
        } catch (cause) {
            if (!owns(e, generation)) return;
            const rejectedCode =
                operation === 'code' &&
                cause instanceof SDKError &&
                cause.kind === 'api' &&
                e.flow.isCurrent();
            notice(
                rejectedCode
                    ? 'Code was not accepted. Enter it again or Reload.'
                    : 'Action did not complete. Check its outcome, then Reload.',
                {
                    canConfirm: rejectedCode && e.challenge != null,
                    recovery: !rejectedCode,
                }
            );
        } finally {
            if (owns(e, generation)) {
                e.busy = false;
                setView((state) => ({ ...state, busy: false }));
            }
        }
    };
    const credentials = (prefix: string, names: readonly string[]) => {
        const values = Object.fromEntries(
            names.map((name) => [
                name,
                inputs.current[`${prefix}:${name}`]?.value ?? '',
            ])
        );
        clearInputs();
        return values;
    };
    const verify = () =>
        void run('password', async (e, active) => {
            if (e.flow.screen !== 'password') return;
            const extensionPassword = password.current?.value ?? '';
            clearInputs();
            const result = await e.flow.verifyPassword({ extensionPassword });
            if (!active()) return;
            if (result.type === 'correct') e.grant = result.grant;
            notice(
                {
                    correct: 'Password verified. Apply session to continue.',
                    wrong: 'Password was not accepted.',
                    blocked: 'Password attempts are blocked.',
                }[result.type],
                { canApply: result.type === 'correct' }
            );
        });
    const login = () =>
        void run('login', async (e, active) => {
            if (
                e.flow.screen !== 'login_page' ||
                e.page.extensionScreen !== 'login_page'
            )
                return;
            const result = await e.flow.login({
                loginCredentials: credentials(
                    'login',
                    e.page.payload.loginFieldNames
                ),
            });
            if (!active()) return;
            if (result.type === 'found-record') {
                e.grant = result.grant;
                notice('Login accepted. Apply session to continue.', {
                    canApply: true,
                });
            } else if (result.type === 'no-record')
                notice('No login record found.');
            else {
                e.challenge = result.challenge;
                notice(
                    `Enter the code sent to ${getLoginVerificationDestination(e.page, result)}.`,
                    {
                        canConfirm: true,
                    }
                );
            }
        });
    const confirm = () =>
        void run('code', async (e, active) => {
            if (e.flow.screen !== 'login_page' || !e.challenge) return;
            const verificationCode = code.current?.value ?? '';
            clearInputs();
            const grant = await e.flow.confirmVerificationCode({
                challenge: e.challenge,
                verificationCode,
            });
            if (!active()) return;
            e.grant = grant;
            e.challenge = null;
            notice('Code accepted. Apply session to continue.', {
                canApply: true,
            });
        });
    const signup = () =>
        void run('signup', async (e, active) => {
            if (e.flow.screen !== 'login_page') return;
            const result = await e.flow.signUp({
                signUpCredentials: credentials(
                    'signup',
                    latest.current.signUpFieldNames ?? []
                ),
            });
            if (!active()) return;
            notice(
                result.ok
                    ? 'Sign-up accepted; this does not log you in. Follow your app’s next step, then Reload.'
                    : 'Sign-up did not complete. Check your account before another attempt.',
                { recovery: true }
            );
        });
    const apply = () => {
        const e = entry.current;
        if (!e || !current(e) || !e.grant || e.busy) return;
        try {
            e.flow.applySession(e.grant); // Never expose the returned session.
            const owned = owns(e);
            e.grant = null;
            e.challenge = null;
            e.disposed = true;
            e.generation++;
            if (owned) latest.current.onSessionApplied(); // Advance + clear; no reload.
        } catch {
            if (owns(e))
                notice(
                    'Session application did not complete. Reload explicitly.',
                    {
                        busy: false,
                        canApply: false,
                        canConfirm: false,
                        recovery: true,
                    }
                );
        }
    };
    const cancel = () => {
        const e = entry.current;
        if (!e || !current(e)) return;
        e.generation++;
        e.busy = false;
        e.grant = null;
        e.challenge = null;
        clearInputs();
        e.flow.cancel();
        if (owns(e))
            notice(
                'Cancelled. Check any delivery/sign-up outcome, then Reload.',
                {
                    busy: false,
                    canApply: false,
                    canConfirm: false,
                    recovery: true,
                }
            );
    };
    const visible =
        entry.current?.page === props.page &&
        entry.current.client === props.client &&
        !entry.current.disposed &&
        entry.current.scope.ownerId === props.ownerScope.ownerId &&
        entry.current.scope.revision === props.ownerScope.revision
            ? view
            : initial;
    const blocked = !visible.ready || visible.busy || visible.recovery;
    const fields = (prefix: string, names: readonly string[]) =>
        names.map((name) => {
            const obscured = shouldMaskLoginFieldInput(
                props.page.extensionScreen === 'login_page'
                    ? props.page.payload.fieldNamesToSchemas[name]
                    : undefined
            );
            return (
                <label key={`${props.ownerScope.revision}:${prefix}:${name}`}>
                    {name}
                    <input
                        type={obscured ? 'password' : 'text'}
                        ref={(node) => {
                            inputs.current[`${prefix}:${name}`] = node;
                        }}
                        autoComplete="off"
                    />
                </label>
            );
        });
    return (
        <section
            key={`${props.ownerScope.ownerId}:${props.ownerScope.revision}`}
            aria-label="Authentication"
        >
            <p role="status">{visible.message}</p>
            {props.page.extensionScreen === 'password' ? (
                <fieldset disabled={blocked}>
                    <label>
                        Extension password
                        <input
                            type="password"
                            ref={password}
                            autoComplete="off"
                        />
                    </label>
                    <button type="button" onClick={verify}>
                        Verify password
                    </button>
                </fieldset>
            ) : (
                <>
                    <fieldset disabled={blocked}>
                        <legend>Login</legend>
                        {fields('login', props.page.payload.loginFieldNames)}
                        <button type="button" onClick={login}>
                            Log in
                        </button>
                    </fieldset>
                    {props.signUpFieldNames?.length ? (
                        <fieldset disabled={blocked}>
                            <legend>Sign up</legend>
                            {fields('signup', props.signUpFieldNames)}
                            <button type="button" onClick={signup}>
                                Sign up
                            </button>
                        </fieldset>
                    ) : null}
                    {visible.canConfirm ? (
                        <fieldset disabled={blocked}>
                            <label>
                                Verification code
                                <input
                                    ref={code}
                                    autoComplete="one-time-code"
                                />
                            </label>
                            <button type="button" onClick={confirm}>
                                Confirm code
                            </button>
                        </fieldset>
                    ) : null}
                </>
            )}
            <button
                type="button"
                disabled={blocked || !visible.canApply}
                onClick={apply}
            >
                Apply session
            </button>
            <button type="button" disabled={!visible.ready} onClick={cancel}>
                Cancel
            </button>
            <button type="button" onClick={() => latest.current.onReload()}>
                Reload
            </button>
        </section>
    );
}
```

Raw inputs are cleared after a manual action. Opaque grants/challenges stay in a
local ref, never React state, logs, storage or DOM attributes. Every awaited
result is checked for current flow, page, owner/revision and operation generation
before displaying a destination/status or retaining a grant. Wrong codes from
the existing v1 endpoint reject with `SDKError` (`kind:'api'`), including its
HTTP 200 error responses; there is no invented “wrong-code” success-result tag.
A successful `{ok}` sign-up response is not authentication.

## App-owned load and revision

Use this owner outside React, or keep it in an application ref. `onLoaded`
receives the actual guarded result and its captured scope; render an
`AuthPanel` only for `password`/`login_page`, and route other results in your app.
`clearVisitorState` must remove the previous page/drafts and clear their stores.
Bind `owner.sessionApplied` to `onSessionApplied`, and a deliberate Reload
button to `owner.load(input)` with your app's error handling.

```ts
import type {
    LoadExtensionInput,
    LoadExtensionResult,
    MiniExtensionsClient,
} from '@miniextensions/sdk';

export function makeAuthScreenOwner(
    client: MiniExtensionsClient,
    options: {
        initialOwnerId: string;
        clearVisitorState: () => void;
        onLoaded: (
            page: LoadExtensionResult,
            scope: { ownerId: string; revision: number }
        ) => void;
    }
) {
    let scope = { ownerId: options.initialOwnerId, revision: 0 };
    let generation = 0;
    let active: AbortController | null = null;
    let disposed = false;
    const invalidate = (ownerId = scope.ownerId) => {
        if (disposed) throw new Error('Owner disposed');
        const previous = active;
        active = null;
        scope = { ownerId, revision: scope.revision + 1 };
        const version = ++generation;
        try {
            options.clearVisitorState();
        } finally {
            previous?.abort();
        }
        return version;
    };
    return {
        getScope: () => ({ ...scope }),
        // A → B → A gets increasing revisions even if final credentials match.
        // Also call for same-owner connection/session/token/context changes.
        changeOwner: invalidate,
        sessionApplied: () => invalidate(), // Explicit apply callback; no reload.
        async load(input: LoadExtensionInput) {
            const version = invalidate(); // Explicit Reload retires the old page.
            if (disposed || generation !== version || active !== null)
                throw new Error('A newer load owns this screen.');
            const controller = new AbortController();
            active = controller;
            const captured = { ...scope };
            const session = { ...client.getSession() };
            controller.signal.throwIfAborted();
            if (disposed || active !== controller || generation !== version)
                throw new Error('A newer load owns this screen.');
            const page = await client.loadExtension(input, {
                session,
                signal: controller.signal,
            });
            controller.signal.throwIfAborted();
            const now = client.getSession();
            if (
                disposed ||
                active !== controller ||
                generation !== version ||
                scope.ownerId !== captured.ownerId ||
                scope.revision !== captured.revision ||
                Object.keys(now).length !== Object.keys(session).length ||
                !Object.keys(session).every(
                    (key) =>
                        Object.hasOwn(now, key) && now[key] === session[key]
                )
            ) {
                throw new Error('Visitor/context changed; discard this load.');
            }
            controller.signal.throwIfAborted();
            options.onLoaded(page, captured); // Only this guarded result renders.
        },
        destroy() {
            if (disposed) return;
            disposed = true;
            scope = { ...scope, revision: scope.revision + 1 };
            generation++;
            const previous = active;
            active = null;
            try {
                options.clearVisitorState();
            } finally {
                previous?.abort();
            }
        },
    };
}
```

Advance the revision on every visitor, connection, session, token or context
transition, including anonymous visitors and A → B → A. Dispose the old flow
and create a fresh one for the next loaded screen. Credential equality alone
cannot identify those transitions.

Cancellation does not roll back verification delivery or sign-up. After an
uncertain result, inspect the account/delivery outcome and explicitly Reload
before deciding on another manual action. Neither helper nor recipe retries,
resends, signs up, applies credentials or reloads automatically. The backend
remains authoritative for published passwords, login/sign-up rules, verification
policy, visitor permissions and all subsequent Form/Portal actions. Local
recipe tests do not establish staging compatibility.

## Explicit refresh survival

The core client remains memory-only. `createSessionRestoration` is an optional
`/auth` adapter; merely importing or constructing the core does not read storage.
An application must deliberately choose storage, API origin and canonical hosted
context (the first pathname segment), and supply the accepted authentication page
and its root-share load input. Child/token-based loads are not restoration entry
points. Login-page share identity must match that input.

A root-hosted app at `/` has the explicit context `''`. Pass that empty string
verbatim; it is valid and distinct from `'global'`, a share ID, and other path
contexts. For a URL, `new URL(url).pathname.split('/')[1] ?? ''` obtains the
first pathname segment without substituting another namespace. Missing, null
and non-string context values are rejected. Remembered entries remain scoped
to the exact API origin, context, root share and canonical credential key.
The empty context changes no credential, fresh-validation or logout rules.

The adapter owns one `AuthFlow`. Call its `applySession(grant)` with a grant from
that flow to remember only the accepted **server-encrypted login credential** or
**server-encrypted extension-password credential**. These are sensitive reusable
credentials, not transient extension access tokens. Raw passwords, verification
codes, Firebase principals, access tokens, arbitrary session entries, drafts,
files and uncertainty journals are not persisted. The namespace includes the
explicit API origin, context, share and the existing canonical credential key;
there is no migration or import of a hosted website's storage map.

`restore()` is an explicit read. It supplies a detached candidate session only to
`loadExtension`, then commits it to the client only if a current fresh response
loads the same extension's Form or Portal. `restored` establishes current
server-authorized access, not proof that a particular login identity was used:
if login requirements changed, use the accepted page's own identity/context,
never the storage entry or phase alone. Authentication prompts and other
nonaccepted responses remove only the exact remembered entry used by that read.
A newer stored credential is preserved even before its cross-tab event arrives. Transport errors leave
it available for an explicit retry and show generic error state. Construction
and subscriptions cause no network requests. Render `getSnapshot()` and
`subscribe()` to show `restoring`, `login-required`, `storage-unavailable`, `error`
or `retired` without exposing credentials. A returned page still belongs to the
application's normal accepted-load lifecycle; synchronously retire old drafts,
mutation owners and renderers before installing it.

```ts
import {
    createBrowserSessionStorage,
    createSessionRestoration,
    type AuthOwnerScope,
    type AuthPage,
} from '@miniextensions/sdk/auth';
import type {
    MiniExtensionsClient,
    LoadExtensionInput,
} from '@miniextensions/sdk';

export function optInRememberedLogin(
    client: MiniExtensionsClient,
    page: AuthPage,
    rootLoad: Extract<LoadExtensionInput, { shareId: string }>,
    getScope: () => AuthOwnerScope,
    apiOrigin: string,
    context: string,
    storage: Storage,
    mode: 'tab' | 'persistent',
    events: Window
) {
    // App choice: sessionStorage for tab lifetime, or localStorage for persistence.
    const backend = createBrowserSessionStorage(storage, mode, events);
    return createSessionRestoration({
        client,
        page,
        loadInput: rootLoad,
        getScope,
        apiOrigin,
        context,
        storage: backend,
    });
}
```

Canonical hosted login storage uses no client expiry for these encrypted
credentials. This adapter likewise invents no TTL; the fresh server read decides
whether a credential remains valid. Transient access-token cache expiry is a
separate concern. The Form `sessionExpiration` keep/logout setting governs
post-submission navigation, not a stored-credential TTL: the app must call
`clear()` on its configured logout/disconnect and then replace the visitor scope.
This adapter does not change that Form behavior or authentication settings.

`clear()` removes the scoped stored credential and its still-owned memory entry.
Persistent storage must provide cross-tab notifications: external removal,
clear-all or replacement retires this old owner, aborts its read and clears its
still-owned memory credential. It never automatically logs into a new identity.
`destroy()` only retires an unmounted owner; it does not erase the remembered
credential. Advance the monotonic owner revision on every visitor, session,
connection and accepted-page replacement, including observed A→B→A. After an accepted root Form/Portal load advances the revision, explicitly call
`handoff(acceptedPage, capturedScope, isCurrent)` before invoking any old adapter
method. The app supplies the captured new scope and its accepted-load freshness
guard. The returned lease owns logout and future accepted-load handoffs; it has
no authentication or restore actions. Replace your logout owner with this lease.
Old methods become inert. A changed visitor, session or stale accepted load cannot
transfer ownership. Call the current lease's `clear()` before replacing its scope
on logout. No old authentication page needs to remain in the app's render state.
Old responses cannot clear or retire a successor. Unobserved in-place ABA is not detected.

Persistent local storage survives browser restarts and is readable by scripts on
the app origin; XSS or another same-origin app can expose or replace it. Tab
storage limits retention but does not remove that script-access risk. Storage
may be denied or corrupted. Failed remembering leaves successful login in memory;
failed clearing reports that storage could not be cleared, even though the owned
memory credential is removed. Do not promise logout on another device or another
origin. Cross-tab behavior depends on the explicitly supplied backend's events.
Removal compares the current stored bytes before deleting; ordinary browser
storage does not provide an atomic cross-tab compare-and-delete transaction.
No encryption-at-rest claim is made by the adapter.

Refresh survival restores authentication only. It does not restore drafts or
uncertain mutation tombstones, and never automatically repeats Save, Upload or
another mutation. Applications retaining uncertain operation state must apply
their separate recovery/no-replay policy before permitting mutations. All tests
for this adapter use synthetic credentials and fresh-load responses; they do not
establish live backend login, revocation timing or browser storage security.
