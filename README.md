# miniExtensions SDK

Use this SDK to build a custom Form or Portal against an existing published
miniExtensions configuration. The runtime supplies native metadata and
server-authorized operations; your application renders the interface. Optional
Form, Portal, authentication and selection helpers handle specific client
lifecycles. A portable formula engine is also included.

Start with the browser application below. Then use the feature map to decide
which raw operation, helper and application code your workflow needs. A setting
being present in metadata does not mean that the starter implements its UI.

## Run the supplied browser starter

The SDK remains private and has **not been published to npm**. Use the exact
supplied `.tgz`, Node.js 22 or newer, and an ES2022-capable browser bundler. ESM,
CommonJS and TypeScript declarations are included; direct script-tag/CDN imports
are not supplied. Runtime browsers need native `fetch`, `TextEncoder`,
`AbortSignal.any` and `AbortSignal.prototype.throwIfAborted`; see the
[runtime platform requirements](docs/runtime.md#packaged-form-quickstart).

Replace the archive path and run these commands in a new directory. They copy
the complete shipped application and preserve its documentation links:

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

Open `http://127.0.0.1:34851`. Enter the API origin and published share ID from
the setup checklist, then choose **Connect and load**. **Save**, **Upload** and
other mutations run only when you select their controls. `npm run build` writes
static assets to `.generated` and exits; `npm run dev -- --port 34852` selects a
different loopback port.

The explicit archive argument replaces the starter's checkout-relative SDK
dependency and updates its lockfile integrity. Keep the archive available for
reinstallation. You need no private repository checkout. See the
[copy-and-run guide](docs/browser-lifecycle.md#copy-and-run) and
[starter controls](examples/browser/README.md).

For an existing application, install that same archive and import its package
name:

```sh
npm install /absolute/path/to/miniextensions-sdk-0.1.0-alpha.0.tgz
```

```ts
import { createMiniExtensionsClient } from '@miniextensions/sdk';

const client = createMiniExtensionsClient({
    apiOrigin: 'https://your-api-origin.example',
});
const page = await client.loadExtension({
    shareId: 'YOUR_PUBLISHED_SHARE_ID',
    recordId: null,
    query: {},
    context: { type: 'direct-url' },
});
// Render the returned redirect, password/login screen, Form or Portal.
// Loading does not submit a Form or apply returned login credentials.
```

Follow the [typed load-and-save quickstart](docs/runtime.md#packaged-form-quickstart)
for a complete Form save. It checks editable field schemas, preserves native
values and hidden prefills, and handles validation and saved results. The
quickstart writes once when run; adapt its save to your application's deliberate
Save action.

## Resolve setup before writing application code

| Prerequisite                         | What to obtain or configure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published configuration              | In the existing miniExtensions workspace, connect the Airtable base, configure a Form or Portal and its fields/access rules, then publish. Configure and publish the permitted child create/edit Forms for Portal actions. Unsaved builder changes are not the published visitor configuration. The SDK has no administrative create/configure/publish API.                                                                                                                                                                                                                                                                           |
| Published share ID                   | Use the existing **Share** flow for the published extension. `shareId` identifies that runtime extension; it is not the admin extension ID, table ID or record ID. If a custom slug/domain obscures the identifier, obtain the canonical published share ID from the workspace owner.                                                                                                                                                                                                                                                                                                                                                 |
| API origin                           | Obtain the origin of the deployment serving `/api/v1` and `/api/trpc`, for example `https://your-api-host.example`. Pass an HTTP(S) origin only: no API path, query, fragment or URL credentials. A custom application URL or public share URL does not establish its API origin. Use a durable deployment for a continuing application; PR previews may be retired. The archive does not discover or provision this deployment.                                                                                                                                                                                                      |
| Browser CORS                         | The deployment must permit your application's exact origin for the required endpoints, including public tRPC requests with the `miniext-context` header. A successful Node request alone does not prove browser CORS. The SDK omits browser cookies; hosted login cookies do not authenticate this client. CORS changes belong to the existing deployment owner.                                                                                                                                                                                                                                                                      |
| Visitor inputs and permissions       | Obtain the configured password/login/verification inputs when required. Load and use the current visitor's returned token, record and parent context. Keep Airtable/admin/provider secrets on the server; the customer app needs no SDK API key or Airtable credential.                                                                                                                                                                                                                                                                                                                                                               |
| Runtime field/view/child IDs         | Discover them from the current loaded published settings and schemas. Record/save field values use Airtable field IDs. A Portal `selectedCustomViewId` comes from the configured field’s `miniExtConfig.customViews` and is a miniExtensions custom view ID, not an Airtable view ID. Use configured child requests/context rather than constructing arbitrary child IDs. See [Portal reads](docs/runtime.md#portal-tables-search-and-pagination).                                                                                                                                                                                    |
| First integration fixture            | A simple published create Form with editable text, number and checkbox fields makes the packaged quickstart useful. Its `captchaVal: null` and empty dynamic filter values do not disable configured rules. The starter currently demonstrates final Save, not every hosted Form workflow.                                                                                                                                                                                                                                                                                                                                            |
| CAPTCHA-enabled Form                 | Supply a fresh provider token as `captchaVal` for the first protected write, including Compute. Use the public site key matching the existing deployment's server verification secret, with your browser domain/origin permitted by that provider configuration. Current loaded metadata supplies `enableCaptcha`, not a site key; the archive has no executable site-key/domain acquisition or widget setup recipe. Obtain that matching public configuration from the deployment owner. A different customer key cannot be assumed valid against the existing server secret. The starter sends `null` until you integrate a widget. |
| One submission per recognized device | When `allowCreatingOnlyOneRecord` applies to a top-level create, acquire a compatible browser identifier and carry `deviceFingerprint: { version: 1, visitorId }` consistently in load and save. The hosted flow uses a `visitorId: null` metadata handshake, then reloads with the real identifier before rendering. A null identifier is not proof for a protected save. The current archive supplies the typed input but no fingerprint acquisition/helper or complete starter recipe. Resolve that integration before using this policy.                                                                                          |
| Other configured dependencies        | Dynamic linked filters need current authorized driver values; GPS needs browser location collection and compatible destination fields. Email/SMS/webhooks rely on existing published settings, field mappings, plan/service eligibility and server/provider configuration. No browser helper provisions these services.                                                                                                                                                                                                                                                                                                               |

The [runtime guide](docs/runtime.md) explains request contracts and
[environment troubleshooting](docs/browser-lifecycle.md#execution-environment-troubleshooting)
explains install/network failures. Missing deployment details or provider setup
are real prerequisites; there is no alternate SDK endpoint that bypasses them.

## Choose the smallest integration layer

| Import                         | Use it for                                                                                                                                           | Your application still owns                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `@miniextensions/sdk`          | `createMiniExtensionsClient`, canonical metadata/native values and raw runtime operations                                                            | Rendering, visitor identity/session persistence, deliberate dispatch and reconciliation. [Runtime guide](docs/runtime.md).         |
| `@miniextensions/sdk/forms`    | `FormDraftStore`, ordered field descriptors, `createFormSaveInput`, normalized validation and `createFormController`                                 | Field widgets, conditional presentation/pages, complete save options and fresh baselines. [Form helpers](docs/forms.md).           |
| `@miniextensions/sdk/portals`  | `createPortalCollection`, explicit first/next reads, accepted rows and configured child requests                                                     | Presenters, filter controls, mutations, returned cleanup acceptance and refresh. [Portal helpers](docs/portals.md).                |
| `@miniextensions/sdk/auth`     | `createAuthFlow`, captured screen/revision, verification challenges and explicit credential application; login mask/destination presentation helpers | Auth UI, configured signup fields, storage, scope advancement and reload. [Auth guide](docs/auth.md).                              |
| `@miniextensions/sdk/ui`       | Native selects, authorized linked-record loaders, selection model and optional mounted controls                                                      | Published advanced option/condition policies, custom layout, draft writes and Save. [Selection guide](docs/ui.md).                 |
| `@miniextensions/sdk/formulas` | `FormulaRunner` and local formula evaluation                                                                                                         | Loaded field context, native values and compatibility choices. No API key or network is needed. [Formula guide](docs/formulas.md). |

The helpers are optional and headless except for `/ui`'s optional native controls.
They introduce no React requirement. See [React/Next selection integration](docs/ui.md#react-and-next-integration)
and the [auth panel recipe](docs/auth.md#react-client-panel) when using your own
framework.

## Form and Portal feature map

**Raw API** means a public client operation exists. **Helper** means reusable
SDK orchestration exists. **Starter** describes the shipped example. **Custom
app** identifies presentation or workflow that you must implement from returned
configuration. These boundaries are independent of server permission checks.

| Capability                                     | Current boundary and next reference                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Load and metadata                              | **Raw API:** `loadExtension` returns redirect/password/login/Form/Portal. Published settings, schemas, native records and field configuration remain intact. [Response contracts](docs/runtime.md#response-types).                                                                                                                                                                                                                          |
| Password, login, OTP and signup                | **Raw API:** `auth.verifyExtensionPassword`, `login`, `confirmVerificationCode`, `signUp`. **Helper:** `/auth` flow and presentation helpers. **Starter:** password/login/OTP with explicit session application and Reload. **Custom app:** configured signup/profile UI and persistence. [Authentication](docs/auth.md), [raw auth](docs/runtime.md#password-and-login).                                                                   |
| Form drafts, final save and validation         | **Raw API:** `forms.save`. **Helper:** native baseline/draft, dirty IDs, controller and normalized result. **Starter:** explicit final Save with retained validation draft. [Form helpers](docs/forms.md), [save/error contracts](docs/runtime.md#form-saves-and-cancellation).                                                                                                                                                             |
| Field inputs and values                        | **Starter:** conventional text/email/URL/phone, multiline/rich text, numeric, date, checkbox and select controls; complex/computed values stay intact. **Custom app:** full hosted rich-text/advanced widget behavior, signatures, calendars, barcode/collaborator controls and field-specific formatting. [Starter Form workflow](examples/browser/README.md#form-workflow), [draft values](docs/forms.md#preserve-the-full-native-draft). |
| Select options                                 | **Raw API:** `forms.addSelectOption`. **Helper:** native select/model. **Starter:** selects and configured choice creation. **Custom app:** static/conditional option restrictions, custom labels, maximum selections and hosted list/dropdown fidelity. Backend rules still apply. [Select controls](docs/ui.md#native-single-and-multi-selects).                                                                                          |
| Linked-record selectors                        | **Raw API:** `linkedRecords.listFormOptions`, `listPortalOptions`, `loadSelectedRecords`. **Helper/starter:** authorized search, paging and native record-ID selection. **Custom app:** dynamic filter/cascade UI; its primary-value discovery API is not exposed by this SDK. [Selectors](docs/runtime.md#linked-record-selectors-and-select-choices), [linked UI](docs/ui.md#authorized-linked-record-selection).                         |
| URL/static/hidden prefills                     | **Raw API/helper:** load returns native baseline and provenance; drafts/save preserve loaded prefills. **Custom app:** automatic-submit orchestration, collision/provenance handling and restoration precedence. [Form draft recipe](docs/forms.md#preserve-the-full-native-draft).                                                                                                                                                         |
| Conditional fields, sections, pages and review | Published metadata is available. **Custom app:** conditional visibility, section/page derivation, Next/Back validation and review-before-submit UI. The starter does not implement these hosted workflows. [Interface boundary](docs/runtime.md#designing-your-custom-interface), [starter limits](examples/browser/README.md#form-workflow).                                                                                               |
| Compute and Save & Continue                    | **Raw API:** `forms.save` with `isComputeMode: true` can create/update records. **Custom app:** manual/automatic compute scheduling, create-to-edit promotion, refreshed baseline, confirmation and separate final save. Starter uses final Save only. [Save contracts](docs/runtime.md#form-saves-and-cancellation).                                                                                                                       |
| Persistent progress                            | Load context can carry compatible progress. **Helper/starter:** scoped memory drafts. **Custom app:** opt-in cross-reload persistence/restore/discard; the starter's unknown-operation journal does not provide it. [Draft scope](docs/forms.md#state-recovery-and-scope-changes), [browser ownership](docs/browser-lifecycle.md#owner-session-and-disposal).                                                                               |
| CAPTCHA, device allowance and tracking         | Save accepts applicable proof/fingerprint/location inputs. **Custom app:** widget, identifier acquisition and GPS collection; see setup prerequisites above. Server owns CAPTCHA proof, submission allowance and observed IP. [Save inputs](docs/runtime.md#form-saves-and-cancellation).                                                                                                                                                   |
| Limits, locks and expiration                   | Published create/edit restrictions, submission limits, locking checkbox, expiration and conditional save are enforced by existing load/save handlers. **Custom app:** denied-state messages and availability hints. Metadata/UI alone grants no action. [Runtime authority](docs/runtime.md), [Form state](docs/forms.md#state-recovery-and-scope-changes).                                                                                 |
| Success actions and branding                   | **Custom app:** static/dynamic headers, logo/cover/footer, theme, width, localization, custom labels, success messages/delays, redirect/reload/read-only/close, print, copy/new record and next-child navigation. Starter uses its own UI/status. [Published metadata](docs/runtime.md#response-types), [starter limits](examples/browser/README.md#form-workflow).                                                                         |
| Submission notifications and webhook           | Existing configured backend effects run through the eligible save phase. **Raw API:** saved result can include email/SMS/continue notification warnings or notices; show them separately from record success. **Custom app:** provider/admin setup and outcome presentation. Do not separately replay effects after an uncertain save. [Save result handling](docs/forms.md#preserve-the-full-native-draft).                                |
| Form deletion                                  | **Raw API:** `forms.deleteCurrentRecord`. **Starter:** explicit confirmation for configured editable records. **Custom app:** full conditional button/label presentation. [Actions](docs/runtime.md#portal-child-forms-and-actions).                                                                                                                                                                                                        |
| Portal reads/search/paging                     | **Raw API:** `portals.listLinkedRecords`, `getUserRecord`. **Helper/starter:** explicit first/next reads, configured field/view/search scope and accepted rows. [Portal collections](docs/portals.md), [raw pagination](docs/runtime.md#portal-tables-search-and-pagination).                                                                                                                                                               |
| Portal criteria and cleanup                    | **Raw API/helper:** native filters/sorts and returned cleanup. **Custom app:** criteria builder and explicit cleanup acceptance/reload. Starter has search and requires Reload when cleanup invalidates its view. [Returned data](docs/portals.md#returned-data-and-cleanup).                                                                                                                                                               |
| Portal layouts and menus                       | **Starter:** table presentation and Kanban move action. **Custom app:** full Grid/List/Gallery/Kanban/Calendar/Map/Chart presenters, conditional views, external/embed menus, profile/header/sidebar, theme and localization. Lookup-backed linked tables are a current helper/starter limitation. [Layout metadata](docs/portals.md#returned-data-and-cleanup), [starter Portal workflow](examples/browser/README.md#portal-workflow).     |
| Child Forms and parent return                  | **Raw API:** `loadExtension` with exact configured parent/field/child context. **Portal helper/starter:** existing/create children from accepted collection rows and parent refresh. **Custom app:** Form-parent linked-child create/edit workflows and additional layouts. [Child integration](docs/portals.md#child-drafts-saving-and-mutation-boundaries), [raw child actions](docs/runtime.md#portal-child-forms-and-actions).          |
| Grid, unlink and Kanban writes                 | **Raw API:** `portals.updateGridCell`, `unlinkRecord`, `setKanbanCategory`. **Starter:** deliberate writes, unlink confirmation and required refresh. **Custom app:** complete inline-edit eligibility presentation and richer controls. [Portal actions](docs/runtime.md#portal-child-forms-and-actions), [starter actions](examples/browser/README.md#portal-workflow).                                                                   |
| Attachments                                    | **Raw API:** `attachments.createUploadUrl`, `uploadFile`. **Starter:** upload once, retain native reference, then Save. Uploading bytes does not attach them to a record. **Custom app:** complete read-only/field-policy affordances and hosted annotation/signature/media/processing widgets. [Attachment contracts](docs/runtime.md#attachments), [upload lifecycle](docs/browser-lifecycle.md#upload-once-then-save).                   |
| Child-record comments                          | **Raw API:** `comments.listForRecord`, `addToRecord`. **Starter:** eligible existing child comments. Use the child token and respect `disableSending`; server derives record and author. [Comments](docs/runtime.md#child-record-comments).                                                                                                                                                                                                 |
| Formula evaluation                             | Local `FormulaRunner`, native field context and documented supported functions. It does not replace Airtable recomputation or authorize writes. [Loaded metadata](docs/formulas.md#loaded-form-and-portal-metadata), [semantics](docs/formulas.md#existing-semantics).                                                                                                                                                                      |

The shipped [application sources](examples/browser/README.md#adapt-it) are the
integration reference: `main.ts` owns visitors and Form actions, `portal.ts`
owns collection/child actions, `fields.ts` renders values, and `recovery.ts`
owns document-local operation metadata. The selection guide contains public
integration recipes; `examples/ui-selection` is a source-checkout-only synthetic
consumer and is **not** bundled into this archive.

### Current missing APIs and workflow limits

The client does not expose the existing canonical Button webhook action
(`publicExtensions.triggerWebhook`), address prediction/detail queries
(`autoCompleteAddressField`, `getFormattedAddressFromPlaceId`), or conditional
linked-filter primary-value discovery
(`fetchPrimaryValuesForConditionalLinkedRecordFilterField`). There is no generic
raw-route escape hatch in the supported SDK interface. Published Button values
can be displayed, but that does not implement their configured server action.

`portals.listLinkedRecords` exposes raw reads; the current `/portals` collection
and starter do not support lookup-backed linked collections. The helper is not
a complete hosted view renderer. None of the app-owned UI in the feature map
should be inferred to exist merely because configuration properties are typed.

There is no insight/dashboard or aggregate API and no shipped configured
Gallery/Calendar/Map/Chart presenter. A local `FormulaRunner` needs authorized
linked states from the same visitor/context; it never fetches missing records or
recomputes Airtable fields. Define whether any app-owned insight covers only the
accepted loaded pages or a complete permitted dataset. Do not present a
partial-page aggregate as a full-table result. See the
[loaded formula-context recipes](docs/formulas.md#loaded-form-and-portal-metadata).

The SDK does not administer a workspace, provision providers, or run separate
Stripe payment/PDF automation extension types. Configured URL, attachment or
external-menu integrations can participate in those workflows only with their
own supported setup and custom UI. A Form's print view is not a server PDF API.

## Preserve the lifecycle and handle each result

Keep one client/session per visitor. Capture owner, session and revision before
async work; accept its result only while that context remains current. Advance
revision and dispose stale controls/collections when visitor, connection,
credentials, record or loaded configuration changes, including A → B → A.
Authentication does not silently replace the client session: deliberately apply
a current result/grant, clear old UI/drafts, then reload. See
[session ownership](docs/runtime.md#session-ownership) and
[scope/disposal](docs/browser-lifecycle.md#owner-session-and-disposal).

Preserve the full loaded native baseline and hidden prefills. Record data,
dirty fields, selectors and actions use Airtable field IDs; login and URL-prefill
boundaries use the configured current field names. Keep numbers, booleans,
choice names, link IDs, dates and attachment references native. Do not erase
fields you did not render or manufacture edit authority from cached labels.
For Portal children, first establish current accepted list membership and
preserve the configured parent context.

| Outcome                         | Required application handling                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redirect or auth screen         | Render the returned state; complete current visitor authentication before Form/Portal actions.                                                                               |
| Form `{ type: 'error' }`        | Normal validation result. Keep draft values, display field/form messages once, and handle a concurrent-edit notice before trying a deliberate new save.                      |
| Form `{ type: 'saved' }`        | Accept the returned record/parent state, show optional notification warnings/notices, adopt a fresh baseline and retire stale collection capabilities.                       |
| `SDKError`                      | v1/signed-upload failure with `kind` (`network`, `http`, `api`, `protocol`) and optional `status`, `code`, `cause`. An HTTP-200 API error can still throw.                   |
| Native `TRPCClientError`        | Public tRPC methods preserve the official client's error shape/data; they are not converted to `SDKError`.                                                                   |
| Helper scope/disposal error     | Retire the stale owner/context and recreate from a current loaded screen; do not reuse its child plan or selection loader.                                                   |
| Abort or lost mutation response | Cancellation cannot undo a committed write. The outcome can be unknown; inspect authorized records before any subsequent action. No method automatically retries a mutation. |

Block repeated dispatch while an action is in flight. Compute can write too.
After an upload succeeds, retain its reference and clear the consumed file
selection; do not upload again to recover a failed Form save. Failed/cancelled
Portal reads and mutations can require a new first-page read or root reload
before actions. See [native saves](docs/browser-lifecycle.md#native-values-and-deliberate-saves)
and [paging/child return](docs/browser-lifecycle.md#paging-and-child-return).

The starter's unknown-create journal is **document-local**. It survives that
page's draft/session cleanup but not a page refresh. Inspection does not prove
exactly-once creation, and selecting a matching row does not establish the
original attempt's identity. A separate blank attempt requires explicit
acknowledgement that the previous request may have committed. Production apps
must design their own durable reconciliation when needed. Follow the shipped
[unknown-create recovery flow](docs/browser-lifecycle.md#inspect-an-unknown-create).

## Security and implementation boundaries

Use published configuration and current server-issued visitor/child tokens.
Keep administrative, Airtable and provider secrets out of the browser. Do not
reuse hosted Firebase sessions or another visitor's credentials. Keep explicit
session persistence scoped to the visitor; the starter stores sessions only in
memory. Production credential persistence is an application policy, not a
shipped secure-storage adapter. If your app saves/restores a session, keep its
opaque credentials in its chosen visitor-scoped store, out of shared/diagnostic
storage, logs and DOM attributes. The SDK itself reads no persistent store.

UI visibility, a known record ID, metadata or a hidden button does not authorize
an action. Preserve parent field/table/view context and use accepted main-list
rows; nested label caches do not grant child access. Do not invent raw URLs or
methods for configured server Button webhooks, fake CAPTCHA proof, or replace
required device proof with the metadata handshake.

Render record text and labels with escaped/text APIs. Audit any app-owned HTML,
URL, image, embed or rich-text renderer explicitly. Keep displayed masks separate
from native save values. Do not coerce unsupported values to strings/null,
blindly retry mutations, or treat clearing a session/draft as proof that a
previous write did not commit.

The [custom-interface guide](docs/runtime.md#designing-your-custom-interface)
and [selection lifecycle](docs/ui.md#headless-model-and-lifecycle) describe these
boundaries. Browser CORS, provider compatibility, configured rules and actual
record persistence still need verification against your intended deployment.

## Source development and verification limits

From an authorized source checkout:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm pack
```

`pnpm check` covers formatting, typechecking, synthetic SDK behavior and packed
ESM/CommonJS/TypeScript/browser consumers. It copies the packaged browser starter
into an independent customer project and checks installation, typecheck/build
and synthetic integration contracts. Those checks make no API calls and do not
certify every hosted Form/Portal capability, deployed CORS/provider setup or
production durability. A source-only documentation assessment is also not an
executed customer build or live workflow. See [verification limits](docs/browser-lifecycle.md#verification-limits).

The runtime declaration snapshot is generated from canonical API sources; its
recorded source revision and update procedure are in
[response types](docs/runtime.md#response-types). An installed consumer needs no
monorepo source or credentials. Validate the actual supplied archive and your
configured deployment separately; do not infer acceptance from a successful
local bundle alone.

## License

[MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for adapted
code attribution. Runtime dependencies retain their respective licenses.
