# miniExtensions SDK

The miniExtensions SDK is under development. This first version provides the
portable formula engine. Form, Portal, authentication, attachment, comment, and
automation API clients will follow; those methods are not available yet.

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

## Environments

- Node.js 22 or newer, with ESM or CommonJS imports.
- Browser applications using an ES2022-capable bundler. Direct script-tag/CDN
  imports are not supplied in this version.
- TypeScript declarations are included for both module formats.

## Development

`pnpm check` runs formatting, application/test typechecking, formula behavior
tests, both builds, and checks a packed archive from independent ESM, CommonJS,
TypeScript, and browser-bundled consumers. Tests use owned synthetic fixtures
and make no API calls.

The package remains marked private to prevent npm publication during
development. Publishing and compatibility with the hosted runtime API are
separate release steps.

## License

[MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for adapted
code attribution. Runtime dependencies retain their respective licenses.
