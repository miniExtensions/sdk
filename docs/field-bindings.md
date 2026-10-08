# Headless field bindings: implementation contract

This slice makes SDK-owned Form state usable with stock or app-supplied rendering.
It reuses the existing Form controller, native draft store, selection models,
published policies, projection and loaders. It does not reconstruct backend
schemas or add a framework dependency to core imports. Optional React components
consume the same bindings through the separate `/react` entry point. This document describes the approved
contract and maps the additive `/forms` bindings to the existing authorities.

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
const owner = createFormFieldBindings({
    client,
    loaded,
    saveOptions,
    getScope,
    isCurrent: ownsAcceptedForm,
    canWrite: mayUseForm,
});
const field = owner.field(fieldId);
const stop = field.subscribe((snapshot) => render(snapshot));
field.setValue(nativeValue); // { accepted: true } or a generic refusal reason
// Select/linked fields also expose the existing SelectionModel:
field.selection?.toggle(nativeChoiceNameOrRecordId);
stop(); // renderer unmount; owner and draft remain
// Only the accepted Form lifetime disposes the owner:
owner.destroy();
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
operation back into unknown. Retire the old operation/owner before late callbacks. A stale callback must never
retire or clear a newer successor.
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

### Authentication restoration decision (not implemented)

The public visitor session helpers in `src/runtime/session.ts` copy explicit
credentials and reject `miniExtSession`, the hosted Firebase principal. The
canonical frontend at pinned `58f73d5` stores an encrypted login credential under
the configured extension/table/login-field key with `never-expires` storage
(`components/PublicExtension/LoginPage/loginIntoExtensionUsingLoginPage.ts`,
`loginWithEncryptedLoginToken`). This is credential storage, even though its value
is encrypted; it is not a non-auth draft. It does not establish an SDK-managed
expiry or justify copying the hosted Firebase principal.

A future opt-in restoration adapter could retain only the returned public visitor
credential and its exact configured scope, clear it on explicit Logout/Disconnect,
and revalidate it by an explicit fresh load before restoring editable data. A
session-only choice limits persistence to a tab; persistent browser storage also
makes the credential available to scripts on the same origin and needs an explicit
retention/expiry decision. Server rejection must clear the remembered credential
and require login, without a mutation retry. No storage adapter, retention default,
Firebase restoration, or authentication persistence is included here.

## Optional React renderers

The optional `@miniextensions/sdk/react` entry point uses React as a peer; core
imports do not import React. `TextField`, `SelectField` and `LinkedField` take an
owner-held `binding`. `AttachmentField` additionally takes the owner's attachment
`controller`. Each accepts a `render(state)` function replacing its default
markup. The render state carries the same subscribed native snapshot and actions
used by the default renderer; labels never become native Save values.

Components remove subscriptions on unmount. They do not dispose the Form owner,
clear its draft, upload files or initiate linked reads during mounting. The caller
retires the old owner on visitor/session/context replacement. StrictMode and
ordinary remounts must retain the owner-held draft and pending File identities.
There is no refresh persistence or authentication-restoration storage in this slice.

Attachment selection and drop are admission attempts, not uploads. Upload is
explicit and reports phases rather than invented byte progress. Empty chooser
completion preserves the pending queue; Clear removes it explicitly. Cancelling
an upload preserves its uncertain-operation tombstone and never replays it.
`AttachmentDialog` dismisses only when a cancel event originates on the dialog:
a native file input's bubbling cancel does not close it, remove queued files or
change the draft. Explicit Close remains separate. Custom dialog shells must use
the same target/currentTarget distinction, without timer heuristics.

The current React cancellation regression uses synthetic DOM events. It does not
establish OS-picker Cancel/Escape, browser focus handoff, or screen-reader
certification. Native evidence remains a separate acceptance gate.

A cancelled or transport-failed Save retires its operation's bindings. The accepted
owner can still perform an explicit fresh `reload({ dirty: 'keep' | 'discard', read })`.
Accepted recovery creates new bindings; old actions do not revive. Recovery does
not replay Save or acknowledge an uncertain journal attempt. The journal's existing
manual inspection/new-intent gate remains independent of the fresh read.

Linked search input belongs to the selection model. `setSearchInput` replaces the
query and retires old results/paging without a read; `reload()` performs the explicit
search. React reflects that query on remount and takes the replacement owner's
query on context changes. `canChoose` validates a complete proposed selection
against the model's policy, including atomic replacement at a selection limit;
decorated disabled-option flags are presentation, not whole-set admission.

## Portal single-cell binding

The Portal cell owner uses the same subscribed field action/snapshot contract as
Form and React renderers, without fabricating a loaded Form. Its detached native
draft uses the existing draft store. Child-first detail configuration remains
write authorization; returned detail display configuration remains cell/preview
presentation. Attachments continue to be readonly previews, without Save.

A cell captures record, table, Portal field, view, accepted snapshot, token,
client session and owner revision. Caller `isCurrent` additionally fences the
mounted editor and observed configuration epoch. Old row entry and old editor
actions cannot become actions on a new snapshot, including observed A→B→A.
Ordinary renderer unmount unsubscribes only; explicit editor replacement disposes
the cell owner.

Only explicit Save invokes the existing `portals.updateGridCell` operation. It
captures the authoritative native value and dirty revision, begins the existing
uncertainty journal immediately before dispatch, and retires collection actions.
Accepted responses settle that exact attempt before renderer callbacks. Lost,
cancelled or stale responses remain unknown, with no automatic replay. A new
accepted collection/editor is required for recovery; a new mount alone never
permits a second mutation. Parent refresh remains an explicit adapter stage after
accepted cell Save; a failed refresh must not make the accepted cell mutation
replayable.

Acceptance covers stock/custom/React consumption of the same binding, remount,
exact native value dispatch, select limits, child/display policy separation,
held responses across owner/session/view replacement, cancellation and journal
no-replay. Installed copied-starter tests prove synthetic transport dispatch,
not backend persistence or native accessibility certification. This is one cell,
not a grid framework. Session-refresh storage remains design-only.

Model `setValue`, `setOptions` and `reset` synchronize presentation; they are not
native commits. Custom renderers use `binding.setValue`, or the guarded model
`choose`/`toggle` user actions. Save always reads the owner-held native draft,
never a renderer or model-only synchronization value.
