import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { build } from 'esbuild';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
function packageFor(path) {
    for (
        let directory = dirname(realpathSync(path));
        ;
        directory = dirname(directory)
    ) {
        try {
            const manifest = json(join(directory, 'package.json'));
            if (manifest.name) return { directory, manifest };
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        assert.notEqual(
            directory,
            dirname(directory),
            'Missing dependency package'
        );
    }
}

/** Private native DnD closure. React/DOM remain external optional SDK peers. */
export async function bundleKanban(root = process.cwd()) {
    root = resolve(root);
    const upstream = json(join(root, 'vendor/kanban-dnd/UPSTREAM.json'));
    const receipts = [];
    for (const format of ['esm', 'cjs']) {
        for (const entry of ['runtime', 'projectionState']) {
            const path = join(root, `dist/${format}/react/kanban/${entry}.js`);
            const facade = (name) =>
                `export * from ${JSON.stringify(name)};\nimport * as peer from ${JSON.stringify(name)};\nexport default peer;\n`;
            const result = await build({
                absWorkingDir: root,
                stdin: {
                    contents: readFileSync(path, 'utf8'),
                    resolveDir: dirname(path),
                    sourcefile: relative(root, path),
                },
                bundle: true,
                platform: 'neutral',
                target: 'es2022',
                format,
                mainFields:
                    format === 'esm' ? ['module', 'main'] : ['main', 'module'],
                outfile: path,
                write: false,
                metafile: true,
                legalComments: 'inline',
                external: ['react/*', 'react-dom/*'],
                plugins: [
                    {
                        name: 'kanban-optional-peers',
                        setup(builder) {
                            builder.onResolve(
                                { filter: /^(?:react|react-dom)$/ },
                                (args) =>
                                    format === 'esm' &&
                                    args.kind === 'require-call'
                                        ? {
                                              path: args.path,
                                              namespace: 'kanban-peer',
                                          }
                                        : { path: args.path, external: true }
                            );
                            builder.onLoad(
                                { filter: /.*/, namespace: 'kanban-peer' },
                                (args) => ({
                                    contents: facade(args.path),
                                    loader: 'js',
                                })
                            );
                            builder.onResolve(
                                { filter: /^\.\.\/ThemeBoundary\.js$/ },
                                (args) =>
                                    args.resolveDir === dirname(path)
                                        ? { path: args.path, external: true }
                                        : undefined
                            );
                        },
                    },
                ],
            });
            const inputs = [],
                packages = new Set();
            for (const input of Object.keys(result.metafile.inputs)) {
                if (input.startsWith('kanban-peer:')) {
                    inputs.push({
                        path: input,
                        sha256: hash(
                            facade(input.slice('kanban-peer:'.length))
                        ),
                    });
                    continue;
                }
                // stdin is the already compiled owned entry, also hashed below.
                if (
                    !input.includes('node_modules') &&
                    input.endsWith(relative(root, path))
                )
                    continue;
                const actual = realpathSync(resolve(root, input));
                const owner = packageFor(actual);
                if (owner.manifest.name === '@miniextensions/sdk') {
                    assert(
                        actual.startsWith(
                            join(root, `dist/${format}/react/kanban/`)
                        ),
                        'Unreviewed local bundle input'
                    );
                    inputs.push({
                        path: relative(root, actual),
                        sha256: hash(readFileSync(actual)),
                    });
                    continue;
                }
                const expected = upstream.packages[owner.manifest.name];
                assert(
                    expected,
                    `Unreviewed Kanban package: ${owner.manifest.name}`
                );
                assert.equal(owner.manifest.version, expected.version);
                assert.equal(owner.manifest.license, expected.license);
                for (const [name, digest] of Object.entries(
                    expected.licenseFiles
                ))
                    assert.equal(
                        hash(readFileSync(join(owner.directory, name))),
                        digest
                    );
                packages.add(owner.manifest.name);
                inputs.push({
                    package: owner.manifest.name,
                    path: relative(owner.directory, actual),
                    sha256: hash(readFileSync(actual)),
                });
            }
            if (entry === 'projectionState')
                assert(packages.has('use-state-with-deps'));
            if (entry === 'runtime')
                for (const name of [
                    '@dnd-kit/core',
                    '@dnd-kit/sortable',
                    '@dnd-kit/utilities',
                    '@dnd-kit/accessibility',
                ])
                    assert(packages.has(name));
            for (const output of Object.values(result.metafile.outputs))
                assert(
                    output.imports.every(
                        (item) =>
                            [
                                'react',
                                'react-dom',
                                '../ThemeBoundary.js',
                            ].includes(item.path) ||
                            item.path.startsWith('react/') ||
                            item.path.startsWith('react-dom/')
                    ),
                    'Private DnD dependency escaped bundle'
                );
            assert.equal(result.outputFiles.length, 1);
            const receipt = {
                format,
                entry,
                provenance: upstream.packages,
                inputSha256: hash(readFileSync(path)),
                packages: [...packages].sort(),
                inputs,
                outputSha256: hash(result.outputFiles[0].contents),
            };
            writeFileSync(path, result.outputFiles[0].contents);
            writeFileSync(
                path.replace(/\.js$/, '.bundle.json'),
                JSON.stringify(receipt, null, 2) + '\n'
            );
            receipts.push(receipt);
        }
    }
    return receipts;
}
