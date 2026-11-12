import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';

const version = '6.5.438';
const engineSha256 =
    '2792b7c390ad6d5f4245d326b70deebbc990fa4bcac691412f6df886abb9e867';
const licenseSha256 =
    '93db28d6b86557c97d8320d1a317882c5a6f4f9862862412c6676e8a9ef76ca3';
const child = 'react/document-preview/pdfEngineRuntime.js';
const archiveCaptureBudget = 1024 * 1024;
const receiptPath =
    'dist/esm/react/document-preview/pdfEngineRuntime.receipt.json';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function pinnedLicense(source) {
    const notice = source.match(/^\/\*\*[\s\S]*?\*\//)?.[0];
    assert(
        notice,
        'Private PDF module must retain its upstream license notice'
    );
    assert.equal(
        sha(Buffer.from(notice)),
        licenseSha256,
        'Private PDF license notice must match the pinned upstream bytes'
    );
    return notice;
}

export async function bundleDocumentPDF(root = process.cwd()) {
    root = resolve(root);
    const require = createRequire(join(root, 'package.json'));
    const input = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    const original = readFileSync(input, 'utf8');
    assert.equal(
        JSON.parse(
            readFileSync(require.resolve('pdfjs-dist/package.json'), 'utf8')
        ).version,
        version
    );
    assert.equal(
        sha(Buffer.from(original)),
        engineSha256,
        'PDF engine source must match pinned immutable input'
    );
    const license = pinnedLicense(original);
    const environmentLine = /^const isNodeJS = [^\n]+;$/gm;
    assert.equal([...original.matchAll(environmentLine)].length, 1);
    // Specialize the one verified environment binding through esbuild's
    // identifier substitution, including references inside private factories.
    let browserSource = original.replace(environmentLine, '');
    // This adapter uses named ESM exports and an explicitly owned worker port.
    // Keep the upstream convenience registrations local so importing it cannot
    // replace another field's document-library globals.
    for (const [registration, local] of [
        ['globalThis.pdfjsLib =', 'const __sdkPDFExports ='],
        ['globalThis._pdfjsTestingUtils =', 'const __sdkPDFTestingUtils ='],
    ]) {
        assert.equal(browserSource.split(registration).length, 2);
        browserSource = browserSource.replace(registration, local);
    }
    const outputs = [];
    for (const [directory, format] of [
        ['esm', 'esm'],
        ['cjs', 'cjs'],
    ]) {
        const output = join(root, 'dist', directory, child);
        const result = await build({
            absWorkingDir: root,
            stdin: {
                contents: readFileSync(output, 'utf8'),
                resolveDir: dirname(output),
                sourcefile: output,
                loader: 'js',
            },
            bundle: true,
            platform: 'browser',
            format,
            target: 'es2022',
            define: {
                isNodeJS: 'false',
                process: 'undefined',
                'globalThis.process': 'undefined',
            },
            plugins: [
                {
                    name: 'pdf-browser-environment',
                    setup(bundle) {
                        bundle.onLoad({ filter: /.*/ }, (args) =>
                            realpathSync(args.path) === realpathSync(input)
                                ? {
                                      contents: browserSource,
                                      loader: 'js',
                                      resolveDir: dirname(input),
                                  }
                                : undefined
                        );
                    },
                },
            ],
            minifySyntax: true,
            minifyWhitespace: true,
            banner: { js: license },
            outfile: output,
            write: false,
            metafile: true,
            legalComments: 'inline',
        });
        assert.deepEqual(
            result.warnings,
            [],
            'PDF browser adapter must build without warnings'
        );
        const inputs = Object.keys(result.metafile.inputs).map((path) =>
            realpathSync(resolve(root, path))
        );
        assert(inputs.includes(realpathSync(input)));
        assert(
            inputs.every(
                (path) =>
                    path === realpathSync(input) ||
                    path === realpathSync(output)
            ),
            'PDF adapter must have a closed two-file input set'
        );
        const bytes = result.outputFiles[0].contents;
        assert(
            bytes.length <= archiveCaptureBudget,
            'Private PDF module must fit the existing archive-proof capture budget'
        );
        assert(
            !/getBuiltinModule|@napi-rs\/canvas/.test(
                Buffer.from(bytes).toString('utf8')
            ),
            'Browser adapter must not retain native Node runtime dependencies'
        );
        writeFileSync(output, bytes);
        outputs.push({
            format,
            path: `dist/${directory}/${child}`,
            size: bytes.length,
            sha256: sha(bytes),
        });
    }
    const receipt = {
        version,
        engineSha256,
        licenseSha256,
        browserOnly: true,
        specialization: 'browser-isNodeJS-false',
        globalRegistration: 'private-named-exports',
        outputs,
    };
    writeFileSync(join(root, receiptPath), JSON.stringify(receipt) + '\n');
    return assertDocumentPDFBundle(root);
}

export function assertDocumentPDFBundle(root) {
    const receipt = JSON.parse(readFileSync(join(root, receiptPath), 'utf8'));
    assert.equal(receipt.version, version);
    assert.equal(receipt.engineSha256, engineSha256);
    assert.equal(receipt.licenseSha256, licenseSha256);
    assert.equal(receipt.browserOnly, true);
    assert.equal(receipt.specialization, 'browser-isNodeJS-false');
    assert.equal(receipt.globalRegistration, 'private-named-exports');
    assert.equal(receipt.outputs.length, 2);
    for (const [index, format] of ['esm', 'cjs'].entries()) {
        const entry = receipt.outputs[index];
        assert.equal(entry.format, format);
        assert.equal(entry.path, `dist/${format}/${child}`);
        const bytes = readFileSync(join(root, entry.path));
        pinnedLicense(bytes.toString('utf8'));
        assert(
            !/globalThis\.(?:pdfjsLib|_pdfjsTestingUtils)\s*=/.test(
                bytes.toString('utf8')
            ),
            'Private PDF adapter must preserve unrelated document-library globals'
        );
        assert(
            bytes.length <= archiveCaptureBudget,
            'Private PDF module exceeds the existing archive-proof capture budget'
        );
        assert.equal(bytes.length, entry.size);
        assert.equal(
            sha(bytes),
            entry.sha256,
            'Private PDF adapter bytes must match its build receipt'
        );
    }
    return receipt;
}
