# miniExtensions SDK

Build a custom Form or Portal against an existing published miniExtensions
configuration. The SDK returns native metadata and provides typed runtime
operations; the existing server checks visitor, record, field and action access.
Your application renders the interface and owns its lifecycle. Optional Form,
Portal, authentication and selection helpers, plus a local formula engine, are
included.

Start with the supplied browser application. Use the import and operation maps
below when adapting it or asking an agent to build a different interface. A
configuration property being typed does not mean the starter implements its UI.

## Install and run the browser starter

The package is private and **has not been published to npm**. Use the exact
supplied `.tgz`, Node.js 22 or newer and an ES2022-capable browser bundler. ESM,
CommonJS and TypeScript declarations are included. Direct script-tag/CDN
imports are not supplied. Runtime browsers need native `fetch`, `TextEncoder`,
`AbortSignal.any` and `AbortSignal.prototype.throwIfAborted`.

Run this in a new directory, replacing the archive path with its actual absolute
path. It copies the complete shipped starter and keeps its documentation and
license links intact:

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

Open `http://127.0.0.1:34851`, enter the API origin and published share ID, then
choose **Connect and load**. Mutations require their explicit controls, such as
**Save**, **Upload** or **Save cell**. `npm run build` writes static assets to
`.generated` and exits; `npm run dev -- --port 34852` chooses another loopback
port. This starts your local application; it does not publish a hosted site.

The explicit archive argument replaces the starter's checkout-relative SDK
dependency and updates its lockfile integrity. Keep that archive available for
reinstallation. You need no private repository checkout. Follow the shipped
[copy-and-run guide](docs/browser-lifecycle.md#copy-and-run) and
[starter controls](examples/browser/README.md).

For an existing application, install the same archive and import its package
name:

```sh
npm install /absolute/path/to/miniextensions-sdk-0.1.0-alpha.0.tgz
```

```ts
import { createMiniExtensionsClient } from '@miniextensions/sdk';

const client = createMiniExtensionsClient({
    apiOrigin: 'https://your-api-origin.example',
});
const controller = new AbortController();
const page = await client.loadExtension(
    {
        shareId: 'YOUR_PUBLISHED_SHARE_ID',
        recordId: null,
        query: {},
        context: { type: 'direct-url' },
    },
    { signal: controller.signal }
);
// Render the returned redirect, password/login screen, Form or Portal.
// Loading does not save a Form or apply returned login credentials.
```

The [typed Form quickstart](docs/runtime.md#packaged-form-quickstart) supplies a
complete load-and-save example with editable-schema checks, native values,
hidden prefills and validation handling. It writes once when run; connect its
save function to your application's deliberate Save action.

## Obtain the actual runtime configuration

- Publish the Form or Portal through the existing miniExtensions workspace,
  including permitted child create/edit Forms. Obtain its published share ID
  through the normal Share flow. A share ID is not an admin extension, table or
  record ID; unsaved builder settings are not the published visitor settings.
- Obtain the deployment's HTTP(S) API origin serving `/api/v1` and `/api/trpc`.
  Supply an origin without a path, query, fragment or URL credentials. A public
  share URL or custom application URL does not establish that API origin.
  Use a durable deployment for a continuing application.
- The deployment must allow your browser application's exact origin and the
  public tRPC `miniext-context` header. A successful Node request does not prove
  browser CORS. The SDK omits browser cookies; use the configured visitor
  password/login/verification flow and current returned tokens.
- Discover record fields, custom views and child settings from the current
  loaded schemas/configuration. `selectedCustomViewId` is a miniExtensions
  custom view ID from the relationship's `miniExtConfig.customViews`, not an
  Airtable view ID. Keep configured parent/field/table context intact.
- For the first integration, use a simple published create Form with editable
  text, number and checkbox fields. CAPTCHA, device submission allowances,
  location and dynamic filtering require their real configured inputs. `null`
  CAPTCHA or an empty filtering map does not disable a rule. Provider setup
  belongs to the deployment owner; the SDK neither provisions it nor supplies
  an Airtable credential or SDK API key for the browser.

See [request contracts](docs/runtime.md) and
[environment troubleshooting](docs/browser-lifecycle.md#execution-environment-troubleshooting).
The SDK has no administrative workspace/configure/publish API.

## Choose the integration layer

| Import                         | Included behavior                                                                                                                                          | Guide                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `@miniextensions/sdk`          | `createMiniExtensionsClient`, native contracts, explicit session helpers and runtime operations                                                            | [Runtime](docs/runtime.md)        |
| `@miniextensions/sdk/forms`    | `FormDraftStore`, field descriptors, `createFormSaveInput`, normalized validation and `createFormController`                                               | [Form helpers](docs/forms.md)     |
| `@miniextensions/sdk/portals`  | `createPortalCollection`, accepted first/next reads, returned details and configured child requests for direct links or valid linked-record lookup results | [Portal helpers](docs/portals.md) |
| `@miniextensions/sdk/auth`     | `createAuthFlow`, captured screen/revision, verification challenges, explicit credential application and login presentation helpers                        | [Authentication](docs/auth.md)    |
| `@miniextensions/sdk/ui`       | Native selects, `getSelectFieldPolicy`, authorized linked-record loaders, headless selection model and optional mounted controls                           | [Selection UI](docs/ui.md)        |
| `@miniextensions/sdk/formulas` | `FormulaRunner`, parser and local evaluation against supplied native field/record context                                                                  | [Formulas](docs/formulas.md)      |

Helpers are optional and headless except for the optional `/ui` controls. The
SDK requires no React installation. The shipped guides include
[React/Next selection](docs/ui.md#react-and-next-integration) and
[React authentication](docs/auth.md#react-client-panel) recipes for your own
framework application.

## Runtime operation map

The client exposes **23 canonical operations**. v1 routes use POST at
`/api/v1?route=…`; public tRPC queries use GET and mutations use POST under
`/api/trpc`. Call the typed SDK method with its public input type rather than
constructing raw routes. Responses preserve canonical wire properties,
including metadata beyond the starter's presentation.

| Client method                                      | Transport     | Canonical route/procedure                                  |
| -------------------------------------------------- | ------------- | ---------------------------------------------------------- |
| `loadExtension`                                    | v1            | `fetchExtensionForEndUser`                                 |
| `auth.verifyExtensionPassword`                     | v1            | `verifyExtensionPassword`                                  |
| `auth.login`                                       | v1            | `loginIntoExtensionUsingLoginPageExtension`                |
| `auth.confirmVerificationCode`                     | v1            | `confirmVerificationCodeForLogin`                          |
| `auth.signUp`                                      | v1            | `signUpForLoginPageExtension`                              |
| `forms.save`                                       | v1            | `saveForm`                                                 |
| `forms.deleteCurrentRecord`                        | tRPC mutation | `airtable.deleteRecord`                                    |
| `forms.addSelectOption`                            | tRPC mutation | `airtable.addNewAirtableOptionForFormField`                |
| `portals.listLinkedRecords`                        | v1            | `fetchRecordsForLinkedTableOnPortal`                       |
| `portals.getUserRecord`                            | tRPC query    | `airtable.getUserRecord`                                   |
| `portals.updateGridCell`                           | tRPC mutation | `airtable.updatePortalRecord`                              |
| `portals.unlinkRecord`                             | tRPC mutation | `airtable.unlinkPortalRecord`                              |
| `portals.setKanbanCategory`                        | tRPC mutation | `airtable.updateRecordKanbanCategory`                      |
| `linkedRecords.listFormOptions`                    | v1            | `fetchRecordsForFormLinkedRecordsSelector`                 |
| `linkedRecords.listPortalOptions`                  | v1            | `fetchRecordsForPortalLinkedRecordsSelector`               |
| `linkedRecords.loadSelectedRecords`                | tRPC query    | `publicExtensions.fetchInitialTableIdsToLinkedTableStates` |
| `linkedRecords.listConditionalFilterPrimaryValues` | v1            | `fetchPrimaryValuesForConditionalLinkedRecordFilterField`  |
| `addresses.listPredictions`                        | tRPC query    | `publicExtensions.autoCompleteAddressField`                |
| `addresses.getFormattedAddress`                    | tRPC query    | `publicExtensions.getFormattedAddressFromPlaceId`          |
| `buttons.triggerWebhook`                           | tRPC mutation | `publicExtensions.triggerWebhook`                          |
| `attachments.createUploadUrl`                      | tRPC mutation | `publicExtensions.createPublicUploadLink`                  |
| `comments.listForRecord`                           | tRPC query    | `airtable.getAirtableCommentsForRecord`                    |
| `comments.addToRecord`                             | tRPC mutation | `airtable.addAirtableCommentForRecord`                     |

`attachments.uploadFile` additionally composes the authorized upload-link
operation and a signed PUT, returning a native attachment reference. Uploading
bytes alone does not attach them to a record; explicitly merge the reference
into the draft and Save. There is no generic raw-route escape hatch.

Public input/result aliases come from the generated canonical contracts. See
[response types and declaration provenance](docs/runtime.md#response-types).
Installed consumers need no internal source or credentials. The public
provenance identifies declaration content by digest; validate your supplied
archive and intended deployment separately.

## What the starter wires together

- **Form:** native field-ID drafts, conventional text/number/date/checkbox
  inputs, Form selects, authorized linked selectors, configured choice
  creation, uploads, final Save and validation retention. Static select
  allowlists use choice IDs as metadata, while saves use canonical choice
  names. Numeric selection maxima preserve loaded over-limit values for
  reduction; retained unavailable names remain removable. Configured display
  labels do not change saved names. See [Form controls](examples/browser/README.md#form-workflow).
- **Portal:** configured table/view/search selection, first/next reads,
  accepted rows, configured child Forms, deliberate Grid edits, confirmed
  unlink and Kanban category changes. Valid lookup results targeting linked
  records support paging and configured existing-child edits while preserving
  the outer Portal field ID. Lookup collections expose no create or parent
  unlink actions. See [Portal controls](examples/browser/README.md#portal-workflow).
- **Authentication:** password, configured login and verification controls,
  deliberate session application, basic configured signup using the login
  inputs, and memory-only visitor sessions. Your app supplies any additional
  configured signup fields or profile editor. Use [auth lifecycle](docs/auth.md) for captured
  screen/owner checks and explicit Reload.
- **Recovery:** visitor-scoped draft retention, deliberate discard, existing
  child comments and document-local unknown-create inspection. The journal
  survives that page's draft/session clearing, not a page refresh. A matching
  row is not a commit receipt; an explicit new blank attempt does not prove
  exactly-once creation. Follow [recovery](docs/browser-lifecycle.md#inspect-an-unknown-create).

The shipped [application source map](examples/browser/README.md#adapt-it)
identifies `main.ts` for visitor/Form ownership, `portal.ts` for collections and
actions, `fields.ts` for rendering and `recovery.ts` for operation metadata.
`examples/ui-selection` is a synthetic source-checkout consumer, not a bundled
customer application.

## Keep ownership, native values and results intact

Keep one client/session per visitor. Capture owner, client, session and revision
before asynchronous work; accept its result only while that context remains
current. Advance revision on visitor, connection, credential, token, record or
loaded-context transitions, including A → B → A. Abort old work and dispose or
reset obsolete controls, loaders and collections. Ordinary paging belongs to
the current collection; changed table/view/search criteria retire it.

Authentication returns credentials or a helper grant. Explicitly apply only a
current result, clear the old UI/drafts, advance scope and reload. The SDK reads
no persistent store. If your app persists sessions, keep credentials in its
chosen visitor-scoped store, out of logs, shared storage and DOM attributes.
See [sessions](docs/runtime.md#session-ownership) and
[owner/disposal rules](docs/browser-lifecycle.md#owner-session-and-disposal).

Preserve the full loaded native baseline, hidden prefills and dirty IDs. Record
values, selectors and actions use Airtable field IDs; login and explicit
name-based prefill boundaries use configured current field names. Numbers stay
numbers, checkboxes stay booleans, selects use names and links use record-ID
arrays. Unsupported/computed values remain intact. Preserve the configured
parent context for children; cached nested labels do not grant child access.

| Result                               | Application handling                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Redirect, `password` or `login_page` | Handle the returned screen before Form/Portal actions.                                                                                  |
| Form `{ type: 'error' }`             | Keep the draft and show field/form validation and any concurrent-edit notice. This is a normal result.                                  |
| Form `{ type: 'saved' }`             | Accept current returned record/parent state, present notification warnings/notices separately, and obtain a fresh baseline.             |
| `SDKError`                           | v1/upload exception with `kind` (`network`, `http`, `api`, `protocol`) and optional status/code/cause. An HTTP-200 API error can throw. |
| Native `TRPCClientError`             | Preserve the public tRPC client's error shape/data; it is not converted to `SDKError`.                                                  |
| Stale/disposed helper                | Retire that owner and recreate from current loaded metadata; discard stale plans/loaders.                                               |
| Abort or lost mutation response      | Inspect current authorized records before another action; a write may already have committed.                                           |

Methods accept request options with `signal` and an optional request-only
`session` snapshot. Block duplicate dispatch while pending. Cancellation does
not roll back writes, uploads, verification delivery, signup or webhook effects;
the SDK never automatically retries a mutation. Compute (`isComputeMode: true`)
can write too. Retain a completed upload reference rather than uploading again
after a failed Save. Failed/cancelled reads or mutations can require a fresh
first-page read or root Reload before further Portal actions. See
[save contracts](docs/runtime.md#form-saves-and-cancellation) and
[paging/return](docs/browser-lifecycle.md#paging-and-child-return).

## Current application boundaries

Conditional field/option visibility, sections/pages/review, Save & Continue,
progress persistence, CAPTCHA/fingerprint/GPS collection and advanced field
widgets remain application-owned. Static select limits and display labels do
not evaluate option conditions. The starter uses final Save and supplies no
general conditional evaluator or CAPTCHA widget. The existing server still
enforces its published rules.

The runtime supplies [conditional-filter primary values](docs/runtime.md#conditional-linked-filter-primary-values),
[address reads](docs/runtime.md#address-predictions-and-place-formatting) and
[configured Button webhooks](docs/runtime.md#configured-button-webhooks).
These are thin operations: your app supplies ordered cascade controls and
downstream resets, autocomplete intent/generation checks, or deliberate
single-flight Button actions. They do not provide those presenters. Preserve
the returned filter record/value pairs and exact parent/view context. The
server resolves the Button URL/method; a known Button value does not authorize
calling it, and an uncertain webhook outcome must not trigger a blind retry.

The starter presents Portal table data and a Kanban move action, not complete
hosted Gallery/Calendar/Map/Chart layouts or an advanced criteria builder. There
is no insight/dashboard/aggregate API. An application aggregate must describe
whether it covers accepted pages or a complete permitted dataset. Configuration
metadata, a hidden control or a known record ID grants no extra permission.

Local formulas require supplied current native context and implement the
[documented subset](docs/formulas.md#supported-functions), including legacy
rounding and error semantics. They perform no network access or Airtable
recomputation and authorize no write:

```ts
import { FormulaRunner } from '@miniextensions/sdk/formulas';

console.log(new FormulaRunner('"Total: " & (2 + 3 * 4)').run()); // "Total: 14"
```

CommonJS can use `require('@miniextensions/sdk/formulas')`. Follow the
[field-context recipe](docs/formulas.md#loaded-form-and-portal-metadata) and
[existing semantics](docs/formulas.md#existing-semantics); numeric `NaN`/infinity,
outer `'#ERROR!'` strings and thrown exceptions are distinct. Do not infer
hosted conditional behavior from a locally evaluated formula.

Keep administrative, Airtable and provider secrets out of browser code. Render
record text/labels with escaped or text APIs and review custom HTML, URL, embed
or rich-text rendering. Masks are presentation, separate from native save
values. Provider setup, deployment CORS and actual record persistence must be
verified for your intended environment. The SDK does not administer a workspace
or provide payment/PDF automation APIs.

## Source development and verification

From an authorized source checkout, use Node.js 22+ and the declared pnpm
version:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm pack
```

`pnpm check` runs formatting, types, synthetic behavior tests and packed
ESM/CommonJS/TypeScript/browser consumers. It copies the packaged starter into
an independent customer project and verifies its installation, types/build and
synthetic integration contracts. The optional source UI example also receives
packed-consumer checks. These checks make no live miniExtensions API calls;
they do not certify deployment CORS, provider compatibility, production
durability or every hosted workflow. See [verification limits](docs/browser-lifecycle.md#verification-limits).

For an agent integrating a customer application: install the actual supplied
archive, read the relevant shipped guides, inspect current loaded schemas,
choose the smallest public operation/helper, retain owner/native-value rules,
then run that application's typecheck/build and verify deliberate workflows
against its configured deployment. Report the archive/head and actual results;
a source review or successful local bundle is not live workflow evidence.

## License

[MIT](LICENSE). Preserve [third-party notices](THIRD_PARTY_NOTICES.md) for adapted
and bundled code. Runtime dependencies retain their respective licenses.
