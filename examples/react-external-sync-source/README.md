# External Sync Source React presentation

A local synthetic gallery for `ExternalSyncSourceField` and `renderExternalSyncSourceField`, using optional `@miniextensions/sdk/react/text.css`.

Native SDK values are strings. Unknown labels, whitespace, Unicode, markup-shaped text and plain URLs stay unchanged; choice metadata is not used to find a name or replace the native value. Null and missing values stay blank. The shared Text control and Clear button are always disabled.

The Form card uses a real `createFormFieldBindings` owner with canonical `isComputed: true` metadata and `options.choices`. Portal grid and list cards use real `createPortalListOwner` and `createPortalDetailRendererHost` with accepted local synthetic projections, never fabricated computed inline bindings. Other typed fixtures isolate presentation states. A separate Text binding demonstrates normal edits and Clear.

An explicit metadata edge card keeps the existing owner asymmetry visible: `isComputed: false` can yield an editable Form binding whose real renderer host rejects admission. The direct `ExternalSyncSourceField` still disables input and Clear; this example does not change owner policy.

From the repository root after installing dependencies:

```sh
pnpm build
node examples/react-external-sync-source/dev.mjs
```

The preview listens on `http://127.0.0.1:4191`; generated assets stay in ignored `.generated/`. Two Portal reads return local objects. Unexpected fetch, Save and grid mutations throw and are counted. No backend, credentials or live data are used.

After the package build, run:

```sh
SDK_EXTERNAL_SYNC_SOURCE_CHROMIUM=/path/to/chromium node scripts/check-external-sync-source-browser.mjs
```

The proof blocks external requests and separately checks native keyboard/pointer behavior and injected input/Clear/composition probes. It checks choice metadata changes, masking from both configurations, feedback, lifecycle and stale events, then verifies the independent Text neighbor. Desktop, focus, forced-colors and fresh mobile screenshots plus a JSON receipt are written to ignored `dist/external-sync-source-browser` (or the supplied evidence directory). Synthetic composition events are not an OS IME certification. This fixture does not test synchronization, persistence, or backend source selection.
