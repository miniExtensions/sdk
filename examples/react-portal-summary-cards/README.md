# Portal summary cards

This standalone React consumer imports only public package exports. It selects
fields using `projectPortalSummaryFields`, formats synthetic parent-record values
with the existing public `getReadableStringFromAirtableValue`, and renders the
complete `PortalSummaryCards` component and its optional stylesheet.

Install a qualified SDK archive, React, React DOM and esbuild in your own
application, then run `node dev.mjs` from this example directory. Its localhost
address is printed. The installed archive must include the summary exports.

Try every height, hide and restore titles, replace the accepted parent snapshot,
and unmount/remount the cards at desktop and narrow mobile widths. Zero remains
formatted, false is blank, duplicate selected IDs keep their first position, and
deleted IDs are omitted. Text such as `<b>Literal parent text</b>` stays literal.

The host owns record admission, eligibility, refresh, formatting and errors.
These cards do not aggregate displayed Grid rows. A native host can supply
`decorateCard(card, content)` to wrap the complete SDK content in its authoring
controls; permissions and modal behavior stay in that host. Omit the decorator
for complete ordinary presentation. The callback runs during render and must
remain pure; it does not gain an SDK command lifetime guarantee.
