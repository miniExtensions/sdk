# Automatic URL-prefill submission

`createAutomaticPrefillCoordinator` from `@miniextensions/sdk/forms` owns one
automatic intent and its status lifecycle for a committed logical Form/config
scope. `AutomaticPrefillStatus` from `@miniextensions/sdk/react` owns the actual
status UI and committed connection. Import
`@miniextensions/sdk/react/automatic-prefill.css` for its default styles.

The constructor and server rendering are inert. The status component connects
after commit; StrictMode disconnect/reconnect does not create another intent.
An actual new coordinator/remount may attempt again when its genuine native
state is idle. Idle updates, refusal, errors and unknown outcomes never retry an
existing intent automatically.

The host supplies interned opaque owner/configuration/read stamps, currentness
checks, native accepted URL field IDs and final projected values. Keep private
native configuration, tokens, transport and canonical stores in the host.
Read stamps may change after a background Compute; the original logical owner
must remain valid. Do not freeze a create record ID as the Form's authority.

Automatic mode takes precedence over manual Review. Disabled automatic mode,
CAPTCHA, preview and captured Restore/new-Form suppression retain the manual
path. The host consumes and cleans its own URL guard without resetting captured
suppression. Static/copied/restored values alone do not establish URL provenance.
Zero, false, whitespace and nonempty arrays preserve native persistable meaning.

## Request and allocation are distinct

`requestFinalSave` returns a synchronous `accepted`, `coalesced` or `refused`
receipt. A Promise or void is not admission. The request always names final
`save`; the host retains its existing background-Compute waits, identical-pending
nonjoining coalescing, changed-snapshot recheck and authorization.

After those waits, call `admitAllocation` immediately at the canonical allocation
boundary. It rereads the current accepted projection and original scope. Its
ticket is bookkeeping for that one operation, not permission to allocate later
or bypass native validation. Record actual native allocation through
`didAllocate(ticket)`, and report an explicit tagged canonical result through
`didSettle`. Only allocated, matching `saved` establishes a saved receipt.
Thunk fulfillment, an untagged loaded success state, a permit, refusal, or an
unknown outcome does not. Already allocated native effects settle independently
of view disconnection or retirement; the SDK neither aborts nor replays them.
An explicit coalescing result may arrive after a queued host request: it observes
the current native status without joining the primary operation or claiming its
saved outcome. A later wrapper exception cannot erase actual tagged allocation
or settlement already reported by native code.

The host supplies only admitted public error text. Preserve native generic-error
prefix stripping and localized fallback classification in that small translation.
The SDK renders the status leaf; it does not require native JSX slots or an
accepted SDK client, loaded Form, draft or second canonical store.

## Readonly URL-prefill policy

A readonly field with Allow prefills absent/false is ignored by the load
producer. If it is the only URL prefill, no accepted persistable URL provenance
survives and no Save allocation occurs. With Allow prefills enabled, an accepted
persistable value can produce one final Save and can be written in its payload.
It is not a no-overwrite dummy trigger. Keep native readonly, access, validation
and provenance policy intact.

This SDK recipe does not silently enable automatic mode in the incompatible
full SDK page/controller. Native direct assembly and the genuine supported
load/Form zero-versus-one allocation oracle are separate required integration
work; synthetic SDK policy tests alone do not establish them.

Failed and unknown outcomes may carry host-admitted display text. The status UI renders that text literally; the host retains native normalization and current-owner admission. An unknown outcome remains unknown even when its message is specific.
