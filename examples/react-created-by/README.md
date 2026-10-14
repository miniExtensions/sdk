# Created By React presentation

A standalone synthetic gallery for `CreatedByField` and `renderCreatedByField`, using optional `@miniextensions/sdk/react/text.css`.

The renderer shows only the supplied `name` from a valid native collaborator object. It preserves whitespace, Unicode, blank names, literal markup and URL-shaped names. Null, missing and malformed values stay blank. Email, ID, avatar and choice metadata never become a fallback, link, image or network request. The input and shared Clear button stay disabled.

The gallery uses a real Form binding and a real Form renderer host, including `isComputed: false` metadata: the Created By physical kind remains read only. Portal grid and list cards use real `createPortalListOwner` and `createPortalDetailRendererHost` with accepted local detail projections. They do not fabricate inline cell bindings. A Form host that loses currentness stays retired, including across remounts; its native collaborator object is preserved. Other typed fixtures isolate presentation states, malformed native values and lifecycle. A separate Text binding demonstrates ordinary editing, composition and Clear.

Full collaborator objects include synthetic private sentinel fields. They remain in their owners and are observed by a read-only browser-test accessor, separately from page markup. The page's native readout shows only shape/preservation status; it never prints ID, email, avatar or extra private data. A matching choice with a different name proves that a blank native name does not fall back to metadata.

From the repository root after installing dependencies:

```sh
pnpm build
node examples/react-created-by/dev.mjs
```

The preview listens on `http://127.0.0.1:4192`; generated assets stay in ignored `.generated/`. Two Portal reads return local objects. Unexpected fetch, Save and grid mutations throw and are counted. No backend, credentials or live data are used.

After the package build, run:

```sh
SDK_CREATED_BY_CHROMIUM=/path/to/chromium node scripts/check-created-by-browser.mjs
```

The checker blocks external requests and distinguishes native keyboard/pointer behavior from injected input, Clear and composition probes. It verifies complete native-object preservation, malformed values, masked names, supplied feedback, hidden titles, real-host currentness, replacement and retirement, then checks the independent Text neighbor. Four screenshots and a JSON receipt are written to ignored `dist/created-by-browser` (or the supplied evidence directory). Synthetic composition events do not certify OS IME behavior. This fixture does not test persistence or resolve a collaborator identity.
