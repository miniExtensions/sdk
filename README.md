# miniExtensions SDK

Build your own Form and Portal interfaces with miniExtensions' published
configuration, record permissions, and Airtable connection. The SDK provides
a typed browser runtime client and a portable formula engine. It is under
development and requires an enabled `/api/sdk` server endpoint.

The runtime covers loading, visitor authentication, Form saves and deletion,
linked-table reads and pagination, selectors, child Forms, Grid edits, unlink,
Kanban category changes, attachment uploads, and child-record comments.

The package has not been published to npm. From a checkout, run:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm pack
```

Install the resulting archive in a separate project to try the formula engine:

```sh
npm install /path/to/miniextensions-sdk-0.1.0-alpha.0.tgz
```

```ts
import { FormulaRunner } from '@miniextensions/sdk/formulas';

const formula = new FormulaRunner('"Total: " & (2 + 3 * 4)');
console.log(formula.run()); // "Total: 14"
```

CommonJS is also supported:

```js
const { FormulaRunner } = require('@miniextensions/sdk/formulas');
```

Formula evaluation runs locally and needs no miniExtensions API key or network
connection. The `/formulas` suffix is a package import subpath. See the
[formula guide](docs/formulas.md) for field context, supported functions, and
compatibility details.

## Runtime client

```ts
import { createMiniExtensionsClient } from '@miniextensions/sdk';

const client = createMiniExtensionsClient({
    apiOrigin: 'https://your-api-origin.example',
    publishableKey: 'YOUR_PUBLISHABLE_KEY',
});
const extension = await client.loadExtension({
    shareId: 'YOUR_SHARE_ID',
    recordId: null,
    context: { type: 'direct-url' },
});
```

Publishable keys do not replace visitor login or record access. Sessions are
explicitly owned by your application, and methods preserve the hosted runtime's
response shapes. Keys are created and revoked in workspace Settings; they do
not expire and cover all supported operations in that workspace.

See the [runtime guide](docs/runtime.md) for authentication, Form validation,
Portal reads and actions, files, comments, and cancellation. Its
[packaged Form quickstart](docs/runtime.md#packaged-form-quickstart) includes
archive installation, typed field values, and a complete load-and-save flow.
It is included in the archive and needs no access to this private repository.

## Optional selection controls

Import `@miniextensions/sdk/ui` for native single-select/multi-select controls,
searchable authorized linked-record selectors, or their headless selection
model. The optional subpath adds no browser UI framework or runtime dependency
to the core client. Use the [UI guide](docs/ui.md) for field values, custom
styling, React/Next integration, and visitor/context cleanup. Choices edit your
application's draft; saving and server permissions remain with the runtime.

## Environments

- Node.js 22 or newer, with ESM or CommonJS imports.
- Browser applications using an ES2022-capable bundler. Direct script-tag/CDN
  imports are not supplied in this version.
- TypeScript declarations are included for both module formats.

## Development

`pnpm check` runs formatting, application/test typechecking, SDK behavior
tests, both builds, and checks a packed archive from independent ESM, CommonJS,
TypeScript, and browser-bundled consumers. Tests use owned synthetic fixtures
and make no API calls. The full browser Form and Portal example is also
typechecked and built from a clean copy using that newly packed archive. The
optional UI selection example receives the same full packed-consumer checks.

The package remains marked private to prevent npm publication during
development. Publishing and compatibility with the hosted runtime API are
separate release steps.

## License

[MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for adapted
code attribution. Runtime dependencies retain their respective licenses.
