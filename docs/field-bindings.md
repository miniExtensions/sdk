# Headless field bindings

Use `@miniextensions/sdk/forms` to keep native Form state and behavior in the SDK
while your application supplies rendering. One owner combines the existing draft
store, Form controller, selection policies and request lifecycle. Optional
`@miniextensions/sdk/react` components use the same bindings; core imports do not
require React. This is a development preview, not a complete Form/Portal UI.

Install a built SDK TGZ before using these imports. See the
[archive and source installation instructions](../README.md#install-and-run-the-browser-starter)
and [Form helpers](forms.md). A source checkout must be built and packed first.

## Create an owner, then mount renderers

Create the owner for an accepted `FormLoadedResult`, outside ordinary renderer
mounting. Pass the real client, complete Save options, current owner/revision and
an accepted-load/configuration guard. The optional write guard can additionally
block actions during Review, recovery or another application-owned operation.

```ts
import {
    createFormFieldBindings,
    type FormFieldBindings,
    type FormFieldBindingsOptions,
    type FormFieldSnapshot,
} from '@miniextensions/sdk/forms';

export function createFormOwner(options: FormFieldBindingsOptions) {
    return createFormFieldBindings(options);
}

export function subscribeField(
    owner: FormFieldBindings,
    fieldId: string,
    render: (snapshot: FormFieldSnapshot) => void
) {
    const binding = owner.field(fieldId);
    const unmount = binding.subscribe(render);
    return { binding, unmount };
}
```

Call `binding.getSnapshot()` for the current detached snapshot. `setValue` accepts
native values and returns either `{ accepted: true }` or a generic refusal reason.
Selects use native choice names; linked records use record IDs. Select/linked
bindings also expose a selection model: guarded `choose`/`toggle` actions write
native selections. Labels never become Save values. Model `setValue`, `setOptions`
and `reset` only synchronize presentation; they do not commit native data.

Snapshots include field identity, native value, dirty/revision state, visibility,
read-only/editable state, validation, pending/error state and selection
presentation. Mutating a snapshot cannot change the draft. Hidden or blocked
presentation does not prune native Save data. A custom renderer must honor
visibility, read-only and privacy/masking settings before displaying native
values; a native snapshot is not already-safe display text. Local shape/policy
refusals and server validation are distinct, not a replacement validation engine.

One owner survives ordinary rerenders and same-owner remounts. Unmount removes
subscriptions and markup only: do not call `owner.destroy()` for a rerender. Dispose
the old owner on visitor, session, client, token, accepted Form, parent/context or
observed configuration replacement. Advance the monotonic scope revision on every
such transition, including A→B→A. Retire the old operation/owner before callbacks
can reenter; a stale callback must never retire or clear a newer successor.
Unobserved in-place changes followed by restoration are not detected.

## Selects, linked reads and reload

The shared select model applies configured labels, allowed choice IDs, retained
ineligible values and selection limits. Stock and custom renderers share that
policy. Disabled-option decoration is not whole-set validation: `canChoose`
validates a complete proposed selection, including atomic replacement at a limit.
Search does not narrow the set used to admit a choice.

Mounting and subscribing cause no I/O. Linked search belongs to the model:
`setSearchInput` changes the query and retires old results/paging without a read;
`reload()` performs the explicit search. Supply the existing authorized loader
through `owner.setLinkedLoader`. Recreate it when cascade/filter inputs change,
because a loader captures its inputs. Preserve selected native IDs while resetting
option paging. Accept field-specific labels only after current request guards;
never treat a table-wide record cache as field presentation authority.

Form reload is explicit. Call `owner.reload({ dirty: 'keep' | 'discard', read })`
with a fresh-load function and deliberate dirty-data choice. Keep retains edits;
new metadata may block actions but must not silently drop native data. A cancelled
or transport-failed Save retires its operation's bindings. Accepted same-context
recovery creates new bindings; retained old actions never revive. Recovery does
not replay Save or acknowledge an uncertain attempt.

## Explicit Save and uncertainty

Only a deliberate `owner.save()` dispatches Save. Supply fresh Save options and
cascade maps through its `options` parameter; mutating previously supplied options
does not update the controller's captured copy. Save uses the complete native
snapshot and dirty IDs, never renderer text or a partial visible-field record.
Preserve hidden values, metadata, order and configured parent context.

Integrate the controller's Save lifecycle with the existing `RecoveryJournal`:
preflight refusal precedes attempt creation, dispatch binds the exact attempt and
native revision, and only an accepted owned response settles that attempt. Lost,
cancelled or stale mutation outcomes remain unknown and block replay. A renderer
exception after accepted commit cannot turn the mutation back into unknown.
Inspection/acknowledgment is separate from fresh loading or mounting. See
[recovery rules](browser-lifecycle.md#inspect-an-unknown-create) and the shipped
[starter](../examples/browser/README.md#form-workflow) for the composed adapter.

Logout/Disconnect must clear visitor-owned private draft/recovery content while
retaining non-sensitive uncertainty tombstones and no-replay guards. The journal
and pending Files are memory-owned; this guide promises no exactly-once mutation
or persistence across a page refresh.

## Optional React components

Import `TextField`, `NumberField`, `CheckboxField`, `SelectField`, `LinkedField`, `AttachmentField` and
`AttachmentDialog` from `@miniextensions/sdk/react`. React is an optional peer
only for this entry point; use the supported React 18.3.1 or React 19 range from
`package.json`. No UI library is required. Each field supports a `render(state)`
function replacing its default markup, using the same snapshot/actions.

```tsx
import { TextField, type FieldProps } from '@miniextensions/sdk/react';

export function AppTextField({ binding, render }: FieldProps) {
    // Omit render to use the default; supply privacy-aware app markup to replace it.
    return <TextField binding={binding} render={render} />;
}
```

Unmount removes subscriptions, not the owner, draft or pending File identities.
React reflects the owner-held linked search query on remount and replaces it when
the binding identity changes. Neither mounting nor StrictMode starts linked reads,
uploads or Saves.

`AttachmentField` additionally takes the owner's attachment controller. Selection
and drop run admission without upload; `upload()` is explicit and uploads the first
queued File only. Status reports phases, not byte progress. Empty chooser completion
preserves pending Files; Clear removes them explicitly. Cancellation preserves
uncertainty and never automatically replays Upload. `AttachmentDialog` dismisses
only when a cancel event originates on the dialog itself. A bubbling file-input
cancel must not close the dialog, remove Files or change the draft; custom dialog
shells must preserve that event-target distinction. OS-picker Cancel/Escape,
focus handoff and screen-reader behavior still require application/browser testing.

## One Portal cell

Use `createPortalCellBinding` from `/portals` for one eligible editable cell, not a
full grid framework. Pass the accepted cell's canonical request input, physical
schema, full native value, owner/mount/configuration guard and recovery journal.
It exposes the same `binding` snapshot/actions for stock, custom or React rendering.
No Form load or attachment policy is fabricated. Attachments remain readonly
previews; nonempty conditional field/option or linked-filter configurations require
the configured child Form instead of inline editing.

Keep write eligibility and display policy separate: child-first configuration
remains write authorization; returned Portal detail configuration controls cell
and preview presentation. Capture record, table, Portal field, view, accepted
snapshot, token, client session and owner revision. Retire old row/editor actions
on replacement, including observed A→B→A. Unmount alone preserves the owner;
explicit editor replacement destroys it.

Only explicit cell `save()` calls the existing `portals.updateGridCell` adapter.
Retire old collection/action eligibility when dispatch begins. Accepted responses
settle the exact journal attempt before presentation callbacks. Lost/cancelled/stale
responses remain unknown; opening a new editor alone does not permit replay. Parent
refresh follows accepted Save separately, and a refresh failure must not make an
accepted mutation replayable. Linked paging must retain the owner-held unfiltered
admitted option list, even when displayed search results are filtered. See
[Portal helpers](portals.md) and [starter Portal controls](../examples/browser/README.md#portal-workflow).

## Memory and compatibility limits

Bindings do not store credentials or drafts in local/session storage. Keeping
non-auth draft data alone cannot restore authentication after refresh. Any opt-in
persistence needs explicit owner/Form/parent scoping, expiry/retention decisions,
sensitive-field exclusions, fresh-load validation and Logout/Disconnect clearing.
Browser storage is accessible to scripts on its origin; never silently persist
credentials or copy an administrative session into a public visitor client.

The helpers preserve native data and backend authority; they do not promise full
Form/Portal parity. Email verification uses the authentication flow's challenge
ownership, filtering uses its typed compiler and manual cleanup, and linked reads
use authorized loaders/cascades. Follow the
[configuration compatibility checklist](ui.md#review-configuration-compatibility-checklist)
before composing features. Installed synthetic tests exercise native dispatch and
lifecycle guards, not live persistence, cross-browser or accessibility certification.

## Checkbox and numeric inputs

`binding.scalar` is the renderer-neutral model for checkbox, number, currency,
percent, duration and rating fields. Its snapshot is `snapshot.scalar`; stock
`CheckboxField`/`NumberField` components and the shipped vanilla/custom renderers
use the same model. Keep the binding owner outside ordinary render/mount lifetimes
to preserve both native drafts and unfinished numeric input.

Use `binding.scalar.setChecked(boolean)` for checkbox actions and
`binding.scalar.setInput(string)` for numeric text. An empty numeric input commits
`null`; decimal/exponent syntax must produce a finite number. Incomplete or invalid
text remains in the model with a generic error, without overwriting the last valid
native value. Explicit `owner.save()` refuses invalid editable visible inputs
before journal dispatch or network I/O. Repair the text, or explicitly use
`binding.setValue(number | null)` to replace it. Direct `FormController` operations
are lower-level primitives and do not inspect renderer input models.

Percent values use native fractions: `0.25` means 25 percent. These controls do not
convert display units or add range, precision, integer or rating-limit rules;
canonical Save remains authoritative. A checkbox's initial native `null` is kept
until an explicit action writes `true` or `false`. Configured read-only, hidden,
blocked and retired bindings reject writes. Accepted explicit reload replaces the
models; old actions cannot edit the replacement. Ordinary remount does not reload
or Save.

The stock numeric React/vanilla renderer uses a text input with decimal input mode
to retain unfinished values rather than browser-sanitizing them to an empty value.
A custom render prop can supply different markup while using the same scalar
actions. Installed tests use synthetic DOM events and validation responses; they
do not certify native keyboard behavior, screen readers or backend persistence.
