# Optional Form drafts and controller

`@miniextensions/sdk/forms` helps a custom application retain native Form
values, assemble a save input and present validation/success state. It has no
DOM, React or other UI framework dependency and is safe to import on a server.
The core client does not import it. It uses the existing `forms.save` operation;
it does not add authentication, backend operations or an authorization layer.

This is a development preview. Install a built customer TGZ in your application:

```sh
npm install /path/to/miniextensions-sdk-0.1.0-alpha.0.tgz
```

The package is private and has not been published to npm. A source checkout has
no distributed `dist` modules: follow [source install → check → pack](../README.md#build-an-archive-from-source), then install the TGZ. Do not install a bare GitHub
URL or package name as a substitute. The
[runtime quickstart](runtime.md#packaged-form-quickstart) covers client setup,
published extension loading, passwords/login, query/context and visitor rules.
These helpers require a real `FormLoadedResult`; first handle any other loaded
screen or returned redirect. Use Node.js 22+ or your ES2022 browser bundler.

For subscribed stock or app-supplied text/select/linked rendering, see the
[headless field-binding usage guide](field-bindings.md). Renderer unmount preserves
the native draft; owner replacement retires actions and requests.

## Headless conditional linked-filter cascades

`createFormLinkedFilterModel` provides one network-free cascade per returned
outer Form linked field. It copies canonical configuration, query, authorized
metadata, pairs and snapshots. Ordered unique ID descriptors are supported;
unsupported configuration or metadata returns explicit unavailable diagnostics.
Unavailable presentation preserves otherwise unrestricted ordinary linked reads
and independent add/remove flags. Missing/null/empty primary values are empty;
an ID alone does not satisfy an empty-driver restriction. Readonly, visitor and
backend permission checks remain outside this presentation model.

Tickets bind the model instance, driver, generation and monotonic request.
Accepting a response consumes its ticket; overlapping same-search reads,
replayed/foreign tickets and disposed instances cannot accept stale data.
Malformed or duplicate response identities and mismatched prefills are rejected
atomically. Duplicate labels remain distinct record-ID choices. Search changes
retain selected pairs while clearing candidates and invalidating option paging;
a driver change also clears downstream selections/search/candidates. Neither
operation changes the native linked-record draft. Child reads use only the
immediately preceding selected pair's string value. There is no driver paging.

Hidden affects rendering only. Explicit initial prefill reads use current
metadata names and server-returned matching pairs; repeated configured URL
values return an unavailable read. Successful resolution (including a valid null
result) is not replayed, and user edits prevent later URL-prefill replay. Failed,
cancelled or invalid reads allow an explicit retry only; ordered loading stops
at the interruption and retains accepted upstream pairs. No retry is automatic. Retire the model on every visitor/session/token/loaded-Form transition.

This complete custom-renderer adapter uses a caller-owned monotonic scope
revision, including A → B → A. It recreates the existing linked-option loader
from each new snapshot and resets paging while retaining native selected IDs.
It composes a fresh filter map at deliberate Save; mutating a previously supplied
`createFormController` save-options object would not update its captured copy.
The selection model below supplies reads/paging only: the renderer separately
checks `canChange`, readonly and current ownership before deliberate native link
edits. No selection callback writes drafts automatically.

```ts
import type {
    AirtableValue,
    FormLoadedResult,
    MiniExtensionsClient,
    RuntimeQuery,
    RuntimeTableStates,
} from '@miniextensions/sdk';
import {
    createFormLinkedFilterModel,
    createFormSaveInput,
    describeLoadedFormFields,
    openLoadedFormDraft,
    FormDraftStore,
    type FormOwnerScope,
    type FormSaveOptions,
} from '@miniextensions/sdk/forms';
import {
    createFormLinkedRecordLoader,
    createSelectionModel,
} from '@miniextensions/sdk/ui';

export function createConfiguredCascadeAdapter(args: {
    client: MiniExtensionsClient;
    loaded: FormLoadedResult;
    fieldId: string;
    metadata: RuntimeTableStates;
    query: RuntimeQuery;
    store: FormDraftStore<AirtableValue>;
    getScope(): FormOwnerScope;
    getSaveOptions(): FormSaveOptions;
}) {
    const { client, fieldId, store } = args;
    const loaded = structuredClone(args.loaded);
    const query = structuredClone(args.query);
    const descriptor = describeLoadedFormFields(loaded).find(
        (field) => field.fieldId === fieldId
    );
    if (descriptor?.schema.fieldType !== 'multipleRecordLinks')
        throw new Error('Expected a returned linked field.');
    const schema = descriptor.schema;
    const scope = { ...args.getScope() };
    const session = client.getSession();
    const sessionKey = () =>
        JSON.stringify(
            Object.entries(client.getSession()).sort(([a], [b]) =>
                a.localeCompare(b)
            )
        );
    const capturedSession = sessionKey();
    let disposed = false;
    let saveAttempted = false;
    const handle = openLoadedFormDraft({ store, loaded });
    const owned = () => {
        const now = args.getScope();
        return (
            !disposed &&
            now.ownerId === scope.ownerId &&
            now.revision === scope.revision &&
            sessionKey() === capturedSession &&
            store.revision(handle) !== null
        );
    };
    const cascade = createFormLinkedFilterModel({ schema, query });
    cascade.initialize(args.metadata);
    const selection = createSelectionModel({ multiple: true });
    const resetOptions = () => {
        const native = store.read(handle, fieldId);
        if (
            !Array.isArray(native) ||
            !native.every((value) => typeof value === 'string')
        )
            throw new Error('Expected native linked IDs.');
        const loader = createFormLinkedRecordLoader({
            client,
            linkedTableId: schema.airtableField.config.options.linkedTableId,
            input: {
                extensionAccessToken: loaded.payload.extensionAccessToken,
                linkedRecordFieldId: fieldId,
                conditionalLinkedRecordFilteringValues: cascade.snapshot(),
            },
        });
        const generation = cascade.state().generation;
        selection.reset({
            multiple: true,
            value: native,
            selectedOptions: native.map((value) => ({ value, label: value })),
            readOnly: descriptor.readOnly,
            loadOptions: async (request) => {
                if (!owned() || generation !== cascade.state().generation)
                    throw new Error('Retired option read.');
                const result = await loader(request);
                if (!owned() || generation !== cascade.state().generation)
                    throw new Error('Retired option result.');
                return result;
            },
        });
    };
    resetOptions();
    async function readDriver(
        id: string,
        usePrefill = false,
        signal?: AbortSignal
    ) {
        if (!owned() || signal?.aborted) return { status: 'stale' as const };
        const plan = cascade.prepareRead(id, { usePrefill });
        if (plan.status !== 'ready') return plan;
        try {
            const response =
                await client.linkedRecords.listConditionalFilterPrimaryValues(
                    {
                        extensionAccessToken:
                            loaded.payload.extensionAccessToken,
                        ...plan.input,
                    },
                    { signal, session }
                );
            if (!owned() || signal?.aborted)
                return { status: 'stale' as const };
            const accepted = cascade.accept(plan.ticket, response);
            if (accepted.status === 'accepted' && accepted.changed)
                resetOptions();
            return accepted;
        } catch (error) {
            if (owned() && !signal?.aborted && cascade.isCurrent(plan.ticket))
                throw error;
            return { status: 'stale' as const };
        } finally {
            cascade.discard(plan.ticket);
        }
    }
    return {
        state: () => cascade.state(),
        snapshot: () => cascade.snapshot(),
        selection,
        canChange: (adding: boolean) =>
            owned() && !descriptor.readOnly && cascade.canChange(adding),
        readDriver,
        // Call explicitly again after interruption; successful/null outcomes are skipped.
        async loadPrefills(signal?: AbortSignal) {
            for (const filter of cascade.state().filters) {
                if (!owned()) return;
                if (query[`prefill_${filter.name}`] != null) {
                    const accepted = await readDriver(filter.id, true, signal);
                    if (
                        accepted.status !== 'accepted' &&
                        accepted.status !== 'resolved'
                    )
                        return accepted;
                }
            }
        },
        searchDriver(id: string, value: string) {
            if (!owned()) return false;
            const changed = cascade.search(id, value);
            if (changed) resetOptions();
            return changed;
        },
        chooseDriver(id: string, recordId: string | null) {
            if (!owned()) return false;
            const generation = cascade.state().generation;
            const accepted = cascade.choose(id, recordId);
            if (generation !== cascade.state().generation) resetOptions();
            return accepted;
        },
        async saveOnce(signal?: AbortSignal) {
            if (!owned() || saveAttempted) return null;
            const draft = store.snapshot(handle);
            if (!draft) return null;
            const revision = store.revision(handle);
            const generation = cascade.state().generation;
            const options = args.getSaveOptions();
            const input = createFormSaveInput({
                loaded,
                draft,
                options: {
                    ...options,
                    conditionalLinkedRecordFieldIdsToFilteringValues: {
                        ...options.conditionalLinkedRecordFieldIdsToFilteringValues,
                        [fieldId]: cascade.snapshot(),
                    },
                },
            });
            if (
                !owned() ||
                store.revision(handle) !== revision ||
                cascade.state().generation !== generation
            )
                return null;
            saveAttempted = true;
            const result = await client.forms.save(input, { signal, session });
            return owned() ? result : null;
        },
        dispose() {
            disposed = true;
            cascade.dispose();
            selection.destroy();
        },
    };
}
```

Rendering, labels, AbortControllers, status/subscriptions, fresh metadata reads,
option paging and native draft ownership remain adapter-owned. The recipe's
single Save attempt has no mutation retry, including unknown outcomes. Backend
validation and uncertainty recovery still require the existing application
workflow. This does not provide Portal-child URL-prefill propagation, name-based
descriptor resolution, a general dependency graph or additional routes.

## Attachment presentation and file admission

`getFormAttachmentPolicy` and `checkFormAttachmentFiles` are opt-in, pure
helpers for a returned Form attachment field and its complete current native
draft value. Existing controls and `client.attachments.uploadFile` are unchanged.
They perform no requests, uploads, folder/readability checks or byte inspection.
The backend remains authoritative at upload and Save.

Effective writable add-only fields classify persisted rows using the loaded
`persistedAddOnlyAttachmentValuesByFieldId` map and original native URLs, before
any presentation URL rewriting. A non-null ID alone does not identify a stored
value: prefills can also carry IDs. Remounting never turns the draft into a new
persisted baseline. Recompute from a fresh loaded result after saving/reloading.
Rows retain every attachment's metadata, duplicates, order and native index.

When the whole persisted map is absent, effective writable add-only returns
`unavailable`. This intentionally declines legitimate legacy/rolling-deploy
payloads rather than guessing provenance. It is not silently substituted into
existing controls. A present map without this field means an empty baseline.
A present field entry must be an attachment array; nullish or malformed entries throw rather than
unlocking stored rows.
Readonly or non-add-only fields do not require the map.

`visible` is presentation only. Configured hiding and
`hidePersistedAddOnlyValues: true` never delete values, alter capacity or prune
Save data. Persisted add-only rows cannot be removed; unsaved rows can. Readonly
and computed fields cannot add/remove. `openAllowed` and `downloadAllowed` are
independent configuration permissions, not promises of URL access, rendering,
download capability or confidential file delivery. Your renderer still owns
format support and safe links.

The default producer mode is `upload-file`; URL, signature and annotation modes
report `unsupported-mode` for this ordinary-file helper. Missing/empty type
restrictions are unrestricted. Restricted MIME values are compared after case,
whitespace and parameter normalization; document groups accept PDF/Word and
compressed groups accept exact ZIP MIME essences. Empty MIME is permitted only
without restrictions; it does not prove that a selection is readable or a file.

Count includes the full native array, even invisible rows, plus the next valid
batch. A valid batch exceeding the cap is rejected atomically, retaining
per-file errors; even an empty valid batch reports count overflow when the
existing value is already over the cap. Count fractions floor; zero, negative
and non-finite caps become zero. Missing count is unrestricted. Size uses MiB
(`1048576` bytes): positive fractions work, missing/zero is unrestricted, and
negative/non-finite values become a zero-byte cap. Exact size boundaries pass.
The structural file descriptor requires a string `type` and finite nonnegative
`size`; these are declared metadata, not evidence about uploaded bytes.

This complete recipe uses the existing store's handle identity and revision
guard. Supply `isCurrent` from your actual visitor/loaded-Form owner. Recompute
before each deliberate action; a row index from an older render is not enough.

```ts
import type { AirtableValue, FormLoadedResult } from '@miniextensions/sdk';
import {
    getFormAttachmentPolicy,
    checkFormAttachmentFiles,
    FormDraftStore,
    type FormDraftHandle,
    type AttachmentFileDescriptor,
} from '@miniextensions/sdk/forms';

export function createFormAttachmentActions(args: {
    loaded: FormLoadedResult;
    store: FormDraftStore<AirtableValue>;
    handle: FormDraftHandle;
    fieldId: string;
    isCurrent: () => boolean;
}) {
    const { loaded, store, handle, fieldId } = args;
    function view() {
        if (!args.isCurrent()) return null;
        const snapshot = store.snapshot(handle);
        const revision = store.revision(handle);
        if (snapshot === null || revision === null) return null;
        return {
            revision,
            policy: getFormAttachmentPolicy({
                loaded,
                fieldId,
                value: snapshot.data[fieldId],
                hidePersistedAddOnlyValues: true,
            }),
        };
    }
    function remove(renderedRevision: number, nativeIndex: number): boolean {
        const fresh = view();
        if (
            fresh === null ||
            fresh.revision !== renderedRevision ||
            fresh.policy.status !== 'ready' ||
            !Number.isInteger(nativeIndex) ||
            nativeIndex < 0 ||
            fresh.policy.rows[nativeIndex]?.removeAllowed !== true
        )
            return false;
        const value = store.read(handle, fieldId);
        if (
            !Array.isArray(value) ||
            !args.isCurrent() ||
            store.revision(handle) !== renderedRevision
        )
            return false;
        return store.write(
            handle,
            fieldId,
            value.filter((_, index) => index !== nativeIndex)
        );
    }
    function checkFiles(files: readonly AttachmentFileDescriptor[]) {
        if (!args.isCurrent()) return null;
        const snapshot = store.snapshot(handle);
        if (snapshot === null) return null;
        return checkFormAttachmentFiles({
            loaded,
            fieldId,
            value: snapshot.data[fieldId],
            files,
        });
    }
    return { view, remove, checkFiles };
}
```

Render visible rows and retain `view.revision` with their `nativeIndex`. Remove
only through the fresh checked action. Save through `createFormSaveInput` with
the complete store snapshot; do not serialize the visible rows.

For a deliberate upload, check the freshly selected descriptors, then call the
existing `client.attachments.uploadFile` with the current Form token and an
owned `AbortController`. After awaiting, recheck the visitor/handle and current
capacity before appending to the complete native array. Pending cancellation
always remains possible, even if readonly, capacity or ownership changes; never
gate `controller.abort()` on this policy. Cancellation cannot undo bytes already
uploaded. The helper neither cancels nor cleans remote objects. Do not retry
mutations or replay uncertain uploads automatically. No mutation occurs from
describing, checking files, cancelling a local selection or rendering a row.

## Compile scalar runtime conditions

`compileRuntimeConditions` translates the existing `RuntimeConditionsDefinition`
AST into a formula for the bounded scalar subset below. It accepts deeply
readonly definitions and metadata and never changes them. Pass the current
returned Airtable fields, an explicit `invalidConditionMode` and, optionally,
`fieldReferenceMode: 'name'`. The default reference mode preserves the saved
tagged field ID/name; name mode uses the first matching current field's name.
Metadata lookup takes the first exact ID/name match. A renamed saved-name
reference is missing even if an old value remains in a record.

```ts
import type {
    RuntimeAirtableField,
    RuntimeConditionsDefinition,
} from '@miniextensions/sdk';
import { compileRuntimeConditions } from '@miniextensions/sdk/forms';
import {
    FormulaRunner,
    type FormulaRunOutcome,
    type InterpreterContext,
} from '@miniextensions/sdk/formulas';

// Synthetic field IDs: replace them with IDs from the current returned metadata.
export const exampleConditions: RuntimeConditionsDefinition = {
    logicalOperator: 'and',
    conditions: [
        {
            id: 'title-ready',
            type: 'singleCondition',
            setting: {
                type: 'contains',
                fieldType: 'singleLineText',
                idOrName: { type: 'id', id: 'fld_title' },
                value: 'ready',
            },
        },
        {
            id: 'quantity-or-approved',
            type: 'groupCondition',
            logicalOperator: 'or',
            conditions: [
                {
                    id: 'quantity-at-least-two',
                    type: 'singleCondition',
                    setting: {
                        type: 'greaterThanOrEqualsTo',
                        fieldType: 'number',
                        idOrName: { type: 'id', id: 'fld_quantity' },
                        value: 2,
                    },
                },
                {
                    id: 'approved',
                    type: 'singleCondition',
                    setting: {
                        type: 'is',
                        fieldType: 'checkbox',
                        idOrName: { type: 'id', id: 'fld_approved' },
                        value: true,
                    },
                },
            ],
        },
    ],
};

export function compileScalarConditions(
    conditions: RuntimeConditionsDefinition | null,
    airtableFields: readonly RuntimeAirtableField[]
) {
    return compileRuntimeConditions({
        conditions,
        airtableFields,
        invalidConditionMode: 'strict',
        fieldReferenceMode: 'saved',
    });
}

// This is the application's presentation/error policy, not SDK authorization.
export type ScalarVisibility =
    | { type: 'visible' | 'hidden' }
    | {
          type: 'blocked';
          code:
              | 'unsupported'
              | 'invalid'
              | 'evaluation-exception'
              | Extract<FormulaRunOutcome, { type: 'error' }>['code'];
      };

export function scalarVisibility(
    airtableFields: readonly RuntimeAirtableField[],
    context: InterpreterContext,
    conditions: RuntimeConditionsDefinition | null = exampleConditions
): ScalarVisibility {
    const compiled = compileScalarConditions(conditions, airtableFields);
    if (compiled.type !== 'compiled')
        return { type: 'blocked', code: compiled.type };
    try {
        const runner = new FormulaRunner(compiled.formula);
        runner.context = { ...context, airtableFields: [...airtableFields] };
        const result = runner.runWithOutcome();
        if (result.type === 'error')
            return { type: 'blocked', code: result.code };
        return {
            type: FormulaRunner.isFalsyValue(result.value)
                ? 'hidden'
                : 'visible',
        };
    } catch {
        return { type: 'blocked', code: 'evaluation-exception' };
    }
}
```

The example matches a title containing `ready` and either quantity at least two
or a checked approval. Supply the current fields and the native record context
from the [formula context recipe](formulas.md#loaded-form-and-portal-metadata)
to `scalarVisibility(fields, context)`. Rebuild both after accepted edits or a
fresh load, and check the application's current visitor/revision before applying
the decision. For a Portal row, use that row's record and table metadata; the
formula guide's logged-in Portal context describes the parent user record.

Only a successful typed value reaches `isFalsyValue`. Unsupported/invalid
definitions, recognized formula faults and thrown evaluation exceptions all
block this example's presentation. Compiled warnings retain the strict compiler
semantics below; an application may choose a stricter warning policy. Use only
metadata and native values actually supplied to the current caller. A local
presentation decision grants no read/write permissions and does not remove
record values or change save authority.

The result is `{ type: 'compiled', formula, diagnostics }`, or
`{ type: 'unsupported' | 'invalid', diagnostics }` with no formula. Callers must
handle both blocked outcomes; never substitute a truthy predicate. Diagnostics
contain finite codes, severity, zero-based nested condition-index paths and an
optional editor condition ID. They do not copy operands, record values,
formulas or exception text. If unsupported and invalid rules coexist, the
result is `unsupported` and retains the collected diagnostics.

The supported boundary is **99 operator/type pairs**, **20 operators** and
**14 direct physical field types**. Let T7 mean `singleLineText`, `email`,
`url`, `multilineText`, `phoneNumber`, `barcode`, `richText`; T6 excludes
`richText`; N4 means `number`, `percent`, `currency`, `rating`.

| Scalar operators                                                                                | Direct types      | Pairs |
| ----------------------------------------------------------------------------------------------- | ----------------- | ----: |
| `matchesRegex`, `contains`, `doesNotContain`, `isOfLength`                                      | T7                |    28 |
| `is`                                                                                            | T6 and `checkbox` |     7 |
| `isNot`                                                                                         | T6                |     6 |
| `isEmpty`, `isNotEmpty`                                                                         | T7 and N4         |    22 |
| `equals`, `notEquals`, `greaterThan`, `lessThan`, `greaterThanOrEqualsTo`, `lessThanOrEqualsTo` | N4                |    24 |

Nested groups support the existing `and`/`or` AST. There is no `not` group;
negative operators generate the canonical `NOT(...)` formula where needed.
Every saved operator/type pair and matching current physical operator/type
pair must be in the scalar table or select list below. Dates, links,
attachments, collaborators,
computed formula/lookup/rollup fields and other richer variants block the whole
definition, including in compatibility mode. The helper does not unwrap a
computed result type or partially compile richer rules.

Direct select compilation adds exactly twelve pairs: single-select `is`, `isNot`,
`isAnyOf`, `isNoneOf`, `isEmpty`, `isNotEmpty`; multi-select `hasAnyOf`,
`hasAllOf`, `hasNoneOf`, `isExactly`, `isEmpty`, `isNotEmpty`.
Single-select `matchesRegex` remains unsupported. Select operands are exact
canonical **choice IDs**, not native answer names or display labels. Any saved
or current select type requires exact physical-type equality; selects cannot
be silently reinterpreted as text or as the other select family.

Nonempty array operands must be dense arrays of nonempty strings. Choices must
have unambiguous nonempty IDs and names. IDs resolve to current names, retaining
insertion-order deduplication. Unknown single equality choices compile to
`FALSE()`. Any/none operators retain known choices from mixed operands;
multi-select all/exact returns `FALSE()` if any choice is unknown. All-unknown
arrays return `FALSE()`. Equality requires one choice-ID string: arrays,
including `[]`, are invalid in both strict and compatibility modes. Null or
empty-string equality operands and empty array-operator operands are incomplete;
use the dedicated emptiness operators. Native multi-select serialization, escaped regex boundaries
and exact serialized length are preserved. Unsafe literal/regex round trips
fail closed rather than approximating set membership or splitting commas.

Form binding visibility and page advanced validation additionally admit the six
single-select predicates above for exact-ID direct noncomputed drivers. They
inspect the original AST and loaded metadata, even when compilation reduces a
predicate to constant `FALSE()`. Public scalar flat/section projection helpers,
prepared Review, select-driven conditional option availability and the shipped
Portal editor retain their existing boundaries. Multi-select and richer Form
drivers remain unsupported. Richer saved Portal
criteria must remain intact until explicit replacement or accepted server
cleanup; partial known-choice compilation is not permission to drop AST values.

Canonical scalar semantics are retained when both pairs are supported; exact
saved/current type equality is not required. Numeric comparisons divide the
operand by 100 when the current field is `percent`. Emptiness uses the saved
`rating` setting's zero comparison; other supported saved types use
`LEN('' & {field})`. Checkbox equality uses 0/1; case-insensitive substring
rules use `FIND`/`LOWER`. This is precedence for compilation, not evidence that
metadata is fresh or that a changed field grants an action.

Null or a valid top-level empty definition compiles to `1`. A supported missing
driver compiles to a `FALSE()` leaf with a warning; an OR sibling can still
match, even in strict mode. Strict incomplete operands and empty nested groups
return `invalid`, rather than the native converter's whole-definition
`FALSE()`. Explicit compatibility mode can omit these with warnings when a
complete sibling survives. A nonempty group whose entire contents are omitted
is always `invalid`; it never becomes `AND()`, `OR()` or `1`.

The helper preserves canonical quote/closing-brace escaping, then checks
literal and reference round trips with the existing lexer/parser without
evaluation. Ambiguous backslash sequences that would change saved bytes,
invalid regex patterns, nonfinite numeric operands, malformed/cyclic input and
unparseable formulas return `invalid`. These static checks occur before a
missing driver can hide an invalid operand: that conservative boundary differs
from native converter short-circuiting. Regex validation checks syntax only,
not execution cost. Compatibility omits incomplete input only; it does not
omit malformed operands, escape hazards or unsupported rules.

`compiled` means a supported, parseable formula, not a matched or error-free
condition. Evaluation still requires the explicit native field/record context
described in the [formula guide](formulas.md). Compilation performs no formula
execution, record read or request and grants no backend authentication,
validation, save or visibility authority. Your application still owns field,
section/page/review presentation, current owner/revision checks and any
evaluation/error policy. No starter conditional workflow is enabled by this
helper.

## One-page conditional field visibility

`evaluateFormFieldVisibility` evaluates one returned field's conditions and
supported native empty hiding. `composeFormFieldVisibility` adds the ordered
frontend section
rules and returns stable field-ID keyed `visible`, `hidden` or `blocked`
results. Both require current physical metadata, the complete accepted native
draft, explicit create/edit and runtime/preview modes, and an explicit compiler
policy. They reuse the scalar compiler and typed formula outcome above.

```ts
import type { AirtableValue, FormLoadedResult } from '@miniextensions/sdk';
import {
    composeFormFieldVisibility,
    type FormDraftSnapshot,
} from '@miniextensions/sdk/forms';

export function onePageVisibility(
    loaded: FormLoadedResult,
    draft: FormDraftSnapshot<AirtableValue>
) {
    return composeFormFieldVisibility({
        fieldIds: loaded.payload.fieldIdsInForm,
        fieldIdsToSchemas: loaded.payload.fieldIdsToSchemas,
        airtableFields: Object.values(loaded.payload.fieldIdsToSchemas).map(
            (schema) => schema.airtableField
        ),
        data: draft.data,
        formRecordType: loaded.payload.formRecord.type,
        evaluationMode: 'runtime',
        invalidConditionMode: 'strict',
    });
}
```

Call this after each accepted draft edit and fresh metadata load. Every
predicate reads the same complete draft, including currently hidden values;
readonly fields still evaluate their conditions. Never progressively remove
hidden values before evaluating the next field. The helper makes no requests
and does not write data, dirty IDs, local choices or child context. A native
checkbox remains a boolean, percentages remain fractions, and barcode drivers
use native objects with a `text` property; malformed driver values block
evaluation. Linked and computed drivers remain unsupported, including a
computed field whose reported physical type looks scalar.
ID/name aliases that could select a different field or read another native
ID-keyed value return `ambiguous-reference`; the helper does not guess.

A nonblank `headerSectionTitle` starts a frontend section unless
`enableSectionHeader` is explicitly false. A missing flag retains legacy
title-only sections. A hidden lead with `applyFieldConditionsToSection: true`
hides its followers until the next header. A blocked lead propagates a blocked
outcome; other followers evaluate independently. A next header always resets
the previous section, even if it retains the propagation flag without a
predicate. This frontend compositor does not produce the backend's filtered
record projection for conditional select options or other consumers.

`createScalarFormRecordProjection` supplies a detached deep copy for
conditional evaluation with supported direct scalar predicates and canonical
ordered sections. Pass `fieldIdsInForm` verbatim: the input cannot prove order
completeness. Duplicate IDs, nonstrings and sparse entries block. Duplicate
physical IDs, contradictory schema/physical identity, type, name or computed
status, and malformed section metadata return `invalid-metadata`.

A nonblank `headerSectionTitle` starts a projection section even when
`enableSectionHeader: false`; displayed grouping follows the frontend rules
above. At each titled header, reset the inherited predicate, then inherit that
header's non-null conditions only when `applyFieldConditionsToSection: true`.
Untitled propagation flags do not start or replace inheritance. Section and own
field predicates combine with AND. Every predicate reads the same complete
native data, including hidden drivers; collect decisions before removing
condition-hidden IDs from the copied record. Self, forward and mutual field
references use that snapshot, without a fixed point or dependency graph.
Cyclic condition definitions remain invalid. Invalid or unsupported own
predicates block even beneath a hidden section.

Use the copied record for configured choice evaluation's second phase; never
feed it back into visibility or Save. Readonly, empty-hidden and unrendered
native values are not independently pruned. The result is writable and
detached, not runtime-frozen. Active linked filtering and referenced
linked/lookup/computed drivers remain unsupported. Section plus active edit
empty hiding still blocks presentation and the starter Save gate.

The existing `createFlatScalarFormRecordProjection` retains its types, blocked
codes and behavior, including scanning schemas outside the supplied order and
rejecting untitled `applyFieldConditionsToSection: true`. The browser choice
adapter uses `createScalarFormRecordProjection` for supported scalar conditional
choices. Form field bindings reuse the shared section engine internally with
the bounded single-select Form driver policy. Inactive-page drivers remain in the
evaluation record; conditionally hidden drivers are removed only from that
detached projection. Eligibility changes never remove native selected values.
One-page Review retains its separate page-mode and supported-driver checks.
Review accepts scalar/select answers and conservative linked/attachment summaries;
Review does not admit select condition drivers or select edit-empty-hiding types.
The shipped Review recipe maps native names through complete select policy
metadata, preserves selected-but-ineligible values and ordered duplicates,
and adds an explicit unavailable marker to unknown names. Linked labels require previously accepted field-specific presentation; attachment
filenames require explicit visibility and the original attachment policy. Review
performs no hydration, upload or attachment navigation. See the browser starter's Review section for the
presentation-only boundary; complete native data and dirty IDs still go to Save.

Canonical select-label comparison fixtures are pinned to monorepo `58f73d5`.
Maintainers may explicitly supply that clean checkout to
`node scripts/generate-review-select-fixtures.mjs /path/to/checkout`;
ordinary package checks use the checked-in provenance fixtures without private
repository access. The starter's unknown-name ` (unavailable)` marker is
additional wording, not canonical presentation parity.

```ts
import type { AirtableValue, FormLoadedResult } from '@miniextensions/sdk';
import { createScalarFormRecordProjection } from '@miniextensions/sdk/forms';

export function sectionProjection(
    loaded: FormLoadedResult,
    nativeData: Readonly<Record<string, AirtableValue>>
) {
    const state = loaded.payload.publicFields.state;
    const mode =
        state != null &&
        typeof state === 'object' &&
        'multiPageFormMode' in state
            ? state.multiPageFormMode
            : undefined;
    if (mode != null && mode !== 'one-page' && mode !== 'multi-page')
        return null;
    return createScalarFormRecordProjection({
        fieldIds: loaded.payload.fieldIdsInForm,
        fieldIdsToSchemas: loaded.payload.fieldIdsToSchemas,
        airtableFields: Object.values(loaded.payload.fieldIdsToSchemas).map(
            (schema) => schema.airtableField
        ),
        data: nativeData,
        recordId:
            loaded.payload.formRecord.type === 'edit'
                ? loaded.payload.formRecord.recordId
                : '',
        invalidConditionMode: 'strict',
    });
}
```

Recompute after each accepted edit and metadata replacement. Keep the full
native snapshot and dirty IDs for a later deliberate `createFormSaveInput`.
Apply current owner/revision checks before using a result. A blocked projection
is unavailable conditional presentation, not new write authority or an
automatic mutation. The starter choice adapter additionally checks configured,
noncomputed scalar option drivers before its existing projected-record second
phase. Backend validation and permissions remain authoritative.

Maintainer comparison fixtures execute the canonical helper at its pinned
revision. In the SDK source checkout run
`node scripts/generate-section-projection-fixtures.mjs /path/to/explicit/canonical-checkout`.
The generator requires that exact clean revision and writes source-bound local
test fixtures; ordinary package CI needs no private checkout or runtime network.

`blocked` carries a finite code and safe compiler code/severity/index-path
diagnostics, excluding editor IDs, formulas, operands, values and exception
text. Supported missing references retain the compiler's false/warning
semantics. Native error objects, nonfinite results and evaluation exceptions
remain explicit errors; literal `#ERROR!` strings remain ordinary data.

Explicit `hideFieldIfEmpty: true` also hides empty edit-mode fields in the flat
direct scalar subset: `singleLineText`, `email`, `url`, `multilineText`,
`phoneNumber`, `richText`, `number`, `percent`, `currency`, `rating`, `checkbox`
and `barcode`. The returned schema and physical type must match and the field
must be noncomputed; readonly fields participate. Canonical link/lookup
filtering preserves these direct scalar values, so empty hiding reads the
accepted native value without deriving it from frontend visibility or pruning
the draft. Missing/null values and whitespace strings are empty, as are
checkbox `false`, rating `0` and a native barcode object with nullish or blank
`text`. Ordinary numeric, currency and percent `0` remain populated.
Nonblank malformed scalar values, generic arrays/objects and nonfinite
numbers block rather than being coerced or treated as empty.

Empty hiding precedes the preview condition bypass. A populated supported
field still evaluates its condition in runtime mode. The ordinary flag is
inactive in create mode and when absent or false. The bounded empty-hiding
adapter does not cover sections, linked, lookup, computed or other richer
targets; the frontend compositor blocks active edit empty hiding in any
section context, including a retained nonblank disabled section title.
Lookup fields hide empty values by default in both modes and therefore block
unless that flag is explicitly false. Conditional-only frontend sections
retain the behavior described above. Multi-page layout remains application-owned;
use [`createFormPageOwner`](#bounded-multipage-ownership) for bounded navigation.
Richer native filtered-value adapters remain application-owned.

The shipped browser starter applies these results to field presentation after
accepted edits. It retains controls and native drafts, validates only visible
controls at Save, and presents an explicit unavailable-field message for
blocked outcomes. The visitor can repair an editable driver; Save remains
blocked while visibility is unavailable. Hiding never clears accepted values
or prunes `createFormSaveInput`: the existing server still owns validation and
write authorization. A presentation result grants no permission.

## Preserve the full native draft

Create one `FormDraftStore<AirtableValue>` per visitor. `openLoadedFormDraft`
copies the entire loaded record data, including hidden prefills, and unions
the loaded dirty IDs with URL-prefilled IDs. Subsequent writes add field IDs
without replacing that baseline. Data stays in memory; the store does not use
local storage, browser cookies, a server or a global visitor cache.

This recipe opens a loaded Form and prepares typed text, number and checkbox
edits. Pass the actual field IDs from that published Form. It checks returned
descriptors and read-only/computed hints before writing. The pure store itself
does not validate field permissions or value schemas.

```ts
import {
    AirtableFieldType,
    type AirtableValue,
    type FormLoadedResult,
    type MiniExtensionsClient,
    type RuntimeSession,
} from '@miniextensions/sdk';
import {
    FormDraftStore,
    createFormSaveInput,
    describeLoadedFormFields,
    formValidationMessages,
    normalizeFormSaveResult,
    openLoadedFormDraft,
    type FormDraftHandle,
    type FormSaveOptions,
} from '@miniextensions/sdk/forms';

export function openTypedFormDraft(
    loaded: FormLoadedResult,
    fieldIds: { title: string; quantity: string; approved: string },
    edits: { title: string; quantity: number; approved: boolean }
) {
    const store = new FormDraftStore<AirtableValue>();
    const handle = openLoadedFormDraft({ store, loaded });
    const fields = describeLoadedFormFields(loaded);
    const values: Record<string, AirtableValue> = {
        [fieldIds.title]: edits.title,
        [fieldIds.quantity]: edits.quantity,
        [fieldIds.approved]: edits.approved,
    };
    const expected = [
        [fieldIds.title, AirtableFieldType.SINGLE_LINE_TEXT],
        [fieldIds.quantity, AirtableFieldType.NUMBER],
        [fieldIds.approved, AirtableFieldType.CHECKBOX],
    ] as const;
    for (const [fieldId, type] of expected) {
        const field = fields.find((entry) => entry.fieldId === fieldId);
        if (field?.fieldType !== type || field.readOnly) {
            throw new Error(
                `Choose a returned editable ${type} field: ${fieldId}`
            );
        }
    }
    for (const [fieldId, value] of Object.entries(values)) {
        if (!store.write(handle, fieldId, value))
            throw new Error('Draft expired');
    }
    return {
        store,
        handle,
        fields,
        initialValidation: formValidationMessages(
            loaded.payload.formErrors,
            [],
            loaded
        ),
    };
}

// Invoke only from the visitor's deliberate Save action after checking scope.
// Use the session captured for that same visitor/load, never a new visitor's.
export async function savePureFormDraftOnce(
    client: MiniExtensionsClient,
    loaded: FormLoadedResult,
    store: FormDraftStore<AirtableValue>,
    handle: FormDraftHandle,
    saveOptions: FormSaveOptions,
    session: Readonly<RuntimeSession>,
    signal: AbortSignal
) {
    signal.throwIfAborted();
    const draft = store.snapshot(handle);
    const submittedRevision = store.revision(handle);
    if (draft == null || submittedRevision == null)
        throw new Error('Draft expired');
    const input = createFormSaveInput({ loaded, draft, options: saveOptions });
    const response = await client.forms.save(input, { session, signal });
    signal.throwIfAborted();
    const result = normalizeFormSaveResult(response, loaded);
    if (result.type === 'error') {
        for (const error of result.validationErrors) {
            console.error(error.fieldTitle, error.errorMessage);
        }
        if (result.concurrentEditErrorMessage != null) {
            console.error(result.concurrentEditErrorMessage);
        }
        return result; // Keep the draft so the visitor can correct it.
    }
    // If someone wrote while the request ran, those edits remain dirty.
    const noNewerEdits = store.markSaved(handle, submittedRevision);
    console.info('Saved record:', result.raw.record.id, { noNewerEdits });
    for (const warning of result.postSubmissionWarnings)
        console.warn(warning.type);
    for (const notification of result.postSubmissionNotifications)
        console.info(notification.type);
    return result;
}
```

Supply complete `FormSaveOptions`: `captchaVal`, `isComputeMode`, `searchQuery`,
`context` and `conditionalLinkedRecordFieldIdsToFilteringValues`, plus any
configured device fingerprint/location. Use `isComputeMode: false` for a
normal submission. Compute mode can write; it is not a harmless local formula
preview. Use the existing `/formulas` subpath for local evaluation.

`createFormSaveInput` preserves the loaded create/edit discriminator, record
and table IDs, token and baseline data. It merges the snapshot's native values
and unions loaded dirty, URL-prefill and snapshot dirty IDs. It copies the
result and does not modify the loaded result or store. Text remains a string,
numbers remain numbers, checkboxes remain booleans, selects use choice names
and linked fields use arrays of record IDs. It does not turn every value into
text or discard fields that your renderer does not display.

The pure save recipe leaves single-flight control, owner/session checks,
response ownership and recovery to your application. After success, obtain a
fresh loaded Form and discard the completed handle before reopening its
baseline. After a transport error or a dispatched cancellation, reconcile the
server outcome and obtain a fresh load before deciding whether to submit
again. Do not call it blindly a second time. Use the controller below for
these presentation guards.

The store scopes a draft by actual extension ID, create/edit record ID and
optional parent Portal/record/relationship IDs. Reopening the same live scope
retains its draft. `discard(handle)` invalidates that handle; `clear()`
invalidates all handles. Store handles are object identities: an expired handle
cannot write into a new draft with the same scope string. `addChoice` retains
local choice metadata only; it does not call `forms.addSelectOption` or save a
record. Never share a store across visitors or connections.

## Headless controller with explicit Save

`createFormController` binds one loaded Form, complete save options and the
current visitor/context scope. It snapshots the client session and sends that
request-only session when saving. `getScope` must return an application-owned
nonempty `ownerId` and a nonnegative integer `revision`.

The next recipe loads a standalone Form and wires native text, number and
checkbox inputs. Pass real DOM elements from your app and actual field IDs.
Only the button invokes Save. The subscription receives initial inline errors,
then validation, success warnings/notifications or transport/cancel state. All
record and error text uses safe text APIs.

```ts
import {
    AirtableFieldType,
    type LoadExtensionInput,
    type MiniExtensionsClient,
} from '@miniextensions/sdk';
import {
    createFormController,
    type FormOwnerScope,
    type FormSaveOptions,
} from '@miniextensions/sdk/forms';

const formEditorOwners = new WeakMap<HTMLElement, symbol>();

export async function attachStandaloneFormEditor(options: {
    client: MiniExtensionsClient;
    input: Extract<LoadExtensionInput, { shareId: string }>;
    saveOptions: FormSaveOptions;
    getScope: () => FormOwnerScope;
    signal: AbortSignal;
    fieldIds: { title: string; quantity: string; approved: string };
    inputs: {
        title: HTMLInputElement;
        quantity: HTMLInputElement;
        approved: HTMLInputElement;
    };
    inlineErrors: {
        title: HTMLElement;
        quantity: HTMLElement;
        approved: HTMLElement;
    };
    saveButton: HTMLButtonElement;
    message: HTMLElement;
}) {
    const inputs = { ...options.inputs };
    const inlineErrors = { ...options.inlineErrors };
    const fieldIds = { ...options.fieldIds };
    const saveButton = options.saveButton;
    const message = options.message;
    const nodes = [
        ...Object.values(inputs),
        ...Object.values(inlineErrors),
        saveButton,
        message,
    ];
    if (new Set(nodes).size !== nodes.length) {
        throw new Error(
            'Supply distinct input, error, Save and message elements.'
        );
    }
    const owner = Symbol('Form editor');
    const scopeAtLoad = { ...options.getScope() };
    const session = { ...options.client.getSession() };
    options.signal.throwIfAborted();
    const loaded = await options.client.loadExtension(options.input, {
        session,
        signal: options.signal,
    });
    options.signal.throwIfAborted();
    const scopeNow = options.getScope();
    const sessionNow = options.client.getSession();
    options.signal.throwIfAborted();
    if (
        scopeNow.ownerId !== scopeAtLoad.ownerId ||
        scopeNow.revision !== scopeAtLoad.revision ||
        Object.keys(sessionNow).length !== Object.keys(session).length ||
        !Object.keys(session).every(
            (key) =>
                Object.hasOwn(sessionNow, key) &&
                sessionNow[key] === session[key]
        )
    ) {
        throw new Error(
            'Scope changed during load; load the new visitor/context.'
        );
    }
    if (loaded.extensionScreen !== 'form_loaded') {
        throw new Error('Handle the returned login/password/redirect first.');
    }
    const controller = createFormController({
        client: options.client,
        loaded,
        saveOptions: options.saveOptions,
        getScope: options.getScope,
    });
    let destroyed = false;
    const ownsView = (): boolean => {
        if (
            destroyed ||
            options.signal.aborted ||
            !nodes.every((node) => formEditorOwners.get(node) === owner)
        )
            return false;
        try {
            const scope = options.getScope();
            const currentSession = options.client.getSession();
            return (
                scope.ownerId === scopeAtLoad.ownerId &&
                scope.revision === scopeAtLoad.revision &&
                Object.keys(currentSession).length ===
                    Object.keys(session).length &&
                Object.keys(session).every(
                    (key) =>
                        Object.hasOwn(currentSession, key) &&
                        currentSession[key] === session[key]
                ) &&
                !destroyed &&
                !options.signal.aborted &&
                nodes.every((node) => formEditorOwners.get(node) === owner)
            );
        } catch {
            return false;
        }
    };
    const expected = {
        title: AirtableFieldType.SINGLE_LINE_TEXT,
        quantity: AirtableFieldType.NUMBER,
        approved: AirtableFieldType.CHECKBOX,
    } as const;
    const keys = ['title', 'quantity', 'approved'] as const;
    const initial = controller.getState();
    for (const key of keys) {
        const field = initial.fields.find(
            (entry) => entry.fieldId === fieldIds[key]
        );
        if (field?.fieldType !== expected[key]) {
            controller.destroy();
            throw new Error(`Choose a returned ${expected[key]} field.`);
        }
    }
    try {
        options.signal.throwIfAborted();
    } catch (cause) {
        controller.destroy();
        throw cause;
    }
    // Claim only after the loaded schemas validate. A replacement gets its
    // own symbol; old listeners and cleanup cannot act on its shared nodes.
    for (const node of nodes) formEditorOwners.set(node, owner);
    inputs.title.type = 'text';
    inputs.quantity.type = 'number';
    if (!inputs.quantity.hasAttribute('step')) inputs.quantity.step = 'any';
    inputs.approved.type = 'checkbox';
    saveButton.type = 'button';

    const onTitle = (): void => {
        if (!ownsView()) return;
        controller.write(fieldIds.title, inputs.title.value);
    };
    const onQuantity = () => {
        if (!ownsView()) return;
        const input = inputs.quantity;
        if (input.validity.badInput) return;
        if (input.value === '') {
            controller.write(fieldIds.quantity, null);
        } else if (Number.isFinite(input.valueAsNumber)) {
            controller.write(fieldIds.quantity, input.valueAsNumber);
        }
    };
    const onApproved = (): void => {
        if (!ownsView()) return;
        controller.write(fieldIds.approved, inputs.approved.checked);
    };
    inputs.title.addEventListener('input', onTitle);
    inputs.quantity.addEventListener('input', onQuantity);
    inputs.approved.addEventListener('change', onApproved);

    const unsubscribe = controller.subscribe((state) => {
        if (!ownsView()) return;
        saveButton.disabled = !state.canSave;
        for (const key of keys) {
            const fieldId = fieldIds[key];
            const field = state.fields.find(
                (entry) => entry.fieldId === fieldId
            );
            const input = inputs[key];
            input.disabled = !state.canSave || field == null || field.readOnly;
            const value = state.draft?.data[fieldId];
            if (key === 'approved') input.checked = value === true;
            else if (key !== 'quantity' || !input.validity.badInput) {
                const text = value == null ? '' : String(value);
                if (input.value !== text) input.value = text;
            }
            const errors = state.validationErrors.filter(
                (error) => error.fieldId === fieldId
            );
            inlineErrors[key].textContent = errors
                .map((error) => error.errorMessage)
                .join('\n');
            input.setAttribute('aria-invalid', String(errors.length > 0));
        }
        if (state.result?.type === 'saved') {
            message.textContent = [
                `Saved record: ${state.result.raw.record.id}`,
                ...state.result.postSubmissionWarnings.map(
                    (warning) => `Warning: ${warning.type}`
                ),
                ...state.result.postSubmissionNotifications.map(
                    (notification) => notification.type
                ),
            ].join('\n');
        } else {
            message.textContent =
                state.concurrentEditErrorMessage ??
                state.errorMessage ??
                state.status;
        }
    });
    const onSave = (): void => {
        if (!ownsView()) return;
        const state = controller.getState();
        if (!state.canSave || !ownsView()) return;
        for (const key of keys) {
            const field = state.fields.find(
                (entry) => entry.fieldId === fieldIds[key]
            );
            if (field == null || field.readOnly) continue;
            const input = inputs[key];
            if (
                !input.checkValidity() ||
                (key === 'quantity' &&
                    input.value !== '' &&
                    !Number.isFinite(input.valueAsNumber))
            ) {
                if (ownsView()) input.reportValidity();
                return;
            }
        }
        if (!ownsView()) return;
        void controller.save().catch((cause: unknown) => {
            if (!ownsView()) return;
            // State normally contains the failure. Scope/disposal errors can
            // occur before dispatch; keep Save disabled until fresh setup.
            saveButton.disabled = true;
            message.textContent =
                cause instanceof Error ? cause.message : 'Save unavailable';
        });
    };
    saveButton.addEventListener('click', onSave);

    const destroy = (): void => {
        if (destroyed) return;
        destroyed = true;
        unsubscribe();
        controller.destroy();
        inputs.title.removeEventListener('input', onTitle);
        inputs.quantity.removeEventListener('input', onQuantity);
        inputs.approved.removeEventListener('change', onApproved);
        saveButton.removeEventListener('click', onSave);
        const release = (node: HTMLElement, clear: () => void): void => {
            if (formEditorOwners.get(node) !== owner) return;
            clear();
            formEditorOwners.delete(node);
        };
        for (const key of keys) {
            release(inputs[key], () => {
                inputs[key].value = '';
                inputs[key].checked = false;
                inputs[key].disabled = true;
                inputs[key].removeAttribute('aria-invalid');
            });
            release(inlineErrors[key], () => {
                inlineErrors[key].textContent = '';
            });
        }
        release(saveButton, () => {
            saveButton.disabled = true;
        });
        release(message, () => {
            message.textContent = '';
        });
        options.signal.removeEventListener('abort', destroy);
    };
    options.signal.addEventListener('abort', destroy, { once: true });
    try {
        options.signal.throwIfAborted();
        const current = controller.getState();
        if (
            current.status === 'disposed' ||
            current.status === 'stale' ||
            !ownsView()
        ) {
            throw new Error(
                'Editor scope changed during setup; create a fresh editor.'
            );
        }
        options.signal.throwIfAborted();
    } catch (cause) {
        destroy();
        throw cause;
    }
    return { controller, destroy };
}
```

Give the native inputs visible labels and connect each inline-error element
with `aria-describedby`; set the message element's `role="status"` or your
chosen accessible announcement behavior in your app markup. The recipe keeps
inputs mounted while synchronizing values, so ordinary writes do not remount
focused controls. For select/linked controls, use the separate optional UI
guide when that package subpath is present; keep its value callbacks native
and write them with `controller.write(fieldId, value)`.

The recipe gives each mounted editor private ownership of all supplied DOM
nodes through a `WeakMap` and unique symbol. A replacement may claim those
same nodes before old cleanup runs: old handlers then do nothing, and old
cleanup removes only its own listeners and clears only nodes it still owns.
No credential or ownership token is written into DOM attributes. Abort old
loads and destroy old editors promptly when replacing them.

Save also checks the native inputs' current browser validity and finite number
value before submitting. Invalid numeric text never becomes an empty/null edit
or silently submits the previous valid value. Keep your application's native
`required`, `min`, `max` and `step` attributes as configured; server validation
still decides whether the submitted native values meet the Form's rules.
When your markup omits `step`, this generic number recipe uses `step="any"`
instead of the browser's integer-only default, so finite fractional values are
not rejected by an accidental UI default.

For a direct create Form without CAPTCHA or conditional linked filtering,
complete save options can use `captchaVal: null`, `isComputeMode: false`,
`searchQuery: loadInput.query ?? {}`, `context: {type: 'direct-url'}` and
`conditionalLinkedRecordFieldIdsToFilteringValues: {}`. Those values do not
disable configured rules. Supply actual current widget tokens and known
filtering values when required; preserve the load's query/device fingerprint
and actual child/modal save context. Update the controller configuration
explicitly when those inputs change.

## State, recovery and scope changes

`subscribe` emits a copied initial state immediately and returns an unsubscribe
function. `getState` observes scope freshness too. Descriptors follow the
returned `fieldIdsInForm` order and include only IDs with returned canonical
schemas. They expose title, type, computed/read-only hints and a copied schema;
they do not invent a hidden flag, evaluate conditional visibility or grant
permission to edit. Unsupported or malformed metadata fails rather than being
reinterpreted. Preserve undisplayed native values in the draft.

`controller.write` accepts only returned, noncomputed, non-read-only fields and
native values. It returns `false` for unavailable fields, expired drafts and
stale/disposed controllers. It does not replace backend field validation or
inspect every `AirtableValue` against the field's value schema. The server still
enforces the published extension, password/login, record/field/action,
CAPTCHA and other existing rules.

The controller prevents simultaneous saves. `ready` and `validation-error`
permit an explicit Save. An error result retains the draft and combines field
validation and `formErrors` without duplicating the same field/message; it
retains concurrent-edit feedback separately. Correct the draft, then Save
again. Initial loaded `formErrors` also appear before any submission.

`saved` exposes the actual raw result, normalized warning and notification
arrays, and the saved record ID. Warnings report post-submission failures after
the record was saved; they are not a reason to repeat creation. If writes occur
during an in-flight save, the store clears dirty IDs only when its revision
matches the submitted snapshot. Otherwise `hasNewerEdits` is true and those
edits remain unsaved. The native recipe disables editing during Save to avoid
this extra reconciliation step.

After `saved`, `transport-error` or a dispatched `cancelled` state, another Save
requires a fresh load and explicit reset. A transport/cancellation outcome may
already have written on the server. Reconcile that outcome and load the
appropriate saved/edit/create context before deciding what to submit. There
is no automatic retry, mutation cancellation rollback or automatic reset from
a response. A signal already aborted before dispatch rejects without sending.

Advance the application-owned revision returned by `getScope` whenever visitor,
connection, credentials,
loaded token, record, field/filter configuration or parent context changes.
Use a stable application owner identity for each visitor.
Anonymous visitors need distinct ownership/revisions too. Increment for every
transition, including A → B → A: identical final credentials cannot prove the
old context remains current.

On a scope change, abort the old load, unsubscribe/dispose the old controller
and controls, clear/discard the old visitor store, then load a new Form and
create a controller with the new owner/revision. Do not carry previous visitor
labels or values into it. The controller detects an observed owner/revision or
session mismatch, invalidates old handles and hides stale state. Your app still
owns prompt teardown and revision changes; there is no global login listener.

`reset(newOptions)` is an explicit alternative for a retained controller. It
aborts active work, checks the new configuration and clears the old store when
owner/revision/client/session/token/Form context changes. Same-scope reset
preserves a draft during configuration changes. After a completed save with no
newer edits, it discards that completed handle to adopt the fresh loaded
baseline. With newer writes, it retains the draft until the application decides
how to reconcile them. `destroy()` hides state and removes listeners, but the
owner remains responsible for clearing a supplied visitor store.

This module is client-side presentation and draft management. Local tests and
packed-consumer checks prove these helper contracts; they do not prove a
specific staging deployment, extension or backend compatibility.

## Bounded multipage ownership

### Single-select Request type and Details

Configure a direct, noncomputed `singleSelect` field `fld_request_type` named
“Request type”, with native choices “Standard” and “Other” (choice ID
`opt_other`). On the required text
field `fld_details`, enable the “Details” section header and configure
`conditionalFields` as an `and` group containing a `singleCondition` whose
`setting` is `{ fieldType: 'singleSelect', type: 'is',
idOrName: { type: 'id', id: 'fld_request_type' }, value: 'opt_other' }`.
The condition operand is the canonical choice ID; the native answer is `'Other'`.
The accepted Form configuration supplies this metadata; the component does not
invent conditions or validate a second draft. In one-page mode “Other” reveals
the required Details section. In `multi-page` mode it reveals a Details page;
Next navigates there and deliberate Save checks every page.

Pass the existing `createFormRenderScope({ fields, pages, isCurrent,
configurationRevision, saveOptions })` result, created outside React mounts,
to this copyable application UI. The supplied `pages` must own those same
bindings. Pass those same `fields` alongside `scope` below. Supply the normal
Save lifecycle in `saveOptions` when journaling.
The stock `SelectField` supplies subscribed presentation from the same binding,
including retained read-only answers and native names no longer in current
choices. Its render prop keeps changes on the typed host's guarded capability.
Displaying a retained answer does not make it eligible to add again or rewrite
its native value to a renamed choice.

```tsx
import type { ReactNode } from 'react';
import { AirtableForm, SelectField } from '@miniextensions/sdk/react';
import type { FormFieldBindings } from '@miniextensions/sdk/forms';
import type {
    FieldRendererSlots,
    FormRenderScope,
} from '@miniextensions/sdk/ui';

const requestRenderers = (
    fields: FormFieldBindings
): FieldRendererSlots<ReactNode> => ({
    renderSingleSelectField: (field) => {
        const selection =
            field.capability.type === 'editable'
                ? field.capability.selection
                : undefined;
        return (
            <SelectField
                binding={fields.field(field.fieldId)}
                render={({ snapshot }) => {
                    const state = snapshot.selection;
                    if (
                        snapshot.retired ||
                        snapshot.visibility.type !== 'visible' ||
                        !state
                    )
                        return null;
                    const options = new Map(
                        [...state.selectedOptions, ...state.options].map(
                            (option) => [option.value, option]
                        )
                    );
                    return (
                        <label>
                            {field.title}
                            <select
                                aria-label={field.title}
                                value={state.value[0] ?? ''}
                                disabled={!selection || !snapshot.canEdit}
                                onChange={(event) =>
                                    selection?.choose(
                                        event.currentTarget.value
                                            ? [event.currentTarget.value]
                                            : []
                                    )
                                }
                            >
                                <option value="">Choose a request type</option>
                                {[...options.values()].map((option) => (
                                    <option
                                        key={option.value}
                                        value={option.value}
                                        disabled={option.disabled}
                                    >
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    );
                }}
            />
        );
    },
    renderSingleLineTextField: (field) => (
        <section aria-label={field.title}>
            <h2>{field.title}</h2>
            <label>
                {field.title}
                <input
                    aria-label={field.title}
                    value={field.value ?? ''}
                    disabled={field.capability.type !== 'editable'}
                    onInput={(event) => {
                        if (field.capability.type === 'editable')
                            field.capability.setValue(
                                event.currentTarget.value
                            );
                    }}
                />
            </label>
        </section>
    ),
});

export function SingleSelectRequestForm({
    scope,
    fields,
}: {
    scope: FormRenderScope;
    fields: FormFieldBindings;
}) {
    return (
        <AirtableForm scope={scope} renderers={requestRenderers(fields)}>
            {(state) => (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        // This action retains the revision that produced this render.
                        void state.actions.submit().catch(() => {
                            /* App handles refusal. */
                        });
                    }}
                >
                    {state.fields.map(({ fieldId, node }) => (
                        <div key={fieldId}>{node}</div>
                    ))}
                    <ul aria-live="polite">
                        {state.page.problems.map((problem, index) => (
                            <li key={index}>
                                {problem.code === 'required'
                                    ? 'Complete the required answer.'
                                    : 'Check this answer before continuing.'}
                            </li>
                        ))}
                    </ul>
                    {state.errorMessage && (
                        <p role="status">{state.errorMessage}</p>
                    )}
                    <button
                        type="button"
                        disabled={!state.page.canBack}
                        onClick={() => state.actions.back()}
                    >
                        Back
                    </button>
                    <button
                        type="button"
                        disabled={!state.page.canNext}
                        onClick={() => state.actions.next()}
                    >
                        Next
                    </button>
                    <button type="submit" disabled={!state.page.canSubmit}>
                        Save
                    </button>
                </form>
            )}
        </AirtableForm>
    );
}
```

Choice writes use native names such as `'Other'`, never option IDs or labels
recovered elsewhere. Hiding Details retains its native answer and dirty ID;
hidden/unrendered answers remain in the complete Save envelope. Hidden and
retired hosts produce no controls. Rendering and navigation perform no I/O;
required feedback can refuse Submit before transport or journal creation.
Keep ownership/configuration revisions monotonic, including A → B → A changes;
retained rendered actions must not be reused after a newer revision.
This slice supports only exact-ID direct noncomputed single-select drivers with
`is`, `isNot`, `isAnyOf`, `isNoneOf`, `isEmpty`, and `isNotEmpty`. It does not
extend multi-select/richer drivers or select-driven conditional option predicates.

`createFormPageOwner` owns local page navigation around an existing
`createFormFieldBindings` owner. It reads the accepted load through
`fields.getLoaded()`; do not supply another Form or create another draft store.
Keep both owners outside renderer mount lifetimes. Page disposal unsubscribes and
retires only page actions, never the shared bindings or native draft.

```ts
import {
    createFormPageOwner,
    type FormFieldBindings,
    type FormSaveLifecycle,
    type FormPageSnapshot,
} from '@miniextensions/sdk/forms';

// App-provided existing owner, observed configuration lease and renderer.
declare const fields: FormFieldBindings;
declare const lifecycle: FormSaveLifecycle;
declare const acceptedConfigurationRevision: number;
declare function acceptedFormOwnerIsCurrent(): boolean;
declare function renderPages(
    snapshot: FormPageSnapshot,
    actions: {
        next(): ReturnType<typeof pages.next>;
        back(): ReturnType<typeof pages.back>;
        submit(): ReturnType<typeof pages.submit>;
    }
): void;

// fields is the current FormFieldBindings owner. Increment the configuration
// revision for every accepted replacement, including changes later restored.
const pages = createFormPageOwner({
    fields,
    isCurrent: () => acceptedFormOwnerIsCurrent(),
    configurationRevision: () => acceptedConfigurationRevision,
});
// Each render captures its revision for every retained action callback.
function renderPage(snapshot: FormPageSnapshot) {
    const revision = snapshot.revision;
    const next = () => pages.next(revision);
    const back = () => pages.back(revision);
    // At the final visible page, deliberate submit delegates to fields.save().
    // Supply the same uncertainty-journal lifecycle as an ordinary binding Save.
    const submit = () => pages.submit(revision, { lifecycle });
    renderPages(snapshot, { next, back, submit });
}
const unsubscribe = pages.subscribe(renderPage);
renderPage(pages.getSnapshot());
// Wire these callbacks to explicit user actions; do not invoke them on mount.
unsubscribe(); // ordinary unmount; retain pages/fields for remount
```

Pages follow returned `fieldIdsInForm` order and enabled nonblank frontend section
headers. Leading fields form one unnamed page. A disabled retained header title
never starts a page. Multipage navigation applies only when the configured mode
is `multi-page` and there are more than one structural pages; otherwise all fields
remain on one page. A page is hidden only when all members are hidden. A blocked
visibility result is not hidden. If the active page becomes hidden, normalize to
the first visible page. Empty/all-hidden Forms expose no submission action.

Back changes only the page index; it does not validate, write native values, or dispatch requests. Next checks only the current page's supported ordinary
rules and unfinished scalar/date input, with zero requests or journal writes.
Required checks use canonical emptiness, including blank strings, null/missing,
empty/all-null arrays, unchecked checkbox, rating zero and empty barcode text.
Required exemptions apply to hidden/read-only fields. Character limits exempt
hidden/read-only fields; negative-number rules exempt read-only but **not hidden**
fields. Select validity/count and linked maximum have neither exemption; linked
minimum exempts hidden fields only. Initial loaded values are the detached
persisted baseline for grandfathered select values; presentation is never data.

This validator supports ordinary text, email/URL syntax, number/currency, select
and collaborator selection validity, linked limits and required checks for the
documented scalar/date/attachment types.

Configured `dateRange` feedback is also checked by the page owner for date-only
answers and dateTime answers with a valid fixed timezone. It uses all nine
published range kinds and canonical calendar, ISO-week and day-boundary
arithmetic. An out-of-range changed answer reports `invalid-input`; malformed
active range or fixed-zone metadata reports `invalid-metadata`. Empty
null/missing/`''` values, exact unchanged stored values, hidden fields and
read-only fields keep their canonical exemptions. Required feedback still
runs first. Validation never rewrites native date strings, dirty IDs or
complete Save data.

Client-zone ranges remain backend-validated. The accepted Form response does
not expose the token-bound effective timezone from Load; a current browser or
presentation timezone is not that provenance. Local feedback does not
substitute one, deny client-zone Forms, or claim their range parity. Backend
validation remains authoritative for every range. Range feedback uses the
current clock on each validation, so a held navigation action can become
stale when crossing a range boundary.
An explicit refused Next or Submit publishes the refreshed feedback without a
polling timer. Submit rechecks the range after synchronous admission hooks,
before journal creation and transport. External configuration is observed again
after ownership and controller getter callbacks; a changed configuration retires
the old page owner. Local validation and input/navigation tickets are checked
after that observation too, so a getter cannot admit a stale native snapshot.
If a hook changes validity after a
journal attempt was created, that attempt finishes as `not-dispatched`.
After transport starts, a later clock boundary alone does not reject an
otherwise accepted response; server validation remains authoritative.

Nonempty editable email answers use `email-validator` without trimming, case folding
or native-value normalization. Invalid answers expose the field's generic
`invalid-email` problem and block Next/final Submit before dispatch or journal creation.
Conditional hiding does not waive email syntax; read-only fields are exempt.
Null/missing and exactly empty strings skip syntax, while optional whitespace-only
strings still fail syntax. This is a syntax check, not verification or deliverability.
Nonempty editable URL answers use the established local URL rule: supported
HTTP/HTTPS or bare hosts, and `mailto:` with valid recipients. Whitespace,
control characters, backslashes, unsafe schemes, credentials in a URL and
unsupported host shapes produce a generic `invalid-url` problem. This is syntax
validation only, with no network or DNS request. Conditional hiding does not
waive URL syntax; read-only answers and exactly `allowInvalidUrls: true` are
exempt. The native string is preserved byte for byte, including bare hosts;
validation never replaces it with a normalized or prefixed href.
Single and multiple collaborator answers are validated by exact string IDs from
the loaded field's `config.options.choices` plus that same field's original stored
selection. A stored collaborator can remain selected even if absent from current
choices; an edited draft cannot create its own exemption. Names, email strings
and other native object metadata are preserved and are not compared, normalized
or checked for email syntax. There is no account lookup or local account
authorization. Hidden and read-only fields skip required checks but still undergo
nonempty selection validation. Native order and duplicate occurrences remain data.
Null/missing and exactly empty strings, plus an explicit multiple `[]`, need no
choice metadata after required validation. For nonempty values, missing or
malformed choice-ID metadata gives `invalid-metadata`; an unknown ID or malformed
selection gives `invalid-selection`. These problems block navigation and explicit
submission before transport or journal creation. The SDK conservatively refuses
single arrays, sparse or non-object array members and other invalid native shapes,
including cases skipped by canonical loose empty-value comparison. The maintained
fixture partition records those refusals separately from canonical comparisons.
Renderer presentation still uses the full typed collaborator object, and Portal
collaborator edits continue through the child Form rather than inline object writes.
Computed fields and canonical pass-through types such as rich text and buttons
do not add ordinary frontend validation. Existing visibility refusals still apply;
lookup presentation requires an explicit `hideFieldIfEmpty: false`. Other
unimplemented validation types remain explicit refusals.
Configured `fieldValidationConditionalFields` supports the existing strict
direct-scalar condition subset and the six exact-ID direct noncomputed
single-select driver predicates above through the same predicate evaluator used for
field visibility. Ordinary errors retain priority. Advanced validation applies
only to a visible writable, noncomputed target; hiding, read-only configuration
and canonical computed physical kinds skip that extra rule without waiving any
independent ordinary checks. Predicates read the complete native draft, including
hidden and unrendered drivers, never the filtered presentation record. This does
not broaden visibility, choice availability, edit-empty hiding or condition-driver
support.

A supported false predicate produces the generic `conditional-validation`
problem, without copying a raw value, formula or configured message into feedback.
The exact empty `customErrorMessageForFieldValidation: ''` suppresses that problem
after successful evaluation, matching the frontend's truthy-message reporting;
it never suppresses a malformed or unsupported rule. Null, omitted and nonempty
messages still use the generic code, so an app may supply its own text.
Missing/contradictory schema, ambiguous ID/name aliases, invalid native driver
values, evaluator errors and unsupported predicates yield `unsupported-validation`.
Multi-select, linked, lookup, computed and date dependencies remain outside this
slice. Invalid or unsupported single-select drivers remain refused even when
their predicates compile to a constant formula. No linked reads or
metadata recovery are performed.

Unsupported conditional rules and `requireOpenLinkedRecords` without review
tracking remain blocked when their page is relevant. Rules on a future page do
not block Next on an earlier page; reaching that page exposes their feedback or
refusal. Final submission checks all pages again, including earlier answers and
cross-field dependencies changed after navigation. Pass each rendered revision
to Next or Submit; a retained callback cannot approve newer answers. Existing
native/input/navigation/configuration/owner tickets, pending-file gates and
uncertainty remain authoritative. Existing blocked visibility results remain
blocked. There is no approximation of backend uniqueness, authentication or
permission validation.

Configured prepared Review, compute and automatic submission remain unsupported
by this owner and block navigation globally. It never bypasses them. After full
page validation, final submission delegates to the existing `fields.save`,
refusing an effective compute Save input before journal creation or transport,
and retaining the complete native envelope, dirty-ID union, pending-file and
uncertainty gates; backend validation remains authoritative. A cancelled/unknown
Save retires the old page actions. An explicit fresh binding reload/reset requires
a new page owner; no old action is revived or mutation retried.

Snapshots are detached copies. Their revision covers navigation, conditional
page normalization, native draft changes, unfinished input and blocked-state
changes. Pass an exact owner/session/token/parent lease and a monotonic observed
configuration revision. An observed mismatch permanently retires old actions,
including observed A→B→A. Accepted AddChoice metadata updates stay within the
existing Form owner and do not retire page navigation. A current-owner predicate
that synchronously disposes the page owner cannot authorize a subsequent action.
Unobserved in-place replacement is not detected. A stale
callback never disposes shared or successor bindings.

Pinned fixtures compare supported ordinary rules with canonical frontend semantics
and explicitly cover conservative unsupported-validation refusals. Executable installed
ESM/CJS tests prove bounded local
navigation and synthetic validation-response dispatch, not live persistence or
complete hosted multipage parity. Live acceptance remains separately tracked.
