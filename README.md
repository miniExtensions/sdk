# miniExtensions SDK

Build your own Form and Portal interfaces with miniExtensions' published
configuration, record permissions, and Airtable connection. The SDK provides
a typed browser runtime client and a portable formula engine. It is under
development and uses the existing miniExtensions v1 and public tRPC APIs.

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
});
const extension = await client.loadExtension({
    shareId: 'YOUR_SHARE_ID',
    recordId: null,
    query: {},
    context: { type: 'direct-url' },
});
```

Sessions are explicitly owned by your application, and methods preserve the
hosted runtime's response shapes. Existing visitor login, record access and
published Form/Portal rules remain authoritative. Requests omit browser cookies
and never retry automatically. Cross-origin browser use requires the API
deployment to allow the public tRPC requests from your application.

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

## Headless Form helpers

`@miniextensions/sdk/forms` supplies optional headless Form drafts, ordered
field descriptors and explicit save orchestration. It keeps native values and
hidden prefills, collects server validation, and guards stale visitor work.
See the shipped [Form helpers guide](docs/forms.md) for draft ownership and
fresh-load requirements after success or an uncertain save outcome.

## Headless Portal collections

`@miniextensions/sdk/portals` supplies optional headless Portal collections,
returned detail metadata, explicit first/next reads, and configured child Form requests.
It keeps returned records and view detail settings intact, and guards stale
visitor work. Use the shipped [Portal helpers guide](docs/portals.md) for
criteria cleanup, application acceptance, and child Form context. Rendering,
saving, unlinking, and explicit reloads remain application-owned.

## Optional authentication flow

`@miniextensions/sdk/auth` binds password and login attempts, OTP challenges,
and explicit session application to one loaded auth screen and visitor revision.
It reuses the runtime client; the backend remains authoritative. Your application
owns rendering, persistence, draft cleanup and reload. See the shipped
[authentication guide](docs/auth.md) for manual actions and cancellation recovery.

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
