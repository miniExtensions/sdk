# Canonical Form frames

`@miniextensions/sdk/forms` exports an additive immutable frame and transition
kernel for accepted public Forms. Choose the owner at an accepted installation
and preserve it until a genuine reinstall. Current dirty values or transient
loading state do not switch the cohort.

- `public-direct-root-non-compute` covers the existing direct-root frame and
  its allocated Save settlement.
- `public-child-or-portal` covers frame state for admitted modal, side-panel and
  Portal inline Forms. The host keeps parent membership, revalidation, and
  Save and Compute settlement in its existing lifecycle.

Config preview remains outside the frame kernel. The host retains action
admission, schema and validation algorithms, the existing generation allocator,
transport, storage and atomic publication. Existing `FormDraftStore` and
controller consumers keep their contracts.

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
  loaded baseline and URL-retirement history. A direct-root installation resets
  that history. A retained child follows the host's verified parent identity
  through pagination. A context replacement rotates its edit instance even if
  the visible values did not change.
- Accepted edits retire the readonly intent receipt and relevant URL-origin
  proof before equality. Equivalent values retain their exact presence, bytes,
  errors, dirty order and field generations and do not validate again.
- Genuine edits retain canonical values, call the host allocator and validate
  against updated values and the unchanged loaded-policy baseline. Dirty append
  retains first-edit order; dirty preservation never removes prior membership.
- Instance, field and policy generations remain distinct. Field-history
  exhaustion removes provenance while retaining the separate render lease;
  policy exhaustion removes both.
- Ordinary direct-root Save settlement replaces values with the qualified returned record,
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

## Settling an allocated Compute

Use `transitionCanonicalFormCompute` from `@miniextensions/sdk/forms` for an
accepted public direct-root Form with Compute enabled. The host projects its
current immutable frame and captures the actual allocation, request ID,
installation, record, edit generations, eligible submitted values and original
dirty values. The host continues to own request admission, transport and atomic
publication. Recheck the same native screen and request immediately before
publishing the returned frame.

- A returned result can adopt a create record ID and reconcile value data through
  `reconcileFormComputeResult`. Newer and uncertain edit generations remain
  dirty, even when an edit returns to its original value. Hidden or omitted
  edits and explicit clears retain their native meaning. The loaded-policy
  baseline stays the same.
- A terminal failure only applies to the current allocation. A validation
  result whose captured dirty values changed returns
  `computeValidationSuperseded` so the host can finish the request silently.
  `computeFailed` carries the actual failure for the host's existing
  presentation policy.
- A manual readonly receipt requires the matching pending request, exact echoes,
  an intact render owner and an affirmative host context check. Supply the
  native exact readonly comparator separately from the acknowledgment
  comparator. Origin retention also requires the active binding and exact
  retained values. A stale result leaves successor receipts untouched.

The original non-Compute transition, child Forms, Portal Forms and preview
Forms keep their existing paths. This API has no scheduling or transport.

## Evidence boundary

The maintained native corpus records actual reducer/provenance/settlement
outcomes from pinned sources. Direct trusted-host settlement cases are distinct
from full allocated request admission. The additive public module, packed
consumers and differential corpus qualify the SDK milestone; native integration,
actual installed consumers and normal final checks remain required before the
whole extraction ticket is complete.
