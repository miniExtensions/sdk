import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    lstatSync,
    readFileSync,
    realpathSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { build } from 'esbuild';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const localImports = [
    './CompleteCollaboratorField.js',
    './PersonBadge.js',
    './TextInput.js',
    '../ui/collaboratorSelection.js',
];
const external = ['react/*', 'react-dom/*', 'fuse.js'];
const peerNamespace = 'collaborator-esm-peer';
const peerFacade = (name) =>
    `export * from ${JSON.stringify(name)};\nimport * as peer from ${JSON.stringify(name)};\nexport default peer;\n`;
const peerFacades = new Map(
    ['react', 'react-dom'].map((name) => [
        `${peerNamespace}:${name}`,
        { name, source: peerFacade(name) },
    ])
);

function packageFor(path) {
    for (
        let directory = dirname(realpathSync(path));
        ;
        directory = dirname(directory)
    ) {
        try {
            const manifest = json(join(directory, 'package.json'));
            if (typeof manifest.name === 'string')
                return { root: directory, manifest };
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        assert.notEqual(
            dirname(directory),
            directory,
            'Dependency package root missing'
        );
    }
}

function verifyPackage(root, manifest, expected) {
    assert(
        expected,
        `Unreviewed collaborator picker dependency: ${manifest.name}`
    );
    assert.equal(manifest.version, expected.version);
    assert.equal(manifest.license, expected.license);
    for (const [name, digest] of Object.entries(expected.licenseFiles)) {
        const path = join(root, name);
        assert(
            lstatSync(path).isFile(),
            'Dependency license must be a regular file'
        );
        assert.equal(
            hash(readFileSync(path)),
            digest,
            `${manifest.name}/${name}`
        );
    }
}

/**
 * Bundle the owned picker dependency closure, never an application renderer.
 * React/DOM stay optional SDK peers and Fuse retains its pinned production package.
 */
export async function bundleCollaboratorPicker(root = process.cwd()) {
    root = resolve(root);
    const provenanceRoot = join(root, 'vendor/collaborator-picker');
    const upstream = json(join(provenanceRoot, 'UPSTREAM.json'));
    const require = createRequire(join(root, 'package.json'));
    const headless = packageFor(require.resolve('@headlessui/react'));
    verifyPackage(
        headless.root,
        headless.manifest,
        upstream.allowedPackages['@headlessui/react']
    );
    for (const [name, digest] of Object.entries(upstream.rootEntrySha256))
        assert.equal(
            hash(readFileSync(join(headless.root, name))),
            digest,
            name
        );
    const fuse = packageFor(require.resolve('fuse.js'));
    verifyPackage(
        fuse.root,
        fuse.manifest,
        upstream.externalDependencies['fuse.js']
    );
    const receipts = [];
    for (const format of ['esm', 'cjs']) {
        const child = `dist/${format}/react/completeCollaboratorPickerRuntime.js`;
        const path = join(root, child);
        const result = await build({
            absWorkingDir: root,
            stdin: {
                contents: readFileSync(path, 'utf8'),
                resolveDir: dirname(path),
                sourcefile: basename(path),
                loader: 'js',
            },
            bundle: true,
            platform: 'neutral',
            mainFields:
                format === 'esm' ? ['module', 'main'] : ['main', 'module'],
            format,
            target: 'es2022',
            outfile: path,
            write: false,
            metafile: true,
            external,
            plugins: [
                {
                    name: 'reuse-shipped-collaborator-primitives',
                    setup(builder) {
                        builder.onResolve(
                            { filter: /^(?:react|react-dom)$/ },
                            (args) =>
                                format === 'esm' && args.kind === 'require-call'
                                    ? {
                                          path: args.path,
                                          namespace: peerNamespace,
                                      }
                                    : { path: args.path, external: true }
                        );
                        builder.onLoad(
                            {
                                filter: /^(?:react|react-dom)$/,
                                namespace: peerNamespace,
                            },
                            (args) => ({
                                contents: peerFacade(args.path),
                                loader: 'js',
                            })
                        );
                        builder.onResolve(
                            {
                                filter: /^(?:\.\/(?:CompleteCollaboratorField|PersonBadge|TextInput)\.js|\.\.\/ui\/collaboratorSelection\.js)$/,
                            },
                            (args) =>
                                args.resolveDir === dirname(path)
                                    ? { path: args.path, external: true }
                                    : undefined
                        );
                    },
                },
            ],
            legalComments: 'inline',
        });
        const packages = new Map();
        const inputs = [];
        for (const name of Object.keys(result.metafile.inputs)) {
            if (name === child) continue;
            const facade = peerFacades.get(name);
            if (facade) {
                assert.equal(format, 'esm');
                inputs.push({
                    package: facade.name,
                    path: 'sdk-owned-esm-peer-facade',
                    adaptation:
                        'bare CommonJS peer require to explicit external ESM namespace',
                    sha256: hash(facade.source),
                });
                continue;
            }
            const input = realpathSync(resolve(root, name));
            const dependency = packageFor(input);
            assert.notEqual(
                dependency.manifest.name,
                '@miniextensions/sdk',
                'Picker must reuse the existing shipped local primitives'
            );
            assert(
                !['react', 'react-dom', 'fuse.js'].includes(
                    dependency.manifest.name
                ),
                'React, React DOM and Fuse must remain external'
            );
            const expected = upstream.allowedPackages[dependency.manifest.name];
            verifyPackage(dependency.root, dependency.manifest, expected);
            packages.set(dependency.manifest.name, {
                name: dependency.manifest.name,
                version: dependency.manifest.version,
                license: dependency.manifest.license,
                integrity: expected.integrity,
                sourceUrl: expected.sourceUrl,
                licenseFiles: expected.licenseFiles,
            });
            inputs.push({
                package: dependency.manifest.name,
                path: relative(dependency.root, input).replaceAll('\\', '/'),
                sha256: hash(readFileSync(input)),
            });
        }
        assert(
            packages.has('@headlessui/react'),
            'Actual Headless UI picker closure missing'
        );
        for (const output of Object.values(result.metafile.outputs))
            assert(
                !output.imports.some((entry) =>
                    Object.hasOwn(upstream.allowedPackages, entry.path)
                ),
                'A dev-only picker package escaped the bundled closure'
            );
        assert.equal(result.outputFiles.length, 1);
        const bytes = result.outputFiles[0].contents;
        writeFileSync(path, bytes);
        const receipt = {
            schemaVersion: 1,
            child,
            sha256: hash(bytes),
            external: ['react', 'react-dom', 'fuse.js', ...localImports],
            adaptation:
                format === 'esm'
                    ? 'Only bare React/ReactDOM CommonJS require calls use an SDK-owned ESM namespace facade; no global require or Node polyfill.'
                    : 'CommonJS peer require calls remain ordinary external imports.',
            packages: [...packages.values()].sort((a, b) =>
                a.name.localeCompare(b.name)
            ),
            inputs: inputs.sort((a, b) =>
                `${a.package}/${a.path}`.localeCompare(`${b.package}/${b.path}`)
            ),
        };
        writeFileSync(
            join(
                root,
                `dist/${format}/react/complete-collaborators.provenance.json`
            ),
            JSON.stringify(receipt, null, 4) + '\n'
        );
        copyFileSync(
            join(provenanceRoot, 'LICENSES.txt'),
            join(
                root,
                `dist/${format}/react/complete-collaborators.LICENSES.txt`
            )
        );
        receipts.push({
            format,
            child,
            sha256: receipt.sha256,
            packages: receipt.packages,
        });
    }
    console.error('[sdk-collaborator-picker-bundle]', JSON.stringify(receipts));
}
