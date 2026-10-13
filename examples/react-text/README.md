# React Text example

From the SDK root, run `pnpm build`, then `node examples/react-text/dev.mjs`.
Open <http://127.0.0.1:4177>.

Try typing in the middle of a value, clearing, the character limit, masking,
permission changes, external draft updates and remounting. Owners are created
outside React and keep accepted drafts through remounts. No backend, camera,
address lookup, credentials or Save calls are used.

The example imports the public React slot and optional stylesheet. Its synthetic
hosts stand in for the accepted Form/Portal owners a real app supplies. The
stock slot works with Form, Grid and List. The existing binding component is
available as `TextField`; see `docs/ui.md` for both APIs and scope boundaries.

After building, `node scripts/check-text-browser.mjs` runs a Chromium check and
writes screenshots plus `result.json` to `dist/text-browser`. Set
`SDK_TEXT_CHROMIUM` to override the default `/usr/bin/chromium` executable.
The composition check dispatches browser events; OS input methods and screen
readers still need manual testing on the application's target platforms.
