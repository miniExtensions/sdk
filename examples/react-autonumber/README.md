# AutoNumber React presentation

A local synthetic gallery for `AutoNumberField` and `renderAutoNumberField`, using the optional shared `@miniextensions/sdk/react/number.css`. The typed hosts and bindings are presentation fixtures, not actual Form/Grid/List owners. Only the neighboring Number field borrows a public scalar model, created outside React.

AutoNumber displays existing finite native numbers with `String(value)`, including zero, negative fractions and exponent notation. Null and missing values stay blank. Controls are always disabled: there is no scalar, editable capability, number generator or Save action. Masking, title fallback, pending state, feedback, owner replacement, hidden hosts, retired bindings and custom rendering are demonstrated without live data.

From the repository root after installing dependencies:

```sh
pnpm build
node examples/react-autonumber/build.mjs
node examples/react-autonumber/dev.mjs
```

The preview listens on `http://127.0.0.1:4189`. The build and preview write only ignored `.generated/` assets. No requests are made to external services.

Run the synthetic Chromium proof after the package build:

```sh
SDK_AUTONUMBER_CHROMIUM=/path/to/chromium node scripts/check-autonumber-browser.mjs
```

The proof blocks external requests, checks disabled pointer/keyboard and injected input events, verifies read-only snapshots and no AutoNumber setter calls or generated values, and separately exercises editing and retained partial drafts in the Number neighbor. Native keyboard behavior and programmatic event probes are distinct evidence. It captures desktop, focused neighbor, forced-colors and fresh narrow-layout screenshots with a JSON receipt in `dist/autonumber-browser` (or a directory passed as the first argument). This fixture does not validate backend sequencing, persistence, or actual Form/Grid/List integration.
