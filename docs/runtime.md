# Runtime client

The runtime client calls the miniExtensions SDK endpoint at `/api/sdk`.
Availability of that endpoint depends on the server deployment. This client
includes extension loading, password verification, login, verification codes,
sign-up, and Form saves.

```ts
import {
    createMiniExtensionsClient,
    SDKError,
    withExtensionPassword,
    withLoginToken,
} from '@miniextensions/sdk';

const client = createMiniExtensionsClient({
    apiOrigin: 'https://app.miniextensions.com',
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
