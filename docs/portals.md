# Headless Portal collections

`@miniextensions/sdk/portals` wraps the existing authorized Portal reads and
child Form metadata. It has no DOM, React, renderer, or storage. Readable
child-prefill formatting reuses the formulas formatter and its runtime
dependencies. This is a development preview: use a built TGZ, or
[install, check and pack a source checkout](../README.md#build-an-archive-from-source).
Install the supplied built archive using the
[runtime quickstart](runtime.md#packaged-form-quickstart); this package has not
been published to npm. The core client uses the existing miniExtensions APIs
and the visitor's current session; the server retains authorization.

A collection binds one loaded `portal_loaded` result, configured linked field,
custom view, criteria and application owner/revision. It does not grant access,
load a child, save, unlink or reload automatically. Advance the owner revision
on every visitor, connection, session, token or context transition, including
anonymous visitors and A → B → A. Credential equality alone cannot identify
those transitions.

Before creating a collection, call `evaluatePortalViewAvailability` with the
complete accepted `PortalLoadedResult` and its outer published `portalFieldId`.
It returns a detached snapshot with three readonly fields: `views` contains
eligible `{ id, config }` descriptors in configured order, `legacy` permits a
genuine absent/empty-list default, and `unavailable` reports unsupported or
malformed definitions generically. Eligible neighbors can remain usable when
`unavailable` is true. Readonly types do not recursively freeze returned objects.
Eligible configs are opaque application metadata, **not
log-safe or redacted display payloads**; they may contain field references and
condition literals. Do not log or render the complete result.

The helper and browser starter evaluate both `customViewConditions` and owning
field conditions against complete accepted `formRecord.data` and required
`usersTableFields`, using the existing supported strict Form evaluator without
Form empty-hiding rules. Unconditional choices accept `usersTableFields: []`;
missing required Portal metadata is not a fallback. Valid direct scalar Formula
result snapshots follow the [Form Formula policy](forms.md#formula-scalar-snapshot-drivers),
including exact saved/result types and strict native values. No Formula
expression is calculated or refreshed by this helper; accepted parent refreshes
supply new results. Other unsupported/computed condition drivers and malformed
native values remain unavailable. Raw duplicate view IDs
are refused before visibility filtering, including hidden duplicates.

Never infer a legacy default from `views.length === 0`. Hidden fields, nonempty
all-hidden/refused lists and malformed lists (including `null`) do not permit it.
Only `legacy: true` permits the explicit `selectedCustomViewId: ''` branch;
hosts requiring named views may reject that branch too. Otherwise choose an exact
ID from `views`, or expose generic unavailable feedback without a read action.

Accepted parent refreshes rebuild the choices and retire a selection that is no
longer eligible. Eligibility is cached only within that accepted parent snapshot
and Portal field; accepting new parent values clears the cache. Retained read,
row and child actions recheck the current
selection; changing views never loads records automatically. This presentation
uses accepted client data, not a new backend grant or a promise that a server
condition cannot change. The canonical server still re-evaluates published
field/view conditions and authorizes every read and mutation.

The helper performs no I/O, detects no freshness and revokes no owner or captured
callback. Re-evaluate after accepting new parent data/schema and retire/rebind
old list, child and action owners through existing scope/configuration revisions,
including A → B → A. Equal returned values cannot revive an earlier owner.

Collections accept direct linked-record fields and valid lookup fields whose
returned `options.isValid` is `true` and whose `options.result.type` is
`multipleRecordLinks`. `getPortalLinkedRecordFieldConfig` resolves that direct
or lookup-result config for application table discovery. Its target table comes
from the result's linked-record options; every Portal read and child request
keeps the outer published Portal field ID. The lookup's `recordLinkFieldId`
and `fieldIdInLinkedTable` identify its source and are not replacement Portal
field or target-table IDs.

A lookup collection can page, project returned details, and plan the exact
configured edit child for a record in its accepted main list and editable
selected view. Its computed parent field does not deny that separate child edit.
Lookup create plans are disabled, including retained create flags or Form
layout settings. Reading a lookup grants no parent linking or unlinking rights;
the starter exposes parent unlink controls only for direct linked fields.
The canonical server still validates each requested action and current scope.

## Executable application boundary

Save this as `portal-owner.ts` in your application. Call its methods from
deliberate application actions. Callbacks receive actual SDK results; render
text with safe text APIs. Keep captured collection capabilities and credentials
out of logs, DOM attributes and shared or diagnostic storage. This recipe keeps
them in memory. If your application restores a client session, use its chosen
visitor-scoped store as described in [session ownership](runtime.md#session-ownership);
the SDK supplies no persistent-storage adapter. `clearVisitorState` must clear
old displayed rows, child Forms and their draft stores. Each owner belongs to
one client and visitor; replace it when switching clients.

```ts
import type {
    LoadExtensionInput,
    LoadExtensionResult,
    MiniExtensionsClient,
    PortalLoadedResult,
    RuntimeSession,
} from '@miniextensions/sdk';
import {
    createFormSaveInput,
    type FormSaveOptions,
    type FormDraftSnapshot,
} from '@miniextensions/sdk/forms';
import type { AirtableValue } from '@miniextensions/sdk';
import {
    createPortalCollection,
    evaluatePortalViewAvailability,
    type PortalCollection,
    type PortalCollectionCriteria,
    type PortalCollectionSnapshot,
    type PortalChildRequestOptions,
    type PortalOwnerScope,
    type PortalReadOptions,
    type PortalReadOutcome,
} from '@miniextensions/sdk/portals';

type Selection = {
    portalFieldId: string;
    criteria: PortalCollectionCriteria;
};
type ChildSaveOptions = Omit<
    FormSaveOptions,
    'context' | 'searchQuery' | 'deviceFingerprint'
>;
type Entry = {
    portal: PortalLoadedResult;
    collection: PortalCollection;
    selection: Selection;
    session: RuntimeSession;
    version: number;
    readBusy: boolean;
    acceptedRead: boolean;
};

export function createPortalScreenOwner(options: {
    client: MiniExtensionsClient;
    initialOwnerId: string;
    clearVisitorState(): void;
    onScreen(page: LoadExtensionResult, scope: PortalOwnerScope): void;
    onCollection(snapshot: PortalCollectionSnapshot | null): void;
    onRead(outcome: PortalReadOutcome): void;
}) {
    const { client } = options;
    let scope = { ownerId: options.initialOwnerId, revision: 0 };
    let version = 0;
    let readGeneration = 0;
    let active: AbortController | null = null;
    let entry: Entry | null = null;
    let disposed = false;
    const getScope = () => ({ ...scope });
    const owned = (expected: number, session: RuntimeSession) => {
        const now = client.getSession();
        return (
            !disposed &&
            version === expected &&
            Object.keys(now).length === Object.keys(session).length &&
            Object.keys(session).every(
                (key) => Object.hasOwn(now, key) && now[key] === session[key]
            )
        );
    };
    const current = (e: Entry) =>
        entry === e &&
        owned(e.version, e.session) &&
        e.collection.isCurrent() &&
        entry === e &&
        version === e.version;
    const retire = (ownerId = scope.ownerId, destroying = false) => {
        if (disposed) throw new Error('Owner disposed');
        const previous = active;
        const old = entry;
        active = null;
        entry = null;
        scope = { ownerId, revision: scope.revision + 1 };
        const expected = ++version;
        readGeneration++;
        disposed = destroying;
        try {
            options.clearVisitorState();
        } finally {
            try {
                old?.collection.destroy();
            } finally {
                previous?.abort();
            }
        }
        return expected;
    };
    const bind = (
        portal: PortalLoadedResult,
        selection: Selection,
        session: RuntimeSession,
        expected: number
    ) => {
        if (!owned(expected, session)) throw new Error('Stale Portal');
        const captured = structuredClone(portal);
        const available = evaluatePortalViewAvailability({
            portal: captured,
            portalFieldId: selection.portalFieldId,
        });
        const viewId = selection.criteria.selectedCustomViewId;
        if (viewId === '') {
            // This recipe explicitly permits a genuine legacy default.
            if (!available.legacy)
                throw new Error('An available Portal view is required.');
        } else if (!available.views.some((view) => view.id === viewId)) {
            throw new Error('An available Portal view is required.');
        }
        const e: Entry = {
            portal: captured,
            selection: structuredClone(selection),
            session: { ...session },
            version: expected,
            readBusy: false,
            acceptedRead: false,
            collection: createPortalCollection({
                client,
                portal: captured,
                ...selection,
                getScope,
            }),
        };
        if (!owned(expected, session)) {
            e.collection.destroy();
            throw new Error('Stale Portal');
        }
        entry = e;
        return e;
    };
    const requireEntry = () => {
        const e = entry;
        if (!e || !current(e)) throw new Error('Explicitly reload the Portal');
        return e;
    };
    const read = async (first: boolean, readOptions: PortalReadOptions) => {
        const e = requireEntry();
        readOptions.signal?.throwIfAborted();
        if (e.readBusy) throw new Error('A read is already pending');
        if (!first) {
            if (!e.acceptedRead) throw new Error('Read a fresh first page');
            if (e.collection.getSnapshot()?.airtableOffset === null)
                return null;
        }
        e.readBusy = true;
        e.acceptedRead = false;
        const generation = ++readGeneration;
        const accepted = () => current(e) && readGeneration === generation;
        try {
            const pending = first
                ? e.collection.readFirst(readOptions)
                : e.collection.readNext(readOptions);
            void pending.catch(() => {}); // Observe rejection if a callback throws.
            // readFirst clears old rows immediately. Next keeps accepted rows.
            const before = e.collection.getSnapshot();
            if (accepted()) options.onCollection(before);
            const outcome = await pending;
            if (!accepted()) return null;
            e.acceptedRead = outcome?.type === 'loaded';
            const snapshot = e.collection.getSnapshot();
            if (!accepted()) return null;
            options.onCollection(snapshot);
            if (!accepted()) return null;
            if (outcome) options.onRead(outcome);
            return accepted() ? outcome : null;
        } finally {
            e.readBusy = false;
        }
    };
    return {
        getScope,
        changeOwner: (ownerId: string) => retire(ownerId),
        async load(input: LoadExtensionInput, selection: Selection) {
            const requestInput = structuredClone(input);
            const chosen = structuredClone(selection);
            const expected = retire();
            if (disposed || version !== expected || active !== null)
                throw new Error('A newer load owns the screen');
            const controller = new AbortController();
            active = controller;
            const session = client.getSession();
            controller.signal.throwIfAborted();
            if (!owned(expected, session)) throw new Error('Stale load');
            const page = await client.loadExtension(requestInput, {
                session,
                signal: controller.signal,
            });
            controller.signal.throwIfAborted();
            if (active !== controller || !owned(expected, session)) return null;
            if (page.extensionScreen === 'portal_loaded')
                bind(page, chosen, session, expected);
            if (!owned(expected, session)) return null;
            options.onScreen(page, getScope());
            return owned(expected, session) ? page : null;
        },
        readFirst: (readOptions: PortalReadOptions) => read(true, readOptions),
        readNext: (readOptions: PortalReadOptions) => read(false, readOptions),
        acceptCleanup(criteria: PortalCollectionCriteria) {
            const accepted = structuredClone(criteria);
            const e = requireEntry();
            // App accepts cleanup, clears its persisted criteria, then binds anew.
            const expected = retire();
            return bind(
                e.portal,
                { ...e.selection, criteria: accepted },
                e.session,
                expected
            ).collection.getSnapshot(); // No read is dispatched here.
        },
        async openChild(childOptions: PortalChildRequestOptions) {
            const chosen = structuredClone(childOptions);
            const e = requireEntry();
            const request = e.collection.childFormRequest(chosen);
            const context = request.input.context;
            if (context.type !== 'modal')
                throw new Error('A modal child Form request is required');
            const previous = active;
            const controller = new AbortController();
            active = controller;
            previous?.abort();
            const accepted = () =>
                active === controller &&
                current(e) &&
                request.isCurrent() &&
                active === controller &&
                entry === e;
            controller.signal.throwIfAborted();
            if (!accepted()) return null;
            const loaded = await client.loadExtension(request.input, {
                session: e.session,
                signal: controller.signal,
            });
            controller.signal.throwIfAborted();
            if (!accepted()) return null;
            if (loaded.extensionScreen !== 'form_loaded') {
                options.onScreen(loaded, getScope());
                return null; // App handles actual auth/redirect/other screens.
            }
            const record = loaded.payload.formRecord;
            if (
                loaded.extensionId !== chosen.configuredChildExtensionId ||
                (chosen.access.type === 'create'
                    ? record.type !== 'create'
                    : record.type !== 'edit' ||
                      record.recordId !== chosen.access.recordId ||
                      record.tableId !==
                          context.linkedTableIdOfLinkedRecordField)
            )
                throw new Error(
                    'Child Form does not match the requested record'
                );
            const form = structuredClone(loaded);
            return {
                loaded: structuredClone(form),
                parent: structuredClone(request.parent),
                saveContext: structuredClone(request.saveContext),
                isCurrent: accepted,
                makeSaveInput(
                    draft: FormDraftSnapshot<AirtableValue>,
                    saveOptions: ChildSaveOptions
                ) {
                    if (!accepted()) throw new Error('Stale child Form');
                    return createFormSaveInput({
                        loaded: form,
                        draft,
                        options: {
                            ...saveOptions,
                            context: request.saveContext,
                            searchQuery: request.input.query ?? {},
                            deviceFingerprint: request.input.deviceFingerprint,
                        },
                    });
                },
            };
        },
        async unlink(recordId: string) {
            const e = requireEntry();
            if (!e.acceptedRead || e.readBusy)
                throw new Error('Read a fresh first page before unlinking');
            const snapshot = e.collection.getSnapshot();
            if (!snapshot?.recordIds.includes(recordId))
                throw new Error('Choose a currently listed record');
            const expected = retire(); // Destroy BEFORE this mutation dispatch.
            if (!owned(expected, e.session)) throw new Error('Stale unlink');
            const controller = new AbortController();
            active = controller;
            await client.portals.unlinkRecord(
                {
                    extensionAccessToken: e.portal.payload.extensionAccessToken,
                    portalFieldId: e.selection.portalFieldId,
                    recordIdToUnlink: recordId,
                    selectedCustomViewId:
                        e.selection.criteria.selectedCustomViewId,
                },
                { session: e.session, signal: controller.signal }
            );
            return active === controller && owned(expected, e.session);
            // No old collection/token can be reused. Explicit Reload is next.
        },
        destroy() {
            if (!disposed) retire(scope.ownerId, true);
        },
    };
}
```

Call `load` with your actual published Portal input and configured field/view
IDs. Handle its returned redirect, password, login and Form screens before
using Portal methods. For example, these functions provide manual actions;
none run until your application calls them:

```ts
import { createMiniExtensionsClient } from '@miniextensions/sdk';
import { createPortalScreenOwner } from './portal-owner.js';
import type { PortalCollectionCriteria } from '@miniextensions/sdk/portals';

const client = createMiniExtensionsClient({
    apiOrigin: 'https://your-api-origin.example',
});
const owner = createPortalScreenOwner({
    client,
    initialOwnerId: 'YOUR_APPLICATION_VISITOR_ID',
    clearVisitorState: () => {
        // Clear your displayed rows/child Forms and visitor draft stores here.
    },
    onScreen: (page) => {
        console.info('Loaded screen:', page.extensionScreen ?? 'redirect');
    },
    onCollection: (snapshot) => {
        console.info('Accepted main record IDs:', snapshot?.recordIds ?? []);
    },
    onRead: (outcome) => {
        console.info('Read status:', outcome.type);
    },
});
const criteria: PortalCollectionCriteria = {
    selectedCustomViewId: 'YOUR_CONFIGURED_CUSTOM_VIEW_ID',
    searchTerm: null,
    searchParamsMap: {},
    sortFieldsByEndUser: null,
    filtersByEndUser: null,
    supportsEndUserSortCleanup: true,
    supportsEndUserFilterCleanup: true,
};
const readOptions = { pagesToFetch: 1, refreshLoggedInPortalRecord: true };
export const reloadPortal = () =>
    owner.load(
        {
            shareId: 'YOUR_PORTAL_SHARE_ID',
            recordId: null,
            context: { type: 'direct-url' },
            query: {},
        },
        { portalFieldId: 'YOUR_CONFIGURED_PORTAL_FIELD_ID', criteria }
    );
export const firstPage = () => owner.readFirst(readOptions);
export const nextPage = () => owner.readNext(readOptions);
export const acceptCleanedCriteria = (accepted: PortalCollectionCriteria) =>
    owner.acceptCleanup(accepted); // Update app persistence before this call.
export const openRecordForm = (recordId: string) =>
    owner.openChild({
        access: { type: 'edit', recordId },
        configuredChildExtensionId: 'YOUR_CONFIGURED_EDIT_FORM_ID',
        query: {},
    });
export const createRecordForm = () =>
    owner.openChild({
        access: { type: 'create' },
        configuredChildExtensionId: 'YOUR_CONFIGURED_CREATE_FORM_ID',
        query: {},
    });
export const unlinkRecord = (recordId: string) => owner.unlink(recordId);
export const switchVisitor = (ownerId: string) => owner.changeOwner(ownerId);
export const dispose = () => owner.destroy();
```

Handle rejected promises in your application's manual action handlers. A
dispatched failed/cancelled read invalidates child plans and requires a
successful fresh `readFirst` before more pagination or child access. A failed
next read may retain a display snapshot; displaying cached rows does not make
them usable for child actions. A pre-aborted read dispatches nothing and keeps
the prior accepted state. `readNext` returns `null` at the final cursor without
dispatching; an empty page with a non-null cursor may still have a next page.

## Single-field sorting recipe

The shipped [Portal sorting recipe](../examples/browser/src/portalSort.ts) is
used by the actual browser starter and can be copied with its `dom.ts` sibling
into a custom consumer. It is a browser recipe, not a new SDK export or a
filter editor. Its `mountPortalSortEditor` accepts the loaded Portal, exact
Portal field ID, complete `PortalCollectionCriteria`, accepted
`PortalCollectionSnapshot`, `isCurrent()` and `onApply(criteria)` callbacks.
It returns either `{type:'ready', node, destroy}` or an unavailable diagnostic.
Inputs and applied criteria are detached copies. It starts no request and
changes no native draft values.

The caller must bind `isCurrent` to the collection instance, accepted snapshot
and mount epoch, criteria epoch, connected active Portal DOM, current session
and monotonic owner revision. `collection.isCurrent()` alone is insufficient:
a next-page read or cleanup can replace the accepted snapshot while retaining
that collection. Retire the editor before every read, child opening, context
replacement or cleanup; retire it before abort or application callbacks can
reenter. A detached Portal cannot change an active child's parent context.

The editor offers one exact field ID plus `asc`/`desc`. Multiple or unresolved
existing sorts remain unchanged until **Replace existing sorts** is explicitly
chosen. **Use configured order** applies `[]`; the backend then uses its
configured ordering. This does not promise unsorted data. Applied sorting
preserves filters, search, search-page parameters and cleanup flags. Render
records in server-returned order; never sort a partially loaded dataset locally.

Eligible fields intersect accepted visible detail fields/effective primary
with returned linked-table metadata and any nonempty configured sort-ID list.
Hidden sort-only metadata never becomes an option. Duplicate labels retain
distinct IDs. Null/empty restrictions allow this returned presentation subset;
a nonempty all-stale restriction allows none. Metadata is not the full table.
The recipe never guesses that the first field is primary: without a valid
configured primary or explicit primary flag, only visible details are offered.
Malformed or ambiguous metadata makes this editor unavailable, without
preventing ordinary permitted reads.

Custom views replace `hideSortButtonForPortal`, `sortingOnExtensionFields`
and `customPrimaryField`, including omitted values clearing parent settings.
The recipe captures that configuration and supports table/list presentation;
hidden sorting controls and other layouts are explicitly unavailable. These
are presentation constraints; the backend authorizes and orders every read.

On Apply, retire collection, paging, inline editing and child/action eligibility;
keep them retired until the next explicit successful **Load records**. Editing
search preserves committed sort/filter criteria and resets paging. Changing
table/view resets its sort/filter selection. Do not prune native child Form
fields, dirty IDs, modal context or uncertain-operation guards. The starter
keeps complete owned criteria in memory; it adds no persistence or automatic
read/mutation.

Cleanup responses are proposals, not empty successful collections. Display the
actual returned replacements and bind confirmation to the exact owner and
criteria epoch. Explicit acceptance patches only properties present in the
response, preserving all others, retires the collection and awaits an explicit
first read. Sort cleanup may precede a separate filter cleanup. Cancellation
and stale confirmation change nothing. Errors/cancellation require explicit
read recovery; empty accepted results remain successful results.

## One direct scalar filter recipe

The installed starter reuses `examples/browser/src/portalFilter.ts`:
`mountPortalScalarFilterEditor({ portal, portalFieldId, criteria, snapshot,
isCurrent, onApply })`. This shipped typed DOM recipe is not a public SDK export.
It edits one direct scalar or select condition or explicitly clears filters; it does not
send a request, evaluate record membership or save records. Apply preserves the
complete owned criteria and retires both sorting and filtering editors, rows,
Create/Edit, child plans and paging until the next explicit successful Load.

Fields come only from accepted linked-table metadata. Visible eligibility uses
the accepted non-hidden detail projection; dropdown select eligibility is separate. A present empty projection allows the resolved effective
primary; a missing projection does not. Returned custom detail maps replace the
legacy loaded map. Missing columns are not recovered from another table or from
record values. Duplicate field labels retain exact IDs. Select eligibility is the
union of visible fields and the configured dropdown-select contribution. A null
or omitted `dropdownFiltersFields` includes returned selects; an empty list removes
only that contribution, leaving visible selects eligible. `hideDropdownFilters`
affects quick dropdown UI, not this condition editor. Custom-view replacement
applies to these keys, including omitted keys. Form choice labels, read-only,
availability and limits do not determine filter eligibility. Computed, linked,
relation and date fields are outside this slice. Legacy
`filteringOnExtensionFields` is not a scalar whitelist in the inspected canonical
normalizer; a scalar ID in `dropdownFiltersFields` remains eligible when visible.

Configuration preserves property presence: root filtering is enabled only if
`disableFilteringOnExtension` is absent or exactly false. Own undefined, null or
true disables it. A custom view replaces that key even when omitted, so it must
explicitly set false. Omitted whole view config inherits root. Unavailable
presentation never clears criteria or disables otherwise-allowed ordinary reads.
A server filtering-disabled error requires manual recovery; it is not cleanup.

The existing strict `/forms` compiler determines supported operator/type pairs.
Text supports equality/inequality, contains/not-contains, regex, length and
empty/not-empty; rich text omits equality/inequality. Number, percent, currency
and rating support numeric comparisons and empty/not-empty. Checkbox supports
only `is` with an actual boolean. Strings retain exact bytes. Empty equality
operands are invalid; empty contains/not-contains and syntactically valid empty
regex follow compiler acceptance. Blank numeric/length entries are rejected
before Number conversion; numbers must be finite. Percent values use user units
such as 25; rating emptiness means zero. Length adds no integer/nonnegative rule.
Compiler literal/reference round-trip or regex failures, and missing-field
warnings even with a compiled FALSE predicate, prevent Apply.

Single-select supports `is`, `isNot`, `isAnyOf`, `isNoneOf`, `isEmpty` and
`isNotEmpty`; multi-select supports `hasAnyOf`, `hasAllOf`, `hasNoneOf`,
`isExactly`, `isEmpty` and `isNotEmpty`. The native select controls use exact
choice IDs and plain canonical names from unambiguous returned metadata, without
Form presentation overrides. Zero-choice fields retain the two emptiness
operators. Single-select regex remains unsupported. Unknown or partially unknown
saved operands remain visibly unresolved with the entire original AST preserved,
even when the compiler can represent a known subset. Only explicit replacement
or accepted server cleanup may change them. Choice/configuration/criteria changes
observed by a retained handler retire that editor; unobserved in-place ABA is not
detected. DOM/synthetic checks do not establish native browser keyboard proof.

The AST must also have exactly one supported leaf, a nonempty condition ID, an
exact ID reference and coherent current field type. Richer groups, name
references, multiple conditions and unavailable saved fields remain intact until
Replace existing filters is chosen. Replacement prepares an editor only; Apply
or Clear is still explicit. No partial dropping or automatic normalization occurs.
Typed conditions, not compiled formulas, are submitted at the next explicit read.
Canonical server cleanup remains authoritative and uses the same explicit,
owner/criteria-bound confirmation lifecycle as sorting.

`isCurrent` must bind collection identity, accepted snapshot and mount/criteria
epochs, live connected Portal DOM and monotonic session/owner revision. Retire
both editors before callbacks and abort re-entry, including paging, cleanup,
child opening and A-to-B-to-A ownership changes. Detached controls cannot change
an active child's native parent context. These constraints are implemented by
the actual starter; custom consumers must supply the equivalent owner binding.

This is not a general filter builder or complete hosted Portal parity.
Linked/date/computed filters and nested groups remain deferred. The recipe and
pinned synthetic comparison fixtures do not prove live-backend persistence or
complete Airtable regex compatibility.

## Returned data and cleanup

Render `snapshot.recordIds` in order, looking up records in the configured
linked table's `recordIdsToAirtableRecords`. Nested/cache record IDs are not
main collection membership. Pages deduplicate main IDs; later records and
schemas replace earlier projections intact, so omitted old field values do
not linger. These helpers do not reconstruct hidden schemas or infer columns
from record values.

`customViewDetailFields` is a whole-map replacement when non-null: omitted
field keys mean empty detail lists. Only `null` uses the loaded Portal's
legacy detail map, following the existing browser example convention.
`snapshot.detailFields` contains returned non-hidden descriptors in order;
empty projections stay empty. A configured custom view also replaces layout
settings, including settings it omits. These are UI hints; the backend
authorizes every action.

The browser starter admits a detail column only when its field ID identifies
one detail in the selected raw list and one physical field across the returned
tables. Raw detail identity counts include hidden descriptors, before applying
the accepted visible projection. Only a null returned map uses the legacy list;
a missing or empty selected entry stays empty. A supplied child Form field must use that exact ID and physical type; malformed
or ambiguous identities expose neither the native value nor an inline editor.
Null child metadata keeps the returned detail configuration as the supported
write-policy fallback. `fieldIsInEditingChildForm` is informational and is not
an additional admission gate. A valid child configuration remains write policy;
the returned detail configuration governs row summaries separately from that
write policy. Either `obscurePassword: true` or
`maskPasswordOnLoginScreen: true` produces a fixed mask for every native field
type, including Number and empty values. A defined non-boolean mask flag produces
`Value unavailable`; absent or null configuration keeps ordinary presentation,
including the existing attachment-summary rules. Enabled or malformed
`displayAsButton` or `displayAsAttachments` flags use `Value unavailable` without
reading the native value; a valid password mask keeps priority over those
presentation flags. Explicit `false` or omitted flags keep ordinary summaries.
The starter checks this policy
before reading the value and rechecks accepted ownership and display policy
after formatting. This changes display only: native values and inline-edit
admission stay intact. Display names do not resolve physical identity, so
distinct field IDs may share a label.

When a read returns `criteria-cleanup-required`, show the actual returned
`raw.endUserSortCleanup`/`raw.endUserFilterCleanup` to the application. After
the visitor accepts, replace the relevant persisted criteria, call
`acceptCleanup` with that complete accepted criteria, then explicitly call
`readFirst`. The guide does not accept cleanup, persist it or issue a follow-up
request automatically.

## Child drafts, saving and mutation boundaries

`openChild` validates the exact configured child ID and edit membership; cached
nested records alone cannot open an edit Form. The request captures the parent
Portal token, field, linked table, inverse-link/create prefills and read epoch.
The configured parent query is carried only when
`prefillChildFormForCreatingRecords` is explicitly `true`, the selected field
has current ID-keyed source metadata and an own record value, and its canonical
readable type is string. The helper formats that value with
`getReadableStringFromAirtableValue`, using execution-environment local date parsing and the
source field's date/time format and timezone. Text, rich text, URL, email,
phone, barcode, single select, date/dateTime, created/modified timestamps and
created/modified-by fields are supported; formula and lookup sources follow
their readable result metadata. Rollups, numbers, checkboxes, linked records,
multi-selects and single/multiple collaborator fields are not query sources. A missing computed
result has canonical string classification, but ordinary invalid computed
values format as blank.

Missing metadata, disabled configuration, blank formatted text or a thrown
formatter error produces a null query. Nonblank canonical error-sentinel text
and `Invalid date` remain readable text; this helper does not validate query
syntax. Formatting removes rich-text Markdown and joins lookup values with
`, `. The formatted bytes stay unchanged, including whitespace and URL
escapes; raw text is not decoded or normalized. Inverse linking remains
independent, edit plans carry no create prefill, and lookup-backed collections
remain unable to create children. Local date parsing uses the execution
environment's timezone; it does not infer a visitor timezone from the child
request's `clientTimeZone`.
Every later dispatched read invalidates the plan even if criteria are equal.
Check the returned child's `isCurrent()` immediately before displaying it,
editing its draft or creating a save input. A late child response cannot be
accepted after visitor/session/query changes.

Use `openLoadedFormDraft({store, loaded: child.loaded, parent: child.parent})`
from the [Form helpers guide](forms.md) with a visitor-owned store. Pass its
current snapshot to `child.makeSaveInput(draft, options)`. Supply every
remaining option: `captchaVal`, `isComputeMode`,
`conditionalLinkedRecordFieldIdsToFilteringValues`, and any configured
location requirements. The child request supplies the matching modal
`context`, query and device fingerprint. The loaded baseline, hidden prefills
and dirty IDs are preserved. Creating an input does not save; dispatch only
from an explicit Save handler while the child remains current. Use the Form
controller for validation/success warnings and fresh-load requirements.

### Explicit child Save and recovery composition

The owner above intentionally stops at input construction. This application
adapter connects that captured child to the shipped Form controller and the same
journal lifecycle used by the browser starter. Keep one journal per visitor
across child remounts and fresh loads. Supply a stable recovery relationship
owner (for example `recoveryOwner(apiOrigin, shareId, acceptedPortal)`), the actual
linked table and a monotonically advancing accepted `loadVersion`. Scope
revisions must advance on every visitor/session/configuration transition,
including A→B→A. Neither the journal nor its local IDs grant server authority.

```ts
import type { MiniExtensionsClient } from '@miniextensions/sdk';
import {
    createFormController,
    RecoveryJournal,
    type FormOwnerScope,
    type FormSaveOptions,
} from '@miniextensions/sdk/forms';
import type { createPortalScreenOwner } from './portal-owner.js';

type PortalChild = NonNullable<
    Awaited<ReturnType<ReturnType<typeof createPortalScreenOwner>['openChild']>>
>;

export function createPortalChildSave(options: {
    client: MiniExtensionsClient;
    child: PortalChild;
    journal: RecoveryJournal;
    recoveryOwner: string;
    linkedTableId: string;
    loadVersion: number;
    getScope(): FormOwnerScope;
    saveOptions: Omit<
        FormSaveOptions,
        'context' | 'searchQuery' | 'deviceFingerprint'
    >;
}) {
    const { child, journal, loadVersion } = options;
    const input = child.makeSaveInput(
        { data: child.loaded.payload.formRecord.data, dirtyFieldIds: [] },
        options.saveOptions
    );
    const {
        extensionAccessToken: _token,
        formRecord: _record,
        formFieldIdsWithUnsavedChanges: _dirty,
        ...saveOptions
    } = input;
    const scope = {
        owner: options.recoveryOwner,
        parentFieldId: child.parent.portalFieldId,
        tableId: options.linkedTableId,
        childExtensionId: child.loaded.extensionId,
        context: input.context.type,
    };
    const recordId =
        input.formRecord.type === 'edit' ? input.formRecord.recordId : null;
    const controller = createFormController({
        client: options.client,
        loaded: child.loaded,
        parent: child.parent,
        saveOptions,
        getScope: options.getScope,
        isCurrent: child.isCurrent,
    });
    return {
        controller, // Reuse its write/getState/subscribe; Save goes through save below.
        save: () =>
            controller.save({
                isCurrent: child.isCurrent,
                lifecycle: {
                    dispatch: () => {
                        const attempt = journal.begin(
                            scope,
                            recordId,
                            'save',
                            loadVersion
                        );
                        return {
                            accepted: (result) =>
                                journal.accepted(
                                    attempt,
                                    result.type === 'saved'
                                        ? 'saved'
                                        : 'validation-error'
                                ),
                            finish: (disposition) => {
                                if (disposition === 'not-dispatched')
                                    journal.notDispatched(attempt);
                                else journal.finishFlight(attempt);
                            },
                        };
                    },
                },
            }),
        destroy: () => controller.destroy(),
    };
}
```

Construction performs no request or journal write. Mount existing controls using
the returned controller; call the adapter's `save()` only from deliberate Save.
This headless composition does not add Review or browser-starter wiring.
Validation retains the draft for correction and another explicit Save. A known
saved response, including post-submission warnings, is not permission to submit
again: explicitly reload the parent Portal and open a fresh child before another
operation. Do not merge a late response into a successor's parent or child.

Transport failure, dispatched cancellation or retirement after dispatch leaves
the attempt unknown, even if a late response says saved. Keep that journal after
destroying the UI. Inspect the server outcome before deciding what to load next;
fresh loading alone does not clear its blocker. Only a settled, explicitly
inspected unknown attempt can be associated through `acknowledgeExisting`, or
acknowledged as a genuinely new intent with `acknowledgeNewIntent`. These actions
retain its unknown outcome and do not replay it, establish idempotency or Save.
Do not treat an acknowledgment as an automatic retry. The adapter retains no
reference input; the in-memory journal is lost on document reload and is not
persistent recovery. All receipt checks use synthetic local ports, not live
persistence or authorization evidence.

The manual `unlink` method retires the collection and child plans before
calling the existing core operation. The Airtable record itself remains.
After success, failure or cancellation, inspect the outcome and explicitly
reload the Portal for a fresh token before another action. Cancellation cannot
undo a committed unlink or Form save. There are no mutation retries, automatic
reloads, Grid/Kanban writes, or inferred authorization rules in this helper.

## Subscribed list ownership and React rendering

`createPortalListOwner` from `/portals` owns an explicit collection read, its
complete criteria, accepted ordered rows and returned detail columns. It reuses
`createPortalCollection`; mounting or subscribing performs no request. Keep one
owner for an accepted Portal lifetime. Pass the existing visitor/session scope,
and advance `configurationRevision` whenever accepted configuration changes.
Destroy the old owner on replacement, logout or disposal. Ordinary React remounts
reuse the same owner and preserve its accepted page.

Every action accepts the current snapshot revision. `setCriteria` replaces the
complete criteria and `setField` selects another returned outer field; both retire
rows, paging, cell guards and child-plan eligibility without reading. Search,
view, sort and filter edits therefore require a subsequent explicit `readFirst`.
`readNext` preserves server order through the existing collection merger. A
cancelled read retires its request context and leaves a fresh explicit Load
available; late old responses cannot replace newer state.

A cleanup proposal exposes the server replacements. Inspect them, then explicitly
call `acceptCleanup` or `dismissCleanup` at that revision. Acceptance patches only
returned sort/filter properties, preserves other criteria and performs no read.
Errors and empty results are separate snapshot phases. Child plans use
`childFormRequest(revision, options)`; compose existing cell bindings with
`isCurrent: () => owner.isCurrent(revision)` to retire retained cell actions.

The optional `/react` `PortalList` component consumes the same subscribed owner.
Its stock shell supplies explicit Load, Next and Cancel actions and generic row
numbers. Supply `render={({ snapshot, owner }) => ...}` for custom markup, or use
`usePortalListOwner(owner)`. React remains an optional peer. Neither stock nor
custom rendering adds automatic reads, mutations, persistence or mutation retry.
The snapshot is a detached copy containing complete native records, **not safe
cell text**: custom renderers must honor returned detail display/privacy policy
and must never derive Save data from presentation. This is list/table ownership,
not a complete grid editor or support for every Portal layout.

### Manual read failure guidance

`PortalListSnapshot.failure` is optional for adapter compatibility. The SDK owner
emits `null` or a detached, readonly `PortalListReadFailure` with only `kind`
(`network`, `http`, `api`, `protocol`, `cancelled` or `unknown`) and `status`.
Status is an integer HTTP status from 100 through 599 for recognized HTTP/API/
protocol failures, otherwise `null`. Error messages, codes, causes and response
bodies are omitted. The existing generic `error` and Boolean read results are
unchanged. A new read, criteria replacement, success, cleanup or retirement clears
the previous failure; cancelled reads report `cancelled` without inferring why.

This small custom shell consumes that metadata through the shipped `PortalList`.
It renders fixed application copy, including a generic fallback for older
adapters. Rows and cleanup acceptance remain separate application presentation.

```ts
import { createElement } from 'react';
import { PortalList, type PortalListProps } from '@miniextensions/sdk/react';

export function PortalReadFailureList({ owner, readOptions }: PortalListProps) {
    return createElement(PortalList, {
        owner,
        readOptions,
        render: ({ snapshot, owner }) => {
            if (snapshot.phase === 'retired') return null;
            const failure = snapshot.failure;
            const message =
                snapshot.phase !== 'error'
                    ? snapshot.pending
                        ? 'Loading records…'
                        : ''
                    : failure?.kind === 'network' ||
                        (failure?.kind === 'http' &&
                            failure.status !== null &&
                            failure.status >= 500 &&
                            failure.status <= 599)
                      ? 'The Portal read could not complete. Choose Load records to try a fresh read.'
                      : failure?.kind === 'http' && failure.status === 403
                        ? 'Access to these Portal records was denied. Check the permitted view or contact the workspace owner.'
                        : 'The Portal read did not complete. Use an explicit fresh Load.';
            return createElement(
                'section',
                { 'aria-label': 'Portal read recovery' },
                createElement(
                    'p',
                    { role: snapshot.phase === 'error' ? 'alert' : 'status' },
                    message
                ),
                createElement(
                    'button',
                    {
                        type: 'button',
                        disabled:
                            snapshot.pending || snapshot.phase === 'cleanup',
                        onClick: () => {
                            void owner.readFirst(
                                snapshot.revision,
                                readOptions
                            );
                        },
                    },
                    'Load records'
                )
            );
        },
    });
}
```

These messages select presentation only. A 403 does not establish an expired
login, and a network or 5xx failure does not schedule a retry. Keep the captured
snapshot revision on controls; do not refresh it inside a retained handler.
Continue to replace owners and advance accepted configuration leases as above.
Only a new explicit read can restore row/action eligibility. The vanilla browser
starter still uses `createPortalCollection` and its existing generic request
feedback; it does not consume this list-owner snapshot or infer authentication
actions from a failed read.

### Renderer-neutral bounded criteria editors

`createPortalSortEditor` and `createPortalFilterEditor` from `/portals` prepare
one sort field/direction or one supported scalar/select condition. The shipped
stock recipes consume these same models. They do not read, evaluate record
membership, grant access or write records. Date, linked/computed filters and
nested groups remain outside this editor.

Pass the exact accepted Portal, collection snapshot and complete criteria, plus
an `isCurrent` guard bound to the list owner's accepted revision. Advance
`configurationRevision` on accepted configuration replacement. Each snapshot is
a detached copy; `subscribe` reports editor changes. Custom renderers use
`setField`, `setDirection` (sort), or `setOperator`/`setOperand` (filter), followed
by explicit `apply` or `clear`. Text/number operands use strings, checkbox uses
a boolean, and select operands use exact current choice-ID arrays. The model
uses the existing strict compiler, preserving text bytes and generic diagnostics.

Unrecognized/richer saved criteria and unknown saved choices remain in
`originalCriteria`; filter Apply/Clear requires `prepareReplacement` first.
Sort's explicit Apply replaces unresolved sorts. Editing alone changes no
committed criteria. Apply/Clear retires that model before `onApply` re-entry;
the callback must retire both editors and pass the complete criteria to
`PortalListOwner.setCriteria` for the accepted revision. Old rows, offset,
actions and paging then remain unavailable until a separate explicit Load.
Search, unrelated filters/sorts, flags and parent native data are preserved.
Server cleanup remains separately explicit and server-authoritative.

Optional `/react` `PortalSortEditor` and `PortalFilterEditor` accept an
owner-held `model` and a `render({ snapshot, model })` prop. Unmount removes the
subscription, not the prepared editor state; retain the model across ordinary
remounts. Destroy it on owner/page/criteria replacement or editor cancellation.
Retained handlers fail closed after observed owner/configuration changes,
including observed A→B→A; unobserved in-place restoration is not detectable.
The core subpath has no React dependency.

### Hosted summary refresh bridge

`refreshPortalSummaryFields` and `PortalSummaryRefreshOptions<RecordType>` from
`/portals` share the hosted Portal's bounded summary-read workflow. Pass
`fetchRecord`, the captured `generation`, `isLatestGeneration`, synchronous
`onFresh(record)` and synchronous `onStale()` callbacks. A failed read is retried
once immediately, preserving the legacy two-read limit. The current owner gets
one successful record application or one stale-summary notification after two
failed reads. The helper returns `Promise<void>`.

The host owns generation allocation and an actual accepted owner lease. Its
predicate must reject replaced or unmounted owners and changed session, record
or configuration, including observed A→B→A. A counter alone is sufficient only
when the host advances it on every relevant replacement. Never allocate a new
current generation from an already-retired handler. The helper checks ownership
before each read and after settlement; an already-started read is not aborted,
but its retired result cannot invoke either callback or cause another read.

`fetchRecord` must only read. Signing, authentication, tRPC, backend persistence,
record identity, Redux/state dispatch and warning/Retry UI stay in the host.
This function neither replays a save nor interprets a failed read as permission
to switch accounts or recover authentication. Callbacks and ownership predicates
must be synchronous. Their exceptions propagate; application failure never
retries the read or becomes a stale-summary warning.

The existing monorepo adapter is not changed by this SDK addition. Its ordinary
success/failure and latest-generation behavior is retained, with two deliberate
hardening differences for future adoption: already-retired invocations do not
start a read, and a throwing `onFresh` is not treated as a transport failure.
Host adoption must bind the existing owner's mount/session/record/configuration
lease and keep its transport, dispatch and warning UI in place. This bridge does
not replace `createPortalListOwner` or create another persistent Portal owner.

## Session-owned inline edits in an existing host

`createPortalInlineEditQueue<Value, Request, Result>` owns native in-memory
pending intents, debounce, per-cell coalescing, sequential transport and
conditional rollback. Create one queue per visitor session and inject the real
host `commit(request)` and `committedValue(result, cell)` functions. Each
`enqueue` supplies the native value, captured request and existing host writer,
success, error, batch-settled and idle callbacks. No SDK client or fabricated Form
is needed. Authorization remains in the canonical mutation.

New edits remain admissible during an earlier request, including A → B → A.
A failed request never overwrites a newer pending intent, and never replays
itself. Once a cell settles, its baseline is discarded; the next explicit edit
uses the caller's current committed value. A later explicit edit is a new
intent, not a claim that an unknown transport outcome did not commit.

Grid unmount alone must not dispose a session queue. `dispose()` retires new
admission and undispatched entries while allowing already-started transport and
its callbacks to settle. Keep those callbacks bound to their original session;
shorter-lived presentation/read callbacks must independently guard replacement.
`flush()` explicitly dispatches the current batch; newer intents retain their
own zero-delay batch. `hasPending()` is false inside the
final `onIdle` callback. Native optimistic values stay in the injected host
writer. The queue retains only pending requests, generations and committed
baselines; it creates no parallel Form store.

`createPortalCellBinding` also accepts an optional `PortalCellDraft` interface
(`read`, `write`, `revision`, `dirty`, `markSaved`). The caller owns its lifetime
across renderer teardown. It can adapt an existing store without fabricating
a Form or SDK client. Its default
standalone direct-Save, schema admission and `RecoveryJournal` policy remain in
force; injecting a draft does not opt a host into those restrictions or grant a
mutation capability. Existing hosts use the queue directly to preserve their
supported field policies and native transport.
