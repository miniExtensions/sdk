# Private runtime isolation

The exact styled-components 5.3.11 Node/browser CJS bundles are retained under
`upstream/dist`, with immutable hashes and npm archive integrity in UPSTREAM.json.
The full official v5.3.11 MIT license and original manifest/README remain intact.
Only the two owned runtime entry bundles and private package manifest are adapted.

Both entries apply the same deterministic `me-sdk-rich-text` namespace:

- Fixed `data-me-sdk-rich-text` style ownership and rehydration attribute.
  Shared process.env.SC_ATTR/REACT_APP_SC_ATTR values cannot merge ownership.
- Explicit `me-sdk-rich-text-` prefix on every generated CSS class, keyframe name,
  generated component-ID hash and createGlobalStyle ID hash.
- `me-sdk-rich-text:` input prefix in the internal hash helper used for generated
  component IDs and ComponentStyle seeds.
- Explicit componentId/withConfig/Babel IDs also receive the private name prefix.
- The existing duplicate-runtime warning reads/writes only its own named
  `__me-sdk-rich-text-styled-components-init__` diagnostic counter. It still
  detects repeated private runtimes and never reuses host sheet/runtime state.

Version exports and `data-styled-version` remain 5.3.11. The Node entry retains
its stream import; the browser entry does not. No global environment is changed.
The SDK's optional React host peer and shared React root are unchanged.

Prefixing names creates deterministic CSS-selector separation; changing only a
32-bit hash seed or stylesheet attribute would leave collision paths. The
original rehydration marker parser accepts the CSS-safe hyphenated names. Literal
CSS/global selectors supplied by editor rules retain their existing meaning.
The precompiled sourceMappingURL references remain input provenance and do not
claim regenerated maps for adapted bundles.
