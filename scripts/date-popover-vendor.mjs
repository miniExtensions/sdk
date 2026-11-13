import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    existsSync,
    readFileSync,
    realpathSync,
    writeFileSync,
    mkdirSync,
} from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { build } from 'esbuild';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function packageFor(input) {
    for (
        let directory = dirname(realpathSync(input));
        ;
        directory = dirname(directory)
    ) {
        const file = join(directory, 'package.json');
        if (existsSync(file)) {
            const manifest = JSON.parse(readFileSync(file));
            if (manifest.name) return { directory, manifest };
        }
        assert.notEqual(directory, dirname(directory));
    }
}

/** Freeze and bundle the actual Radix dependency closure; renderers stay external. */
export async function bundleDatePopover(root = process.cwd(), capture = false) {
    root = resolve(root);
    const receiptPath = join(root, 'vendor/date-popover/UPSTREAM.json');
    const expected = capture ? null : JSON.parse(readFileSync(receiptPath));
    const captured = {};
    let licenses = '';
    const licensed = new Set();
    for (const format of ['esm', 'cjs']) {
        const file = join(root, `dist/${format}/react/datePopoverRuntime.js`);
        const result = await build({
            stdin: {
                contents: readFileSync(file, 'utf8'),
                resolveDir: dirname(file),
                sourcefile: 'datePopoverRuntime.js',
            },
            absWorkingDir: root,
            platform: 'neutral',
            format,
            target: 'es2022',
            bundle: true,
            write: false,
            metafile: true,
            external: ['react/*', 'react-dom/*'],
            mainFields:
                format === 'esm' ? ['module', 'main'] : ['main', 'module'],
            plugins: [
                {
                    name: 'external-react-peers',
                    setup(builder) {
                        builder.onResolve(
                            { filter: /^(react|react-dom)$/ },
                            (args) =>
                                format === 'esm' && args.kind === 'require-call'
                                    ? {
                                          path: args.path,
                                          namespace: 'date-peer',
                                      }
                                    : { path: args.path, external: true }
                        );
                        builder.onLoad(
                            { filter: /.*/, namespace: 'date-peer' },
                            (args) => ({
                                contents: `export * from '${args.path}'; import * as peer from '${args.path}'; export default peer;`,
                                loader: 'js',
                            })
                        );
                    },
                },
            ],
        });
        const inputs = {};
        const packages = new Set();
        for (const input of Object.keys(result.metafile.inputs)) {
            if (input.startsWith('date-peer:') || resolve(root, input) === file)
                continue;
            const path = realpathSync(resolve(root, input));
            const { directory, manifest } = packageFor(path);
            assert(
                !['react', 'react-dom', '@miniextensions/sdk'].includes(
                    manifest.name
                ),
                'Only popup dependencies may be bundled'
            );
            const key = `${manifest.name}@${manifest.version}/${relative(directory, path)}`;
            inputs[key] = hash(readFileSync(path));
            if (packages.has(manifest.name)) continue;
            packages.add(manifest.name);
            assert(
                ['MIT', 'ISC', '0BSD'].includes(manifest.license),
                manifest.name
            );
            const licenseFile = [
                'LICENSE',
                'LICENSE.txt',
                'LICENSE.md',
                'license',
            ].find((name) => existsSync(join(directory, name)));
            // Small Radix packages omit the root license from their npm files.
            // Retain the actual repository MIT notice with those package inputs.
            const repositoryLicense = manifest.name.startsWith('@radix-ui/')
                ? 'RADIX-LICENSE.txt'
                : manifest.name === 'react-remove-scroll-bar'
                  ? 'SCROLLBAR-LICENSE.txt'
                  : null;
            assert(
                licenseFile ||
                    (repositoryLicense && manifest.license === 'MIT'),
                `Missing license: ${manifest.name}`
            );
            const license = readFileSync(
                licenseFile
                    ? join(directory, licenseFile)
                    : join(root, 'vendor/date-popover', repositoryLicense),
                'utf8'
            );
            inputs[
                `${manifest.name}@${manifest.version}/${licenseFile ?? 'repository-LICENSE'}`
            ] = hash(license);
            if (!licensed.has(manifest.name))
                licenses += `${manifest.name}@${manifest.version}\n${license.replaceAll('\r\n', '\n').trimEnd()}\n\n`;
            licensed.add(manifest.name);
        }
        assert(packages.has('@radix-ui/react-popover'));
        captured[format] = inputs;
        if (!capture) {
            assert.deepEqual(
                inputs,
                expected[format],
                'Date popup closure changed; qualify supported dependency updates'
            );
            writeFileSync(file, result.outputFiles[0].contents);
            writeFileSync(
                join(dirname(file), 'complete-date.provenance.json'),
                JSON.stringify(
                    { format, external: ['react', 'react-dom'], inputs },
                    null,
                    4
                ) + '\n'
            );
            writeFileSync(
                join(dirname(file), 'complete-date.LICENSES.txt'),
                readFileSync(join(root, 'vendor/date-popover/LICENSES.txt'))
            );
        }
    }
    if (capture) {
        mkdirSync(dirname(receiptPath), { recursive: true });
        writeFileSync(receiptPath, JSON.stringify(captured, null, 4) + '\n');
        writeFileSync(
            join(dirname(receiptPath), 'LICENSES.txt'),
            licenses.trimEnd() + '\n'
        );
    }
}
if (process.argv[2] === '--capture')
    await bundleDatePopover(process.cwd(), true);
