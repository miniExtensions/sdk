# React Single Select example

From the SDK root, run `pnpm build`, then
`node examples/react-single-select/dev.mjs` and open <http://127.0.0.1:4196>.

The public `SingleSelectField` binding component and `renderSingleSelectField`
slot use a native dropdown and optional
`@miniextensions/sdk/react/single-select.css`. `SelectField` delegates its
single-select path to the same presentation. Native values remain choice names
or `null`; configured labels and choice IDs never become saved values. The
existing owner supplies eligible options, labels, retained unavailable selections
and selection limits. List/radio presentation and choice colors are outside this
example.

The fixture uses real Form owners, an accepted static Grid cell editor, and
readonly Grid/List detail hosts. Other cases cover renamed display labels,
retained unavailable values, masks, readonly controls, repeated labels and event
containment. Conditional Portal inline configurations remain refused. Masked
stock controls omit values, options and choice actions. Selecting or clearing
changes a local native draft through the existing owner; record Save is a separate
explicit operation.

Configured Create and Cancel use the Form owner's existing choice controller and
held synthetic responses. Entered create-name text is local presentation state.
The binding or stable renderer host identifies that text; replacing the source or
remounting cannot transfer it to another owner. Accepted choice creation can select
a name in the local draft but does not save a record. Uncertain outcomes do not
trigger automatic retry or acknowledgment.

After building, run:

```sh
SDK_SINGLE_SELECT_CHROMIUM=/path/to/chromium node scripts/check-single-select-browser.mjs
```

On macOS, the executable can be
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. The default is
`/usr/bin/chromium`. Screenshots and `result.json` go to
`dist/single-select-browser`; an optional positional argument selects another
evidence directory. The proof covers native dropdown selection, keyboard
type-ahead, Tab and Space, repeated controls, event containment, layout and forced
colors. Native popup arrow navigation was not proven: macOS headless Chrome 155
also left a plain HTML select unchanged for ArrowDown/menu sequences. The receipt
records this limitation. This is synthetic browser evidence, not certification of
every platform's input methods or screen readers.

All data and transport are local synthetic fixtures. No credentials, live backend
or production data is connected. Choice-creation responses are synthetic;
rendering does not read or save records. `.generated/` previews and `dist/` evidence
are ignored, while the example source files remain tracked.
