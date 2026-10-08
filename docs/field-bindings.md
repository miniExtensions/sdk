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

Configured Add Choice is explicit. Attach `owner.selectChoice(fieldId, recovery,
adapter)` with the same `RecoveryJournal`, accepted scope and load version as
Save/upload. This owner-held controller also appears as `binding.choiceCreation`
and `snapshot.choiceCreation`; optional React `SelectField` stock markup and a
custom `render` consume the same state/actions. Mounting never creates a choice.

`create(name)` reuses configured permission, visibility, selection limits and
conditional availability. Refused preflight creates no request or journal attempt.
Only validated current returned metadata is installed: IDs remain metadata and
canonical names remain native values. `created-selected` means selected in the
local draft; `created-not-selected` means metadata was created but current
availability prevented selection. Neither means the record was saved.

Use `cancel()` for the explicit request. Lost/cancelled/stale responses or
conflicting metadata remain uncertain and block mutation replay/Save through the
journal. Inspect current choices before explicitly acknowledging a new intent;
there is no automatic retry or rollback of a remotely created choice. Journal
entries retain no entered choice name. Acknowledgment does not claim creation
failed. Refresh the owner after acknowledgment to update renderer availability.

The adapter supplies fresh accepted `getLoaded`, `isCurrent` ownership and a
monotonic `configurationRevision` for observed replacements (including A→B→A).
The current guard must include owner/context replacement. The owner also
rechecks current field visibility and field write eligibility before accepting a
response. By default it rechecks `canWrite`. If that broad guard intentionally
blocks its own journal-pending attempt, supply `adapter.canAccept()` as an explicit
own-response write lease; it must retain all genuine UI/permission restrictions
(for example Review) while excluding only that attempt's journal block. Native draft revision, token, session and controller context are also
fenced. Unobserved in-place changes followed by restoration are not detected.
Returned choice additions survive same-owner renderer remount; dispose the owner
on replacement. Portal inline Add Choice is outside this helper.

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
The returned lifecycle operation receives `finish(disposition)` exactly once.
`not-dispatched` means the controller never invoked `forms.save`; settle the exact
journal attempt with `journal.notDispatched(attempt)`. This terminal outcome is
neither saved nor a human acknowledgment. Keep the full native draft and require
another explicit user action; never retry automatically. `dispatched` is
conservative once transport has been invoked, including synchronous transport
errors, cancellation and lost/stale responses. Keep those unknown unless an
accepted owned response proves the result. A hook must return its operation for
this final callback to be delivered; a throwing hook cannot expose an operation
it never returned. Cleanup failures must not overwrite a successor owner.

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

### Existing attachment values

`owner.attachment(fieldId, recovery)` also owns presentation of existing native
attachments. `getSnapshot()` returns visible `rows` with generic or explicitly
permitted filename labels, policy permissions and original `nativeIndex` values.
Hidden persisted add-only rows remain in the native draft and still count toward
capacity. The stock `AttachmentField` and custom render props use this same state.
No URLs or metadata are supplied in these presentation rows; Open/Download flags
are permissions only, not navigation or rendering capabilities.

Capture `valuesRevision` with each rendered row, then call
`controller.remove(valuesRevision, row.nativeIndex)`. This action rechecks current
ownership, visibility, uncertainty and the complete-value attachment policy.
It rejects stale revisions after native-array or observed configuration changes.
It removes exactly one occurrence locally, preserving all remaining metadata,
order and duplicates; only an explicit Form Save dispatches the changed answer.
It does not delete remote bytes, clear pending Files, cancel an upload, or replay
an uncertain operation. Remounts keep the owner-held native answer and pending
queue. Unobserved in-place configuration A→B→A is not detected by this contract.

Missing add-only baseline or malformed presentation yields generic unavailable
state and no removal. Canonical empty values remain untouched. Filenames require
explicit `hideAttachmentName: false`; otherwise rows say `Attachment`. Explicit
filename opt-in with no filename says `Attachment — filename unavailable`.

### Calendar dates and explicit-offset dateTimes

`binding.date` owns the date editor's input, validity, error and formatted preview.
`DateField` and `DateTimeField` from the optional `/react` entry use that same
model; their `render` prop supports custom markup without custom conversion.
The copied starter's stock and custom adapters also use this model. Keep the
binding owner through ordinary remounts; dispose it on visitor/context replacement.

Dates accept only valid calendar `YYYY-MM-DD` strings. Calendar parsing and
preview avoid a local-midnight or implicit UTC shift, including skipped civil
calendar days. DateTime editing accepts only
`YYYY-MM-DDTHH:mm:ss[.S|.SS|.SSS](Z|±HH:mm)`: seconds and an explicit offset are
required. Naive/local timestamps, week/ordinal dates, space separators, `24:00`,
leap seconds and the conservative unknown-local-offset `-00:00` are refused.
An explicit offset defines the instant; the SDK never guesses an ambiguous or
nonexistent local time from DST rules. Natural-language and date-picker behavior
remain outside this slice.

Accepted native strings are preserved byte-for-byte. `setInput` retains partial
or invalid text separately from the last accepted native answer. An editable
invalid date model blocks the owner's deliberate Form/cell Save, without an
automatic request. `clear()` or an explicit empty input writes `null`; untouched
loaded missing/null/blank answers are not normalized. Hidden/read-only native
values remain in the full Save snapshot. Backend validation stays authoritative.

Preview uses the returned canonical date/time format name-and-token pairs and
installed timezone data. `getClientTimeZone` on Form/cell owners optionally supplies
an exact client zone; otherwise the browser's exact Intl zone is used. Unknown
zones are unavailable, never guessed or substituted. Only original-client
DateTime models depend on the client zone; fixed-zone DateTime and calendar date
models do not. An observed configuration/client-zone change retires the old model;
load/reset a fresh owner. This does not detect unobserved in-place A→B→A.
Calendar preview is a narrower calendar-preserving contract, not a claim of
canonical local-normalization parity. Review's independently documented admission,
condition-driver, hide-empty, computed-field and multipage limits are unchanged.

Renderers still honor field visibility, masking and returned display policy.
Snapshots contain complete native data for application logic, not universally safe
public text. Stock date controls honor password masking and do not add rich HTML,
links or automatic formatting back into native values. Stock controls use text
inputs so partial input and explicit offsets remain visible; no native date-picker
or accessibility certification is claimed by synthetic consumer tests.

## Configured Button actions

Button values are computed or readonly native values, but value editability does not decide whether a configured action is available. The SDK owns action state; the app owns markup, navigation and localized fallback feedback. There is no default visual Button component in this slice.

```ts
import { createFormButtonFieldModel } from '@miniextensions/sdk/ui';
import type {
    FormFieldBindings,
    RecoveryScope,
    RecoveryJournal,
} from '@miniextensions/sdk/forms';
import type { MiniExtensionsClient } from '@miniextensions/sdk';

declare const fields: FormFieldBindings;
declare const client: MiniExtensionsClient;
declare const journal: RecoveryJournal;
declare const scope: RecoveryScope;
declare const loadVersion: number;
declare function ownsAcceptedForm(): boolean;
declare function configurationRevision(): number;

export const button = createFormButtonFieldModel({
    fields,
    client,
    fieldId: 'fld_button',
    recovery: { journal, scope, loadVersion },
    isCurrent: ownsAcceptedForm,
    configurationRevision,
});
// No request here. A deliberate user action uses revision-bound render props.
export const prepareButtonLink = () => button.getRenderProps().prepareLink();
```

`createButtonFieldModel`, `createFormButtonFieldModel`, `createPortalButtonFieldModel` and their option/state/render-prop types are exported by `/ui`. `useButtonField(model)` is exported only by the optional `/react` entry. The app keeps the model with its accepted host; ordinary React remounts unsubscribe without canceling or disposing it. Retire the model when replacing that host.

```tsx
import { createElement } from 'react';
import { useButtonField } from '@miniextensions/sdk/react';
import type { ButtonFieldModel } from '@miniextensions/sdk/ui';

export function AppButton({ model }: { model: ButtonFieldModel }) {
    const props = useButtonField(model);
    return createElement(
        'button',
        {
            type: 'button',
            disabled: !props.canTrigger,
            'aria-busy': props.busy,
            onClick: () => {
                void props.triggerWebhook();
            },
        },
        props.value?.label ?? 'Action'
    );
}
```

Render props contain detached native metadata/value, effective configuration, language, phase, eligibility and feedback, plus bound `prepareLink`, `triggerWebhook`, `cancel` and `acknowledgeNewIntent` actions. They contain no token, webhook source, Redux session ID or source override. Retained actions reject stale revisions. Link descriptors use `_self`, `_blank` or `_parent` (missing mode defaults to `_blank`) and the established protocol-prefix behavior: HTTP(S), mailto, tel and leading `/` are preserved; other strings receive `https://`. The app decides whether and how to navigate; preparation performs no I/O.

The Form adapter derives a current-record source only from an accepted edit Form. An unsaved create Form has no fabricated record source. `acceptedLinkedContext` can instead bind a Form to an accepted Portal row, even in create context: it requires the list owner/revision, loaded Portal and exact record ID, with matching native table/field metadata. The Portal adapter requires accepted listed membership, unique physical Button metadata and a visible returned detail. Returned detail title/display policy stays separate from child-first Button action settings. Readonly or computed flags do not grant or deny backend action permission. Neither adapter uses inline cell Save to trigger a Button.

`triggerWebhookGET` and `triggerWebhookPOST` call only `client.buttons.triggerWebhook` with the captured field/token/source. The backend resolves the configured URL, method and permission. The model claims singleflight before host callbacks and rechecks its lease before dispatch. Observe accepted configuration changes through a monotonic `configurationRevision`; owner/session/token/source or metadata replacement retires the old model. These fences cover observed changes, not an unobserved in-place A→B→A.

The response is only `{ success: boolean }`. A true result is reported success, not proof of downstream persistence. False may mean refusal or an external failure after dispatch; it remains uncertain and is never described as a safe retry. Transport loss and cancellation after dispatch also retain uncertainty. Proven cancellation before dispatch is recorded as not dispatched. The shared journal gains a distinct Button operation/success disposition; Save, upload and Add Choice outcomes retain their semantics. Journal entries retain no Button label, URL or configured message. A late completion can settle its own original attempt, never publish feedback into a successor. Settled uncertainty requires explicit `acknowledgeNewIntent`; that preserves the original tombstone and performs no retry or request. Pending attempts cannot be acknowledged.

Configured success/error strings use nullish fallback, preserving an intentional empty string. A null feedback text asks the app to supply a localized default. Model disposal clears exposed field data and listeners while preserving journal disposition. Tests use fake transport and installed React custom renderers; they do not establish live cross-origin webhook readiness, native browser interaction or downstream persistence. Grid/List aggregates and default renderer styling remain separate work.
