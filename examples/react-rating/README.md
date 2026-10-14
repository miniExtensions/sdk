# React Rating example

From the SDK root, run `pnpm build`, then
`node examples/react-rating/dev.mjs`. Open <http://127.0.0.1:4188>.

This example imports public `renderRatingField`, `RatingField`, and the existing
optional `@miniextensions/sdk/react/number.css`. Typed synthetic hosts and bindings
borrow public numeric models created outside React. They are not actual
Form/Grid/List owners. No Save action, backend, or credential is connected.

The manual numeric input preserves native rating values. Its metadata specifies
`max: 5`, `icon: 'star'`, and `color: 'yellowBright'`; the control still accepts
`6`, `-1.5`, `0.125`, and finite exponents through the existing scalar. Metadata
does not add stars, a range control, rounding, scaling, integer enforcement,
clamping, or a localized parser. Incomplete or invalid input remains alongside
the last valid native number. Emptying the input writes `null`; entering `0`
writes zero. There is no Clear button.

Try native typing and caret edits, partial drafts, remounts, external replacement,
permissions, masking, pending state, feedback, hiding, and retirement. A custom
render callback shows the native value as text. A fixed-key NumberField switches
Rating, Number, Currency, and Duration owners without resetting their drafts or
units; this section also imports existing currency/duration styles. Duration
formatting changes its blurred display without changing precise native seconds.
Styles are provisional.

Two enclosing forms show native Enter: one single input without a submit button,
and one with a submit button. Their handlers count submission and prevent
navigation without invoking Save. Stopping key bubbling does not cancel native
submission; applications own submit and Save policy.

After building, run `node scripts/check-rating-browser.mjs`. Evidence is written
to `dist/rating-browser`. Set `SDK_RATING_CHROMIUM` to an installed Chromium,
such as `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; the default
is `/usr/bin/chromium`. External requests are blocked. The partial-focus screenshot
shows an edited card; mobile evidence shows a fresh initial-state page.
Composing key events distinguish untrusted events from native Enter defaults.
Numeric edits continue through the existing scalar; the renderer adds no IME
buffering, and this proof does not certify OS IMEs or screen readers.
