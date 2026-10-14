# React DateTime example

From the SDK root, run `pnpm build`, then `node examples/react-datetime/dev.mjs`.
Open <http://127.0.0.1:4180>.

Try a partial timestamp and a complete value such as
`2024-02-29T12:30:45.007+05:45`. Seconds and an explicit `Z` or `±HH:mm` offset
are required; optional subseconds retain one to three digits. The owner keeps
partial or invalid text separately from the last accepted native draft. Clear
writes `null`; remounting keeps the owner and both forms of state. No local-time
or daylight-saving inference, normalization or native datetime picker is added.

The first field has fixed UTC metadata. The final field uses the accepted client
timezone. “Change client timezone” retires that client-zone owner while the fixed
zone remains editable. A real application creates a fresh accepted owner after
such context replacement. “Update first draft” supplies a synthetic explicit-offset
timestamp during the autumn daylight-saving overlap, preserving its exact bytes.

The fixture imports public `renderDateTimeField`, the `DateTimeField` binding
component, and optional `@miniextensions/sdk/react/datetime.css`. Synthetic hosts
and a binding adapt `createDateFieldModel` outside React to represent the accepted
Form/Portal owners supplied by real applications. Permission, read-only, pending,
validation, masking, hidden-title, visibility and retirement examples use the same
owner state. Private or retired values are omitted from native-state readouts.
Presentation and optional styles are provisional.

No backend, credentials or Save calls are used. Applications keep deliberate Save
in their existing owner; invalid editable timestamp input blocks that Save.
See `docs/field-bindings.md` and `docs/ui.md` for the shared model and renderer APIs.

After building, run `node scripts/check-datetime-browser.mjs` for synthetic
Chromium verification. Screenshots and `result.json` go to `dist/datetime-browser`.
Set `SDK_DATETIME_CHROMIUM` to an installed Chromium executable, for example
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS; the default
is `/usr/bin/chromium`. The browser context blocks external network requests.
Native keyboard checks do not certify OS input methods or screen readers.

The browser check also mounts two isolated hosts from `enter-fixture.ts`: one
text input without a submit button, and one text input with an enabled submit
button. Native Enter can submit either host even though the renderer stops the
input's key events from bubbling. The host counts the submit event and calls
`preventDefault()` to prevent navigation; it has no Save action. Applications
must keep their own submit policy and deliberate Save authorization. The main
eight-input example's zero-submit counter does not prove universal Enter
suppression. `result.json` records both native Enter and untrusted simulated
composing Enter; the latter does not exercise a trusted browser default action
or certify an OS input method.
