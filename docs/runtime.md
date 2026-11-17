# Runtime client

The runtime client calls the existing miniExtensions APIs: v1 handlers at
`/api/v1?route=…` and public procedures at `/api/trpc`. The SDK is a headless
client: your app renders the interface while the existing handlers enforce
the Form/Portal's visitor, record, field, and action permissions. Public tRPC
requests use the official `@trpc/client` HTTP link and its plain JSON protocol.

The package also exports native PostgreSQL connection, database, schema, table,
field, relationship and record metadata types. It also exports `PostgresSource`,
`PostgresFilter`, `PostgresSort`, `PostgresSelectQuery` and `PostgresSelectResult`
for structured native reads with explicit source identity, nested filters,
sorting and offset pagination. Read rows remain native fieldsets without a
record identity or display label. `PostgresValue` preserves the
server's text representation as `string | null`, including large numbers,
timestamps, JSON and arrays; SQL NULL remains distinct from an empty string.
These native metadata contracts do not yet enable PostgreSQL Form/Portal
operations or change the existing Airtable runtime contracts.

`PostgresFormRecordAccess` describes saved private Form access intent using the
existing inverse creation/editing flags. With editing disabled, an identifier
may be retained without supplying editing authority. With editing enabled, the
type requires an explicit native identifier binding. The containing Form may
omit access entirely to retain creation/read preview with editing off. Current
workspace membership, saved revision, native metadata and database grants still
authorize each operation. This type-only export adds no schema validator,
resolver, public-session operation or lasting row-mutation capability.

`PostgresUuidColumnConfig` adds UUID common settings as the sixth native family
under configuration receipt v6 and its 23-source closure. UUIDs and domains over
UUID remain native string-or-NULL values; this type adds no text normalization,
version restriction or UUID generation option. Historical receipt versions 1–5
retain their existing families and source closures.

`PostgresTimestampColumnConfig` and `PostgresTimestamptzColumnConfig` add distinct
native temporal configuration families under receipt v7 and its 24-source
closure. They describe common field settings for local timestamps and instants;
they add no timezone conversion, epoch values, precision setting or native value
input. Values remain PostgreSQL text or SQL NULL. Historical receipt versions
1–6 retain their existing families and source closures. Configuration/read
preview and value-input admission remain separate in the private application.

`PostgresTimeColumnConfig` and `PostgresTimetzColumnConfig` add common field
settings for native TIME and TIMETZ columns under receipt v8 and its 25-source
closure. Configured columns use the distinct `time` and `timetz` kinds. Values
remain PostgreSQL text or SQL NULL; these types add no timezone conversion,
precision setting, JavaScript date conversion or portable value parser.
Historical versions 1–7 retain their families and source closures. The two
portable display runtimes are unchanged; these type exports add no public
PostgreSQL Form/Portal transport operation.

`PostgresIntervalColumnConfig` adds the native `interval` common-settings family
under receipt v9 and its 26-source closure. Values retain native month/day/time
components as text or SQL NULL. This adds no duration-number conversion, unit
selection, precision override, IntervalStyle setting or portable value parser.
Versions 1–8 retain their exact families and source closures. Public Form/Portal
transport admission remains separate from these type exports.

`PostgresJsonColumnConfig` and `PostgresJsonbColumnConfig` add separate `json`
and `jsonb` common-settings families under receipt v10 and its 27-source
closure. Native document values remain `PostgresValue` strings or SQL NULL;
JSON text `'null'` is distinct from SQL `null`. No JavaScript object parsing,
pretty printing, numeric coercion or JSON-schema setting is added. PostgreSQL
owns the returned representation. The existing `JsonValue` utility is separate
from native database column values. Versions 1–9 retain their exact families
and source closures; portable runtime and public transport admission are unchanged.

The independent native snapshot also exports `PostgresConfiguredColumn`,
`PostgresReadableRelationConfiguration`, `PostgresFormDraftState`,
`PostgresFormDraft`, `PostgresPortalTab`, `PostgresPortalDraftState`,
`PostgresPortalDraft` and `PostgresNativeDraft`. These come from the existing
private workspace-member authoring schemas. The draft union correlates the
existing `form` or `portal` type with its native state and PostgreSQL source;
configured columns correlate their native kind with valid field settings.
Every relation requires a display-column name. Connection equality, duplicate
columns, bounds, saved revisions and current native metadata still require
server validation; TypeScript cannot establish those rules for arbitrary
strings or arrays. These type-only exports add no public load/save operation,
validator or permission capability and do not widen the released Airtable
operation contracts.

`PostgresRelationshipBinding` describes a saved outgoing foreign-key group,
including native constraint/index identities, ordered key columns, equality
operators and collations. Enabled selection requires an explicit target display
column; labels may be duplicate, SQL NULL or empty. A clear-only binding disables
selection and needs no target display column. `PostgresRelationshipSelection`
retains lossless native key values, and `PostgresRelationshipChange` pairs a
selection with loaded component baselines.

`PostgresRelationshipPresentation` is optional read-only display data, bound to
an ordered loaded local tuple. A resolved label preserves SQL NULL and empty
text; empty relationships and unavailable labels have distinct states. Row
observations and select results may carry these presentations separately from
fields. They cannot be used as selections or write authority. Reopening or
submitting an unchanged relationship does not assign it again.

`PostgresRelationshipConfig.clearColumnNames` records the builder's explicit
choice of local columns Clear may empty. `PostgresRelationshipClear` carries
only relationship intent and optional baselines; it cannot choose write columns.
Server validation still enforces the native MATCH rule, nullable/writable
columns, saved settings, configured identifier protection, current grants,
overlapping relationships and stale baselines. For example, a configured Clear
may empty `contact_id` while preserving `tenant_id`. No Clear action is available
until the saved column selection is valid. These contracts appear optionally on
private Form/Portal authoring configurations and add no public mutation route.

`PostgresField.collationOid` is required database-local collation metadata.
Its explicit `null` means a noncollatable column; missing metadata is not NULL.
Identifier column bindings retain an optional collation only so older saved
authoring state can load for explicit refresh and rebind. Such a legacy binding
does not admit a preview or mutation until current metadata is known and matches;
loading it never silently fills the missing collation or grants write authority.

`postgresTextColumnPresentationDefinition` and
`resolvePostgresTextColumnPresentation` come from the same generated native text
policy used by the application. Missing `displayAs` selects ordinary text;
`attachments-public-urls` selects read-only links to existing public files.
Unknown or null modes throw `PostgresTextColumnPresentationError` with reason
`INVALID_PRESENTATION`. Both modes keep the stored value as text and exclude
attachment mutation and generated attachment output. Text input applicability
does not grant database permissions or admit a public Form/Portal operation.

Record settings contracts require an explicit display column, including when a
table has a native primary key. A customer-configured identifier also requires
explicit stability confirmation. `PostgresRecordEditingValidation` describes
only the current visible snapshot; it grants no ongoing mutation capability or
promise of future uniqueness.

For a complete browser application, start with the shipped
[browser lifecycle guide](browser-lifecycle.md). It explains how to copy the
packaged Form and Portal starter into your own project, install the exact
supplied SDK archive, and configure your published extension without a private
repository checkout. It connects drafts, visitor changes, uploads, pagination,
and save recovery in one application. The recipes below remain useful for
integrating individual runtime operations into your own interface; advanced
presentation remains application-owned.

## Packaged Form quickstart

This guide ships in the SDK archive, so you can follow it without access to the
source repository. This development preview has **not been published to npm**. Source checkouts
require [install, check and pack](../README.md#build-an-archive-from-source) before
TGZ installation. Install the
archive supplied to you in your own application; replace the path with its
actual location:

```sh
npm install /path/to/miniextensions-sdk-0.1.0-alpha.0.tgz
```

The package name in imports is still `@miniextensions/sdk`. Installing it by
name from npm would be a separate, future publication step; it is not an
available installation method for this version. Use an ES2022-capable browser
bundler or Node.js 22+ with ESM. Direct script-tag/CDN imports are not supplied.

Save the following as `quickstart.mts` in your application. Replace the API
origin, published Form share ID, and three field-ID placeholders. Choose
editable single-line text, number, and checkbox fields
that are present in that Form. The code checks their loaded schemas before
sending a save; a field being present does not itself grant permission.

This example loads a standalone create Form and saves once when run. It keeps
all loaded data, including hidden prefills, and adds three typed edits. Use a
Form without CAPTCHA or dynamic linked filtering for this first run: `null`
and `{}` below do not disable those rules. For a Form that requires them,
supply the configured CAPTCHA widget's token and current filtering values,
and preserve any query/device fingerprint consistently in load and save.
Password/login screens and redirects must be handled before saving, as shown
later in this guide. In your application, call the save function from the
visitor's deliberate Save action and keep the draft after validation failure.

```ts
import {
    AirtableFieldType,
    createMiniExtensionsClient,
    type AirtableValue,
    type LoadExtensionInput,
    type SaveFormInput,
} from '@miniextensions/sdk';

const client = createMiniExtensionsClient();

const input: LoadExtensionInput = {
    shareId: 'YOUR_SHARE_ID',
    recordId: null,
    context: { type: 'direct-url' },
    query: {},
};
const controller = new AbortController();
const extension = await client.loadExtension(input, {
    signal: controller.signal,
});

async function saveLoadedForm(): Promise<void> {
    if (extension.extensionScreen !== 'form_loaded') {
        if (extension.extensionScreen === undefined) {
            console.info('Follow the returned redirect:', extension.url);
        } else {
            console.info(
                'Handle this screen first:',
                extension.extensionScreen
            );
        }
        return;
    }

    const fieldIds = {
        title: 'YOUR_TEXT_FIELD_ID',
        quantity: 'YOUR_NUMBER_FIELD_ID',
        approved: 'YOUR_CHECKBOX_FIELD_ID',
    };
    const expectedTypes = {
        [fieldIds.title]: AirtableFieldType.SINGLE_LINE_TEXT,
        [fieldIds.quantity]: AirtableFieldType.NUMBER,
        [fieldIds.approved]: AirtableFieldType.CHECKBOX,
    };
    for (const [fieldId, fieldType] of Object.entries(expectedTypes)) {
        const schema = extension.payload.fieldIdsToSchemas[fieldId];
        if (
            !extension.payload.fieldIdsInForm.includes(fieldId) ||
            schema?.fieldType !== fieldType ||
            schema.airtableField.isComputed === true ||
            (schema.miniExtConfig != null &&
                'readOnly' in schema.miniExtConfig &&
                schema.miniExtConfig.readOnly === true)
        ) {
            throw new Error(
                `Choose an editable ${fieldType} field: ${fieldId}`
            );
        }
    }

    const edits: Record<string, AirtableValue> = {
        [fieldIds.title]: 'Example request',
        [fieldIds.quantity]: 2,
        [fieldIds.approved]: false,
    };
    const saveInput: SaveFormInput = {
        extensionAccessToken: extension.payload.extensionAccessToken,
        formRecord: {
            ...extension.payload.formRecord,
            data: { ...extension.payload.formRecord.data, ...edits },
        },
        captchaVal: null,
        isComputeMode: false,
        searchQuery: input.query ?? {},
        context: { type: 'direct-url' },
        conditionalLinkedRecordFieldIdsToFilteringValues: {},
        formFieldIdsWithUnsavedChanges: [
            ...new Set([
                ...extension.payload.formFieldIdsWithUnsavedChanges,
                ...(extension.payload.urlPrefilledFieldIds ?? []),
                ...Object.keys(edits),
            ]),
        ],
    };
    const result = await client.forms.save(saveInput, {
        signal: controller.signal,
    });
    if (result.type === 'error') {
        const shown = new Set<string>();
        const showFieldError = (fieldId: string, message: string): void => {
            const key = JSON.stringify([fieldId, message]);
            if (shown.has(key)) return;
            shown.add(key);
            const title =
                extension.payload.fieldIdsToSchemas[fieldId]?.airtableField
                    .name ?? fieldId;
            console.error(title, message);
        };
        for (const error of result.formValidationErrors) {
            showFieldError(error.fieldId, error.errorMessage);
        }
        for (const [fieldId, message] of Object.entries(result.formErrors)) {
            if (message != null) showFieldError(fieldId, message);
        }
        if (result.concurrentEditErrorMessage != null) {
            console.error(result.concurrentEditErrorMessage);
        }
        return; // Keep the draft; a validation result is not a successful save.
    }

    console.info('Saved record:', result.record.id);
    for (const warning of result.postSubmissionWarnings ?? []) {
        console.warn('Post-submission warning:', warning.type);
    }
    for (const notification of result.postSubmissionNotifications ?? []) {
        console.info('Post-submission notification:', notification.type);
    }
}

await saveLoadedForm();
```

The values above are native `AirtableValue` values: a string for text, a number
for number, and a boolean for checkbox. Use field IDs rather than field names.
To edit an authorized existing record, supply its `recordId` when loading and
keep the returned `formRecord` discriminator, record ID, and table ID when
constructing the save input, as this code does.

With TypeScript installed in your application, you can check this module with:

```sh
npx tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext quickstart.mts
```

The remaining examples are focused excerpts using the quickstart's `client`,
`input`, and loaded `extension`. Form/Portal helper functions take their
loaded screen and application-supplied context explicitly. A browser app
should render record text through safe text APIs rather than inserting it as
HTML, and must discard late responses after a visitor/session change.

Supply the visitor's extension password or login session when required by the
published Form/Portal. Existing record access, CAPTCHA and other runtime rules
still apply. Requests omit browser cookies; the client does not create a
workspace or administrator session.

Cross-origin browser applications need an API deployment that permits the
public tRPC routes and the `miniext-context` header. The v1 endpoint already
supports cross-origin requests. Node.js consumers use the same API contracts
without browser CORS enforcement.

Omitting constructor options or leaving `apiOrigin` undefined uses the exported
`DEFAULT_API_ORIGIN`, `https://web.miniextensions.com`. For another deployment,
pass `createMiniExtensionsClient({ apiOrigin })` with its explicit origin.
An override must be an HTTP(S) origin without a path, query, fragment, or URL
credentials. Explicit null/blank/invalid origins are rejected; requests never
fall back to another origin after failure. Keep private overrides in installed
application runtime configuration, outside public source and shared artifacts. Node.js 22+ and browsers with native `fetch`, `TextEncoder`, and
`AbortSignal.any` and `AbortSignal.prototype.throwIfAborted` are supported.
Supply `fetch` in the constructor to use another compatible network
implementation.

## Password and login

Methods return the hosted runtime's tagged results. A wrong password, blocked
password attempt, missing login record, or verification message is a normal
result that your UI can handle.

```ts
import { withExtensionPassword } from '@miniextensions/sdk';

if (extension.extensionScreen === 'password') {
    const verification = await client.auth.verifyExtensionPassword({
        extensionId: extension.extensionId,
        extensionPassword: 'THE_ENTERED_PASSWORD',
    });
    if (verification.type === 'correct') {
        client.setSession(
            withExtensionPassword(client.getSession(), {
                extensionId: extension.extensionId,
                encryptedExtensionPassword:
                    verification.encryptedExtensionPassword,
            })
        );
        const nextScreen = await client.loadExtension(input);
    }
}
```

Use the table ID and login field names from a loaded login page when storing a
login token. Credentials submitted to `auth.login` and `auth.signUp` are keyed
by login field name.

```ts
import { withLoginToken } from '@miniextensions/sdk';

if (extension.extensionScreen === 'login_page') {
    const login = await client.auth.login({
        extensionId: extension.extensionId,
        loginCredentials: { Email: 'person@example.test' },
    });
    if (login.type === 'found-record') {
        client.setSession(
            withLoginToken(client.getSession(), {
                extensionId: extension.extensionId,
                tableId: extension.payload.tableId,
                loginFieldNames: extension.payload.loginFieldNames,
                encryptedLoginToken: login.encryptedLoginToken,
            })
        );
    }
    if (login.type === 'verification-message-sent') {
        const confirmed = await client.auth.confirmVerificationCode({
            verificationId: login.verificationId,
            verificationCode: 'THE_ENTERED_CODE',
            language: extension.language,
        });
        // Store confirmed.encryptedLoginToken with withLoginToken when this
        // result still belongs to the active visitor session.
    }
}
```

Sign-up takes `{extensionId, signUpCredentials}` and returns `{ok}`. Follow the
extension's configured login flow after sign-up; it does not create a client
session automatically.

## Session ownership

A session is a flat map of stored credential keys to opaque token strings.
`getSession()` returns a copy, and `setSession(next)` replaces the entire map
with a copy. `setSession({})` clears it. The token helpers return a new map and
never persist it themselves.

`generateLoginCredentialKey({extensionId, tableId, loginFieldNames})` exposes
the same key derivation used by `withLoginToken` for host storage adapters.
It sorts a copy of the field names using JavaScript string order, preserves
duplicates, and URI-escapes the UTF-8 base64 encoding of the joined names,
table ID and extension ID. It performs no storage access or authentication.
This is the existing compatibility format, not a collision-free identity scheme.

Supply only visitor credentials. Firebase website sessions (`miniExtSession`)
are rejected. Each request captures its own session copy: v1 receives it in
`miniExtStorageV4`, and tRPC receives the same map in the `miniext-context`
header. No session is attached to an anonymous signed upload.

Auth methods do not change session. Persist a successful token explicitly only
while its response still belongs to the active visitor. Replacing session while
a request is pending does not affect that request or let its late response
change the replacement session.

```ts
const requestSession = client.getSession();
const extensionForThisRequest = await client.loadExtension(input, {
    session: requestSession,
});
```

The per-request `session` option is a complete override. It is not merged or
saved. Use one client per visitor/session in Node.js applications; save and
restore session through your application's chosen storage. The client does not
read browser local storage, cookies, or shared process state.

## Form saves and cancellation

`forms.save` accepts the current `extensionAccessToken`, a create/edit
`formRecord`, and the Form's save inputs. Record data and dirty field lists use
Airtable field IDs. Preserve the loaded dirty/prefilled field IDs when adding
your own changes, and provide the applicable captcha, device fingerprint,
conditional linked filtering values, query, and child context.

The quickstart constructs every required `SaveFormInput` property from a loaded
Form and its typed edits, then handles both `error` and `saved` results. It
passes `controller.signal` to load and save. Call `controller.abort()` when
cancelling that request; create a new controller for a subsequent operation.
Cancellation cannot undo an already committed write. Inspect the record after
cancellation or a network failure before submitting again.

The same field error can appear in both collections. If your interface combines
them into one list, show each matching field ID and error message only once.

`isComputeMode` follows hosted Form behavior and can create or update records.
The client does not retry requests automatically. Every method accepts an
optional `AbortSignal`; cancellation propagates without becoming an SDK error.

For v1 calls and signed uploads, network, HTTP, invalid-response, and endpoint
failures throw `SDKError`, with `kind`, optional `status`, optional server
`code`, and an optional `cause`. A v1 `{error:true,message}` response throws
with `kind:'api'` even when its HTTP status is 200. Form validation results with
`type:'error'` are returned normally.

tRPC-backed calls preserve the official client's native `TRPCClientError`,
including its server error shape and data; they are not converted to
`SDKError`. The client adds no retry link or automatic mutation replay.

## Response types

Loading returns a redirect or the `password`, `login_page`, `form_loaded`, or
`portal_loaded` screen. Stable metadata, records, field schemas, and save
results use portable types generated from the canonical v1 contracts and tRPC
procedure inputs and outputs. Responses retain all wire
properties, including configuration properties beyond those documented here;
the client does not convert field names, dates, or record values.

`publicFields.state` contains the published extension's settings.
`fieldIdsToSchemas[fieldId]` contains the Airtable field and its
`miniExtConfig`. Settings and field configurations use their canonical types;
the client does not validate them with another runtime schema.

The packaged declaration snapshot has SHA256
`fc21700cf0399a556aa5d874847e589d6907199726785cc0df717bc90f6af275`.
Both module formats ship the same `runtime/contracts/generated.d.ts` bytes;
their public provenance includes this `contractDeclarationsSha256` for direct
verification. Its `generatedSha256` separately identifies the generator's
recorded TypeScript source, which is not the emitted declaration file.

Maintainers with authorized internal source access can verify the checked-in
snapshot against the detailed internal manifest:

```sh
node scripts/generate-runtime-contracts.mjs --monorepo /path/to/monorepo --revision <approved-full-source-SHA> --check
```

Operation-snapshot generation checks the selected source revision and input file hashes.
Before compiling contracts or writing outputs, it executes that checkout's
unchanged canonical public-runtime CORS transport helper.
Every generated public tRPC query/mutation must receive both preflight and
actual-response grants with the SDK's `miniext-context` header; private, mixed,
malformed and unsupported-method/header requests must remain denied. The actual
responses must remain private/no-store without credentialed CORS grants.

This runs only when a maintainer explicitly passes `--monorepo`. Ordinary SDK
and package CI uses committed source fixtures and never accesses the private
monorepo. The helper currently has only type imports; if runtime dependencies
are added, generation fails clearly and needs an explicit canonical backend
test adapter, not an SDK copy of permission code or an allowlist parser.

Do not assume an open canonical CORS fix is merged or deployed. Adopt an
approved source revision with the matching policy; omission errors name each
SDK operation, route, HTTP method and failed grant. To regenerate, omit
`--check`, then review both generated outputs and the provenance (including
the canonical policy source hash and guard hash). The existing default pins a
historical revision and is not an automatic selection of current backend code.
Regenerate the snapshot and update the packaged declaration digest when
adopting API contract changes. Installed consumers need no internal source,
generator or credentials.

Native PostgreSQL metadata, query/create/update contracts and record settings
have an independent generated snapshot, so adding these types does not replace
the existing operation contracts. Create results describe committed native
`RETURNING` values; these adapter contracts do not add a loaded PostgreSQL Form
or a new public save operation. `PostgresRowObservation` carries the native key,
metadata and field baselines from an authorized read. `PostgresUpdateQuery`
distinguishes omitted assignments, empty text and SQL NULL, with an expected
baseline for each submitted field. `PostgresUpdateResult` describes acknowledged
COMMIT and its actual returned observation, including a changed primary key.
These types add no public Portal transport or lasting mutation authority.
Maintainers verify it with:

```sh
node scripts/generate-runtime-contracts.mjs --postgres-only --monorepo /path/to/monorepo --revision <approved-full-source-SHA> --verify --check
```

Omit `--verify --check` to generate it. This mode reads the canonical native
models and private authoring schemas using compiler, source-hash and bidirectional contract checks;
it generates no API operations and does not run transport CORS checks. It also
relocates the authored attachment-display parser into a portable runtime module
using an AST import rewrite. The private manifest binds canonical source bytes,
generated TypeScript, the emitter and expected ESM/CommonJS/declaration outputs;
build and installed-package checks verify those outputs independently. Both
module formats ship `runtime/contracts/postgres.generated.d.ts` with public
declaration provenance. Private source revisions and source paths remain in the
repository's internal manifest.

`PostgresTextColumnConfig`, `PostgresBooleanColumnConfig`,
`PostgresNumericColumnConfig`, `PostgresDateColumnConfig` and
`PostgresEnumColumnConfig` are portable inferred
types of the application's generated scalar column storage schemas, which come
from its authored settings. Optional settings stay absent unless supplied;
explicit false, zero, empty strings and undefined retain their canonical types.
Boolean, numeric, SQL DATE and enum settings expose the common controls and omit
text-only display, attachment, placeholder, character and whitespace controls.
They add no numeric formatting, date format, time zone or checkbox-style setting.
Native numeric and SQL DATE values remain text/NULL. No Zod import, schema
validator or value parser/decoder ships with these configuration types.
Runtime constraints such as finite, nonnegative integer
limits still belong to the application's schema; these exports do not enable
public Form loading, saving or submission, or define Required submission rules.

Native maintainer generation verifies the canonical configuration receipt,
generated schema and complete versioned source-hash closure. Historical v1
receipts contribute the text family; v2 requires exactly the text and Boolean
families; v3 requires exactly text, Boolean, numeric and SQL DATE. V4 keeps those
four storage families and also binds the authored text-presentation policy and
its generated sidecar. The SDK relocates that sidecar into a separate portable
runtime module with no imports or copied policy implementation. Its descriptor,
resolver and error class are verified against the canonical module; the
attachment parser stays separate. The private
native manifest binds the receipt validator's bytes, and
build checks verify that binding without opening the canonical checkout.
Ordinary SDK CI still uses committed portable declarations and SDK dependencies.
Version 5 adds the enum storage family and its exact 22-source authoring closure.
Versions 1–4 keep their existing family/source sets. Versions 4 and 5 use the
same two portable display artifacts. Enum labels remain ordered database
metadata; configuration does not copy choices, trim values or admit enum writes.
This checkpoint covers enum settings/read preview; native enum entry and its
Required edge cases remain separate implementation work.

`parsePostgresAttachmentDisplay` projects stored text into read-only URL strings.
Literal commas separate absolute HTTP(S) URLs; use `%2C` for a comma inside one
URL. Spaces around entries are ignored. Quoted entries, backslash escaping,
empty entries, malformed URLs and URL credentials fail with a
`PostgresAttachmentDisplayError` carrying a zero-based `index` and canonical
`reason`, without echoing the URL. SQL NULL and blank text project to an empty
list. `POSTGRES_ATTACHMENT_DISPLAY_SYNTAX` exposes the same authored grammar.
The parser preserves URL bytes and stored text, performs no network access and
does not verify reachability or public access. It grants no upload, mutation,
file-hosting or generated attachment capability.

## Portal tables, search, and pagination

Load a Portal first, then read one of its configured linked-record fields.
The selected custom view ID comes from that field's `miniExtConfig.customViews`.
It is a miniExtensions custom view ID, not an Airtable view ID.

```ts
if (extension.extensionScreen === 'portal_loaded') {
    const page = await client.portals.listLinkedRecords({
        extensionAccessToken: extension.payload.extensionAccessToken,
        portalFieldId: 'YOUR_CONFIGURED_PORTAL_FIELD_ID',
        selectedCustomViewId: 'YOUR_CONFIGURED_CUSTOM_VIEW_ID',
        alreadyLoadedRecordIds: [],
        airtableOffset: null,
        pagesToFetch: 1,
        searchTerm: null,
        searchParamsMap: {},
        sortFieldsByEndUser: null,
        filtersByEndUser: null,
    });

    // Records are keyed by record ID; their field values use field IDs.
    // Display page.recordIds in order; nested records may also be returned.
    const table = page.tableIdsToLinkedTableStates['YOUR_LINKED_TABLE_ID'];
    for (const recordId of page.recordIds) {
        const record = table?.recordIdsToAirtableRecords[recordId];
    }
}
```

To search, send `searchTerm` and reset `airtableOffset` to `null`. The server
applies the selected view's searchable field projection, configuration, and
membership rules. Search Page inputs also use `searchParamsMap` with the
configured search field's ID and current name. Calendar views accept a
`calendarLayoutFilter` with `monthToFetchRecordsFor` (`YYYY-MM`),
`clientUtcOffset`, and optional `clientTimeZone`.

When `airtableOffset` is non-null, another page exists. Pass that opaque offset
to the next request, using the same view, search, sort, and filter criteria.
Append the returned `recordIds`, deduplicate them, and merge each returned
table's `recordIdsToAirtableRecords`. A paginated response contains the
additional records rather than repeating earlier pages. Reset the offset and
displayed records whenever the criteria change. `pagesToFetch: null` requests
one page; the server bounds a request to at most 100 pages.

`alreadyLoadedRecordIds` avoids fetching already loaded nested record labels;
it does not grant access. `refreshLoggedInPortalRecord: true` reads the live
Portal user record before applying relationships, which is useful when
reloading after a mutation. `portals.getUserRecord({extensionAccessToken})`
returns the current token's Portal user record or `null` and accepts no target
record ID.

Sorts use `RuntimeSortFields`: an array of `{idOrName: {type: 'id', id},
type: 'asc' | 'desc'}`. Filters use `RuntimeConditionsDefinition`, including
typed field/operator pairs. The server validates the selected view's allowed
fields and configuration. If your app persists these preferences, set
`supportsEndUserSortCleanup: true` and/or `supportsEndUserFilterCleanup: true`.
A cleanup response contains a safe replacement preference and no records;
update that preference, tell the user, then issue a fresh read. The SDK does
not retry or persist preferences automatically.

## Portal child Forms and actions

A successful linked-table read establishes the server's private edit
capability for the returned records when that view permits editing. Keep
using the same Portal access token; no capability token is returned for your
app to construct. An arbitrary record ID or a different custom view ID never
replaces that read.

The published field configuration supplies the child IDs:
`extensionIdForCreating`, `extensionIdForEditing`, or
`extensionIdForCreatingAndEditing`, according to `allowCreatingRecords`,
`allowEditingRecords`, and `formsForEditingAndCreating`. Use the configured
child, the actual Portal field ID, and a record ID returned by the permitted
read:

```ts
import type { PortalLoadedResult } from '@miniextensions/sdk';

async function loadEditChild(
    portal: PortalLoadedResult,
    portalFieldId: string,
    configuredEditChildId: string,
    permittedRecordId: string,
    linkedTableId: string
) {
    return client.loadExtension({
        childExtensionAccessData: {
            parentExtensionAccessToken: portal.payload.extensionAccessToken,
            fieldIdUsedToAccessExtension: portalFieldId,
        },
        childExtensionInfo: {
            childExtensionId: configuredEditChildId,
            accessType: {
                type: 'edit',
                childExtensionRecordId: permittedRecordId,
                childExtensionFieldId: null,
            },
        },
        context: {
            type: 'modal',
            linkedTableIdOfLinkedRecordField: linkedTableId,
            prefillDataForLinkedRecordsForm: null,
        },
        query: {},
    });
}
```

For creation, use `accessType: {type: 'create'}` and the configured create
child. Preserve `LinkedRecordPrefill` in both load and save context: its
`toLinkToParent` uses the linked field's `inverseLinkFieldId` and the current
Portal user's record ID, and `prefillQueryForChildExtension` retains any
configured parent-supplied query string. The loaded Form's field-ID data may
include hidden prefills; do not discard them when editing visible controls.

Save a child with its own `extensionAccessToken` and
`context: {type: 'modal', prefillData}`. A successful child save returns the
saved record, refreshed `loggedInUserRecord`, and linked table states in
`result.context` for immediate UI updates. Subsequent linked-table reads can
refresh the list using the current relationship.

Other Portal actions use the same published configuration and visitor scope:

| Method                      | Inputs and result                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `portals.updateGridCell`    | `{portalExtensionAccessToken, portalFieldId, recordFieldId, recordId, value, selectedCustomViewId?}`; returns the saved `record`, `auditTrail`, and `auditTrails`.                                                |
| `portals.unlinkRecord`      | `{extensionAccessToken, portalFieldId, recordIdToUnlink, selectedCustomViewId}`; resolves with no value. Reload the Portal afterward because unlink retires the parent token.                                     |
| `portals.setKanbanCategory` | `{extensionAccessToken, portalFieldId, recordId, categoryFieldValue, selectedCustomViewId}`; the server derives the configured category field. Returns `logged-in` with the refreshed user record, or `no-login`. |
| `forms.deleteCurrentRecord` | `{extensionAccessToken}`; deletes the current authorized edit record and resolves with no value. There is no caller-supplied target record ID.                                                                    |

After Grid edits, refresh the root user with `portals.getUserRecord` so
summaries and relationship values stay current. Keep draft ownership per
record and session; a late response from one visitor must not overwrite a
different visitor's draft.

## Linked-record selectors and select choices

`linkedRecords.listFormOptions` accepts a Form token, `linkedRecordFieldId`,
`filter`, `offset`, and `conditionalLinkedRecordFilteringValues`.
`linkedRecords.listPortalOptions` accepts a Portal token, the linked field to
edit, `portalTableId`, `portalFieldId`, `filter`, and `offset`. Both return
`{records, offset, tableIdsToLinkedTableStates}`. These methods read only the
choices allowed by the published configuration; choosing an option in your
interface does not save it.

```ts
import type { FormLoadedResult } from '@miniextensions/sdk';

async function listFormChoices(form: FormLoadedResult) {
    return client.linkedRecords.listFormOptions({
        extensionAccessToken: form.payload.extensionAccessToken,
        linkedRecordFieldId: 'YOUR_LINKED_FIELD_ID',
        filter: { viewType: 'list', searchTerm: 'search words' },
        offset: null,
        conditionalLinkedRecordFilteringValues: {},
    });
}
```

Use `filter: {viewType: 'calendar', month: 'YYYY-MM', clientUtcOffset}` for a
configured calendar selector. Supply the current dynamic filter values for
Forms that use conditional linked filtering. Pass the returned `offset` for
another page and reset it when the filter changes.

`linkedRecords.loadSelectedRecords({extensionAccessToken})` returns linked
table states for the current Form's selected values. It has no caller-supplied
record IDs and makes no mutation. Returned extension-used field metadata can
also include an authorized linked table with no selected record IDs; it is
not an arbitrary full-schema read. Merge those states to show selected labels.

When a Form allows adding select choices,
`forms.addSelectOption({extensionAccessToken, airtableFieldId, newChoiceText})`
returns `{newChoice}`. Creating a choice mutates the allowed Airtable field's
options. Add that choice to your local schema and draft value, then save the
Form to write the record's selection.

## Conditional linked-filter primary values

`linkedRecords.listConditionalFilterPrimaryValues` reads the choices for one
configured conditional filter on a Form's linked-record selector. Use the
current Form token, the selector's outer `mainTableLinkedRecordsFieldId`, and
the exact configured `linkedRecordsFilterFieldId` in its linked table. The
result is `{primaryValues, prefillValue}`; each value contains `recordId` and
`stringValue`. This reads candidate primary values, rather than primary-field
schema metadata. It grants no record mutation permission.

```ts
import type {
    ListConditionalFilterPrimaryValuesInput,
    ConditionalFilterPrimaryValue,
    ConditionalLinkedRecordFilteringValues,
} from '@miniextensions/sdk';

async function readConditionalFilterValues(
    request: ListConditionalFilterPrimaryValuesInput,
    signal: AbortSignal
) {
    return client.linkedRecords.listConditionalFilterPrimaryValues(request, {
        signal,
    });
}

function retainConditionalFilterChoice(
    values: ConditionalLinkedRecordFilteringValues,
    filterFieldId: string,
    selected: ConditionalFilterPrimaryValue | null
): ConditionalLinkedRecordFilteringValues {
    return { ...values, [filterFieldId]: selected };
}
```

Supply `searchTerm` and `urlSearchValue` explicitly, using `null` for an absent
URL prefill. For the first filter, pass `filterData: null`. For a later filter,
pass `{previousFilterFieldId, previousFilterPrimaryValue}` from the immediately
preceding configured selection; `previousFilterPrimaryValue` is its
`stringValue`, while the selected pair retains `recordId` as its identity.
Duplicate readable labels can belong to different records. Accept only the
server's returned `prefillValue` as a resolved URL prefill. The endpoint returns
up to 100 primary values and supplies no page offset; refine `searchTerm` to
find another value.

Your application renders the filter controls in configured order, clears
downstream selections when an earlier selection changes, and cancels or
discards responses after a search, prior choice, visitor, record, or loaded
configuration change. Pass the selected pair/null map to
`linkedRecords.listFormOptions` as `conditionalLinkedRecordFilteringValues`
and nest it under the outer linked-field ID in the Form save's
`conditionalLinkedRecordFieldIdsToFilteringValues`. Preserve existing raw link
IDs when the filter changes; projected available records and a saved draft are
different states. Honor the configured add/remove restrictions independently
when a driver is missing, null, or has an empty primary string. The published
handler enforces its configured rules and may sanitize links while accepting
other field edits; save success alone does not establish that a proposed link
was accepted.

The shipped [browser example](../examples/browser/README.md) implements these
controls through the [pure SDK cascade model](forms.md#headless-conditional-linked-filter-cascades);
the example adapter owns DOM, network, cancellation and paging. **Load conditional filters**
explicitly obtains and shares the existing token-only metadata read for that
loaded Form, then resolves root/direct URL prefills sequentially, including
when its selectors are configured hidden. Filter names come from returned current metadata;
URL keys are `prefill_<current field name>`. The Connect handler copies only
`prefill_*` query entries, preserving decoded bytes and repeated-key arrays.
The cascade accepts only scalar strings and server-returned prefill pairs;
Portal child URL-prefill propagation is not added. A failed metadata request
permits another explicit Load action, without automatic retry.

This bounded example supports unique ID-based configured descriptors whose
fields/names are all present in authorized metadata. Name references,
duplicates, malformed config, or missing fields show an unavailable state
rather than guessed controls or native skipped-descriptor parity. Original
empty-driver flags still apply independently, and flags that permit ordinary
candidate reads/local changes retain that behavior. Filter/search changes
invalidate stale responses and linked-option paging. Visitor, session,
loaded-Form, field, request and disposal guards prevent an old response from
crossing owners. This supplies neither a general conditional UI evaluator nor
additional backend permission.

## Address predictions and place formatting

For a single-line text field configured with `enableAddressAutocomplete:
true`, `addresses.listPredictions` accepts `{extensionAccessToken, fieldId,
addressFieldValue}` and returns `{description, placeId}[]`.
`addresses.getFormattedAddress` accepts `{extensionAccessToken, fieldId,
placeId}` and returns the formatted address as a string. Use the current
Form's token and exact address field ID for both calls. The handler rejects
fields without autocomplete enabled, read-only fields, and password-obscured
fields. The API deployment must have its address provider configured; provider
failures and server rate limits remain possible. Browser consumers also need
the public tRPC CORS/header support described above. Provider credentials stay
on the server.

```ts
import type {
    ListAddressPredictionsInput,
    GetFormattedAddressInput,
} from '@miniextensions/sdk';

async function readAddressPredictions(
    request: ListAddressPredictionsInput,
    signal: AbortSignal
) {
    return client.addresses.listPredictions(request, { signal });
}

async function readSelectedPlaceAddress(
    request: GetFormattedAddressInput,
    signal: AbortSignal
): Promise<string> {
    return client.addresses.getFormattedAddress(request, { signal });
}
```

These are thin reads. Your application renders suggestions as text, debounces
nonblank input, and keeps a separate generation for typing/predictions and
accepted-place intent. Cancel prior requests on typing, a new choice, field or
visitor changes, and disposal; verify the current owner and accepted place
after each await before applying a result. An abort signal does not replace
that application check. The native renderer waits 800 ms before requesting
predictions, accepts a selected description immediately, and applies place
formatting only while that same selection is current. On a details failure,
retain the draft and allow an explicit retry. Write the accepted string into
your Form draft, mark that field dirty, and save through the normal Form
operation. These thin methods never write or save the field themselves. The
optional [`/ui` address control](ui.md#address-autocomplete) supplies the bounded
presenter and intent guards over these same typed reads; its caller still owns
current Form/visitor authority and deliberate final Save.

## Configured Button webhooks

`buttons.triggerWebhook` calls the configured Button's existing webhook
action. It accepts `{extensionAccessToken, fieldId, source}` and returns
`{success: boolean}`. The server derives the Button's URL, GET/POST mode,
visibility conditions, record scope, and current action permission; the input
has no URL or HTTP method. `success: false` is a normal action result. Native
tRPC errors remain exceptions.

```ts
import type {
    TriggerConfiguredButtonWebhookInput,
    TriggerConfiguredButtonWebhookResult,
} from '@miniextensions/sdk';

// Call from a deliberate click after your app checks its current owner/action.
async function invokeConfiguredButton(
    request: TriggerConfiguredButtonWebhookInput,
    signal: AbortSignal
): Promise<TriggerConfiguredButtonWebhookResult> {
    return client.buttons.triggerWebhook(request, { signal });
}
```

The `source` union is exact:

- `{type: 'current-record', recordId}` uses the current authorized Form or
  Portal record and its token.
- `{type: 'linked-record', linkedRecordId, linkedTableId,
parentLinkedRecordFieldId, selectedCustomViewId?}` uses the clicked linked
  record, resolved linked table, and the parent selector's outer field ID.
  Here `fieldId` is the Button in the linked record, rather than that outer
  field. A Portal action needs the current configured view/action capability
  from its current server list; preserve its `selectedCustomViewId`. A Form
  linked action can omit the view or use `null` when no view applies.

Use the exact current token and configured Button field. Render webhook
actions only for the configured GET/POST mode and a usable current Button URL,
with one pending click at a time. A Button being computed is normal; editable
cell checks on computed/read-only values do not decide action authority. An
unbound create draft has no current-record action; after Save & Continue,
use the authorized saved-record context returned by the runtime. The server
rechecks the configured parent membership, selected view, conditions, and
current record proof, including strict expiry of its short-lived record cache.
Cached display values alone grant no action permission.

Your app owns loading state, duplicate-click suppression, configured success
and failure messages, and whether to refresh after completion. Before dispatch
and after awaiting the result, compare the visitor, record, field, loaded
configuration, selected view, and owner generation. Cancel and invalidate that
owner on navigation or disposal. A failed or aborted request can leave the
remote side effect uncertain; require an explicit decision before another
attempt. The client makes one request and supplies no automatic retry, Button
renderer, or workflow controller.

## Attachments

`attachments.uploadFile` accepts a browser `File` or `Blob`, the desired
filename, the loaded Form's token, and its attachment field ID:

```ts
async function uploadFormAttachment(
    form: FormLoadedResult,
    file: File,
    signal: AbortSignal
) {
    return client.attachments.uploadFile(
        {
            file,
            filename: file.name,
            extensionAccessToken: form.payload.extensionAccessToken,
            fieldId: 'YOUR_ATTACHMENT_FIELD_ID',
        },
        { signal }
    );
}
```

The helper requests a URL authorized for that Form field, uploads the bytes
with an anonymous `PUT`, and returns `{id: null, url, filename, size, type}`.
It uses the same fetch implementation and abort signal as other methods. The
visitor session is sent only to the miniExtensions API; it is never attached
to the upload request. Add the returned value to the field's draft array and
mark that field dirty before saving the Form. Uploading does not save the record.

For a custom upload implementation, call
`attachments.createUploadUrl({fileType, filename, fileSize, authority: {type:
'form', extensionAccessToken, fieldId}})` and use its `signedUrl` and
`publicUrl`. Treat signed URLs as temporary credentials; do not log or publish
them. The server enforces the current field's upload permissions and file
rules. No helper retries an upload or replays a failed save.

## Child-record comments

Comments use the loaded child Form's token, not the Portal root token:

```ts
async function readAndAddChildComment(
    child: FormLoadedResult,
    comment: string
) {
    const comments = await client.comments.listForRecord({
        childExtensionAccessToken: child.payload.extensionAccessToken,
    });
    if (comments.disableSending === true) return;
    await client.comments.addToRecord({
        childExtensionAccessToken: child.payload.extensionAccessToken,
        comment,
    });
}
```

The list returns `{comments, readableVersionOfRecordPrimaryValue,
disableSending?, nextCursor?, includeCommenterPrefix?}`. Comments share `id`,
`text`, `createdTime`, and nullable `lastUpdatedTime`. Narrow the comment union
before reading source-specific attribution: Airtable comments have `author`
and `mentioned`; native Table comments have `actor` and `authorLabel`.
The helper below selects raw Airtable account attribution or the native label.
Legacy Airtable text may contain a `{{label}}: ` prefix used as a display alias;
handle that separately when rendering Airtable comments, without deriving
native attribution from comment text.

```ts
import type { ListRecordCommentsResult } from '@miniextensions/sdk';

function childCommentAuthor(
    comment: ListRecordCommentsResult['comments'][number]
): string {
    if ('author' in comment) {
        return comment.author.name ?? comment.author.email;
    }
    return comment.authorLabel;
}

async function readChildCommentPage(
    child: FormLoadedResult,
    cursor?: string
): Promise<ListRecordCommentsResult> {
    return client.comments.listForRecord({
        childExtensionAccessToken: child.payload.extensionAccessToken,
        cursor,
    });
}
```

Omit `cursor` for the initial page. If the response includes `nextCursor`,
retain that opaque value and pass it as `cursor` for an explicit request for
older comments on the same child Form. Each page is ordered oldest to newest;
prepend an older page to the displayed history. Stop when `nextCursor` is
absent. Airtable responses currently omit it. The SDK does not automatically
fetch further pages or retry a failed read. Retain the displayed history and
cursor on failure, and discard them when the child or visitor changes.

`readableVersionOfRecordPrimaryValue` labels the parent visitor using its
configured `commenterNameField`, the first login field for a login Form or
Portal, or the parent's primary field otherwise. It may be `null`.
Read a child record's title from that child's Form record and field schema.
When `includeCommenterPrefix` is `false`, do not prefix new comment text with
that visitor label; native Table attribution is supplied by the server.
When the flag is omitted or `true`, the existing Airtable interface retains
the legacy `{{label}}: ` prefix when a visitor label is available.
Respect `disableSending` in your interface. Adding a comment resolves with no
value; load the initial page again if your app wants to refresh it, replacing
the displayed history and cursor after a successful read. The server derives
the actual child record and author from the current visitor, verified token,
and parent configuration.

## Designing your custom interface

The core runtime client supplies data and authorized operations. Optional
[selection controls](ui.md), [Form drafts and controllers](forms.md), and
[Portal collections](portals.md) help wire those capabilities to your interface.
Your application controls layout, conditional presentation, multi-page drafts,
local validation hints, field formatting, CAPTCHA widgets, filtering controls,
and visitor session persistence. The server retains its own validation and
authorization; hiding a button is never the only permission check.

Use field IDs for record values, dirty lists, selectors, and actions. Use the
loaded field's current name at explicit name-based boundaries such as login
credentials and prefill query strings. Preserve hidden prefills and native
Airtable values. Escape record text through your renderer rather than inserting
record values as HTML.

Keep one client/session per visitor and discard stale UI responses after a
visitor, connection, record, or configuration change. Treat Form validation
as a normal result, transport failures as exceptions, and cancellation as an
uncertain write outcome. The SDK never automatically repeats a mutation.

## Renderer data types

Renderer ports can import exact generated payload aliases from the package root. These are types only: they do not grant write access, choose a display policy, or replace the Form/Portal owners.

```ts
import type {
    AirtableButtonField,
    AirtableButtonValue,
    FormFieldsMiniExtConfigButtonField,
    ButtonMiniExtConfig,
} from '@miniextensions/sdk';

export type ButtonRendererData = {
    field: AirtableButtonField;
    value: AirtableButtonValue | null;
    configuredField: FormFieldsMiniExtConfigButtonField;
    config: ButtonMiniExtConfig;
};
```

- Native metadata uses the `Airtable*Field` family: SingleLineText, Email, URL, MultilineText, Numeric (number/percent), Currency, Select (single/multiple), Collaborator (single/multiple and its inherited createdBy discriminator), LinkedRecord, Date, DateTime, PhoneNumber, Attachments, Checkbox, Formula, CreatedTime, Rollup, Count, Lookup, AutoNumber, Barcode, Rating, RichText, Duration, LastModifiedTime, CreatedBy, LastModifiedBy, Button, ExternalSyncSource and Ai. Manual-sort metadata remains available through `AirtableField`; it has no renderer alias in this slice.
- `FormFieldsMiniExtFieldWithConfig` is the exact configured Form field envelope. The 33 `FormFieldsMiniExtConfig*Field` aliases select its original discriminators, including separate Number/Percent, SingleSelect/MultipleSelects and SingleCollaborator/MultipleCollaborators envelopes. Their `config` remains optional. `RuntimeFieldSchema.miniExtConfig` is broader and must not be treated as this Form-only type.
- `AirtableButtonValue` requires native `url: string` and `label: string`. It is distinct from the formula interpreter's nullable-URL value. `NonArrayAirtableValue` excludes native array answers. Neither alias validates a URL or authorizes a webhook.
- `LinkedRecordsMiniExtConfig` is the non-undefined union of configured Form and Portal linked-field settings; it is not a login/custom-detail configuration.

Existing `RuntimeLanguage`, `ConfiguredButtonWebhookSource`, `RuntimeLinkedRecordDetailField(s)`, `RuntimeSortFields`, `RuntimeConditionsDefinition` and `RuntimeTableState` already cover the corresponding portable contracts. Internal application state, session IDs, widget props and renderer callbacks are intentionally separate. React components stay in the optional [`/react` subpath](field-bindings.md); this type mapping adds no React dependency to the core.

Form-only aliases do not describe every renderer host. Use the accepted Portal payload's configured field envelope for Portal settings and its returned detail policy for cells, lists and readonly previews; do not substitute child Form configuration for a Portal display override. The existing aliases expose those contexts without copying schemas:

```ts
import type {
    PortalLoadedPayload,
    RuntimeLinkedRecordDetailField,
} from '@miniextensions/sdk';

export type PortalConfiguredField = NonNullable<
    PortalLoadedPayload['publicFields']['state']['portalFields']
>[number];
export type PortalDetailDisplayConfig =
    RuntimeLinkedRecordDetailField['miniExtConfig'];
```

These payload types cover native data. The [typed renderer hosts](field-bindings.md#typed-renderer-hosts-and-named-slots) combine them with correlated per-kind action props. [Form composition](field-bindings.md#form-composition-with-app-owned-layout) and [Portal Grid/List composition](field-bindings.md#portal-composition-with-app-owned-layout) reuse the existing SDK owners and capabilities; a native `readOnly` or computed flag alone does not authorize a Button action. Applications supply layout and visual field renderers.

## Clientless hosted Button dispatch gate

`createButtonDispatchGate` from `@miniextensions/sdk/ui` shares only new-click
admission and one-flight-at-a-time behavior when an application already owns its
Button transport, feedback and recovery policy. It requires no client, accepted
Form/Portal model or recovery journal and does not authorize a server operation.

```ts
import { createButtonDispatchGate } from '@miniextensions/sdk/ui';

export function bindHostedButton(host: {
    ownerIsCurrent(): boolean;
    sourceAndModeAreAvailable(): boolean;
    invoke(): Promise<void>;
    setPending(pending: boolean): void;
}) {
    const gate = createButtonDispatchGate({
        isCurrent: () => host.ownerIsCurrent(),
        canTrigger: () => host.sourceAndModeAreAvailable(),
        dispatch: async () => {
            // Existing host transport, feedback and error handling.
            await host.invoke();
        },
        pendingChanged: (pending) => host.setPending(pending),
    });
    return {
        // `true` means host callback completion, not webhook success.
        onClick: () => gate.run(),
        dispose: () => gate.dispose(),
    };
}
```

Create one gate per committed Button owner/policy lease. A false or throwing
`isCurrent` observation permanently retires it; a temporary false/throwing
`canTrigger` observation refuses only that intent. The gate reserves its flight
before any host callback and rechecks current ownership and availability after
pending presentation. Reentrant or concurrent activations are refused. A
computed/read-only Button can still have a configured action: supply the actual
Button source/mode predicate, not Form value editability.

A dispatch rejection propagates unchanged after releasing its own flight; the
host decides feedback and whether a later explicit click is a retry. Presentation
exceptions do not cancel dispatch. Disposal suppresses new clicks and later
pending notifications; it never aborts, replays or discards an allocated host
promise. Host continuations must retain their existing current-owner checks for
feedback and settlement. The gate observes only an action's admission/flight,
never its native record data, token, source, success or uncertain outcome.

This additive compatibility facet does not change `createButtonFieldModel`,
`createFormButtonFieldModel` or `createPortalButtonFieldModel`: those accepted SDK
models retain their own client, journal and explicit uncertainty acknowledgement.
It also does not replace hosted canonical cell queues or ordered attachment
batches/partial recovery with the SDK's private drafts or one-file upload model.
The synthetic host baseline permits an explicit next click after a reported or
transport failure; the gate preserves it without automatically acknowledging an
unknown journal attempt or inventing accepted client authority.

### Limited create Form loading

`loadExtensionWithCapabilities` runs the complete capability-first handshake with
your real client, or an explicit native `transport`. Supply an `isCurrent` receipt
that stays false after retirement (use a monotonic generation for context ABA),
and optionally an AbortSignal and final-only `publish` callback. It returns the
final canonical screen union, including redirects and authentication screens.

The first direct-root request sends `{ version: 1, visitorId: null }`. Only a
successful root limited CREATE Form starts the explicitly supplied provider and
a second request. Missing, invalid or rejected identity throws
`LimitedFormLoadError` with `code: 'capability_unavailable'`; retirement throws
`code: 'retired'`. Neither exposes the first limited Form. There is no orchestration
retry. Native transports retain their own physical retry policy.

Wrap your collector with `createCachedDeviceFingerprintProvider(collect)`. Each
instance owns its in-flight and successful identity; failures are evicted for a
later explicit attempt. Deliberately share that same instance with applicable
allocated Compute and Save preparation using `getDeviceFingerprint` and
`requiresFormDeviceFingerprint`. Create-to-edit drops eligibility. A retiring load
never cancels shared collection or changes allocated Save settlement. Core
includes no browser collector, telemetry, default provider or global cache.

Original logical input (including saved progress), client session, query, timezone
and view mode are detached once. Every transport gets a fresh detached request;
host-only transport context may resolve afresh. Host progress revision/writer
provenance stays with the existing publication owner and must never be sent,
reread or written by the loader.
