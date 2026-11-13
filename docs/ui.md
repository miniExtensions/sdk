# Optional selection UI

`@miniextensions/sdk/ui` provides conventional native single and multi-select
controls, a searchable linked-record picker, a bounded address autocomplete
control, and a headless selection model.
It uses browser DOM APIs and has no React or other UI framework dependency.
Importing the core client does not import this UI module. No control loads an
extension, saves a record, adds a select choice, or calls Airtable directly.

Install the customer archive in your app first:

```sh
npm install /path/to/miniextensions-sdk-0.1.0-alpha.0.tgz
```

This private development preview has not been published to npm. For a source
checkout, [install, check and pack](../README.md#build-an-archive-from-source) first,
then install the built TGZ. Installing by package name
from npm is a future release decision. Use your existing ES2022 browser bundler
and Node.js 22+ build environment. The UI module can be imported on a server,
but creating a DOM control requires a browser `Document`, or an explicitly
supplied compatible `document`. Call DOM factories after browser mounting.

The [runtime quickstart](runtime.md#packaged-form-quickstart) explains load,
draft construction, save, validation and success handling. The UI helpers below
only edit an application-owned draft. Keep hidden prefills and native field
values when building the save input. Save only from the visitor's deliberate
action; cancellation cannot undo a mutation and the SDK never retries a save
automatically.

For these controls in a complete Form and Portal application, use the shipped
[browser lifecycle guide](browser-lifecycle.md) and packaged browser starter.
You can copy the starter and install the exact supplied SDK archive without a
private repository checkout. Its application code connects selection drafts
and labels to visitor changes, save recovery, uploads, and Portal pagination.
Custom layouts and advanced presentation remain application-owned.

## Borrowed native Form rendering

`createBorrowedFormRenderScope<Submit>` is a separate host-native presentation
adapter for ordinary text and number slots. It does not acquire SDK accepted
owner provenance, create a client/controller/store, or copy a canonical draft.
The native `read` and `subscribe` ports supply committed owner/configuration
epochs and field presentation; `write` must fence that expected owner at the
native mutation boundary. Publish from committed host state, not a React render.
Observed owner/configuration replacement permanently retires old callbacks,
including A-to-B-to-A. Unsubscribing or remounting presentation does not reset
the host draft. Specialized controls remain the host's fallback responsibility.

The native `submit(expected, admitAllocation)` port retains its exact generic
result, including `void`. It must invoke the one-use admission callback after
its existing compute/coordinator waits and immediately before allocating Save.
Refused admission must not allocate. Once allocated, native ownership and
settlement continue even if presentation retires; the scope never fabricates
an SDK Save result, cancels native work, or automatically retries. Native page,
validation and Save UI remain native responsibilities. `AirtableForm` can also
present this generic scope without converting its submit result.

## Prepared Form review in the browser starter

The packaged starter's `src/review.ts` and existing DOM confirmation dialog
implement the published `promptUserBeforeSubmission` setting for bounded
one-page and manual multipage Forms with supported section conditions. Multipage
Review opens on the final available page. This is application code shipped with
the example, not a new SDK mutation or a general review renderer.

Supported physical scalar fields are single-line/multiline text, email, URL,
phone, number, currency, percent, rating, checkbox, barcode and bounded date/dateTime answers. Readonly scalar
answers participate. Labels and values use plain text APIs in published field
order; URL text never becomes a link. Semantic field titles still name values
when their visual titles are hidden. Nonempty single-line password values use
the fixed `••••••••` mask, while the native password stays unchanged for Save.

Single- and multi-select answers use the complete `getSelectFieldPolicy(schema).options`
map, matching exact native names rather than IDs, labels or current availability.
Selected but currently ineligible choices remain visible. Configured labels and
duplicate-label disambiguation follow that helper; unknown names keep their
exact bytes plus ` (unavailable)`, additional starter wording rather than canonical
presentation. Multi-select lines preserve native order and duplicate occurrences.

Linked answers use detached, already accepted field-specific presentation bound
to this loaded Form and render scope. Review never hydrates records or guesses
labels from IDs. Missing, private, rich or ambiguous presentation stays generic;
only complete authorized plain-scalar primary presentation can supply a label.
Native linked membership, order and duplicates remain unchanged. Attachment
answers use `getFormAttachmentPolicy` on the original loaded Form and complete
native value before readonly presentation: only visible rows appear, filenames
require explicit `hideAttachmentName: false`, and other rows use generic text.
Hidden persisted add-only rows expose no lines or counts. Missing required
persisted baseline or malformed nonempty answers refuse Review. Review supplies
no attachment URLs, thumbnails, metadata, actions or uploads.

The installed `createScalarFormRecordProjection` supplies a detached conditional
evaluation copy with canonical ordered section rules, including retained titles
whose visual header is disabled. Review omits condition-hidden IDs and canonical
empty answers: null/missing/blank strings, checkbox false, rating zero and blank
barcode text; empty arrays are omitted only for multi-select, linked and attachment
answers. Nonempty values still require their supported native shapes; malformed
scalar or single-select arrays refuse Review. Ordinary numeric zero stays visible.
Keep the complete native snapshot and dirty IDs for `createFormSaveInput`; Review
labels, summaries and conditional projection never become Save data. See the
[section projection contract](forms.md#one-page-conditional-field-visibility)
and the [starter's rich-answer boundaries](../examples/browser/README.md#form-workflow).

Date Review validates calendar-only `YYYY-MM-DD` values; a local timezone that
normalizes a skipped calendar day (such as Apia's 2011-12-30) causes a generic
refusal. DateTime accepts exactly `YYYY-MM-DDTHH:mm:ss`, optional 1–3 fractional
digits, and an explicit uppercase `Z` or `±HH:mm` offset (hours 00–23, minutes
00–59). Real calendar dates and hours 00–23/minutes/seconds 00–59 are required.
Naive, week/ordinal, space-separated, 24:00 and explicit unknown-offset `-00:00`
values are refused. The `-00:00` refusal is this recipe's conservative admission
rule: RFC3339
[section 4.3](https://www.rfc-editor.org/rfc/rfc3339#section-4.3) defines a known
UTC instant with an unknown local offset; it is not a wrong-instant finding.
Native bytes are never normalized for Save.

The loaded physical settings must contain exact canonical name/token pairs:
`local/l`, `friendly/LL`, `us/M/D/YYYY`, `european/D/M/YYYY`, `iso/YYYY-MM-DD`;
time is `12hour/h:mma` or `24hour/HH:mm`. Formatting reuses the installed SDK's
canonical readonly formatter, with its English locale and timezone data.
Unknown zones are refused rather than falling back. The runtime Intl timezone
is captured exactly (never approximated); a zone absent from the installed
formatter data, such as America/Coyhaique in this pinned version, is refused.
`client` is captured before
formatting on a detached configuration; only displayed, nonempty client-zone
DateTime rows require the same client zone at Confirm. Hidden/empty, date-only
and fixed-zone answers do not acquire that dependency. The date editor, date
condition drivers and edit-empty support are unchanged. Active or malformed masking/rich-display flags on date settings cause generic
refusal, not a raw fallback.

### Review configuration compatibility checklist

- Use one-page or manual multipage Forms with `promptUserBeforeSubmission`.
  Multipage Review opens on the final available page; Confirm retains all-page
  validation before final Save. Compute and automatic submission remain unsupported.
- Linked-child coordination supports one-page and manual multipage Forms, but
  requires an explicit page-owner Review adapter for configured Review. The
  browser starter does not supply a child adapter and still refuses it. See
  [linked-child Review composition](forms.md#configured-linked-child-review).
- Answers may be supported physical scalars, single/multi-selects, linked IDs or
  conservative attachment summaries and bounded date/dateTime strings. Rich-text, computed/lookup and
  other unsupported answer types remain refused, even when empty.
- Conditions must fit the supported direct noncomputed scalar projection;
  select/linked/attachment and computed/lookup condition drivers and active
  linked filtering remain unsupported. Sections are supported; section plus
  active edit-mode empty hiding still blocks presentation and Save. Rich answers
  do not broaden edit `hideFieldIfEmpty` support.
- Resolve pending file selections explicitly before Review. Pending selections
  block it; Review performs no reads, uploads or mutations.
- Capture current native data and presentation/configuration epochs. Edits,
  observed configuration/baseline changes, accepted linked-label replacement and
  owner/session/Form replacement invalidate held Confirm. This does not claim
  detection of unobserved in-place configuration A→B→A.

Barcode review reads the native text from the starter's existing readonly
display; it does not add a barcode editor.

Before capture, the starter makes its fields inert and calls each address
control's activity hook to retire pending prediction/detail intents. It binds
the dialog to the visitor/client/session, loaded Form, configuration/context,
draft handle and `FormDraftStore.revision(handle)`. Repeated-value edits still
advance that revision. Any edit, Reload, Discard, disposal, disconnect or owner
transition, including A→B→A, invalidates confirmation. The caller rechecks after
the dialog await and immediately before dispatch through its existing runner.
Restoration applies only to that card; Edit permits a fresh address gesture
without automatically querying an old value.

The dialog initially focuses **Edit**. Edit, Escape, close and stale Confirm
perform zero Saves. One explicit current Confirm passes the captured complete
native draft to the existing final Save runner once. Review can open before
required validation; the starter preserves visible control validity reads,
server validation errors and native draft on failure. Required, readonly,
computed and conditionally hidden exemptions remain the server's contract.
An unknown Save outcome keeps the scope blocked; review never replays it.
See the [starter workflow](../examples/browser/README.md#form-workflow).

## Address autocomplete

`createAddressAutocompleteControl` presents the existing typed address reads
for an editable, unmasked direct `singleLineText` Form field configured with
`enableAddressAutocomplete: true`. Its caller supplies the current Form token,
exact field ID, read adapters and a current-owner callback. The presenter
grants no field permission and never saves; the existing server still handles
authorization, provider configuration, rate limits and validation.

```ts
import {
    createAddressAutocompleteControl,
    type AddressAutocompleteOptions,
} from '@miniextensions/sdk/ui';

export function mountAddressAutocomplete(
    host: HTMLElement,
    options: AddressAutocompleteOptions
) {
    const control = createAddressAutocompleteControl({
        ...options,
        document: host.ownerDocument,
        isCurrent: () => host.isConnected && options.isCurrent(),
    });
    host.append(control.element);
    return {
        control,
        setActive: control.setActive,
        dispose() {
            control.destroy();
            control.element.remove();
        },
    };
}
```

Use `client.addresses` as the `reads` adapter, bound to the same captured
visitor/session as your current loaded Form. Check visitor, client, session,
loaded Form, field and visibility in `isCurrent()` before accepting any
callback. Write `onChange`'s accepted string to that field's native draft and
mark it dirty. These reads are field-local: they must not make the Form inert
while the visitor continues typing. Predictions wait 800 ms after the latest
nonblank edit; suggestions are plain text. Arrow keys move the visible
highlight while focus stays in the input. The control supplies contrasting
background/text and an outline without requiring an application stylesheet.
Enter accepts the highlighted suggestion without submitting the Form, Escape
dismisses pending suggestions, and Clear preserves focus on the input.

During text composition, the control retires existing suggestions and preserves
the unfinished input buffer without applying the character cap, accepting a
draft edit, or starting a lookup. `compositionend` commits the final text and
starts the normal debounce. Composing keyboard events, including the legacy
key code 229 marker, remain available to the input rather than selecting or
dismissing an address. Replacing or suspending the control retires that
composition intent; a late end event does not restart it.

The `reads` adapter must supply the existing Google-backed address results.
The control attributes those results to Google Maps using the unchanged
official logo inside the bordered suggestions container, outside its selectable
listbox. The logo displays at 98 × 18 pixels on white with 10 pixels of clear
space above and at each side, and 5 below. It has the accessible name
“Google Maps” and disables translation. The container and attribution retire
together when suggestions close. Do not use this presenter for results from
another provider or obscure its attribution.

The PNG is embedded as a data URL; it makes no additional network request.
Applications with a Content Security Policy must permit `data:` in
`img-src` for this logo. Its provenance and Google's applicable attribution
policies are recorded in [third-party notices](../THIRD_PARTY_NOTICES.md#google-maps-attribution-asset);
the asset is not covered by the SDK's MIT license.

A chosen description becomes the accepted value immediately. Place details
replace it only for the same current owner and selected-place intent. Failures
retain manual/selected data and offer an explicit retry; there is no automatic
request retry or Save. The optional `characterLimit` caps all newly accepted
manual, description and formatted-detail values. Null/undefined is uncapped;
zero accepts empty text. Supplied loaded values and `setValue` replacements
remain intact until an edit. Negative, fractional or nonfinite limits throw
`AddressAutocompleteConfigurationError` with code `invalid-character-limit`.
The starter displays an unavailable-suggestions hint and keeps manual entry
for that unsupported configuration.

Call `setActive(false)` when the field hides, becomes blocked, or the Form
becomes inert for a mutation/recovery decision. It aborts reads, cancels the
timer and retires both generations without clearing native data. Reveal with
`setActive(true)` permits new input without repeating an old query. Destroy
the control when its owner or field changes, including A→B→A and disconnect.
An owner callback alone does not retire a hide→reveal intent. Abort alone does
not protect against an adapter that resolves late.

The starter wires this control only for editable direct single-line text.
Masked/read-only/computed/lookup fields retain their ordinary presentation and
do not request suggestions. Query limits remain request limits: the existing
server trims and accepts 1–200-character queries and 1–256-character place IDs;
an oversized query can fail while its native manual draft remains usable.
This control supplies no map, geocoding, address parser or multi-field address
model. Installed recipe checks exercise the actual shipped fence and starter;
they do not establish provider availability or backend persistence.

### Reuse the request lifecycle with an existing renderer

`createAddressAutocompleteRequests` shares the same request lifecycle without
creating DOM or storing a draft. The native control above delegates to it.
React and other existing renderers can supply two read closures:
`reads.listPredictions(query, { signal })` and
`reads.getFormattedAddress(placeId, { signal })`. Capture the existing token,
field identity and authorized client or host tRPC query in those closures;
the coordinator acquires no credentials, chooses no endpoint and never saves.

Supply `isCurrent()` for the captured owner, synchronous `onValue(value, source)`
for accepting a selected description or formatted detail, and optional
`onStateChange(state)` for presentation. `source` is `selection` or `detail`.
Returning `false` declines a value and retires that intent. The caller retains
its cap, normalization, writer admission, focus, native input and dirty state.
Snapshots are immutable; `getState()` returns the latest snapshot.

| Existing renderer action                                     | Coordinator operation                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Accept manual text and request suggestions                   | Retire prior intent before the edit callback, then call `schedulePredictions(query)` with the caller-approved query |
| Accept an option                                             | `select(prediction)` with the exact entry from the current snapshot                                                 |
| Retry a failed read                                          | `retry(currentQuery)`; failed details retry their selected place, predictions use the supplied current query        |
| External value replacement, clear, hide or composition start | `retire()` before accepting the replacement or inactive state                                                       |
| Owner replacement or unmount                                 | `destroy()`; retained commands cannot restart it                                                                    |

Scheduling retires previous work and waits 800 ms. The coordinator does not trim,
cap or suppress empty queries: the native control retains its nonblank policy,
while an existing host may preserve its own query policy. Selection immediately
emits the description before reading details. Failures expose a phase, retain
the caller's value and offer explicit retry; raw provider errors are not exposed.
Old predictions, detail results and failures cannot update current state after
retirement, even when a read adapter ignores abort. A cloned or retired prediction
entry is not a current selection and is ignored.

State notifications may synchronously retire or destroy the coordinator. Owner
and intent checks run again before dispatch and value application. Callbacks
must be synchronous; resolve any external decision before calling these methods.
An owner predicate alone cannot detect hide/reveal or external-value A-to-B-to-A
transitions: call `retire()` at those boundaries. Loaded values and the host's own
capped-value echo tracking remain with the host adapter. This API supplies no
read-only permission, persistence, provider configuration or automatic retry.

## Native single and multi-selects

`createSelectControl` renders a labeled native `<select>`. It accepts loaded
`RuntimeFieldSchema` metadata and emits native Airtable values: a choice name
or `null` for single-select, and an array of choice names for multi-select.
Choice IDs are metadata identifiers; do not save those IDs as select values.
The wrapper handles native keyboard interaction and owns its selection model.
Call `destroy()` when removing it.

The control applies the published `singleOrMultiSelectLimitSelectionOptions`
by choice ID. An absent or empty list permits all returned choices. Existing
native names outside that list remain visible and removable; after removal
they cannot be selected again. `maxNumberOfSelections` blocks additions beyond
the configured numeric count without truncating loaded values, so an existing
over-limit value can still be reduced. Controlled `setValue`/`reset` updates
may supply the owner's loaded baseline; they do not emit a user change.

`getSelectFieldPolicy(schema)` exposes this static policy for application
actions. Its `allowAddingNewOptions` is false for computed/read-only fields
and for every nonempty choice-ID allowlist, even if `allowAddingNewOptions`
is true. The browser starter applies it again at the Add Choice action.
Configured option names are trimmed display labels only when
`enableConditionalOptions` is true; duplicate labels include the canonical
name. Values sent to a Form or Portal remain canonical choice names.

The browser starter uses this same control for Form selects and Portal inline
select edits. The Portal uses the configured child Form field policy when
present, otherwise the returned detail-field policy. It preserves the native
baseline order on unchanged saves, retains unavailable or over-limit values
for removal, and rejects injected native selections outside static policy.
Portal inline editors have no Add Choice action. Their explicit Save remains
bound to the current visitor revision, field and view; replace a stale editor
through a fresh Portal read. This does not evaluate conditional visibility.

The canonical Portal route denies inline editing when the effective field
config has nonempty conditional fields/options or active linked-record filters.
The starter omits that inline action, including when an option entry supplies
only a display label or `enableConditionalOptions` is false. Use the eligible
configured child Form when that workflow is required; its select control can
display those labels. Static limits alone do not add inline write authority.

`createSelectControl` and `getSelectFieldPolicy` alone apply static policy.
For configured scalar choice conditions, compose the control with
[`resolveSelectFieldAvailability`](#configured-scalar-choice-availability).
Other conditional presentation remains application-owned; static limits and
labels alone do not establish that a conditional choice is currently available.
The canonical server retains validation and authorization.

Each convenience control stays bound to that field schema and single/multi
mode. Recreate it if the field identity or schema changes. Use
`control.model.setValue` for controlled value updates; its model uses arrays of
choice names even when the native single-select value is one name or `null`.
For async or changing option sources, use the headless/mounted picker below.

This complete helper loads a Form and mounts two configured fields. Pass an
existing client, your actual `LoadExtensionInput`, an empty host element, and
the field IDs from your published Form. It performs no save.

```ts
import {
    AirtableFieldType,
    type AirtableValue,
    type LoadExtensionInput,
    type MiniExtensionsClient,
} from '@miniextensions/sdk';
import {
    createSelectControl,
    type SelectControl,
} from '@miniextensions/sdk/ui';

export async function mountFormSelects(
    client: MiniExtensionsClient,
    input: LoadExtensionInput,
    host: HTMLElement,
    fieldIds: { single: string; multiple: string },
    signal: AbortSignal
) {
    const form = await client.loadExtension(input, { signal });
    signal.throwIfAborted();
    if (form.extensionScreen !== 'form_loaded') {
        throw new Error('Handle the returned login/password/redirect first.');
    }
    const data: Record<string, AirtableValue> = {
        ...form.payload.formRecord.data,
    };
    const changed = new Set<string>();
    const expected = [
        [fieldIds.single, AirtableFieldType.SINGLE_SELECT],
        [fieldIds.multiple, AirtableFieldType.MULTIPLE_SELECTS],
    ] as const;
    // Validate both fields before mounting either one.
    const schemas = expected.map(([fieldId, type]) => {
        const field = form.payload.fieldIdsToSchemas[fieldId];
        if (
            !form.payload.fieldIdsInForm.includes(fieldId) ||
            field?.fieldType !== type
        ) {
            throw new Error(`Choose a configured ${type} field: ${fieldId}`);
        }
        return field;
    });
    const controls: SelectControl[] = [];
    try {
        for (const field of schemas) {
            controls.push(
                createSelectControl({
                    field,
                    value: data[field.airtableField.id],
                    onChange(value) {
                        data[field.airtableField.id] = value;
                        changed.add(field.airtableField.id);
                    },
                })
            );
        }
    } catch (error) {
        for (const control of controls) control.destroy();
        throw error;
    }
    host.replaceChildren(...controls.map((control) => control.element));
    let destroyed = false;
    return {
        form,
        getDraft: () => ({ ...form.payload.formRecord, data: { ...data } }),
        getChangedFieldIds: () => [...changed],
        destroy() {
            if (destroyed) return;
            destroyed = true;
            for (const control of controls) {
                control.destroy();
                control.element.remove();
            }
        },
    };
}
```

Add `getChangedFieldIds()` to the loaded dirty/prefill IDs when constructing
`SaveFormInput`; use `getDraft()` for its `formRecord`. Handle all server
validation errors before treating the save as successful, as the runtime
guide shows. A field's presence and an enabled control do not grant write
permission. The wrapper respects computed and `miniExtConfig.readOnly` hints;
the published extension and backend enforce visitor, record and action rules.

Unsupported field kinds, mismatched schema types, duplicate/malformed choices
and incorrectly shaped values throw. Handle this as an unavailable field in
your app rather than guessing a different input type. Empty canonical choices
produce an empty selector; the wrapper never invents options. It preserves a
persisted name absent from current choices for display, without offering that
name as a new choice.

Native multi-select uses the operating system's keyboard conventions, including
Command/Control and Shift. Use the searchable mounted control when you want
visible checkbox/radio choices and individual remove buttons.

## Configured scalar choice availability

`resolveSelectFieldAvailability` evaluates configured `conditionsForOption`
using the [scalar condition compiler](forms.md#compile-scalar-runtime-conditions)
and the formula runner's typed outcome. Pass a current `RuntimeFieldSchema`,
returned `RuntimeAirtableField` metadata, a caller-projected canonical
`AirtableRecord` or `null`, and explicit `mode` and `invalidConditionMode`.
The result contains `status`, eligible `options`, the static `policy`, and
finite diagnostic codes. It performs no read, save, record projection or
selection change.

Rules match canonical choice IDs, and the first matching rule wins, including
a rule with absent or null conditions. Unmatched choices are unrestricted by
dynamic conditions once the required projected record is present. For editable
schema policy, eligible options intersect the static choice-ID allowlist; values remain
canonical choice names and labels remain presentation. Disabled conditional
configuration, read-only fields and `mode: 'configuration-preview'` bypass
evaluation. Every enabled runtime editable dynamic field requires a projected
record; a missing record blocks the whole field, even when every matching rule
has absent or null conditions or there is no matching rule.
Readonly or computed schema policy preserves all current choices for display,
including those outside a static allowlist. Configuration-preview mode on an
otherwise editable schema retains that schema's static limits.

Supported option rules include the scalar compiler's operators and nested AND/OR
groups, plus exact-ID direct noncomputed single-select and multi-select predicates.
Single-select supports `is`, `isNot`, `isAnyOf`, `isNoneOf`, `isEmpty`, `isNotEmpty`;
multi-select supports `hasAnyOf`, `hasAllOf`, `hasNoneOf`, `isExactly`, `isEmpty`,
`isNotEmpty`. Operands are exact choice IDs; native values remain names. Deleted
operand IDs retain the compiler's unknown/partial-known-choice semantics.
Select dependencies are checked on the original AST and native record, including
rules compiled to `FALSE()`. Name references, computed select drivers, physical
type drift and malformed native select values refuse conservatively. Both modes
block unsupported conditions; strict
mode rejects incomplete rules, while compatibility mode can omit incomplete
rules when a complete sibling survives. A missing scalar metadata driver follows
the compiler's `FALSE()` leaf semantics, so an OR sibling can still match. Missing
select metadata blocks through original-AST inspection. The
availability helper does not promote compiler warnings to failures. A failed
compile or evaluation blocks the whole field with no eligible options.
Emitted field references with ambiguous current ID/name metadata, including a
field name that shadows another native field ID, are unsupported. The helper
does not change the shared formula engine's legacy lookup behavior.
Diagnostics contain only `unavailable-record`, `unsupported-condition`,
`invalid-condition` or `evaluation-error`; they expose no raw errors, formulas,
record values or condition IDs.

Record projection belongs to the caller. Supply the same accepted native
record and metadata used by your presentation, including any required hidden
field or linked-value projection. The helper neither reconstructs hidden
fields nor hydrates linked records. The Form owner and browser starter use the
internal Form projection for supported one-page and multipage rules
with current noncomputed scalar/select dependencies and canonical ordered sections. It evaluates every field
predicate against the same complete accepted draft, then removes condition-hidden
IDs only from a detached evaluation copy and recomputes after accepted edits.
Configured choices use this projected record in a separate second phase; the
adapter retains its configured, noncomputed driver guards. Hidden values
remain in the complete native Save record. Active linked filtering and referenced
linked/lookup/computed drivers remain unavailable; native empty hiding and
readonly display do not independently prune the conditional copy. Section plus
active edit empty hiding remains blocked. The older
`createFlatScalarFormRecordProjection` export retains its flat contract and
section refusals; the public scalar projection exports also retain their select
driver refusal. See the
[projection rules](forms.md#one-page-conditional-field-visibility); broader
projection and presentation workflows remain application-owned.

This complete browser recipe mounts one select into an empty host. The caller
owns the accepted field/metadata snapshot, projected record, native baseline
and draft. After accepting a driver edit, call `updateRecord` with the newly
projected record. Recreate the control for a changed field, schema, visitor or
Form; `isCurrent` must recognize those transitions. The callback receives only
deliberate user edits. No request or save occurs.

```ts
import type {
    AirtableRecord,
    AirtableValue,
    RuntimeAirtableField,
    RuntimeFieldSchema,
} from '@miniextensions/sdk';
import {
    createSelectControl,
    resolveSelectFieldAvailability,
    type SelectControl,
} from '@miniextensions/sdk/ui';

export function mountConfiguredScalarChoice(
    host: HTMLElement,
    input: {
        field: RuntimeFieldSchema;
        airtableFields: readonly RuntimeAirtableField[];
        recordForConditionEvaluation: AirtableRecord | null;
        value: AirtableValue;
        mode: 'runtime' | 'configuration-preview';
        invalidConditionMode: 'compatibility' | 'strict';
        readOnly?: boolean;
        isCurrent: () => boolean;
        onChange: (value: AirtableValue) => void;
    }
) {
    const field = structuredClone(input.field);
    const airtableFields = structuredClone(input.airtableFields);
    const status = host.ownerDocument.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'Choice availability unavailable.';
    let disposed = false;
    let ready = false;
    let control: SelectControl | null = null;
    const isCurrent = () => {
        try {
            return !disposed && input.isCurrent();
        } catch {
            return false;
        }
    };
    try {
        control = createSelectControl({
            field,
            value: structuredClone(input.value),
            disabled: true,
            readOnly: input.readOnly === true,
            document: host.ownerDocument,
            onChange(value) {
                if (!isCurrent()) {
                    ready = false;
                    control?.model.setDisabled(true);
                    return;
                }
                input.onChange(value);
            },
        });
    } catch {
        // Do not render raw exceptions or condition details.
    }
    host.replaceChildren(...(control ? [control.element, status] : [status]));

    const updateRecord = (
        record: AirtableRecord | null
    ): 'ready' | 'blocked' => {
        ready = false;
        if (disposed || control === null) return 'blocked';
        control.model.setDisabled(true);
        try {
            if (!isCurrent()) {
                control.model.setOptions([]);
                status.textContent = 'This selector is no longer current.';
                return 'blocked';
            }
            const result = resolveSelectFieldAvailability({
                field,
                airtableFields,
                recordForConditionEvaluation: structuredClone(record),
                mode:
                    input.readOnly === true
                        ? 'configuration-preview'
                        : input.mode,
                invalidConditionMode: input.invalidConditionMode,
            });
            ready = result.status === 'ready' && isCurrent();
            // Replace eligible options only. Keep selected native values intact.
            control.model.setOptions(ready ? result.options : []);
            control.model.setReadOnly(
                input.readOnly === true || result.policy.readOnly
            );
            // A current blocked field still permits removal of retained values.
            control.model.setDisabled(!isCurrent());
            status.textContent = ready
                ? 'Choices available.'
                : 'Choice availability unavailable.';
            return ready ? 'ready' : 'blocked';
        } catch {
            control.model.setOptions([]);
            control.model.setDisabled(!isCurrent());
            status.textContent = 'Choice availability unavailable.';
            return 'blocked';
        }
    };
    updateRecord(input.recordForConditionEvaluation);
    return {
        updateRecord,
        dispose() {
            if (disposed) return;
            disposed = true;
            ready = false;
            control?.destroy();
            control?.element.remove();
            status.remove();
        },
    };
}
```

`model.setOptions` changes eligible choices without clearing the current
selection or emitting a user-change callback. A selected name that becomes
denied remains visible and, while the owner is current and editable, removable;
once removed it cannot be added again unless it becomes eligible. Never append
retained denied values to the returned eligible options. A current blocked
field offers no new choices and still permits removal; it keeps its draft
for recovery. A stale owner disables the control. Read-only metadata remains effective. The caller's
`readOnly` flag uses configuration-preview availability and keeps the control
read-only, without emitting edits. Dispose before replacing the owner or host.
Availability is a presentation result; preserve hidden prefills and dirty IDs,
and let the canonical server validate any later deliberate save. Portal inline
eligibility continues to follow its separate conditional-configuration restrictions above.

## Authorized linked-record selection

The linked adapters call the existing `listFormOptions` and
`listPortalOptions` operations with `viewType: 'list'`, current search text,
returned page offset and an `AbortSignal`. They keep record IDs as values and
derive labels from returned primary-field metadata. If a label cannot be
resolved, the record ID remains visible. They never request direct Airtable
credentials or infer access from a label.

This Form helper uses a loaded, canonical linked field. The optional selected
record hydration reads only the Form's existing selected records; it does not
accept arbitrary IDs to look up. Abort and dispose it before replacing the
visitor, token, context, field or conditional filtering values.

```ts
import {
    AirtableFieldType,
    type ConditionalLinkedRecordFilteringValues,
    type FormLoadedResult,
    type MiniExtensionsClient,
    type RuntimeTableStates,
} from '@miniextensions/sdk';
import {
    createFormLinkedRecordLoader,
    createSelectionModel,
    mountSelectionControl,
    selectionOptionsFromRecords,
} from '@miniextensions/sdk/ui';

export async function mountFormLinkedField(
    client: MiniExtensionsClient,
    form: FormLoadedResult,
    fieldId: string,
    host: HTMLElement,
    signal: AbortSignal,
    filteringValues: ConditionalLinkedRecordFilteringValues
) {
    const field = form.payload.fieldIdsToSchemas[fieldId];
    if (
        !form.payload.fieldIdsInForm.includes(fieldId) ||
        field?.fieldType !== AirtableFieldType.MULTIPLE_RECORD_LINKS ||
        field.airtableField.config.type !==
            AirtableFieldType.MULTIPLE_RECORD_LINKS
    ) {
        throw new Error('Choose a linked field configured in this Form.');
    }
    const config = field.airtableField.config;
    if (typeof config.options.prefersSingleRecordLink !== 'boolean') {
        throw new Error('Expected canonical linked-field selection metadata.');
    }
    const rawValue = form.payload.formRecord.data[fieldId];
    if (
        rawValue != null &&
        (!Array.isArray(rawValue) ||
            rawValue.some((id) => typeof id !== 'string'))
    ) {
        throw new Error('Expected linked-record IDs as an array.');
    }
    const value = rawValue == null ? [] : (rawValue as string[]);
    const loadOptions = createFormLinkedRecordLoader({
        client,
        linkedTableId: config.options.linkedTableId,
        input: {
            extensionAccessToken: form.payload.extensionAccessToken,
            linkedRecordFieldId: fieldId,
            conditionalLinkedRecordFilteringValues: filteringValues,
        },
    });
    const session = client.getSession();
    const tables: RuntimeTableStates =
        value.length === 0
            ? {}
            : await client.linkedRecords.loadSelectedRecords(
                  { extensionAccessToken: form.payload.extensionAccessToken },
                  { session, signal }
              );
    signal.throwIfAborted();
    if (loadOptions.isCurrent?.() === false) {
        throw new Error(
            'Visitor changed; recreate the field for the new scope.'
        );
    }
    const table = tables[config.options.linkedTableId];
    const selectedRecords = value.flatMap((id) => {
        const record = table?.recordIdsToAirtableRecords[id];
        return record == null ? [] : [record];
    });
    let draftValue = [...value];
    const model = createSelectionModel({
        multiple: !config.options.prefersSingleRecordLink,
        value,
        selectedOptions: selectionOptionsFromRecords(selectedRecords, table),
        loadOptions,
        readOnly:
            field.airtableField.isComputed === true ||
            (field.miniExtConfig != null &&
                'readOnly' in field.miniExtConfig &&
                field.miniExtConfig.readOnly === true),
        onChange(ids) {
            draftValue = [...ids];
        },
    });
    const control = mountSelectionControl(model, {
        label: field.airtableField.name,
        description: 'Search the records available to this visitor.',
    });
    host.replaceChildren(control.element);
    let destroyed = false;
    const destroy = (): void => {
        if (destroyed) return;
        destroyed = true;
        signal.removeEventListener('abort', destroy);
        control.destroy();
        model.destroy();
        control.element.remove();
    };
    signal.addEventListener('abort', destroy, { once: true });
    try {
        signal.throwIfAborted();
        await model.reload(); // Mounting alone does not fetch.
        signal.throwIfAborted();
        if (loadOptions.isCurrent?.() === false) {
            throw new Error(
                'Visitor changed; recreate the field for the new scope.'
            );
        }
        return { model, getDraftValue: () => [...draftValue], destroy };
    } catch (error) {
        destroy();
        throw error;
    }
}
```

Use the returned ID array as the linked field's native draft value and mark
that field dirty. A single linked selection still uses an array with zero or
one record ID. A persisted selected ID may be absent from a searched page:
the model retains its supplied label, or displays the ID until hydrated. Search
and paging never silently remove selected values. `selectedOptions` supplies
display labels; it does not authorize adding those IDs to a new selection.

For a Portal grid editor, use the Portal adapter with its current loaded token,
the configured Portal relationship field, and the actual linked field in that
relationship's returned table metadata. The Portal field and the cell's linked
field are different IDs. This factory returns a headless model for your editor
to mount; it performs no grid update. Supply `readOnly` from the canonical
column/action configuration instead of assuming every returned field is editable.

```ts
import {
    AirtableFieldType,
    type MiniExtensionsClient,
    type PortalLoadedResult,
    type RuntimeTableState,
} from '@miniextensions/sdk';
import {
    createPortalLinkedRecordLoader,
    createSelectionModel,
} from '@miniextensions/sdk/ui';

export function createPortalCellPicker(options: {
    client: MiniExtensionsClient;
    portal: PortalLoadedResult;
    portalFieldId: string;
    portalTableId: string;
    portalTable: RuntimeTableState;
    recordFieldId: string;
    value: readonly string[];
    readOnly: boolean;
    onChange: (ids: readonly string[]) => void;
}) {
    const { portal, portalFieldId } = options;
    const relationship = portal.payload.fieldIdsToSchemas[portalFieldId];
    const recordField = options.portalTable.airtableFields.find(
        (field) => field.id === options.recordFieldId
    );
    if (
        !portal.payload.fieldIdsInPortal.includes(portalFieldId) ||
        relationship?.fieldType !== AirtableFieldType.MULTIPLE_RECORD_LINKS ||
        relationship?.airtableField.config.type !==
            AirtableFieldType.MULTIPLE_RECORD_LINKS ||
        relationship.airtableField.config.options.linkedTableId !==
            options.portalTableId ||
        recordField?.config.type !== AirtableFieldType.MULTIPLE_RECORD_LINKS ||
        typeof recordField.config.options.prefersSingleRecordLink !== 'boolean'
    ) {
        throw new Error(
            'Expected current canonical Portal/table/linked-field metadata.'
        );
    }
    return createSelectionModel({
        multiple: !recordField.config.options.prefersSingleRecordLink,
        value: options.value,
        readOnly: options.readOnly || recordField.isComputed === true,
        onChange: options.onChange,
        loadOptions: createPortalLinkedRecordLoader({
            client: options.client,
            linkedTableId: recordField.config.options.linkedTableId,
            input: {
                extensionAccessToken: portal.payload.extensionAccessToken,
                linkedRecordFieldId: recordField.id,
                portalTableId: options.portalTableId,
                portalFieldId,
            },
        }),
    });
}
```

To hydrate Portal labels, pass the already authorized selected records and
their corresponding returned table state to `selectionOptionsFromRecords`,
then pass those options to `model.setValue(ids, labels)`. Do not use Form-only
`loadSelectedRecords` as a general Portal or arbitrary-record lookup.

**The mounted picker does not provide cascading/dynamic filter controls.**
Applications can use the typed
`client.linkedRecords.listConditionalFilterPrimaryValues` runtime operation to
discover configured Form filter values. See the
[conditional filter runtime guide](./runtime.md#conditional-linked-filter-primary-values)
for ordered filter context, returned record/value pairs, URL prefills and
application-owned cancellation and downstream resets. Supply the selected
filter values to the Form loader and recreate it when they change. Do not invent
options, query Airtable directly or omit values to bypass configured filtering.
Calendar selectors and creating options/records are separate runtime operations;
the mounted picker does not provide those workflows.

## Headless model and lifecycle

`createSelectionModel` also works without DOM mounting. Subscribe to copied
state snapshots and render with your framework. `subscribe` emits immediately
and returns an unsubscribe function. `choose`, `toggle` and `clear` represent
user changes and call `onChange`. `setValue`, `setOptions` and `reset` represent
application updates and do not call it. Values remain strings inside the
model; convert them to the field's native value at your draft boundary.

`setSearchTerm` starts a fresh first page. `reload` repeats the current search;
`loadMore` uses only the latest returned offset. The model de-duplicates options
by value, preserves selected labels across page/search changes, aborts obsolete
requests and discards late responses even if a loader ignores cancellation.
Transport errors appear in `state.error`; your renderer decides whether to
offer Retry. There is no automatic retry loop.

`disabled` blocks every interaction. `readOnly` permits search and paging but
blocks selection, removal and clearing. Unknown or disabled new choices are
ignored. Application `setValue` can restore authorized persisted values absent
from the current options; it is not a permission check.

Create one client and model per visitor. SDK loader factories capture a copy of
the request input and client session. If client credentials change, their
freshness guard invalidates old choices and prevents selecting from that old
credential scope. The application must still destroy/reset and recreate the
loader on every visitor, extension token, record, field, filter or context
change, including two anonymous visitors with identical empty sessions and an
A → B → A credential sequence. `isCurrent` compares current credential contents,
not a session generation; credentials alone cannot identify those transitions.

For a reused model, call `model.reset({value: [], selectedOptions: [],
loadOptions: newLoader, ...})` before loading the new visitor. Do not carry
previous visitor labels or values into that reset. A new loader must use the
new loaded token and canonical field/context input. `cancel()` stops the active
read; `destroy()` aborts work and removes listeners. A mounted control's
`destroy()` removes its own DOM handlers/subscription; remove its element
separately and destroy a model you created. The native select wrapper's
`destroy()` owns its handlers and model.

## React and Next integration

You can mount these controls inside a client component without adding a React
peer dependency to the SDK. This example uses your app's existing React
installation. Keep the loaded `field` object stable within a scope. Construct
`scopeKey` in application memory from visitor/context identity and a token
generation; do not render credentials in HTML. Change it on login/logout,
record/context/filter changes and fresh loaded tokens, including anonymous
visitor changes.

The setup effect depends on field identity and scope only. Latest value and
callback refs avoid remounting on each edit, so focus survives controlled-value
updates. The second effect synchronizes native values into the existing model.

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import {
    AirtableFieldType,
    type AirtableValue,
    type RuntimeFieldSchema,
} from '@miniextensions/sdk';
import {
    createSelectControl,
    type SelectControl,
} from '@miniextensions/sdk/ui';

export function SdkSelect(props: {
    field: RuntimeFieldSchema;
    scopeKey: string;
    value: AirtableValue;
    onChange: (value: AirtableValue) => void;
}) {
    const { field, scopeKey, value, onChange } = props;
    const host = useRef<HTMLDivElement>(null);
    const control = useRef<SelectControl | null>(null);
    const current = useRef({ value, onChange, scopeKey });
    current.current = { value, onChange, scopeKey };
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const node = host.current;
        if (node == null) return;
        let mounted: SelectControl;
        try {
            mounted = createSelectControl({
                field,
                value: current.current.value,
                onChange(nextValue) {
                    if (current.current.scopeKey === scopeKey) {
                        current.current.onChange(nextValue);
                    }
                },
            });
        } catch (cause) {
            setError(
                cause instanceof Error ? cause.message : 'Field unavailable'
            );
            return;
        }
        setError(null);
        control.current = mounted;
        node.replaceChildren(mounted.element);
        return () => {
            mounted.destroy();
            if (control.current === mounted) control.current = null;
            node.replaceChildren();
        };
    }, [field, scopeKey]);

    useEffect(() => {
        const mounted = control.current;
        if (mounted == null) return;
        const multiple = field.fieldType === AirtableFieldType.MULTIPLE_SELECTS;
        const valid =
            value == null ||
            (multiple
                ? Array.isArray(value) &&
                  value.every((entry) => typeof entry === 'string')
                : typeof value === 'string');
        if (!valid) {
            mounted.model.setDisabled(true);
            setError('Expected a native select name or array of names.');
            return;
        }
        mounted.model.setDisabled(false);
        mounted.model.setValue(
            value == null
                ? []
                : multiple
                  ? (value as string[])
                  : value === ''
                    ? []
                    : [value as string]
        );
        setError(null);
    }, [value, field, scopeKey]);

    return (
        <>
            <div ref={host} />
            {error && <p role="alert">{error}</p>}
        </>
    );
}
```

For async linked controls, create the loader and model inside the scope effect,
mount with `mountSelectionControl`, call `model.reload()` explicitly, and clean
up **both** `mounted.destroy()` and `model.destroy()`. Abort any selected-label
hydration on cleanup. Keep the latest change callback in a ref, and apply
controlled linked-ID arrays with `model.setValue` in a separate value effect.
Do not recreate the model merely because the parent renders a new callback.

## Customization and local proof

The DOM controls ship without global CSS. Scope your styles below the host:
`[data-ui="select"]`, `[data-ui="search"]`, `[data-ui="choice"]`,
`[data-ui="selected-option"]`, `[data-ui="remove"]`,
`[data-ui="status"]` and `[data-ui="error"]` are styling hooks. Controls also
use corresponding `me-sdk-*` classes. Keep focus outlines and visible labels,
and preserve `[hidden]` visibility when applying display styles.
The mounted control uses labeled search, native checkbox/radio choices,
announced loading/error states, retry/paging buttons and selected-value remove
buttons. It keeps unchanged choice nodes to preserve focus while state updates.

Pass `label`, `description`, `search: false` or `messages` overrides to
`mountSelectionControl`; message keys are `searchLabel`, `loading`, `empty`,
`errorPrefix`, `retry`, `more`, `clear` and `selectedLabel`. `formatLabel`
customizes displayed option text. Linked loaders also accept
`formatRecordLabel(record, table)` for application-specific labels. Renderers
assign text through text APIs; they never interpret labels/messages as HTML.
For fully custom layout or styling, use the headless model directly.

The repository's `examples/ui-selection` is a separate installed-archive
consumer with synthetic metadata, native controls, an async picker, visitor
reset, error/empty/race/page scenarios and a preview using the existing
[FormulaRunner](formulas.md#field-references-and-context). It has no credentials
or network fixtures. Its one-shot build exits; its optional loopback preview
serves on port 34921. This UI-only example source is not bundled into the
customer archive; this guide contains its customer-facing integration recipes.
The complete Form and Portal browser starter is included in the archive as
described in the [browser lifecycle guide](browser-lifecycle.md).

Deterministic tests and that local browser sandbox prove UI interaction and
package boundaries. They do not prove a particular staging deployment accepts
your published extension. Server compatibility remains a separate
validation step with its own authorized environment and fixtures.

## Borrowed native Button action activity

`createBorrowedButtonActionController` from `/ui` is a separate clientless API for
hosts that already own their native configured webhook transport and explicit
retry/recovery policy. The existing dispatch gate and accepted Form/Portal Button
models retain their behavior. This API creates no client, accepted page, draft,
recovery journal or server authorization.

Supply actual host ports: `readContext`/`subscribe` for private owner and observed
source/mode/context revision, `mayStartNewIntent` for the existing retry policy,
`captureIntent` for lazy native request/private receipt capture, `allocate` for
the exact native Promise, and `settleAllocated` for original-outcome handling.
Requests, receipts, results and errors retain identity and are never in public
snapshots. A synchronous authority publication during a metadata copy
invalidates that sample and retires the controller, including a publication ABA.
The controller does not recursively re-read/rebase an unstable owner. Metadata
reads and notification snapshot evaluation recheck retirement before allocation,
feedback admission or listener invocation. Allocated settlement remains intact. Hidden/unavailable/recovery-refused activity does not capture input.
A changed owner/revision permanently retires the controller; the host creates a
new one for its current context. Include observed ABA in that real revision.

```ts
import {
    createBorrowedButtonActionController,
    type BorrowedButtonActionOptions,
} from '@miniextensions/sdk/ui';

// Supplied by your actual host. These declarations are integration placeholders.
type NativePorts = BorrowedButtonActionOptions<
    { fieldId: string; source: object },
    { success: boolean },
    { owner: object }
>;
declare const readActualNativeButtonContext: NativePorts['readContext'];
declare const subscribeToNativeButtonContext: NativePorts['subscribe'];
declare const mayStartExistingExplicitIntent: NativePorts['mayStartNewIntent'];
declare const captureNativeRequestAndOutcomeReceipt: NativePorts['captureIntent'];
declare const existingNativeButtonTransport: NativePorts['allocate'];
declare const settleExistingNativeButtonOutcome: NativePorts['settleAllocated'];

const action = createBorrowedButtonActionController({
    readContext: readActualNativeButtonContext,
    subscribe: subscribeToNativeButtonContext,
    mayStartNewIntent: mayStartExistingExplicitIntent,
    captureIntent: captureNativeRequestAndOutcomeReceipt,
    allocate: existingNativeButtonTransport,
    settleAllocated: settleExistingNativeButtonOutcome,
});
// Only an explicit user action invokes trigger().
const answer = await action.trigger();
```

Calling `allocate` is the settlement boundary, including a synchronous throw.
After invocation, exactly one `settleAllocated(receipt, outcome, feedback)` call
runs even after retirement/disposal or metadata/notification faults. The host
retains canonical persistence, business success/error interpretation and cleanup.
`feedback.isCurrent()` is only a current-presentation probe. A false probe cannot
cancel settlement. Settlement failure is returned separately and never replaces
the original native result/error. A resolved `{success:false}` remains opaque.
Synchronous notification/cleanup exceptions and rejected async notification/cleanup
results are contained without waiting. They cannot veto or stall settlement.
Context, recovery admission and capture ports are synchronous; the native
allocation and allocated-settlement ports expose their actual Promises.

The singleflight slot remains held through asynchronous settlement and final
notifications. `dispose()` stops new admission/observation, never aborts or
replays allocated work. No cancellation or journal-acknowledgment method exists.
Only the host's `mayStartNewIntent` policy permits the next explicit click; the
controller never retries automatically. Configured links remain with the host.
Full accepted Button contexts/recovery have a different contract; see
[configured Button actions](field-bindings.md#configured-button-actions).

## React Button presentation

The optional `/react` entry exports `ButtonField`, `ButtonFieldProps`,
`ButtonFieldMessages` and `renderButtonField`. Core and `/ui` remain React-free.
Import the scoped stylesheet explicitly; no Tailwind setup, global theme variables,
or CSS side-effect import from JavaScript is required:

```tsx
import { ButtonField, useButtonField } from '@miniextensions/sdk/react';
import type { ButtonFieldModel } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/button.css';

export function OwnedButton({ model }: { model: ButtonFieldModel }) {
    return <ButtonField {...useButtonField(model)} />;
}
```

Create the model at the accepted owner/context boundary using the existing
[Button adapters](field-bindings.md#configured-button-actions). Keep it outside
renderer lifetime. Unmounting and StrictMode only unsubscribe; they do not create,
dispose, cancel, retry or replay a Button action. Retire the owner when its accepted
context changes. You may pass an already subscribed `ButtonFieldRenderProps`
snapshot directly to `ButtonField` instead of using `useButtonField`.

Hosts with an existing action lifecycle can instead use
`ControlledButtonFieldProps` with `mode="controlled"`. The SDK renders the
complete URL/webhook control, configured palette, loading indicator and localized
empty value. The host supplies current data and a guarded callback; it retains
request allocation, settlement, alerts and retry policy:

```tsx
import { ButtonField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/button.css';

export function HostedButton({
    hostPending,
    currentSourceReady,
    triggerCurrentHostAction,
}: {
    hostPending: boolean;
    currentSourceReady: boolean;
    triggerCurrentHostAction: () => unknown;
}) {
    return (
        <ButtonField
            mode="controlled"
            id="configured-action"
            value={{ label: '', url: 'HTTPS://example.com/action' }}
            config={{ openLinkType: 'triggerWebhookPOST', buttonColor: 'red' }}
            busy={hostPending}
            disabled={!currentSourceReady}
            onTriggerWebhook={triggerCurrentHostAction}
        />
    );
}
```

Controlled mode preserves blank labels and URL protocol casing. A missing URL
has no href and disables webhook activation. `id`, `form` and
`aria-describedby` support native label, form and help associations. The callback
must enforce current ownership and singleflight synchronously, including before
React commits pending state. The component does not inspect its return value,
cancel or replay requests, display settlement feedback, or impose model recovery
rules. `messages.noValue` and `loadingLabel` customize presentation. The existing
model props, `useButtonField` and `renderButtonField` retain their behavior.

The same named slot works in `FieldRenderer`, `AirtableForm`, `AirtableGrid` and
`AirtableList`; supply each shell's existing scope and app-owned layout:

```tsx
import type { ReactNode } from 'react';
import { renderButtonField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/button.css';

export const buttonRenderers: FieldRendererSlots<ReactNode> = {
    renderButtonField,
};
```

The helper consumes only `capability.type === 'button'` for actions. A read-only
slot renders an inert, disabled control, even if its raw value contains a URL.
No value renders a localized empty presentation. Hidden or retired model state
renders nothing. A read-only slot has no language metadata; to localize its empty
presentation, use `(props) => renderButtonField(props, { language: 'fr' })`.
Accepted Button capabilities use their own language.

The compact control preserves configured colors and link targets, with readable
foregrounds for light colors, keyboard focus, reduced-motion support, unique
React instance IDs and a labelled pending spinner. Webhook controls use
`type="button"`. Button activation and keyboard events stop bubbling into Portal
rows. Native links are prepared by the model and revalidated on click, auxiliary
click and context menu; a stale capability prevents navigation. Applications must
still retire accepted owners promptly on context replacement.

Feedback is inline, plain text in a polite live region. Configured messages take
precedence, including an explicitly empty string. Null messages fall back to the
accepted language's Button defaults (all 15 supported languages). The optional
`messages` prop overrides `noValue`, `success` and `error` defaults; it does not
override configured feedback. No alert/toast effect runs on mount or settlement.
Reported success describes the response, not downstream persistence. Uncertain
outcomes remain disabled; this renderer offers no automatic retry or implicit
`acknowledgeNewIntent`. Applications own explicit new-intent/cancellation flows.

Styles are confined to `mx-sdk-button*` classes. With no configured color, a blue
palette is supplied; an ancestor can override `--mx-sdk-button-background`,
`--mx-sdk-button-hover`, `--mx-sdk-button-foreground`,
`--mx-sdk-button-hover-foreground` and `--mx-sdk-button-focus`. Configured
`buttonColor` selects its own local palette. `className` decorates the wrapper.
The CSS asset is copied into both builds and exported as
`@miniextensions/sdk/react/button.css`; JavaScript remains usable without it.

The local source example in `examples/react-button` demonstrates synthetic
success, uncertainty, localized/empty feedback, no value, missing capability and
remounting while pending. After building the SDK, run
`node examples/react-button/dev.mjs` and open `http://127.0.0.1:4175`.
It does not issue network requests or require credentials. This local example is
separate from the packaged vanilla browser starter.

## React Checkbox presentation

The optional `/react` entry exports `CheckboxField`, `CheckboxFieldProps`,
`CheckboxFieldOptions` and `renderCheckboxField`. The existing binding component
keeps its `{ binding, render }` API; `render` can still replace all markup.

```tsx
import { CheckboxField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/checkbox.css';

export function Approval({ binding }: { binding: FormFieldBinding }) {
    return <CheckboxField binding={binding} className="approval" />;
}
```

Use the same named helper with `FieldRenderer`, `AirtableForm`, `AirtableGrid` or
`AirtableList`. Each shell supplies its accepted owner, scope and layout:

```tsx
import type { ReactNode } from 'react';
import { renderCheckboxField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/checkbox.css';

export const checkboxRenderers: FieldRendererSlots<ReactNode> = {
    renderCheckboxField: (props) =>
        renderCheckboxField(props, { className: 'approval' }),
};
```

The helper writes through the accepted editable capability's scalar model, or
its guarded `setValue` action if no scalar is supplied. A read-only capability
never becomes editable based on its raw value. Initial `null` or absent values
appear unchecked and retain their native value until deliberate interaction.
Changes write booleans to the existing draft; the renderer never invokes Save.
Keep owners outside React mount lifetimes. StrictMode and remounting do not
create, destroy, clear or resubmit a scalar model. Stale callbacks remain subject
to the existing owner/context checks.

Controls use native checkbox and label semantics, unique React instance IDs,
keyboard focus, `aria-required`, `aria-invalid` and `aria-busy`. `showTitle: false`
retains an accessible name. Plain-text feedback is associated with the control
and rendered in a polite live region, preserving explicitly empty error messages.
Click, pointer and keyboard events stop bubbling into Portal rows. Read-only,
pending and computed fields are disabled; hidden, blocked and retired hosts
render no control.

This slice provides the native checkbox appearance. Configured toggle/button
appearances and their checked/unchecked labels need a custom renderer today.
Calendly integration is outside this slice: enabling it in either display or
write configuration disables the stock control, so a boolean click cannot stand
in for a booking. Required and conditional validation remain with the existing
owner and canonical Save; the renderer does not create a second validator.

Styles are confined to `mx-sdk-checkbox*` classes and are optional. The provisional
defaults use a native blue accent, inherited text color and font, compact spacing
and visible keyboard focus. Override the classes (for example `accent-color`) or
omit the stylesheet and provide your own. `className` decorates the wrapper; no
theme system or appearance-prop API is introduced. Core and `/ui` remain React-free,
and JavaScript does not import the CSS. The asset is exported as
`@miniextensions/sdk/react/checkbox.css` and copied into both builds.

The local `examples/react-checkbox` example uses public exports and synthetic
owners, with no backend requests. After building, run
`node examples/react-checkbox/dev.mjs` and open `http://127.0.0.1:4176`.
`node scripts/check-checkbox-browser.mjs` verifies the native interactions,
remounting, permissions, forced colors and narrow layout and captures screenshots.

## React Single Select presentation

The optional `/react` entry exports `SingleSelectField`, `SingleSelectFieldProps`,
`SingleSelectFieldOptions` and `renderSingleSelectField`. The binding component
accepts `{ binding, render }` plus `className`, `clearLabel` and `emptyLabel`.
Supplying `render` replaces its stock markup. `emptyLabel` defaults to `None`;
`clearLabel` changes the Clear button's accessible name, which defaults to
`Clear <field title>`. Existing `SelectField` delegates canonical single-select
bindings to this control; its multi-select path remains unchanged.

```tsx
import { SingleSelectField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/single-select.css';

export function StatusField({ binding }: { binding: FormFieldBinding }) {
    return (
        <SingleSelectField
            binding={binding}
            className="record-status"
            emptyLabel="No status"
            clearLabel="Clear status"
        />
    );
}
```

The named helper accepts `FieldRendererProps<'singleSelect'>` in `FieldRenderer`,
`AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import {
    renderSingleSelectField,
    type SingleSelectFieldOptions,
} from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/single-select.css';

const statusOptions: SingleSelectFieldOptions = { emptyLabel: 'No status' };
export const singleSelectRenderers: FieldRendererSlots<ReactNode> = {
    renderSingleSelectField: (props) =>
        renderSingleSelectField(props, statusOptions),
};
```

The control uses a native single-choice `<select>`. It displays labels supplied by
the existing owner and writes canonical choice names, never choice IDs or renamed
labels. Existing retained unavailable selections stay visible and removable under
the owner's policy. Choosing the empty option or using Clear delegates to the
existing selection action; an accepted clear writes native `null`. Mounting and
remounting do not normalize missing, null, empty or retained native answers.
Configured choice limits and whole-selection validation remain owned by the model.

This presentation stays a dropdown even when configuration requests `type: 'list'`.
List/radio layouts and choice colors are not modeled here; use a custom renderer
for those appearances. The renderer adds no selection model, option loader or
condition evaluator. Existing owner selection state and options enforce choice
availability; the renderer displays the Form bridge's status. An absent status is
unknown and does not make the renderer construct options or authority. Blocked
availability retains the selected value and any owner-permitted Clear action,
while the owner withholds unavailable new options. This differs from a ready
selector with no options or no search matches.

Editing requires an accepted single-select selection capability. A generic setter,
a multiple-selection bridge or a readonly capability does not grant it. Pending,
configured read-only and owner-disabled controls cannot change the native value.
Form hosts use accepted Form bindings. Grid editing uses an existing accepted
static Portal cell editor; conditional inline configurations remain refused by the
owner. Grid and List detail hosts remain readonly, using configured display labels
and retaining an unknown native name without fetching choices. Static choice
restrictions or display overrides cannot create write authority. Save is always
an explicit Form or cell-owner action.

Configured Add Choice uses the Form owner's attached choice controller and its
current permission, availability and recovery guards. Entering a name changes only
local presentation state. Create and Cancel call the existing owner actions;
mounting never creates a choice. Accepted creation can select a native name in the
local draft, but does not save the record. Uncertain or cancelled responses retain
the owner's recovery policy, with no automatic retry, acknowledgment or rollback.
Portal inline editors do not acquire Add Choice. See [configured choice creation](field-bindings.md#selects-linked-reads-and-reload)
for attaching the controller and handling recovery.

`SingleSelectField` uses its binding as the identity for local create-name text.
Named helpers rendered through `FieldRenderer` and the Form/Grid/List composition
components receive stable host identity automatically. An explicit
`SingleSelectFieldOptions.source` takes precedence over that host context. Pass a
stable owner or host object, for example
`renderSingleSelectField(props, { source: host })`, to preserve local input across
renderer-props snapshots. This object identifies local presentation only; it
grants no capability and must change when ownership changes.

Without an explicit source or host context, a standalone helper uses the original
incoming `FieldRendererProps` object as its identity. Reusing that exact object
preserves local input; replacing it retires the previous input and its completion
callbacks, even when choice or selection capabilities are reused. The helper's
internally constructed React props do not define this boundary. Every observed
identity change starts a fresh generation, including A→B→A, so a late creation
response cannot clear a successor's input. Remounting also resets local text;
accepted native choices and pending operations remain with their owners.

Title visibility and fallback titles, unique label IDs, an accessible hidden title,
required indication, pending state and associated plain-text status apply. Masking
from either display or write configuration omits native values, options and choice
actions from stock markup. Custom rendering must apply its own privacy rules.
Clear and choice-action buttons use `type="button"`; control events stay contained
within Portal rows. Applications still own the surrounding form's submission
policy. Hidden or blocked binding visibility and retired bindings/hosts omit the
stock control; blocked choice availability alone does not. Wrong physical bindings
cannot become a single-select editor. Custom binding rendering takes precedence.

Styles use optional `@miniextensions/sdk/react/single-select.css` and the
`mx-sdk-single-select*` classes. Import it, override it or supply your own styles;
JavaScript does not import CSS. The synthetic `examples/react-single-select`
example uses public exports. See [Single Select
presentation checks](testing.md#single-select-presentation-checks) for source,
installed-package and native browser verification.

## React Text presentation

The optional `/react` entry exports `TextField`, `TextFieldProps`,
`TextFieldOptions` and `renderSingleLineTextField`. The binding component retains
its `{ binding, render }` API; supplying `render` still replaces all markup.

```tsx
import { TextField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/text.css';

export function ProjectName({ binding }: { binding: FormFieldBinding }) {
    return <TextField binding={binding} className="project-name" />;
}
```

The named helper consumes `FieldRendererProps<'singleLineText'>` in
`FieldRenderer`, `AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { renderSingleLineTextField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/text.css';

export const textRenderers: FieldRendererSlots<ReactNode> = {
    renderSingleLineTextField: (props) =>
        renderSingleLineTextField(props, { clearLabel: 'Effacer le texte' }),
};
```

Changes call only the accepted editable capability or binding. The native draft
keeps exact whitespace and literal text; an explicit empty edit or Clear writes
`null`. An initially absent value stays absent until a deliberate edit. Clear is
`type="button"` and returns focus to the input. Owners remain outside React;
mounting, StrictMode and remounting neither create nor dispose an owner, write a
draft, invoke Save or start network work. Rejected stale edits restore the current
rendered value; applications must still retire owners when their context changes.

Unfinished IME composition is kept in a local presentation buffer. Completion
commits once through the captured accepted action. Observed owner, value,
permission, masking or limit changes cancel that buffer, including an observed
change away and back. Remounting discards unfinished composition and reflects the
owner's accepted draft. Native typing retains the input node and caret.

The control honors title visibility, placeholder, required indication, password
masking, configured read-only state and finite nonnegative integer character
limits. Masking and read-only restrictions from either display or write config
apply; when both specify a limit, the smaller applies. Limits count UTF-16 code
units, matching native `maxlength`, without cutting a surrogate pair in half.
Only user edits are capped; loaded or externally updated values are never
silently shortened. Validation remains with the existing owner and canonical Save.

Labels use unique React instance IDs for repeated rows. Hidden titles retain an
accessible name. Feedback is plain text in an associated polite live region;
explicitly empty feedback is preserved. Read-only, pending and computed controls
are disabled. Hidden, blocked and retired hosts render nothing. Click, pointer
and keyboard events stop bubbling into Portal rows. The optional `clearLabel`
localizes the Clear control's accessible name; its default is `Clear <title>`.

This slice covers manual single-line entry. Address lookup, QR/barcode scanning,
camera access, automatic submission, URL buttons and attachment presentation need
their own accepted integration or custom renderer. Configuration or raw text
never starts those integrations or grants navigation authority.

The provisional styling is confined to `mx-sdk-text*` classes. Import the CSS,
override its classes, or omit it and supply your own. `className` decorates the
wrapper; no theme system or appearance-prop API is introduced. The stylesheet is
exported as `@miniextensions/sdk/react/text.css` and copied into both builds.
JavaScript does not import it; core and `/ui` stay React-free.

The local `examples/react-text` example uses public exports and synthetic owners,
with no backend requests. After building, run `node examples/react-text/dev.mjs`
and open `http://127.0.0.1:4177`. `node scripts/check-text-browser.mjs` checks native
typing, selection/caret, clearing, simulated composition, remounting, permissions,
forced colors and narrow layout and captures screenshots. Simulated composition
does not certify every platform's input method or screen reader.

## React Multiline Text presentation

The optional `/react` entry exports `MultilineTextField`,
`MultilineTextFieldProps`, `MultilineTextFieldOptions` and
`renderMultilineTextField`. The binding component accepts the existing
`{ binding, render }` contract plus `className` and `clearLabel`. Supplying
`render` replaces all markup, including the unsupported-mode status.

```tsx
import { MultilineTextField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/text.css';

export function ProjectNotes({ binding }: { binding: FormFieldBinding }) {
    return <MultilineTextField binding={binding} clearLabel="Clear notes" />;
}
```

The named helper consumes only `FieldRendererProps<'multilineText'>` and works
with `FieldRenderer`, `AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { renderMultilineTextField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/text.css';

export const multilineRenderers: FieldRendererSlots<ReactNode> = {
    renderMultilineTextField: (props) =>
        renderMultilineTextField(props, { className: 'project-notes' }),
};
```

The control is a plain four-row textarea. Accepted edits retain spaces, blank
lines and trailing whitespace; this renderer does not trim based on
`preserveTrailingWhitespace`. Literal markup remains text. The owner retains its
native string or `null`; an empty edit or Clear sets the native draft to `null`.
Loaded CRLF values remain unchanged in the owner when mounting or remounting.
Browsers normalize textarea DOM line endings to LF, so a deliberate edit can
write that DOM representation. Mounting never writes a normalized value back.

Title visibility, placeholder, required indication and configured read-only state
are honored. Finite nonnegative integer character limits from either display or
write configuration apply; the smaller limit wins. Limits count UTF-16 code
units without splitting surrogate pairs and cap edits only, never loaded values.
Unfinished composition stays in a local buffer. Completion uses the captured
accepted action; observed owner, value, permission or limit changes cancel that
buffer. Remounting discards unfinished composition and reflects the owner's
accepted draft. Validation and deliberate Save remain with the existing owner.

Append-only (`addOnlyMode`), attachment display (`displayAsAttachments`) and
explicit password or masking signals (`obscurePassword` or
`maskPasswordOnLoginScreen`) from either configuration are unsupported. Only
`false` or an absent signal allows the plain control; malformed values such as
`null`, strings or numbers also fail closed. Instead of a textarea, these modes
show an accessible status asking for a custom renderer. No native value, Clear
button, character count or value-derived feedback is rendered. A binding whose
physical field kind is not `multilineText` also renders a status. This does not
add password or login support, rich-text editing, append operations or attachment
workflows; those require a separately accepted custom integration.

Supported controls use unique label and feedback IDs, and hidden titles retain an
accessible name. Feedback is plain text in an associated polite live region.
Read-only, pending and computed controls are disabled. Hidden, blocked and retired
hosts render nothing. Clear is `type="button"`, has a localized accessible name
through `clearLabel`, and restores textarea focus. Click, pointer and keyboard
events stop bubbling into Portal rows. Native Enter inserts a newline; the
renderer never invokes Save. The application owns enclosing form submission and
any explicit Save action.

The optional shared `@miniextensions/sdk/react/text.css` styles `mx-sdk-text*`
classes and adds vertical resizing for `textarea.mx-sdk-multiline-text`.
`className` decorates the wrapper. There is no separate multiline stylesheet
export or JavaScript CSS import; core and `/ui` remain React-free.

The public `examples/react-multiline-text` example uses synthetic presentation
hosts and bindings. After building, run
`node examples/react-multiline-text/dev.mjs` and open
`http://127.0.0.1:4187`. `node scripts/check-multiline-text-browser.mjs` checks
native multiline entry, line endings, Enter, clearing, simulated composition,
unsupported modes, remounting and layout. Simulated composition does not certify
every platform input method or screen reader. The example contacts no backend.

## React Email presentation

The optional `/react` entry exports `EmailField`, `EmailFieldProps`,
`EmailFieldOptions`, `ControlledEmailFieldProps`, `EmailEditOwner` and
`renderEmailField`. Binding-mode `EmailField` delegates to `TextField`;
its legacy props and options remain aliases of `TextFieldProps` and `TextFieldOptions`.
The existing `{ binding, render }` override replaces all stock markup.

```tsx
import { EmailField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/text.css';

export function ContactEmail({ binding }: { binding: FormFieldBinding }) {
    return <EmailField binding={binding} clearLabel="Clear email address" />;
}
```

The named helper accepts only `FieldRendererProps<'email'>` and works in the
existing `FieldRenderer`, `AirtableForm`, `AirtableGrid` and `AirtableList` slots:

```tsx
import type { ReactNode } from 'react';
import { renderEmailField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/text.css';

export const emailRenderers: FieldRendererSlots<ReactNode> = {
    renderEmailField: (props) =>
        renderEmailField(props, { className: 'contact-email' }),
};
```

The control uses a text input, or a password input when accepted masking config
requires it. For native single-line entry, whitespace, mixed case, Unicode and
invalid address strings remain native drafts. The renderer does not trim, change case or apply
`emailLetterCase`; page and server validation own email syntax and configured
policy. An explicit empty edit or Clear sets the native draft to `null`. An
initially absent value stays absent until an edit. Invalid text is not silently
replaced with the last syntactically valid address. Native single-line inputs
strip embedded line breaks; this is not a multiline editor.

The shared Text control supplies labels, placeholder and required indication,
plain-text associated feedback, Clear focus restoration and local composition
buffering. Read-only settings, masking, pending and computed restrictions are
preserved. Hidden, blocked and retired hosts omit the control; stale callbacks
remain guarded by their accepted owner. A supplied `render` override continues
to own its presentation. Keep owners outside React mounts: mounting, StrictMode,
remounting and unmounting do not create or destroy owners or save drafts.

Email entry does not send mail, create `mailto:` links, navigate, verify an
address or start a request. Saving remains an explicit `owner.save()` action.
Applications own their enclosing HTML form's submit policy: stopping key-event
bubbling does not prevent native Enter submission. Clear is `type="button"`.

Email uses the existing optional `@miniextensions/sdk/react/text.css` stylesheet
and `mx-sdk-text*` classes. There is no separate Email stylesheet. JavaScript does
not import CSS; `className` decorates the wrapper and the stylesheet can be
overridden or omitted. Core and `/ui` stay React-free.

After building, `node examples/react-email/dev.mjs` serves the synthetic public
API example at `http://127.0.0.1:4183`. `node scripts/check-email-browser.mjs`
checks native entry, clearing, remounts and surrounding-form Enter behavior.
Simulated composition checks do not certify real OS input methods.

For complete native email presentation, use the same natural public component
with the explicit controlled contract:

```tsx
import { EmailField, type EmailEditOwner } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/text.css';

export function NativeEmail({
    value,
    onChange,
    owner,
}: {
    value: string | null;
    onChange(value: string): void;
    owner: EmailEditOwner;
}) {
    return (
        <EmailField
            mode="controlled"
            value={value}
            onChange={onChange}
            language="en"
            enableInlineEdit
            owner={owner}
            id="contact-email"
            form="contact-form"
            placeholder="Work email"
            initialMobile={false}
        />
    );
}
```

This branch supplies the actual `type="email"` input, envelope, Clear and
opt-in `enableQRCodeScannerForFormField` scanner through the existing shared
engines. The same optional `text.css` includes its scoped styling and scanner,
Clear and readonly dependencies. No host renderer or Tailwind compiler is needed.
`initialMobile` is captured per mount; use the same value during SSR and hydration.
`inputRef`, `id`, `form`, `describedBy`, `labelledBy` and `invalid` carry the
host's existing associations. Validation and Save remain with the page/server.

Controlled changes and Clear write strings, including `''`; `null` only displays
as an empty input. The browser's email-input sanitization remains native.
Immediate mode retains native form Enter behavior, so the enclosing page owns
its submit policy. Deferred mode (`enableInlineEdit`) requires an owner with a
captured generation `token` and `isCurrent()` authority check. Non-IME Enter
blurs without submitting; dirty blur can write before a later Clear click.
Genuine dirty unmount settles once through the original mounted writer if that
owner remains current. A replacement, retired owner or missing deferred owner
cannot adopt that pending value. Renew the token when field/record/edit policy
is replaced, including A-to-B-to-A transitions; a raw value is not authority.

`readOnly` and `disabled` render a disabled editor. `displayOnly` instead reuses
the existing readonly text/link presentation with the supplied language and
never invokes the writer. A caller cannot mix controlled props with `binding`
or `render`. The binding/slot examples and semantics above remain unchanged.

## React URL presentation

The optional `/react` entry exports `UrlField`, `UrlFieldProps`, `UrlFieldOptions`
and `renderUrlField`. `UrlField` delegates to `TextField`; its props and options
are aliases of `TextFieldProps` and `TextFieldOptions`. The existing
`{ binding, render }` override replaces all stock markup.

```tsx
import { UrlField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/text.css';

export function Website({ binding }: { binding: FormFieldBinding }) {
    return <UrlField binding={binding} clearLabel="Clear website" />;
}
```

The named helper accepts only `FieldRendererProps<'url'>` in the existing
`FieldRenderer`, `AirtableForm`, `AirtableGrid` and `AirtableList` slots:

```tsx
import type { ReactNode } from 'react';
import { renderUrlField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/text.css';

export const urlRenderers: FieldRendererSlots<ReactNode> = {
    renderUrlField: (props) => renderUrlField(props, { className: 'website' }),
};
```

This is manual single-line text entry. Input uses `type="text"`, or `password`
when accepted masking config requires it, rather than browser `type="url"`
validation. Entered spaces, case, Unicode, relative paths, incomplete values and
non-URL strings remain native drafts. The renderer does not trim, prefix a scheme,
normalize or decide whether a value is navigable. Native single-line inputs strip
embedded line breaks. An explicit empty edit or Clear sets the native draft to
`null`; an initially absent value stays absent until an edit.

Existing accepted-owner, page and server validation remains authoritative. The
renderer displays supplied errors and does not add a URL parser or reinterpret
`allowInvalidUrls`. A page's validation decision is not a public `href` policy.
Keep owners outside React mounts: mounting, StrictMode, remounting and unmounting
do not create or destroy owners, write a draft or save it. Saving remains an
explicit owner action.

The shared Text control supplies labels, placeholder and required indication,
plain-text associated feedback, Clear focus restoration and local composition
buffering. Read-only, masked, pending and computed restrictions are preserved;
hidden, blocked and retired hosts omit the control. Stale callbacks continue
through their accepted owner's guards. Custom `render` overrides keep ownership
of their presentation.

Values such as `javascript:...`, `data:...` or a relative path are inert input
text. This renderer creates no anchor, `href`, image preview or Open action and
does not navigate, fetch a URL or grant navigation authority. `displayAsButton`,
`displayAsAttachments`, scanning and automatic camera/submission settings require
a separate accepted custom integration. Raw values and configuration do not start
those integrations.

Applications own their enclosing HTML form's submit policy: stopped key-event
bubbling does not prevent native Enter submission. Clear is `type="button"`.
There is no separate URL stylesheet. Import the existing optional
`@miniextensions/sdk/react/text.css`, override its `mx-sdk-text*` classes or supply
your own styles. JavaScript does not import CSS; `className` decorates the wrapper.
Core and `/ui` remain React-free.

After building, `node examples/react-url/dev.mjs` serves synthetic presentation
fixtures at `http://127.0.0.1:4184`. `node scripts/check-url-browser.mjs` checks
native entry, clearing, remounts, inert text and enclosing-form Enter behavior.
Simulated composition does not certify real OS input methods.

## React Phone Number presentation

The optional `/react` entry exports `PhoneNumberField`, `PhoneNumberFieldProps`,
`PhoneNumberFieldOptions` and `renderPhoneNumberField`. With `binding`,
`PhoneNumberField` still delegates to `TextField`; its binding props and options
retain `TextFieldProps` and `TextFieldOptions`. Controlled `value`/`onValueChange`
props instead select the [complete editor](#complete-editable-phone-field),
without accepting a binding or renderer override. The existing `{ binding, render }` override replaces all
stock markup.

```tsx
import { PhoneNumberField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/text.css';

export function Telephone({ binding }: { binding: FormFieldBinding }) {
    return <PhoneNumberField binding={binding} clearLabel="Clear telephone" />;
}
```

The named helper accepts only `FieldRendererProps<'phoneNumber'>` in the existing
`FieldRenderer`, `AirtableForm`, `AirtableGrid` and `AirtableList` slots:

```tsx
import type { ReactNode } from 'react';
import { renderPhoneNumberField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/text.css';

export const phoneRenderers: FieldRendererSlots<ReactNode> = {
    renderPhoneNumberField: (props) =>
        renderPhoneNumberField(props, { className: 'telephone' }),
};
```

This is manual single-line text entry. Input uses `type="text"`, or `password`
when accepted masking config requires it. Plus signs, leading zeros, punctuation,
extensions, Unicode digits, entered whitespace and incomplete or non-phone strings
remain literal native drafts. The renderer does not trim, normalize, format,
coerce to a number or add a country prefix. Native single-line inputs strip
embedded line breaks. An explicit empty edit or Clear sets the native draft to
`null`; an initially absent value stays absent until an edit.

Existing accepted-owner, page and server validation remains authoritative. The
renderer displays supplied errors and adds no phone-syntax validator. Country-code
configuration, including `showCountryCodes` and `defaultCountryCode`, is metadata
without an accepted selector or formatter contract in this presentation. A country
selector or formatting policy needs a separate accepted custom integration.

The shared Text control supplies labels, placeholder and required indication,
plain-text associated feedback, Clear focus restoration and local composition
buffering. Read-only, masked, pending and computed restrictions are preserved;
hidden, blocked and retired hosts omit the control. Stale callbacks continue
through their accepted owner's guards. Custom `render` overrides keep ownership
of their presentation.

Keep owners outside React mounts: mounting, StrictMode, remounting and unmounting
do not create or destroy owners, write a draft or save it. Saving remains an
explicit owner action. Values such as `tel:+12025550123` or `sms:+12025550123`
are inert input text. This renderer creates no links, dialing or messaging action;
it performs no SMS, OTP, verification, lookup or network request.

Applications own their enclosing HTML form's submit policy: stopped key-event
bubbling does not prevent native Enter submission. Clear is `type="button"`.
The binding presentation has no separate stylesheet. Import the existing optional
`@miniextensions/sdk/react/text.css`, override its `mx-sdk-text*` classes or supply
your own styles. JavaScript does not import CSS; `className` decorates the wrapper.
Core and `/ui` remain React-free.

After building, `node examples/react-phone-number/dev.mjs` serves synthetic
presentation fixtures at `http://127.0.0.1:4185`.
`node scripts/check-phone-number-browser.mjs` checks native entry, clearing,
remounts, inert text and enclosing-form Enter behavior. Simulated composition does
not certify real OS input methods.

## React Last Modified By presentation

The optional `/react` entry exports `LastModifiedByField`, `LastModifiedByFieldProps`,
`LastModifiedByFieldOptions` and `renderLastModifiedByField`. The binding component accepts
`{ binding, render }` plus `className` and `clearLabel`. Supplying `render` replaces
all stock markup. The options alias `TextFieldOptions`.

```tsx
import { LastModifiedByField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/text.css';

export function RecordModifier({ binding }: { binding: FormFieldBinding }) {
    return (
        <LastModifiedByField binding={binding} className="record-modifier" />
    );
}
```

The named helper accepts only `FieldRendererProps<'lastModifiedBy'>` in
`FieldRenderer`, `AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { renderLastModifiedByField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/text.css';

export const modifierRenderers: FieldRendererSlots<ReactNode> = {
    renderLastModifiedByField: (props) =>
        renderLastModifiedByField(props, { className: 'record-modifier' }),
};
```

The accepted SDK value is a native collaborator object, `null` or missing. A
canonical collaborator has string `id`, `email` and `name` fields and an optional
string `profilePicUrl`. The control displays only the supplied `name`. It does
not fall back to email, ID, avatar, metadata choices or an identity lookup, and
metadata choice changes do not rewrite the native object. Blank names remain
blank. Whitespace, Unicode, markup-looking and URL-looking names are plain input
text; they do not create links or images. A single-line input removes line breaks
from its DOM value without writing that representation back to the owner.

Null, missing and malformed values display blank in defensive direct helper calls.
The helper applies the existing native collaborator shape check; renderer hosts
may reject malformed values before invoking it. Rendering never changes or drops
the native object's other fields.

The Text input and its existing Clear button are always disabled. `clearLabel`
customizes the accessible label of that disabled button. The renderer borrows no
setter, scalar, date or selection model, including when malformed runtime props
claim editing authority. Last Modified By remains readonly through its physical kind
even when returned metadata says `isComputed: false`. It adds no collaborator
picker, account lookup, avatar request, navigation, Save or automatic network read.
The renderer does not infer a modifier from the current user, timestamps, edit
history or referenced fields. The accepted owner supplies the complete native
answer.

Configured title visibility is honored; blank titles use the field name and hidden
titles keep an accessible name. Repeated instances have unique label and feedback
IDs. Accepted masking from either display or write configuration uses a password
input. Pending state and existing error or validation messages are shown without
changing the native value. Feedback is plain text in an associated polite live
region; an explicitly empty error remains empty. Last Modified By adds no formatting,
placeholder or character-limit policy.

The stock binding component requires physical Last Modified By schema and configuration;
other kinds show a status. Custom rendering keeps precedence. Hidden, blocked and
retired bindings or hosts omit the control. Mounting, StrictMode, remounting and
unmounting do not replace or destroy owners, mutate values or invoke Save. A
replacement binding displays its own accepted state. Editable Text neighbors keep
their existing behavior.

Use accepted Form bindings and Portal detail hosts. Grid and List composition
show Last Modified By through those detail hosts without creating a computed inline
editing binding. Loading data and submitting forms remain explicit application
operations.

Styles reuse optional `@miniextensions/sdk/react/text.css` and its `mx-sdk-text*`
classes. `className` decorates the wrapper. There is no Last Modified By stylesheet
export or JavaScript CSS import; core and `/ui` remain React-free.

The `examples/react-last-modified-by` fixture uses public exports and synthetic data.
After building, run `node examples/react-last-modified-by/dev.mjs` and open
`http://127.0.0.1:4193`. The local browser check is
`node scripts/check-last-modified-by-browser.mjs`; see [Last Modified By presentation checks](testing.md#last-modified-by-presentation-checks).

## React Created By presentation

The optional `/react` entry exports `CreatedByField`, `CreatedByFieldProps`,
`BindingCreatedByFieldProps`, `ControlledCreatedByFieldProps`,
`CreatedByFieldOptions` and `renderCreatedByField`. The binding component accepts
`{ binding, render }` plus `className` and `clearLabel`. Supplying `render` replaces
all stock markup. The options alias `TextFieldOptions`.

Native hosts can supply projected display data through explicit controlled mode.
It reuses `CompleteSingleCollaboratorField` while always forcing readonly. The
host retains admission, identity, configuration and avatar-policy authority.
Supplied names fall back to email using the existing complete badge semantics;
no identity lookup is added. Null shows `labels.empty`, defaulting to
`No collaborators`. Visibility, title, IDs, help/error associations, invalid state
and class names pass through. Avatar requests require an explicit existing
`avatarPolicy`; the default has no avatar network authority.

```tsx
import {
    CreatedByField,
    type CompleteCollaborator,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-collaborators.css';

export function CreatorBadge({
    value,
}: {
    value: CompleteCollaborator | null;
}) {
    return (
        <CreatedByField
            mode="controlled"
            value={value}
            title="Created by"
            labels={{ empty: 'No creator' }}
        />
    );
}
```

Controlled props grant no choices, edit owner, setter, render override or remove
callback. The implementation projects only display props and `labels.empty`;
forged editing flags/actions cannot enable a selector or removal control. It
does not tighten the host's native collaborator admission or normalize supplied
objects. `CreatedByFieldProps` retains its historical binding shape, also named
`BindingCreatedByFieldProps`. The following binding/helper contract remains
name-only with its existing masking behavior.

```tsx
import { CreatedByField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/text.css';

export function RecordCreator({ binding }: { binding: FormFieldBinding }) {
    return <CreatedByField binding={binding} className="record-creator" />;
}
```

The named helper accepts only `FieldRendererProps<'createdBy'>` in
`FieldRenderer`, `AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { renderCreatedByField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/text.css';

export const creatorRenderers: FieldRendererSlots<ReactNode> = {
    renderCreatedByField: (props) =>
        renderCreatedByField(props, { className: 'record-creator' }),
};
```

The accepted SDK value is a native collaborator object, `null` or missing. A
canonical collaborator has string `id`, `email` and `name` fields and an optional
string `profilePicUrl`. The control displays only the supplied `name`. It does
not fall back to email, ID, avatar, metadata choices or an identity lookup, and
metadata choice changes do not rewrite the native object. Blank names remain
blank. Whitespace, Unicode, markup-looking and URL-looking names are plain input
text; they do not create links or images. A single-line input removes line breaks
from its DOM value without writing that representation back to the owner.

Null, missing and malformed values display blank in defensive direct helper calls.
The helper applies the existing native collaborator shape check; renderer hosts
may reject malformed values before invoking it. Rendering never changes or drops
the native object's other fields.

The Text input and its existing Clear button are always disabled. `clearLabel`
customizes the accessible label of that disabled button. The renderer borrows no
setter, scalar, date or selection model, including when malformed runtime props
claim editing authority. Created By remains readonly through its physical kind
even when returned metadata says `isComputed: false`. It adds no collaborator
picker, account lookup, avatar request, navigation, Save or automatic network read.

Configured title visibility is honored; blank titles use the field name and hidden
titles keep an accessible name. Repeated instances have unique label and feedback
IDs. Accepted masking from either display or write configuration uses a password
input. Pending state and existing error or validation messages are shown without
changing the native value. Feedback is plain text in an associated polite live
region; an explicitly empty error remains empty. Created By adds no formatting,
placeholder or character-limit policy.

The stock binding component requires physical Created By schema and configuration;
other kinds show a status. Custom rendering keeps precedence. Hidden, blocked and
retired bindings or hosts omit the control. Mounting, StrictMode, remounting and
unmounting do not replace or destroy owners, mutate values or invoke Save. A
replacement binding displays its own accepted state. Editable Text neighbors keep
their existing behavior.

Use accepted Form bindings and Portal detail hosts. Grid and List composition
show Created By through those detail hosts without creating a computed inline
editing binding. Loading data and submitting forms remain explicit application
operations.

Styles reuse optional `@miniextensions/sdk/react/text.css` and its `mx-sdk-text*`
classes. `className` decorates the wrapper. There is no Created By stylesheet
export or JavaScript CSS import; core and `/ui` remain React-free.

The `examples/react-created-by` fixture uses public exports and synthetic data.
After building, run `node examples/react-created-by/dev.mjs` and open
`http://127.0.0.1:4192`. The local browser check is
`node scripts/check-created-by-browser.mjs`; see [Created By presentation checks](testing.md#created-by-presentation-checks).

## React External Sync Source presentation

The optional `/react` entry exports `ExternalSyncSourceField`,
`ExternalSyncSourceFieldProps`, `ExternalSyncSourceFieldOptions` and
`renderExternalSyncSourceField`. The binding component accepts the existing
`{ binding, render }` contract plus `className` and `clearLabel`. Supplying
`render` replaces all stock markup. The options alias `TextFieldOptions`.

```tsx
import { ExternalSyncSourceField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/text.css';

export function RecordSource({ binding }: { binding: FormFieldBinding }) {
    return (
        <ExternalSyncSourceField
            binding={binding}
            className="record-source"
            clearLabel="Clear source"
        />
    );
}
```

The named helper accepts only `FieldRendererProps<'externalSyncSource'>` in
`FieldRenderer`, `AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { renderExternalSyncSourceField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/text.css';

export const sourceRenderers: FieldRendererSlots<ReactNode> = {
    renderExternalSyncSourceField: (props) =>
        renderExternalSyncSourceField(props, { className: 'record-source' }),
};
```

The accepted SDK value is a string, `null` or missing. Supplied strings are passed
to the single-line Text control, including unknown labels, whitespace, Unicode,
markup-looking text and URL-looking text. Empty, null and missing values display
blank. No choice lookup maps an ID to a name, and changes to metadata choices do
not rewrite or normalize the owner value. This renderer does not interpret raw
Airtable objects: direct helper calls with nonstring values display blank without
reading a `name` property or coercing the object. Renderer hosts may reject
malformed values before invoking the helper. Native single-line inputs remove
line breaks from their DOM value; rendering does not write that representation
back to the owner.

The Text input and its existing Clear button are always disabled. `clearLabel`
customizes the accessible label of that disabled button; it grants no clearing
action. The renderer borrows no selection or scalar model, does not read an
editable capability or call a setter, and keeps that behavior even if malformed
runtime props claim editing authority or mark the field noncomputed. It adds no
source selector, links, navigation, login search, synchronization or network read.
The accepted owner and server remain responsible for the value.

Configured title visibility is honored, blank titles use the field name, and
hidden titles retain an accessible name. Repeated instances have unique label
and feedback IDs. Accepted masking from either display or write configuration
uses a password input. Pending state and existing error or validation messages
are reflected without changing the string. Feedback is plain text in an associated
polite live region; an explicitly empty error remains empty. External Sync Source
configuration adds no placeholder or character-limit policy.

The binding component requires physical External Sync Source schema and
configuration; another field kind renders a status. Custom rendering keeps
precedence. Hidden, blocked and retired bindings or hosts omit the control.
Mounting, StrictMode, remounting and unmounting do not create or destroy owners,
change native values or invoke Save. A replacement binding displays its own
accepted state. Existing editable Text controls keep their behavior.

Use canonical computed Form bindings and accepted Portal detail hosts. Grid and
List composition display this readonly field through those detail hosts without
creating a computed inline editing binding. Loading data and submitting an
application form remain explicit application-owned actions.

Styles reuse optional `@miniextensions/sdk/react/text.css` and its `mx-sdk-text*`
classes. `className` decorates the wrapper. There is no separate External Sync
Source stylesheet export or JavaScript CSS import; core and `/ui` remain React-free.

The `examples/react-external-sync-source` fixture uses public exports and synthetic
data. After building, run `node examples/react-external-sync-source/dev.mjs` and
open `http://127.0.0.1:4191`. `node scripts/check-external-sync-source-browser.mjs`
checks disabled controls, native strings, masking, owner replacement and layout.
These fixtures contact no backend and do not synchronize records.

### Controlled External Sync Source text

Native hosts can use the same natural public component with an explicit
controlled contract. `ExternalSyncSourceFieldProps` and its
`BindingExternalSyncSourceFieldProps` alias retain the binding contract above.
`ControlledExternalSyncSourceFieldProps` supplies already-converted text:

```tsx
import { ExternalSyncSourceField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-readonly-text.css';

<ExternalSyncSourceField
    mode="controlled"
    value="Native source Ω"
    language="en"
    textSize="small"
/>;
```

The host retains value conversion, masking, visibility and field-shell
associations. Pass a string, null or undefined with the accepted language and
optional `textSize`, `layout` and `className`. Null, undefined and empty text use
the complete localized empty display. Whitespace stays nonempty. Text remains
literal and uses the maintained readonly component's native automatic links;
ordinary text clicks reach the host row, while link clicks stop propagation
and retain their normal navigation behavior. Value or language replacement
updates the same mounted display. Source choices do not remap its text.

This mode has no binding, render override, setter, source selector or network
operation. Preserve the native converter's rejection of unsupported raw values
before rendering; do not extract a label from arbitrary source objects. The
binding mode continues to display its disabled input and Clear button with its
original masking, visibility and retirement behavior. Keep the two ownership
contracts separate.

## React Number presentation

The optional `/react` entry exports `NumberField`, `NumberFieldProps`,
`NumberFieldOptions` and `renderNumberField`. `NumberField` preserves the existing
`{ binding, render }` API; `render` replaces all markup. `className` decorates the
plain Number wrapper. Styles are optional and confined to `mx-sdk-number*` classes:

```tsx
import { NumberField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/number.css';

export function Quantity({ binding }: { binding: FormFieldBinding }) {
    return <NumberField binding={binding} className="quantity" />;
}
```

The named helper accepts `FieldRendererProps<'number'>` in the existing
`FieldRenderer`, `AirtableForm`, `AirtableGrid` and `AirtableList` slot map:

```tsx
import type { ReactNode } from 'react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import { renderNumberField } from '@miniextensions/sdk/react';

export const numberRenderers: FieldRendererSlots<ReactNode> = {
    renderNumberField,
};
```

Edits go through the accepted scalar's `setInput`. The control is a text input
with decimal input mode, so incomplete entries such as `-` and `1e` remain in the
owner alongside the last valid native value. A refused commit can represent
retained invalid input; the renderer uses the next owner snapshot instead of
discarding it. Decimal/exponent parsing, finite-number checks, validation and
explicit Save remain with the existing owner. An empty edit writes `null`; a zero
stays `0`. Initially absent values remain absent until editing. Loaded precision
and native units are retained without display rounding or conversion.

Keep owners outside React mounts. Mounting, StrictMode, remounting and styling do
not create or destroy a model, reset unfinished input, invoke Save or start a
request. A missing scalar capability is displayed disabled; raw numeric values
and a `setValue` action do not supply the missing input owner. Stale callbacks
still go through the owner/context guards. Applications own surrounding form
submission and must notify bindings when permissions or accepted context change.

The plain Number presentation includes unique label IDs, a hidden-title accessible
name, configured placeholder and required indication, associated plain-text polite
feedback, and visible keyboard focus. Explicitly empty feedback is preserved.
Read-only settings from display or write configuration further restrict editing;
numeric login masking from either configuration is preserved.
Pending, computed and unavailable controls are disabled. Retired scalar states
render nothing. Input events stop bubbling into Portal rows.

The Number presentation styles ordinary Number, Percent and Rating fields.
`NumberField` percent bindings use the same control through the
[Percent presentation](#react-percent-presentation), with native fractional units.
See the [Rating presentation](#react-rating-presentation) for its manual native-unit
contract. Currency bindings use the dedicated [Currency presentation](#react-currency-presentation);
duration bindings use the dedicated [Duration presentation](#react-duration-presentation)
and its existing clock-input model. Broader theme APIs remain separate work.
Canonical Save remains
authoritative for numeric field policy.
Input uses the scalar's native dot-decimal syntax. Configured decimal/thousands
separators, grouped display, scanning and login searches need their own accepted
integration or custom presentation; this renderer does not start those features.

The Number stylesheet is exported as `@miniextensions/sdk/react/number.css` and
copied into both builds. JavaScript does not import it, and core and `/ui` remain
React-free. Override the classes, omit the CSS, or supply a custom render function.

After building, `node examples/react-number/dev.mjs` serves a local synthetic
example at `http://127.0.0.1:4178`. `node scripts/check-number-browser.mjs` checks
native typing/caret, Enter in the example host, incomplete and invalid drafts,
remounts, permissions, external updates, repeated IDs, focus, forced colors and
narrow layout, and writes screenshots and a JSON receipt. It does not certify
every platform's input method, screen reader or surrounding form layout.

## React AutoNumber presentation

The optional `/react` entry exports `AutoNumberField`, `AutoNumberFieldProps`,
`AutoNumberFieldOptions` and `renderAutoNumberField`. The dedicated binding
component accepts `{ binding, render }` and `className`; supplying `render`
replaces all stock markup. It does not delegate to the editable `NumberField`.

```tsx
import { AutoNumberField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/number.css';

export function RecordSequence({ binding }: { binding: FormFieldBinding }) {
    return <AutoNumberField binding={binding} className="record-sequence" />;
}
```

The named helper accepts only `FieldRendererProps<'autoNumber'>` in
`FieldRenderer`, `AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { renderAutoNumberField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/number.css';

export const autoNumberRenderers: FieldRendererSlots<ReactNode> = {
    renderAutoNumberField: (props) =>
        renderAutoNumberField(props, { className: 'record-sequence' }),
};
```

This is a read-only presentation of the supplied native number. Finite numbers
display through `String(value)`, preserving zero, negatives and fractions and
using JavaScript's exponent notation when applicable. Null or missing values
display blank; defensive nonfinite or nonnumeric runtime values also display
blank. The renderer never generates a sequence, increments a value, clamps,
rounds, groups or applies locale formatting. The server and accepted owner
remain responsible for the value.

The shared Number control is always disabled. No scalar model or write setter
is borrowed, even if malformed runtime props claim an editable capability or
mark the field noncomputed. Programmatic input events do not grant editing
authority. There is no Clear button, local draft, parsing or Save action.
`AutoNumberFieldOptions` accepts only `className`; it adds no range, generation
or editing options. Existing Number, Currency and Duration routes are unchanged.

The control honors configured title visibility and uses the field name when the
title is blank. Repeated instances have unique label and feedback IDs, and hidden
titles retain an accessible name. Accepted login masking from either display or
write configuration uses a password input; this does not add login searches,
scanning or authentication. Pending state and existing error/validation feedback
are reflected without changing the supplied number. Feedback is plain text in
an associated polite live region; an explicitly empty error remains empty.
AutoNumber configuration does not declare a placeholder option.

The stock binding component requires physical `autoNumber` schema/configuration;
other binding kinds render status only. Hidden, blocked and retired bindings or
hosts omit the control. Custom rendering remains available through the existing
override. Mounting, StrictMode, remounting and unmounting do not create, destroy
or write an owner, trigger Save or start requests. A replacement binding displays
its own current value. Applications continue to own their surrounding forms.

Styles reuse optional `@miniextensions/sdk/react/number.css` and its
`mx-sdk-number*` classes. `className` decorates the wrapper. There is no separate
AutoNumber stylesheet export or JavaScript CSS import; core and `/ui` remain
React-free.

The synthetic `examples/react-autonumber` fixture uses public exports. After
building the SDK, run `node examples/react-autonumber/build.mjs`, then
`node examples/react-autonumber/dev.mjs`, and open
`http://127.0.0.1:4189`. `node scripts/check-autonumber-browser.mjs` verifies
disabled controls, native displays, masking, owner changes and layout locally.
These fixtures do not generate records or contact a backend.

## React Percent presentation

The optional `/react` entry exports `PercentField`, `PercentFieldProps`,
`ControlledPercentFieldProps`, `PercentFieldOptions` and `renderPercentField`.
The binding branch delegates to `NumberField`, whose physical percent bindings
use the same Number control.
`PercentFieldOptions` aliases `NumberFieldOptions` and accepts only `className`.
The existing `{ binding, render }` override still replaces all stock markup.

```tsx
import { PercentField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/number.css';

export function Ratio({ binding }: { binding: FormFieldBinding }) {
    return <PercentField binding={binding} className="ratio" />;
}
```

The named helper accepts only `FieldRendererProps<'percent'>` in `FieldRenderer`,
`AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { renderPercentField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/number.css';

export const percentRenderers: FieldRendererSlots<ReactNode> = {
    renderPercentField: (props) =>
        renderPercentField(props, { className: 'ratio' }),
};
```

This binding contract is manual native-unit entry. A native fraction of `0.25` appears as `0.25`
and editing `0.5` sets the native draft to `0.5`. The renderer does not multiply
or divide by 100, append `%`, clamp to a range, round to configured precision or
apply locale separators. It uses a text input with decimal input mode, or a
password input when accepted login masking requires it. There is no additional
percent parser or independent draft.

Edits go through the accepted numeric scalar's `setInput`. Partial or invalid
text such as `-` or `1e` stays visible across remounts alongside the last valid
native value. Existing owner validation blocks deliberate Save while editable visible
input is invalid. Repairing the draft accepts the owner's parsed number; an
explicit empty edit sets the native draft to `null`, and zero remains zero.
Untouched absent values stay absent. Focus and blur add no formatting or native
writes. There is no stock Clear button; applications may clear through the
existing owner or provide a custom renderer.

Editing requires the accepted editable numeric scalar for the percent field.
A raw value and `setValue` action do not replace that capability. Missing or
mismatched scalar capabilities and readonly controls display finite native values
without scaling and remain disabled. Read-only configuration, pending and
computed restrictions are preserved. Retired scalar states and hidden, blocked
or retired hosts omit the control; stale callbacks retain the owner's guards.

The Number control supplies unique label IDs, hidden-title accessible names,
placeholder and required indication, associated plain-text feedback and keyboard
focus styles. Mounting, StrictMode, remounting and unmounting do not create or
destroy an owner, reset unfinished input, invoke Save or start requests. Owners
remain outside React and Save remains explicit. Stopped event bubbling does not
prevent native Enter submission; applications own their enclosing form policy.

`showAsProgressBar`, grouped display and separator metadata do not turn this input
into a progress bar or change its numeric syntax. Those presentations need a
separate accepted custom integration. Existing page/server numeric policy remains
authoritative. Number, Currency and Duration bindings keep their existing routes
and native units.

There is no separate Percent stylesheet. Import the existing optional
`@miniextensions/sdk/react/number.css`, override its `mx-sdk-number*` classes or
supply your own styles. JavaScript does not import CSS; `className` decorates the
wrapper. Core and `/ui` remain React-free.

After building, `node examples/react-percent/dev.mjs` serves synthetic presentation
fixtures at `http://127.0.0.1:4186`. `node scripts/check-percent-browser.mjs` checks
native entry, retained partial drafts, remounts, restrictions and enclosing-form
Enter behavior. Simulated composition does not certify real OS input methods.

### Controlled physical Percent

Select the separate localized contract explicitly with `mode="controlled"`.
It delegates directly to the existing `CompleteLocalizedNumericField`; it does
not enter controlled Number or change the raw binding/helper behavior above.

```tsx
import {
    PercentField,
    type ControlledPercentFieldProps,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/localized-numeric.css';

export function LocalizedRatio({
    field,
    options,
}: Omit<ControlledPercentFieldProps, 'mode'>) {
    return <PercentField mode="controlled" field={field} options={options} />;
}
```

`field` must be the current `FieldRendererProps<'percent'>` for a physical
Percent field. Number/Currency props, a binding or a binding `render` callback
cannot be mixed into this branch. The host retains field configuration,
canonical fractional values, current write authority and explicit Save.
Rendering never creates a new owner or starts a provider operation.

With precision 2, native `0.75` displays `75.00`; a comma-decimal configuration
displays `75,00`. Editing `125,755` in that configuration writes fraction
`1.25755`, preserving fractional precision rather than rounding it as a Number.
An explicit empty edit writes `null`; zero, permitted negative values and values
above 100 percent remain distinct. Grouping is display-only, and the existing
numeric engine rejects nonfinite, exponent and grouped edit text.

Pass `options.owner` from the actual borrowed host lifetime. Its token/current
check and the guarded capability retain stale-owner and committed replacement
refusal; an ordinary value echo preserves the focused draft/caret. Existing
`options.commit` supports immediate writes or deferred blur/Enter/unmount
settlement. Readonly, pending and computed metadata never grant edit authority.
Native adoption must select physical noncomputed Percent separately; computed
effective-percent presentation remains with its existing renderer.

For readonly output, use `options.presentation: 'display'`; this shows configured
precision and `%`, with an optional localized `emptyLabel` and no editor. The
existing progress option calculates width from the numeric fraction, not
localized text. Only its visible fill clamps to 0–100; the canonical value is
unchanged. `options.input`, `inputRef`, label/feedback associations and optional
`localized-numeric.css` are the existing complete numeric component contracts.

## React Count presentation

The optional `/react` entry exports `CountField`, `CountFieldProps`,
`CountFieldOptions` and `renderCountField`. The binding component accepts the
existing `{ binding, render }` contract and `className`; supplying `render`
replaces all stock markup. `CountFieldOptions` aliases `NumberFieldOptions`.

```tsx
import { CountField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/number.css';

export function RecordCount({ binding }: { binding: FormFieldBinding }) {
    return <CountField binding={binding} className="record-count" />;
}
```

The named helper accepts only `FieldRendererProps<'count'>` in `FieldRenderer`,
`AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { renderCountField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/number.css';

export const countRenderers: FieldRendererSlots<ReactNode> = {
    renderCountField: (props) =>
        renderCountField(props, { className: 'record-count' }),
};
```

This is a read-only presentation of the supplied native value. Count metadata
must declare `field.config.options.isValid === true` before a finite number is
shown through `String(value)`. Zero, negative and fractional values remain native;
JavaScript exponent notation is retained when applicable. Accepted metadata with
`isValid: false` displays blank even when the owner still holds a number such as
`42`. Null or missing native values also display blank. Direct helper calls
defensively display blank for missing or malformed validity metadata and nonfinite
or nonnumeric values; renderer hosts may reject malformed fields before invoking
the helper. Rendering never clears or normalizes that native value. Changes to
accepted metadata update the display without calculating a count from linked
records, rounding, clamping, imposing integer constraints or applying locale
formatting.

The shared Number control is always disabled. Count has no scalar, local draft,
Clear button, parser or editing action. Neither a forged editable capability nor
`computed: false` grants authority: rendering does not read a scalar or call a
setter. The accepted owner and server supply Count values. Existing editable
Number, Percent, Rating, Currency and Duration routes keep their behavior.

Configured title visibility is honored, blank titles use the field name, and
hidden titles retain an accessible name. Repeated controls have unique label and
feedback IDs. Accepted masking from either display or write configuration uses
a password input. Pending state and existing error or validation messages remain
visible without changing the supplied value; feedback is plain text in an
associated polite live region, and an explicitly empty error stays empty.
Count configuration declares no placeholder or range options.

The stock binding component requires physical Count schema and configuration;
a different field kind renders a status. Hidden, blocked and retired bindings or
hosts omit the control. Custom rendering keeps precedence. Mounting, StrictMode,
remounting and unmounting do not create or destroy owners, write data, invoke Save
or start reads. A replacement binding displays its own accepted state.

Use existing readonly Form bindings and accepted Portal detail hosts. Grid and
List composition can display Count through those detail hosts without creating
an editable computed cell binding. Loading Portal data and submitting a surrounding
form remain explicit application-owned actions.

Styles reuse optional `@miniextensions/sdk/react/number.css` and its
`mx-sdk-number*` classes. `className` decorates the wrapper. There is no separate
Count stylesheet export or JavaScript CSS import; core and `/ui` remain React-free.

The `examples/react-count` fixture uses public exports and synthetic data. After
building, run `node examples/react-count/dev.mjs` and open `http://127.0.0.1:4190`.
`node scripts/check-count-browser.mjs` checks disabled controls, validity changes,
native display, masking, owner replacement and layout. These fixtures do not
calculate linked-record counts or contact a backend.

## React Rating presentation

The optional `/react` entry exports `RatingField`, `RatingFieldProps`,
`RatingFieldOptions` and `renderRatingField`. `RatingField` delegates to
`NumberField`, whose physical rating bindings use the same Number control.
`RatingFieldProps` aliases `NumberFieldProps`; `RatingFieldOptions` aliases
`NumberFieldOptions` and accepts only `className`.
The existing `{ binding, render }` override still replaces all stock markup.

```tsx
import { RatingField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/number.css';

export function Score({ binding }: { binding: FormFieldBinding }) {
    return <RatingField binding={binding} className="score" />;
}
```

The named helper accepts only `FieldRendererProps<'rating'>` in `FieldRenderer`,
`AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { renderRatingField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/number.css';

export const ratingRenderers: FieldRendererSlots<ReactNode> = {
    renderRatingField: (props) =>
        renderRatingField(props, { className: 'score' }),
};
```

This is manual native numeric entry. A native value of `3.5` appears as `3.5`;
editing `7.25` sets the native draft to `7.25`, even when field metadata says
`max: 5`. Finite negative, fractional and exponent inputs use the existing numeric
scalar. The renderer adds no stars, slider, range clamp, integer-only restriction,
rounding or locale formatting. It uses a text input with decimal input mode, or a
password input when accepted login masking requires it. There is no additional
rating parser or independent draft.

Edits go through the accepted numeric scalar's `setInput`. Partial or invalid
text such as `-` or `1e` stays visible across remounts alongside the last valid
native value. The existing scalar owner refuses Save while editable visible input
is invalid. Repairing the draft accepts the owner's parsed number; an
explicit empty edit sets the native draft to `null`, and zero remains zero.
Untouched absent values stay absent. The existing page owner treats required
Rating zero as empty for Next and final Submit admission: this validation does
not change the native zero or make the scalar input invalid. It is distinct from
scalar invalid-input refusal; lower-level binding Save is not a substitute for
page-owner admission. Focus and blur add no formatting or native writes. There is
no stock Clear button; applications may clear through the
existing owner or provide a custom renderer.

Editing requires the accepted editable numeric scalar for the rating field.
A raw value and `setValue` action do not replace that capability. Missing or
mismatched scalar capabilities and readonly controls display finite native values
without scaling and remain disabled. Read-only configuration, pending and
computed restrictions are preserved. Retired scalar states and hidden, blocked
or retired hosts omit the control; stale callbacks retain the owner's guards.

The Number control supplies unique label IDs, hidden-title accessible names,
required indication, associated plain-text feedback and keyboard focus styles.
Rating configuration does not declare a placeholder option. Mounting, StrictMode,
remounting and unmounting do not create or
destroy an owner, reset unfinished input, invoke Save or start requests. Owners
remain outside React and Save remains explicit. Stopped event bubbling does not
prevent native Enter submission; applications own their enclosing form policy.

Rating `max`, `icon` and `color` metadata do not create a star picker, set input
range attributes or change numeric syntax. A visual rating picker or a custom
range policy needs its own accepted integration. Existing page/server numeric policy remains
authoritative. Number, Currency and Duration bindings keep their existing routes
and native units.

There is no separate Rating stylesheet. Import the existing optional
`@miniextensions/sdk/react/number.css`, override its `mx-sdk-number*` classes or
supply your own styles. JavaScript does not import CSS; `className` decorates the
wrapper. Core and `/ui` remain React-free.

After building, `node examples/react-rating/dev.mjs` serves synthetic presentation
fixtures at `http://127.0.0.1:4188`. `node scripts/check-rating-browser.mjs` checks
native entry, retained partial drafts, remounts, restrictions and enclosing-form
Enter behavior. Simulated composition does not certify real OS input methods.

## React Date presentation

The optional `/react` entry exports `DateField`, `DateFieldProps`,
`DateFieldOptions` and `renderDateField` for calendar dates. The binding component
keeps its `{ binding, render }` API; supplying `render` still replaces all markup.
The binding contract selects the calendar or timestamp control from the accepted
model kind. `BindingDateField` explicitly names that legacy contract; existing
`DateField` and `DateTimeField` binding callers remain compatible. The complete natural `DateField` at `/react/date` is a separate controlled
contract. Do not combine binding and controlled props.

```tsx
import { DateField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/date.css';

export function DueDate({ binding }: { binding: FormFieldBinding }) {
    return <DateField binding={binding} className="due-date" />;
}
```

The named helper accepts `FieldRendererProps<'date'>` in `FieldRenderer`,
`AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { renderDateField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/date.css';

export const dateRenderers: FieldRendererSlots<ReactNode> = {
    renderDateField: (props) =>
        renderDateField(props, { clearLabel: 'Effacer la date' }),
};
```

Editing uses the existing owner-held date model, which accepts valid calendar
`YYYY-MM-DD` values. Partial or invalid input remains visible across remounts
without replacing the last accepted native value. The owner blocks deliberate
Save while editable date input is invalid. Repairing the text accepts the exact
calendar string; an explicit empty edit or Clear writes `null`. Untouched loaded
missing, null or blank values are not normalized. See the
[date model contract](field-bindings.md#calendar-dates-and-explicit-offset-datetimes)
for parsing, configuration retirement and validation details.

The slot requires an editable capability with a matching calendar-date bridge.
A generic value setter, a dateTime bridge or a readonly capability does not grant
date editing. Pending, computed and configured read-only controls are disabled.
The bridge and binding enforce existing current-owner checks on every action.
Hidden, blocked and retired hosts render nothing; applications must retire owners
on context replacement. Mounting, StrictMode and remounting neither create nor
dispose the owner, change its draft, invoke Save or start requests. Save and
cancellation remain explicit owner actions.

Controls use text inputs, or password inputs when masked, so unfinished calendar
text remains visible to its owner. This presentation adds no date picker,
natural-language parsing, timezone conversion or automatic submission. Title
visibility, placeholder, required indication, masking and read-only restrictions
are honored; masking and read-only settings from either display or write config
apply. The default placeholder is `YYYY-MM-DD`. Formatted model previews are not
written into native answers or shown alongside masked input.

Labels use unique React instance IDs for repeated rows, and hidden titles retain
an accessible name. Feedback is plain text in an associated polite live region.
Clear is `type="button"` and returns focus to the input. Its optional `clearLabel`
localizes the accessible name, with `Clear <title>` as the default. Click, pointer,
keyboard and composition events stop bubbling into Portal rows. Event containment
does not cancel native implicit form submission: pressing Enter can submit a
single-input form or activate an enclosing form's submit button. Applications own
the surrounding form's submission policy and must route Save deliberately through
the owner. `className` decorates the wrapper.

The provisional stylesheet is scoped to `mx-sdk-date*` classes and is exported as
`@miniextensions/sdk/react/date.css` in both builds. Import it, override its
classes, or omit it and supply your own styles. JavaScript does not import CSS;
core and `/ui` remain React-free. No theme or appearance-prop API is introduced.

The local `examples/react-date` example uses public exports and synthetic owners
without backend requests. After building, run `node examples/react-date/dev.mjs`.
`node scripts/check-date-browser.mjs` checks native interaction, invalid drafts,
remounting, clearing, permissions, layout and forced colors. Synthetic interaction
does not certify every platform's input method or screen reader.

## React Last Modified Time presentation

The natural `LastModifiedTimeField` also accepts complete controlled display
props, with `ControlledLastModifiedTimeFieldProps` and `LastModifiedTimeFieldConfig`
exported from `/react`. Supply the physical computed wrapper as `fieldConfig`;
its `options.isValid` gates text formatting and its `options.result` supplies the
accepted date or datetime configuration. Invalid configuration produces localized
empty text without inspecting the nested result. Native string/null values stay
with the caller; malformed runtime shapes show `invalidValueLabel` without coercion.

```tsx
import { LastModifiedTimeField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-readonly-text.css';
import '@miniextensions/sdk/react/button.css';

export function ModifiedDisplay({ value }: { value: string | null }) {
    return (
        <LastModifiedTimeField
            value={value}
            language="fr"
            fieldConfig={{
                type: 'lastModifiedTime',
                options: {
                    isValid: true,
                    result: {
                        type: 'dateTime',
                        options: {
                            dateFormat: { format: 'D MMMM YYYY' },
                            timeFormat: { format: 'HH:mm' },
                            timeZone: 'America/New_York',
                        },
                    },
                },
            }}
        />
    );
}
```

Date text defaults to English, matching the native last-modified wrapper's
recursive formatting, while `language` localizes empty UI labels. An explicit
`dateLanguage` opts into another supported date locale without changing global
locale or configured timezone. Created-time's existing default remains unchanged.

This complete branch reuses the same [Created-time display/resource engine](#react-created-time-presentation),
styles, owner/token/identity retirement, label/help/error association, preview,
document rendering and cleanup. Readonly safe HTTP(S) attachments take precedence
before button mode and before result metadata; button labels are trimmed. Readable
text is the fallback. `displayContext="editable"` keeps computed text and ignores
both resource flags. `inert` disables resource loading and activation. The field
has no editor, setter, Save, source-model fetch or provider authority.

`LastModifiedTimeFieldProps` retains its historical required `binding` shape.
`BindingLastModifiedTimeField` and `BindingLastModifiedTimeFieldProps` explicitly
name that compatibility contract. Controlled inputs and binding/render inputs are
mutually exclusive. The original binding component and physical renderer below
continue to display validity-gated raw timestamps rather than formatted text.

The optional `/react` entry exports `LastModifiedTimeField`,
`LastModifiedTimeFieldProps`, `LastModifiedTimeFieldOptions` and
`renderLastModifiedTimeField`. The binding component accepts `{ binding, render }`
plus `className` and `clearLabel`; a supplied `render` replaces its stock markup.
The options alias `DateTimeFieldOptions`.

```tsx
import { LastModifiedTimeField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/datetime.css';

export function RecordModifiedTime({ binding }: { binding: FormFieldBinding }) {
    return (
        <LastModifiedTimeField
            binding={binding}
            className="record-modified-time"
        />
    );
}
```

The named helper accepts `FieldRendererProps<'lastModifiedTime'>` in
`FieldRenderer`, `AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import {
    renderLastModifiedTimeField,
    type DateTimeFieldOptions,
} from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/datetime.css';

const timestampOptions: DateTimeFieldOptions = {
    className: 'record-modified-time',
    clearLabel: 'Keep modification time',
};
export const lastModifiedTimeRenderers: FieldRendererSlots<ReactNode> = {
    renderLastModifiedTimeField: (props) =>
        renderLastModifiedTimeField(props, timestampOptions),
};
```

The control presents a supplied native string only when Last Modified Time
metadata has `options.isValid === true`. False, missing or malformed validity
metadata displays blank without replacing the owner's value. Null, missing and
nonstring values also display blank in direct helper calls, without coercion.
Hosts may reject malformed native values or metadata before calling the helper;
accepted `isValid: false` metadata still needs a valid nested result configuration.

Valid presentation preserves supplied offsets, fractional seconds, whitespace,
naive timestamps and invalid strings accepted by the owner. The renderer does
not parse or validate timestamp text, format nested `date`/`dateTime` results, or
convert timezones. It does not interpret `referencedFieldIds`, inspect record
changes or generate a modification timestamp. Changing validity can change whether
the string is shown; changing nested result or referenced-field metadata does not
reinterpret it. None of these changes normalizes the native answer. Use the
controlled contract above for formatted dates. The single-line input sanitizes CR/LF in its displayed
value; those native bytes remain unchanged in the owner.

The DateTime input and its existing Clear button are always disabled. `clearLabel`
changes only the disabled button's accessible label. The renderer creates no date
model and borrows no editing capability, even if malformed runtime props claim
write authority. Physical Last Modified Time remains readonly when metadata reports
`isComputed: false`. Rendering does not invoke Save, read records or start requests.

Existing title visibility, fallback titles, configured placeholder, required
indication, unique label IDs and accessible hidden titles apply. Masking from either
display or write configuration hides the input text without a separate native-value
readout. Pending state and supplied error/validation messages use associated
plain-text feedback; `isValid: false` alone does not add an error message.
The shared `YYYY-MM-DDTHH:mm:ssZ` placeholder is a presentation default, not a parser.
Control events remain contained within the shared control.

Wrong physical bindings show a status, while custom rendering keeps precedence.
Hidden, blocked and retired bindings or hosts omit the stock control. Mounting,
StrictMode, owner replacement and remounting preserve accepted native values.
Form composition uses accepted Form owners. Grid and List use accepted Portal
detail hosts without fabricating computed inline editing bindings. Loading and
submission remain explicit application operations; editable DateTime and Text
controls keep their existing behavior.

Styles reuse optional `@miniextensions/sdk/react/datetime.css` and the
`mx-sdk-datetime*` classes; no Last Modified Time stylesheet is added. The local
`examples/react-last-modified-time` fixture uses public exports and synthetic
owners. See [Last Modified Time presentation checks](testing.md#last-modified-time-presentation-checks)
for source, package and native browser verification.

## React Created Time presentation

The optional `/react` entry exports the natural `CreatedTimeField` for controlled
display or existing binding consumers. `ControlledCreatedTimeFieldProps` requires
the supplied `value`, `dateConfig` and `language`. It formats through the shared
date engine and readonly text primitive; it never creates a timestamp or setter.
The application supplies the accepted date/dateTime result configuration explicitly.
Optional `dateLanguage` selects the date text's locale separately from the localized
empty-value `language`; it defaults to `language`. For example, a host preserving
English named-month dates with French empty text supplies `language="fr"` and
`dateLanguage="en"`. The override uses the same supported language codes, preserves
the configured timezone, and does not change the legacy binding's raw timestamp.

```tsx
import { CreatedTimeField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-readonly-text.css';
import '@miniextensions/sdk/react/button.css';

export function CreatedDisplay({ value }: { value: string | null }) {
    return (
        <CreatedTimeField
            value={value}
            language="en"
            dateConfig={{
                type: 'dateTime',
                options: {
                    dateFormat: { format: 'YYYY-MM-DD' },
                    timeFormat: { format: 'HH:mm' },
                    timeZone: 'America/New_York',
                },
            }}
        />
    );
}
```

Readonly `displayAsAttachments` selects one accepted HTTP(S) resource before
`displayAsButton`; a button admits the existing safe link policy, including mailto.
The computed `displayContext="editable"` path ignores both flags and keeps date
formatting. Null/missing values use localized empty text; malformed runtime shapes
use `invalidValueLabel` without coercion. `masked` prevents value/config inspection.
`presentation` composes the existing shell's label, help, error and form association.
The shell remains the single owner of that chrome.

`owner` optionally supplies `{token, isCurrent()}` and `identity` distinguishes
source lifetimes. A false/throwing owner omits the display; current-owner checks
also guard retained resource actions, URL replacement, A→B→A and cleanup. `inert`
prevents resource activation/loading for preview or authority projection. No source
fetch, Save, provider action, editor, upload or field writer is acquired.

Attachment options project grid/icon/thumbnail layout, size/fit, name visibility
and independent Open/Download permissions. Images use the shared recoverable image;
thumbnail loading follows visibility, while icon mode matches native immediate
image display. A current explicit action opens the native dialog. URL-only image
and exact lowercase `.pdf` modal classification matches native dispatch. `labels`
supplies localized resource actions/retry/error text. Download is explicit,
cancelable and owner scoped.

`attachmentOptions.documentPreview` explicitly admits generic document content.
Omitting it preserves URI-only behavior without speculative document requests.
Its `source` is either `{kind: 'uri', mimeType?, revision?}` or
`{kind: 'bytes', bytes: Uint8Array, mimeType, revision}`. Owned bytes are copied;
replace the byte view or revision when content changes. URI mode uses credential-free
HEAD discovery only when MIME is absent, then a cancelable GET for admitted types.
This resource load never fetches a field/source model or changes its canonical URL.
Unknown/octet-stream, Office, archive and provider formats remain unavailable.

One SDK content leaf renders literal TXT, quoted CSV tables, sanitized HTML,
PNG/BMP/JPEG/GIF, first-directory TIFF (including native uncompressed/PackBits),
and PDF. Malformed CSV is unavailable. HTML cannot load embedded resources,
navigate, submit controls or install styles/global IDs. Form thumbnails exclude
exact lowercase `.pdf` URLs and hide PDF controls; grid thumbnails retain PDF
page, zoom/reset and single/all-page controls. Grid PDF Download uses admitted
bytes and respects `disableDownloadFiles`. MIME discovered for an opaque thumbnail
stays private and cannot reclassify its modal.

PDF requires both `pdfWorkerUrl` and `pdfResourceBaseUrl`. Deploy the exported
`@miniextensions/sdk/react/document-preview/pdfjs-6.5.438/*` assets unchanged at
one same-origin base ending in `/`; set the worker URL to its `pdf.worker.mjs`.
The package carries a version-matched module worker, CMaps, fonts and WASM with an
integrity manifest. The application supplies asset URLs explicitly; there is no
CDN, guessed worker location, global worker setting or external provider.

`documentPreview` also enables an SDK canvas viewer for canonically known
lowercase `.pdf` modals, including HTTP resources admitted by the URL policy.
This uses credential-free bytes and a local worker, not an HTTP iframe exception.
Without this option, existing HTTPS-only sanitized PDF frame behavior remains.
Each worker, reader, canvas and object URL belongs to the visible current
owner/token/identity/content revision and is retired on replacement, concealment
or unmount. Startup errors show localized unavailable feedback and terminate the
owned worker. No native React renderer or provider callback is accepted.

The private browser PDF engine is bundled at build time; consumers retain the
SDK's Node >=22 engine contract and optional React18/19 peers. Importing or
server-rendering the public field creates no worker or document request.

`CreatedTimeFieldProps` deliberately retains the original required `binding` shape.
`BindingCreatedTimeField` and `BindingCreatedTimeFieldProps` name the compatibility
contract explicitly. It accepts `{ binding, render }` plus `className` and
`clearLabel`; a supplied `render` replaces its stock markup. Controlled inputs
cannot be mixed with binding/renderer inputs. `CreatedTimeFieldOptions` still aliases
`DateTimeFieldOptions`, and `renderCreatedTimeField` keeps the typed physical slot.

```tsx
import { CreatedTimeField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/datetime.css';

export function RecordCreatedTime({ binding }: { binding: FormFieldBinding }) {
    return (
        <CreatedTimeField binding={binding} className="record-created-time" />
    );
}
```

The named helper accepts `FieldRendererProps<'createdTime'>` in `FieldRenderer`,
`AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { renderCreatedTimeField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/datetime.css';

export const createdTimeRenderers: FieldRendererSlots<ReactNode> = {
    renderCreatedTimeField: (props) =>
        renderCreatedTimeField(props, { className: 'record-created-time' }),
};
```

The binding control presents the supplied native timestamp string without parsing,
formatting, validation or timezone conversion. It retains offset spelling,
fractional seconds, whitespace, naive timestamps and invalid strings accepted by
the owner. Nested `date` or `dateTime` result metadata is not interpreted, and
metadata changes do not normalize the native answer. Use controlled props for
formatted dates. The single-line input sanitizes CR/LF in its displayed value;
rendering does not write that DOM representation back to the owner.

Null, missing and nonstring values display blank in direct helper calls without
object coercion. Hosts may reject malformed native values before calling the
helper. The DateTime input and its existing Clear button are always disabled;
`clearLabel` changes only the disabled button's accessible label. The renderer
creates no date model and reads no editing capability, even if malformed runtime
props claim write authority. Physical Created Time remains readonly when metadata
reports `isComputed: false`. Rendering does not generate timestamps, invoke Save
or read a backend.

Existing title visibility, fallback titles, unique label IDs, masking from either
display or write configuration, pending state and plain-text error/validation
feedback apply. The shared control retains its `YYYY-MM-DDTHH:mm:ssZ` default
placeholder; it is not a parser or an editing prompt for this disabled field.
Wrong physical bindings show a status, while custom rendering keeps precedence.
Hidden, blocked and retired bindings or hosts omit the control. Mounting,
StrictMode, owner replacement and remounting preserve the accepted native value.

Form composition uses accepted Form owners. Grid and List use accepted Portal
detail hosts without fabricating computed inline editing bindings. Data loading
and form submission remain explicit application operations. Editable DateTime and
Text controls keep their existing behavior.

Binding styles reuse optional `@miniextensions/sdk/react/datetime.css` and the
`mx-sdk-datetime*` classes. Controlled display reuses readonly-text, button,
HTML-description and field-presentation styles as applicable; no Created Time
stylesheet is added. The synthetic
`examples/react-created-time` fixture uses public exports. See [Created Time
presentation checks](testing.md#created-time-presentation-checks) for package and
local browser verification.

## React DateTime presentation

The optional `/react` entry exports `DateTimeField`, `DateTimeFieldProps`,
`DateTimeFieldOptions` and `renderDateTimeField` for explicit-offset timestamps.
The binding component keeps its `{ binding, render }` API; supplying `render`
still replaces all markup. `BindingDateTimeField` explicitly names this legacy
contract; the existing `DateTimeField` binding name remains compatible. The
complete controlled `DateTimeField` uses the opt-in `/react/date` entry below.
The binding component selects its control from the accepted model kind.

```tsx
import { DateTimeField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/datetime.css';

export function EventTime({ binding }: { binding: FormFieldBinding }) {
    return <DateTimeField binding={binding} className="event-time" />;
}
```

The named helper accepts `FieldRendererProps<'dateTime'>` in `FieldRenderer`,
`AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { renderDateTimeField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/datetime.css';

export const dateTimeRenderers: FieldRendererSlots<ReactNode> = {
    renderDateTimeField: (props) =>
        renderDateTimeField(props, { clearLabel: 'Effacer la date et heure' }),
};
```

Editing uses the existing owner-held date model. Accepted input has the shape
`YYYY-MM-DDTHH:mm:ss[.S|.SS|.SSS](Z|±HH:mm)`: seconds and an explicit offset are
required. The model preserves the exact accepted offset and fractional-second
spelling; the renderer does not normalize answers through JavaScript `Date`, a
local-time input or a formatted preview. Partial or invalid input stays visible
across remounts without replacing the last accepted native value. Naive timestamps
remain invalid; an offset is never guessed from a timezone or daylight-saving rule.

The owner blocks deliberate Save while editable dateTime input is invalid.
Repairing the text accepts its exact native string; an explicit empty edit or
Clear writes `null`. Untouched loaded missing, null or blank answers are not
normalized. See the [date model contract](field-bindings.md#calendar-dates-and-explicit-offset-datetimes)
for parsing, configuration/client-zone retirement and validation details.

The slot requires an editable capability with a matching dateTime bridge. A
generic value setter, a calendar-date bridge or a readonly capability does not
grant timestamp editing. Pending, computed and configured read-only controls are
disabled. The bridge and binding enforce existing current-owner checks on every
action. Hidden, blocked and retired hosts render nothing. A retired date model
in the binding component retains its existing status asking for a fresh Form.
Applications must retire owners on context replacement. Mounting, StrictMode and
remounting neither create nor dispose the owner, change its draft, invoke Save or
start requests. Save and cancellation remain explicit owner actions.

The control uses a text input, or a password input when masked, with
`YYYY-MM-DDTHH:mm:ssZ` as its default placeholder. Title visibility, configured
placeholder, required indication, masking and read-only restrictions are honored;
masking and read-only settings from either display or write config apply. Formatted
model previews are not shown alongside masked input. This presentation adds no
date picker, timezone picker, natural-language parsing or automatic submission.

Labels use unique React instance IDs for repeated rows, and hidden titles retain
an accessible name. Feedback is plain text in an associated polite live region.
Clear is `type="button"` and returns focus to the input. Its optional `clearLabel`
localizes the accessible name, with `Clear <title>` as the default. Click, pointer,
keyboard and composition events stop bubbling into Portal rows. Event containment
does not cancel native implicit form submission: pressing Enter can submit a
single-input form or activate an enclosing form's submit button. Applications own
the surrounding form's submission policy and must route Save deliberately through
the owner. `className` decorates the wrapper.

The provisional stylesheet is scoped to `mx-sdk-datetime*` classes and is exported
as `@miniextensions/sdk/react/datetime.css`, with copies in both builds. Import it,
override its classes, or omit it and supply your own styles. JavaScript does not
import CSS; core and `/ui` remain React-free. No theme or appearance-prop API is
introduced.

The local `examples/react-datetime` example uses public exports and synthetic
owners without backend requests. After building, run
`node examples/react-datetime/dev.mjs`. `node scripts/check-datetime-browser.mjs`
checks native interaction, invalid drafts, remounting, clearing, permissions,
layout and forced colors. Synthetic interaction does not certify every platform's
input method or screen reader.

## React Duration presentation

The optional `/react` entry exports `DurationField`, `DurationFieldProps`,
`DurationFieldOptions` and `renderDurationField` for duration clocks. The binding
component keeps its `{ binding, render }` API; supplying `render` still replaces
all markup. `NumberField` continues to recognize duration bindings and retains its
ordinary numeric behavior.

```tsx
import { DurationField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/duration.css';

export function ElapsedTime({ binding }: { binding: FormFieldBinding }) {
    return <DurationField binding={binding} className="elapsed-time" />;
}
```

The named helper accepts `FieldRendererProps<'duration'>` in `FieldRenderer`,
`AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { renderDurationField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/duration.css';

export const durationRenderers: FieldRendererSlots<ReactNode> = {
    renderDurationField: (props) =>
        renderDurationField(props, { clearLabel: 'Effacer la durée' }),
};
```

The renderer borrows `binding.scalar` or the accepted duration scalar bridge.
Native answers remain numeric seconds or `null`; there is no additional draft or
owner. It calls the existing `setInput` for edits and `setFocused` on focus/blur.
Focusing preserves raw input, and blurring formats a valid answer without writing
or rounding its native seconds. Partial or invalid text stays visible across
remounts without replacing the last accepted answer. Existing owner validation
blocks deliberate Save while editable visible input is invalid. Clear and an
explicit empty edit write `null`; zero remains zero.

The physical field's accepted `durationFormat` selects one of `h:mm`, `h:mm:ss`,
`h:mm:ss.S`, `h:mm:ss.SS` or `h:mm:ss.SSS`. Bare numbers use minutes for `h:mm` and
seconds for the other formats; two components mean hours/minutes for `h:mm` and
minutes/seconds otherwise. The complete [duration input contract](field-bindings.md#duration-clock-input)
defines three-part values, negative values, overflow, decimal precision and
invalid syntax. The renderer adds no parsing rules or unit conversion.

Editing requires the matching physical duration field and editable scalar bridge,
including its `setFocused` action. A generic value setter, another scalar kind or
a bridge without focus support does not grant duration editing. Readonly values
and values without an editable bridge use the existing duration formatter with
validated format metadata and explicit native-seconds units. They remain
disabled. Missing or unsupported formats produce generic unavailable feedback.
Pending, computed and configured read-only controls are also disabled.

The bridge and binding retain existing permission, configuration and current-owner
checks on every action. An observed format change retires the old model; accept
a fresh owner before editing the replacement. Hidden, blocked and retired hosts
render nothing. Owners remain outside React: mounting, StrictMode and remounting
neither create nor dispose an owner, write a draft, invoke Save nor start network
work. Save and cancellation remain explicit owner actions.

The control uses a text input, or a password input when masked. Its default
placeholder is the accepted duration format. Title visibility, configured
placeholder, required indication, masking and read-only restrictions are honored;
masking and read-only settings from either display or write config apply. Native
seconds and formatted previews are not echoed beside masked input.

Labels use unique React instance IDs for repeated rows, and hidden titles retain
an accessible name. Feedback is plain text in an associated polite live region.
Clear is `type="button"` and returns focus to the input. Its optional `clearLabel`
localizes the accessible name, with `Clear <title>` as the default. Click, pointer,
keyboard and composition events stop bubbling into Portal rows. Event containment
does not cancel native implicit form submission: pressing Enter can submit a
single-input form or activate an enclosing form's submit button. Applications own
the surrounding form's submission policy and must route Save deliberately through
the owner. `className` decorates the wrapper.

The provisional stylesheet is scoped to `mx-sdk-duration*` classes and is exported
as `@miniextensions/sdk/react/duration.css`, with copies in both builds. Import it,
override its classes, or omit it and supply your own styles. JavaScript does not
import CSS; core and `/ui` remain React-free. No theme or appearance-prop API is
introduced.

The local `examples/react-duration` example uses public exports and synthetic
owners without backend requests. After building, run
`node examples/react-duration/dev.mjs`. `node scripts/check-duration-browser.mjs`
checks native interaction, unfinished drafts, remounting, clearing, permissions,
layout and forced colors. Synthetic interaction does not certify every platform's
input method or screen reader.

## React Currency presentation

For a native host's accepted controlled currency props, use the public component
directly. The physical discriminator selects the existing localized numeric
engine; its guarded canonical writer and explicit Save remain with the host.

```tsx
import { CurrencyField } from '@miniextensions/sdk/react';
import type { FieldRendererProps } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/localized-numeric.css';

export function ControlledAmount(props: FieldRendererProps<'currency'>) {
    return <CurrencyField {...props} options={{ presentation: 'editor' }} />;
}
```

The controlled API also accepts the shared numeric options for a current owner,
deferred commits, readonly display, localized Clear/empty labels and existing
input/form/help associations. For example, precision 2 with period-comma grouping
displays canonical `1234.56789` as `1.234,57` without writing it. Readonly display
places a negative sign before the literal currency symbol. It does not accept a
binding or whole-field renderer. The legacy binding API below is unchanged.

The optional `/react` entry exports `CurrencyField`, `CurrencyFieldProps`,
`CurrencyFieldOptions` and `renderCurrencyField`. The binding component supports
the existing `{ binding, render }` API; supplying `render` replaces all markup.
`NumberField` also recognizes physical currency bindings and retains its ordinary
numeric behavior for other numeric fields.

```tsx
import { CurrencyField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/currency.css';

export function Amount({ binding }: { binding: FormFieldBinding }) {
    return <CurrencyField binding={binding} className="invoice-amount" />;
}
```

The named helper accepts `FieldRendererProps<'currency'>` in `FieldRenderer`,
`AirtableForm`, `AirtableGrid` and `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { renderCurrencyField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/currency.css';

export const currencyRenderers: FieldRendererSlots<ReactNode> = {
    renderCurrencyField: (props) =>
        renderCurrencyField(props, { clearLabel: 'Effacer le montant' }),
};
```

This is a native-unit input with a currency-symbol label. The symbol comes from
the accepted physical field's `options.symbol` and renders as literal text outside
the input. It is associated through `aria-describedby`; HTML-looking symbols are
never interpreted as markup. The raw input uses the existing numeric scalar
model. Decimal and exponent syntax must produce a finite number; partial or
invalid input remains visible across remounts without replacing the last accepted
native answer. See [scalar inputs](field-bindings.md#checkbox-and-numeric-inputs)
for the owner and validation contract.

For example, a native `1234.56789` remains `1234.56789` with configured precision
two. `precision`, `numberSeparator` and `showThousandsSeparator` do not alter input,
round native values or introduce a locale parser. Comma-separated input is not
automatically converted. Currency conversion, grouping, precision rounding and
canonical formatted-display parity are outside this presentation. Canonical
formatting may place signs and symbols differently; this control keeps the literal
symbol separate from the raw signed number.

Edits and Clear use only the accepted scalar bridge's `setInput`; Clear sends an
empty input, which sets the native draft to `null`. Zero remains zero. Untouched empty answers are
not normalized. Focus and blur do not reformat or write values, and this component
adds no focus-state model. Existing owner validation blocks deliberate Save while
editable visible input is invalid. Save and cancellation remain explicit owner
actions.

Editing requires an editable capability with the matching numeric scalar bridge.
A generic value setter or another scalar kind does not grant currency editing.
Readonly slots and slots without that bridge show `String(value)` for finite
native numbers and remain disabled. Pending, computed and configured read-only
controls are also disabled. Existing permission, configuration and current-owner
checks still guard every action. Hidden, blocked and retired hosts render nothing.
Owners stay outside React: mounting, StrictMode and remounting neither create nor
dispose owners, change drafts, invoke Save nor start requests.

The control uses a text input with decimal input mode, or a password input when
masked. Title visibility, configured placeholder, required indication, masking and
read-only restrictions are honored; masking and read-only settings from either
display or write config apply. Native amounts are not echoed beside masked input.
Labels use unique React instance IDs for repeated rows, and hidden titles retain
an accessible name. Feedback is plain text in an associated polite live region.

Clear is `type="button"` and returns focus to the input. Its optional `clearLabel`
localizes the accessible name, with `Clear <title>` as the default. Click, pointer,
keyboard, focus and composition events stop bubbling into Portal rows. Event
containment does not cancel native implicit form submission. Applications own the
surrounding form's submission policy and must route Save deliberately through the
owner. `className` decorates the wrapper.

The provisional stylesheet is scoped to `mx-sdk-currency*` classes and is exported
as `@miniextensions/sdk/react/currency.css`, with copies in both builds. Import it,
override its classes, or omit it and supply your own styles. JavaScript does not
import CSS; core and `/ui` remain React-free. No theme or appearance-prop API is
introduced.

The local `examples/react-currency` example uses public exports and synthetic
owners without backend requests. After building, run
`node examples/react-currency/dev.mjs` and open `http://127.0.0.1:4182`.
`node scripts/check-currency-browser.mjs` checks native interaction, unfinished
drafts, remounting, clearing, permissions, layout and forced colors. Synthetic
interaction does not certify every platform's input method or screen reader.

## Bounded React Linked Records renderer

Register `renderMultipleRecordLinksField` from `@miniextensions/sdk/react` in
`AirtableForm`, `AirtableGrid` or `AirtableList` renderer slots. It also accepts a
current `FieldRendererProps<'multipleRecordLinks'>` directly; optional
`LinkedRecordsFieldOptions` currently provides `className`. Import
`@miniextensions/sdk/react/linked-records.css` for scoped default styling. See the
[local example](https://github.com/miniExtensions/sdk/tree/main/examples/react-linked-records).

The slot borrows existing selection and `readSelected` actions. **Load selected**,
**Search** and **Load more** are explicit reads. Typing only updates the owner's
search input; rendering and mounting perform no hydration. Selecting, removing or
clearing updates the draft; the application still owns explicit Save. Readonly,
computed, pending and disabled capabilities cannot edit, and absent selection
capability has no `setValue` fallback. A readonly Form can still explicitly load
its selected presentation when the existing read capability permits it.

Native order and duplicate occurrences are preserved for display. Form labels
use the owner's privacy-filtered selected records, supported selected policy and
an unhidden, unmasked primary in a present detail projection. Missing, null or
empty projections, filtered records, ambiguous metadata and blank labels show
**Linked record unavailable**. Portal labels use the host's detached pill
occurrences. Candidate and cached option labels never recover a selected label;
selected candidates are omitted from search results. ID fallback option labels
are generic. Masking from either display or write configuration covers selected
labels, candidates and search inputs. Feedback is generic because owner errors
can contain IDs or filtered labels. This renderer expands no nested fields and
exposes no child create/edit action.

Edits propose changes from the complete incoming native array, preserving filtered
identities. The existing `SelectionModel.choose` normalizes IDs with `Set` (first
occurrence order); removing one displayed identity removes all its occurrences.
`setValue` also routes through this existing model. Retaining duplicates through
mutations would require an owner/model contract change and is outside this slot.

Local in-flight feedback is scoped to the existing internal `FieldRendererSource`
identity and mount lifetime. Hosted snapshots from the same host retain it;
replacement hosts and A→B→A transitions retire it. Direct calls conservatively
use the incoming renderer-props object identity: a new props object retires local
feedback even when its field ID matches. Only one local generation is retained;
returning to an old object does not revive its feedback. Query text, option pages
and selected labels remain owner state, with the owner's existing retention and
scope fences. Unmounting never cancels or disposes borrowed owners. The renderer
adds no cache, selection model or write authority. The older `LinkedField`
binding component remains separate from this bounded slot.

## React Formula presentation

The optional `/react` entry exports `FormulaField`, `FormulaFieldProps`,
`FormulaFieldOptions` and `renderFormulaField`. They display the owner's supplied
computed answer as inert, selectable text. No editor, Clear control, calculation,
write, Save, resource loading or navigation is added. Physical Formula remains
readonly even if runtime hints say `isComputed: false`; capabilities are never
borrowed. Rollup and Lookup retain their separate slots.

```tsx
import { FormulaField, renderFormulaField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import type { ReactNode } from 'react';

export const formulaRenderers: FieldRendererSlots<ReactNode> = {
    renderFormulaField: (props) =>
        renderFormulaField(props, { className: 'computed-answer' }),
};
// With an accepted Formula Form binding:
// <FormulaField binding={formulaBinding} className="computed-answer" />
```

Pass `formulaRenderers` to `AirtableForm`, `AirtableGrid`, `AirtableList` or
`FieldRenderer`. Grid/List use accepted Portal detail hosts without a computed
inline editing binding. The binding component retains `{ binding, render }`;
custom rendering replaces the default markup. Hidden/retired bindings and blocked
hosts omit the output. Another physical kind renders a status message.

Native numeric, percent, currency, duration, boolean, date/dateTime, text,
select, collaborator, timestamp, barcode, Button, attachment, linked-record,
AI text and nested computed result configurations use the existing readable-value
formatters. Scalar-result arrays keep order and existing null-member omission;
array-valued result configurations delegate their whole native array to the
existing result-type formatter. Number precision, currency signs, percent scaling,
duration rounding, date/time metadata and readable rich-text conversion affect
presentation only. Native values, offsets, arrays, objects and dirty state remain
with the owner. No field-reference or expression evaluation occurs.

Null/missing values and unavailable result metadata display blank. Native
`{ error: string }` cells and scalar-array error members retain their readable
error text; special-number envelopes retain existing formatting. Malformed direct
values, incompatible result shapes or formatting failures display `Unavailable`
with `aria-invalid`, without raw exception details. Hosts may refuse malformed
metadata/values before the slot runs.

Contract boundaries: renderer props have no linked-table hydration context, so
unresolved native record IDs become `Unavailable` and no records are fetched.
Generated result metadata includes `manualSort`, but the existing renderer
admission contract rejects it. Nested array-valued computed combinations that the
existing formatter cannot consume display `Unavailable`; this component does not
repair shared conversion or admission contracts. Those gaps also affect future
Rollup/Lookup work and require separate coordination.

HTML, attachment and Button display flags stay inert text; markup and URLs are
never interpreted as HTML, links, images or downloads. Existing masking flags
from either configuration surface replace the value with a fixed mask before
formatting, so the formatted answer does not enter DOM text or attributes. Native
collaborator formatting displays the supplied name without resolving an identity
or loading an avatar. Title visibility, field-name fallback, unique associated
labels, pending state and plain-text validation feedback are preserved. An
explicitly empty error keeps precedence over validation text.

`className` decorates `mx-sdk-formula-field`. No stylesheet or package subpath is
added; wrapping and line breaks work without CSS. Applications may style the
wrapper, label and `output`. Existing core and `/ui` exports remain React-free.

## React Rollup presentation

`RollupField` also accepts an explicit `mode="controlled"` branch with
`ControlledRollupFieldProps`. Native owners pass current `isValid` metadata and,
only when valid, the string returned by their existing readable conversion:

```tsx
import { RollupField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-readonly-text.css';

<RollupField
    mode="controlled"
    isValid={true}
    value="CHF 0.000"
    language="en"
/>;
<RollupField mode="controlled" isValid={false} language="en" />;
```

The SDK owns the complete invalid-result alert and valid readonly text UI:
literal markup, linkification with link-click propagation containment, localized
empty values, and optional `textSize`, `layout` and `className`. The native owner
retains conversion, linked-table context and current metadata validity. Invalid
metadata carries no stale value. No binding, client, write callback, aggregation
or injected React renderer belongs in this branch. The exported
`RollupFieldProps` compatibility alias remains binding-only. Mixed branch props
are rejected. The binding and slot contracts below retain their inert semantics.

The optional `/react` entry exports `RollupField`, `RollupFieldProps`,
`RollupFieldOptions` and `renderRollupField`. They display the supplied aggregate
answer as inert, selectable text. No aggregation, expression evaluation, linked
record read, editor, Clear control, Save, resource loading or navigation is added.
Physical Rollup remains readonly even when runtime hints say `isComputed: false`.
Formula and Lookup retain separate slots; Lookup's array/provenance contract is
not changed by this presentation.

```tsx
import { RollupField, renderRollupField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';
import type { ReactNode } from 'react';

export const rollupRenderers: FieldRendererSlots<ReactNode> = {
    renderRollupField: (props) =>
        renderRollupField(props, { className: 'aggregate-answer' }),
};
// With an accepted Rollup Form binding:
// <RollupField binding={rollupBinding} className="aggregate-answer" />
```

Pass the slots to `AirtableForm`, `AirtableGrid`, `AirtableList` or
`FieldRenderer`. Grid/List use accepted Portal detail hosts without a computed
inline editing binding. The binding component retains `{ binding, render }`;
custom rendering replaces the default markup. Hidden/retired bindings and blocked
hosts omit output. Another physical kind renders a status message.

Supplied numeric, percent, currency, duration, date/dateTime, text, select,
collaborator, attachment and other admitted native results use the existing
readable-value formatters. Scalar-result arrays preserve order, duplicates and
existing null-member omission; top-level array-valued result configurations use
their native whole-array formatter. Number precision, date/time metadata and
readable rich-text conversion affect presentation only. Native values, arrays,
objects and dirty state remain with the owner. Rollup provenance metadata grants
no hydration or write authority.

Null/missing values and unavailable result metadata display blank. Native
`{ error: string }` cells retain their readable error text, including when result
metadata is unavailable; special-number envelopes use existing formatting.
Malformed direct values, incompatible result shapes and formatting failures
show `Unavailable` with `aria-invalid`, without raw exception details. Hosts may
refuse malformed metadata/values before the slot runs.

Existing contract limits are preserved: renderer props provide no linked-table
hydration context, so unresolved native record IDs show `Unavailable` and no
records are fetched. Generated metadata includes `manualSort`, while shared
renderer admission rejects it. Nested array-valued computed combinations that
the existing formatter cannot consume show `Unavailable`. This component does
not flatten unsupported nested arrays or change shared conversion/admission.

Markup, URLs, attachment and Button results stay literal text, including any
forged special display flags. Masking flags from either configuration surface
replace the value with a fixed mask before formatting. Titles, field-name
fallback, unique associated labels, pending state and plain-text validation
feedback follow existing presentation behavior. An explicitly empty error keeps
precedence over validation text. Row interaction events are contained without
preventing text selection. Supplied capabilities are never borrowed.

`className` decorates `mx-sdk-rollup-field`; no CSS import or package subpath is
required. Default markup preserves line breaks and wraps long text. Core and
`/ui` remain React-free.

## React Lookup presentation

The optional `/react` entry exports `LookupField`, `LookupFieldProps`,
`LookupFieldOptions` and `renderLookupField`. The physical field kind remains
`multipleLookupValues`; it retains the existing `renderMultipleLookupValuesField`
slot and its correlated array-or-native-error value type. Formula and Rollup are
separate physical slots. Lookup is readonly even with `isComputed: false`.

```tsx
import type { ReactNode } from 'react';
import { LookupField, renderLookupField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';

export const lookupRenderers: FieldRendererSlots<ReactNode> = {
    renderMultipleLookupValuesField: (props) =>
        renderLookupField(props, { className: 'lookup-answer' }),
};
// With an accepted Lookup Form binding:
// <LookupField binding={lookupBinding} className="lookup-answer" />
```

Pass these renderers to existing `AirtableForm`, `AirtableGrid` or `AirtableList`
hosts. Default bound output follows owner visibility and retirement. Existing
Form visibility requires explicit `hideFieldIfEmpty: false` for Lookup; other
settings remain `blocked/unsupported-hide-empty`, including an empty array. The
component does not override this refusal. The optional `render` prop retains the
existing application-owned custom-render contract.

Formatting uses the existing native Lookup converter and admitted result
metadata. Scalar result metadata formats each occurrence; array-valued result
metadata consumes the whole already-flat native array. Order and duplicates are
preserved. The canonical display removes null occurrences; it never changes the
underlying array. Null, missing and `[]` display blank while remaining distinct
owner-held data. Native top-level errors remain plain text, including with an
admitted `isValid: false, result: null` configuration. Other values with that
invalid-result metadata display blank. Malformed/unsupported metadata or values
display `Unavailable`, including scalar Lookup values, sparse/nested arrays and
`{ linkedRecordId, value }` wrappers. `manualSort` result admission and nested
computed combinations follow existing contracts; no new flattening is added.

Linked record IDs matching the existing native formatter's ID contract become
`Unavailable` when unresolved; other accepted strings retain their supplied
labels. Source link IDs, foreign field IDs, target table IDs and Portal field IDs
are not interchangeable and confer no hydration, collection-read, child-create,
cell-write or row-navigation authority. A Lookup-backed Portal collection remains
owned by its existing collection API, independently of this text renderer.

Markup, attachment and Button URLs remain escaped selectable text: no anchors,
images, navigation or resource loading. Masking from either display or write
configuration replaces the native value, including native errors and supplied
URLs, before admission or formatting. Owner error/validation feedback remains a
separate plain-text status using the existing error-before-validation policy.
Labels, hidden titles, pending/invalid state and contained row interaction follow
the existing controls. `className` decorates `mx-sdk-lookup-field`; no CSS import,
package subpath, editor, Clear, Save or lookup action is added. Core and `/ui`
remain React-free.

## React Barcode presentation

### Canonical editor and compatible binding presentation

`BarcodeField` from `@miniextensions/sdk/react` accepts an explicit controlled
contract for the complete native-compatible editor. Import its scoped CSS:

```tsx
import { useState } from 'react';
import { BarcodeField } from '@miniextensions/sdk/react';
import type { AirtableBarcodeValue } from '@miniextensions/sdk';
import '@miniextensions/sdk/react/barcode.css';

export function BarcodeAnswer() {
    const [value, setValue] = useState<AirtableBarcodeValue | null>(null);
    return (
        <BarcodeField
            mode="controlled"
            value={value}
            onChange={setValue}
            language="en"
            title="Barcode"
            id="barcode"
            form="answers"
            clearLabel="Clear barcode"
            initialMobile={false}
        />
    );
}
```

Controlled edits, Clear and accepted scans replace only `text`; current `type`
and enumerable metadata are retained. Null/type-only values display blank.
`displayOnly` selects the native read-only text/empty presentation. `readOnly`
disables editing and scanning. The scanner is offered by default but does not
allocate a camera until opened; explicit `autoStartCamera` retains the existing
scanner policy. The component creates no client, provider operation or Save.

`enableInlineEdit` reuses the native deferred-input lifecycle: typing remains a
draft until blur or non-composing Enter. A dirty genuine unmount settles once
against its current owner. Hosts can supply `owner: {token, isCurrent}`; replace
`token` on actual owner/configuration replacement and deny stale authority in
`isCurrent`. Committed owner/configuration A/B/A transitions retire old input
and scanner work; ordinary value echoes and callback refreshes keep focused
drafts. DOM IDs and form association never grant write authority.

Existing `<BarcodeField binding={...}>` calls and `renderBarcodeField` remain
display-only, including visibility, masking and retirement behavior. The explicit
`BindingBarcodeField`/`BindingBarcodeFieldProps` exports name that compatibility
contract. `ControlledBarcodeFieldProps` names the controlled branch;
`BarcodeFieldProps` retains its original binding-props meaning for existing
consumer wrappers. The component itself accepts the discriminated union.

The optional `/react` entry exports `BarcodeField`, `BarcodeFieldProps`,
`BarcodeFieldOptions` and `renderBarcodeField`. Install the renderer in the existing
physical `renderBarcodeField` slot for `AirtableForm`, `AirtableGrid` or `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { BarcodeField, renderBarcodeField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';

export const barcodeRenderers: FieldRendererSlots<ReactNode> = {
    renderBarcodeField: (props) =>
        renderBarcodeField(props, { className: 'barcode-answer' }),
};
// With an accepted Barcode Form binding:
// <BarcodeField binding={barcodeBinding} className="barcode-answer" />
```

The native value remains `{ text?: string; type?: string }`, null or missing in
the owner. Only the supplied `text` is shown, preserving whitespace, leading zeros,
Unicode and line breaks. The `type` is neither displayed nor inferred. Visible
null, missing, empty objects and type-only objects display blank. Malformed values
display `Unavailable` with invalid status. The component does not normalize,
replace or write native answers, even when the Form supplies an editable capability.

Default bound output follows owner visibility and retirement before reading the
answer. The existing edit-Form `hideFieldIfEmpty` policy remains authoritative:
when enabled, null/missing and blank text are hidden, while objects without a text
property are blocked. Create Forms remain visible under this policy. Use explicit
`hideFieldIfEmpty: false` when those optional-text objects should remain visible in
edit Forms. The application-owned `render` override keeps the existing
custom-render precedence and is responsible for its own presentation policy.

Either `obscurePassword` or `maskPasswordOnLoginScreen` in display or write
configuration replaces the native answer with a fixed mask before reading its
value, text or type. Owner error and validation feedback remains separate escaped
text, with error taking precedence (including an empty error). Labels, hidden-title
accessible names, pending/invalid state and feedback associations follow the
existing controls. Click, auxiliary click, double click, pointer-down and keyboard
events are contained without preventing native text selection or copy.

This slice provides read-only display coverage, not editable Barcode parity.
URLs and markup are plain text; there is no scanner/camera, generated barcode image,
link, navigation, normalization, editing, Clear or Save action. `className` decorates
`mx-sdk-barcode-field`; no CSS import or package subpath is added. Core and `/ui`
remain React-free.

`test/reactBarcode.test.ts` covers the source component, and `check:package` runs
the installed ESM/CommonJS and public-type checks. To prepare a synthetic browser
fixture from the tested archive, run
`node scripts/build-barcode-browser-proof.mjs /path/to/tested.tgz /path/to/output`.
It installs offline using an already seeded npm cache (`SDK_BARCODE_NPM_CACHE`
can select that cache), verifies installed bundle inputs, and records archive and
source hashes. Serve the output on loopback and use the browser to inspect the
Form/Grid/List displays and run the page's interaction, remount and retirement
checks. Fixture generation records browser verification as pending; injected DOM
checks do not replace native pointer, keyboard, text-selection or layout inspection.

## React Single Collaborator controlled field

`SingleCollaboratorField` from `@miniextensions/sdk/react` accepts the complete
picker contract with `mode="controlled"`. It owns search, choice rows,
badges, avatar DOM, keyboard/pointer interaction and focus; the caller retains
canonical object/null values and current write authority. No renderer injection,
SDK client or implicit Save is required.

```tsx
import {
    SingleCollaboratorField,
    type ControlledSingleCollaboratorFieldProps,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-collaborators.css';

export function AssigneeField(
    props: Omit<ControlledSingleCollaboratorFieldProps, 'mode'>
) {
    return (
        <SingleCollaboratorField
            {...props}
            mode="controlled"
            title="Assignee"
            inputId="assignee"
            formId="record-form"
            describedBy="assignee-help assignee-error"
        />
    );
}
```

`ControlledSingleCollaboratorFieldProps<T>` preserves extra native object
metadata and exact supplied references. See [Complete Collaborator fields](complete-collaborators.md)
for choice, owner, avatar, localization and readonly contracts. The existing
`CompleteSingleCollaboratorField` remains compatible. Calls using `binding`
(with no `mode`) and the original named `SingleCollaboratorFieldProps`, options
and render helper retain their display-only behavior; the explicit
`BindingSingleCollaboratorField` export is equivalent to those binding calls.
Controlled calls cannot supply `binding` or `render`.

## React Single Collaborator presentation

The optional `/react` entry exports `SingleCollaboratorField`,
`SingleCollaboratorFieldProps`, `SingleCollaboratorFieldOptions` and
`renderSingleCollaboratorField`. Install the renderer in the existing physical
`renderSingleCollaboratorField` slot for `AirtableForm`, `AirtableGrid` or
`AirtableList`:

```tsx
import type { ReactNode } from 'react';
import {
    SingleCollaboratorField,
    renderSingleCollaboratorField,
} from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';

export const collaboratorRenderers: FieldRendererSlots<ReactNode> = {
    renderSingleCollaboratorField: (props) =>
        renderSingleCollaboratorField(props, {
            className: 'collaborator-answer',
        }),
};
// With an accepted Single Collaborator Form binding:
// <SingleCollaboratorField binding={collaboratorBinding} />
```

The owner retains its native `{ id: string; email: string; name: string;
profilePicUrl?: string }` value, null or missing. Only the supplied `name` appears,
preserving whitespace, Unicode and line breaks. An empty name, null or missing
value displays blank. Malformed values display `Unavailable` with invalid status.
There is no fallback to email, ID, field choices or another source. The existing
native validator accepts additional object properties; this presentation preserves
them without displaying them or adding a stricter native model.

Default bound output follows hidden, blocked and retired owner state before
reading schema or answer. The existing edit-Form `hideFieldIfEmpty` policy still
refuses Single Collaborator fields, including null answers. Set it explicitly to
`false` when displaying a collaborator in an edit Form. Create Forms remain visible
under that policy. The application-owned `render` override keeps existing custom
render precedence and is responsible for its own presentation policy.

Either `obscurePassword` or `maskPasswordOnLoginScreen` in display or write
configuration replaces the answer with a fixed mask before the renderer reads the
value reference or any native property. This guarantee starts at the renderer or
bound snapshot boundary; existing owners still validate and clone accepted native
values. Error and validation feedback remains separate escaped text, with error
taking precedence, including an empty error. Labels, hidden-title accessible names,
pending/invalid state and feedback associations follow the existing controls.
Click, auxiliary click, double click, pointer-down and keyboard events are contained
without preventing native text selection or copy.

This is read-only display coverage. It does not request avatars, resolve identities,
create links, normalize answers, provide a picker, edit values or use write actions,
even if the Form supplies an editable capability. Multiple Collaborators remains a
separate slot. `className` decorates `mx-sdk-single-collaborator-field`; no CSS import
or package subpath is added. Core and `/ui` remain React-free.

`test/reactSingleCollaborator.test.ts` covers the source component, and
`check:package` runs installed ESM/CommonJS runtime and public-type checks. A
synthetic browser fixture can be built from the tested archive with
`node scripts/build-single-collaborator-browser-proof.mjs /path/to/tested.tgz /path/to/output`.
It installs offline using an already seeded npm cache
(`SDK_SINGLE_COLLABORATOR_NPM_CACHE` can select that cache), records archive and
source hashes, and verifies installed bundle inputs. Serve the output on loopback
to inspect the Form/Grid/List displays and run its interaction, remount and
retirement checks. Fixture generation leaves browser verification pending; native
browser interaction and layout inspection are separate from its injected DOM checks.

## React Multiple Collaborators presentation

For a complete searchable picker, import `MultipleCollaboratorsField` with
`mode="controlled"`, authoritative `choices`, ordered native `value`, current
`owner` and `onValueChange`. `ControlledMultipleCollaboratorsFieldProps<T>`
preserves the caller's native object subtype. Import
`@miniextensions/sdk/react/complete-collaborators.css` for the complete UI.
See [Complete Collaborator fields](complete-collaborators.md) for the controlled
contract, ownership, images and accessible associations.

The existing binding contract below remains display-only. It is also explicitly
exported as `BindingMultipleCollaboratorsField` and
`BindingMultipleCollaboratorsFieldProps`. The original named
`MultipleCollaboratorsFieldProps`, unchanged binding JSX and custom `render`
contextual typing remain compatible. `CompleteMultipleCollaboratorsField`
continues to provide the complete picker without the controlled discriminator.

The optional `/react` entry exports `MultipleCollaboratorsField`,
`MultipleCollaboratorsFieldProps`, `MultipleCollaboratorsFieldOptions` and
`renderMultipleCollaboratorsField`. Install the renderer in the existing physical
`renderMultipleCollaboratorsField` slot for `AirtableForm`, `AirtableGrid` or
`AirtableList`:

```tsx
import type { ReactNode } from 'react';
import {
    MultipleCollaboratorsField,
    renderMultipleCollaboratorsField,
} from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';

export const collaboratorsRenderers: FieldRendererSlots<ReactNode> = {
    renderMultipleCollaboratorsField: (props) =>
        renderMultipleCollaboratorsField(props, {
            className: 'collaborators-answer',
        }),
};
// With an accepted Multiple Collaborators Form binding:
// <MultipleCollaboratorsField binding={collaboratorsBinding} />
```

The native read value remains `readonly { id: string; email: string; name: string;
profilePicUrl?: string }[] | null | undefined`. The owner retains the array and
objects; this presentation joins only the supplied names with `, `, preserving
order, repeated IDs and names, blank names, whitespace, Unicode and line breaks.
For example, names `['Ada', '', 'Ada']` display `Ada, , Ada`. An empty array, null
or missing value displays blank. The existing native validator accepts additional
object properties; they are preserved without being displayed or adding a stricter
native model. There is no fallback to email, ID, field choices or another source.
Malformed direct values display `Unavailable` with invalid status for the whole
array, without partial names or coercion. Existing owner validation remains in
place before dispatch.

Default bound output follows hidden, blocked and retired owner state before
reading schema or answer. The existing edit-Form `hideFieldIfEmpty` policy still
refuses Multiple Collaborators fields, including null and empty arrays. Set it
explicitly to `false` when displaying collaborators in an edit Form. Create Forms
remain visible under that policy. The application-owned `render` override keeps
existing custom-render precedence and is responsible for its own presentation
policy.

Either `obscurePassword` or `maskPasswordOnLoginScreen` in display or write
configuration replaces the answer with a fixed mask before the renderer reads the
value reference, array length, entries or native properties. This guarantee starts
at the renderer or bound snapshot boundary; existing owners still validate and
clone accepted native values. Error and validation feedback remains separate
escaped text, with error taking precedence, including an empty error. Each output
has a unique associated label or hidden-title accessible name, pending/invalid
state and a feedback association when feedback is present. Feedback uses a polite
status region. Click, auxiliary click, double click, pointer-down, key-down and
key-up events are contained without cancelling native defaults for text selection
or copy.

This renderer provides read-only display coverage while the existing headless
slot's editable capability remains unchanged. It does not use write actions,
request avatars, resolve identities, create links, normalize or deduplicate
answers, calculate a count, provide a picker or edit values. URLs and markup in
names remain plain text. `className` decorates
`mx-sdk-multiple-collaborators-field`; no CSS import or package subpath is added.
Single Collaborator retains its separate slot. Core and `/ui` remain React-free.

`test/reactMultipleCollaborators.test.ts` covers the source component, and
`check:package` runs installed ESM/CommonJS runtime and public-type checks. A
synthetic browser fixture can be built from the tested archive with
`node scripts/build-multiple-collaborators-browser-proof.mjs /path/to/tested.tgz /path/to/output`.
It installs offline using an already seeded npm cache
(`SDK_MULTIPLE_COLLABORATORS_NPM_CACHE` can select that cache), records archive and
source hashes, and verifies installed bundle inputs. Serve the output on loopback
to inspect the Form/Grid/List displays and run its interaction, owner replacement,
remount and retirement checks. Fixture generation leaves browser verification
pending; native browser interaction and layout inspection are separate from its
injected DOM checks. This synthetic fixture does not establish live-backend,
screen-reader or clipboard behavior.

## React Rich Text presentation

The optional `/react` entry exports `RichTextField`, `RichTextFieldProps`,
`RichTextFieldOptions` and `renderRichTextField`. Install the renderer in the
existing physical `renderRichTextField` slot for `AirtableForm`, `AirtableGrid` or
`AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { RichTextField, renderRichTextField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';

export const richTextRenderers: FieldRendererSlots<ReactNode> = {
    renderRichTextField: (props) =>
        renderRichTextField(props, { className: 'rich-text-answer' }),
};
// With an accepted Rich Text Form binding:
// <RichTextField binding={richTextBinding} className="rich-text-answer" />
```

With binding props or the physical renderer, the owner retains the native
`string | null | undefined` value. Supplied Markdown,
HTML and URLs appear literally as escaped text: `**Hello**` displays `**Hello**`,
and `[label](https://example.invalid)` remains that string. Whitespace, Unicode,
line breaks and original line endings, including CRLF, remain unchanged. The
output wraps long lines without rewriting the value. Visible null, missing and
empty strings display blank; whitespace-only strings retain their whitespace.
Malformed direct values display `Unavailable` with invalid status, without
coercion. Existing owner validation remains in place before dispatch.

Default bound output follows hidden, blocked and retired owner state before
reading schema or answer. Rich Text retains the existing ordinary-scalar
edit-Form `hideFieldIfEmpty` policy: null, missing, empty and whitespace-only
strings are hidden when the owner applies that policy. Nonblank Markdown such as
`** **` remains populated; the renderer does not strip formatting to redefine
emptiness. Create Forms remain visible under that policy. Section and conditional
visibility remain owned by the existing Form implementation. The application-owned
`render` override keeps existing custom-render precedence and is responsible for
its own presentation policy.

Either `obscurePassword` or `maskPasswordOnLoginScreen` in display or write
configuration replaces the answer with a fixed mask before the renderer reads the
native value reference, including malformed values. This guarantee starts at the
renderer or bound snapshot boundary; existing owners still validate accepted
native values. Error and validation feedback remains separate escaped text, with
error taking precedence, including an empty error. Each output has a unique
associated label or hidden-title accessible name, pending/invalid state and a
feedback association when feedback is present. Feedback uses a polite status
region. Click, auxiliary click, double click, pointer-down, key-down and key-up
events are contained without cancelling native defaults for text selection or
copy.

Binding and slot rendering provide literal display. They do not run a Markdown parser, formatting removal, HTML interpretation, resource
loading, link creation, navigation, normalization or editing. The renderer does not
use write or save actions even when the existing headless slot supplies an
editable capability. Plain Multiline Text retains its separate slot and editor.
`RichTextFieldOptions` contains only optional `className`, which decorates
`mx-sdk-rich-text-field`; literal display needs no CSS import. Core and `/ui`
remain React-free.

For the complete editor, supply controlled `value: string | null` and
`onValueChange(value: string)` props to the same public `RichTextField`. Import
`@miniextensions/sdk/react/rich-text.css` for the owned toolbar, formatted Markdown,
checkbox node views and paste behavior. Use `ControlledRichTextFieldProps` for
this contract; `RichTextFieldProps` retains its historical binding shape, with
`BindingRichTextFieldProps` available explicitly. Overloads reject combining
binding/render props with controlled props. The host supplies canonical state,
current document `identity` and the writer. See the [complete Rich Text guide](complete-rich-text.md)
for readonly, empty presentation, accessibility, theme and compatibility details.

`test/reactRichText.test.ts` covers the source component, and `check:package` runs
the installed ESM/CommonJS public-export runtime and declaration checks, including
JSX. Build a synthetic browser fixture from the tested archive with:

```sh
node scripts/build-rich-text-browser-proof.mjs /path/to/tested.tgz /path/to/output --public-export
```

The explicit `--public-export` mode consumes the renderer through
`@miniextensions/sdk/react`. The alternative
`--direct-module=/absolute/path/to/dist/esm/react/RichTextField.js` mode verifies
the matching installed archive module directly and does not qualify the public
export. Both modes install offline using an already seeded npm cache
(`SDK_RICH_TEXT_NPM_CACHE` can select that cache), record archive and source hashes,
and verify installed bundle inputs. Serve the output on loopback to inspect the
Form/Grid/List displays and run its interaction, owner replacement, remount and
retirement checks. Fixture generation leaves browser verification pending; native
browser interaction and layout inspection are separate from its injected DOM
checks. This synthetic fixture does not establish live-backend, screen-reader or
clipboard behavior.

## React AI Text presentation

The optional `/react` entry exports `AiTextField`, `AiTextFieldProps`,
`BindingAiTextFieldProps`, `ControlledAiTextFieldProps`, `AiTextFieldOptions` and
`renderAiTextField`. Register the helper in the existing
physical `renderAiTextField` slot for `AirtableForm`, `AirtableGrid` or `AirtableList`:

```tsx
import type { ReactNode } from 'react';
import { AiTextField, renderAiTextField } from '@miniextensions/sdk/react';
import type { FieldRendererSlots } from '@miniextensions/sdk/ui';

export const aiTextRenderers: FieldRendererSlots<ReactNode> = {
    renderAiTextField: (props) =>
        renderAiTextField(props, { className: 'ai-text-answer' }),
};
// With an accepted AI Text Form binding:
// <AiTextField binding={aiTextBinding} className="ai-text-answer" />
```

The runtime value is a native object with `state` (`empty`, `loading`, `generated`
or `error`), string `value`, required boolean `isStale`, and optional string
`errorType`. The owner retains that object. The helper displays only the supplied
`value` in every state and for either stale flag; it does not infer generation
progress, replace text with a status message, or inspect prompts or references.
The older formula-side type with optional `isStale` does not broaden this runtime
contract. Null or missing native values and empty strings display blank. Whitespace, Unicode and
original line endings are preserved, and long lines wrap without rewriting data.
HTML, Markdown and URLs remain escaped literal text. Malformed direct values,
including non-string states and missing `isStale`, display `Unavailable` with
invalid status, without coercion. Existing host admission remains authoritative.

AI Text remains computed and read-only. Default bound output checks retirement
and visibility before reading schema or value, and supports only matching AI Text
physical kinds. Hidden, blocked and retired owners render no default output.
Existing owner emptiness and conditional-visibility rules remain unchanged; this
component adds no state-based visibility rule. The application-owned `render`
override retains existing precedence and owns its presentation policy.

Either password-masking flag in display or write configuration replaces the
answer with a fixed mask before reading its native reference or properties. This
guarantee begins at the renderer or accepted snapshot boundary. Owner `pending`,
`error` and validation supply accessible busy/invalid state and escaped feedback;
native `loading`, `error`, `isStale` and `errorType` do not replace those semantics.
Each output has a unique associated label or a hidden-title accessible name.
Feedback uses a polite status region. Click, auxiliary-click, double-click,
pointer-down, key-down and key-up events are contained without cancelling native text
selection defaults.

The binding renderer provides supplied-value display coverage. It adds no generation,
retry, parser, links, resource loading, normalization, hydration, editing or save
action. Even forged editable capabilities remain unused. `AiTextFieldOptions`
contains only optional `className`, decorating `mx-sdk-ai-text-field`; there is no
new stylesheet or package subpath. Core and `/ui` remain React-free.

Native hosts can instead supply their already-converted text through the explicit
controlled mode. Host admission, AI-object conversion and admin-only refusal stay
at the host boundary; this mode accepts no binding, render override or generation
action. `AiTextFieldProps` retains its historical binding shape, also named
`BindingAiTextFieldProps`.

```tsx
import { AiTextField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-readonly-text.css';

const convertedText = 'Host-converted AI text';
<AiTextField
    mode="controlled"
    value={convertedText}
    language="en"
    textSize="small"
/>;
```

Controlled display uses the existing `CompleteReadOnlyTextField`: null, undefined
and empty strings show the localized empty label; whitespace remains supplied
text; HTML stays escaped and URLs become ordinary links. Links contain row click
propagation without cancelling navigation. Optional `textSize`, `layout` and
`className` pass through. This mode has no write, save, generation or retry
authority. It does not broaden the binding renderer's stricter object contract or
its literal-link behavior.

`test/reactAiText.test.ts` covers source behavior. The normal package check runs
installed ESM/CommonJS runtime cases (134 legacy groups plus six controlled
display and SSR/hydration groups) and public JSX/Node declaration checks. The
normal native-browser check exercises controlled ESM/CommonJS rendering from the
installed archive, including keyboard link navigation, replacement, localized
emptiness and adjacent draft retention under React 18 and 19. The
separate `scripts/build-ai-text-browser-proof.mjs` fixture uses an installed tested
archive for synthetic Form/Grid/List, visibility and lifecycle evidence. Its
injected DOM checks and native browser inspection do not establish live-backend,
generation, clipboard or screen-reader behavior.

To build that fixture, supply a consumer already installed from the tested local
archive and a fresh output directory:

```sh
node scripts/build-ai-text-browser-proof.mjs /path/to/installed-consumer /path/to/tested.tgz /path/to/fresh-output
```

The builder verifies archive integrity and installed bundle inputs, records source
identities, and writes only the fresh output directory. It does not install
dependencies, start a server or perform browser verification. Serve the output
locally to inspect the displays and run the visible lifecycle controls.

## React Multiple Attachments adapter

The optional `/react` entry exports `MultipleAttachmentsField`,
`MultipleAttachmentsFieldProps`, `MultipleAttachmentsFieldOptions` and
`renderMultipleAttachmentsField`. The component accepts `{ field, className? }`,
where `field` is an accepted `FieldRendererProps<'multipleAttachments'>` snapshot.
The helper installs the same component in the existing physical slot:

```tsx
import type { ReactNode } from 'react';
import {
    MultipleAttachmentsField,
    renderMultipleAttachmentsField,
} from '@miniextensions/sdk/react';
import type {
    FieldRendererProps,
    FieldRendererSlots,
} from '@miniextensions/sdk/ui';

export const attachmentRenderers: FieldRendererSlots<ReactNode> = {
    renderMultipleAttachmentsField: (field) =>
        renderMultipleAttachmentsField(field, { className: 'attachments' }),
};

export function AttachmentSlot({
    field,
}: {
    field: FieldRendererProps<'multipleAttachments'>;
}) {
    return <MultipleAttachmentsField field={field} />;
}
```

Editable Form hosts need the existing attachment recovery/controller capability.
The adapter borrows only its privacy-filtered snapshot and guarded `select`,
`clear`, `remove`, `upload` and `cancel` actions. It never reads the native `value`,
uses `setValue`, constructs a controller, or owns another file queue. Keep the
Form owner, its attachment controller and recovery journal outside React mounts.
The existing binding-based `AttachmentField` remains available unchanged.

Filtered row labels appear as escaped, selectable text in their supplied order,
including duplicates and whitespace. Removal uses the supplied native index and
the host's captured values revision. Accessible names use visible row positions;
hidden native indexes never appear in DOM attributes. Open/download flags do not
create links, images, previews, downloads or additional authority.

Choose files only selects into the existing queue. An empty picker completion
or picker cancel leaves that queue intact. Upload next file invokes one guarded
upload for the first pending file; every later upload requires another explicit
action. Accepted uploads enter the existing draft, and the owner still performs
Save separately. Clear removes pending selections without cancelling a flight;
Cancel invokes the existing upload cancellation and uncertainty safeguards.
Queue replacement during a flight remains available. Uncertain outcomes never
cause automatic append or retry. Pending File names and other metadata are not
read by this component; only its pending queue count is shown.

Read-only Form and all Portal attachment slots remain **unsupported by this
editable adapter**. Use the separate read-only label helper below for an approved
Form or Portal-detail facet. These slots, editable slots with missing guarded actions, and malformed
facets display only `Attachment presentation unavailable`, with no chooser,
actions, attachment count, filename or URL. The adapter never inspects raw values
to improve that fallback. This slice does not establish read-only display parity.
Masking in either display or write configuration is checked before facet access
and produces a fixed `••••••••` with no attachment activity or metadata.

A valid editable facet can separately report unavailable row presentation while
still retaining pending activity. In that case rows remain uninspected and
Choose/Upload are disabled; queued Clear and busy Cancel remain available through
their existing guards. An idle unavailable facet has the generic inert fallback.
Error and validation diagnostics use generic text rather than exposing raw
messages that may contain hidden attachment metadata.

Unmount releases only React state. Old callbacks reject after props/owner
replacement or unmount, and late promises do not update a successor's feedback
or focus. Retiring a renderer host alone does not dispose its independent Form
attachment controller: an already-dispatched operation can still finish for a
live owner. Actual owner/session/configuration retirement remains governed by
the existing controller and recovery model. Hidden/blocked/retired renderer
hosts omit the slot; this adapter does not add hidden-field recovery navigation.

Controls have accessible names, visible native focus and polite activity status.
Click, pointer and keyboard events stay inside the field. Native button keyboard
activation is retained; Enter outside an action control cannot implicitly submit
the surrounding Form. `className` decorates `mx-sdk-multiple-attachments-field`;
there is no new stylesheet, theme API, Uppy integration or backend flow.

After qualifying an installed package, build the local synthetic browser fixture:

```sh
node scripts/build-multiple-attachments-browser-proof.mjs /path/to/installed-consumer /path/to/tested.tgz /path/to/fresh-output
```

The builder neither installs dependencies nor starts a server. It verifies the
installed archive identity and consumed SDK module bytes, and records source and
bundle hashes. Serve the generated output on loopback for explicit interactions.
Fixture generation and injected DOM events do not establish native browser
behavior; execute the browser proof separately. All fixture uploads and Saves
are synthetic and establish no live-backend, clipboard or screen-reader result.

### Read-only attachment labels

Accepted Form fields and Portal detail fields can expose the optional
`attachmentPresentation` on `FieldRendererProps<'multipleAttachments'>`:

```ts
import type { AttachmentPresentation } from '@miniextensions/sdk/ui';

const presentation: AttachmentPresentation = {
    status: 'ready',
    rows: [{ label: 'Attachment' }],
};
```

The other states are `{ status: 'masked' }` and `{ status: 'unavailable' }`,
without rows or counts. Render labels as literal text, never HTML. Visible order
and duplicates are preserved. The facet contains no URLs, IDs, native indexes,
Files, hidden counts, or actions. Missing safe configuration or malformed policy
rows fail closed. Either `obscurePassword` or `maskPasswordOnLoginScreen`
conceals the whole facet before its new lazy policy read. Filenames require
`hideAttachmentName === false`; otherwise visible rows use `Attachment`.

The facet itself is read-only and can coexist with unchanged editable Form
capabilities. Form uses the original loaded descriptor and existing persisted add-only
baseline semantics. It does not manufacture a read-only descriptor for policy
evaluation. Portal uses returned detail policy; an accepted child configuration
can further restrict names or mask presentation, but cannot loosen returned
policy. Every applicable configuration must explicitly permit filenames. Portal
add-only policies return unavailable because that surface supplies no safe
persisted baseline. Missing configuration is unavailable, not an empty list.
The final Form publication fence compares the revision used to compute cached
visibility with the committed draft revision after the last ownership callback.
This internal scalar read does not invoke ownership callbacks or clone native
values, and does not depend on nested notifications being delivered. Notification
counters alone are insufficient because the controller queues nested emissions. A concurrent Form change makes only the new facet unavailable for that
read; a subsequent stable read can publish labels again. Reentrant host reads also
withhold this facet while an outer read is active.
Hosts recheck owner and configuration before publishing; observed retirement
stays retired, including an observed change back to an earlier configuration.
Callers must advance the configuration revision for replacements, including ABA.

This is an additive display contract. It creates no controller, recovery
resource, hydration, transport, or write. Existing native `FieldValueMap`, values,
attachment actions, editable behavior, and native cloning/fingerprinting remain
unchanged. Those existing native paths still access native data: the new lazy
projection boundary is not a universal raw-value nonaccess or security boundary.
Linked-detail and Portal inline expansion/cells do not receive this facet.
The separate editable React adapter is unchanged; the read-only helper below
consumes this label-only facet without borrowing its editable capabilities.

## React read-only attachment presentation

The optional `/react` entry exports `ReadonlyAttachmentsField`,
`ReadonlyAttachmentsFieldProps`, `ReadonlyAttachmentsFieldOptions` and
`renderReadonlyAttachmentsField`. The component accepts an accepted
`FieldRendererProps<'multipleAttachments'>` snapshot through `field`; the helper
registers under the existing physical attachment slot:

```tsx
import type { ReactNode } from 'react';
import {
    ReadonlyAttachmentsField,
    renderReadonlyAttachmentsField,
} from '@miniextensions/sdk/react';
import type {
    FieldRendererProps,
    FieldRendererSlots,
} from '@miniextensions/sdk/ui';

export const readonlyAttachmentRenderers: FieldRendererSlots<ReactNode> = {
    renderMultipleAttachmentsField: (field) =>
        renderReadonlyAttachmentsField(field, {
            className: 'attachment-labels',
        }),
};

export function AttachmentLabels({
    field,
}: {
    field: FieldRendererProps<'multipleAttachments'>;
}) {
    return <ReadonlyAttachmentsField field={field} />;
}
```

Only physical, noncomputed attachment fields in accepted Form and Portal-detail
contexts are supported. The helper consumes `attachmentPresentation` exclusively.
Read-only Grid/List nodes backed by accepted detail props also use the
`portal-detail` context and can display these labels. Actual `portal-cell` or
inline binding contexts remain unsupported.
It does not read `value`, capability/actions, pending Files, raw error/validation
messages, URLs, IDs or native indexes. No policy controller, queue, hydration,
transport, write or save action is created. The facet can coexist with editable
Form capabilities; choosing this helper still produces only read-only labels.
Keep `renderMultipleAttachmentsField` for the existing explicit editable UI.

Ready labels render as escaped, selectable list text in their supplied order,
including duplicates, empty labels, whitespace and line breaks. HTML and URL
strings remain literal text, without links, images, previews or downloads. Empty
ready rows display `No attachments`. Masked and unavailable states have no list,
row count or controls, and display only a fixed mask or
`Attachment presentation unavailable`. Missing facets, unsupported linked-detail
and Portal-cell/inline contexts, malformed policy flags and malformed facet shapes
also fail closed. The whole facet is validated before any labels are rendered.
Either masking flag in display or write configuration conceals before facet access;
malformed masking flags also conceal. Valid read-only and add-only configurations
do not override the host's supplied safe facet.

Use the existing `FieldRenderer`, Form or Portal composition to subscribe to
accepted host snapshots. Those hosts own conditional visibility, configuration
revisions and retirement fences, including queued-notification and ABA protection.
This component keeps no label cache and does not adapt a raw `FormFieldSnapshot`:
bindings do not expose the label facet. Hidden, blocked and retired host snapshots
remain omitted by the existing composition. Custom renderer dispatch keeps its
existing precedence. The renderer's no-native-read guarantee begins at the accepted
facet boundary; existing headless cloning and fingerprinting still access native
values as documented above.

Visible titles name the list through a unique association; a hidden title supplies
an accessible name. Click, auxiliary-click, double-click, pointer-down/up and key
events stay inside the field without cancelling text selection. Enter cannot
implicitly submit a surrounding Form. `className` decorates
`mx-sdk-readonly-attachments-field`; there is no new stylesheet or package subpath.

Source tests cover direct snapshots and real subscription/lifecycle paths. The
normal package check exercises public installed ESM/CommonJS exports and strict
MTS/CTS/JSX consumers. Build the synthetic installed-package browser fixture with:

```sh
node scripts/build-readonly-attachments-browser-proof.mjs /path/to/installed-consumer /path/to/tested.tgz /path/to/fresh-output
```

The builder verifies the archive and consumed SDK module bytes, records source and
bundle hashes, and writes only its fresh output directory. It does not install
dependencies, start a server or claim browser verification. Serve the fixture on
loopback for separate native interaction and layout checks. Synthetic controls
change only fixture-owned data and establish no live-backend, clipboard or
screen-reader result.

## Stateless native text input

`TextInput` from `@miniextensions/sdk/react` is a native input with a forwarded
`HTMLInputElement` ref and ordinary native input props. It renders only the
input: callers retain their labels, form ownership, descriptions, classes,
events, disabled policy and clear-button layout. Supply a string `value` for
controlled text, or omit `value` and optionally supply string `defaultValue`
for an existing native/ref-managed owner such as a combobox. Choose one mode
for the input lifetime; the type rejects supplying both. Uncontrolled rerenders
leave native edits and ref-managed selection intact, and native form reset
retains its normal behavior. There is no internal draft, parser, subscription,
save or implicit request. Native events bubble normally unless the caller stops
them.

Use `type="text"` and `inputMode="decimal"` for locale-aware numeric display
text. Partial values such as `-` or `1,` remain unchanged; the existing owner
converts them to native numbers at its established commit boundary. Email,
password, URL and phone entry can retain their native input types. The bound SDK
text and number renderers use this same input while keeping their existing
owner/composition policies. This primitive does not add scanner, address lookup,
formatting or deferred-commit behavior.

```tsx
import { useRef, useState } from 'react';
import { TextInput } from '@miniextensions/sdk/react';

export function HostedAmount() {
    const input = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState('1,');
    return (
        <TextInput
            ref={input}
            id="amount"
            form="request"
            type="text"
            inputMode="decimal"
            value={draft}
            aria-label="Amount"
            onChange={(event) => setDraft(event.currentTarget.value)}
        />
    );
}
```

## Shared input clear button

`InputClearButton` from `@miniextensions/sdk/react` renders one native button and
an inert clear indicator. Supply its localized `label`, native button props and
an optional `HTMLButtonElement` ref. `indicatorClassName` and `iconClassName`
customize its presentation alongside the native button `className`. The button
always uses `type="button"`, so native activation cannot implicitly submit the
surrounding form. It forwards events without adding focus, draft or save effects.

The owner decides when to display it, whether clearing is currently allowed,
and what `onClick` does. Pass `disabled` when the input is disabled or read-only.
SDK bound Text controls keep their existing composition, readonly and focus
behavior while borrowing this presentation. Hosted immediate/deferred editors
can share it without moving their commit ownership into the button.

## Native textarea and opt-in autosizing

`TextareaInput` from `@miniextensions/sdk/react` accepts a controlled string
`value`, native textarea props and the actual `HTMLTextAreaElement` ref. It adds
no wrapper, draft state, parsing, truncation, persistence or transport. Callers
retain labels, form/ARIA associations, classes, character counters, caret policy
and native composition/change/focus handlers. Native events bubble normally.

Sizing is opt-in: `autoSize={{ minRows: 3, maxRows: 30 }}` measures content and
placeholder text, clamps the height and permits scrolling beyond the maximum.
It matches the native `wrap` setting and computed `white-space`,
`overflow-wrap` and `word-break` styles, including horizontal scrolling for
unwrapped text. It remeasures after committed renders, window resize and font
loading. Row
bounds must be positive integers with `maxRows >= minRows` (an omitted maximum
is unbounded). Use these bounds instead of inline `minHeight`/`maxHeight`.
Caller CSS still controls width, font, padding, borders and resize affordance.
A manual vertical resize remains until the measured content height changes.
Measurement nodes are removed immediately. Sizing emits no edit or Save.
Disabling sizing preserves the native node/focus/selection and restores an
SDK-owned height, while preserving a height changed by the caller/user.

Without `autoSize`, ordinary native `rows`/style behavior stays unchanged. The
bound `MultilineTextField` and `renderMultilineTextField` use this same control
and accept the optional sizing settings; their default remains four rows.
Their existing composition buffering, policy and accepted owner setter remain
in place. DOM composition tests establish forwarding, not OS IME acceptance.

```tsx
import { useRef, useState } from 'react';
import { TextareaInput } from '@miniextensions/sdk/react';

export function HostedNotes() {
    const ref = useRef<HTMLTextAreaElement>(null);
    const [value, setValue] = useState('');
    return (
        <TextareaInput
            ref={ref}
            value={value}
            autoSize={{ minRows: 3, maxRows: 30 }}
            aria-label="Notes"
            onChange={(event) => setValue(event.currentTarget.value)}
        />
    );
}
```

## Controlled rating presentation

`RatingInput` from `@miniextensions/sdk/react` owns the native range, decorative
icon selection/toggle-clear, focus indication, numeric grid/print summaries and
explicit maximum repair. Its controlled `value` is a native number or `null`;
`onChange` proposes a native value without creating a model, request or Save.
The caller retains record identity, write policy, metadata, styles and persistence.
A loaded value above `max` stays unchanged until an explicit repair.

For an empty value (`null` or native `0`), an unmodified Home or Arrow key proposes the first rating
(`1`); End proposes `max`. The caller accepts the value through its controlled
`value` prop, after which ordinary native range navigation applies.

The input ref is the actual `HTMLInputElement` (or `null` in grid mode). Use
`inputProps` for native form/label/ARIA associations and focus callbacks. `max`,
range type, controlled value and disabled policy are owned by the control.
Decorative `renderIcon` receives `index`, `filled`, `focused`, `disabled` and
`activate`; the native range or surrounding grid owns accessible numeric meaning.
Icon callbacks from replaced props or an unmounted control are retired. This
presentation lifetime check does not replace the caller's write authority.

Classes, an `empty` node, `warningMessage`, `repairLabel` and class slots let an
app retain its theme and localization. `grid` omits the range and supplies a
numeric summary; the caller styles `gridSummaryClassName` for screen readers and
`printSummaryClassName` for print. Disabled controls never propose edits or show
an enabled repair. Native absence is not turned into an owner write by the range's
HTML minimum. The host must retain its native `null`/zero and required policy.

```tsx
import { useState } from 'react';
import { RatingInput } from '@miniextensions/sdk/react';

export function CustomRating() {
    const [value, setValue] = useState<number | null>(2);
    return (
        <RatingInput
            value={value}
            max={5}
            onChange={setValue}
            inputProps={{ 'aria-label': 'Rating' }}
            renderIcon={({ filled, focused, activate }) => (
                <span
                    onClick={activate}
                    aria-hidden="true"
                    className={focused ? 'rating-focus' : undefined}
                >
                    {filled ? '★' : '☆'}
                </span>
            )}
        />
    );
}
```

`RatingField` and `renderRatingField` accept `iconInput` to opt accepted binding
and renderer-host owners into this same control. Their existing numeric editor
remains the default. Accepted read-only/pending/required policy, masking, native
scalar writes and row-event boundaries remain enforced; appearance cannot grant
write authority. Provide Airtable icon assets/colors through `renderIcon` when
that metadata-specific presentation is required. The stock default does not
infer an icon theme or supply hosted Airtable assets.

## Shared literal text display

`LiteralText` from `@miniextensions/sdk/react` supplies the escaped native output
used by SDK Rich Text, AI Text and single-collaborator display controls. Callers
supply already formatted text and retain native value validation, masking and
field policy. It preserves whitespace and wraps long text by default, forwarding
native classes, ARIA, events and the actual `HTMLElement` ref.

Choose `as="output"` (default), `span`, `p` or `div` for an established container.
An explicit `empty` node replaces the entire control for null, undefined or empty
text; string `0` stays visible. Without that option an empty native element stays
mounted. `preserveWhitespace={false}` retains caller styles without adding the
SDK defaults. A `renderText` callback can reuse an existing safe linkifier or
formatting component while the default renders literal text.

```tsx
import { LiteralText } from '@miniextensions/sdk/react';
export const Result = () => (
    <LiteralText value="0" aria-label="Count" empty={<em>No value</em>} />
);
```

### Native actions

`ActionButton` from `@miniextensions/sdk/react` shares native action and pending
presentation with the SDK Button field. It forwards an
actual `HTMLButtonElement` ref and native props, always uses `type="button"`,
and disables activation when `busy` or `disabled`. `busy` also controls
`aria-busy`; optional `busyContent` replaces children while pending. Without
replacement content, the original children remain visible.

```tsx
import { ActionButton } from '@miniextensions/sdk/react';

export function NativeAction({
    pending,
    runAction,
}: {
    pending: boolean;
    runAction(): void;
}) {
    return (
        <ActionButton
            busy={pending}
            busyContent={<span>Running action</span>}
            onClick={runAction}
        >
            Run action
        </ActionButton>
    );
}
```

The caller owns action eligibility, singleflight, authentication, source identity,
requests, errors and retry policy. This presentation does not create a Button
model or acquire webhook authority. URL actions retain their native link owner.

### Complete Calendly widget

`CompleteCalendlyWidget` from `@miniextensions/sdk/react` owns the complete
invalid-URL alert, Booked state, scheduling button and named dismissible dialog.
Its optional scoped stylesheet is
`@miniextensions/sdk/react/complete-calendly.css`. No native renderer, Tailwind
build, app Modal or additional booking store is required.

```tsx
import { CompleteCalendlyWidget } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-calendly.css';

export function Scheduler({
    ownerKey,
    booked,
    onBooked,
}: {
    ownerKey: unknown;
    booked: boolean | null;
    onBooked(): void;
}) {
    return (
        <CompleteCalendlyWidget
            configuredUrl="https://calendly.com/your-team/your-event"
            email={null}
            name={null}
            embedDomain="https://your-host.example"
            ownerKey={ownerKey}
            booked={booked === true}
            schedulingTitle="Schedule"
            onScheduled={onBooked}
        />
    );
}
```

Exactly one existing `useCalendlyBooking` owns session/frame/message authority.
The widget renders `session.frame` directly, preserving ref, key, security
attributes and content window. The supplied generation key owns dialog lifetime;
new session objects, current-writer echoes and cosmetic changes do not reopen it.
Dismiss handlers capture that generation's cancel; cleanup only closes its native
dialog, never a successor booking. No frame is rendered before explicit open.
`embedDomain` is supplied, not read from browser location during render. Browser
interaction requires `HTMLDialogElement.showModal`.

Existing HTTPS validation, URL/prefill composition, exact source/origin/event
checks, consume-before-callback and current-writer semantics are unchanged.
Owner, composed URL, enabled or booked replacement retires the frame. Title,
frame title, theme and same-owner callback replacement preserve it. Scheduling
invokes the authorized callback once; it does not invent an optimistic Booked
value. The host supplies canonical `booked` and permission-aware inputs.

`schedulingTitle || labels.schedule || 'Schedule'` names trigger and dialog,
preserving native custom-or-localized title selection. Optional `labels.booked`,
`labels.invalidUrl` and `labels.close` retain default `✅ Booked`, the native HTTPS
alert and `Close`. The independent iframe title remains `Schedule with Calendly`
unless `frameTitle` is provided. Invalid URL precedes Booked. `enabled={false}`
disables opening and retires the frame; native read-only caller fallback remains
the host's responsibility.

The private dialog initially focuses the supplied iframe and contains sequential
keyboard traversal with iframe-aware boundaries. Escape dismisses while focus is
on a parent dialog control. Key events inside a cross-origin provider frame
belong to that embedded document; the SDK does not bridge them or promise parent
dismissal from iframe-focused Escape. Tab/Shift+Tab traversal exposes the parent
Close control, where Escape or explicit Close dismisses. A completed backdrop
click also dismisses. Connected native close restores focus.
The dialog retains 32rem maximum width and 80vh height. `accentColor`,
`hoverColor`, `focusColor`, `reservedInlineEndWidth` (desktop) and `zIndex` are presentation
values, not authority. Styles are scoped and optional, with no global mutation.

Native adoption must keep current field-ID/schema/linked-value prefill projection
and the native authorized writer, then replace its hook-plus-Modal assembly with
this component. Do not keep another booking hook/state beside it. Form/Portal
child wiring, pin/lock, messenger composition and hosted stored-value acceptance
are separate host work. Synthetic messages are not provider booking evidence.

### Calendly frame lifecycle

`composeCalendlyUrl` and `useCalendlyBooking` from `@miniextensions/sdk/react`
share the existing HTTPS `calendly.com`/subdomain allowlist and URLSearchParams
prefill behavior. Existing query values survive; nonempty email/name values and
embed parameters replace their matching keys. Resolve prefill fields by actual
field IDs in the caller; the hook does not read records or infer field names.

Pass a stable `ownerKey` derived from the actual session, record and field. A
change in that identity, composed URL, `enabled` or `booked` retires an open frame.
Changes to the callback or frame presentation within the same owner use current
props without retiring it. `open()` returns false while blocked or already open.
Render `session.frame` directly: the SDK owns its native iframe ref and creates a
new frame for every open generation. `session.cancel()` closes only that session,
never a later reopened frame, and never proposes a native write. Unmount retires
all admission and removes the message listener.

Only the active iframe's exact `contentWindow`, exact composed URL origin and
`calendly.event_scheduled` data event can invoke `onScheduled`. The session is
consumed before invoking it, including for duplicate or reentrant events. This
is local browser event admission, not provider booking verification or server
write authority. Keep native validation, read-only admission, persistence and
errors in the caller. No SDK client or network request is created by this hook;
rendering its iframe navigates to the configured provider.

```tsx
import { ActionButton, useCalendlyBooking } from '@miniextensions/sdk/react';

export function Schedule({
    ownerKey,
    booked,
    onScheduled,
}: {
    ownerKey: string;
    booked: boolean;
    onScheduled(): void;
}) {
    const booking = useCalendlyBooking({
        configuredUrl: 'https://calendly.com/example/meeting',
        email: null,
        name: null,
        embedDomain: window.location.origin,
        ownerKey,
        booked,
        onScheduled,
    });
    return (
        <>
            <ActionButton
                disabled={!booking.url || booked}
                onClick={() => booking.open()}
            >
                Schedule
            </ActionButton>
            {booking.session ? (
                <section>
                    <ActionButton onClick={() => booking.session?.cancel()}>
                        Cancel
                    </ActionButton>
                    {booking.session.frame}
                </section>
            ) : null}
        </>
    );
}
```

### Native person badges

`PersonBadge` supplies the native list item, escaped label, optional caller avatar
and localized non-submit removal presentation used by hosted collaborator badges.
It forwards the actual `HTMLLIElement` ref and native list-item props. Supply a
resolved string label; name/email fallback, native collaborator IDs/objects,
choice allow-lists, duplicate order, read-only admission and writes stay in the
caller. Omit `remove` for display-only use such as Created By and Last Modified By.
No picker, collaborator model, identity lookup or network call is created.

`avatar` is a caller-owned React node, so an existing image component and its
loading/caching policy stay intact. Optional avatar/body/label and removal class
slots retain the consuming app's theme; the control supplies no theme CSS.
An explicit null avatar retains an empty avatar slot; omission removes the slot.
Removal uses `ActionButton`, always `type="button"`, with optional native props
through `remove.buttonProps`. It uses the current caller callback and preserves
native bubbling. The caller must retain action admission and persistence policy.

```tsx
import { PersonBadge } from '@miniextensions/sdk/react';

export function People({
    people,
    readOnly,
    removePerson,
}: {
    people: readonly { id: string; name: string; email: string }[];
    readOnly: boolean;
    removePerson(id: string): void;
}) {
    return (
        <ul>
            {people.map((person, index) => (
                <PersonBadge
                    key={`${person.id}-${index}`}
                    label={person.name || person.email}
                    remove={
                        readOnly
                            ? undefined
                            : {
                                  label: `Remove ${person.name || person.email}`,
                                  onClick: () => removePerson(person.id),
                              }
                    }
                />
            ))}
        </ul>
    );
}
```

### Projecting native Select choices with an existing evaluator

`projectSelectChoices` from `@miniextensions/sdk/ui` shares native-choice
availability without replacing a caller's hydrated condition evaluator. It
preserves original choice objects, order and canonical values, including pending
choices with empty IDs. `getValue` reads the native canonical name/value; labels
and DOM identity remain separate. `allowedOptionIds: null` means unlimited;
provide normalized IDs from the caller's policy. An explicit empty array admits
no new choices.

Use `retainSelected: true` for list controls that must retain selected choices
outside current limits or conditions. Dropdown eligibility can exclude those
choices while the caller retains its current native value/display. Projection
never edits selection, grants Add Choice/Save authority, normalizes pending IDs,
loads records or performs I/O. Keep maximum selections, creation, read-only
admission and writes with their real owners.

`evaluation` is `skip` for preview/disabled evaluation, `unavailable` when the
real evaluation context is absent, or `evaluate` with a synchronous `matches`
callback closing over that context. A missing context or evaluator exception
returns `status: 'retained-selected'`, the selected native choices and a safe
reason; exception details are not returned. No selection is discarded. The
callback runs only for eligible unselected choices when list retention applies.

This is separate from `getSelectFieldPolicy` and
`resolveSelectFieldAvailability`, whose published-metadata validation remains
strict and still rejects empty/duplicate IDs. The latter uses this projection
only after its own metadata guards. A native pending choice does not become
accepted published metadata or mutation authority.

```tsx
import {
    projectSelectChoices,
    type SelectChoiceEvaluation,
} from '@miniextensions/sdk/ui';

type NativeChoice = { id: string; name: string };
export function NativeChoiceList({
    choices,
    selected,
    evaluation,
    readOnly,
    toggle,
}: {
    choices: readonly NativeChoice[];
    selected: readonly string[];
    evaluation: SelectChoiceEvaluation<NativeChoice>;
    readOnly: boolean;
    toggle(value: string): void;
}) {
    const projection = projectSelectChoices({
        choices,
        selectedValues: selected,
        getValue: (choice) => choice.name,
        allowedOptionIds: null,
        retainSelected: true,
        evaluation,
    });
    return (
        <ul>
            {projection.choices.map((choice) => (
                <li key={choice.name}>
                    <label>
                        <input
                            type="checkbox"
                            disabled={readOnly}
                            checked={selected.includes(choice.name)}
                            onChange={() => toggle(choice.name)}
                        />
                        {choice.name}
                    </label>
                </li>
            ))}
        </ul>
    );
}
```

### Native Rich Text editor ownership

`NativeRichTextEditor` shares the native editor lifecycle and stored-string
contract while the application supplies its **real compatible editor** through
`renderEditor`. The SDK does not bundle an editor vendor, render plain text as a
substitute, create a Form binding/draft, or acquire persistence permission.

The component owns controlled stored-value comparison, exact serialization,
semantic external-value remount, focus signals, actual-instance ref forwarding
and opt-in cleanup of stale sibling editor DOM. Native typing echoes and cosmetic
newline updates retain the current editor/document/caret. The supplied editor
receives `defaultValue`, never a controlled `value` echo. Its ref must receive the
actual editor instance exposing `element` and `view.dom`, not a proxy or snapshot.
The application keeps the editor library/extensions/styles, paste handling,
localized empty content, current native writer and Form/session identity. Key the
component by the application's real editing owner when that owner changes.

Change callbacks bind once to an actual attached editor instance. A same-value
slot replacement, semantic replacement, the read-only null view or unmount
retires the old attachment before caller ref cleanup; late callbacks do not read
the disposed document or write a value. Cosmetic echoes and writer changes retain
the current editor. A zero-DOM commit boundary publishes current writer/read-only
policy before the supplied editor's layout/update callbacks. Suspended renders
do not publish policy or admit their callback snapshots. Forward the supplied
native ref so changes can be admitted only for the actual current attachment.

```tsx
import {
    NativeRichTextEditor,
    type NativeRichTextEditorProps,
} from '@miniextensions/sdk/react';

export function RichNotes({
    value,
    setNativeValue,
    renderCompatibleEditor,
}: {
    value: string | null;
    setNativeValue(stored: string): void;
    renderCompatibleEditor: NativeRichTextEditorProps['renderEditor'];
}) {
    return (
        <NativeRichTextEditor
            value={value}
            onValueChange={setNativeValue}
            placeholder="Write notes"
            emptyContent={<span>No notes</span>}
            renderEditor={renderCompatibleEditor}
        />
    );
}
```

Callback refs may return a cleanup function. The wrapper runs it once on actual
detach, ref replacement or remount; callbacks returning no cleanup retain their
legacy null notification. Object refs continue to receive the actual instance
and null on detach.

DOM cleanup defaults off and follows actual editor attachment, including
read-only null/empty transitions that retain the normalized document key.
Set `removeStaleEditorRoots` only when the supplied
`element` exclusively contains editor-view roots, with no toolbars or other caller
content. This option removes siblings of the active `view.dom`.

Pass every supplied native prop/ref to the actual editor and apply the focus
signal to its normal theme classes. Keep its real parser/serializer and paste
extension integration. Read-only admission and a read-only null empty view are
presentation; the application/server still owns write authority.

The SDK's React 18/19 declaration, slot ABI and browser checks are separate from
the chosen editor vendor's compatibility. The existing host fork of
`rich-markdown-editor` 12.26.8 declares React 16/17 peers: strict installation with
React 18.3.1 or 19.2.0 rejects that vendor. It remains outside SDK and no peer override
is added. Real host editor tests establish the existing React 18 runtime's ref,
caret, formatting, paste and synthetic composition behavior. Synthetic DOM
composition checks do not certify an operating-system IME; protected deployed
acceptance remains a separate gate.

### Native image recovery

`RecoverableImage` renders the actual native image and forwards its ref and image
attributes. Supply caller-authorized `sources` in order and an explicit `alt`
(use an empty string for decorative images). Empty entries and exact duplicates
are removed without trimming, rewriting URLs or changing attachment metadata.
The component owns one failure transition per mounted image attempt, exhaustion
and retry remounting. Repeated errors in the same React batch cannot skip the
next source. An equivalent ordered chain retains the current image; a changed
chain resets immediately and retires its previous retry callback.

```tsx
import { RecoverableImage, ActionButton } from '@miniextensions/sdk/react';

export function AttachmentPreview({ sources }: { sources: readonly string[] }) {
    return (
        <RecoverableImage
            sources={sources}
            alt="Attachment preview"
            loading="lazy"
            renderFallback={(retry) => (
                <div role="status" aria-label="Preview unavailable">
                    <ActionButton
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            retry();
                        }}
                    >
                        Try again
                    </ActionButton>
                </div>
            )}
        />
    );
}
```

The caller owns source admission, signed URL lifetime, lazy-mount policy, classes,
localized fallback and retry-event containment. Recovery renders no extra image
wrapper and performs no explicit fetch, upload, save, URL refresh or attachment
write. It does not infer privacy permission or resolve unknown upload outcomes.
Do not supply `src`, `srcSet` or an overriding error handler; the ordered chain
owns the native image source and error transitions. On failure the image ref is
released; retry creates a new native image starting at the first source.

### Native file selection

`useFileSelection` shares picker reset and drag/drop intake without owning a queue or upload. Spread `inputProps` onto the real file input and `dropProps` onto its target. Native attributes/ref, localized copy, file validation, asynchronous errors, cancellation, transport, permissions and persistence stay with the caller. Both producers deliver a fresh array of the original `File` objects in native order; empty selections are ignored. Picker intake snapshots files and resets the input before calling `onFiles`, allowing the same file to be selected again after success or failure. Drag events are contained, and nested drag entries do not clear highlighting until the target is left. `disabled` denies both producers and retires drag highlighting; it does not cancel a caller-owned upload already in progress. File `accept` is a browser hint, never an authorization or validation boundary.

```tsx
import { useFileSelection } from '@miniextensions/sdk/react';

export function DeviceUpload({
    disabled,
    onFiles,
}: {
    disabled: boolean;
    onFiles(files: File[]): void;
}) {
    const selection = useFileSelection<HTMLDivElement>({ disabled, onFiles });
    return (
        <div {...selection.dropProps}>
            <input
                {...selection.inputProps}
                multiple
                aria-label="Choose files"
            />
            <p>
                {selection.isDragActive
                    ? 'Drop files here'
                    : 'Choose or drop files'}
            </p>
        </div>
    );
}
```

### Native numeric input compatibility

`formatNumberInputCompatibility`, `parseNumberInputCompatibility` and
`isNumberInputCompatible` preserve the native host number/percent/currency
helpers. Config is structural (`type`, `options.precision`); policy contains
optional `numberSeparator` and `allowNegativeNumbers`. These helpers perform
no writes and own no focus or draft state. Hosts retain lifecycle and canonical
write admission.

Validation accepts partial drafts such as `-` (when negatives are enabled) and
`0.`/`0,`, but rejects exponents and leading decimals. Parsing is deliberately
separate and keeps parseFloat coercion, first-comma normalization, toFixed
rounding for numbers/currency, and unrounded division by 100 for percent.
Do not substitute the scalarModels grammar or treat parsing as validation.
Formatting preserves Intl rounding for comma-period/period-comma and toFixed
rounding for space separators, including their distinct rounding edge cases.
`none` disables grouping by default; an explicit grouping argument wins.

A native editor returned inside a stable wrapper can still replace its inner
editor on a parent render. Forward the actual inner editor ref as before. Its
synchronous mount changes must remain admitted, while callbacks captured by the
disposed predecessor remain retired. Binding snapshots distinguish parent props
updates from harmless internal bailout renders; a wrapper's element type/key is
not sufficient ownership evidence.

### Hosted date input compatibility

Existing native picker integrations can use `getDateInputPickerValue`,
`getDateInputValueOnChange`, `getDateInputValueOnBlur`, `formatDateInputValue`,
`getDateInputFormat` and `getDateInputTimeZone` from `@miniextensions/sdk/ui`.
These preserve calendar-date bytes, UTC minute writes on picker change, strict
localized blur parsing and invalid drafts. The caller retains the vendor picker,
input draft/caret, readonly policy and actual writer. Locale data remains caller
loaded. `getDateInputMomentLocale` maps the canonical language contract; English
returns null and `zh-Hans` maps to `zh-cn`.

`isDateInputWithinRange`, `resolveDateInputRangeTimeZone` and
`isDateInputValueWithinRange` share existing calendar range behavior. Use the
optional captured `now` Moment for deterministic range checks. Date ranges use
UTC; datetime ranges use their configured zone, with a valid supplied client
zone or UTC fallback. Display-timezone guessing remains separate from the range
context. `isDateInputRange` checks the supported range literals. These helpers
neither create a model nor authorize writes. The strict bound date model and
backend validation retain their existing contracts, including the page client's
backend-only treatment of client-zone ranges without token-bound provenance.
Use existing public `TextInput` for a supplied native input; retain picker-specific
composition and themed wrappers with the host.

### Complete native-compatible Date and DateTime picker

`DateField` from `/react/date` is the public complete calendar-date field. Import `/react/date.css` for its calendar, readonly text and legacy ISO
styles. Its controlled props are separate from the existing `{binding, render}` API
on `/react` (also explicitly exported as `BindingDateField`). Neither path creates
a Form provider or Saves; the generic entry keeps its existing runtime dependencies.

```tsx
import { DateField } from '@miniextensions/sdk/react/date';
import { useState } from 'react';
import '@miniextensions/sdk/react/date.css';

export function DueDate() {
    const [value, setValue] = useState<string | null>(null);
    return (
        <DateField
            id="due-date"
            title="Due date"
            language="en"
            airtableDateConfig={{
                type: 'date',
                options: { dateFormat: { format: 'D/M/YYYY' } },
            }}
            value={value}
            setValue={setValue}
        />
    );
}
```

`mode="readOnly"` displays the formatted Date or localized empty text without an
input or writer (`setValue` is omitted). `readOnly` on an input instead preserves
the disabled-input presentation. Both retain loaded Date bytes. Native switches
may map configuration, associations and current-owner authority directly into
these props; no native calendar or renderer callback is needed.

`DateTimeField` and `DateTimeFieldProps` from the opt-in
`@miniextensions/sdk/react/date` entry provide the complete date/time field.
`ControlledDateTimeFieldProps` names the same controlled contract. Use
`/react/datetime.css` for its picker, readonly text and legacy styles.
`CompleteDateField` remains a compatibility export for existing consumers.
Both natural components reuse the full calendar/time picker,
localized native input grammar, drafts, blur recovery, range policy and popup.
Import `@miniextensions/sdk/react/complete-date.css` for portable default styles;
Tailwind and a host picker/render slot are unnecessary. Moment locale assets
are loaded by this calendar entry. Core and generic React imports do not load the picker.
Install matching supported React and ReactDOM versions; both remain SDK peers.

```tsx
import { useState } from 'react';
import { DateTimeField } from '@miniextensions/sdk/react/date';
import '@miniextensions/sdk/react/datetime.css';

export function Appointment() {
    const [value, setValue] = useState<string | null>(null);
    return (
        <DateTimeField
            id="appointment"
            title="Appointment"
            language="en"
            airtableDateConfig={{
                type: 'dateTime',
                options: {
                    dateFormat: { format: 'M/D/YYYY' },
                    timeFormat: { format: 'h:mma' },
                    timeZone: 'America/New_York',
                },
            }}
            value={value}
            setValue={setValue}
        />
    );
}
```

Date writes retain `YYYY-MM-DD`; DateTime picker/typed commits use the existing
native timezone/range helpers and UTC minute precision. An untouched loaded
value is not rewritten by rendering. The existing binding-based `DateField`,
`BindingDateField`, `BindingDateTimeField`, `/react` `DateTimeField` and strict
models retain their separate explicit-offset contract,
including original seconds, fractions and offset bytes.

Equivalent metadata and cosmetic props preserve unfinished text and caret.
Changing effective grammar, timezone, field kind, `id`, `sessionId` or optional
`owner.token` resets to the current controlled display and retires old actions.
Supply `owner.isCurrent()` when an external canonical owner can retire before
React commits. Callback-only updates use the current committed writer; a writer
may return `false` to refuse. Unmount and readonly transitions retire edits.
The component creates no Form store, request or implicit Save. Enter commits
without submitting; composing Enter is contained without committing. Clearing
the input and committing writes null.

An enclosing native label can continue to target `id`; `formId`,
`ariaDescribedBy`, `ariaInvalid` and `inputRef` preserve host associations.
Optional `title`, `description`, `error` and `calendarLabel` supply standalone
presentation. The controlled Radix popup supports `calendarAlign`, viewport
collisions, Escape/outside dismissal and nearest `[role="dialog"]` placement.
Scoped popup/input CSS uses `--mx-sdk-accent` or the native `--theme-500` value.
Canonical storage, session identity, authorization and explicit Save remain
with the consuming application.

### Native radio input

`RadioInput` from `@miniextensions/sdk/react` forwards the native input ref,
form/name/value, focus/keyboard and ARIA props. Supply controlled `checked` and
`onCheckedChange(checked, event)`; the caller owns choice identity and accepted
writes. By default, clicking an already selected radio emits no new intent.
Opt into `allowDeselect` for hosted click-to-clear behavior. Disabled, read-only
and cancelled activation emit no selection writes. A refused intent retains the
controlled checked state. No selection model, pending-name policy or transport
is created.

For a native choice group, supply a shared nonempty `name` and the intended
native form owner. Repeated field instances need separate group identities or
form owners. The control cannot infer that scope. Keyboard activation retains
the browser's native radio semantics; `allowDeselect` handles repeated click
activation rather than introducing a custom Space/Arrow handler.

```tsx
import { useState } from 'react';
import { RadioInput } from '@miniextensions/sdk/react';
export function OptionalChoice() {
    const [selected, setSelected] = useState(false);
    return (
        <label>
            <RadioInput
                checked={selected}
                allowDeselect
                onCheckedChange={setSelected}
            />
            Urgent
        </label>
    );
}
```

### Pending select choice presentation

`makeSelectOptionPresentations` accepts native `{id, name}` choices, including
new host choices whose Airtable ID is still empty, and optional conditional
label configuration. It preserves canonical names and IDs, trims configured
labels and appends canonical names to duplicate visible labels. The first
matching label rule wins, including the existing empty-ID compatibility case.
`makeUnavailableSelectOptionPresentation` keeps an unavailable native name.

`getSelectOptionPresentationKey` creates a namespaced UTF-16 key for DOM/React
presentation. Pending and persisted identity have different namespaces. Keep
that key out of native values and save payloads; only the existing host save
reconciliation may replace an empty ID with the assigned Airtable ID.

These helpers own presentation only. They do not validate published metadata,
evaluate conditions, grant permissions, create choices or write records.
`getSelectFieldPolicy` keeps its strict canonical-ID and unique-name validation.
The host retains choice creation, conditional availability, limits, session
ownership and persistence.

### Hosted attachment input compatibility

`isAttachmentUploadUrlCompatible` preserves the hosted HTTP(S) syntax check.
It does not sign, fetch or authorize an upload. `getAttachmentFilenameFromUrl`
uses the last path component, decodes it once, keeps malformed percent-encoding
unchanged and falls back to the hostname for an empty/trailing-slash path.
Invalid absolute URLs throw. Query and fragment data do not become filenames.

`getUploadProgressWeight` gives empty files a weight of one;
`getAggregateUploadProgress` preserves ordered-batch byte weighting, clamping,
rounding and empty-batch completion. These are the existing numeric arithmetic
rules, not input validation; callers retain finite native File byte counts.
The host still owns ordering, progress state, cancellation, partial successes,
R2/Firebase fallback, signing, object URLs, current writer admission and Save.
No renderer or upload controller is replaced by these helpers.

### Ordered attachment upload iteration

`iterateOrderedAttachmentUploads` shares a serial loop for an already-admitted
host batch. It preserves original `File` references, duplicate occurrences,
indexes and returned attachment identity. The host supplies `shouldContinue`
before each next allocation and `upload(file,index)` for its exact existing
per-file operation. Neither callback is a server authorization grant.

```ts
import {
    iterateOrderedAttachmentUploads,
    type OrderedAttachmentUpload,
    type OrderedAttachmentUploadOptions,
} from '@miniextensions/sdk/ui';

// The calling host keeps this array for its existing partial-recovery catch.
export async function collectIntoHostPrefix<T>(
    options: OrderedAttachmentUploadOptions<T>,
    completed: T[],
    afterRetain?: (entry: OrderedAttachmentUpload<T>) => void
): Promise<void> {
    for await (const entry of iterateOrderedAttachmentUploads(options)) {
        completed.push(entry.attachment);
        afterRetain?.(entry);
    }
}
```

Allocation is demand-driven: it starts only when the consumer requests a next
item. After an allocated upload resolves, its original result is yielded even
if the cancellation decision changed during that await. The next request checks
cancellation before allocating another file. Calling the native iterator's
`return` stops future work, but does not abort an outstanding host promise or
erase its pending `next` completion; the host must still consume and settle it.
Errors propagate unchanged, including primitive rejections. There is no retry,
error normalization, File/result cloning, metadata reading or deduplication.

Keep native validation, folder checks, R2/Firebase fallback/signing, progress,
PDF object URLs and cancellation confirmation/abort with the host. Preserve its
before-retain validation/PDF work, completed-prefix push, after-retain progress,
original partial-error append and finalizers. The host's canonical writer and
allocated-settlement ownership remain unchanged. Empty/stopped iteration adds
no write: the caller retains its existing empty-batch and stopped-batch behavior.

This iterator has no client, accepted Form/Portal owner, draft store, journal or
transport cancellation capability. It does not replace the SDK attachment
controller's one-file explicit action and uncertainty semantics, and does not
claim that completing an upload proves an Airtable Save or hosted acceptance.

### Hosted dropdown filter replacement

`getFiltersAfterDropdownChange` preserves the hosted linked-record dropdown
compatibility rule: prepend one explicit replacement predicate (or clear it),
remove all predicates for that target field recursively, and prune empty groups.
ID references take precedence; name references use the first exact field-name
match. Preserve unrelated and unresolved predicates, group metadata, root logic
and predicate order. A missing definition starts as an empty `and` group.
Inputs are not mutated.

This is an explicit presentation edit, not a condition evaluator or query owner.
It does not resolve computed field types, project dropdown chips, validate policy,
read records or save anything. Keep the current accepted criteria/session check
and explicit apply/read behavior with the caller. Unsupported or stale predicates
must not disappear merely to fit a narrower editor.

Dropdown filter reconciliation preserves the caller's condition-setting type,
including nominal host enums, through nested groups and nullable criteria. It
shares tree edits without converting predicate payloads or replacing the host's
strict persisted-choice validation.

## Hosted Add Choice compatibility

`getSelectAddOptionPresentation` from `@miniextensions/sdk/ui` returns a
`SelectAddOptionPresentation`: `kind` (`loading`, `add`, `no-results`, or `none`),
the trimmed `searchTerm`, and `showSeparator`. Loading wins; otherwise an allowed
nonempty, non-equivalent addition with an available callback wins over no results.
The separator is shown only for Add alongside existing search results.

Pass all options, the actual search result count, and the caller's text extractor
for canonical names and aliases. Comparisons trim and lowercase; display text
retains case and internal whitespace. Strings fall back to their own text;
objects have no inferred labels. An explicit empty extractor result suppresses
the fallback. This helper does not filter options or validate canonical metadata.

`hasAddOptionCallback` describes the callback available to the presentation
adapter. A host that always supplies a guarded wrapper must preserve that
availability even when the underlying creation callback is absent. Permissions,
creation callbacks, search state, native identities, sentinels and persistence
remain owned by the caller. Presentation results are never native choice values.

## Hosted collaborator selection compatibility

`getCollaboratorSelectionPresentation({ selectedCount, readOnly,
limitToOneSelection })` shares the hosted picker's selector, empty-state and
remove-control admission. A single selection hides its selector only when the
count is exactly one; existing overfull values keep their original presentation.
`removeCollaboratorSelection(selected, collaboratorId)` removes every matching
native ID while preserving the order, duplicate neighbors and original object
references of the remaining values.

These helpers do not create an editable collaborator renderer, validate an
allow-list, resolve identities, deduplicate lookup values, or dispatch writes.
The host retains supplied choices, name/email search, scalar-versus-array
conversion, permissions, labels, avatars and persistence. Existing bound SDK
collaborator renderers remain display-only.

## Hosted adjacent-child context lookup

`findAdjacentChildSession(contexts, input)` is a synchronous compatibility
helper for an existing hosted context owner. Pass the actual readonly context
map plus source session, `next`/`previous` direction and the requested record ID.
It returns one declared sibling session in the same parent/field/table/child
extension/token/surface/reverse-link scope, or `null` for missing, changed,
foreign, malformed or ambiguous candidates. Original contexts and native data
are never mutated; unrelated payload/label properties are not inspected.

This is not `FormLinkedChildOwner` or server authorization. The host retains
current-owner and confirmation-lifetime admission, canonical open/inline-field
writes, Save/recovery/allocated settlement and all transport. No Form, client,
cache, request, permission or alternate draft is constructed. Full configured
child integration still needs the genuine accepted Form/client/revision owner.

## Borrowed native linked reads

For a runnable composition with native configured-child load acceptance and Save
allocation, see [Runnable borrowed native Form composition](./forms.md#runnable-borrowed-native-form-composition).
Its typed host ports keep option-page publication separate from child acceptance
and check queued intent at the native request snapshot boundary.

`createBorrowedNativeLinkedReadSource(port)` coordinates read lifetimes over a
host's existing linked-record values and cache. The explicit `host-native`
source is separate from accepted SDK Form/Portal facets and linked-option page
provenance. It requires no runtime client, loaded Form, draft, canonical writer,
Save operation or recovery journal. Existing client-backed APIs are unchanged.

The host supplies the following read-only boundary:

- `capture()` returns a readable stamp or no admission. The stamp must cover
  actual native instance, field/table, policy, configuration, filter provenance
  and relevant cache publications, including same-identity reload and ABA.
- `isCurrent(stamp)` checks authoritative native state and current privacy before
  any selected-value access, request allocation or publication. This is local
  freshness admission; backend authorization remains hosted.
- `selected(stamp)` borrows the exact native selected array (or null/undefined), rich row projections
  and unresolved native positions. The SDK does not normalize duplicate IDs,
  invent labels, clone native File/Date objects or inspect opaque projections.
  The returned snapshot belongs to the host and consumers must not mutate it.
- `query(stamp, request)` and `hydrateSelected(stamp, signal)` retain hosted
  transport, native filter provenance, selected hydration and error identities.
  Query and hydration have independent latest-read-wins lifetimes per lease.
- `publishIfCurrent(stamp, kind, page)` performs the final **synchronous** host
  fence and native cache merge, returning whether it accepted the page. The SDK
  stores no second cache and does not manufacture accepted SDK page authority.
- `subscribe(listener)` notifies relevant read-authority changes. An unchanged
  stamp stays current; the host must advance monotonic stamps for observed ABA.

Capture one lease for the actual mounted field owner and retire it on unmount or
scope replacement. Destroy the source to unsubscribe and retire all its leases.
Read abort signals are logical cancellation hints to hosted read transport;
this module never cancels a previously allocated mutation or changes its
settlement. The host's permissions, queue, uploads, cleanup and writers remain
outside this contract, including the separate Portal draft/queue/recovery lane.

Reads return `{status: 'published', page}` only after the host admits publication;
`page`, its native records, metadata and query filter retain their exact object
identities. Retired, superseded or externally aborted reads return
`{status: 'retired'}` and cannot call the host publication callback. A current
transport or publication exception propagates its original identity. An accepted
host publication may itself notify a new native revision: its accepted result is
still reported as published. A retired result never clears canonical selections.

This is a compatibility contract for an adapter to real native state. It does
not by itself complete host adoption or make arbitrary raw pages acceptable to
`FormFieldBindings.linkedRecords` or the private SDK read cache. The native host
adapter and its authoritative store regressions must be qualified separately.

## Hosted native linked-row projection

`projectNativeLinkedRecordRows(recordIds, readDisplayData)` projects an already
filtered and sorted hosted subset into `{ recordId, data }` rows. It keeps the
first occurrence of each displayed ID and invokes the caller's resolver once per
unique ID. The returned `data` is the exact caller object, including native rich
records, selected labels, nested dates/files, loading and unavailable projections.
There is no clone, field read, fallback label, await or persistent cache.

```ts
import { projectNativeLinkedRecordRows } from '@miniextensions/sdk/ui';

const nativeRecord = { id: 'rec_one', fields: { Name: 'Selected title' } };
const hostDisplayData = new Map([
    [
        nativeRecord.id,
        { record: nativeRecord, selectedLabel: 'Selected title' },
    ],
]);
const displayedRows = projectNativeLinkedRecordRows(
    [nativeRecord.id, nativeRecord.id],
    (id) => hostDisplayData.get(id) ?? null
);
```

The native selected value is not rewritten. Manual/barcode/calendar filters,
conditional visibility, custom primary/locale formatting, permissions, hydration,
requests and canonical writer/recovery ownership remain with the host. Pass only
the current displayable subset; this helper does not establish privacy, accepted
Form/page provenance, read authority or a field binding. It never constructs a
client or parallel draft. Resolver errors propagate unchanged. Existing
Array.reduce sparse-hole and initial-length behavior is retained; blank IDs are
not trimmed or reinterpreted. This is a compatibility projection facet, not the
complete accepted linked-record owner.

### Borrowed-native attachment batch controller

`createBorrowedAttachmentController<T, Receipt>` is an explicit alternative to
an SDK-owned Form attachment controller. It requires four genuine host ports:
`readField`/`subscribe`, `captureBatch`, `allocate`, and `settleCompleted`. It
constructs no Form/client, native draft or recovery journal and grants no server
authorization. Default Form attachment/recovery APIs keep their existing behavior.

The host supplies actual private owner identity and policy history. An observed
owner/visible/editable replacement permanently retires new allocation for that
batch, including ABA; `canAllocate(file, originalIndex, completedPrefix)` must
also check unobserved host generations and current capacity. Native File and
attachment objects are borrowed unchanged. `valueReadable` is a separate actual
host privacy gate: masked/hidden native getters are not read and old-owner File,
progress or completion activity is not exposed by snapshots. A field revision alone does not
retire allocated settlement or discard concurrent native values.

`start(files)` owns a serial batch immediately, including synchronous port and
subscriber callbacks. A competing/reentrant start is `not-started`. There is no
automatic replay: retry is a fresh explicit host-admitted start. Progress and
canonical native writes remain hosted. `cancel()` requests only the current
host allocation's optional cancel handle, once, and stops the next allocation;
late success is still delivered. `dispose()` releases observation and prevents
new dispatch without aborting allocated work.

After any allocator invocation, `settleCompleted(receipt, result)` runs exactly
once even after policy change or disposal. It receives the ordered completed
prefix and original failure. The host-held allocation receipt retains existing
canonical append/partial recovery and cleanup ownership; it must not consult a
consumed new-intake lease to discard an allocated result. Settlement failure is
reported separately without replacing a transport error or replaying cleanup.
A completed transport batch does not establish Form Save/persistence success.

## Borrowed native multi-field and lookup hydration

`createBorrowedNativeLinkedHydrationBatch` coordinates one host-native batch for
its real field/table set. It does not choose a first-field owner or issue a read
for each field. Each lease borrows per-field selections as opaque typed values: a
lookup can retain nested arrays, repeated native positions, unresolved paths and
exact rich/File/Date identities. Available null/undefined values stay distinct
from unavailable fields. Metadata descriptors are immutable snapshots; native
selection and page data are neither traversed nor copied.

The host supplies capture/current ownership, synchronous field readability, its
selected snapshots, one batch loader, a final synchronous `publishIfCurrent`
cache fence and a revision subscription. The stamp must cover observed native
instance/field/lookup-dependency/privacy/cache publication and A-to-B-to-A changes.
Per-field readability is checked before that field's native reader; unavailable
fields have no raw read. The host loader and backend retain authorization, returned
page filtering, transport and cache publication. This API provides no client,
accepted linked-page brand, draft, writer, Save or recovery queue.

Hydration is latest-read-wins within a lease, and initiating-turn retirement
precedes allocation. Aborting or destroying a lease retires only its read; it
does not cancel allocated mutations. Stale results/errors never reach cache
publication; current original errors retain identity. An accepted own cache merge
may advance the native generation without discarding its accepted result. Hosts
choose their existing retry/feedback policy; no retry or parallel cache is added.

Use a captured lease's `selected()` for an atomic batch of available/unavailable
field snapshots and `hydrateSelected()` for one host loader/publication. Retire
that lease on caller cleanup, and destroy the batch subscription on owner cleanup.
Changes to the real field set require a new batch owner; they cannot be represented
by inventing table IDs or client/draft authority.

### Borrowed host attachment upload admission

`captureAttachmentUploadAdmission` captures an actual host owner and its observed
native/policy revision for one pending file-selection intent. Supply read-only
`getAuthority` and mounted `isCurrent` callbacks; advance the host revision for
observed policy or native replacement, including A→B→A. Hidden, read-only, replaced
or retired intents cannot allocate new work. `isCurrent()` can guard asynchronous
host validation; `admit(() => existingHostUpload(files))` consumes the intent at
the synchronous allocation boundary. A fresh explicit selection gets a new intent.

Failed authoritative validation permanently retires the intent, even if the
previous owner or revision later returns. Recursive `isCurrent()` or `admit()`
calls during validation refuse only that nested invocation and never allocate
nested work. Recursion alone does not retire or consume the intent: with unchanged
authority, the outer validation and later non-recursive validation can succeed.

This facet owns no File queue, accepted Form/client, draft, transport, journal or
permission. It returns the exact host value/promise and propagates original
errors. After allocation, the host keeps success, cancellation and completed-prefix
partial recovery even if the captured policy retires. Never use this admission
lease to filter an already allocated completion or to replace backend authorization.

### Borrowed native Portal presentation

`createBorrowedPortalRenderScope` accepts a `BorrowedPortalPort<Stamp>` and
creates read-only field renderer hosts for `AirtableList` and `AirtableGrid`.
It does not register native data as private SDK owner provenance. Existing
`createPortalRenderScope` owners and their provenance checks are unchanged.

The native `capture()` supplies only the accepted `PortalRecordPresentation`,
not a cache. Its opaque stamp must change on owner/session/token/view/config,
policy, row or value publication, including equal-value A→B→A. Accepted record
and detail order is preserved. Hidden details are omitted; present-empty,
missing and null detail projections never fall back to schema or cached values.
All generated field capabilities are read-only. The snapshot contains rendered
rows and guarded `openRow`/`openChild` actions, not an SDK collection owner.

`invokeIfCurrent(stamp, target, isCurrent)` is optional and remains a native
admission boundary. It must check live native policy and the supplied fence
immediately before acting, including after any wait. SDK checks before invocation
and after completion cannot undo an improperly admitted native side effect.
Absent callbacks and stale row/field capabilities refuse. Backend authorization
remains native; this contract does not authorize scalar writes or manufacture
SDK child-request provenance. `destroy()` releases presentation subscriptions
only. Shell unmount never calls it or disposes native resources.

The React shell types accept a generic `PortalPresentationSource<S>` and preserve
`S`'s additional render-state properties; existing callers default to
`PortalRenderSnapshot`. Borrowed callers can explicitly use
`AirtableListProps<BorrowedPortalRenderSnapshot>` (likewise Grid) when annotating
props rather than relying on JSX inference.

Borrowed snapshots also expose detached `columns: { fieldId, title }[]` from
the same accepted visible detail/schema policy as cells. Headers preserve accepted
order even with zero rows; no first-row values or cached records are consulted.
Explicit empty, missing or null detail projections expose no columns.

## Complete Portal search gate

`PortalSearchGate` from `@miniextensions/sdk/react` renders the complete blocking
search prompt, not a Portal list-search textbox or a renderer slot. It owns the
dialog, input, description, local raw draft/error state and Continue/Search Again/
Clear controls. It does not load records, qualify configured metadata, grant
access, change a session or submit a Form.

```tsx
import { PortalSearchGate } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/search-gate.css';

// Application-owned navigation, matching the native Clear policy.
function clearSearchParameters() {
    const url = new URL(window.location.href);
    const keys: string[] = [];
    url.searchParams.forEach((_value, key) => keys.push(key));
    for (const key of keys) {
        if (key.startsWith('search_')) url.searchParams.delete(key);
    }
    window.location.href = url.toString();
}

// The application has already decided that its qualified Portal needs the gate.
<PortalSearchGate
    searchPageField={{ fieldId: 'fld_name', fieldName: 'Customer name' }}
    title="Find your records"
    description="Enter {fieldName} to continue."
    hasNoResults={false}
    getCurrentUrl={() => window.location.href}
    onNavigate={(url) => {
        window.location.href = url;
    }}
    onClearSearch={clearSearchParameters}
/>;
```

`getCurrentUrl` and `onNavigate` run only on explicit valid submission, in that
order; neither is called by import, render, mount, metadata changes or unmount.
The example deliberately preserves full navigation. External consumers may
capture the URL instead. The component never assigns location or fetches a
candidate. `onClearSearch` is a host effect, not navigation inside the SDK. The
native Portal callback removes all `search_*` parameters; this remains native
because it also owns screen selection and URL policy outside this field.

The exact pure helpers are public from `@miniextensions/sdk/portals`:
`getSearchPageQueryKeys`, `hasSearchPageQueryParam`,
`getSearchPageSubmissionUrl`, and `PortalSearchGateField`. Recognition accepts
either nonblank `search_<fieldName>` or `search_<fieldId>`. Submission deletes
the configured-ID alias and writes the trimmed term to the exact field-name
key, preserving other parameters, path and fragment through URL/URLSearchParams.
An invalid absolute URL still throws, like the native helper; no fallback or
retry is introduced. Helpers do not establish metadata validity or access.

| Native-compatible input/transition | Complete SDK behavior                                          |
| ---------------------------------- | -------------------------------------------------------------- |
| Description truthy                 | Replace every literal `{fieldName}` occurrence.                |
| Description absent/empty           | Use the existing English default prompt.                       |
| Error/title nullish                | Existing default; configured empty text remains empty.         |
| New mount                          | Empty raw draft, never a URL prefill.                          |
| Field/copy/hasNoResults rerender   | Preserve raw draft, including whitespace.                      |
| Blank/whitespace submit            | Disabled/refused; no URL read or callback.                     |
| Explicit valid submit              | Hide local error, trim only for URL, call navigation once.     |
| `hasNoResults` becomes true        | Show error; typing does not hide it.                           |
| Submit/Clear while flag stays true | Hide local error; Search Again/Clear labels remain.            |
| Clear                              | Empty draft/error, then call host callback once; never submit. |
| Unmount                            | Close local dialog; no navigation, Clear or record effect.     |

`usePortalSearchGate` and `PortalSearchGateOptions` expose the same local state
coordination for an explicitly custom presentation. The complete component
already uses that hook: a native wrapper must not keep another draft/error copy.
The labels retain the current native English defaults; configured description,
title and no-results message are plain escaped text, not HTML or a new language
engine.

The browser shell uses `HTMLDialogElement.showModal`, as the SDK's existing
attachment shell does, with no Close control and cancellation prevented. It
requires modern native-dialog support. The browser owns modal focus/inertness;
the SDK wraps its visible enabled controls at both Tab boundaries, including
ordinary button/link decorations, and defers to an active nested dialog. This is
not a programmatic FocusLock handler; browser modality still applies. Arbitrary
editable/shadow/frame/disclosure header widgets still require their own qualified
keyboard composition.
CSS is not the access gate. Import and SSR never access DOM or mutate browser
globals. The stylesheet is optional and scoped; without it the native dialog
and real form remain usable. `inputId` is optional; generated IDs isolate
simultaneous instances. `ariaLabel` can supply a dialog name. A visually blank
configured title keeps its empty heading but gets a fallback accessible Search
name; described input errors and generated IDs are explicit accessibility
additions, not a claim about the old native markup.

`accentColor`/`focusColor` and `reservedInlineEndWidth` are container-local
theme/layout inputs. A future native wrapper can pass `var(--theme-600)` and
`var(--theme-500)`, plus its Intercom reserved width, without importing application
contexts. `headerActions` is optional decoration, not a prompt renderer or read
authority. `panelTestId`/`overlayTestId` permit existing native test associations.

For framework hosts with document-level maker portals, `renderDialog` accepts
`PortalSearchGateDialogProps`: the already-built complete SDK panel as `children`,
`title`, `ariaLabel`, `description`, `descriptionId`, and `initialFocus`. Return a
framework modal shell around those children. The shell owns non-dismissal,
initial/Tab/restored focus, modal accessibility and native portal compatibility.
It must not render another prompt, input or local draft/error state. The SDK
never opens or closes a browser dialog when this shell is supplied; the same
SDK state and all explicit navigation/Clear behavior remain above the shell.
Use a stable component inside the callback when the shell needs hooks.

Native `SearchPage` uses this seam with its existing HeadlessUI Modal because
its toolbar, settings, Publish feedback and Intercom use document portals. A
native `showModal` top layer cannot preserve those surfaces through z-index.
The native shell retains its current theme, Intercom spacing and focus behavior;
it can register the supplied description through its framework's own description
component. `PortalView` still qualifies metadata and decides no-query/zero-result
admission. Native adoption and browser acceptance remain separate from SDK tests.

Source tests, packed React18/19 ESM/CJS/types/SSR/hydration consumers and installed
styled Chromium proofs are authored/registered separately. They are synthetic
SDK checks, not executed evidence or native Portal/record/hosted acceptance.
Native thin-wrapper and configured parent admission tests, plus the existing
five search-page E2E flows, remain required after safe host integration.

## Complete native-compatible Duration field

`CompleteDurationField` from `@miniextensions/sdk/react` is the complete
controlled clock editor, including its draft/focus/blur behavior, clock icon,
labels, feedback and optional scoped stylesheet. It requires neither native
application JSX nor Tailwind. Canonical data, authorization, visibility and Save
remain with the caller. Importing the React entry does not import CSS or access
the DOM; the component also supports server rendering.

```tsx
import {
    CompleteDurationField,
    type CompleteDurationFieldProps,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-duration.css';

export function ElapsedTime(props: CompleteDurationFieldProps) {
    return (
        <CompleteDurationField
            {...props}
            title="Elapsed time"
            format="h:mm:ss.SSS"
            clearLabel="Clear elapsed time"
        />
    );
}
```

Supply `fieldId`, `sessionId`, canonical `value: number | null`, authorized
`onChange(seconds)` and the actual `owner: { token, isCurrent }`. The token is a
committed owner/configuration generation, not a reversible value hash. Preserve
it across value echoes; replace it for actual record, policy or visibility
retirement. The host's callback must still perform its own final authorization
check. Returning `false` refuses an edit. No client, second canonical draft,
subscription or Save writer is constructed by the field.

`inputId` defaults to a React-generated ID; `formId` defaults to
`form-${sessionId}`. `showLabel: false` lets an existing enclosing native label
own the association. `description`, `error`, `invalid` and `describedBy` retain
accessible feedback, including external description/error IDs. The placeholder
defaults to the format; `readOnly` disables the input as in the native field.
The native clock has no dedicated Clear button. The optional `clearLabel` adds
a localized, non-submit button; keyboard deletion always commits `null`.

This API deliberately differs from existing `DurationField`,
`renderDurationField`, `createDurationFieldModel` and their strict Tables
grammar. Those controls and exports are unchanged. The complete field reuses
the public formula helpers `isDurationInputText`, `parseDurationInputSeconds`
and `getFormattedDuration`, then passes only finite canonical seconds to the
Number scalar action. It supports `h:mm`, `h:mm:ss`, `.S`, `.SS` and `.SSS`:

| Input                                    | Native-compatible meaning                                             |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Empty / `0`                              | `null` / numeric zero                                                 |
| Bare `7`                                 | 420 seconds in `h:mm`; 7 seconds otherwise                            |
| `-1:01:20.125`                           | -3680.125 seconds                                                     |
| `25:72`                                  | Overflow normalization: 94320 seconds in `h:mm`, 1572 otherwise       |
| `-` or `1:`                              | Accepted partial text commits zero while preserving the focused draft |
| Malformed characters or nonfinite result | Refused, no canonical write                                           |

The `1:` behavior follows the native helper and pinned Moment normalization;
it is not the strict Duration parser's refusal contract. Focused text/caret
survive canonical echoes and equivalent metadata. A changed format refreshes
from canonical seconds. Blur reformats without a second canonical write.
Field/session/format/owner replacement retires old callbacks; unmount performs
no commit. Inputs remain editable during an already-allocated native Save if
the current owner and `readOnly` policy permit it.

For custom presentation, public `useDurationInputAdapter` from `/react` and
`createDurationInputAdapter` from `/ui` expose the same canonical admission.
The complete component already owns its field-local draft and lease; a native
thin wrapper must not retain another copy. The headless adapter's `read` and
`isCurrent` ports must describe the captured lifetime, including observed ABA;
they cannot create access rights.

Source tests and normal installed ESM/CommonJS/React 18/19 consumers cover this
separate contract. Packed native Chromium proof exercises the actual optional
CSS and field interactions. These synthetic checks are not native Form/Portal
child adoption, stored-record/reopen acceptance or live authorization evidence.

## Complete localized numeric fields

`CompleteLocalizedNumericField` packages the Number, Currency and Percent input,
localized display draft, focus/blur behavior, immediate/deferred commits, mobile
Clear, symbols, progress and read-only presentation. Import its optional scoped
stylesheet once in your application's CSS entry:

```tsx
import '@miniextensions/sdk/react/localized-numeric.css';
import {
    CompleteLocalizedNumericField,
    type CompleteLocalizedNumericRendererProps,
} from '@miniextensions/sdk/react';
```

Its `field` is the public discriminated `FieldRendererProps` data contract for
`number`, `currency` or `percent`. A controlled native host may supply this data
and a genuinely guarded `capability.setValue`. A host that explicitly chooses
this native-unit, non-login contract may pass its existing renderer data.
Constructing that data creates no Form binding,
controller, permission or Save owner. The SDK's internal props constructor is
not a public export.

`renderCompleteLocalizedNumericField(field, options)` is the corresponding slot
function. In that qualified cohort, register it for the three numeric slots, or render the component with
`{ field, options }`. Supply canonical `number|null` values and complete native
display/write configuration. The component calls the guarded capability with
canonical values and respects its `accepted` result. It never calls a transport
or Save method.

| Kind     | Canonical value | Localized editor, period-comma | Edited display → canonical       |
| -------- | --------------- | ------------------------------ | -------------------------------- |
| Number   | `1234.5`        | `1234,50`                      | `42,755` → `42.76` at precision2 |
| Currency | `1234.5`        | symbol plus `1234,50`          | `42,755` → `42.76` at precision2 |
| Percent  | `0.425`         | `42,50` plus `%`               | `75,25` → `0.7525`               |

The four native separator modes and grouping are retained. Focus removes
grouping; unfinished localized text stays in the transient UI draft. Ordinary
value/writer echoes preserve a focused input and its caret. Number/Currency
retain native precision rounding; Percent converts display units to fractions
once and preserves fractional precision. Formatting, focus and untouched blur
do not write. The legacy `NumberField`, `PercentField`, `CurrencyField` and their
slot functions retain their existing raw scalar contracts, including unscaled
Percent input.

Options include:

- `commit: 'immediate' | 'deferred'`; deferred writes occur on changed blur,
  non-composing Enter or deliberate current-owner unmount. Clear writes null
  once and cancels pending cleanup.
- `presentation: 'editor' | 'display'`; display mode owns native numeric
  formatting, literal Currency symbols, empty states and Percent progress.
- `owner: { token, isCurrent }`; supply the host's actual owner/configuration
  identity and currentness. Source retirement discards the previous UI draft;
  committed configuration changes retire pending old actions. Ordinary value
  echoes and callback identity changes keep the same owner. The host must still
  check current permissions, visibility and record authority before writing.
- `input` for existing IDs, form/label/help/error associations and ordinary
  native attributes; `inputRef` for a native input ref. The component owns its
  controlled value and numeric event orchestration.
- `showLabel`, `clearLabel`, `emptyLabel`, `className`, `inputClassName`.
  Native outer field frames may keep their labels/validation UI and supply
  literal localized strings. Package styles require no Tailwind setup and use
  `--mx-sdk-accent` for themed color.

Host pending state remains a host policy decision. In particular, allocating an
existing native Save must not newly block input when that host permits editing
during the flight. This presentation does not replace already-allocated Save
settlement or create-to-edit continuity.

The public `createLocalizedNumericInputAdapter` and
`isLocalizedNumericInputValid` helpers preserve locale-aware parsing before
the raw scalar model. `useLocalizedNumericInputAdapter` is the controlled-host
compatibility hook; it accepts an optional actual owner token/currentness port.
These helpers own no canonical store. The complete component already uses the
adapter; its callers must not parse, scale or apply the same edit a second time.

This is not a drop-in replacement for raw SDK numeric contracts or a login
credential control. Native numeric producers do not expose Text password masks;
the application's separate login input retains its masking policy. A host with
additional active renderer policies must qualify that cohort independently
instead of assuming that the shared renderer-data type establishes equivalence.

## Complete editable Phone field

`PhoneNumberField` with controlled `value` and `onValueChange` props is the complete
native-compatible Phone editor in `@miniextensions/sdk/react`.
`CompletePhoneNumberField` retains the same controlled implementation and props
for existing callers. The natural API owns plain literal input and the actual country
picker, international formatter, Unicode flags, mobile Clear and transient edit
lifetime. Import `@miniextensions/sdk/react/complete-phone.css`; no application
CSS, native renderer slot, client or second canonical store is required.

```tsx
import { useState } from 'react';
import { PhoneNumberField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-phone.css';

export function StandalonePhone() {
    const [phone, setPhone] = useState<string | undefined>('+233201234567');
    return (
        <PhoneNumberField
            value={phone}
            showCountryCodes
            defaultCountry="GH"
            clearLabel="Clear phone"
            input={{ 'aria-label': 'Phone' }}
            onValueChange={(next) => setPhone(next)}
        />
    );
}
```

Country mode emits the frozen native vendor's canonical string or undefined;
plain mode preserves literal strings, including ''. Defaults, hints and mounting
do not normalize existing saved values. Readonly/disabled mode disables both the
input and country selector. `input` supplies the actual textbox's id, name, form,
placeholder and accessibility metadata; `inputRef` forwards its real DOM ref.
The SDK accepts host-localized `clearLabel` while native country labels remain
English. Unicode flags do not introduce remote flag-image requests.

Use `commit="deferred"` only with a `CompletePhoneEditOwner` supplied by the host
that owns the real session, field, record, table and policy. Its opaque token must
renew for a target/policy generation, including A→B→A; `isCurrent()` checks the
original authority. Typing stays local until blur, non-IME Enter or an explicitly
admitted unmount. Country selection remains immediate. `settleOnUnmount={false}`
discards pending work. The host still owns canonical Save and persistence.

Clear intentionally retains the native vendor behavior: its button can re-emit
the existing canonical country number while the deferred display becomes blank.
Plain mode clears to ''. It neither submits a form nor refocuses/remounts the
textbox. This compatibility behavior is separate from deliberately replacing a
saved number with an empty value. Stale continuations cannot adopt a successor
owner. Hint, ARIA and callback rerenders do not define a new input lifetime.

The private runtime freezes react-phone-number-input3.3.9,
libphonenumber-js1.10.57 and input-format0.3.9, their metadata and license closure.
Both module formats use that same private runtime; consumer parser overrides do
not select different parsing code. No private vendor import is a customer API.
The existing `PhoneNumberField` binding contract remains unchanged. Its controlled
and binding props are mutually exclusive. `PhoneEditOwner` and `PhoneCommit`
provide the natural type names; their existing `Complete*` type names remain
compatible. `PhoneNumberFieldProps` remains the legacy `TextFieldProps` alias,
including assignability and contextual renderer typing. Controlled callers may
use `ControlledPhoneNumberFieldProps` without changing the component name.
Deferred controlled edits still require the actual host owner, and
the host still owns any `undefined` to `null` persistence adapter. Plain Clear
remains `''`; country callbacks retain the real vendor's string/undefined values
and blur-before-Clear ordering. Neither API form performs an implicit Save.

## Complete read-only Phone presentation

The optional `@miniextensions/sdk/react` entry exports
`ReadOnlyPhoneNumberField` and `ReadOnlyPhoneNumberFieldProps`, with
`CompleteReadOnlyPhoneNumberField` and `CompleteReadOnlyPhoneNumberFieldProps`
retained as compatible names. This complete presentation renders an
existing saved telephone string as native link text and an unchanged `tel:`
href, with `target="_blank"`, `rel="noreferrer"` and stopped parent click
propagation. It does not parse, normalize, validate or resolve the value. The
host supplies the localized empty message for null, undefined and empty string.
Whitespace-only and malformed saved strings remain literal nonempty values.

```tsx
import { ReadOnlyPhoneNumberField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-phone.css';

<ReadOnlyPhoneNumberField
    value="+233 20 123 4567"
    emptyLabel="No saved phone"
/>;
```

Optional `className` applies to the wrapper or empty-state paragraph, and
`linkClassName` applies to the anchor. Hosts may retain existing cell/list layout classes;
those layout-specific line clamps remain outside this standalone component.
The SDK stylesheet supplies base wrapping and overflow behavior on its own.

The stylesheet supplies the link and empty-state presentation without Tailwind,
application aliases, injected native controls or another package dependency.
The component owns no client, store, writer or network operation. It is SSR-safe;
the browser or operating system owns the eventual telephone action.

This export is separate from the binding and controlled editable `PhoneNumberField`.
It adds no country picker, phone formatting, editing, Clear or deferred commit
behavior, and does not change those legacy APIs. Native Form/Grid ownership and
backend persistence remain separate application responsibilities.

## Complete readonly text

`CompleteReadOnlyTextField` from `@miniextensions/sdk/react` owns the
native-compatible literal text, automatic links, localized empty value and
layout styles. Import `@miniextensions/sdk/react/complete-readonly-text.css`.
The existing `LiteralText` primitive keeps its inert defaults and optional slots.

```tsx
import { CompleteReadOnlyTextField } from '@miniextensions/sdk/react';

const alreadyFormattedAndMaskedText = 'Literal text https://example.com';

<CompleteReadOnlyTextField
    value={alreadyFormattedAndMaskedText}
    language="en"
    textSize="medium"
    layout="cell-medium"
/>;
```

The required language uses the existing public `RuntimeLanguage` values. Omitted
text size inherits surrounding typography. Omitted layout retains native
`list-linked-record`/`cell-*` compatibility; explicit `default`, `linked-list`,
`cell-short`, `cell-medium`, `cell-tall`, `cell-extra-tall` or `cell-fit-content`
controls standalone wrapping/clipping. Cell heights remain caller-owned.
The default preserves whitespace; fit-content retains native single-line
clipping rather than expanding wrapped text. Empty values render their localized
icon/paragraph directly. `'0'` and whitespace remain visible literal values.

Links retain the native Linkify recognition and `_blank` policy. Only link
clicks stop propagation; ordinary text still activates its containing row.
The component never interprets HTML, mutates Linkify globals or performs I/O.
Callers retain conversion, masking, access decisions and canonical values.

## Complete shared clearable input

`CompleteClearableTextInput` and `CompleteDeferredClearableTextInput` own the
shared text-input/Clear presentation and the existing immediate/deferred draft
lifecycle. They reuse the public `TextInput` and `InputClearButton` primitives;
they do not parse Email/URL/Text values, own a field queue, authorize a write,
scan a value, or create a Form store. Import the optional scoped stylesheet
`@miniextensions/sdk/react/complete-clearable-text-input.css`; its fallback
styles do not require Tailwind or reset unrelated inputs and buttons.

```tsx
import { useState } from 'react';
import { CompleteClearableTextInput } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-clearable-text-input.css';

export function SharedInputExample() {
    const [value, setValue] = useState('Literal draft');
    return (
        <CompleteClearableTextInput
            value={value}
            onChange={setValue}
            onClear={() => setValue('')}
            clearLabel="Clear answer"
            initialMobile={false}
            enableInlineEdit
            aria-label="Answer"
            name="answer"
            autoComplete="off"
        />
    );
}
```

The required `initialMobile` is an explicit resolved device snapshot, captured
for each component mount. Supply the same snapshot during server render and
initial client hydration. `resolveCurrentClearableInputMobile()` is the
browser bridge for the existing UAParser current-device policy; it returns
false when there is no window, which alone is not mobile hydration parity.
Do not replace that policy with a viewport/touch heuristic or call it during
hydration to change the agreed initial value. It reads only the existing
bounded current-device inputs and performs no request. A newly mounted
deferred mode captures its new supplied snapshot; the coordinator's retained
immediate classification does not replace it.

Immediate mode reports literal typing through `onChange`; Clear invokes only
`onClear`. Omitted immediate autocomplete becomes `on`. Deferred mode leaves
omitted autocomplete absent, validates only typing, retains a dirty local draft
through external echoes and reconciles settled values while clean. Ordinary
blur commits a changed local value through the current callback. Pending
unmount settlement deliberately uses the original mounted callback and latest
passive-effect draft, leaving the consumer's existing writer/ownership guard
authoritative.

Deferred mode overrides supplied input blur/key-down handlers rather than
chaining them. Enter prevents implicit Form submission; composing Enter does
not blur. Clear cancels pending unmount cleanup, clears its local draft and
invokes `onClear` once. The Clear button does not suppress pointer focus
transfer: a dirty focused input can commit through blur before the subsequent
Clear click. Preserve that native event order rather than merging these two
callbacks into a new write policy. Unmount after blur/Clear must not introduce
another pending commit.

Mobile Clear uses the actual nonempty displayed draft, a localized accessible
label and `type=button`; disabled/read-only controls deny its click. The
forwarded ref and native name/type/form/ARIA, placeholder and input styling
remain with the consumer. Desktop and tablet do not become mobile because a
viewport is narrow.

## Complete native-compatible plain multiline field

`CompleteMultilineTextField` owns the complete plain textarea presentation,
native selection capture/restoration, fixed three-to-thirty-row autosizing,
vertical resizing, character-limit counter and disabled read-only state. It uses
the same public `TextareaInput` primitive. Import its scoped stylesheet; no
Tailwind setup, native renderer slot, Form store or service client is required.

```tsx
import { useState } from 'react';
import { CompleteMultilineTextField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-multiline.css';

export function NotesExample() {
    const [value, setValue] = useState<string | null>(null);
    return (
        <>
            <label htmlFor="notes">Notes</label>
            <CompleteMultilineTextField
                id="notes"
                value={value}
                onChange={setValue}
                placeholder="Add context"
                characterLimit={120}
                hasDescription
            />
            <p id="notes-description">
                Literal text and line breaks are retained.
            </p>
        </>
    );
}
```

The consumer retains the canonical string/null value and writer authority.
`null` displays an empty textarea; ordinary edits and clearing emit strings,
including `''`. Every delivered React change is forwarded literally, including
intermediate composition values. Composition-end and blur do not introduce a
second commit. The component does not buffer IME input, normalize whitespace,
truncate a delivered value or convert empty text to null. Native DOM maxlength
editing constraints remain separate from forwarding an already-delivered value.

`characterLimit` is projected without normalization to native `maxLength` and
the counter. The counter uses UTF-16 string length and warns at or above the
raw bound. Read-only presentation disables the textarea and removes the
editable bound/counter without changing the value or emitting edits. Default
autocomplete is always `off`. `id` and optional `form` retain native association;
`hasErrorMessage` and `hasDescription` reference `${id}-error` then
`${id}-description`. Render those elements outside the field when requested.
A forwarded ref exposes the actual textarea. The optional CSS custom property
`--mx-sdk-multiline-focus-color` customizes the standalone normal focus color;
consumer utility styles retain precedence over scoped fallback selectors.

This API deliberately coexists with the public `MultilineTextField` binding
and `renderMultilineTextField`. Their internal `MultilineTextControl` retains
the separate four-row default, strict composition buffer and empty-to-null
commit contract.
Native-compatible extraction does not silently alter those consumers or adopt
Form/Portal Save, ownership, masking, append-only or attachment policies.

## Complete HTML and collapsible descriptions

Import the HTML presentation family through its opt-in entry and stylesheet:

```tsx
import { CompleteTruncatedDescription } from '@miniextensions/sdk/react/html';
import '@miniextensions/sdk/react/html-description.css';

export function DeliveryHelp() {
    const html =
        '<p><strong>Delivery notes</strong></p><p>Keep the entrance clear.</p>';
    return (
        <CompleteTruncatedDescription
            html={html}
            resetKey="delivery-help"
            readMoreLabel="Leer más"
            showLessLabel="Mostrar menos"
        />
    );
}
```

`CompleteHTMLRenderer` accepts a required HTML string, optional `inline`, and
native div props. Its forwarded ref exposes the rendered div. Block mode adds
the native heading, list, table, quote, code and link presentation; `inline`
omits that block presentation. Caller styles are retained except that
`contain: paint`, `isolation: isolate` and `position: relative` are always
enforced. Caller `overflow` wins; otherwise it is `auto`.
Ordinary mounted style/class updates retain the current nodes when sanitized
HTML is unchanged; replacing raw HTML still runs the same sanitizer.

`CompleteQuillHTMLRenderer` accepts `html` and optional `className`. It adds
scoped native Quill Snow presentation and forwards its ref to the inner
sanitized editor div. After each HTML change, links receive `target="_blank"`
and `rel="noopener noreferrer"`. Markdown-like input remains literal text;
these components interpret HTML, not Markdown.

`CompleteTruncatedDescription` accepts `html`, optional inner-renderer
`className`, `resetKey`, `readMoreLabel` and `showLessLabel`. Labels default to
`Read more` and `Show less`; supply translations directly. It has no forwarded
ref. The collapsed viewport is exactly `4.5rem` with hidden overflow. Changing
HTML or `resetKey` collapses the same-mounted disclosure. Measured content that
fits needs no toggle; zero measured heights retain the previous overflow
decision. Expanded content keeps its collapse action when layout shrinks.
ResizeObserver, window resize and image load/error events update measurements.
Clipped interactive descendants leave the tab sequence and accessibility tree;
their exact prior attributes return when visible, expanded or cleaned up. The
toggle is `type="button"` and retains its viewport's `aria-controls` identity.

All three components use `sanitizeHTML(html)` with the native-compatible
DOMPurify 2.4.7 policy. Direct `button`, `datalist`, `fieldset`, `form`, `input`,
`label`, `legend`, `optgroup`, `option`, `output`, `select` and `textarea` tags
are removed while safe text is retained. Iframes require an explicit valid
HTTPS source. Accepted frames receive this fixed sandbox, plus
`referrerpolicy="no-referrer"` and `loading="lazy"`; `srcdoc` is removed:

```text
allow-downloads allow-forms allow-popups allow-presentation allow-same-origin allow-scripts
```

`hasRenderableHTMLContent(html)` sanitizes first, ignores markup-only,
whitespace, nonbreaking-space and native zero-width empty content, and retains
meaningful text or supported audio, rule, iframe, image, table and video
content. Both helpers take strings and are exported only from the opt-in HTML
entry. The presentation components expose no canonical value writer or
Form/Portal persistence policy.

Node rendering uses a private, lazily created jsdom 20.0.3 parser window.
Browser bundles must honor the package's `browser` mapping, which selects the
private browser factory for both ESM and CommonJS and excludes the Node parser.
That browser module imports without a document; actual sanitization requires a
browser document. Neither factory reads or replaces an application's global
DOMPurify instance, hooks or configuration. The generic React and headless
entries do not import this HTML parser. The scoped stylesheet works without
Tailwind or a global Quill stylesheet; the separate Markdown editor keeps its
own API and styling.

## Complete verification screen

`CompleteVerificationScreen<Result>` is an additive React-only, host-compatible
email/phone confirmation screen. It is separate from the SDK auth flow and its
one-use grants. It owns the actual form, raw code draft, pending/error/Reload UI,
accessible input and a private one-entry confirmed-result cache. It never creates
an auth client, sends a code, installs a session, writes storage, logs a code or
result, or retries an operation automatically.

```tsx
import { createElement } from 'react';
import {
    CompleteVerificationScreen,
    type CompleteVerificationScreenProps,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-verification.css';

type Confirmed = Readonly<{ applicationHandle: object }>;
declare const confirm: CompleteVerificationScreenProps<Confirmed>['confirm'];
declare const continueWithResult: (result: Confirmed) => Promise<void>;
declare const reload: () => void;

createElement(CompleteVerificationScreen<Confirmed>, {
    verificationId: 'synthetic-challenge',
    maskedDestination: '***42', // masking belongs to the accepted host parent
    labels: {
        sentCodeTo: 'Code sent to',
        enterCode: 'Verification code',
        continue: 'Continue',
        reload: 'Reload',
        attemptsExhausted: 'Attempts exhausted',
        loading: 'Loading',
    },
    confirm,
    continueWithResult,
    reload,
});
```

The host supplies transport, language, normalized service failure, continuation,
error observation and Reload. `onError` must be nonthrowing and must not include
codes or private results in telemetry. `formatErrorMessage` is an optional pure
presentation adapter; exhaustion classification still compares the original
error with the **current** localized `attemptsExhausted` string. Destination,
labels and errors are escaped text, not HTML. An optional `pendingDetails` node
can preserve app-level timeout/help decoration without copying pending state or
replacing the SDK's form/spinner. The native shared Refresh/Logout timeout and
rich error/help presentation are host composition concerns, not SDK auth policy.

### Compatibility and lifecycle

- Initially empty code disables the real `type=submit` button. The input remains
  `type=text`, pattern `\d*`, with no trimming or OTP filtering. Trusted Enter and
  normal browser pattern validation are preserved. A programmatically dispatched
  submit is not the same as browser constraint validation; no extra handler-only
  empty/pattern admission rule is introduced.
- Confirmation and continuation both replace the form with pending UI. Cache the
  successful opaque result **before** awaiting continuation. Continuation failure
  restores the same draft and exact error; a later explicit submit for that
  verification ID retries continuation with the identical result, not confirmation.
  The result never appears in public state, DOM, logs, storage or serialization.
- Failure does not clear the code or previous confirmed result. Input editing and
  a new attempt do not clear the error. Success remains pending until host
  replacement/unmount. Exhausted-attempt text changes the next explicit submit to
  Reload, with no new confirmation or continuation.
- Cache lookup uses only verification-ID equality, matching native behavior. A
  settled A→B→A sequence with successful confirmations replaces the one-entry
  cache and confirms A again. Changing destination, locale or callbacks alone
  does not clear it. The parent retains its existing session-keyed lifetime.
- An already admitted attempt uses its captured challenge, confirmation,
  continuation and error observer. Prop replacement/unmount does **not** cancel
  transport or undo continuation. A later explicit retry uses that render's
  current callback with the cached result. There is no invented revision fence,
  abort, rollback, latest-callback ref or synchronous programmatic singleflight
  contract. Pending UI removes ordinary user submit controls.

Optional scoped CSS requires no Tailwind/native aliases and has no global import
side effect. `accentColor` maps locally to `--mx-sdk-verification-accent` (fallback
`--mx-sdk-accent`, then indigo); `inputId` is optional and default IDs are unique
across simultaneous roots/SSR hydration. React 18 and 19 use the same contract.
Without CSS the native form/label/input/button and pending accessible status still
work. Reduced-motion and forced-color styling are included.

### Native handoff (not implemented by SDK extraction)

Native `EmailOrPhoneNumberVerificationView.tsx` can map `confirm` to its existing
website request using exactly `{verificationId, verificationCode, language}` and
return the existing opaque result. Its captured continuation translates to
`loginWithEncryptedLoginToken`, error observer retains extension context, and
Reload retains `window.location.reload`. The parent keeps masked destination,
modal/session identity and installation/storage/URL side effects. Preserve the
shared timeout/error decorators through the explicit presentation seams; do not
copy the code/loading/cache/error state into the wrapper. Do not change
`LoginPageExtensionView`, `loginIntoExtensionUsingLoginPage`, SDK auth safety or
backend policy. This SDK stage is not native adoption, actual code delivery,
credential-storage qualification or hosted authentication acceptance.

## Configured Address field

`AddressField` is the natural public React API for the configured Address field.
Import `@miniextensions/sdk/react/address-field.css`; it includes the existing
portable autocomplete, clearable, readonly and scanner styles.

- Default `mode: 'autocomplete'` uses the existing complete control and lifecycle.
  Supply `identity`, authorized `reads`, canonical `value`/`onChange`, localized
  labels and native input/form/ARIA attributes. Raw queries and description then
  formatted-address writes retain the existing request engine and capped-echo bridge.
- `mode: 'manual'` accepts a controlled value/writer, clear label and optional
  explanation. It has no identity/read capability. The SDK owns preview text,
  description association, mobile Clear, counter and optional inline deferred input.
- `mode: 'readonly'` accepts already converted/masked text and language, with optional
  text size/layout. It renders the existing readonly text presentation without any
  writer, prediction read, scanner or request owner.
- Character limits remain an accepted-writer policy; pass the same `maxLength` used
  by the caller's cap. External committed values are displayed intact. The counter
  can be disabled for compatibility callers that already own one.
- Optional `scanner` data reuses the existing SDK scanner controls and ownership.
  It adds no native renderer slot or new camera permission path. Readonly mode never
  mounts scanner controls. The host remains responsible for permitted configuration.

Existing `CompleteAddressAutocomplete`, its props, lifecycle hook, request engine
and stylesheet remain compatible. No singleton client, credential or Save is added.

## Complete React Address autocomplete

`CompleteAddressAutocomplete` from `@miniextensions/sdk/react` owns the complete
Combobox, input/ref, mobile Clear, options, official embedded Google Maps
attribution, loading and explicit retry presentation. Import the optional
`@miniextensions/sdk/react/complete-address.css` for standalone styles. It needs
no Tailwind or monorepo assets. `theme.activeBackground` and `theme.activeText`
override its scoped option colors; native input attributes, classes, styles,
label/ARIA associations and forwarded input refs remain available.

```tsx
import {
    CompleteAddressAutocomplete,
    type AddressAutocompleteLifecycleProps,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-address.css';

export function ShippingAddress(props: AddressAutocompleteLifecycleProps) {
    return (
        <CompleteAddressAutocomplete
            {...props}
            id="shipping-address"
            form="shipping-form"
            aria-label="Shipping address"
            initialMobile={false}
            labels={{
                clear: 'Clear',
                loadingPredictions: 'Loading address suggestions',
                loadingDetails: 'Loading selected address',
                failed: 'Address suggestions could not be loaded. Keep typing or retry.',
                retry: 'Try again',
            }}
        />
    );
}
```

Supply authorized `listPredictions(query, {signal})` and
`getFormattedAddress(placeId, {signal})` closures. This component never creates
a client, accepts a session, adds a destination, performs Save or automatically
retries. Identity members compare by reference/value; replace the relevant
session, field or read-scope member whenever that authority changes. An observed
A→B→A transition creates fresh ownership. Render-only labels/classes/callback
changes preserve pending reads and use the latest committed writer. Disabled or
read-only controls retire reads and suppress editing/selection/retry; a read-only
input remains focusable. Abort listeners and writers may reenter synchronously;
obsolete edit receipts cannot write through a successor owner or newer edit.

The external canonical value remains authoritative even when no place is
selected, including empty/null and values longer than `maxLength`. Manual edits
write raw text before scheduling the existing 800 ms nonempty-query debounce.
Selecting a current prediction writes its description synchronously, then
formatted details may replace it. `maxLength` recognizes the caller's capped
echo without imposing a second cap/store. External replacements and unmount
retire obsolete work, including when a transport ignores abort. Each expected
echo expires after one commit, including an unchanged capped value. A same-value
assignment cannot signal an external reset; change an identity member for that.

`useAddressAutocomplete` exposes the same lifecycle for other presentations and
reuses the unchanged public request engine. Pass options directly from its
current `state.predictions`; copies and old options are refused. Retained retry
callbacks are tied to their exact failed snapshot. Supply the same explicit
`initialMobile` value to server render and hydration, then remount for a new
device policy. Required labels are caller-localized; native adapters supply all
supported languages. The legacy DOM control/model and its composition/cap
policy remain independent APIs.

## Complete Barcode / QR scanner

`CompleteBarcodeScanner` owns the dialog, focus management, camera preview,
decoding, failure/retry/manual-entry controls and cleanup. Import its stylesheet.
The binding form of `BarcodeField` retains its display-only contract. Its explicit
controlled form composes this same scanner with the complete text editor.

```tsx
import { useBarcodeScannerButtonInField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-barcode-scanner.css';
export function Scanner({ write }: { write: (text: string) => void }) {
    const scanner = useBarcodeScannerButtonInField({
        fieldType: 'barcode',
        autoStartCamera: false,
        setValue: write,
        ownerKey: 'current-record',
    });
    return (
        <>
            {scanner.barcodeScannerButton}
            {scanner.scannerComponent}
        </>
    );
}
```

Barcode enables the button by default. Email, URL and singleLineText require
`enableQRCodeScannerForFormField`; readOnly suppresses both the button and stale
autoStartCamera. A later enable does not replay initial auto-start. Changing
ownerKey or runInLoop retires the old session; use an explicit fresh start.
Ordinary callback replacement updates future delivery without cancelling an
already admitted write or lookup. Those operations settle once in the caller. A rejected callback closes the scanner
without replay; the caller owns its error presentation.
Nonempty scans retain the native strictly-greater-than-one-second throttle and
loop mode restarts after 500ms. Dismissal, disable, owner change and unmount
retire camera/restart work without replaying or rolling back caller operations.

Labels accept the native localization keys, with English defaults. style carries
theme variables into the dialog portal; desktopViewportOffset reserves desktop
space for a support panel. buttonAppearance:'unstyled' preserves a caller's
custom icon-button classes. No application renderer, context or stylesheet is
required. Media permission is requested only by a configured initial auto-start
or explicit scanner start. Camera hardware acceptance is separate from synthetic
media/decoder qualification.

## Portable theme composition

`@miniextensions/sdk/ui` exports the native-compatible `ThemeColor`,
`ThemeTokens`, `colorsToCssVars`, `ALL_THEME_COLORS`, `DEFAULT_THEME_COLOR`
and pure `getThemeStyles(color)`. It has no React or browser requirement.
All 27 palettes retain ten raw RGB channel strings, including legacy indigo.

`ThemeBoundary` from `@miniextensions/sdk/react` renders a div. Set `theme`
explicitly for a standalone root (`DEFAULT_THEME_COLOR` is blue). Omit both
`theme` and `tokens` to inherit without injecting a default. A complete `tokens`
snapshot wins over palette projection; ordinary `style` (including SDK semantic
variables) wins locally. Omitted boundaries also inherit semantic overrides. Selection
stays with your state. Nested scopes, separate roots and unmount never mutate
`document`, body, or another boundary.

Import `@miniextensions/sdk/react/theme.css` explicitly to bridge raw tokens to
existing SDK accent and Button variables. Import each component's stylesheet
separately. Without theme CSS, raw tokens still render/inherit and the leaf's
existing defaults/custom styles apply. The bridge preserves configured Button
`data-color` values and light-palette foregrounds. SDK Button uses hover700;
native Button keeps hover500. Existing native numeric600 and Duration500 local
accent overrides keep precedence. Fixed-color leaf styles, error/disabled
states, Tooltip black surfaces, background and width policy stay with their
existing owners; this is not a whole-component recoloring contract.

A detached portal must apply `getThemePortalProps(snapshot)` to its actual DOM
wrapper. Pass `useThemeSnapshot()` explicitly, or construct an effective
`{theme, tokens}` snapshot. Put custom raw tokens in the complete `tokens`
input when they must propagate. React context carries supplied styling data;
it does not create CSS inheritance across a portal. DOM-only styles (including
raw tokens supplied only via `style`) are deliberately not discovered, read
with computed styles, or promised propagation. No generic portal engine,
script/style injection or global theme store is installed.

### Complete controlled Checkbox

`CheckboxField` from `@miniextensions/sdk/react` accepts either the existing
`{ binding, render?, className? }` contract or controlled `{ value, onChange }`
props. Controlled props provide the native checkbox, toggle, button and readonly
modes, standalone title/feedback or shell `presentation` associations. Import
`@miniextensions/sdk/react/checkbox.css` for all modes and configured scheduling.

Pass `calendly` with explicit `configuredUrl`, resolved `email`/`name`,
`embedDomain`, stable current `ownerKey` and `onScheduled` admission. The SDK
composes its qualified widget; there is no native renderer slot. Scheduling
completion uses only `onScheduled`, ordinary edits only `onChange`; neither
implicitly saves. Readonly forces the ordinary disabled checkbox (or static grid
value). Existing `CompleteCheckboxField` remains compatible.
