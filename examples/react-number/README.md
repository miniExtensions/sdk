# Local Number renderer example

Run `pnpm build`, then `node examples/react-number/dev.mjs`, and open
`http://127.0.0.1:4178`.

Try incomplete numeric input (`-`, `1e`), decimals, zero, clearing, permission
changes, external updates and remounting. The public scalar model owns parsing
and the last valid native value. Owners live outside React; no Save or backend
request runs. All data and capabilities are synthetic.

The example uses the public `renderNumberField` helper and optional stylesheet.
The existing `NumberField` binding component is also supported; see
`docs/ui.md` for scope and contracts.

After building, `node scripts/check-number-browser.mjs` runs the Chromium proof
and writes screenshots and `result.json` to `dist/number-browser`. Set
`SDK_NUMBER_CHROMIUM` to override the default `/usr/bin/chromium` executable.
