# SDK-owned editor adaptation

The immutable input is rich-markdown-editor 12.26.8 at revision
`aa3bddd1d023739df9f673c22f950a67d8b6bbbf`. The exact input manifest, BSD-3-Clause
license and per-file input hashes are retained. `ADAPTATIONS.json` binds changed
upstream files and new owned helper files to their current SHA256 content.

## Runtime changes

- ComponentView sends stable object keys, DOM containers and themed React elements
  to the private SDK portal owner. There are no independent NodeView React roots.
- Initial documents settle the enabled TrailingNode paragraph/heading policy
  before EditorState allocation, so metadata-only attachment does not publish
  structural setup. Change notifications deduplicate only the current final
  document reference within an engine generation; undo and new documents retain
  their own notifications.
- The editor owns its ProseMirror view generation, destroys the captured view on
  unmount, retires deferred menu work and stale commands, and reconstructs a fresh
  view during StrictMode lifecycle replay. Captured NodeView actions cannot act on
  another mount. Read-only caption edits are refused and portal presentation is
  refreshed when accepted read-only policy changes.
- Toolbar controls are explicit non-submit buttons with names from their
  existing localized tooltips. Formatting toggles expose their actual pressed
  state; link dialogs and insertion/deletion/download actions remain ordinary
  buttons. Link open/remove controls use their existing localized names.
- Stateless notice and block-menu icons use exact outline-icons SVG paths in DOM
  decorations, removing legacy ReactDOM render calls without extra roots.
- SDKPortal provides detached targets with immediate children/ref attachment and
  commit-owned body insertion/removal. FloatingToolbar waits for selected-image
  portal DOM via a live-editor MutationObserver and disconnects when ready/retired.
- Link search, deferred paste and link-creation completions retain their current
  view/component ownership. Upload preloads retire their handlers with the view;
  upload-stop timing remains tied to upload promise settlement. Current preload
  errors now use the existing placeholder-removal/imageUploadError recovery rather
  than throwing asynchronously; stale completions do not dispatch or notify.
- Upload placeholders create object URLs only when rendered and revoke exactly
  their own URLs through the widget destroy hook.
- The private sdk-runtime facade exposes the real CommonJS engine, paste helpers
  and ProseMirror constructors with a narrow current declaration graph. Public SDK
  declarations do not traverse the upstream legacy declarations.

## Dependency closure and licenses

- outline-icons 1.46.0: exact React icon runtime and BSD-3-Clause license.
- styled-components 5.3.11: exact precompiled Node/browser CommonJS originals
  under upstream/dist, original manifest/README, and the full MIT license from
  the official v5.3.11 repository tag. Both owned runtime entries apply a fixed
  private stylesheet marker, generated-name/hash namespace and explicit-ID
  namespace, isolating host styled-components selectors and rehydration. Duplicate
  detection remains within the private namespace. Exports/version markers stay
  5.3.11. The private manifest preserves upstream browser resolution; 16 editor
  runtime imports use this owned package root. The SDK declares only the six
  non-React runtime dependencies; React remains its optional lazy-editor host
  peer. Babel/plugin/native dependencies are unnecessary for this runtime.
- react-medium-image-zoom 3.1.3: exact selected lib input plus MIT license, with
  SDK-owned portal/timer/image-load/focus lifecycle adaptations documented there.
- prosemirror-utils 0.9.6: unchanged Apache-2.0 runtime, exact Atlassian notice and
  full license text; a private entry exposes only the 17 functions used by this
  editor. It resolves the SDK's ProseMirror singleton closure without installing
  its obsolete package peer declaration.

The owned CommonJS package markers replace installation manifests only inside
this vendored artifact; original package manifests remain byte-preserved as
upstream-package.json. No shared dependency, upstream repository, global ReactDOM
object or peer-policy override is changed.

Upstream source-map files and references remain input provenance in this source
snapshot. They are excluded from the packaged runtime by SDK build ownership;
modified files do not claim regenerated source maps. Original .stories.js input
files are likewise excluded from the customer runtime.

The author performed source editing only. Root owns combined build, typing,
React 18/19, installed-package, browser and acceptance qualification.

The immutable styled-components contributor README remains in the source snapshot;
the customer runtime excludes that developer document and retains its full MIT
license, original README hash, runtime provenance and owned adaptation notes.
