# Optional selection UI browser example

This standalone TypeScript consumer installs an SDK archive and imports the
public core, `/ui` and `/formulas` subpaths. It uses synthetic field metadata
and a synthetic asynchronous loader. It makes no API/Airtable requests and
needs no keys, login, staging fixtures or Site deployment. It does not touch
the separate Request Desk demo.

## Run

Use Node.js 22+ and create the current archive from the SDK root:

```sh
pnpm install --frozen-lockfile
pnpm pack
cd examples/ui-selection
npm install
npm run typecheck
npm run build
npm run dev
```

Open `http://127.0.0.1:34921`. The preview builds once and then serves only on
loopback; it has no watch loop. To choose another high port, pass
`npm run dev -- --port 34922`. After changes, pack/reinstall the archive and
restart the preview:

```sh
npm install ../../miniextensions-sdk-0.1.0-alpha.0.tgz
```

`npm run build` compiles the browser bundle, copies static assets and writes
`.generated/metafile.json`, then exits. `npm run typecheck` compiles all example
sources against installed declarations. The root package check copies this
example into a clean temporary directory, replaces only its SDK archive pin
with the archive it just packed, verifies provenance and browser build inputs,
then typechecks/builds it. It does not resolve SDK source from the repository.

The package remains private and is not available by name from npm. A customer
who receives only the SDK archive can use its shipped `docs/ui.md` guide; this
example project's source is a separate repository development aid.

## Exercise interactions

- Use keyboard arrows/Space/Enter for native single-select. Use the native
  Command/Control and Shift conventions for multi-select. The visible draft
  contains choice names, not choice metadata IDs.
- The linked picker starts with an Alice selected label absent from its option
  pages. Search/page changes preserve it. `Restore saved ID only` shows an ID
  fallback; `Hydrate saved label` replaces that label explicitly.
- Search the synthetic options; `Load another page` appends unique record IDs.
  Page two deliberately repeats one previous option. Finance is disabled.
- `Slow then fast search` dispatches a 1.2-second slow request immediately
  followed by a 220-ms fast request. These two loaders deliberately ignore
  cancellation; only the latest fast result may enter model state.
- `Fail next request` creates a synthetic loader error. Retry succeeds.
  `Empty results` returns no records. Visible loading/error/empty messages and
  the state/log panels expose what happened.
- `Disabled` blocks control interaction; `Read-only` permits linked search and
  paging while preventing changes/removal. They also disable native editing.
- `Single linked selection` resets the model to use radio choices and an array
  containing at most one ID. Switching synthetic visitors destroys native
  controls and resets the async model before requesting new visitor options.
  No Alice value or retained label can become a Bob selection.
- The quantity preview uses the existing local FormulaRunner with the formula
  `{Quantity} * 3`. It performs no compute-mode save or Airtable calculation.

This proves local UI behavior and installed-package consumption. It does not
prove backend compatibility, authorization or staging behavior. For actual
Forms/Portals, use the SDK adapters with the loaded canonical field metadata,
current visitor/context and native draft values as documented in `docs/ui.md`
inside the customer archive.
