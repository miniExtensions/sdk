# React Last Modified Time example

From the SDK root, run `pnpm build`, then
`node examples/react-last-modified-time/dev.mjs` and open <http://127.0.0.1:4195>.

The public `LastModifiedTimeField` binding component and `renderLastModifiedTimeField`
slot reuse the disabled DateTime control and optional
`@miniextensions/sdk/react/datetime.css`. The editable Text neighbor uses
`text.css`. No calendar, date model, editor, parser or formatter is added.

Native strings are presented only when `config.type` is `lastModifiedTime` and
`options.isValid === true`. False, missing or nonboolean validity and nonstring
values display blank while preserving the owner value. Valid strings are shown as supplied, including malformed and naive strings,
whitespace, explicit offsets and fractional precision. Both nested result metadata
kinds (`date` and `dateTime`) retain the same raw-string behavior. Null and missing
values display blank; an empty string remains distinct from null in the owner.
A browser single-line input removes CR/LF from its DOM value, while the native
owner keeps the exact original string. No timezone conversion, reference-field interpretation, clock reading or record
calculation occurs.

The synthetic fixture uses real Form bindings and accepted Portal grid/list
detail hosts. Other cards isolate masks, pending state, owner feedback, hidden
titles, visibility and retirement. The noncomputed Form fixture is still read
only by physical kind. Once its real Form host loses currentness, that host stays
retired across remounts. The separate Text neighbor remains editable.

“Cycle accepted metadata” performs two local synthetic reads through the real
Form owner: valid → invalid → valid. Each accepted reload keeps the native naive
string, retires the old binding, and accepts a fresh binding and host. The final
state changes nested result metadata from `dateTime` to `date` and changes
`referencedFieldIds`; neither change reformats or calculates the value. Invalid
metadata remains accepted but displays blank. Missing and nonboolean validity
cards are separate malformed helper-boundary fixtures, not real accepted owners.

After building, run:

```sh
SDK_LAST_MODIFIED_TIME_CHROMIUM=/path/to/chromium node scripts/check-last-modified-time-browser.mjs
```

On macOS, the executable can be
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. The default is
`/usr/bin/chromium`. Screenshots and `result.json` go to
`dist/last-modified-time-browser`; an optional positional argument selects another
evidence directory. Native keyboard/pointer and injected-event checks are
synthetic browser evidence, not certification of OS input methods or screen readers.

All data and transport are local synthetic fixtures. External browser requests
are blocked. No credentials, backend, Save action, live identity lookup or
webhook is connected. `.generated/` previews and `dist/` evidence are ignored;
these seven source files remain tracked.
