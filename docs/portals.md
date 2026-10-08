# Headless Portal collections

`@miniextensions/sdk/portals` wraps the existing authorized Portal reads and
child Form metadata. It has no DOM, React, renderer, or storage. Readable
child-prefill formatting reuses the formulas formatter and its runtime
dependencies. This is a development preview: use a built TGZ, or
[install, check and pack a source checkout](../README.md#build-an-archive-from-source).
Install the supplied private archive using the
[runtime quickstart](runtime.md#packaged-form-quickstart); this package has not
been published to npm. The core client uses the existing miniExtensions APIs
and the visitor's current session; the server retains authorization.

A collection binds one loaded `portal_loaded` result, configured linked field,
custom view, criteria and application owner/revision. It does not grant access,
load a child, save, unlink or reload automatically. Advance the owner revision
on every visitor, connection, session, token or context transition, including
anonymous visitors and A → B → A. Credential equality alone cannot identify
those transitions.

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
