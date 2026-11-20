# Controlled readonly Portal Grid

Headers accept admitted `description` Quill HTML and `descriptionImageUrl`
metadata independently of row existence. They reuse
`CompleteFormFieldPresentation` for the focusable description tooltip, public
HTML renderer, image-failure latch, Escape handling and popup cleanup. The host
supplies the optional preview fact; it never grants record or child authority.
Grid forwards its currentness fence through the optional `admitDescription`
port at description activation and lazy-popup mount. Existing field-presentation
callers that omit this port retain their behavior. Retired header links, retry,
middle-click and context-menu defaults are refused while Tab/Escape remain usable.

Import `ReadonlyPortalGrid` from `@miniextensions/sdk/react` and
`@miniextensions/sdk/react/readonly-portal-grid.css` for the complete table,
headers, cells, Open controls, column visibility dialog and resize presentation.
The existing `AirtableGrid` layout shell remains supported unchanged.
Hosts can preserve existing Open-control selectors through `openRecordTestIds`;
these strings are DOM metadata and never authorize an Open action.

Pass detached columns and the SDK field nodes from one admitted render snapshot.
The host retains collection, query, response qualification, child admission,
formatting/masking and canonical preference ownership. The component has no
client, record writer, renderer callback or local-storage owner. Do not recover
missing columns or cells from a global cache or the first row.

`ready`, `preferenceScopeKey`, `revision` and `isCurrent` describe the rendered
presentation. The currentness predicate must fence the real host owner,
including observed changes away and back. These values are not authorization
receipts. Unavailable presentation renders only the supplied feedback; stale
controls emit no intent. Unmount does not destroy the borrowed collection.

Column order and row order are preserved. Primary visibility ignores only the
user-hidden preference: a policy-omitted primary column is never recreated.
Columns and cells remain readonly, including when no child Open intent exists.
Header metadata is supplied independently of rows, so empty results retain the
accepted labels and optional icons.

With host-owned paging, pass `showEmptyStatus: false` while an accepted empty
page has a continuation or a next-page request is pending. The Grid retains its
column headers, and the host can keep its paging controls visible. Omit the
option for a standalone Grid or a confirmed empty result to show the normal
empty label.

The host supplies scoped hidden/width values and persists the emitted intents
through its existing preference contract. Hidden values apply only when they
are exactly `true`. Width hydration accepts finite numbers and numeric strings,
otherwise using 200. Resize settles to the actual header `clientWidth`, including
native measured-width correction. Pointer cancellation and stale/replaced
presentation do not persist widths. Arrow keys resize; Shift changes the step;
Escape cancels an active keyboard adjustment.

`onOpenRecord` receives the actual SDK button. Delegate to the already-admitted
native child command and its existing settlement/currentness/focus-return
contract. A void presentation command is not a successful collection action;
do not invent a boolean success or another child owner.

The copy setting is the host's already-effective per-view fact. Only
`doNotAllowUserToCopyTextOnGrid === true` suppresses ordinary readonly text
selection through scoped CSS. It is a presentation deterrent, not data security
or a clipboard API. Resolve original/custom-view inheritance in the existing
host configuration owner. Editable copying elsewhere is unchanged.

Row-height values are `short`, `medium`, `tall`, `extra-tall` and `fit-content`.
Native adapters map their existing spaced names explicitly. The first four
apply 24/52/84/140px to the inner content wrapper, not the complete row; native
padding, borders and larger Open controls contribute to total row geometry.
Existing readonly leaf layout overrides remain effective.

The packed consumer matrix qualifies React 18/19 ESM/CJS, strict NodeNext and
Bundler declarations, SSR, stylesheet closure and unchanged lifecycle assertions.
The maintained Chromium category additionally checks real geometry, trusted
pointer/touch/keyboard controls and browser selection. Neither is evidence of a
native borrowed-route rollout, native preference persistence or child admission;
those require the real native adapter and its separate checks and cleanup.

Canonical column widths are client widths (padding included, borders excluded). The presenter converts them to the current CSS box model before rendering, so ordinary one-pixel keyboard moves, motionless pointer settlement, host echoes and remounts cannot drift by the header border.
