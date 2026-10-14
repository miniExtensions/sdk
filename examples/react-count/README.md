# Count React presentation

A local synthetic gallery for `CountField` and `renderCountField`, using the optional shared `@miniextensions/sdk/react/number.css`.

The zero-value binding comes from a real `createFormFieldBindings` owner. The grid and list cards use real `createPortalListOwner` owners and `createPortalDetailRendererHost` with locally supplied accepted projections. Count has no editable Portal cell binding. Other typed hosts and bindings isolate masking, pending, feedback, metadata and lifecycle states; only the separate Number neighbor has a scalar model.

Count displays `String(value)` only for finite native numbers with valid Count metadata (`options.isValid === true`). Invalid metadata keeps the accepted value untouched but shows a blank control; null and missing values are blank too. No linked-record tally, rounding, clamping, integer rule, scalar or setter is added. Every Count control stays disabled.

From the repository root after installing dependencies:

```sh
pnpm build
node examples/react-count/dev.mjs
```

The preview listens on `http://127.0.0.1:4190`; its generated assets stay in ignored `.generated/`. Both Portal reads return local synthetic objects. Unexpected fetches, Save and grid mutations throw and are counted; no credentials or live data are used.

Run the synthetic Chromium proof after the package build:

```sh
SDK_COUNT_CHROMIUM=/path/to/chromium node scripts/check-count-browser.mjs
```

The proof checks metadata transitions while preserving native `42`, disabled native pointer/keyboard behavior, separately injected input events, actual owner projections, masking from either configuration, supplied feedback, visibility and retirement. The Number neighbor verifies editing, caret position and retained partial drafts. Desktop, focused neighbor, forced-colors and fresh mobile screenshots plus a JSON receipt are written to ignored `dist/count-browser` (or the supplied evidence directory). This is not a backend count-calculation or persistence test.
