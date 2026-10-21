# Local React Button example

From the SDK checkout with development dependencies installed:

```sh
npm run build
node examples/react-button/dev.mjs
```

Open http://127.0.0.1:4175. The example resolves the built package's public
exports, including `@miniextensions/sdk/react/button.css`. It uses React 18
StrictMode and a synthetic client method: no credentials or webhook requests.
Owners are created outside React and survive the **Remount renderers** control.
Click **Run once** to see an uncertain result remain disabled after remount.
There is intentionally no retry control; a real application must handle an
explicit new intent through the existing owner after explaining uncertainty.

Run `node_modules/.bin/tsc -p examples/react-button/tsconfig.json` after building.
This is a local source example, not a deployed app or shipped browser starter.

For repeatable synthetic Chromium verification and screenshots, run
`node scripts/check-button-browser.mjs`. It uses `/usr/bin/chromium` by default;
set `SDK_BUTTON_CHROMIUM` to another installed Chromium executable if needed.
Evidence is written to `dist/button-browser`. The check covers keyboard focus,
loading/remount, uncertainty, localized and empty feedback, row propagation,
native link targets, unique IDs and a narrow viewport.
