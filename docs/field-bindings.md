# Headless field bindings

Use `@miniextensions/sdk/forms` to keep native Form state and behavior in the SDK
while your application supplies rendering. One owner combines the existing draft
store, Form controller, selection policies and request lifecycle. Optional
`@miniextensions/sdk/react` components use the same bindings; core imports do not
require React. This is a development preview, not a complete Form/Portal UI.

Install a built SDK TGZ before using these imports. See the
[archive and source installation instructions](../README.md#install-and-run-the-browser-starter)
and [Form helpers](forms.md). A source checkout must be built and packed first.

## Custom Form, Grid and List startup

Start here when building a custom interface instead of copying the browser
starter. The existing owners retain behavior and native data; rendering scopes
group their accepted fields and records. Your application supplies field markup,
layout, styles and vendor widgets. React is optional; these composition shells
do not supply a default Form or grid UI.

```ts
import { createFormFieldBindings } from '@miniextensions/sdk/forms';
import { createPortalListOwner } from '@miniextensions/sdk/portals';
import {
    createFormRenderScope,
    createPortalRenderScope,
    FIELD_RENDERER_SLOTS,
    type FieldRendererSlots,
} from '@miniextensions/sdk/ui';
import {
    AirtableForm,
    AirtableGrid,
    AirtableList,
} from '@miniextensions/sdk/react';
```

1. [Load and accept the current screen](auth.md#app-owned-load-and-revision)
   before constructing field or Portal owners. Handle redirects and configured
   password/login/verification first. Remembered-session restoration is explicit
   opt-in; keep provisional login private while it settles, and keep its lease
   outside renderer mounts. Storage/transport errors are not proof of logout.
2. For an accepted Form, create [one `FormFieldBindings` owner](#create-an-owner-then-mount-renderers)
   with the full native record, fresh Save options and current scope/configuration
   guards. Create [one Form render scope](#form-composition-with-app-owned-layout).
   Supply an existing page owner if you already have one; otherwise the scope
   owns its single page owner. Do not create competing drafts or navigation.
3. For an accepted Portal, create [one `PortalListOwner`](portals.md#subscribed-list-ownership-and-react-rendering),
   then [one Portal render scope](#portal-composition-with-app-owned-layout).
   It borrows that list owner and uses only accepted rows/detail projections.
   Cells are read-only unless `resolveCell` supplies an existing eligible cell
   binding. Child Form plans retain their own accepted parent/context; opening
   a child does not reuse a different child's draft or query.
4. Supply [`FieldRendererSlots<ReactNode>`](#typed-renderer-hosts-and-named-slots)
   and a layout render prop to `AirtableForm`, `AirtableGrid` or `AirtableList`.
   `FIELD_RENDERER_SLOTS` maps all 33 physical kinds to their named slots. Narrow
   the returned capability before offering actions; a slot's existence does not
   grant editing or establish feature parity. Native props are not already-safe
   display text: honor hidden, masking and returned display policy. If you supply
   a fallback, return null for hidden and retired hosts.
5. Use actions from the rendered snapshot. Form Back/Next and final Submit retain
   that page revision; Submit delegates to the existing full-native Save with
   your lifecycle/recovery bridge. Portal Load/More and criteria/child actions
   retain the accepted owner revision. Mounting performs no requests. Upload,
   Add Choice and Button actions are explicit and use their existing recovery
   resources. An uncertain mutation requires inspection/recovery, never automatic
   retry. Labels, visible rows and formatted input are never Save data.
6. Keep owners and scopes outside ordinary React mounts. Unmount only removes
   subscriptions; it preserves partial input, native drafts, Files and uncertainty.
   On visitor/session/token/client/parent or accepted configuration replacement,
   retire the old scope and owners before publishing the successor. Advance the
   observed revision even for A→B→A. Scope destruction releases its owned
   presentation resources; it does not destroy borrowed field/list/cell owners.
   [Explicit reload](#selects-linked-reads-and-reload) is separate from remounting
   and never replays an uncertain Save.

Use the existing field-specific instructions instead of duplicating policy:

| Field behavior                                        | Existing authority and rendering path                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Text, checkbox, numbers, currency, percent and rating | [Bindings](#create-an-owner-then-mount-renderers) and [scalar input models](#checkbox-and-numeric-inputs); keep unfinished input separate from the last native value.                                                                                                                                                                                  |
| Date/dateTime and duration                            | [Date models](#calendar-dates-and-explicit-offset-datetimes) and [five-format duration editing](#duration-clock-input); do not normalize native values through display text.                                                                                                                                                                           |
| Choices                                               | [Select policy and explicit Add Choice](#selects-linked-reads-and-reload); IDs identify options, native choice names are saved, and ineligible selected values remain data.                                                                                                                                                                            |
| Linked records                                        | [Form rich state and Portal pill labels](#rich-linked-record-presentation); explicit authorized reads only, exact native ID occurrences, generic unresolved presentation and field-specific metadata.                                                                                                                                                  |
| Attachments                                           | [Existing values, admission and pending files](#existing-attachment-values), [attachment policy](forms.md#attachment-presentation-and-file-admission) and [React cancellation](#optional-react-components); Form hosts need `attachmentRecovery` for upload actions. Preserve complete native metadata and apply privacy before display.               |
| Buttons                                               | [Configured Button actions](#configured-button-actions); Form hosts/scopes need `button` options. Portal hosts and Grid/List scopes borrow `buttonRecovery` and use returned detail action policy.                                                                                                                                                     |
| Collaborators                                         | Use the correlated `renderSingleCollaboratorField`/`renderMultipleCollaboratorsField` slots and native objects. [Page validation](forms.md#bounded-multipage-ownership) uses exact loaded choice IDs plus original stored IDs, without account lookup. The app supplies the picker; Portal object cells require the configured child Form for editing. |

Check compatibility before building the UI. The accepted page-owner composition
refuses configured prepared Review, compute and automatic submission, as well as
unsupported conditional-validation dependencies and condition drivers. The separate
[one-page starter Review recipe](ui.md#prepared-form-review-in-the-browser-starter)
does not enable configured Review in `AirtableForm`. Follow the
[page-owner limits](forms.md#bounded-multipage-ownership),
[visibility rules](forms.md#one-page-conditional-field-visibility) and
[Portal editor limits](portals.md#renderer-neutral-bounded-criteria-editors).
Rich nested Portal linked detail still needs field-specific accepted metadata;
pill-label support does not grant arbitrary raw-field access. Synthetic installed
and browser checks do not establish live backend acceptance, persistence,
cross-browser accessibility or downstream webhook delivery.

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
canonical Save remains authoritative. Duration clock input uses the specialization below.
A checkbox's initial native `null` is kept
until an explicit action writes `true` or `false`. Configured read-only, hidden,
blocked and retired bindings reject writes. Accepted explicit reload replaces the
models; old actions cannot edit the replacement. Ordinary remount does not reload
or Save.

## Duration clock input

Duration uses the existing `binding.scalar` owner and native numeric seconds or
`null`; there is no second draft or duration owner. `createDurationFieldModel`
is also available from `/ui` for adapters. Its format comes from the accepted
physical field's `options.durationFormat`: `h:mm`, `h:mm:ss`, `h:mm:ss.S`,
`h:mm:ss.SS` or `h:mm:ss.SSS`. Missing or unsupported formats produce generic
feedback rather than a guessed display.

Use `/react` `DurationField`, the existing `renderDurationField` slot, or a custom
renderer. Duration scalar actions include typed `setFocused(boolean)`; focusing
preserves raw input, and blurring formats the committed native seconds without
rounding or writing them. Owner lifetime stays outside mounts, so remounting keeps
unfinished input. Existing `NumberField` also recognizes duration bindings.

```tsx
import { DurationField, type FieldProps } from '@miniextensions/sdk/react';

export function DurationClock({ binding }: Pick<FieldProps, 'binding'>) {
    return (
        <DurationField
            binding={binding}
            render={({ snapshot, binding }) => {
                const input = snapshot.scalar;
                if (
                    snapshot.retired ||
                    snapshot.visibility.type !== 'visible' ||
                    input?.kind !== 'duration'
                )
                    return null;
                return (
                    <label>
                        {snapshot.field?.title}
                        <input
                            type="text"
                            value={input.input}
                            placeholder={input.durationFormat ?? undefined}
                            disabled={!snapshot.canEdit}
                            aria-invalid={!input.valid}
                            onFocus={() => binding.scalar?.setFocused?.(true)}
                            onBlur={() => binding.scalar?.setFocused?.(false)}
                            onChange={(event) =>
                                binding.scalar?.setInput(
                                    event.currentTarget.value
                                )
                            }
                        />
                    </label>
                );
            }}
        />
    );
}
```

An empty input explicitly clears to `null`; zero stays zero. A bare decimal uses
minutes for `h:mm` and seconds for the other four formats. Two components mean
hours/minutes for `h:mm`, minutes/seconds otherwise; three mean
hours/minutes/seconds for every format. A leading minus applies to the complete
duration. Overflow components are supported: `25:72` means 94,320 seconds for
`h:mm` and 1,572 seconds otherwise.

Complete input has one to three digit components. A decimal point with zero to
three following digits is allowed on a bare value or the final seconds component;
it is **not** allowed on the minutes component of a two-part `h:mm` clock.
No plus sign, exponent, spaces or fractional earlier components are admitted.
Partial or malformed text such as `-`, `1:`, `1::2` or a two-part `h:mm` value
`1:2.5` stays visible with generic feedback, preserving the last native number.
This is editor safety, not parity with canonical Moment's malformed-input-to-zero
coercion. Accepted complete parsing and presentation use pinned canonical
comparisons; displayed precision never rewrites native seconds.

Invalid editable visible input blocks existing page navigation and Save before
dispatch. Required, hidden, read-only, configuration and owner policy remain the
existing binding/page rules. Focus and blur create no Save or journal attempt.
Installed ESM/CJS, copied-starter and React proofs are synthetic; they do not
establish native keyboard behavior or backend persistence.

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

The Form adapter derives a current-record source only from an accepted edit Form. An unsaved create Form has no fabricated record source. `acceptedLinkedContext` can instead bind a Form to an accepted Portal row, even in create context: it requires the SDK list owner/revision, the same client, that owner’s accepted loaded Portal and exact record ID, with matching native table/field metadata. A copied owner or unrelated loaded Portal is refused. This linked source is paired with the accepted parent Portal token and uses that row’s returned Portal detail mode and feedback messages; a current-record source uses the accepted edit Form token and Form action configuration. The Portal adapter requires accepted listed membership, unique physical Button metadata and a visible returned detail. Returned detail configuration controls Button action settings as well as display policy. It already includes accepted upstream child settings and any custom detail overrides; the adapter does not merge child action settings again. Readonly or computed flags do not grant or deny backend action permission. Neither adapter uses inline cell Save to trigger a Button.

`triggerWebhookGET` and `triggerWebhookPOST` call only `client.buttons.triggerWebhook` with the captured field/token/source. The backend resolves the configured URL, method and permission. The model claims singleflight before host callbacks and rechecks its lease before dispatch. Observe accepted configuration changes through a monotonic `configurationRevision`; owner/session/token/source or metadata replacement retires the old model. These fences cover observed changes, not an unobserved in-place A→B→A.

The response is only `{ success: boolean }`. A true result is reported success, not proof of downstream persistence. False may mean refusal or an external failure after dispatch; it remains uncertain and is never described as a safe retry. Transport loss and cancellation after dispatch also retain uncertainty. Proven cancellation before dispatch is recorded as not dispatched. The shared journal gains a distinct Button operation/success disposition; Save, upload and Add Choice outcomes retain their semantics. Journal entries retain no Button label, URL or configured message. Models for the same current recovery relationship observe pending/uncertain guard state and update eligibility on settlement or explicit new intent. They do not copy another model's feedback. A late completion can settle its own original attempt, never publish feedback into a successor. Settled uncertainty requires explicit `acknowledgeNewIntent`; that preserves the original tombstone and performs no retry or request. Pending attempts cannot be acknowledged.

Configured success/error strings use nullish fallback, preserving an intentional empty string. A null feedback text asks the app to supply a localized default. Model disposal clears exposed field data and listeners while preserving journal disposition. Tests use fake transport and installed React custom renderers; they do not establish live cross-origin webhook readiness, native browser interaction or downstream persistence. [Form composition](#form-composition-with-app-owned-layout) and [Portal Grid/List composition](#portal-composition-with-app-owned-layout) reuse these hosts. Applications supply layout, styling and visual field renderers.

## Typed renderer hosts and named slots

`FieldRendererSlots<Result>` correlates all 33 returned `RuntimeFieldSchema`
physical kinds with their native metadata, value and optional configuration.
Slots are named after each physical kind, including `renderCheckboxField`,
`renderButtonField`, `renderSingleLineTextField` and `renderMultipleRecordLinksField`.
Use `FIELD_RENDERER_SLOTS` for the exhaustive kind-to-slot mapping, or
`dispatchField(slots, props, fallback)` outside React. These contracts supply
behavior and accepted state; applications own markup, layout, CSS and vendor widgets.

Create a host once for an accepted context, independently of renderer mounts:

```ts
import { createFormFieldRendererHost } from '@miniextensions/sdk/ui';
import type { FormFieldBindings } from '@miniextensions/sdk/forms';

export function textHost(
    fields: FormFieldBindings,
    fieldId: string,
    isCurrent: () => boolean,
    configurationRevision: () => number
) {
    return createFormFieldRendererHost({
        fields,
        fieldId,
        isCurrent,
        configurationRevision,
    });
}
```

The optional React dispatcher subscribes and invokes the matching named slot:

```tsx
import { FieldRenderer } from '@miniextensions/sdk/react';
import type { FieldRendererHost } from '@miniextensions/sdk/ui';

export function CustomFields({ host }: { host: FieldRendererHost }) {
    return (
        <FieldRenderer
            host={host}
            renderers={{
                renderSingleLineTextField: (props) =>
                    props.capability.type === 'editable' ? (
                        <input
                            value={props.value ?? ''}
                            onChange={(event) =>
                                props.capability.type === 'editable' &&
                                props.capability.setValue(
                                    event.currentTarget.value
                                )
                            }
                        />
                    ) : (
                        <span>{props.value ?? ''}</span>
                    ),
                renderCheckboxField: (props) => (
                    <span>
                        {props.value === true ? 'Checked' : 'Unchecked'}
                    </span>
                ),
            }}
            fallback={(state) =>
                state.status === 'hidden' ||
                state.status === 'retired' ? null : (
                    <span>Field unavailable.</span>
                )
            }
        />
    );
}
```

A hidden or retired host renders nothing in this recipe. The visible fallback
is reserved for unavailable, blocked or missing-renderer states; applications
can customize that messaging without changing the host's accepted state.

A Form host adapts an existing `FormFieldBindings` field. Attachment actions use
that owner's cached controller when `attachmentRecovery` is supplied. Button actions
use the accepted Button adapter when `button` options are supplied. Without these
resources, attachment upload actions are omitted and Buttons remain readonly; the
host never invents upload or webhook actions.
Capabilities expose guarded actions and detached model state, not raw bindings or
controllers. Scalar partial input, selection/search state, pending File identities,
and uncertainty remain owned by the original owners across unmount/remount. Mounting,
subscribing and rendering cause no reads, Save, upload or webhook dispatch.
Successful Add Choice metadata accepted by the Form owner refreshes presentation
without retiring unrelated field hosts. Visitor, token, context and configuration
replacement still retire the old capabilities. Attachment queue selection remains
available during an owned upload; it preserves the replacement File and does not
start another upload. Upload and native-value mutations retain their separate guards.

`createPortalCellRendererHost` adapts an existing SDK cell binding only when its
client, token, field, record, view and write configuration match the current accepted
Portal list owner. Returned detail configuration controls display; child Form
configuration, when present, controls inline writes. Inline-edit empty-value
suppression and current edit eligibility still apply. A display override cannot grant writes
against a child Form restriction. Save remains the cell owner's separate explicit action.
Native barcode and collaborator objects remain readonly in this context because the
cell-save wire format cannot carry them. Use the configured child Form to edit those
fields; the host does not advertise an unusable setter or convert their values.

`createPortalDetailRendererHost` projects one accepted listed record for Portal
cells/lists or a `linked-detail` context. It uses only that view's accepted detail
projection and physical table metadata. Hidden fields and missing physical schemas
are omitted; an explicit empty projection remains empty. It never reconstructs fields
from a global cache or fabricates editable bindings. Optional Button recovery enables
existing configured actions, whose policy remains the returned detail policy.

`physicalKind` and native metadata remain intact for computed fields. The separate
presentation descriptor exposes accepted result configuration without changing the
physical kind or granting edits. No formatter, rich renderer, collaborator picker or
vendor widget is added here. Malformed or unsupported native/presentation shapes have
an explicit unavailable fallback; they do not prune the native draft or block unrelated
Save. Optional configuration, null/missing values, array order and metadata are retained.
Writable values exclude `undefined`; absence is a read state, not a draft mutation.
Lookup answers may also retain a top-level native `{ error: string }` when the lookup
target is unavailable. This remains readonly presentation, not an array conversion.

Advance `configurationRevision` for every observed accepted replacement, including
A→B→A, and make `isCurrent` include the active mounted context. Every exposed action
rechecks the host lease before delegating to its existing owner. Cancellation stays
available during an owned pending operation. Retired callbacks cannot act on a newer
owner; unobserved in-place A→B→A is not promised. Dispose a host on context retirement,
not ordinary React unmount. Disposal releases host subscriptions and host-created
Button models, while existing drafts, cell owners, pending Files and journal entries
remain owned separately.

Installed proof covers all named-slot types, ESM/CommonJS dispatch, shared custom
markup across Form, editable cell and read-only detail contexts, and synthetic
StrictMode/remount and stale-action cases. It is not native-browser, live-backend,
webhook-delivery or persistence acceptance.

## Form composition with app-owned layout

`createFormRenderScope` from `@miniextensions/sdk/ui` groups the existing page
owner and typed field hosts for one accepted Form context. It accepts
`FormPageOwnerOptions` (`fields`, `isCurrent`, `configurationRevision`) plus
optional `pages`, `saveOptions`, `attachmentRecovery` and `button`. A supplied
`pages` must be the exact SDK page owner for the same `fields`; `scope.pages`
retains that object and `scope.ownsPages` is false. Otherwise the scope creates
one page owner and `ownsPages` is true. It adds no draft, session or navigation
owner beyond these existing resources.

Create the scope outside renderer lifetime, after accepting the Form owner:

```ts
import { createFormRenderScope } from '@miniextensions/sdk/ui';
import type { FormRenderScopeOptions } from '@miniextensions/sdk/ui';

export function createFormPresentation(options: FormRenderScopeOptions) {
    return createFormRenderScope(options);
}
```

`scope.getSnapshot()` returns `revision`, `retired`, `page`, `fields` entries
`{ fieldId, host }`, controller `status`, `canSave`, `errorMessage`,
`validationErrors` and `actions` (`back`, `next`, `submit`). The field list follows
the current page's order and omits hidden or retired hosts. `scope.subscribe`
observes the same state and returns an unsubscribe function. Every snapshot's
actions capture its page revision; retained callbacks cannot act against a later
page revision or retired context.

Optional React `AirtableForm` takes a scope, `FieldRendererSlots<ReactNode>`, an
optional field `fallback` and a required `children(state)` layout render prop.
Its state supplies `{ fieldId, node }` field entries, the same page/controller
state and revision-bound actions. The application supplies all layout, markup
and styling:

```tsx
import type { ReactNode } from 'react';
import { AirtableForm } from '@miniextensions/sdk/react';
import type { FormPageProblem } from '@miniextensions/sdk/forms';
import type {
    FieldRendererSlots,
    FormRenderScope,
} from '@miniextensions/sdk/ui';

export function CustomForm({
    scope,
    renderers,
    formatPageProblem,
}: {
    scope: FormRenderScope;
    renderers: FieldRendererSlots<ReactNode>;
    formatPageProblem: (problem: FormPageProblem) => string;
}) {
    return (
        <AirtableForm scope={scope} renderers={renderers}>
            {(state) => (
                <section>
                    {state.fields.map(({ fieldId, node }) => (
                        <div key={fieldId}>{node}</div>
                    ))}
                    {state.errorMessage && <p>{state.errorMessage}</p>}
                    {state.page.problems.length > 0 && (
                        <ul aria-live="polite">
                            {state.page.problems.map((problem, index) => (
                                <li
                                    key={`${problem.fieldId}:${problem.code}:${index}`}
                                    data-field-id={problem.fieldId ?? undefined}
                                >
                                    {formatPageProblem(problem)}
                                </li>
                            ))}
                        </ul>
                    )}
                    <button
                        disabled={!state.page.canBack}
                        onClick={() => state.actions.back()}
                    >
                        Back
                    </button>
                    <button
                        disabled={!state.page.canNext}
                        onClick={() => state.actions.next()}
                    >
                        Next
                    </button>
                    <button
                        disabled={!state.page.canSubmit}
                        onClick={() => {
                            void state.actions.submit().catch(() => {
                                // Handle a refused/stale action in your app.
                            });
                        }}
                    >
                        Submit
                    </button>
                </section>
            )}
        </AirtableForm>
    );
}
```

Page problems can block Next or Submit without a controller `errorMessage`.
Supply `formatPageProblem` from your app's localization, using the problem code
and target field ID to associate generic feedback with an answer. For example,
a `conditional-validation` problem can say “Check this answer before continuing.”
Use only authorized presentation labels if adding a field title; never echo a
configured validation message, condition, hidden driver or native answer. Problems
with a null field ID belong to the Form as a whole. Feedback updates from the same
owner snapshot and clears when the problem is resolved.

There is no default Form markup or styling. Mounting, rendering and subscribing
perform no reads, Save, upload, Add Choice or Button requests. Partial text,
number and date input, selected/pending File identities and uncertainty stay
with the original field owners across renderer remounts. React unmount and
StrictMode cleanup only unsubscribe; they do not destroy the scope.

On accepted owner/context or observed configuration replacement, retire the old
scope and create a fresh one with current resources. Advance the monotonic
configuration revision for observed replacements, including A→B→A; retired
actions never revive. `scope.destroy()` disposes its owned field hosts and only
an internally created page owner. It never destroys caller-owned `fields` or
`pages`. Dispose those resources separately at their actual ownership boundary.

Composition retains the [existing page owner's validation and configuration
limits](forms.md#bounded-multipage-ownership): configured prepared Review, compute
mode and automatic submission remain global refusals. It does not introduce a
Review flow or relax effective compute Save restrictions. Explicit final submit
delegates to the existing `fields.save` authority after page validation. Supply
fresh `saveOptions` and the existing Save lifecycle/uncertainty journal; these
options delegate to that authority and create no second journal or mutation
owner. Attachment and Button options likewise reuse their existing recovery and
permission contracts. Full native Save data and backend validation remain
owned by the existing bindings/controller.

## Portal composition with app-owned layout

`createPortalRenderScope` from `@miniextensions/sdk/ui` retains an existing
`PortalListOwner`. It groups that owner's accepted record/detail projection and
typed field hosts; it does not create a list, draft, session or mutation owner.
Create it after accepting the Portal context, outside React renderer lifetime:

```ts
import { createPortalRenderScope } from '@miniextensions/sdk/ui';
import type { PortalRenderScopeOptions } from '@miniextensions/sdk/ui';

export function createPortalPresentation(options: PortalRenderScopeOptions) {
    return createPortalRenderScope(options);
}
```

Supply `owner`, `client`, `isCurrent` and an observed `configurationRevision`.
Optional `buttonRecovery` borrows the existing Button recovery resource for
accepted row actions. Keep it outside renderer mounts, with the same accepted
owner relationship and load version; neither the scope nor its hosts dispose
the journal. Without it, Button slots retain read-only presentation. Supplying
recovery does not grant action permission or bypass current membership, session,
configuration or backend checks.

```ts
import {
    createPortalRenderScope,
    type PortalRenderScopeOptions,
    type ButtonFieldRecovery,
} from '@miniextensions/sdk/ui';

export function createPortalButtonPresentation(
    options: Omit<PortalRenderScopeOptions, 'buttonRecovery'>,
    buttonRecovery: ButtonFieldRecovery
) {
    return createPortalRenderScope({ ...options, buttonRecovery });
}
```

Snapshots contain `revision`, `retired`, the owner's state in `owner`, detached
accepted `records`, ordered `rows` (`recordId`, then `cells` with `fieldId` and
`host`) and captured `actions`. These actions delegate explicit Load, paging,
criteria/field replacement, manual cleanup acceptance/dismissal, child Form
planning and cancellation to the same existing owner. They retain the revision
that produced the render; old callbacks cannot use a newer accepted page or
criteria snapshot. Child planning returns a plan and does not load a child.

Rows use only the accepted field-scoped projection. Hidden details stay absent;
an explicitly empty projection produces no cells. Missing projections are not
reconstructed from a table cache. The owner's existing null-projection legacy
fallback is preserved. Physical computed kind and display settings stay
distinct. Returned display metadata remains presentation authority; existing
child-first inline-write authorization is unchanged.

By default cells are read-only. Optional `resolveCell({recordId, fieldId,
ownerRevision})` may return an **existing** `PortalCellBinding` for an eligible
accepted cell. The existing cell renderer host validates its record, outer
field, view, token, schema and write configuration before exposing capabilities.
The scope does not fabricate editable bindings or widen the grid wire contract.
The application owns these cell bindings and their uncertainty journal. Cache
them at that ownership boundary, not in a renderer; explicitly retire them on
real context replacement. No resolver means no inline value-write capability.
Button actions always use returned detail policy, independently of child-first
inline-write configuration. A scope reuses its row's detail Button host even
when the resolver supplies a cell, avoiding a second action model for that row
and field. Standalone `createPortalCellRendererHost` also accepts `buttonRecovery`
and keeps its existing cell provenance checks; Button actions do not become
inline cell writes.

Optional React `AirtableGrid` and `AirtableList` use the same scope and all 33
correlated `FieldRendererSlots<ReactNode>`. Both require a layout render prop.
They supply ordered cell nodes and state/actions, without a grid, list markup,
styles, virtualizer or automatic mode change:

```tsx
import type { ReactNode } from 'react';
import { AirtableGrid } from '@miniextensions/sdk/react';
import type {
    FieldRendererSlots,
    PortalRenderScope,
} from '@miniextensions/sdk/ui';

export function CustomPortal({
    scope,
    renderers,
}: {
    scope: PortalRenderScope;
    renderers: FieldRendererSlots<ReactNode>;
}) {
    return (
        <AirtableGrid scope={scope} renderers={renderers}>
            {(state) => (
                <section>
                    {state.rows.map(({ recordId, cells }) => (
                        <article key={recordId}>
                            {cells.map(({ fieldId, node }) => (
                                <div key={fieldId}>{node}</div>
                            ))}
                        </article>
                    ))}
                    {state.owner.error && <p>{state.owner.error}</p>}
                    <button
                        disabled={state.owner.pending}
                        onClick={() => {
                            void state.actions.load({
                                pagesToFetch: 1,
                                refreshLoggedInPortalRecord: false,
                            });
                        }}
                    >
                        Load
                    </button>
                    <button
                        disabled={!state.owner.hasNext}
                        onClick={() => {
                            void state.actions.more({
                                pagesToFetch: 1,
                                refreshLoggedInPortalRecord: false,
                            });
                        }}
                    >
                        More
                    </button>
                </section>
            )}
        </AirtableGrid>
    );
}
```

Use `AirtableList` with your own card/list layout in the same way. Mounting,
subscribing and rendering perform no reads, saves, uploads or webhooks. Explicit
criteria replacement retires old rows and paging; the next deliberate Load
performs the read. Manual server cleanup remains a separate explicit action.
Hidden and retired hosts never produce placeholder nodes.

The same named slot works with either composition. It renders returned text
and prepares a normal link without navigating or making a request. Webhooks
remain explicit user actions, with the existing singleflight and uncertainty
semantics described under [Configured Button actions](#configured-button-actions).

```tsx
import { createElement, type ReactNode } from 'react';
import type {
    FieldRendererProps,
    FieldRendererSlots,
} from '@miniextensions/sdk/ui';

export function PortalButtonSlot(props: FieldRendererProps<'button'>) {
    if (props.capability.type !== 'button') return null;
    const action = props.capability.button;
    const text = action.value?.label ?? props.title;
    const link = action.canLink ? action.prepareLink() : null;
    if (link) return createElement('a', { ...link }, text);
    return createElement(
        'button',
        {
            type: 'button',
            disabled: !action.canTrigger,
            'aria-busy': action.busy,
            onClick: () => {
                void action.triggerWebhook();
            },
        },
        text
    );
}

export const portalButtonSlots: FieldRendererSlots<ReactNode> = {
    renderButtonField: PortalButtonSlot,
};
```

All row hosts borrow the caller's journal. Pending or uncertain work blocks
another action for the same recovery relationship and record; another row has
its own record boundary. Host replacement preserves that journal outcome and
never retries. Explicit acknowledgment is a new intent after inspection, not
proof that the prior webhook failed. Retire old scope/hosts on real context
replacement while retaining the journal at its original ownership boundary.

React unmount and StrictMode cleanup only unsubscribe. Cell drafts, unfinished
input, pending File identities and uncertainty remain with their original
owners. `scope.destroy()` releases only its presentation hosts/subscriptions;
the caller's list owner and resolved cell bindings survive. Retire the old
scope before accepting a successor owner/context or observed configuration,
including A→B→A. Create a fresh scope for the successor, and dispose actual
list/cell owners at their own lifecycle boundary. No storage or mutation retry
is introduced.

Packed composition checks execute actual installed ESM/CJS React shells with
synthetic transport. This is distinct from native-browser, live-backend or
persistence acceptance; application rendering still owns visual and privacy
presentation of the typed props.

## Rich linked-record presentation

Native linked-field values remain arrays of record IDs. Use the accepted owner’s rich-record facet to render other fields returned for each record; do not replace the native value with record objects.

```ts
import type { FormFieldBindings } from '@miniextensions/sdk/forms';

export function inspectLinkedRecords(
    fields: FormFieldBindings,
    fieldId: string
) {
    const linked = fields.linkedRecords(fieldId);
    const stop = linked.subscribe((state) => {
        // Render selectedRecords and candidateRecords using returned physical metadata.
        // unresolvedSelectedIds identifies native IDs without accepted record data.
        console.log(
            state.selectedRecords,
            state.table,
            state.unresolvedSelectedIds
        );
    });
    // Explicit user Load/Retry action; subscribing does not dispatch this read.
    const loadSelected = () => linked.readSelected();
    return { loadSelected, stop };
}
```

### Form renderer bridge

`FieldRendererProps<'multipleRecordLinks'>` optionally carries `linkedRecords`:
`{ source: 'form', state: FormLinkedRecordsSnapshot, readSelected }`, exported as
`FormLinkedRecordsRendererProps` from `@miniextensions/sdk/ui`, one arm of
`LinkedRecordsRendererProps`. The bridge is available
on a physical linked-record field with either read-only or editable capability;
it grants no write capability. Other physical slots have no rich linked data.
This arm supports Form and accepted child Form hosts only. Portal hosts provide
the data-only pill arm described below; rich Portal detail projection and an
`accepted-detail` source remain outside this contract.

The renderer below shows presentation status and a record count. Applications
supply their own visual record renderer honoring the returned physical metadata,
detail projection, hidden fields, masking and rich display settings. This bridge
exposes existing authorized data; it does not redact that data.

```tsx
import { createElement } from 'react';
import type { FieldRendererProps } from '@miniextensions/sdk/ui';

export function RichLinkedField(
    props: FieldRendererProps<'multipleRecordLinks'>
) {
    const linked = props.linkedRecords;
    if (!linked || linked.source !== 'form')
        return createElement('p', null, 'Linked details unavailable');
    const { state } = linked;
    const policyUnavailable =
        state.selectedPolicy.state === 'waiting-data' ||
        state.selectedPolicy.state === 'unsupported';
    const presentationAvailable =
        !policyUnavailable &&
        state.table !== null &&
        state.detailProjection === 'present' &&
        state.detailFields !== null;
    return createElement(
        'section',
        null,
        createElement(
            'button',
            {
                type: 'button',
                disabled: state.pending,
                onClick: () => {
                    void linked.readSelected();
                },
            },
            'Load selected'
        ),
        createElement(
            'p',
            { role: 'status' },
            state.error
                ? 'Selected details could not be loaded'
                : state.pending
                  ? 'Loading selected details'
                  : state.phase === 'retired' ||
                      state.phase === 'unavailable' ||
                      !presentationAvailable
                    ? 'Selected details unavailable'
                    : state.detailFields!.length === 0
                      ? 'No detail fields to display'
                      : String(state.selectedRecords.length) +
                        ' selected record presentations'
        )
    );
}
```

Mounting and rendering perform zero I/O. Only clicking **Load selected** invokes
`readSelected`; policy waiting/unsupported states show generic status. IDs are
never substituted for labels. This small recipe does not establish complete rich
UI or privacy presentation: the application still owns appropriate formatting
and authorized display using the returned detail policy. Missing and null detail
projections have no fallback; a present empty array renders no details. Never
reconstruct a projection from cached fields or native IDs.

The Form host borrows the existing owner's facet. Its captured action is fenced
to that accepted owner, field and facet: replacing the facet, retiring the host,
or replacing the owner/context (including A→B→A) makes old renderer callbacks
inert. Keep the accepted Form owner alive at its actual session/configuration
boundary, and replace the host/facet when that boundary changes. Stopping or
unmounting renderers only releases presentation subscriptions; it does not cancel
reads or dispose borrowed facets. Dispose the actual owner at its own lifetime
boundary. Rich snapshots are detached presentation; native record IDs and full
Save remain the existing binding/controller's authority. No engine, cache or
implicit selected read is added.

### Portal linked-pill labels

Accepted Portal detail and eligible cell hosts add a second linked-only arm:
`{ source: 'portal-pills', items: readonly PortalLinkedPillOccurrence[] }`.
Each item has its `nativeIndex`, a `state` of `resolved`, `blank` or `unavailable`,
and a `label`. Resolved labels are strings; the other states have a null label.
The exported `PortalLinkedPillsRendererProps` contains no records, schemas,
nested detail fields, candidates or read actions. Rendering performs zero I/O.

Labels use the existing formatter and the exact target table's unique physical
primary field. They resolve only IDs in the accepted original row and field.
Current native order and duplicate occurrences are preserved. Added IDs remain
unavailable even if that record exists elsewhere in the accepted page. Missing
records, missing primary ID values, conflicting name aliases or ambiguous
primary metadata also remain unavailable; record IDs never become labels.
Blank primary formatting is explicit, and supported computed primary values use
their existing readable formatting. The bridge does not guess a primary from
the first returned field or use a Form custom-primary setting. Primary results
that require linked resolution, attachment presentation or Button behavior stay
generic rather than exposing IDs, rich metadata or actions.

Missing, null and present-empty nested rich policies expose no raw fields.
They do not remove the canonical primary-label presentation. Outer row detail
configuration is not a nested rich projection, and this arm never expands one.
Returned display policy and existing cell/child-Form write authority stay
separate; this presentation grants no edit or child-open permission.

Use plain text for labels, including HTML-looking text. This example provides a
generic item for unavailable or blank occurrences; the application owns its
visual layout and may instead omit blank pills.

```tsx
import { createElement } from 'react';
import type { FieldRendererProps } from '@miniextensions/sdk/ui';

export function PortalLinkedPills(
    props: FieldRendererProps<'multipleRecordLinks'>
) {
    const linked = props.linkedRecords;
    if (!linked || linked.source !== 'portal-pills')
        return createElement('span', null, 'Linked record unavailable');
    return createElement(
        'ul',
        null,
        ...linked.items.map((item) =>
            createElement(
                'li',
                { key: item.nativeIndex },
                item.label ?? 'Linked record unavailable'
            )
        )
    );
}
```

Supply this function as `renderMultipleRecordLinksField` in the existing
`FieldRendererSlots`. A Form renderer must narrow `source === 'form'` before
using rich state or `readSelected`; those properties do not exist on the Portal
arm. Both arms are detached presentation of the same existing native value.

The host lease binds the accepted owner, view revision, row, displayed field,
configuration and cell provenance. Paging, criteria or owner/session replacement
retires old hosts and actions; construct a fresh host from the new accepted page.
An ordinary React unmount only unsubscribes and preserves the existing cell
draft. Detached copies do not become live authorities: consume a current host
snapshot, and dispose presentation hosts at their owner/context boundary. Native
arrays and complete Save values remain owned by the existing cell or child Form.

SDK Form and Portal linked-option loaders attach detached record data to `selection.getState().linkedRecords` only after the option page is accepted. Search replaces the candidate page; pagination appends accepted records. When retained pages supply conflicting physical metadata, their common table metadata is null; an empty page with no retained records does not override the metadata of a later nonempty page. Labels still use the primary field, and selection changes still write record IDs. A missing table is distinct from returned empty physical metadata.

A Form facet accepts SDK rich pages only from the same client, token, field, and linked table. A custom option loader can still supply native choices, but replaying a page from another client or field does not provide rich-record presentation authority.

The rich Form facet’s `phase`, `pending`, and `error` describe the shared selected-hydration read. For candidate Search and More, use the existing binding’s `selection.getState()` fields `loading`, `error`, `searchTerm`, and `offset`. The facet adds no second candidate read owner; native selection and draft writes remain owned by the existing binding.

Selected candidate records remain owned by the Form facet across candidate searches and renderer unmounts, even without a subscriber or intervening snapshot read. Actual owner retirement clears that presentation. The facet’s `table` is common physical metadata from the sources of its returned selected and candidate records. Empty original hydration does not override candidate metadata. If participating sources conflict or lack metadata, `table` is null; render generic values rather than pairing a record with unrelated fields.

Form `selectedRecords` is a detached presentation of accepted native selections. Without selected policy it follows native order, including duplicate IDs. Explicit `readSelected()` hydrates original selected IDs; newly selected candidates come from accepted option pages. `detailProjection` distinguishes an absent field key (`missing`), an explicit null projection (`null`), and a returned array, including an empty one (`present`). Policy evaluation never expands that display projection, reads records, changes native membership, or changes Save data.

### Configured selected-record presentation

The facet applies supported selected-record conditions before configured sorting. It reuses strict scalar/select condition compilation and direct scalar/select sort semantics: natural case-insensitive text order, numeric comparison, configured native select-name order and multiple sort keys. Equal keys preserve occurrence order; duplicates remain separate occurrences. An explicit `filterLinkedRecordsToggle: false` or `filterApplicationMode: 'record-finder-only'` disables selected filtering, independently of sorting. Omitted application mode applies a configured filter to selected records.

Check `state.selectedPolicy` before rendering:

- `not-configured`: no active selected filter or sort; ordinary resolved presentation.
- `waiting-data`: a configured policy needs accepted metadata. Use the explicit Load/Retry action; rendering and subscribing never start a request. The facet's `phase`/`error` still describe hydration, so this state alone does not mean a request is running.
- `applied`: supported conditions and sorting were evaluated on accepted field-specific data.
- `unsupported`: configured policy cannot be evaluated safely. `supported` is false, `reasons` identifies selected condition/sort scope and generic `diagnostics` identifies missing dependencies, ambiguous metadata, unsupported policy or invalid values. `selectedRecords` is empty; this is not evidence of an empty native answer.

A missing record remains in `unresolvedSelectedIds`; it is never fetched by arbitrary ID. A missing native property is canonical empty only when its dependency field is present in the accepted physical schema. Missing or conflicting schemas must not become empty values or borrow metadata from another field/table/visitor. Dependency values are ID-keyed; an own field-name alias distinct from the ID refuses the projection, even if its value matches, so filtering and sorting cannot read different values. Formula errors and malformed dependency values refuse the entire configured projection rather than partially applying a predicate.

Calendar ordering, nested/computed/date conditions and sorts are outside this slice. Canonical child-success flows may exempt newly created records from selected filters. This facet has no accepted child-success exemption provenance, does not support flows needing that exemption, and accepts no caller-supplied bypass IDs. It does not claim full canonical selected-record parity. Native selections, dirty IDs and full Save values remain the existing binding/controller's authority even when presentation is filtered, sorted, unavailable or unresolved.

For an outer Portal list, call `owner.getRecords(owner.getSnapshot().revision)` after an accepted read. It returns detached records and physical table metadata for that field, or null while no accepted presentation exists or the revision/owner is stale. These snapshots grant no new write capability and trigger no reads. Retire the owner when its visitor, session, or configuration changes.

The installed package checks use synthetic transports for these owner and race guarantees. They do not establish live backend filtering behavior or native browser presentation.
