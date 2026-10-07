# Headless field bindings: implementation contract

This slice makes SDK-owned Form state usable with stock or app-supplied rendering.
It reuses the existing Form controller, native draft store, selection models,
published policies, projection and loaders. It does not reconstruct backend
schemas or add a framework dependency. This document describes the approved
contract; exports and integration remain under implementation until their tests
and independent review pass.

## Owner and renderer lifetimes

One Form owner holds the controller, draft, field bindings and request generations.
A renderer subscribes to a binding and returns an unmount function. Unmount only
removes DOM and subscriptions. It does not destroy the binding, cancel an owned
operation, clear the draft or mark fields clean. Ordinary rerenders and same-owner
remounts retain native values and dirty IDs.

The owner retires on visitor, session, client, token, accepted Form, parent/context
or observed configuration replacement. Retire before abort callbacks can reenter.
Every retained action checks owner and generation; an observed A-to-B-to-A change
cannot revive it. Unobserved in-place mutation followed by restoration is not
claimed to be detectable. Disposed snapshots expose no retired native data.

## Small field contract

```ts
interface FieldBinding {
    getSnapshot(): FieldSnapshot;
    subscribe(listener: (snapshot: FieldSnapshot) => void): () => void;
    setValue(nativeValue: AirtableValue): FieldActionResult;
    selection?: {
        choose(values: readonly string[]): FieldActionResult;
        search(term: string): Promise<void>;
        reload(): Promise<void>;
        loadMore(): Promise<void>;
        cancel(): void;
    };
}
```

Snapshots are detached copies: field identity, native value, dirty/revision state,
visibility (`visible`, `hidden` or `blocked`), read-only state, returned validation
messages, pending/error/recovery state and optional selection presentation.
Validation distinguishes local shape/policy refusal from server validation; this
is not a replacement validation engine. Diagnostics never contain private values.
Hidden/blocked presentation does not prune the full native Save snapshot.
Renderers must use privacy-aware presentation; native state is not display text.

Text, select and linked stock renderers use the same snapshot/actions as the
custom-renderer example. Rendering contains no independent option-limit or label
authority. Selection values are native choice names for selects and native record
IDs for links. Labels never become Save values.

## Existing logic, moved once

| Concern                                    | Existing authority                                                        | Binding boundary                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Native draft and dirty IDs                 | `FormDraftStore`, `FormController.write/subscribe`                        | One store/controller; no renderer-owned draft                                |
| Select labels, retained choices and limits | `getSelectFieldPolicy`, rules currently embedded in `createSelectControl` | One DOM-free select-field model; stock control mounts it                     |
| Conditional option availability            | `resolveSelectFieldAvailability`                                          | Existing projected-record second phase; no semantic expansion                |
| Visibility and sections                    | `createScalarFormRecordProjection`, `evaluateFormFieldVisibility`         | Preserve blocked codes, hidden values and current driver restrictions        |
| Linked requests/search/paging              | `SelectionModel`, Form linked loader, cascade                             | SDK-owned request lifecycle with existing authorized input                   |
| Validation and Save                        | `createFormSaveInput`, normalization, controller                          | Complete native envelope and dirty IDs; explicit Save only                   |
| Unknown operations                         | Starter `RecoveryJournal`                                                 | Preserve attempt identity, tombstones, no-replay and explicit acknowledgment |

The select extraction preserves configured read-only, allowed IDs, duplicate-label
handling, selected-but-ineligible values, maximum-selection behavior and reset
rules. Available-state snapshots expose disabled choices consistently to both
renderers. Search never narrows the set used to decide whether a choice is valid.

## Loading, reload and synchronization

Subscriptions and mounts perform no automatic I/O. Explicit SDK owner methods
own Form loading/reloading, linked search and paging; the app renders their status.
Latest accepted ownership/generation wins. A reload with dirty data requires an
explicit keep/discard choice. Keep preserves native edits; revalidation against
fresh metadata may block actions but cannot silently drop data. Remount is not a
reload. Recreate linked loaders with fresh detached filter input because existing
loaders snapshot inputs; reset paging while retaining native selected IDs.

At deliberate Save compose fresh save options and cascade maps. Do not mutate the
controller's originally captured options or derive data from DOM text. Existing
Review and upload fences remain authoritative; this slice must not weaken them.

## Uncertainty integration

Do not move starter Save to the controller until its operation lifecycle can
participate in the journal: all preflight refusal precedes begin; dispatch binds
the exact attempt, native revision and owner; unknown/cancelled outcomes block
replay; only an accepted owned response or explicit inspection acknowledgment
unlocks recovery. A presentation exception after accepted commit cannot turn the
operation back into unknown. Retire successor ownership before late callbacks.
Retain privacy scrubbing on Logout/Disconnect and non-sensitive uncertainty
tombstones. Native upload File objects stay in the existing pending registry.

## Required acceptance

- Stock text/select/linked and a custom renderer observe the same native writes,
  dirty IDs, validation, visibility, pending/errors and configured selection rules.
- Mount, edit, unmount and remount retain the complete draft without network or
  Save. Mutation of returned snapshots cannot change the owner or another renderer.
- Unknown Save, cancellation, late responses, stale handlers, callback reentry,
  owner/session/context replacement and observed A-to-B-to-A retain no-replay.
- Full Save preserves hidden/native metadata, order, dirty IDs and parent context.
  Synthetic validation dispatch is not backend persistence proof.
- SDK explicit search/reload/paging owns loading and error status; no stale response
  overwrites a newer request. Scalar/select/linked/attachment Review and upload
  regressions remain intact.
- One Portal cell integration is added only after this contract is sound. It uses
  Portal display metadata and existing child-first write authorization separately;
  it does not fabricate Form policy or prescribe a grid UI.

## Separate restoration design: no storage in this slice

The draft store remains memory-only. Persisting non-auth state without auth tokens
does **not** restore authentication after refresh. Authentication restoration needs
a separate analysis of supported canonical credentials/session flows, expiry and
storage threats before a user decision or implementation.

An optional draft persistence design must independently specify owner/Form/parent
scope, version and expiry, sensitive-field exclusions, fresh-load revalidation and
Logout/Disconnect deletion. No tokens are silently persisted. No local/session
storage is added by this binding work.

Email verification retains `AuthFlow` challenge ownership; select filtering retains
the compiler and owned-criteria/manual-cleanup lifecycle; linked search retains
authorized loaders and cascade. Their integration outcomes remain separate from
field-renderer acceptance and do not establish full Form/Portal parity.
