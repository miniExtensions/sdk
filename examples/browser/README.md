# Custom Form and Portal example

This is a small TypeScript browser application. It imports the SDK from a
packed archive installed in its own project, then serves the application at a
different origin from miniExtensions. It has no React or miniExtensions
source-code dependency.

## Run

Use Node.js 22 or newer. From the SDK repository root:

```sh
pnpm install --frozen-lockfile
pnpm pack
cd examples/browser
npm install
npm run typecheck
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

## Connect

1. Publish a Form or Portal in miniExtensions.
2. Create a publishable key in that workspace's Settings. Keep the key for this
   browser session; the Settings card reveals it once.
3. Enter the exact origin that serves the SDK endpoint, the key, and the
   extension's published share ID. For a preview, use its preview origin.
4. Choose **Connect and load**. An optional record ID opens a direct Form edit
   if that Form permits it.

The key stays in page memory and is not stored in a URL, log, cookie, or browser
storage. **Disconnect** clears the key and both visitor sessions. The SDK sends
cross-origin requests with `credentials: 'omit'`.

## Form workflow

The page renders field-ID controls from the published payload. It supports
text, email, URL, phone, multiline/rich text, numbers, currency, percentages,
dates, checkbox, and select inputs. DateTime inputs retain an explicit ISO
string; there is no implicit timezone conversion. Complex and computed values
are displayed intact rather than converted to text for saving.

- Choose **Save** to submit. Server validation is shown next to the Form; a
  failed validation keeps your values. A successful standalone create disables
  repeated submission until you choose **Reload**.
- Linked fields offer an authorized search and paginated selection. Selecting
  choices only edits the local draft; **Save** writes the relationship.
- Attachment fields let you select and upload a file. Uploading creates a file
  at the authorized destination; **Save** attaches its returned value to the
  record. There is no upload or submission retry.
- Configured editable records expose **Delete this record** with confirmation.
- Existing Portal child records can load and add comments when the parent
  permits comments.

The custom renderer deliberately leaves advanced presentation to your app:
conditional field visibility, multi-page navigation, signatures, calendar
pickers, dynamic linked-filter values, custom validation presentation, and
CAPTCHA widgets. The server still enforces those extension rules. To use a
CAPTCHA-enabled Form, integrate the configured widget and supply its token in
`captchaVal`; this example supplies `null`. It does not disable the Form's
configuration.

## Portal workflow

Choose a configured linked table and view, then **Load records**. The actual
linked-table read both returns the visible records and establishes the
server's permitted actions for those records. The example does not manufacture
edit capabilities or bypass a custom view.

- **Search** loads page one. **Next page** appends the next opaque offset and
  merges the returned table data without duplicating rows.
- **Open Form** loads the configured edit child for a returned record.
  **Create record** loads the configured create child and preserves the inverse
  link to the Portal user. Loading either Form makes no write.
- Editable Grid views expose **Edit cell** and an explicit **Save cell**. Linked
  cells use the Portal's authorized selector. After saving, the current Portal
  user's record is refreshed.
- Configured unlink actions require confirmation. The example retires that
  parent token after unlink; use **Reload** before taking another action.
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
session cannot populate the active visitor's screen or session. Sessions are
memory-only, so refreshing the page starts them again anonymously. Hosted
miniExtensions login cookies cannot authenticate either visitor.

The example cancels pending requests when visitors or connections change.
Cancelling a network request cannot undo an already committed server write.
Inspect the records after cancellation or a network failure before submitting
again.

## Adapt it

- `src/main.ts` owns connection, visitors, authentication, Form drafts and
  saves, file uploads, and comments.
- `src/portal.ts` owns linked-table reads, page merging, child Form access,
  Grid edits, selectors, unlink, and Kanban category changes.
- `src/fields.ts` is the replaceable field renderer. Values and dirty lists use
  Airtable field IDs; login credentials use the configured field names.
- `dev.mjs` bundles the installed SDK and serves three local static assets.

Use the [runtime guide](../../docs/runtime.md) for full method contracts and
production application session ownership. Use normal published extension
configuration to change access; a publishable key covers the workspace's
supported operations but never replaces visitor permissions.
