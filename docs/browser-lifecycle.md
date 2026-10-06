# Browser starter and lifecycle

The supplied SDK archive includes a complete TypeScript Form and Portal
application in `examples/browser`. It uses the installed SDK, esbuild and native
browser controls. You can copy it into your own project without a private
repository checkout. The source is a replaceable application example; it does
not add a renderer or framework dependency to the SDK's public exports.

## Copy and run

Use Node.js 22+ and the exact archive supplied to you. Replace the absolute
path below. Extract the starter and documentation together so its
`../../docs` links still resolve; the root SDK source and build output are not
needed in this copied project.

```sh
SDK_ARCHIVE="/absolute/path/to/miniextensions-sdk-0.1.0-alpha.0.tgz"
mkdir customer-app
tar -xzf "$SDK_ARCHIVE" -C customer-app --strip-components=1 \
  package/examples/browser package/docs package/README.md \
  package/LICENSE package/THIRD_PARTY_NOTICES.md
cd customer-app/examples/browser
npm install --ignore-scripts --no-audit --no-fund "$SDK_ARCHIVE"
npm run typecheck
npm run build
npm run dev
```

The explicit archive argument replaces the starter's checkout-relative SDK
dependency and updates its local lockfile integrity. Keep that supplied archive
available when reinstalling this project. The SDK is private and has not been
published to npm; installing by its package name is not this delivery route.

Open `http://127.0.0.1:34851`. `npm run build` writes a static bundle and assets
to `.generated` and exits. `npm run dev -- --port 34852` chooses another
loopback port. This creates a local application; registering or publishing a
Site is a separate action.

Enter the published share ID and the exact origin serving its miniExtensions
APIs. Use a durable API origin for a continuing demo: a branch preview may be
retired after its PR merges. The deployment must permit requests from your
application's origin. A configured Form or Portal, its actual visitor inputs
and the returned permissions determine the available actions. No SDK key or
Airtable credential is required in this app. An optional record ID opens an
edit Form only when that published configuration permits it.

The [starter README](../examples/browser/README.md) describes its controls.
The [runtime](runtime.md), [Form](forms.md), [Portal](portals.md),
[authentication](auth.md) and [selection UI](ui.md) guides describe the helpers
used by its actual handlers.

## Owner, session and disposal

[`src/main.ts`](../examples/browser/src/main.ts) owns separate visitor clients,
sessions, revisions, pending actions and drafts. Authentication returns a
credential result; the app deliberately applies a current result and reloads
the screen. Browser cookies or another visitor's session do not authenticate
this client. Sessions are memory-only in this example.

Capture the current owner, client, session and revision before an asynchronous
action. Apply its result only while that context is still current. Advance the
owner revision on visitor, connection, credential, token or loaded-context
transitions, including A → B → A. Abort old work and dispose old controls and
collections when replacing their context. Use both the mounted control's and
its selection model's disposal methods where they are separate objects.

Ordinary pagination belongs to the already bound collection; do not advance
the owner revision simply because **Next page** was selected. Changing a
visitor, table, view or search criteria retires the old collection and its
child plans. Draft/session teardown and the unknown-operation journal have
different lifetimes: clearing a draft or logging out cannot establish that an
unknown create did not commit.

## Native values and deliberate saves

[`src/fields.ts`](../examples/browser/src/fields.ts) renders returned schemas.
Keep the loaded native baseline, including hidden prefills and fields you do
not render. Write dirty values by Airtable field ID: numbers remain numbers,
checkboxes remain booleans, selects use names, and linked fields use record-ID
arrays. Do not replace an invalid numeric input with `null` or convert every
field to text. Unsupported/computed values stay intact.

The SDK's selection controls already own visible labels. Mount their returned
elements directly rather than adding another field label around them. Keep
focus outlines, readable text and the controls' `[hidden]` semantics when
changing the example's scoped styles.

Save only from a deliberate action. The example blocks a second action before
awaiting the first, checks owner/context again before accepting responses, and
keeps the draft after normalized server validation. After success, adopt a
fresh baseline before editing again. Local validation and field visibility do
not override server permissions or configured rules.

## Paging and child return

[`src/portal.ts`](../examples/browser/src/portal.ts) creates a collection for the
loaded Portal, configured field, view, criteria and owner revision. Read a
fresh first page before opening a child. Only accepted main-list membership
grants the configured child action; cached nested labels do not grant access.

**Next page** uses that same collection and opaque cursor. A failed or
cancelled dispatched read requires a fresh first-page read before more paging
or child access. Returned criteria cleanup requires explicit reload and
acceptance; it is not permission to keep using stale rows.

Create/edit child requests use the configured child ID and parent context.
After a successful child save, accept the returned current parent state,
retire the prior collection, read a fresh list, and reopen through current
metadata. Do not reconstruct hidden relationship fields from labels or make
up child IDs. Advanced Gallery/Calendar/Map/Chart presentation, dynamic filter
widgets, conditional pages and CAPTCHA remain application-owned.

## Upload once, then save

The attachment handler in `src/main.ts` uploads one deliberately selected
file through the loaded Form's authorized attachment field. The returned
reference is appended to the native draft and marked dirty immediately after
success; the successful file selection is cleared before another action.
**Save** then persists that reference. Uploading bytes alone does not save the
record.

Keep upload/save actions single-flight. If adapting this to a file queue,
remove each successful file from that queue as soon as its reference is
merged. A validation error or another Save must not upload that completed
file again. Preserve the reference in the current draft, not a request to
replay its upload. A cancelled or failed upload/save may have changed server
state; explicit fresh inspection is required before choosing a new action.
The SDK does not retry a mutation automatically or undo a committed upload.

## Inspect an unknown create

[`src/recovery.ts`](../examples/browser/src/recovery.ts) keeps an example-local
document journal separate from draft clearing. An attempt is bound to its
canonical owner/context and a local operation ID before dispatch. An unknown
create remains nonreplayable across the app's Reload, logout and context
teardown. Explicit logout and Disconnect scrub reference input from every
attempt in the document journal while keeping its unknown-operation guards.

Use the current authorized Portal collection to select a record deliberately,
then load its configured edit Form and inspect the returned data. A matching
title, a local marker, or one visible row is not a server commit receipt.
Zero, multiple or unavailable visible candidates leave the original outcome
unknown. A standalone Form without a permitted listing needs an authorized
record context; the app cannot discover inaccessible records.

After an uncertain edit or upload, reopening the same known request through
the ordinary **Open Form** action also starts inspection from the newly
returned server values. An older cached dirty draft cannot mask that response
or become saveable through acknowledgment. The earlier visible dirty input is
retained separately under **Earlier local input (reference only)**; attachment
entries retain names, not upload URLs, references or file bytes. These values
are never merged into the fresh draft automatically. Reusing any value requires
a deliberate new edit after inspection.

Same-person Reload retains this reference input. **Clear this visitor's session**
and **Disconnect** remove the journal's retained field labels, values and
attachment names across both visitor slots, so anonymous reconnect cannot
display them. This does not establish whether an earlier write committed or
unlock its replay.

Fields configured with `obscurePassword: true` are excluded before reference
journaling, so recovery does not reveal their masked values. For rendered,
dirty attachment fields, the reference retains filenames from successful
uploads even though the native attachment display is noneditable; read-only
or computed fields remain excluded. No attachment IDs, URLs, references or
file bytes enter this reference output.

If the user acknowledges that the old attempt may have committed, a separate
blank draft can start a new local operation. It must not replay the original
request or remove the original unknown journal entry. This is a deliberate
new action, not an exactly-once guarantee. Stronger commit certainty would
require a canonical server operation receipt, which these APIs do not supply.

The journal is document-local, not durable across a browser page refresh. It
does not store credentials or signed upload URLs. A new page cannot infer an
earlier outcome; inspect server state before starting another create. The
example's recovery UI does not replace your application's persistence policy.

## Execution environment troubleshooting

These settings belong to your development or QA environment, not the SDK or
the deployed app. Use the proxy and trusted certificate configuration supplied
by that environment. For Node's built-in environment-proxy support,
`NODE_USE_ENV_PROXY=1` requires Node 24.0+ or 22.21+; `--use-env-proxy` requires
Node 24.5+ or 22.21+. Keep credentials out of source and diagnostic output.

If an outbound browser proxy also intercepts the loopback preview, configure
its bypass list for `localhost,127.0.0.1`. Configure the environment's approved
trusted CA for Node (for example its supplied `NODE_EXTRA_CA_CERTS` path) and
the browser's supported managed trust route. If browser trust cannot be
configured in that environment, report that capability gap rather than
changing certificate verification in the SDK or application.

## Verification limits

The package check installs the exact packed SDK in a clean copied starter,
checks its archive integrity and dependencies, compiles all source, builds the
static assets, and exercises synthetic Portal/recovery scenarios. These checks
do not certify a particular deployment, visitor, CORS origin or all configured
features. Validate your selected live workflow and record the exact package,
backend and app versions plus the disposition of only your owned test data.
