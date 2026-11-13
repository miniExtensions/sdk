# Canonical Form frames

`@miniextensions/sdk/forms` exports an additive immutable frame and transition
kernel for accepted public direct-root Forms with Compute disabled. The host
retains action admission, schema and validation algorithms, the existing
generation allocator, transport, storage and atomic publication. Existing
`FormDraftStore` and controller consumers keep their contracts.

The SDK-first implementation does not install a native adapter. Config preview,
child Forms, Portal and Compute remain separate owners. Choose the owner at an
accepted installation and preserve it until a genuine reinstall; current dirty
values or transient loading state cannot switch an instance between owners.

## Host boundary

`createCanonicalFormFrame` detaches and freezes a snapshot. It allocates no lease
and authorizes no action. `transitionCanonicalFormFrame` requires host ports on
every call, including installation. A matching-looking owner, generation or
allocation in plain data does not grant native authority.

Run transitions within the host's existing accepted transaction. The host ports
must use its actual admission and allocator and its established field equality,
URL-prefill and validation algorithms. Port callbacks must not publish a second
draft or start transport. The host must apply allocator changes and the returned
frame atomically, preserving its existing rollback/exception behavior.

```ts
import { transitionCanonicalFormFrame } from '@miniextensions/sdk/forms';

// Inside the host's accepted transaction, using its captured event and ports.
const result = transitionCanonicalFormFrame(currentFrame, event, nativePorts);
// Inspect the disposition before the host's atomic publication step.
```

The host must not publish `stale`, `unsupportedCohort` or `unavailable` results.
The kernel rechecks admission after host callbacks. A stale result must never be
installed over a successor. Its failure result carries the host's failure value
only after that qualification. Callback errors propagate to the host transaction;
the kernel does not turn them into accepted state.

## Native-compatible transitions

- Installation allocates fresh instance provenance even for equal record IDs
  and values. Preservation leaves the accepted frame in place. An explicitly
  accepted loaded-baseline event changes that baseline for the same installation.
- Accepted context replacement retires the edit instance without installing a
  new loaded record. It preserves canonical values, dirty order, errors, the
  loaded baseline and URL-retirement history; genuine installation resets that
  history.
- Accepted edits retire the readonly intent receipt and relevant URL-origin
  proof before equality. Equivalent values retain their exact presence, bytes,
  errors, dirty order and field generations and do not validate again.
- Genuine edits retain canonical values, call the host allocator and validate
  against updated values and the unchanged loaded-policy baseline. Dirty append
  retains first-edit order; dirty preservation never removes prior membership.
- Instance, field and policy generations remain distinct. Field-history
  exhaustion removes provenance while retaining the separate render lease;
  policy exhaustion removes both.
- Ordinary Save settlement replaces values with the qualified returned record,
  retains the explicit deduplicated dirty-keep list and initializes fresh edit
  provenance. It does not refresh the loaded-policy baseline. Only the matching
  allocated operation may retain the prior render lease.
- Retiring local state does not undo an allocated server mutation. Compute and
  its newer-edit reconciliation are outside this cohort.

Generation ports must return a nonnegative safe integer or `null` for exhaustion;
invalid numbers throw before the host can publish a transition.

Validation and generation ports run synchronously. Their results are host policy
inputs, not SDK network requests or a separate mutable state owner. Public writes
use `CanonicalFormValue`; absence in a snapshot does not create a new undefined
UI-write operation.

## Evidence boundary

The maintained native corpus records actual reducer/provenance/settlement
outcomes from pinned sources. Direct trusted-host settlement cases are distinct
from full allocated request admission. The additive public module, packed
consumers and differential corpus qualify the SDK milestone; native integration,
actual installed consumers and normal final checks remain required before the
whole extraction ticket is complete.
