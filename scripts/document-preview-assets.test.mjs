import assert from 'node:assert/strict';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
    assertDocumentAssets,
    copyDocumentAssets,
    documentAssetDirectory,
    documentAssetPaths,
} from './document-preview-assets.mjs';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'sdk-document-assets-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    symlinkSync(
        join(process.cwd(), 'node_modules'),
        join(root, 'node_modules'),
        'dir'
    );
    copyDocumentAssets(root);
    return root;
}
test('version-matched local worker and all font/CMap/WASM assets have exact immutable bytes', (t) => {
    const root = fixture(t);
    assert.equal(assertDocumentAssets(root).size, 4692045);
    assert.equal(documentAssetPaths(root).length, 203);
});
test('a modified worker cannot enter the module/packed receipt', (t) => {
    const root = fixture(t);
    writeFileSync(
        join(root, documentAssetDirectory, 'pdf.worker.mjs'),
        'postMessage("different worker");'
    );
    assert.throws(() => assertDocumentAssets(root), /exact PDF.js version/);
});
test('self-attested modified manifest is rejected', (t) => {
    const root = fixture(t);
    const path = join(root, documentAssetDirectory, 'asset-manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.version = 'different';
    writeFileSync(path, JSON.stringify(manifest));
    assert.throws(() => assertDocumentAssets(root));
});
test('unexpected executable or resource assets are rejected', (t) => {
    const root = fixture(t);
    mkdirSync(join(root, documentAssetDirectory, 'extra'));
    writeFileSync(
        join(root, documentAssetDirectory, 'extra/provider.js'),
        'external()'
    );
    assert.throws(() => assertDocumentAssets(root), /exact PDF.js version/);
});
test('resource symlinks are rejected', (t) => {
    const root = fixture(t);
    symlinkSync(
        join(root, documentAssetDirectory, 'LICENSE'),
        join(root, documentAssetDirectory, 'extra')
    );
    assert.throws(() => assertDocumentAssets(root), /symlinks/);
});
