# Prepared native Portal differential corpus

Status: **prepared and unrun**. The native dependency/execution hold remains in
force. The SDK local tests are independent kernel tests; they do not execute the
native reducer, thunk, or borrowed List/Grid consumer. Neither source inspection
nor the historical six frame probes establishes full native collection parity.

`test/fixtures/nativePortalCollectionDifferential.test.ts.txt` is a native Jest
test source kept inert in the SDK repository. When the native owner admits normal
execution, places it under
`components/PublicExtension/redux/__tests__/nativePortalCollectionDifferential.test.ts`,
and installs the exact packed SDK head through the normal dependency procedure,
it imports the actual reducer through `createTestStore`, actual fetch thunk,
accepted-frame binding, presentation, and toast implementation. Axios is the
only application boundary doubled. No reducer/thunk is copied, transformed,
reimplemented, evaluated in another runner, or replaced with a fixture oracle.
No alternate native execution gate is introduced.

## Source provenance

Read-only trace on 2026-11-13:

- Host: Abdul ABC's Mac mini, `Abdul-ABCs-Mac-mini.local`.
- Native main checkout source HEAD:
  `8daffe4d4b0a9ba1eafba55a041363094bd5fb49`.
- Retained summary-card source HEAD:
  `fc7ecd27cfb900ba229857095e631f5e99bf055c`; its unrelated dirty
  `PortalView.headerVisibility.test.tsx` was untouched.
- `components/PublicExtension/redux/acceptedPortalFrame.ts` blob:
  `6dfc1c667720326570e6cc86364dfcfd3fe5004c` in both.
- `components/PublicExtension/redux/thunks/fetchRecordsForLinkedTableOnPortalThunk.ts`
  blob: `94c1a1f61012beebf00d9688d053ff2bbc7abe3f` in both.
- Reducer blobs: main `490b49ad334db1b224f2840d99d8e7e8728bf4a7`;
  retained `abbf0032ff7df554d96595b250ca3ee125af0b29`. Full reducer ownership
  must be reconciled at cutover; these differing complete-file hashes are not
  a claim that canonical lifecycle hunks differ.
- Valid fixture construction follows the existing
  `fetchRecordsForLinkedTableOnPortalThunk.test.ts` helpers
  `makePortalLoadedScreenState`, `createStoreForPortalFetchThunk`, and
  `createAcceptedFrameHarness`; the new test imports the real shared store and
  field/schema generators instead of importing or modifying another test body.

## Maintained A–H cases

| Group | Actual native operations and paired SDK assertions                                                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Deferred forced replacement, reverse settlement, and duplicate cached First. Retired success publishes nothing and duplicate cached intent sends no request.                                                |
| B     | Pending Next/reload retain rows and child presentation eligibility; ordinary failure produces failed state and retires presentation; retained Next keeps frame, error, child eligibility, and retry cursor. |
| C     | Observed query/token/schema A→B→A retires old failure; benign table enrichment preserves the current read. Positive fresh reads recover.                                                                    |
| D     | Poisoned/enriched cache with withheld response fields/rows, duplicate raw IDs, and null/missing/present-empty details. Legacy publication is compared separately from accepted-frame eligibility.           |
| E     | Empty versus null cursor; parent replacement; IDs-only replace/append/clear retirement; direct post-action add/remove required failures; stale append publishes nothing.                                    |
| F     | Native I/O sees a committed receipt; observers see coherent projections; input mutation preserves snapshots; synchronous start reentrancy and direct stale failure have required failing assertions.        |
| G     | Real sort-before-filter cleanup, correction, notice, automatic First; stale cleanup has no effects; correction-subscriber reentrancy has required failing assertions.                                       |
| H     | Presentation destroy/remount leaves canonical read alive; explicit host retirement prevents stale settlement.                                                                                               |

Receipt IDs are captured from the actual thunk-generated native request at the
external I/O boundary, then supplied to the SDK kernel. Scope binding comes from
the native binding function. The host response adapter uses response bytes only,
never native cache or the accepted native frame. Success supplies `scopeAfter`
for the native transaction's own detail-metadata echo, not as permission to
accept another session, token, cache owner, or linked table. The test compares
raw legacy IDs and accepted deduplicated frame independently because native
legacy publication still occurs when the response-only frame is ineligible.

## Required failures and later owner work

The inspected native source does not already meet every target invariant. Keep
these stronger requirements explicit when adapting the host; do not weaken
assertions to obtain a parity result:

1. Start reentrancy: a subscriber may supersede a begin before the old thunk
   reads `owner.active`; the old thunk still performs transport. The prepared
   F regression requires only the current transport and is expected to fail
   against that source.
2. Cleanup reentrancy: currentness is checked before correction dispatch, but
   a subscriber can supersede after that dispatch and before notice/fresh First.
   The prepared G regression preserves the original failure. The host must consume
   the exact cleanup receipt and recheck continuation and deferred notice delivery.
3. Ordinary failure reducers currently rely on the thunk's currentness guard.
   The prepared F regression dispatches the actual unscoped stale failure action.
   The cutover must receipt-check all failure publications, including direct
   reducer callers, rather than granting authority to plain receipt data.
4. The reconciliation wrapper recognizes IDs-only replace/append/clear actions,
   while post-action `addRecordIdToLinkedRecordsCellForForm` and
   `removeRecordIdFromLinkedRecordsCellForExtension` directly change cohort IDs.
   The native owner must delegate or invalidate these writers in the same
   transaction. Prepared E add/remove cases preserve the original failing assertions;
   SDK-only additive work does not complete that migration.

The prepared test source is not claimed compiled, runnable, passing, or installed
in native. Before execution the native owner must reconcile exact public types
and native head, retain the prepared required failures, use normal full native
validation and exact-head CI, and record results separately from SDK checks.
Actual borrowed List/Grid import-back, installed consumer qualification, hosted
acceptance, deployment, and production remain outside this SDK milestone.
