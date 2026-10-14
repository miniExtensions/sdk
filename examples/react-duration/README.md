# React Duration example

From the SDK root, run `pnpm build`, then `node examples/react-duration/dev.mjs`.
Open <http://127.0.0.1:4181>.

The fixture demonstrates `h:mm`, `h:mm:ss`, `h:mm:ss.S`, `h:mm:ss.SS` and
`h:mm:ss.SSS`. Native values remain seconds. The canonical formatter controls
display precision; focusing, blurring or remounting never rounds the native draft.
Raw accepted input stays visible while focused, and partial or invalid text is
retained separately from the last accepted value. Clear writes `null`; zero stays
a distinct native answer.

Try `90` or `1:90` in the minutes field, `1:90` in a seconds field, and a negative
clock such as `-1:02:03.125`. The existing owner defines component overflow and
admission. “Change duration format” retires the final owner, which requires a fresh
accepted context. The read-only slot has no editing model and formats its native
seconds with the canonical `getFormattedDuration(value, format, true)` helper.

The example imports public `renderDurationField`, `DurationField`, and the optional
`@miniextensions/sdk/react/duration.css` stylesheet. Synthetic hosts and a binding
adapt `createDurationFieldModel` outside React, including its typed `setFocused`
bridge. Real applications provide accepted Form/Portal owners and retain their
explicit Save, validation and cancellation behavior. No backend, credentials,
transport or Save calls are used here.

Permission, pending, validation, masking, hidden-title, visibility and retirement
states are included. Private or retired values are omitted from native readouts.
Styles are provisional. See `docs/field-bindings.md` and `docs/ui.md` for the shared
model and renderer contracts.

After building, run `node scripts/check-duration-browser.mjs` for synthetic
Chromium verification. Screenshots and `result.json` go to `dist/duration-browser`.
Set `SDK_DURATION_CHROMIUM` to an installed Chromium executable, for example
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS; the default
is `/usr/bin/chromium`. External browser requests are blocked. Browser keyboard
checks do not certify OS input methods or screen readers.
