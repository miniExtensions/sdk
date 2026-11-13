# React Form completion example

From the SDK checkout, run `pnpm build`, then
`node examples/react-form-completion/dev.mjs`. Open <http://127.0.0.1:4198>.
The example uses only public SDK imports and the optional public completion CSS;
it has no monorepo aliases or native renderer dependency.

Choose stay, readonly, redirect, new form or close. Static content uses the
SDK's sanitized Quill HTML presentation; dynamic content is linkified plain
text. Change the dynamic message while a countdown is pending to see current
content without restarting the action schedule. “Immediate action” exercises
explicit zero. Preview renders the same content with effects gated off. “Show a
new completion” mounts a new presenter with its own lifecycle.

The command list is a synthetic external effect boundary. It records the exact
planned route and raw target, preserving copy, screen, prefills and hash behavior,
without navigating, closing windows, logging out, submitting, using credentials
or contacting a backend. Real hosts retain accepted Save, record/context and
navigation authority. A dispatched command does not prove navigation or close
succeeded.

To try the packed example outside the SDK checkout, copy this directory into a
new consumer project. Install the qualified SDK archive alongside `react`,
`react-dom`, `esbuild` and `typescript`; then run `node dev.mjs`. Install the
matching React type packages to run `tsc --noEmit` with your consumer's NodeNext
configuration. `node build.mjs` emits the same standalone browser assets into
`.generated`.
