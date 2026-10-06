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

This private package has not been published to npm. Installing by package name
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

The supported operators, physical field types and nested AND/OR groups are
those of the scalar compiler. Both modes block unsupported conditions; strict
mode rejects incomplete rules, while compatibility mode can omit incomplete
rules when a complete sibling survives. A missing metadata driver follows the
compiler's `FALSE()` leaf semantics, so an OR sibling can still match. The
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
fields nor hydrates linked records. The browser starter supplies
`createFlatScalarFormRecordProjection` for flat one-page rules with current
noncomputed direct scalar dependencies. It evaluates field predicates against
the same complete accepted draft, removes condition-hidden IDs only from an
independent evaluation copy and recomputes after accepted edits. Hidden values
remain in the full native Save record. Sections (including retained nonblank
titles with disabled headers), active linked filters and referenced
linked/lookup/computed drivers remain unavailable. Native empty hiding and
readonly display settings do not prune this conditional-record copy. Broader
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
