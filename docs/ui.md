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

## Prepared Form review in the browser starter

The packaged starter's `src/review.ts` and existing DOM confirmation dialog
implement the published `promptUserBeforeSubmission` setting for a bounded
one-page manual Form with supported section conditions. This is application code shipped with the example,
not a new SDK mutation or a general review renderer.

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

- Use one-page manual final Save with `promptUserBeforeSubmission`. Multipage,
  compute and automatic submission remain unsupported.
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
`EmailFieldOptions` and `renderEmailField`. `EmailField` delegates to `TextField`;
its props and options are aliases of `TextFieldProps` and `TextFieldOptions`.
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
`PhoneNumberFieldOptions` and `renderPhoneNumberField`. `PhoneNumberField`
delegates to `TextField`; its props and options are aliases of `TextFieldProps`
and `TextFieldOptions`. The existing `{ binding, render }` override replaces all
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
There is no separate Phone Number stylesheet. Import the existing optional
`@miniextensions/sdk/react/text.css`, override its `mx-sdk-text*` classes or supply
your own styles. JavaScript does not import CSS; `className` decorates the wrapper.
Core and `/ui` remain React-free.

After building, `node examples/react-phone-number/dev.mjs` serves synthetic
presentation fixtures at `http://127.0.0.1:4185`.
`node scripts/check-phone-number-browser.mjs` checks native entry, clearing,
remounts, inert text and enclosing-form Enter behavior. Simulated composition does
not certify real OS input methods.

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

## React Percent presentation

The optional `/react` entry exports `PercentField`, `PercentFieldProps`,
`PercentFieldOptions` and `renderPercentField`. `PercentField` delegates to
`NumberField`, whose physical percent bindings use the same Number control.
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

This is manual native-unit entry. A native fraction of `0.25` appears as `0.25`
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
The shared binding component selects the calendar or timestamp control from the
accepted model kind; `DateTimeField` remains its compatibility alias.

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

## React DateTime presentation

The optional `/react` entry exports `DateTimeField`, `DateTimeFieldProps`,
`DateTimeFieldOptions` and `renderDateTimeField` for explicit-offset timestamps.
The binding component keeps its `{ binding, render }` API; supplying `render`
still replaces all markup. `DateTimeField` remains an alias of `DateField`; the
shared binding component selects the calendar or timestamp control from the
accepted model kind.

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
