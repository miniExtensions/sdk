import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    cpSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const documentPDFVersion = '6.5.438';
export const documentAssetExport = `./react/document-preview/pdfjs-${documentPDFVersion}/*`;
export const documentAssetDirectory = `dist/vendor/document-preview/pdfjs-${documentPDFVersion}`;
export const documentAssetMapping = `./${documentAssetDirectory}/*`;
export const documentAssetDigest =
    '2e56dc6ec99ac40f5e565081619e9e4ce465285442242899b3953a576ef206b4';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function inventory(root) {
    const files = [];
    function walk(directory, prefix = '') {
        for (const name of readdirSync(directory).sort()) {
            const path = join(directory, name);
            const relative = prefix + name;
            const stat = lstatSync(path);
            assert(
                !stat.isSymbolicLink(),
                'Document assets must not be symlinks'
            );
            if (stat.isDirectory()) walk(path, relative + '/');
            else {
                assert(stat.isFile(), 'Document asset must be regular');
                if (relative !== 'asset-manifest.json') {
                    const bytes = readFileSync(path);
                    files.push({
                        path: relative,
                        size: bytes.length,
                        sha256: sha(bytes),
                    });
                }
            }
        }
    }
    walk(root);
    return files.sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    );
}

export function assertDocumentAssets(root) {
    const directory = join(root, documentAssetDirectory);
    const files = inventory(directory);
    const digest = sha(JSON.stringify(files));
    assert.equal(
        digest,
        documentAssetDigest,
        'Document asset bytes must match exact PDF.js version'
    );
    assert.deepEqual(
        JSON.parse(
            readFileSync(join(directory, 'asset-manifest.json'), 'utf8')
        ),
        { version: documentPDFVersion, digest, files }
    );
    return {
        path: './' + documentAssetDirectory,
        size: files.reduce((n, file) => n + file.size, 0),
        sha256: digest,
    };
}

export function copyDocumentAssets(root = process.cwd()) {
    const require = createRequire(join(root, 'package.json'));
    const source = dirname(require.resolve('pdfjs-dist/package.json'));
    assert.equal(
        JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version,
        documentPDFVersion
    );
    const directory = join(root, documentAssetDirectory);
    mkdirSync(directory, { recursive: true });
    for (const folder of ['cmaps', 'standard_fonts', 'wasm'])
        cpSync(join(source, folder), join(directory, folder), {
            recursive: true,
        });
    copyFileSync(
        join(source, 'legacy/build/pdf.worker.min.mjs'),
        join(directory, 'pdf.worker.mjs')
    );
    copyFileSync(join(source, 'LICENSE'), join(directory, 'LICENSE'));
    const files = inventory(directory);
    const digest = sha(JSON.stringify(files));
    assert.equal(
        digest,
        documentAssetDigest,
        'Installed PDF assets must match captured exact bytes'
    );
    writeFileSync(
        join(directory, 'asset-manifest.json'),
        JSON.stringify({ version: documentPDFVersion, digest, files }) + '\n'
    );
    return assertDocumentAssets(root);
}

export function documentAssetPaths(root) {
    assertDocumentAssets(root);
    const manifest = JSON.parse(
        readFileSync(
            join(root, documentAssetDirectory, 'asset-manifest.json'),
            'utf8'
        )
    );
    return [
        documentAssetDirectory + '/asset-manifest.json',
        ...manifest.files.map(
            (file) => documentAssetDirectory + '/' + file.path
        ),
    ];
}
