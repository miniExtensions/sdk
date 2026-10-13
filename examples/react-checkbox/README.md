# Local React Checkbox example

From the SDK checkout with development dependencies installed:

```sh
npm run build
node examples/react-checkbox/dev.mjs
```

Open http://127.0.0.1:4176. The example uses only public SDK exports, including
the optional `@miniextensions/sdk/react/checkbox.css`. Synthetic scalar owners
are created outside React and survive StrictMode and **Remount renderers**.
There are no credentials, requests or backend fixtures. In an application, use
the existing accepted Form/Portal host instead of these synthetic adapters.

Try label clicks, Tab and Space, permission changes, remounting, validation,
read-only and pending values. Edits remain local drafts; rendering does not
submit a form. A Calendly-configured field is deliberately non-editable because
this native Checkbox slice does not provide scheduling integration.

Run `node_modules/.bin/tsc -p examples/react-checkbox/tsconfig.json` after building.
Run `node scripts/check-checkbox-browser.mjs` for synthetic Chromium checks and
screenshots in `dist/checkbox-browser`. Set `SDK_CHECKBOX_CHROMIUM` to override
the default `/usr/bin/chromium` executable. This is a local source example,
separate from the shipped browser starter.
