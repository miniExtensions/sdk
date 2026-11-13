# Kanban composition

`Kanban` from `@miniextensions/sdk/react` owns the complete board frame, rich
card composition, drag sensors, keyboard geometry, local ordering and overlays.
Import `@miniextensions/sdk/react/kanban.css` for its optional standalone styles.
The stylesheet includes the card and reused field presentations. React and
ReactDOM remain optional peers for headless consumers.

The host supplies an immutable `KanbanProjectionInput`, explicitly projected
`KanbanCard` data and current named Open/Unlink actions. Card data never grants
an action. Every projected record ID needs an admitted card descriptor, including
loading/unavailable states. Replace source and card data together; missing card
data fails explicitly rather than fabricating a presentation. `readOnly` controls category dragging; admitted card actions are
separate capabilities. `modalOpen` must reflect native all-session modal state.
There is no native whole-card renderer, SDK record client, store or provider read.

The board delegates rich content to One's published `LinkedFinderCard` contract,
including explicit rich leaves and its first-six image carousel. The three
unchanged dependency files are sourced from commit
`908f226748f0d2c0ed2fa6c7fd1c9af3617e85ba`; the finder coordinator, cascade and
native implementation remain with their existing owner. Their earlier source
checks are not qualification of this composition.

## Projection and local state

`projectKanbanColumns` preserves Uncategorized, declared-choice order and
first-encountered stale categories. Duplicate labels select the first declared
choice. Only string raw categories are categories. Rows retain their input
order and multiplicity. Hide-empty filters after assignment. Column IDs are
separate from write values, including the empty column's `null` value.

Source identity changes rebuild presentation. Keep the field list, row IDs and
`readRecord` snapshot callback stable across cosmetic/action rerenders. Local
hover/reorder state is presentation only; it is not a second canonical record
store. Cancel restores the drag-start local snapshot while its source and policy remain current.
An authoritative projection replacement or readonly/modal policy transition retires
the unallocated drag surface, sensor callbacks and old cancel snapshot. It starts
from current projected rows and may reset card-local carousel presentation.
This does not cancel or fence an already allocated category operation. A completion with no collision target (`over === null`) retains native
local-preview semantics rather than claiming a remote rollback. Cached collision
targets can still admit a drop beyond a visible column.
Column drag handles are not newly enabled: the native frame did not attach them.
The standalone frame uses 300px columns and preserves the native empty-column
keyboard target offset (20px,74px); browser geometry must qualify this composition.

## Category operation ports

`createKanbanCategoryOperation(capture)` captures the original native record,
columns and narrow synchronous publication/restore callbacks plus the original
mutation callback. Keep potentially throwing request-payload evaluation inside
`mutate`, where native performed it after optimistic publication inside `try`.

Strict-equal categories are no-ops. Otherwise optimistic publication precedes
`try`, and each mutation starts immediately. Overlapping drops are neither
coalesced nor serialized. Logged-in results publish their actual supplied
record; no-login has no invented success meaning. Mutation rejection or a
throwing logged-in publication restores the captured whole record. A restore
error propagates. The fulfilled `Promise<void>` is not a success receipt.

Captured allocated continuations survive caller replacement/unmount. Existing
whole-record rollback can restore older bytes after a newer result; this
extraction does not repair that policy, add retries/cancellation or claim a
live race. Backend category validation and native source authority are unchanged.

## Presentation lifecycle

Cold SSR and initial hydration render the complete column/card frame without
loading DnD or ReactDOM. After a client commit, the private DnD frame replaces
that static presentation; no category gesture is admitted before it is ready.
The overlay target also mounts only after the client commits. Overlay typography and explicit ThemeBoundary
palette tokens are carried to the detached wrapper using the shared theme
portal contract. Arbitrary ancestor-only CSS is not discovered or copied.
Cursor claims compose across overlays and restore the prior cursor only while
still owned. The scheduled drag-geometry frame is cancelled on teardown.
Nested Enter/space keeps native default actions while stopping drag bubbling.

## Qualification boundary

The kernel has focused source characterization. Complete card/board component,
packed React18/19 ESM/CJS/types/CSS/SSR/hydration, actual trusted Chromium gestures
and normal exact-head package CI must pass before readiness. Native direct
adoption, native current-authority/regression/localhost acceptance, the existing
release-age policy and normal native master landing remain separate whole-ticket
requirements. No hosted fixture, provider mutation, production or Five W2 witness
is authorized merely by this component.
