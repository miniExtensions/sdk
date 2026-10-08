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
    type SessionRestoration,
} from '@miniextensions/sdk/auth';
type Props = {
    client: MiniExtensionsClient;
    page: PasswordRequiredResult | LoginPageResult;
    ownerScope: Scope;
    getScope: () => Scope;
    onSessionApplied: () => void;
    onReload: () => void;
    signUpFieldNames?: readonly string[];
    authentication?: Pick<SessionRestoration, 'flow' | 'applySession'>;
};
type Entry = {
    flow: Flow;
    authentication: Props['authentication'];
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
            p.authentication !== e.authentication ||
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
            flow:
                props.authentication?.flow ??
                createAuthFlow({
                    client: props.client,
                    page: props.page,
                    getScope: () => latest.current.getScope(),
                }),
            authentication: props.authentication,
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
            if (!e.authentication) e.flow.destroy();
            if (entry.current === e) entry.current = null;
        };
    }, [
        props.client,
        props.page,
        props.authentication,
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
            if (e.authentication) e.authentication.applySession(e.grant);
            else e.flow.applySession(e.grant); // Never expose the returned session.
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

Keep this owner outside React, or in an application ref. Call `load(input)` once
at your app's explicit startup and again only for a deliberate Reload. Supply
`isCurrent` from your app's active owner identity. Each callback receives its
captured scope and freshness guard: check that guard immediately before changing
the screen or clearing drafts, including after callback reentry. Retired cleanup
must never clear a successor's stores.

Without `remember`, the existing load path publishes its guarded result. To opt
in, supply a factory using `optInRememberedLogin` below. The provisional
`password`/`login_page` stays private until one restoration read settles.
`onPending` renders neutral loading text. Only definitive `login-required`
publishes login; transport/storage errors use `onRestorationError`, with captured
explicit Retry and Continue with login actions. Neither action runs automatically.
Handle a rejected initial load separately as an app error, never as proof of logout.

`onLoaded` receives the accepted page, scope, optional authentication adapter and
guard. For an auth page, pass that `authentication` to `AuthPanel`; it uses the
adapter's own flow and apply method. Guard `onSessionApplied` before calling
`owner.sessionApplied()`, and guard Reload before calling `owner.load(input)`.
Accepted Form/Portal restoration hands off logout ownership before publication.
Bind Logout to `owner.logout(capturedScope)`; an old scope cannot clear a newer
lease. Ordinary React unmount unsubscribes from the UI without destroying that
external authentication owner. Dispose it only when replacing the app owner.

```ts
import type {
    LoadExtensionInput,
    LoadExtensionResult,
    MiniExtensionsClient,
} from '@miniextensions/sdk';
import type {
    AuthOwnerScope,
    AuthPage,
    SessionRestoration,
    SessionRestorationLease,
    SessionRestorationSnapshot,
} from '@miniextensions/sdk/auth';

type Authentication = Pick<SessionRestoration, 'flow' | 'applySession'>;
export function makeAuthScreenOwner(
    client: MiniExtensionsClient,
    options: {
        initialOwnerId: string;
        isCurrent?: () => boolean; // App's active owner identity, outside React.
        clearVisitorState: (
            scope: AuthOwnerScope,
            isCurrent: () => boolean
        ) => void;
        onPending?: (scope: AuthOwnerScope, isCurrent: () => boolean) => void;
        onLoaded: (
            page: LoadExtensionResult,
            scope: AuthOwnerScope,
            authentication: Authentication | undefined,
            isCurrent: () => boolean
        ) => void;
        remember?: (
            page: AuthPage,
            input: Extract<LoadExtensionInput, { shareId: string }>,
            getScope: () => AuthOwnerScope
        ) => SessionRestoration;
        onRestorationError?: (
            state: SessionRestorationSnapshot,
            retry: () => Promise<void>,
            scope: AuthOwnerScope,
            isCurrent: () => boolean,
            continueWithLogin?: () => void
        ) => void;
    }
) {
    let scope = { ownerId: options.initialOwnerId, revision: 0 };
    let generation = 0;
    let active: AbortController | null = null;
    let disposed = false;
    let remembered: SessionRestoration | SessionRestorationLease | null = null;
    const getScope = () => ({ ...scope });
    const sameScope = (captured: AuthOwnerScope) =>
        scope.ownerId === captured.ownerId &&
        scope.revision === captured.revision;
    const owns = (captured: AuthOwnerScope, version: number) =>
        !disposed &&
        generation === version &&
        sameScope(captured) &&
        (options.isCurrent?.() ?? true) &&
        !disposed &&
        generation === version &&
        sameScope(captured);
    const sameSession = (expected: ReturnType<typeof client.getSession>) => {
        const now = client.getSession();
        return (
            Object.keys(now).length === Object.keys(expected).length &&
            Object.keys(expected).every(
                (key) => Object.hasOwn(now, key) && now[key] === expected[key]
            )
        );
    };
    const invalidate = (ownerId = scope.ownerId, keepRemembered = false) => {
        if (disposed) throw new Error('Owner disposed');
        const previous = active;
        keepRemembered =
            keepRemembered && remembered?.getSnapshot().phase !== 'restoring';
        const oldRemembered = keepRemembered ? null : remembered;
        if (!keepRemembered) remembered = null;
        active = null;
        scope = { ownerId, revision: scope.revision + 1 };
        const captured = getScope();
        const version = ++generation;
        const current = () => owns(captured, version);
        try {
            if (current()) options.clearVisitorState(captured, current);
        } finally {
            oldRemembered?.destroy(); // Retire only the captured old lease.
            previous?.abort();
        }
        return version;
    };
    const load = async (input: LoadExtensionInput) => {
        const rootInput = structuredClone(input);
        const version = invalidate(scope.ownerId, true);
        if (disposed || generation !== version || active !== null)
            throw new Error('A newer load owns this screen.');
        const controller = new AbortController();
        active = controller;
        const captured = getScope();
        let session = { ...client.getSession() };
        const contextCurrent = () =>
            owns(captured, version) &&
            active === controller &&
            !controller.signal.aborted;
        const current = () =>
            contextCurrent() && sameSession(session) && contextCurrent();
        if (current()) options.onPending?.(captured, current);
        if (!current()) throw new Error('A newer load owns this screen.');
        const page = await client.loadExtension(rootInput, {
            session,
            signal: controller.signal,
        });
        if (!current())
            throw new Error('Visitor/context changed; discard this load.');
        const publish = (accepted: LoadExtensionResult) => {
            if (!contextCurrent()) return;
            const held = remembered;
            if (!held) {
                if (current())
                    options.onLoaded(accepted, captured, undefined, current);
                return;
            }
            scope = { ...scope, revision: scope.revision + 1 };
            const acceptedScope = getScope();
            const acceptedCurrent = () =>
                owns(acceptedScope, version) &&
                active === controller &&
                sameSession(session) &&
                owns(acceptedScope, version);
            const lease = held.handoff(
                accepted,
                acceptedScope,
                acceptedCurrent
            );
            if (!acceptedCurrent() || remembered !== held) {
                lease?.destroy();
                return;
            }
            if (!lease) {
                remembered = null;
                held.destroy();
                if (acceptedCurrent())
                    options.onRestorationError?.(
                        {
                            phase: 'error',
                            message:
                                'Session ownership changed. Reload explicitly.',
                        },
                        async () => {
                            if (acceptedCurrent()) await load(rootInput);
                        },
                        acceptedScope,
                        acceptedCurrent
                    );
                return;
            }
            remembered = lease; // Install logout ownership before rendering.
            options.onLoaded(
                accepted,
                acceptedScope,
                undefined,
                acceptedCurrent
            );
        };
        if (
            (page.extensionScreen !== 'password' &&
                page.extensionScreen !== 'login_page') ||
            !options.remember ||
            !('shareId' in rootInput) ||
            rootInput.context.type !== 'direct-url'
        ) {
            if (
                page.extensionScreen === 'form_loaded' ||
                page.extensionScreen === 'portal_loaded'
            )
                publish(page);
            else if (current())
                options.onLoaded(page, captured, undefined, current);
            return;
        }
        const adapter = options.remember(
            page,
            structuredClone(rootInput),
            getScope
        );
        if (!current()) {
            adapter.destroy();
            return;
        }
        const oldRemembered = remembered;
        remembered = adapter;
        oldRemembered?.destroy();
        if (!current() || remembered !== adapter) {
            adapter.destroy();
            return;
        }
        const authentication: Authentication = {
            flow: adapter.flow,
            applySession(grant) {
                if (!current() || remembered !== adapter) return;
                adapter.applySession(grant);
                if (contextCurrent() && remembered === adapter)
                    session = { ...client.getSession() };
            },
        };
        const renderLogin = () => {
            if (current() && remembered === adapter && adapter.flow.isCurrent())
                options.onLoaded(page, captured, authentication, current);
        };
        const resume = async () => {
            if (!current() || remembered !== adapter) return;
            options.onPending?.(captured, current);
            if (!current() || remembered !== adapter) return;
            const accepted = await adapter.restore();
            if (!contextCurrent() || remembered !== adapter) return;
            const state = adapter.getSnapshot();
            if (accepted && state.phase === 'restored') {
                session = { ...client.getSession() }; // Handoff verifies the adapter's accepted session.
                publish(accepted);
            } else if (current() && state.phase === 'login-required') {
                renderLogin();
            } else if (
                current() &&
                (state.phase === 'error' ||
                    state.phase === 'storage-unavailable')
            ) {
                options.onRestorationError?.(
                    state,
                    resume,
                    captured,
                    current,
                    renderLogin
                );
            }
        };
        await resume(); // One explicit restoration read; the AuthPage stayed private.
    };
    return {
        getScope,
        changeOwner: (ownerId = scope.ownerId) => invalidate(ownerId),
        sessionApplied: () => invalidate(scope.ownerId, true), // No automatic Reload.
        load,
        logout(captured: AuthOwnerScope) {
            const version = generation;
            if (!owns(captured, version)) return false;
            const held = remembered;
            held?.clear(); // Before advancing the scope; never clear a successor.
            if (!owns(captured, version) || remembered !== held) return false;
            invalidate();
            return true;
        },
        destroy() {
            if (disposed) return;
            const captured = getScope();
            const version = generation;
            const clear = () =>
                generation === version &&
                sameScope(captured) &&
                (options.isCurrent?.() ?? true) &&
                generation === version &&
                sameScope(captured);
            const previous = active;
            const held = remembered;
            active = null;
            remembered = null;
            disposed = true;
            try {
                if (clear()) options.clearVisitorState(captured, clear);
            } finally {
                held?.destroy();
                previous?.abort();
                scope = { ...scope, revision: scope.revision + 1 };
                generation++;
            }
        },
    };
}
```

Advance the revision on every visitor, connection, session, token or context
transition, including anonymous visitors and A → B → A. `changeOwner` retires the
captured old remembered owner; explicit Reload cancels a pending restoration.
An applied adapter or accepted lease remains outside the renderer for the next
accepted-load handoff and scoped logout. Credential equality alone cannot
identify transitions. This recipe composes existing SDK phases; it adds no auth
engine, storage policy or automatic mutation recovery.

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
