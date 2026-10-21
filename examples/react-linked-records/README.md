# Linked Records

Run `pnpm build`, then `node examples/react-linked-records/dev.mjs` and open the
printed URL. This local synthetic example uses existing selection models and
Form/Grid/List renderer host contracts, without a backend or Save dispatch.

Register `renderMultipleRecordLinksField` in the existing renderer slots and
optionally import `@miniextensions/sdk/react/linked-records.css`. Real applications
supply their accepted Form/Grid/List owners and keep their explicit Save action.
The bounded slot does not replace the legacy `LinkedField` binding component.

Use **Load selected**, **Search** and **Load more** to dispatch their respective
owner actions. Typing, rendering and remounting do not dispatch reads. The example
includes filtered/missing placeholders, duplicate native occurrences, readonly
List presentation, masked labels, draft edits and owner retirement. Selection edits
keep filtered identities but retain the existing model's duplicate normalization.

Run `node scripts/check-linked-records-browser.mjs` after `pnpm build` for a
Chromium check of the example compiled against an installed package archive.
