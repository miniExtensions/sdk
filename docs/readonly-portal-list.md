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
