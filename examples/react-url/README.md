# React URL example

From the SDK root, run `pnpm build`, then `node examples/react-url/dev.mjs`.
Open <http://127.0.0.1:4184>.

This compact presentation example imports public `renderUrlField`, `UrlField`,
and the existing optional `@miniextensions/sdk/react/text.css`. Typed synthetic
hosts and a synthetic binding hold local drafts outside React. They are not
actual Form/Grid/List owners; those integrations are covered by source and
installed-package tests. This fixture has no Save action, backend, or credentials.

Manual URL entry uses a native text input. Bare hosts, Unicode, case, whitespace,
invalid strings, and schemes such as `javascript:` or `data:` remain inert text.
The example does not normalize or validate URLs, render anchors or previews,
open windows, or fetch their contents. `displayAsButton` and
`displayAsAttachments` do not grant navigation or preview authority. Existing
application/server policy remains outside this presentation slice.

Try caret editing, composition, Clear (`null`), remounting, owner replacement,
permission changes, masking, pending state, returned feedback, and retirement.
Masked values are omitted from plain-text readouts. Styles are provisional.

Two separate enclosing forms demonstrate native Enter: one text input without
a submit button, and one with a submit button. Their host handlers count submit
events and prevent navigation without calling Save. Stopping keyboard bubbling
does not cancel native submission; the application owns submit and Save policy.

Run `node scripts/check-url-browser.mjs` after building. Evidence is written to
`dist/url-browser`. Set `SDK_URL_CHROMIUM` to an installed Chromium executable
(for example `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on
macOS); the default is `/usr/bin/chromium`. External requests are blocked and
the proof checks that values create no anchors, popups, previews, or navigation.
Synthetic composition events and untrusted composing keys do not certify OS IME
behavior or native default actions. Screen readers are not certified here.
