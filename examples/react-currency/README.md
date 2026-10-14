# React Currency example

From the SDK root, run `pnpm build`, then `node examples/react-currency/dev.mjs`.
Open <http://127.0.0.1:4182>.

The example imports public `CurrencyField`, `renderCurrencyField`, and optional
`@miniextensions/sdk/react/currency.css`. Synthetic hosts and a binding adapt
`createNumberFieldModel` outside React, preserving accepted numeric values and
unfinished text across remounts. Currency uses the existing numeric scalar model;
the configured symbol is a literal adornment outside the input and part of its
accessible description.

Try raw input such as `00123.4500`, `-`, `1e` and `2.5e-3`. Complete finite numbers
write native numeric drafts; partial or invalid text retains the last accepted
value. Zero stays distinct from `null`; Clear writes `null` and keeps focus.
There is no grouping, rounding, precision padding or localized-number parsing.
The first field starts with precision metadata of 2; changing its symbol also
changes that metadata to 0, while input and native precision remain unchanged.

“Save first draft locally” is a synthetic in-memory checkpoint for the first field.
Typing, clearing, Enter, focus changes and remounting never invoke it. The fixture
refuses this checkpoint when the first owner is invalid or cannot edit. Real apps
keep their accepted Form/Portal owners and their existing explicit Save,
validation, cancellation and stale-context checks. No backend, transport,
credentials, payment or remote Save is involved in this example.

Other cards show read-only, pending, validation, masking, hidden-title, configured
read-only and literal or long symbol states. Masked, hidden and retired native
readouts are omitted. Presentation and optional styles are provisional. See
`docs/field-bindings.md` and `docs/ui.md` for the shared owner and renderer APIs.

After building, run `node scripts/check-currency-browser.mjs` for synthetic
Chromium verification. Screenshots and `result.json` go to `dist/currency-browser`.
Set `SDK_CURRENCY_CHROMIUM` to an installed Chromium executable, for example
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS; the default
is `/usr/bin/chromium`. External browser requests are blocked. Browser keyboard
checks do not certify OS input methods or screen readers.
