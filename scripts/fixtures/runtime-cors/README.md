# Canonical CORS source fixtures

These are complete, unchanged transport helpers, not a second production policy:

- `before-58f73d5.ts`: monorepo `58f73d575ab10baa0a10693660d8002f204368e1`,
  `backend-src/trpc/publicRuntimeCors.ts`; admits 10 of the 13 SDK operations.
- `after-pr7583-7c092c9.ts`: PR7583 head
  `7c092c9d78b8a4c8b3f0be56fa7ddb907bd0d861`, same file; adds exactly the two
  address operations and webhook. This fixture is not evidence that PR7583 is merged.

The guard transpiles and executes the helper. No route discovery or allowlist
parsing is performed. Tests use the checked-in SDK operation metadata and need
no private checkout, credentials, network or server dependencies. Intentional
source mutations prove exact/private/mixed denial and context/cache obligations.
Minimal Git checkout fixtures prove the real generator checks CORS before its
existing contract compilation/output boundary; they do not certify full contract
regeneration.

When canonical policy changes, refresh complete fixtures from explicitly chosen
source revisions and review the source diff. Do not widen the policy in SDK code
or remove a generated operation to make the guard pass.
