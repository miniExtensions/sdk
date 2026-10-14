# React Multiline Text example

From the SDK root, run `pnpm build`, then
`node examples/react-multiline-text/dev.mjs`. Open <http://127.0.0.1:4187>.

This example imports public `MultilineTextField`, `renderMultilineTextField`,
and the existing optional `@miniextensions/sdk/react/text.css`. Typed synthetic
hosts and bindings keep their exact drafts outside React. They are not actual
Form/Grid/List owners. No Save action, backend, or credentials are connected.

The plain four-row textarea preserves blank lines, tabs, Unicode, trailing
spaces, and literal HTML as text. Native Enter inserts a newline. Emptying the
textarea or choosing Clear writes `null`. Nothing is trimmed, rendered as HTML,
opened, previewed, sent, or implicitly saved.

The CRLF fixture keeps its original owner string on mount and remount. Chromium
exposes normalized LF line endings in the textarea; a deliberate DOM edit commits
the edited DOM string. This browser distinction is not a normalization policy
added by the SDK.

Try caret edits, composition, owner replacement, remounts, permissions, pending
state, feedback, hiding, and retirement. A fixed-key binding switches two owners
without sharing their drafts. Active add-only or attachment-display modes show
an accessible status without a textarea or native-value readout. A legacy runtime
password flag is also exercised as unsupported; multiline login or password
editing is not provided. A custom renderer supplies its own safe presentation.
Explicitly false add-only/attachment flags permit ordinary editing.

The two enclosing forms show Enter with and without a submit button. Textarea
Enter inserts a newline in both; application handlers own explicit submission
and Save. Keyboard bubbling into the gallery row is stopped.

After building, run `node scripts/check-multiline-text-browser.mjs`. Evidence is
written to `dist/multiline-text-browser`. Set `SDK_MULTILINE_TEXT_CHROMIUM` to an
installed Chromium executable, such as
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; the default is
`/usr/bin/chromium`. External requests are blocked. Mobile evidence uses a fresh
initial-state page to avoid known post-resize screenshot artifacts. Composition
events are synthetic and do not certify OS IMEs or screen readers. Styles are
provisional.
