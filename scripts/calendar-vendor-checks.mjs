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
const aliases = {
    'react-aria': 'calendar-react-aria',
    'react-stately': 'react-stately',
    '@internationalized/date': '@internationalized/date',
};
const peerNamespace = 'calendar-esm-peer';
const peerPattern = /^(?:react|react-dom)(?:\/.*)?$/;
const peerFacade = (name) =>
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
            'Calendar dependency package root missing'
        );
    }
}

function verifyPackage(root, manifest, expected) {
    assert(expected, `Unreviewed Calendar dependency: ${manifest.name}`);
    assert.equal(manifest.version, expected.version, manifest.name);
    assert.equal(manifest.license, expected.license, manifest.name);
    assert.match(expected.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
    assert(Object.keys(expected.licenseFiles).length > 0);
    for (const [name, digest] of Object.entries(expected.licenseFiles)) {
        const path = join(root, name);
        assert(
            lstatSync(path).isFile(),
            'Calendar license must be a regular file'
        );
        assert.equal(
            hash(readFileSync(path)),
            digest,
            `${manifest.name}/${name}`
        );
    }
}

/** Source qualification only: pinned inputs, complete notices and exact root APIs. */
export function assertCalendarVendor(root = process.cwd()) {
    root = resolve(root);
    const provenanceRoot = join(root, 'vendor/calendar');
    const upstream = json(join(provenanceRoot, 'UPSTREAM.json'));
    assert.equal(upstream.schemaVersion, 1);
    const licenses = join(provenanceRoot, 'LICENSES.txt');
    assert(
        lstatSync(licenses).isFile(),
        'Calendar notices must be a regular file'
    );
    assert.equal(hash(readFileSync(licenses)), upstream.licensesSha256);
    const require = createRequire(join(root, 'package.json'));
    for (const [name, alias] of Object.entries(aliases)) {
        assert.equal(
            upstream.upstream.versions[name],
            upstream.allowedPackages[name]?.version
        );
        const dependency = packageFor(require.resolve(alias));
        assert.equal(
            dependency.manifest.name,
            name,
            'Calendar alias resolved another package'
        );
        verifyPackage(
            dependency.root,
            dependency.manifest,
            upstream.allowedPackages[name]
        );
        const entries = upstream.rootEntrySha256[name];
        assert(
            entries && Object.keys(entries).length > 0,
            `Missing Calendar API hashes: ${name}`
        );
        for (const [entry, digest] of Object.entries(entries)) {
            const path = join(dependency.root, entry);
            assert(
                lstatSync(path).isFile(),
                'Calendar API input must be a regular file'
            );
            assert.equal(hash(readFileSync(path)), digest, `${name}/${entry}`);
        }
    }
    return upstream;
}

/**
 * Inline the reviewed shared Calendar runtime closure only. The ordinary SDK core consumer
 * keeps React optional, while both Calendar formats use the consumer's peers.
 */
export async function bundleCalendar(root = process.cwd()) {
    root = resolve(root);
    const upstream = assertCalendarVendor(root);
    const provenanceRoot = join(root, 'vendor/calendar');
    // Capture the compiler's ESM source before the first output replaces it.
    // Its static imports let both output formats retain only reachable hooks;
    // the upstream CommonJS barrel eagerly evaluates unrelated UI modules.
    const sourceEntry = 'dist/esm/react/CalendarRuntime.js';
    const sourcePath = join(root, sourceEntry);
    const source = readFileSync(sourcePath, 'utf8');
    const receipts = [];
    for (const format of ['esm', 'cjs']) {
        const child = `dist/${format}/react/CalendarRuntime.js`;
        const path = join(root, child);
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
            external: ['react/*', 'react-dom/*'],
            legalComments: 'inline',
            plugins: [
                {
                    name: 'calendar-external-react-peers',
                    setup(builder) {
                        builder.onResolve({ filter: peerPattern }, (args) =>
                            format === 'esm' && args.kind === 'require-call'
                                ? { path: args.path, namespace: peerNamespace }
                                : { path: args.path, external: true }
                        );
                        builder.onLoad(
                            { filter: peerPattern, namespace: peerNamespace },
                            (args) => ({
                                contents: peerFacade(args.path),
                                loader: 'js',
                            })
                        );
                    },
                },
            ],
        });
        const packages = new Map();
        const inputs = [];
        const externalPeers = new Set(['react', 'react-dom']);
        for (const name of Object.keys(result.metafile.inputs)) {
            if (resolve(root, name) === sourcePath) continue;
            if (name.startsWith(`${peerNamespace}:`)) {
                assert.equal(format, 'esm');
                const peer = name.slice(peerNamespace.length + 1);
                assert(peerPattern.test(peer));
                externalPeers.add(peer);
                inputs.push({
                    package: peer,
                    path: 'sdk-owned-esm-peer-facade',
                    adaptation:
                        'CommonJS peer require to explicit external ESM namespace',
                    sha256: hash(peerFacade(peer)),
                });
                continue;
            }
            const input = realpathSync(resolve(root, name));
            const dependency = packageFor(input);
            assert.notEqual(
                dependency.manifest.name,
                '@miniextensions/sdk',
                'Calendar bundle must not absorb another SDK module'
            );
            assert(
                !peerPattern.test(dependency.manifest.name),
                'React and React DOM must remain external'
            );
            const expected = upstream.allowedPackages[dependency.manifest.name];
            verifyPackage(dependency.root, dependency.manifest, expected);
            packages.set(dependency.manifest.name, {
                name: dependency.manifest.name,
                version: dependency.manifest.version,
                license: dependency.manifest.license,
                integrity: expected.integrity,
                archiveUrl: expected.archiveUrl,
                sourceUrl: expected.sourceUrl,
                licenseFiles: expected.licenseFiles,
            });
            inputs.push({
                package: dependency.manifest.name,
                path: relative(dependency.root, input).replaceAll('\\', '/'),
                sha256: hash(readFileSync(input)),
            });
        }
        for (const name of Object.keys(aliases))
            assert(
                packages.has(name),
                `Selected Calendar package missing: ${name}`
            );
        for (const output of Object.values(result.metafile.outputs)) {
            for (const entry of output.imports) {
                assert(
                    peerPattern.test(entry.path),
                    `Non-peer Calendar dependency escaped bundle: ${entry.path}`
                );
                externalPeers.add(entry.path);
            }
        }
        assert.equal(result.outputFiles.length, 1);
        const bytes = result.outputFiles[0].contents;
        writeFileSync(path, bytes);
        const receipt = {
            schemaVersion: 1,
            child,
            sourceEntry,
            sourceSha256: hash(source),
            sha256: hash(bytes),
            external: [...externalPeers].sort(),
            adaptation:
                format === 'esm'
                    ? 'Compile the captured ESM Calendar runtime entry and reachable dependency closure. Only CommonJS React peer require calls use an SDK-owned external ESM namespace facade; no global require or Node polyfill.'
                    : 'Convert the captured ESM Calendar runtime entry and reachable dependency closure to CommonJS; React peer calls remain ordinary external imports.',
            packages: [...packages.values()].sort((a, b) =>
                a.name.localeCompare(b.name)
            ),
            inputs: inputs.sort((a, b) =>
                `${a.package}/${a.path}`.localeCompare(`${b.package}/${b.path}`)
            ),
            licensesSha256: upstream.licensesSha256,
        };
        writeFileSync(
            join(root, `dist/${format}/react/calendar-vendor.json`),
            JSON.stringify(receipt, null, 4) + '\n'
        );
        copyFileSync(
            join(provenanceRoot, 'LICENSES.txt'),
            join(root, `dist/${format}/react/calendar.LICENSES.txt`)
        );
        receipts.push({
            format,
            child,
            sourceEntry,
            sourceSha256: receipt.sourceSha256,
            sha256: receipt.sha256,
            packages: receipt.packages,
        });
    }
    console.error('[sdk-calendar-bundle]', JSON.stringify(receipts));
    return receipts;
}
