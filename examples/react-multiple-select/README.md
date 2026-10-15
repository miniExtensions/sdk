# Multiple Select

After installing dependencies and running `pnpm build`, run
`node examples/react-multiple-select/dev.mjs` and open the printed local URL.
The example uses local synthetic hosts, native choice-name arrays and the existing
selection model. It never contacts a backend or saves a record.

Use `MultipleSelectField` for a Form binding or register
`renderMultipleSelectsField` in the existing Form/Grid/List renderer slots. Import
`@miniextensions/sdk/react/multiple-select.css` for optional component-specific
styles. The application retains owner lifetime and explicit Save actions.

The example includes maximum-selection removal, unavailable retained names,
read-only List display, pending controls and an optional synthetic Form creation
action. Real Form creation requires explicitly installing the existing
`fields.selectChoice(...)` controller; rendering never installs it.

Run `node scripts/check-multiple-select-browser.mjs` after `pnpm check:package`
for the packed-package Chromium proof. This is local synthetic browser testing.
