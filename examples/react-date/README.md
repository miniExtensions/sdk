# React Date example

From the SDK root, run `pnpm build`, then `node examples/react-date/dev.mjs`.
Open <http://127.0.0.1:4179>.

Try typing a partial date, an invalid day, and a valid leap day such as
`2024-02-29`. The owner keeps incomplete input while the accepted native draft
stays unchanged. Clear writes `null`. Remounting preserves both forms of state;
an external update replaces the input. Calendar dates remain `YYYY-MM-DD`
strings, with no timezone conversion or native date-picker behavior.

The example imports the public `renderDateField` slot, `DateField` binding
component, and optional `@miniextensions/sdk/react/date.css` stylesheet. Synthetic
hosts and a synthetic binding adapt `createDateFieldModel` outside React to stand
in for the accepted Form/Portal owners a real application supplies. It also
demonstrates read-only, pending, validation, masking, title, permission, visibility
and retirement states. Masked and hidden dates are omitted from native-state
readouts. Styling is provisional and optional.

There are no backend requests, credentials or Save calls. Real applications keep
Save in the existing owner; invalid editable date input blocks that owner's
deliberate Save. See `docs/field-bindings.md` for the owner contract and
`docs/ui.md` for renderer APIs.

After building, `node scripts/check-date-browser.mjs` runs synthetic Chromium
checks and writes screenshots plus `result.json` to `dist/date-browser`. Set
`SDK_DATE_CHROMIUM` to an installed Chromium executable, for example
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS; the
default is `/usr/bin/chromium`. Browser tests cover native keyboard behavior but
do not certify screen readers or OS input methods.
