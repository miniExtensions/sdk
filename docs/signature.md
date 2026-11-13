# Signature field

`SignatureField` from `@miniextensions/sdk/react` owns the complete Type, Draw,
and Upload control. Import `@miniextensions/sdk/react/signature.css` for its
portable styles. Draw is enabled by default; Type and Upload are opt-in. All
labels can be supplied through `messages`. The control does not submit or save
records. Existing attachment presentation remains the host's responsibility.

Pass the canonical attachment `value`, a stable `ownerIdentity`, field `id`,
`storage`, `appendCurrent`, and `onRecovery`. Same-owner value echoes preserve
drafts. Changing the owner or field retires the old control. Disabling or leaving
a method retires its pending operation. Draft editing remains available during
storage; completion of A cannot clear a newer draft B.

`storage.store(file, authority)` must return attachment metadata and a `release`
closure bound only to the temporary object allocated by that operation. Its
result is `released`, `already-released`, or `uncertain`. The transport owns
cleanup when upload or URL retrieval fails before returning a receipt. Preserve
the original error and report cleanup separately (for example with
`SignatureStorageError`). Never assume a failed request allocated nothing.
External consumers must supply their own authorized temporary-storage adapter.
The ordinary SDK attachment uploader does not implement this contract.

`appendCurrent(request)` is synchronous. Validate the captured owner/field
against the host's current authority, read the latest committed canonical list,
and return `appended` only after the actual commit. Return `retired` only when
positively not committed. The supplied `request.value` is the last committed
host prop, not the list captured when storage began. A host with a newer
canonical store must use that store. A scheduled React state setter alone is
not proof of commit. Never return `appended` merely because a write was queued.

A receipt starts pending. A successful canonical append transfers it; subsequent
unmount or mode changes cannot release it. A positively retired receipt may be
released once. A throwing or unknown append is uncertain: the SDK neither
reappends nor deletes a possibly committed attachment. `onRecovery` receives
unresolved append, transport, and release outcomes, including after unmount.
It must route recovery to host-owned reporting rather than update a retired UI.
An uncertain append disables further intake in that control. Reconcile the
canonical store and object before starting a fresh owner session; remounting is
not evidence that the uncertainty was resolved. Previous-signature reuse
allocates no storage or deletion authority.

The canvas adapter pins `signature_pad` 4.1.7 with its original drawing defaults.
It constructs only after commit, owns a 150ms window-resize debounce, scales by
`max(devicePixelRatio || 1, 1)`, and clears when physical dimensions change after resize as the native wrapper
3.3.4 did. Unchanged dimensions preserve the existing ink. Each effect lifetime creates a separate canvas. Retirement removes
observers, resize timers, and incoming pad listeners. The vendor's private
trailing stroke timer can still draw on the detached old canvas; it cannot
update a successor or canonical draft. No private engine fields are changed.
Typed PNGs are 600x200 with the original cursive font and white background;
drawn PNGs remain transparent. Upload accepts PNG/JPEG/JPG/SVG through the exact
legacy MIME list, up to and including 5MiB.
