# Runtime client

The runtime client calls the miniExtensions SDK endpoint at `/api/sdk`.
Availability of that endpoint depends on the server deployment. The SDK is a
headless client: your app renders the interface while miniExtensions enforces
the published Form/Portal's visitor, record, field, and action permissions.

For a runnable application, see the [custom Form and Portal example](../examples/browser/README.md)
in the SDK checkout. It uses an installed packed archive and a separate browser
origin.

```ts
import {
    createMiniExtensionsClient,
    SDKError,
    withExtensionPassword,
    withLoginToken,
} from '@miniextensions/sdk';

const client = createMiniExtensionsClient({
    apiOrigin: 'https://your-api-origin.example',
    publishableKey: 'YOUR_PUBLISHABLE_KEY',
});

const input = {
    shareId: 'YOUR_SHARE_ID',
    recordId: null,
    context: { type: 'direct-url' as const },
};
const extension = await client.loadExtension(input);
```

Use your publishable workspace key in browser applications. A key does not
replace the visitor's extension password, login, record access, captcha, or
other Form rules. Runtime requests use published extensions. The client sends
the key in the Authorization header and omits browser cookies.

Workspace owners and active admins create keys in Settings under **Publishable
SDK keys**. Copy the key when it is created; later visits show only its label
and status. Keys cover all supported SDK operations in that workspace, do not
expire, and can be revoked from the same card. Revocation rejects subsequent
SDK requests; it does not cancel an in-flight save or disable hosted Forms and
Portals. Removing the key's creator does not revoke the workspace-owned key.

`apiOrigin` must be an HTTP(S) origin without a path, query, fragment, or URL
credentials. Node.js 22+ and browsers with native `fetch`, `TextEncoder`, and
`AbortSignal` are supported. Supply `fetch` in the constructor to use another
compatible network implementation.

## Password and login

Methods return the hosted runtime's tagged results. A wrong password, blocked
password attempt, missing login record, or verification message is a normal
result that your UI can handle.

```ts
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

```ts
const result = await client.forms.save(saveInput, {
    signal: controller.signal,
});
if (result.type === 'error') {
    // Display result.formValidationErrors, result.formErrors, and an optional
    // result.concurrentEditErrorMessage.
} else {
    // Handle result.record and any post-submission warnings/notifications.
}
```

`isComputeMode` follows hosted Form behavior and can create or update records.
The client does not retry requests automatically. Every method accepts an
optional `AbortSignal`; cancellation propagates without becoming an SDK error.

Network, HTTP, invalid-response, and endpoint failures throw `SDKError`, with
`kind`, optional `status`, optional `code`, and an optional `cause`. Endpoint
`{error:true,message}` responses throw even when their HTTP status is 200. Form
validation results with `type:'error'` are returned normally.

## Response types

Loading returns a redirect or the `password`, `login_page`, `form_loaded`, or
`portal_loaded` screen. Stable metadata, records, field schemas, and save
results have portable TypeScript types. Generated public settings and field
configuration are represented as JSON objects. Responses retain all wire
properties, including configuration properties beyond those documented here;
the client does not convert field names, dates, or record values.

`publicFields.state` contains the published extension's settings.
`fieldIdsToSchemas[fieldId]` contains the Airtable field and its
`miniExtConfig`. These settings remain JSON objects so the SDK can retain new
server configuration without duplicating the entire builder schema. Narrow
JSON values before using them in your UI.

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

    // Records are keyed by field ID in the linked table's state.
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
const child = await client.loadExtension({
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
const choices = await client.linkedRecords.listFormOptions({
    extensionAccessToken: form.payload.extensionAccessToken,
    linkedRecordFieldId: 'YOUR_LINKED_FIELD_ID',
    filter: { viewType: 'list', searchTerm: 'search words' },
    offset: null,
    conditionalLinkedRecordFilteringValues: {},
});
```

Use `filter: {viewType: 'calendar', month: 'YYYY-MM', clientUtcOffset}` for a
configured calendar selector. Supply the current dynamic filter values for
Forms that use conditional linked filtering. Pass the returned `offset` for
another page and reset it when the filter changes.

`linkedRecords.loadSelectedRecords({extensionAccessToken})` returns linked
table states for the current Form's selected values. It has no caller-supplied
record IDs and makes no mutation. Merge those states to show selected labels.

When a Form allows adding select choices,
`forms.addSelectOption({extensionAccessToken, airtableFieldId, newChoiceText})`
returns `{newChoice}`. Creating a choice mutates the allowed Airtable field's
options. Add that choice to your local schema and draft value, then save the
Form to write the record's selection.

## Attachments

`attachments.uploadFile` accepts a browser `File` or `Blob`, the desired
filename, the loaded Form's token, and its attachment field ID:

```ts
const attachment = await client.attachments.uploadFile(
    {
        file,
        filename: file.name,
        extensionAccessToken: form.payload.extensionAccessToken,
        fieldId: 'YOUR_ATTACHMENT_FIELD_ID',
    },
    { signal: controller.signal }
);
```

The helper requests a URL authorized for that Form field, uploads the bytes
with an anonymous `PUT`, and returns `{id: null, url, filename, size, type}`.
It uses the same fetch implementation and abort signal as other methods. The
workspace key and visitor session are sent only to the SDK endpoint; they are
never attached to the upload request. Add the returned value to the field's
draft array and mark that field dirty before saving the Form. Uploading does
not save the record.

For a custom upload implementation, call
`attachments.createUploadUrl({fileType, filename, fileSize, authority: {type:
'form', extensionAccessToken, fieldId}})` and use its `signedUrl` and
`publicUrl`. Treat signed URLs as temporary credentials; do not log or publish
them. The server enforces the current field's upload permissions and file
rules. No helper retries an upload or replays a failed save.

## Child-record comments

Comments use the loaded child Form's token, not the Portal root token:

```ts
const comments = await client.comments.listForRecord({
    childExtensionAccessToken: child.payload.extensionAccessToken,
});
await client.comments.addToRecord({
    childExtensionAccessToken: child.payload.extensionAccessToken,
    comment: 'The entered comment',
});
```

The list returns `{comments, readableVersionOfRecordPrimaryValue,
disableSending?}`. Each comment includes its text, author, and timestamps.
`readableVersionOfRecordPrimaryValue` labels the parent visitor using its
configured `commenterNameField`, the first login field for a login Form or
Portal, or the parent's Airtable primary field otherwise. It may be `null`.
Read a child record's title from that child's Form record and field schema.
Respect `disableSending` in your interface. Adding a comment resolves with no
value; load the list again if your app wants to refresh it. The server derives
the actual child record and author from the current visitor and published
parent configuration.

## Designing your custom interface

The SDK supplies data and authorized operations rather than UI components.
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
