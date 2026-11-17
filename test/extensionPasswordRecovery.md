# Extension password recovery qualification

Task: `recKPHuXGUPfqDZaF`. This is the bounded synthetic checkpoint for the
complete extension-password task. The full task remains **Blocked**. This note
does not describe a shipped password controller, supported native adapter, or
completed Form/Portal integration.

## Executed boundary

`extensionPasswordRecovery.test.ts` uses the existing `authFixture`, which creates
a real SDK client, and the actual `createAuthFlow` grant core. It does not cast a
partial object into a client, construct a credential grant, or substitute a grant
implementation. The fixture's password result, selected-driver storage and reload
are synthetic, with unexpected fixture network requests rejected. The synthetic
page fixture and replacement events are test inputs, not native accepted-page
authority. No live password, provider, browser storage or native dispatcher is used.

At SDK main `10a6350e22a7f7a0901bbdb502091d7e6a43d8d3`, strict focused compilation
and **48/48 tests** passed: the existing 42 auth-flow cases plus these six witnesses:

| Case                                         | Observation                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Setter throws after entry                    | The real core already spent the fresh grant; replay is refused and no new verification is admitted.                           |
| Selected-driver write succeeds, then throws  | The entry remains written; it is neither rolled back nor reapplied. Recovery calls only the page-read boundary.               |
| Owned-entry readback throws                  | Setter return and actual fixture contents do not manufacture a known persistence receipt. Recovery remains a fresh-page read. |
| Reload rejects, then explicit retry succeeds | Exactly one verification, one setter entry and one write occur across both read attempts.                                     |
| Reload resolves without replacement          | The witness remains pending retirement; it does not enable another submit or assert authentication success.                   |
| Replacement, A→B→A and unmount               | Old recovery callbacks cannot dispatch a read; a late old read cannot publish a live state.                                   |

The small recovery driver is a **test recipe**, not an exported controller. The
tests establish compatibility of this recipe with real one-use grants. They do
not establish that the missing native lifetime producer or UI already implements
it. An observed selected-driver readback is not a durable-storage guarantee.
Absence of a setter observation in some other attempt is not evidence that an old
grant is globally unconsumed or reusable.

## Smallest proposed public type amendment

The current exported `AuthFlowOptions` still requires a full
`MiniExtensionsClient`. The password branch uses only these members:

```ts
export type PasswordAuthPort = Pick<
    MiniExtensionsClient,
    'getSession' | 'setSession'
> & {
    auth: Pick<MiniExtensionsClient['auth'], 'verifyExtensionPassword'>;
};

export type PasswordAuthFlowOptions = Omit<
    AuthFlowOptions<PasswordRequiredResult>,
    'client'
> & {
    client: PasswordAuthPort;
};

export function createAuthFlow(
    options: PasswordAuthFlowOptions
): PasswordAuthFlow;
```

This is a proposal, **not a currently exported signature**. It retains the genuine
`PasswordRequiredResult` requirement and existing full-client/login compatibility.
Implement it by passing typed operations into the existing common grant engine;
do not cast the smaller port to a full client, add dummy login methods, or create
another grant store. Consume-before-setter and retirement ordering stay unchanged.
A new reduced page-metadata API is unnecessary for this checkpoint.

## Reproducing the bounded witness

Use the existing task resource supervisor, with its unchanged 4 GiB process-group
limit, for these Node arguments, sequentially from the SDK checkout:

```text
node_modules/typescript/bin/tsc --project test/tsconfig.password-recovery.json
--test --test-reporter=tap --test-concurrency=1 dist/password-recovery-test/test/authFlow.test.js dist/password-recovery-test/test/extensionPasswordRecovery.test.js
```

The focused config inherits the normal strict SDK test settings and only narrows
the two test entry points and generated-output directory. It needs no fresh
dependency resolution when the retained installation matches the package and
lock inputs. The six new cases are also ordinary tests in the canonical unit
profile. This focused run is not a full-package or native qualification.

## Exact native handoff still needed

The native producer must supply a genuine accepted PASSWORD result and a lifetime
that advances on actual page, visitor, session, context and authorized view-mode
replacement. Repeating an extension ID, or returning A after B, must not revive an
old lifetime. Unmount retires callbacks. The existing `AuthOwnerScope` revision
must come from those real events, not a component-invented counter.

The current seams are concrete:

- `extensionFormOpened` checks read currentness around Redux publication, but the
  PASSWORD mapper in `getScreenStateHelpers` drops `rootLoadRead`. That request
  admission metadata is not itself an accepted-password-page receipt; retain the
  actual accepted result and bind the receipt at its publication boundary.
- `ExtensionPasswordView` currently receives only extension/session IDs and a
  reload callback. Password-to-password reuse has no explicit password lifetime.
- The existing website `executeApiRequest` rereads ambient global/current-URL
  storage. It does not consume the SDK flow's explicit captured request session.
  A native-backed port must preserve that captured visitor session at actual
  dispatch, or refuse it. A precheck followed by an unrelated ambient reread is
  insufficient. This requires a real canonical transport seam, not a fake client.
- SDK password input types currently admit optional `viewMode`, but `flow.ts`
  projects only extension ID and password. Native verification currently forwards
  Redux view mode. The bridge must capture and preserve the genuinely authorized
  native mode; it must not silently convert draft to published or grant maker
  authority. The hosted Firebase principal stays inside native transport and out
  of public visitor `RuntimeSession`.
- The session setter must target the captured native storage context and only the
  owned encrypted password entry, preserving neighbours and expiration behavior.
  Observe setter entry, return and exact owned-entry readback separately. Native
  storage fallback may use a nonpersistent driver; return/readback cannot promise
  durability or roll back a spent grant.
- After consumption, `flow.isCurrent()` is intentionally false. Recovery needs
  the separate genuine host page lifetime. A resolved `window.location.reload`
  callback does not prove an accepted replacement. Read-only retry must never
  verify again or reapply a grant.

These are engineering composition requirements, not a request for broader user
permission. This checkpoint changes no public auth behavior or native policy.

## Remaining full delivery

The actual complete controller/form, private exact-byte draft, wrong/blocked/error
and recovery presentation, optional chrome, localization and accessibility remain
implementation work. So do direct Form/Portal dispatch, genuine current-page and
captured-session/viewMode admission, real native storage/reload composition and
the complete lifecycle matrix. Current native hunk custody must be checked before
any shared edit; historical Tables ownership is not a current release condition.

Packed React 18/19 ESM/CJS/types/CSS/SSR/hydration, two-instance browser acceptance,
native regression, required resulting-head CI/review, both qualified landings and
receiving remain unrun for that complete implementation. Existing security,
fixture, resource and production holds remain. R53, Eight's Save and Nine's Lookup
are outside this checkpoint.
