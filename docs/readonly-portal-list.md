# Readonly Portal List

`ReadonlyPortalList` from `@miniextensions/sdk/react` owns the complete borrowed
readonly List frame, ordered row/cell composition, empty-column labels and
current registered Open buttons. Import
`@miniextensions/sdk/react/readonly-portal-list.css` for its layout styles.

Pass an existing `BorrowedPortalRenderScope` created by
`createBorrowedPortalRenderScope` from `@miniextensions/sdk/ui`. That host port
publishes detached, admitted readonly field hosts and keeps canonical records,
collection reads, authentication and child lifecycle. The presenter creates no
collection, transport, editor, write owner or implicit Save.

`openActions` is an optional readonly map from record ID to a registered host
command. Each command carries the accepted scope revision and
`activate(isCurrent, returnFocus)`. The host must retain its own admission and
recheck currentness after waits; a revision number is not authorization.
The component checks the committed command, scope revision and retirement before
mouse or native button keyboard activation. Its focus-return callback is inert
after retirement, replacement or unmount.

Omit actions in preview or when no current child is admitted. Hosts keep
previous/next mapping from the same accepted row order and their existing
child-context publication. The presenter does not infer a child from raw IDs.

All accepted row cells remain in their supplied order. Grid hidden-column
preferences and legacy card field limits are not applied to this List.
When rows are empty, the accepted column titles are still rendered as headings.

`AirtableList` retains its mandatory `children(state)` layout-shell API.
The standalone `PortalList`/`PortalListOwner` read lifecycle also remains
unchanged. Neither is repurposed as a second native collection owner.

The public props and types are `ReadonlyPortalListProps`,
`ReadonlyPortalListSnapshot` and `ReadonlyPortalListOpenAction`.
Cold SSR does not require browser globals or execute an Open command.

## Switching between Grid and List

Use `ReadonlyPortalRecords` from `@miniextensions/sdk/react` when the host
chooses either layout. Pass the same `scope` as the host changes `layout`
between `grid` and `list`. The component keeps one presentation subscription
and composes the two complete views from the accepted snapshot. Import both
`@miniextensions/sdk/react/readonly-portal-list.css` and
`@miniextensions/sdk/react/readonly-portal-grid.css`.

Supply the renderer slots and the existing Grid preferences through `grid`.
Grid emits hide and measured-width changes to the host. List still displays
all admitted cells. An optional `status` displays a host-supplied loading,
unavailable or error message. When records are ready, omit `status` and leave
empty results in the accepted snapshot so either layout can keep its headers.

Pass Open registrations as `{ scope, byRecordId }`. List shows each current
registration and Grid waits for all accepted rows to be registered. A layout
switch retires the previous controls, including pending focus restoration.
Hosts can mount their existing per-record registrar through
`renderChildRegistration`, and existing per-column preference bindings through
`grid.renderPreferenceBindings`, which returns binding nodes and a readiness
flag for the admitted columns. The host keeps final admission and owns all
collection access, preference persistence, and unsupported-cohort fallback.
