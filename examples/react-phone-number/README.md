# React Phone Number example

From the SDK root, run `pnpm build`, then
`node examples/react-phone-number/dev.mjs`. Open <http://127.0.0.1:4185>.

This compact presentation example imports public `renderPhoneNumberField`,
`PhoneNumberField`, and the existing optional
`@miniextensions/sdk/react/text.css`. Typed synthetic hosts and bindings hold
local drafts outside React. They are not actual Form/Grid/List owners; those
integrations are covered by source and installed-package tests. There is no
Save action, backend, or credential in this fixture.

Manual phone entry uses a native text input. Plus signs, leading zeros,
extensions, punctuation, `*`, `#`, commas, semicolons, Unicode, whitespace,
invalid strings, and `tel:`-looking values remain exact inert text. The renderer
adds no phone syntax rules, country selector, prefix, or formatting.
`showCountryCodes` and `defaultCountryCode` remain inert in this slice. It does
not create `tel:` links, dial, send SMS, verify OTPs, perform lookups, or make
requests. Existing application/server policy remains unchanged.

Try caret editing, composition, Clear (`null`), remounting, owner replacement,
permissions, masking, pending state, returned feedback, and retirement. A custom
render callback demonstrates a plain-text binding readout. Masked values are
omitted from the native-state readout. Styles are provisional.

Two separate forms demonstrate native Enter: a single text input without a
submit button and one with a submit button. Host handlers count submission and
prevent navigation without calling Save. Stopping keyboard bubbling does not
cancel native submission; applications own submit and Save policy.

After building, run `node scripts/check-phone-number-browser.mjs`. Evidence is
written to `dist/phone-number-browser`. Set `SDK_PHONE_NUMBER_CHROMIUM` to an
installed Chromium executable, such as
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; the default is
`/usr/bin/chromium`. External requests are blocked. The focused-card screenshot
shows edited state; the narrow screenshot shows a fresh initial-state page.
Synthetic composition and untrusted composing keys do not certify OS IMEs or
native default actions. Screen readers are not certified here.
