# Complete linked finder coordinator

`createCompleteLinkedFinderCoordinator` is an additive, clientless `/ui` API.
It does not change `LinkedRecordsField` or the existing borrowed-read APIs.
This coordinator is one part of the complete finder; the searchable React UI,
rich cards, native-compatible cascade, distribution proof and native adapter
must be composed and qualified before the whole finder is complete.

The host owns committed opaque owner tokens, canonical selected IDs, privacy,
configuration/schema revisions, caches, Redux and transport. Every authority
replacement, including A → B → A, must have a fresh committed owner identity.
`isOwnerCurrent` must consult authoritative current state. Relevant host changes
must notify the supplied subscription; value echoes do not replace the owner.

`captureRead` captures the actual filter and offset before transport allocation.
Its `isCurrent` fences run before and after host publication. The latter must
distinguish an admitted own-row cache merge from a replacement owner/context.
The host publisher returns explicit admission; schema and returned data cannot
grant it. A read receives no cancellation signal: supersession and destruction
retire local publication without cancelling allocated host work.

`queryNow` returns the exact host page after final publication checks, or an
explicit refused, retired or failure result. `scheduleSearch` returns `void`;
it is not a promise for whichever debounced invocation happens to run. Public
searches show loading immediately and debounce for 800 ms (10 ms in test mode).
Public nonreset reads retain the one-second allocation throttle. Authenticated
preview uses the captured host transport/publication path directly and leaves
the candidate model and loading presentation untouched. Unavailable preview
must be refused by the host, without constructing a public-token transport.

Accepted raw occurrences preserve order and duplicates. A separate readonly
`SelectionModel` deduplicates candidate identities with empty labels; it does
not receive selected IDs or manufacture accepted SDK linked-page provenance.
Cards and labels must come from separately admitted host projections, never
from candidate/cache recovery. Canonical hidden and duplicate selections stay
with the host, without model normalization.

`toggle(expectedOwner, id)` rejects stale captured UI actions. The host reads
current canonical membership and performs its own native add/remove, returning
explicit admission. Scan auto-selection requires exactly one raw occurrence,
current enabled/nonselected membership and an enabled choice. It invokes one
host toggle, then separately fences host close. Two identical raw records do
not constitute one unique match. Camera/scanner UI belongs to the existing
`CompleteBarcodeScanner`; this coordinator implements no decoder or camera.

The native cascade remains a separate compatibility recipe from
`createFormLinkedFilterModel`. Native mount prefill and predecessor option reads
are independently scheduled; ordinary URL values are forwarded raw, predecessor
effects depend on strings, and selections retain record IDs despite equal
labels. Characterize the mounted producer/error ordering before changing it.
