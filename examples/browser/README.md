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
even when a retained `allowAddingNewOptions` flag is true. Conditional option
visibility still requires an application evaluator; this starter does not
evaluate option conditions.

The example imports its draft store and load/save helpers from
`@miniextensions/sdk/forms` in the installed archive. `src/main.ts` owns visitor
revisions, requests, cancellation, and when to discard drafts.

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
- Attachment fields let you select and upload a file. Uploading creates a file
  at the authorized destination; **Save** attaches its returned value to the
  record. There is no upload or submission retry.
- Configured editable records expose **Delete this record** with confirmation.
- Existing Portal child records can load and add comments when the parent
  permits comments.

The custom renderer deliberately leaves advanced presentation to your app:
conditional field or select-option visibility, multi-page navigation, signatures, calendar
pickers, dynamic linked-filter values, custom validation presentation, and
CAPTCHA widgets. The server still enforces those extension rules. To use a
CAPTCHA-enabled Form, integrate the configured widget and supply its token in
`captchaVal`; this example supplies `null`. It does not disable the Form's
configuration.

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

- **Search** loads page one. **Next page** appends the next opaque offset and
  merges the returned table data without duplicating rows. After a failed or
  cancelled page request, choose **Load records** before paging or opening a
  child. Returned filter/sort cleanup requires **Reload**; this example stores
  no end-user criteria to reconcile automatically.
- **Open Form** loads the configured edit child for a returned record.
  **Create record** loads the configured create child and preserves the inverse
  link to the Portal user. Loading either Form makes no write.
- Editable Grid views expose **Edit cell** and an explicit **Save cell**. Linked
  cells use the Portal's authorized selector. After saving, the current Portal
  user's record is refreshed. Choose **Load records** before paging or opening
  a child again. If that refresh fails, choose **Reload**.
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
