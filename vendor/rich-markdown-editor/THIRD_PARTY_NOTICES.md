# SDK-owned rich Markdown editor adaptation

The editor distribution is derived from miniExtensions/rich-markdown-editor revision
`aa3bddd1d023739df9f673c22f950a67d8b6bbbf`, version 12.26.8. Its complete
BSD-3-Clause license is retained in `LICENSE`; `UPSTREAM.json` records immutable
input hashes. SDK lifecycle and React portal adaptations are maintained here.

The exact outline-icons 1.46.0 runtime and its BSD-3-Clause license are retained in
`dependencies/outline-icons`. `dist/lib/SDKIcons.js` uses its unchanged Info,
Warning, Starred and Plus path data for stateless ProseMirror decorations.

The selected react-medium-image-zoom 3.1.3 runtime, MIT license, immutable input
provenance and SDK lifecycle adaptations are retained in
`dependencies/react-medium-image-zoom`.

The unchanged prosemirror-utils 0.9.6 runtime is Apache-2.0 (not MIT). Its
exact copyright/license notice, full Apache-2.0 license text, manifest and input
hashes are retained in `dependencies/prosemirror-utils`; the private entry
exposes only functions used by this editor.

The exact styled-components 5.3.11 Node/browser CommonJS web runtime originals
are retained under `dependencies/styled-components/upstream/dist`, alongside the
original package manifest/README, full MIT license and immutable input hashes.
Its npm archive omits LICENSE; the full license is preserved from the official
repository's v5.3.11 tag with its source URL and SHA256 recorded in UPSTREAM.json.
Copyright (c) 2016-present Glen Maddern and Maximilian Stoiber. The owned runtime
entries deterministically namespace generated CSS names, component IDs, style-tag
ownership, rehydration and duplicate detection. The private manifest and editor
require paths adapt dependency ownership. Changes are documented there in
ADAPTATIONS.md; exported styled-components version remains 5.3.11.
