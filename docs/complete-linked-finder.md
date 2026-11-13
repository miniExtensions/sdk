# Complete linked finder

`createCompleteLinkedFinderCoordinator` is an additive, clientless `/ui` API.
It does not change `LinkedRecordsField` or the existing borrowed-read APIs.
`CompleteLinkedFinder`, `LinkedFinderCard`, `LinkedFinderRichLeaf` and
`NativeLinkedFinderCascade` are additive `/react` APIs. Import
`@miniextensions/sdk/react/complete-linked-finder.css` with the existing leaf
styles used by your admitted card projections. Native adapter adoption and
the exact installed-package consumer matrix remain required before the whole
finder migration is complete.

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
An admitted toggle may advance the consumed read's selected-value stamp. Close
still requires the same owner and latest search, rather than reusing the old
selected-value stamp as independent close authority.

The React finder creates its coordinator after commit. It renders the actual
Headless UI multi-combobox, derives one changed ID by occurrence counts (including
duplicate canonical IDs), and forwards one semantic toggle. The host's
`candidates(owner, rawCandidateIds)` supplies filtered/sorted structured cards;
only IDs in the candidate model are shown. Rejected rows do not become
unavailable placeholders or recover labels from raw records. Canonical membership
is passed separately to Headless UI, retaining hidden IDs and duplicates.

Supply a stable host, controlled `searchTerm`, `onSearchTermChange`,
`filterForSearch`, current `filter` and an explicit committed non-search
`queryKey`. Mount, owner replacement or a changed `queryKey` schedules a reset
query. Controlled search echoes update the input and current pagination filter
without superseding a scan or scheduling a second search. Typing and scanner
callbacks schedule their own request. `initialLoading` is the host's table/schema
readiness. Initial loading precedes errors, then admitted rows, then the supplied
empty label; pagination keeps the rows and displays its own loading indicator.
The observer uses the actual scrolling element and a `400px` root margin.
Selection can be disabled while retaining searchable presentation. Scanner
configuration composes the existing scanner hook and never grants selection.

Cards have explicit `loading`, `unavailable` and `present` variants. The host
chooses each exhaustive leaf variant after schema/config filtering, conversion,
masking and computed-result resolution. Optional schema/config metadata is
auditing context; it never chooses a leaf or grants an action. Primary text is
plain escaped text. Ordered details use the complete SDK text, sanitized HTML,
Quill, readonly Markdown, numeric, controlled date/dateTime, phone, duration,
checkbox, barcode and accepted button presenters. SDK-owned badges, linked
labels, people, rating icons and admitted attachment images complete the card.
No React renderer slot or unknown-type text fallback is accepted. A button needs
an independently admitted button snapshot with captured capabilities.
Numeric leaves explicitly carry the admitted localized empty label. Present
cards require thumbnail enablement/location and fields-per-row settings, so a
disabled thumbnail reserves no Gallery space and List can preserve either
thumbnail side and the native detail grid.

List thumbnails use original URLs across the full supplied array. Their ordered
`id/url/filename` vector resets failure position; equivalent new references do
not. Gallery/Kanban mount only the first six images, prefer supplied large URLs,
retain selected IDs through reorder, clamp after removal and track failure by
identity plus resolved source. No-ID identity contains index and resolved URL.
Failures never backfill a seventh image. Native attempts are keyed and guarded
against late old-source events. Switching List/Carousel retires the other local
failure state; Gallery/Kanban share the carousel lifetime. All images are supplied
descriptors: no cache, file or thumbnail service lookup is performed.

The native cascade remains a separate compatibility recipe from
`createFormLinkedFilterModel`. Native mount prefill and predecessor option reads
are independently scheduled; ordinary URL values are forwarded raw, predecessor
effects depend on strings, and selections retain record IDs despite equal
labels. Characterize the mounted producer/error ordering before changing it.

`NativeLinkedFinderCascade` takes valid partial driver descriptors in native
order, canonical driver pairs, raw URL values and a captured owner/host. Hidden
drivers retain their mounted effects; outer `formReadOnly` suppresses all driver
effects. `createNativeLinkedFinderCascadeDriver` is the same compatibility
controller without React. Prefill and ordinary reads allocate independently;
ordinary results retain arrival-order publication, and ordinary errors remain
through later successful reads. Prefill failure rejects without clearing the
native prefill flag or inventing ordinary error presentation. Optional
`onPrefillFailure` reports that failure without changing its policy. A reset
uses `clear`; explicit nullable selection uses `publish(null)`. Both canonical
driver state and Save remain in the host. Cleanup removes queued work and local
observers while leaving allocated transport alone.
