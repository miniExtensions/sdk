# Custom Form and Portal example

This is a small TypeScript browser application. It imports the SDK from a
packed archive installed in its own project, then serves the application at a
different origin from miniExtensions. It has no React or miniExtensions
source-code dependency.

## Run from the supplied archive

This complete example ships in the SDK archive. Follow the
[copy and run instructions](../../docs/browser-lifecycle.md#copy-and-run) to
extract `examples/browser` and `docs` into the same customer project, then run:

```sh
cd customer-app/examples/browser
npm install --ignore-scripts --no-audit --no-fund /absolute/path/to/miniextensions-sdk-0.1.0-alpha.0.tgz
npm run typecheck
npm run build
npm run dev
```

The explicit archive argument replaces the original checkout-relative SDK
dependency and refreshes its lockfile integrity. The copied project needs no
private checkout or root SDK source/build output. Keep the copied documentation
at `customer-app/docs` so this README's relative guide links resolve.

## Run from a source checkout

Use Node.js 22 or newer. From the SDK repository root:

```sh
pnpm install --frozen-lockfile
pnpm pack
cd examples/browser
npm install
npm run typecheck
npm run build
npm run dev
```

Open `http://127.0.0.1:34851`. To choose another local port:

```sh
npm run dev -- --port 34852
```

The example's dependency points to the SDK archive in the repository root.
After changing the SDK, pack it again and reinstall that archive:

```sh
npm install ../../miniextensions-sdk-0.1.0-alpha.0.tgz
```

The development server watches the example's TypeScript files. Reload the
browser after a change; it does not automatically replay requests.

`npm run build` produces the browser bundle and static assets in `.generated`
and exits. It starts no server or watch loop. From the SDK repository root,
`pnpm check` also copies this example from the installed packed SDK into an
isolated customer project, installs the exact archive with the customer
command, then typechecks and builds it. That check does not reuse an existing
installation or copy checkout source into the customer. It verifies the archive
pin/integrity, committed registry resolutions and copied documentation links. It also
executes the actual copied Portal example against that installed archive to
check pagination, criteria retirement, child context and visitor transitions.

## Connect

1. Publish a Form or Portal in miniExtensions.
2. Enter the exact origin that serves the miniExtensions APIs and the
   extension's published share ID. Use a durable API origin for a continuing
   application; a PR preview may be retired after merge.
3. Choose **Connect and load**. An optional record ID opens a direct Form edit
   if that Form permits it.

**Disconnect** clears both visitor sessions. The SDK sends cross-origin
requests with `credentials: 'omit'` and explicit visitor credentials. The API
deployment must allow its public tRPC routes and `miniext-context` header from
this example's origin; the client uses the existing v1 and tRPC endpoints.

## Form workflow

The page renders field-ID controls from the published payload. It supports
text, email, URL, phone, multiline/rich text, numbers, currency, percentages,
dates, checkbox, and select inputs. DateTime inputs retain an explicit ISO
string; there is no implicit timezone conversion. Complex and computed values
are displayed intact rather than converted to text for saving.

Select controls use the published choice-ID allowlist and numeric maximum,
retain existing unavailable choice names for removal, and keep custom labels
separate from saved native names. A nonempty allowlist disables **Add a choice**
even when a retained `allowAddingNewOptions` flag is true. In a supported one-page Form,
configured choice conditions use the installed bounded scalar helper.
Unsupported predicates show an unavailable status; the projection limits
below apply.

When a published editable, unmasked single-line text field enables address
autocomplete, typing reads suggestions after an 800 ms debounce. Choose
a suggestion to accept its description, then its formatted address if that
selection is still current. Accepted edits respect the published character
limit. Failed suggestion reads keep the native draft available for manual
entry and offer an explicit retry. Hiding an address field or suspending the
Form retires its pending address reads without clearing accepted values or
submitting a Save.

Unfinished composing text stays in the address input without a character cap
or suggestion request until composition ends. Arrow keys, Enter and Escape
remain available to the composition; ordinary keyboard selection resumes
after the final text commits. The synthetic DOM-event proof does not establish
OS IME integration.

Arrow keys show a contrasting highlight while input focus stays in place;
Enter accepts that highlighted suggestion without submitting the Form.
The existing Google-backed results display the official Google Maps logo
outside the selectable listbox, inside its bordered suggestions container.
The unchanged embedded PNG displays at 98 × 18 pixels on white with the
required clear space; closing suggestions hides their attribution too.
Custom Content Security Policies must allow `data:` in `img-src`. Keep
the attribution visible with these results and use a different presenter for
non-Google adapters. See [asset provenance and policies](../../THIRD_PARTY_NOTICES.md#google-maps-attribution-asset).

The example imports its draft store and load/save helpers from
`@miniextensions/sdk/forms` in the installed archive. `src/main.ts` owns visitor
revisions, requests, cancellation, and when to discard drafts.

When the published `promptUserBeforeSubmission` setting is true, **Save** opens
**Review your answers** before the final submission. **Edit**, Escape and closing
the dialog preserve the native draft and perform no Save. **Confirm** submits
the captured full native values and dirty IDs once through the existing Save
runner. A validation response preserves your draft and displays the server's
errors; an unknown outcome keeps submission blocked until explicit inspection.
Review may open with an empty required answer: the server remains authoritative
for required, readonly, computed and conditional-field validation.

This review recipe supports a one-page manual Form with scalar section
conditions, containing direct
single-line/multiline text, email, URL, phone, number, currency, percent, rating,
checkbox and barcode fields, including readonly scalar answers. It presents
plain text in published field order, omits canonical empty/conditionally hidden
answers, and masks nonempty single-line passwords as `••••••••`. A visually
hidden title retains its semantic accessible name. Numeric zero remains a
review answer; unchecked checkboxes, zero ratings and blank barcode text do not.
URLs are displayed as text, with no link or embedded content.
Barcode answers keep the starter's existing readonly display; review adds no
barcode editor.

Review uses the installed canonical scalar section projection as a separate copy;
it never sends that projection as the Save record. Preparing review makes the
fields inert and retires pending address prediction/detail intents before
capture. Confirmation belongs to the current visitor/client/session, loaded
Form, configuration/context, draft handle and actual draft revision. An edit,
including edit-away-and-back, Reload, Discard, disconnect or owner transition
invalidates it. Returning to Edit permits fresh typing without repeating an old
address query. Pages, compute/automatic submission, linked filters,
linked/lookup/computed fields, selects, dates, rich text and other complex
renderers remain outside this recipe; unavailable review blocks submission
instead of presenting an incomplete preview.

One-page field conditions use the installed Form visibility helpers with the
complete accepted native draft. Direct scalar drivers recompute presentation
after accepted edits, including readonly targets and configured frontend
section propagation. Hidden controls retain their native values and dirty IDs
for Save. Explicit edit-mode `hideFieldIfEmpty` supports the flat direct scalar
subset, including readonly targets: null/blank values, unchecked checkboxes,
rating zero and blank barcode text hide; ordinary numeric zero stays visible.
The flag is inactive in create mode. Unsupported predicates, computed/linked
drivers, richer empty-hiding targets and section contexts with active empty
hiding show an unavailable-field message and block Save until resolved.
See the [visibility contract](../../docs/forms.md#one-page-conditional-field-visibility)
for lookup defaults, preview and section boundaries. This is presentation;
the server still enforces its published rules.

Field visibility and configured choice availability both recompute after
accepted edits while retaining the native draft. Their record contracts
differ: field predicates use the complete unfiltered draft, while choice
predicates need a separate conditional-record projection. The starter uses
`createScalarFormRecordProjection` for absent or explicit `one-page` mode
with direct scalar dependencies: every field predicate reads the complete
accepted draft, then condition-hidden IDs are removed only from an evaluation
copy. Hiding or revealing a driver recomputes choice availability while all
native values and dirty IDs remain available for Save. Canonical section
projection recognizes retained titles even when displayed headers are disabled;
screen visibility still honors the enable flag. Active linked filters and
referenced linked/lookup/computed drivers remain unsupported. Section plus
active edit empty hiding remains blocked. Pass the published order verbatim;
see the [projection recipe](../../docs/forms.md#one-page-conditional-field-visibility).
Frontend visibility results never replace the choice projection.

- Choose **Save** to submit. Server validation is shown next to the Form; a
  failed validation keeps your values. A successful standalone create disables
  repeated submission until you choose **Reload**.
- Unsaved values, selected links, created choices, and completed upload
  references survive Visitor A/B switching and returning from a child Form to
  its Portal. Drafts belong to the visitor, Form, record, and parent Portal
  field. **Discard draft** resets only that Form to its loaded values without
  saving. It does not undo a completed upload or a created Airtable choice.
- Linked fields offer an authorized search and paginated selection. Selecting
  choices only edits the local draft; **Save** writes the relationship.
- Configured conditional linked filters expose **Load conditional filters**.
  This explicit action shares one token-only metadata read per loaded Form,
  resolves root/direct URL prefills from the server, including when filter
  controls are configured hidden. Search each visible filter by its
  current linked-table name and choose a returned record. Choices retain both
  native record IDs and exact primary-value strings, including duplicate labels.
  Changing an earlier choice clears downstream filter choices, linked options
  and paging; it preserves the raw linked-record draft. **Search choices** uses
  the copied filter map, and **Save** nests that map under the outer linked field.
- Attachment fields let you select and upload a file. Uploading creates a file
  at the authorized destination; **Save** attaches its returned value to the
  record. There is no upload or submission retry.
- Configured editable records expose **Delete this record** with confirmation.
- Existing Portal child records can load and add comments when the parent
  permits comments.

The custom renderer deliberately leaves advanced presentation to your app:
conditional field or choice presentation beyond the bounded contracts above,
multi-page navigation, signatures, calendar pickers, custom validation presentation, and
CAPTCHA widgets. The server still enforces those extension rules. To use a
CAPTCHA-enabled Form, integrate the configured widget and supply its token in
`captchaVal`; this example supplies `null`. It does not disable the Form's
configuration.

The conditional-filter integration supports unique configured field IDs with
current fields/names returned by the Form-authorized metadata read. Name
references, duplicate IDs, malformed rules, or missing metadata are explicitly
unavailable; it does not guess schema or emulate the native renderer's skipped
descriptors. This presentation limitation preserves each original
`disableAddingIfConditionalFilterIsEmpty` and
`disableRemovingIfConditionalFilterIsEmpty` rule independently: a missing,
null, or empty primary value blocks only the configured transition. With both
flags false, the existing authorized option read and local link changes remain
available. Server validation or sanitization still decides which relationships
can be saved, so a successful save alone does not prove a proposed link was
accepted. Read-only and computed fields keep their existing restrictions.

Connect forwards only browser URL `prefill_*` keys into the root/direct load,
preserving decoded strings and repeated keys as arrays. A filter prefill key
uses its current linked-table field name. Only a scalar string is supported,
and only the returned `prefillValue` resolves a selection. Repeated values are
reported as unsupported. Click **Load conditional filters** before reading
options or saving a hidden-prefill Form; the button remains visible in hidden
mode. Portal child URL-prefill propagation remains outside this example's
integration. There is no automatic metadata retry, discovery paging cursor,
new schema read, or additional mutation permission.

Custom static and dynamic Form headers also belong to your app. Render them
from the published settings and record metadata when needed. This example uses
`extensionName`, falling back to “Custom Form”.

## Portal workflow

Choose a configured linked table and view, then **Load records**. The actual
linked-table read both returns the visible records and establishes the
server's permitted actions for those records. The example does not manufacture
edit capabilities or bypass a custom view.

The example imports its collection and child-request helpers from
`@miniextensions/sdk/portals`. Each collection captures the selected table,
view and search criteria; changing them retires its reads and child plans.
Only records in its accepted main list can open an edit child. Nested labels
and cached records do not grant that access.

The table selector also accepts a valid lookup whose result is linked records.
It uses that result's target table while keeping the outer Portal field ID for
reads and configured existing-child edits. Lookup tables do not offer create or
parent unlink actions in this starter. Invalid or non-linked lookup results
are omitted; this does not convert a computed lookup into a writable link.

- **Search** loads page one. **Next page** appends the next opaque offset and
  merges the returned table data without duplicating rows. After a failed or
  cancelled page request, choose **Load records** before paging or opening a
  child. Returned filter/sort cleanup requires **Reload**; this example stores
  no end-user criteria to reconcile automatically.
- **Open Form** loads the configured edit child for a returned record.
  **Create record** loads the configured create child and preserves the inverse
  link to the Portal user. Loading either Form makes no write.

Child filter-prefill snapshots belong to the dispatched plan and accepted Form
load. Create cascades use configured dynamic prefills plus static child overrides;
the parent prefill toggle suppresses only the dynamic source. Edit children use
an empty query. Parent browser/root queries and raw request-query keys never enter
child cascades or Save. Save sends dynamic-only values with the last duplicate
winning, preserving the modal parent context and full native draft; the backend
uses token-bound load provenance. Cascade duplicate arrays are a conservative
refusal, not canonical last-value parity. Static keys replace whole dynamic values.

Reopening, owner replacement, returning to the Portal, or successful Save/delete
retires those snapshots. Reads require explicit Load/Search; failed prefills permit
explicit Load retry, while user edits prevent old prefill replay. Malformed settings
show a diagnostic without pruning native data or denying otherwise-allowed edits.

- Editable Grid views expose **Edit cell** and an explicit **Save cell**. Linked
  cells use the Portal's authorized selector. After saving, the current Portal
  user's record is refreshed. Choose **Load records** before paging or opening
  a child again. If that refresh fails, choose **Reload**.
- Inline select cells use the same static policy control as Forms: configured
  choice IDs limit new selections, saved values remain native choice names,
  and numeric maxima permit removal from an existing over-limit value.
  Unchanged saves retain native selection order. The effective child Form
  field config takes precedence over detail config. There is no inline Add
  Choice action or conditional option-visibility evaluator. A cached draft
  survives A → B → A, but its expired owner cannot save; **Load records** fetches
  a fresh view before opening another editor. Cancelled, replaced and disposed
  editors cannot dispatch.
- The canonical Portal route blocks inline edits for nonempty conditional
  fields/options or active linked filters. This includes option entries that
  only customize a label, even with `enableConditionalOptions` disabled. The
  starter omits their inline action; use an eligible configured child Form for
  its select labels and draft workflow. Full conditional presentation remains
  application-owned.
- Configured unlink actions require confirmation. The example retires that
  parent token before dispatching unlink; use **Reload** before taking another
  action, including after failure or cancellation.
- Kanban views with a configured single-select category offer **Move category**.
  Category changes only occur after that button is selected.

This example presents table data with its declared visible detail fields. It
does not recreate the hosted Portal's Gallery, Calendar, Map, or Chart
presenters, conditional view presentation, advanced filter builder, or custom
menu. Those interfaces can call the same typed runtime APIs.

## Authentication and visitor isolation

Password verification and login return credentials without changing the SDK's
session. This example's **Verify and use password**, **Log in and use session**,
and **Confirm and use session** actions explicitly apply successful credentials
to the active visitor. Choose **Reload** to load the authenticated screen.

Visitor A and Visitor B have separate clients and session maps. Switching
visitors cancels pending UI work; a response from a different visitor or older
session cannot populate the active visitor's screen or session. Returning to
a cached Portal keeps its inline draft, but requires **Load records** before
paging or opening another child Form. Sessions are
memory-only, so refreshing the page starts them again anonymously. Hosted
miniExtensions login cookies cannot authenticate either visitor.

A successful **Reload** replaces that visitor's drafts with the freshly loaded
screen; a failed or cancelled reload retains them. Successful save or deletion
clears only the affected draft. Logout, authentication changes, reconnecting,
and disconnecting clear the corresponding visitor's drafts with its session.
The separate document-local recovery journal keeps unknown create attempts
nonreplayable across these app actions; clearing a draft/session is not evidence
that its dispatched create did not commit.

**Clear this visitor's session** and **Disconnect** also remove the document
journal's retained reference input for both visitor slots. Its uncertain-operation
guards remain, so anonymous reconnect cannot reveal those earlier labels,
values or attachment names or repeat an uncertain create. Same-person **Reload**
keeps the reference input available for inspection.

The example cancels pending requests when visitors or connections change.
Cancelling a network request cannot undo an already committed server write.
Inspect the records after cancellation or a network failure before submitting
again.

## Unknown create recovery

After a dispatched create loses its response, inspect current authorized
records and deliberately select one to load its configured edit Form. Do not
infer success from a title, QA marker or matching row. Missing, multiple or
unavailable records leave the original outcome unknown.

The original attempt stays nonreplayable. With an explicit acknowledgement that
it may already have committed, the user can start a separate blank draft with
a new operation ID. This does not prove exactly-once creation or automatically
repeat the old request. The journal is document-local; a page refresh does not
recover its history. See the
[integrated recovery flow](../../docs/browser-lifecycle.md#inspect-an-unknown-create)
before adapting it to a production application.

## Adapt it

- `src/main.ts` owns connection, visitors, authentication, Form drafts and
  saves, file uploads, and comments.
- `src/portal.ts` binds collection criteria and renders helper snapshots and
  child requests. It also owns Grid edits, selectors, unlink, and Kanban
  category changes.
- `src/fields.ts` is the replaceable field renderer. Values and dirty lists use
  Airtable field IDs; login credentials use the configured field names.
- `src/recovery.ts` keeps safe document-local operation metadata separate from
  draft/session clearing. It does not store credentials or signed upload URLs.
- `dev.mjs` bundles the installed SDK and serves three local static assets.

Use the [runtime guide](../../docs/runtime.md) for full method contracts and
production application session ownership. Use normal published extension
configuration to change access; the existing server handlers retain visitor
permissions and all record, field and action checks.
