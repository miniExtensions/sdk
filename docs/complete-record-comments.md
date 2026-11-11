# Complete record comments

The public `/ui` controller owns comments history, raw drafts and separate read
and append operations. `/react` supplies the complete rows/composer UI and an
optional native modal dialog. Import
`@miniextensions/sdk/react/complete-record-comments.css` for the portable styles.

```ts
import { createRecordCommentsController } from '@miniextensions/sdk/ui';
import {
    CompleteRecordCommentsDialog,
    recordCommentsLabels,
} from '@miniextensions/sdk/react';

const controller = createRecordCommentsController({
    owner: capturedChildOwner,
    childExtensionAccessToken: capturedChildToken,
    list: (input) => client.comments.listForRecord(input),
    append: (input) => client.comments.addToRecord(input),
    invalidate: (input) => host.invalidateCapturedCommentsQuery(input),
    onAppendError: (error) => host.presentMutationError(error),
});
// Render CompleteRecordCommentsDialog with controller, labels and dismiss.
// Supply the selected language as literal RecordCommentsLabels strings.
// recordCommentsLabels contains the English defaults.
```

The host must capture a genuine child owner, token and authorized transport.
`owner.isCurrent()` checks that exact lifetime, including observed replacement
and ABA. Equal record IDs alone are insufficient. Create a new controller for
a replacement owner; do not rebind an existing controller's token or transport.
These frontend inputs do not replace server authorization. The controller
constructs no Form, runtime client, query client or visitor identity.

`append` must reject errors. A mutation wrapper that catches and resolves an
error cannot establish acceptance. Rejections, including uncertain
post-dispatch cancellation, retain the draft and never trigger an automatic
resend. The controller never creates an optimistic row or aborts an allocated
append. A successful append clears only its unchanged original draft, then
invalidates the captured query and starts a separate newest-page read. Cache,
presentation and refresh failures cannot reclassify the append or restore its
sent draft. The host retains one error/plan-limit presenter.
`send()` resolves its append acceptance without waiting for cache invalidation
or refresh completion.

Initial load and explicit Refresh fetch the newest page. Successful refresh
atomically replaces history/cursor and retires preceding pagination. Load older
is explicit, uses the exact opaque cursor and prepends the returned page without
sorting, reversing or deduplicating it. The newest page owns sending policy.
Loading/refetch and read failure hide the composer; accepted history remains
internal until a successful replacement. There are no automatic read retries.

`presentRecordComment` is the canonical portable presenter. Native actors use
server `authorLabel` and unchanged text. Legacy Airtable comments retain their
unanchored alias/substring behavior and author name/email fallback. Only own
mention entries become escaped labels; unresolved/inherited IDs remain literal.
Send preserves the raw draft, admits nonempty whitespace and adds the readable
prefix once unless `includeCommenterPrefix` is false. UI strings are supplied
literally; relative time retains English Moment behavior.

Unmounting the UI removes subscriptions and retires its event callbacks, while
the captured append can still settle and invalidate its original query.
`controller.dispose()` retires a genuinely replaced owner; it cannot roll back
or cancel an append. A successor uses its own controller and draft. Dialog Close,
backdrop and Escape stay available during a send. The SDK owns named-dialog
semantics, focus containment/restoration and the 42rem/80vh header/body/footer
layout. Theme CSS variables, desktop messenger inset and z-index are optional
plain presentation inputs. No private native context is required.
When a transient menu item opens the dialog, pass its stable invoker ref as
`returnFocusTo`; the SDK captures that target at opening and restores it only
while it remains connected.

Source component/controller tests and packed React 18/19 ESM/CommonJS,
declarations, CSS and SSR/hydration checks exercise synthetic transports. The
registered packed Chromium proof covers trusted input/send, pending dismissal,
refresh failure, focus, scrolling geometry, localization and two dialogs with
external requests refused. These checks do not establish native Form admission,
query-cache integration, hosted comment persistence or provider/fixture custody.
