import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
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
import { Script } from 'node:vm';
import test from 'node:test';
import {
    assertDocumentPDFBundle,
    bundleDocumentPDF,
} from './document-pdf-bundle.mjs';

async function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'sdk-pdf-child-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    symlinkSync(
        join(process.cwd(), 'node_modules'),
        join(root, 'node_modules'),
        'dir'
    );
    for (const format of ['esm', 'cjs']) {
        const directory = join(root, 'dist', format, 'react/document-preview');
        mkdirSync(directory, { recursive: true });
        writeFileSync(
            join(directory, 'pdfEngineRuntime.js'),
            format === 'esm'
                ? "export {getDocument,PDFWorker,version} from 'pdfjs-dist/legacy/build/pdf.mjs';\n"
                : "const api=require('pdfjs-dist/legacy/build/pdf.mjs');exports.getDocument=api.getDocument;exports.PDFWorker=api.PDFWorker;exports.version=api.version;\n"
        );
    }
    return { root, receipt: await bundleDocumentPDF(root) };
}

test('both private PDF formats are self-contained browser adapters with exact input provenance', async (t) => {
    const { root, receipt } = await fixture(t);
    assert.equal(receipt.outputs.length, 2);
    assert.deepEqual(assertDocumentPDFBundle(root), receipt);
    const cjs = readFileSync(join(root, receipt.outputs[1].path), 'utf8');
    new Script(cjs);
    assert.doesNotMatch(cjs, /@napi-rs\/canvas|getBuiltinModule/);
});
test('private PDF modules fit the unchanged archive-proof capture budget', async (t) => {
    const { root, receipt } = await fixture(t);
    const archive = join(root, 'pdf-modules.tgz');
    execFileSync('tar', [
        '-czf',
        archive,
        '-C',
        root,
        ...receipt.outputs.map((output) => output.path),
    ]);
    for (const output of receipt.outputs) {
        assert(
            output.size <= 1024 * 1024,
            `${output.format} PDF module exceeds the existing 1 MiB archive capture`
        );
        assert.deepEqual(
            execFileSync('tar', ['-xOf', archive, output.path]),
            readFileSync(join(root, output.path))
        );
    }
});
test('both private PDF formats retain the exact pinned upstream license notice', async (t) => {
    const { root, receipt } = await fixture(t);
    const require = createRequire(import.meta.url);
    const notice = readFileSync(
        require.resolve('pdfjs-dist/legacy/build/pdf.mjs'),
        'utf8'
    ).match(/^\/\*\*[\s\S]*?\*\//)[0];
    assert.match(notice, /Copyright 2024 Mozilla Foundation/);
    assert.match(notice, /@licstart[\s\S]*@licend/);
    for (const output of receipt.outputs) {
        assert(
            readFileSync(join(root, output.path), 'utf8').startsWith(notice),
            `${output.format} must retain the unchanged upstream notice`
        );
    }
});
test('changed private PDF output and redirected receipt paths are refused', async (t) => {
    const { root, receipt } = await fixture(t);
    const path = join(root, receipt.outputs[0].path);
    const bytes = readFileSync(path);
    writeFileSync(path, Buffer.concat([bytes, Buffer.from('\nvoid 1;')]));
    assert.throws(() => assertDocumentPDFBundle(root));
    writeFileSync(path, bytes);
    receipt.outputs[0].path = '../outside.js';
    writeFileSync(
        join(
            root,
            'dist/esm/react/document-preview/pdfEngineRuntime.receipt.json'
        ),
        JSON.stringify(receipt)
    );
    assert.throws(() => assertDocumentPDFBundle(root));
});
