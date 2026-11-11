# Date popup dependency closure

`@radix-ui/react-popover` 1.1.14 is a build dependency matching the native
consumer input. The build bundles its closure into each private
`datePopoverRuntime.js`, leaving React and ReactDOM external. `UPSTREAM.json`
binds every reached dependency source and license file by package/version/hash.
The distributed per-format provenance and full license notices accompany it.
Small Radix packages and react-remove-scroll-bar omit their repository license
from npm; the retained notices are from:

- https://github.com/radix-ui/primitives/blob/main/LICENSE
  (`a18858fb7b014098cba85703e66609be66a26ef5`)
- https://github.com/theKashey/react-remove-scroll-bar/blob/master/LICENSE
  (`7c08c3990396ecefd90f99ff5d9a34f26f5b5616`)

For an intentional dependency update, inspect the changed package/license
closure, run `node scripts/build.mjs --capture-date-popover`, review the new
receipt, then run the normal source, package and browser checks. Ordinary
builds compare the frozen closure and fail on an unexpected change. Do not
recapture to hide a failing runtime or source check.

The picker itself is the unchanged pinned native fork in `../date-time`.
Its original manifest, artifact, stylesheet and separate MIT notices are kept
alongside the SDK-owned typed CommonJS default-export bridge. The build verifies
the original Git blob and all files before copying this closure. React 19
qualification must exercise actual mount/update/outside-click/unmount; neither
a peer-range change nor the presence of an unused fallback proves support.
