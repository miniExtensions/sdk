# SDK-owned React 18/19 adaptation

The selected `react-medium-image-zoom` 3.1.3 CommonJS runtime is retained exactly
under `upstream/lib`; `upstream-package.json`, `LICENSE` and `UPSTREAM.json` retain
its manifest, MIT notice and per-file SHA256 provenance. Other installed `dist`
or package trees were not copied. This internal package is not the upstream npm
package and does not republish its old React peer declaration.

The working `lib` retains the original image geometry, overlay styles,
max-dimension calculation, transitions, source replacement, keyboard zoom and
controlled/uncontrolled interface. SDK changes are limited to:

- Allocate portal nodes detached; append/remove only during committed class
  lifecycles, preserve a node moved by another owner, and support effect replay.
- Own the exact window's listeners and delayed listener registration. Use native
  `touchstart`/`touchmove`/`touchend`/`touchcancel` event names and guard empty touches.
- Cancel transition/source timers and image-load subscriptions on unmount; retire
  callbacks with mount generations and refuse duplicate close transitions.
- Close the editor's uncontrolled overlay when its accepted image source changes.
  A deferred close cannot replace or focus a different image. Focus restoration
  requires the current mounted, connected image after the callback completes.

Runtime dependencies resolve to the SDK's React and ReactDOM peer singletons and
its exact `prop-types` dependency (15.8.1 in the source snapshot). There is no nested
React installation, global ReactDOM patch, legacy render fallback or automatic I/O
at import. The full editor remains a browser-only lazy consumer.

These edits have not been executed or validated by their author; root owns the
combined React 18/19, SSR/import, installed package and browser qualification.
