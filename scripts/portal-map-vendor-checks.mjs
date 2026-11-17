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
const peers = /^(?:react|react-dom)(?:\/.*)?$/;
const peerNamespace = 'portal-map-esm-peer';
const facade = (name) =>
    `export * from ${JSON.stringify(name)};\nimport * as peer from ${JSON.stringify(name)};\nexport default peer;\n`;

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
            'Map input package missing'
        );
    }
}

export function assertPortalMapVendor(root = process.cwd()) {
    root = resolve(root);
    const vendor = join(root, 'vendor/portal-map');
    const upstream = json(join(vendor, 'UPSTREAM.json'));
    assert.equal(upstream.schemaVersion, 1);
    assert.equal(
        hash(readFileSync(join(vendor, 'LICENSES.txt'))),
        upstream.licensesSha256
    );
    assert.equal(upstream.sourceMapContentVerification.compared, 58);
    assert.equal(upstream.sourceMapContentVerification.differences, 0);
    assert.equal(upstream.sourceMapContentVerification.nullContents, 1);
    for (const item of upstream.licenseFiles) {
        const path = resolve(vendor, item.path);
        assert(path.startsWith(vendor + '/'), 'Map notice escaped vendor root');
        assert(lstatSync(path).isFile());
        assert.equal(hash(readFileSync(path)), item.sha256, item.path);
    }
    const require = createRequire(join(root, 'package.json'));
    const modulesRoot = realpathSync(join(root, 'node_modules'));
    const sdk = json(join(root, 'package.json'));
    for (const selected of upstream.physicalPackages) {
        const installed = packageFor(require.resolve(selected.name));
        assert(
            installed.root.startsWith(modulesRoot + '/'),
            'Map package escaped installed root'
        );
        assert.equal(sdk.devDependencies[selected.name], selected.version);
        assert.equal(installed.manifest.name, selected.name);
        assert.equal(installed.manifest.version, selected.version);
        assert.equal(installed.manifest.license, selected.declaredLicense);
        assert.equal(
            hash(readFileSync(join(installed.root, 'package.json'))),
            selected.packageJsonSha256
        );
        for (const entry of selected.entries)
            assert.equal(
                hash(readFileSync(join(installed.root, entry.path))),
                entry.sha256,
                `${selected.name}/${entry.path}`
            );
        for (const license of selected.licenseFiles)
            assert.equal(
                hash(readFileSync(join(installed.root, license.path))),
                license.sha256
            );
        for (const map of upstream.prebundledSourceMaps.filter(
            (item) => item.package === selected.name
        ))
            assert.equal(
                hash(readFileSync(join(installed.root, map.path))),
                map.sha256
            );
        for (const source of upstream.selectedSourceProof.filter(
            (item) => item.package === selected.name
        ))
            assert.equal(
                hash(readFileSync(join(installed.root, source.path))),
                source.sha256
            );
    }
    return upstream;
}

/** One captured ESM closure for production formats and actual-vendor focused tests. */
export async function bundlePortalMap(root = process.cwd(), options = {}) {
    root = resolve(root);
    const upstream = assertPortalMapVendor(root);
    const vendor = join(root, 'vendor/portal-map');
    const sourceEntry =
        options.sourceEntry ?? 'dist/esm/react/map/GoogleMapsRuntime.js';
    const sourcePath = resolve(root, sourceEntry);
    assert(sourcePath.startsWith(root + '/'));
    const source = readFileSync(sourcePath, 'utf8');
    assert(source.includes('@react-google-maps/api'));
    assert(source.includes('@googlemaps/js-api-loader'));
    assert(
        !/\b(?:useJsApiLoader|useLoadScript|LoadScript)\b/.test(source),
        'Map must use only one direct loader path'
    );
    const outputs =
        options.outputs ??
        ['esm', 'cjs'].map((format) => ({
            format,
            child: `dist/${format}/react/map/GoogleMapsRuntime.js`,
        }));
    const receipts = [];
    for (const { format, child } of outputs) {
        assert(['esm', 'cjs'].includes(format));
        const path = resolve(root, child);
        assert(path.startsWith(root + '/'));
        const result = await build({
            absWorkingDir: root,
            stdin: {
                contents: source,
                resolveDir: dirname(sourcePath),
                sourcefile: basename(sourcePath),
                loader: 'js',
            },
            bundle: true,
            platform: 'neutral',
            mainFields: ['module', 'main'],
            format,
            target: 'es2022',
            outfile: path,
            write: false,
            metafile: true,
            legalComments: 'inline',
            define: { 'process.env.NODE_ENV': '"production"' },
            plugins: [
                {
                    name: 'portal-map-external-peers',
                    setup(builder) {
                        builder.onResolve({ filter: peers }, (args) =>
                            format === 'esm' && args.kind === 'require-call'
                                ? { path: args.path, namespace: peerNamespace }
                                : { path: args.path, external: true }
                        );
                        builder.onLoad(
                            { filter: peers, namespace: peerNamespace },
                            (args) => ({
                                contents: facade(args.path),
                                loader: 'js',
                            })
                        );
                    },
                },
            ],
        });
        const physicalInputs = [],
            packages = new Set(),
            externalPeers = new Set();
        for (const name of Object.keys(result.metafile.inputs)) {
            if (name.startsWith(peerNamespace + ':')) {
                const peer = name.slice(peerNamespace.length + 1);
                assert(peers.test(peer));
                externalPeers.add(peer);
                physicalInputs.push({
                    package: peer,
                    path: 'sdk-owned-external-ESM-peer-facade',
                    sha256: hash(facade(peer)),
                });
                continue;
            }
            const input = resolve(root, name);
            if (input === sourcePath) continue;
            const dependency = packageFor(input);
            assert(
                dependency.root.startsWith(
                    realpathSync(join(root, 'node_modules')) + '/'
                ),
                'Map input escaped installed root'
            );
            const selected = upstream.physicalPackages.find(
                (item) => item.name === dependency.manifest.name
            );
            assert(
                selected,
                `Unreviewed Map physical input: ${dependency.manifest.name}`
            );
            assert(
                !peers.test(dependency.manifest.name),
                'Map must never bundle React/ReactDOM'
            );
            const relativePath = relative(
                dependency.root,
                realpathSync(input)
            ).replaceAll('\\', '/');
            const expected = selected.entries.find(
                (entry) =>
                    entry.role === 'selectedEsm' && entry.path === relativePath
            );
            assert(
                expected,
                `Map must reach selected ESM entry: ${dependency.manifest.name}/${relativePath}`
            );
            assert.equal(hash(readFileSync(input)), expected.sha256);
            packages.add(dependency.manifest.name);
            physicalInputs.push({
                package: dependency.manifest.name,
                version: selected.version,
                path: relativePath,
                sha256: expected.sha256,
            });
        }
        for (const selected of upstream.physicalPackages)
            assert(
                packages.has(selected.name),
                `Map selected input missing: ${selected.name}`
            );
        for (const output of Object.values(result.metafile.outputs))
            for (const imported of output.imports) {
                assert(
                    imported.external && peers.test(imported.path),
                    `Map bare dependency escaped closure: ${imported.path}`
                );
                externalPeers.add(imported.path);
            }
        assert.equal(result.outputFiles.length, 1);
        const bytes = result.outputFiles[0].contents;
        writeFileSync(path, bytes);
        const receipt = {
            schemaVersion: 1,
            format,
            child,
            sourceEntry,
            sourceSha256: hash(source),
            sha256: hash(bytes),
            bytes: bytes.length,
            externalPeers: [...externalPeers].sort(),
            physicalInputs: physicalInputs.sort((a, b) =>
                `${a.package}/${a.path}`.localeCompare(`${b.package}/${b.path}`)
            ),
            prebundledInventory:
                'See portal-map-upstream.json: complete reviewed source-map inventory is not a claim of post-tree-shake source reachability.',
            upstreamSha256: hash(readFileSync(join(vendor, 'UPSTREAM.json'))),
            licensesSha256: upstream.licensesSha256,
            adaptation:
                'Capture SDK ESM facade once; inline exact reviewed API/one direct Loader ESM closure; external React peers. Replace only NODE_ENV constant, no require/Node polyfill.',
        };
        writeFileSync(
            join(dirname(path), 'portal-map-vendor.json'),
            JSON.stringify(receipt, null, 4) + '\n'
        );
        copyFileSync(
            join(vendor, 'UPSTREAM.json'),
            join(dirname(path), 'portal-map-upstream.json')
        );
        copyFileSync(
            join(vendor, 'LICENSES.txt'),
            join(dirname(path), 'portal-map.LICENSES.txt')
        );
        receipts.push(receipt);
    }
    console.error(
        '[sdk-portal-map-bundle]',
        JSON.stringify(
            receipts.map(({ format, child, sha256, bytes }) => ({
                format,
                child,
                sha256,
                bytes,
            }))
        )
    );
    return receipts;
}
