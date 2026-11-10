import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Freeze native 1.7.2 with the established consumer React binding. */
export async function buildAddressCombobox(sourceRoot) {
    const rebuilt = await build({
        stdin: {
            contents: `export {Combobox,Transition} from ${JSON.stringify(join(sourceRoot, 'dist/headlessui.esm.js'))};`,
            resolveDir: process.cwd(),
        },
        bundle: true,
        platform: 'neutral',
        format: 'cjs',
        target: 'es2022',
        external: ['react', 'react-dom'],
        write: false,
        // Source-label comments depend on pnpm's symlink versus prepare layout.
        // Whitespace-only minification retains identifiers and program behavior.
        minifyWhitespace: true,
        legalComments: 'none',
    });
    return rebuilt.outputFiles[0].text.replaceAll(
        'require("react")',
        'require("./react-peer.js").getReact()'
    );
}

export async function assertAddressCombobox(sourceRoot) {
    const require = createRequire(import.meta.url);
    // Collaborator's build uses Headless UI 2. Address preserves native 1.7.2
    // through a separate dev-only alias; neither package becomes a runtime peer.
    const root =
        sourceRoot ??
        dirname(dirname(require.resolve('headlessui-address-source')));
    const metadata = JSON.parse(readFileSync(join(root, 'package.json')));
    assert.equal(metadata.name, '@headlessui/react');
    assert.equal(metadata.version, '1.7.2');
    assert.equal(metadata.license, 'MIT');
    const inputs = JSON.parse(
        readFileSync(new URL('./address-combobox-inputs.json', import.meta.url))
    );
    for (const [path, hash] of Object.entries(inputs))
        assert.equal(
            createHash('sha256')
                .update(readFileSync(join(root, path)))
                .digest('hex'),
            hash
        );
    const vendor = new URL('../vendor/headlessui-address/', import.meta.url);
    const provenance = JSON.parse(
        readFileSync(new URL('provenance.json', vendor))
    );
    const bytes = readFileSync(new URL('combobox.js', vendor));
    assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        provenance.sha256
    );
    assert.equal(
        bytes.toString(),
        await buildAddressCombobox(root),
        'Address vendor must remain a mechanical native closure'
    );
    assert(!bytes.includes('require("react")'));
    assert(!bytes.includes('require("react-dom")'));
    assert(bytes.includes('require("./react-peer.js").getReact()'));
}
