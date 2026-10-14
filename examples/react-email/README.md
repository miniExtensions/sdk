# React Email example

From the SDK root, run `pnpm build`, then `node examples/react-email/dev.mjs`.
Open <http://127.0.0.1:4183>.

The example imports public `EmailField`, `renderEmailField`, and the existing
optional `@miniextensions/sdk/react/text.css`. Email uses a native text input.
It preserves case, whitespace, Unicode, and incomplete or invalid email strings;
it does not normalize, link, send, verify, or apply native email constraints.
Empty input and Clear write `null`. Styling is provisional and optional.

Public Form bindings, a Grid cell owner, and a read-only List detail owner are
created outside React in `owners.ts`. Their accepted metadata and injected client
responses are entirely synthetic and local. A fetch guard rejects any attempt
to use a live endpoint. The toolbar's deliberate Save actions call the existing
owner and capture exact strings in an in-memory receipt; renderer edits, Clear,
remounts, and Enter never invoke Save. Both owners require a fresh load before a
second Save, so each local Save button disables after completion.
Additional typed fixtures show composition, masking, pending, returned feedback,
computed values, and hidden visual titles.

The synthetic Form Save uses the bindings owner directly. It does not simulate
the page-navigation email validator or a real server. Those existing validation
policies remain unchanged; this example verifies presentation and exact draft
transport, not whether a real application accepts a particular email address.

The gallery has multiple inputs and no submit button. Two additional isolated
forms cover a single text input without a submit button and an enclosing form
with a submit button. Stopping keyboard events from bubbling to a row does not
cancel native Enter submission. Each host counts submit events and prevents
navigation without calling Save; the application owns submission policy.

After building, `node scripts/check-email-browser.mjs` writes screenshots and
`result.json` to `dist/email-browser`. Set `SDK_EMAIL_CHROMIUM` to an installed
Chromium executable, for example
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS; the
default is `/usr/bin/chromium`. All external browser requests are blocked.
The receipt distinguishes trusted native Enter from synthetic composing keys.
Synthetic composition does not activate an OS IME, and untrusted keys do not
exercise native submission. Screen readers and real IMEs are not certified.
