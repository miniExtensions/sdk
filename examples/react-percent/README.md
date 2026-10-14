# React Percent example

From the SDK root, run `pnpm build`, then
`node examples/react-percent/dev.mjs`. Open <http://127.0.0.1:4186>.

This example imports public `renderPercentField`, `PercentField`, and the
existing optional `@miniextensions/sdk/react/number.css`. Typed synthetic hosts
and bindings borrow public scalar models created outside React. They are not
actual Form/Grid/List owners. No Save action, backend, or credential is connected.

The input edits native fractions: `0.25` means 25% and remains `0.25` in both the
control and owner. It adds no percent suffix, scaling, rounding, padding, range
clamp, localized parser, or progress display. The existing numeric scalar keeps
unfinished or invalid input alongside its last valid native number. Emptying the
input writes `null`; entering `0` writes numeric zero. There is no Clear button.

Try native typing and caret edits, partial drafts, remounts, external replacement,
permissions, masking, pending state, feedback, hiding, and retirement. A custom
render callback shows the native value as text. A separate fixed-key NumberField
switches Percent, Number, Currency, and Duration owners without resetting their
drafts or units; this section also imports the existing currency/duration styles.
The Duration owner retains precise native seconds when its blurred display is
formatted. Styles are provisional.

Two enclosing forms show native Enter: one single input without a submit button,
and one with a submit button. Their handlers count submission and prevent
navigation without invoking Save. Stopping key bubbling does not cancel native
submission; applications own submit and Save policy.

After building, run `node scripts/check-percent-browser.mjs`. Evidence is written
to `dist/percent-browser`. Set `SDK_PERCENT_CHROMIUM` to an installed Chromium,
such as `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; the default
is `/usr/bin/chromium`. External requests are blocked. The partial-focus screenshot
shows an edited card; the mobile capture shows a fresh initial-state page.
Composing key events are simulated only to distinguish untrusted events from
native Enter defaults. Numeric edits continue through the existing scalar;
this proof does not certify OS IMEs or screen readers.
