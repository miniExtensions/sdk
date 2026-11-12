import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import {
    admitsDocumentThumbnail,
    copyDocumentSource,
    decodeDocumentTIFF,
    documentMedia,
    loadDocumentSource,
    parseDocumentCSV,
} from '../src/react/document-preview/documentContent.js';
import { localDocumentAsset } from '../src/react/document-preview/DocumentPDF.js';
import { documentPDFResourcePath } from '../src/react/document-preview/pdfResources.js';

it('admits only version-pinned PDF resource names, never document-selected local paths', () => {
    assert.equal(
        documentPDFResourcePath(
            'standardFontDataUrl',
            'LiberationSans-Regular.ttf'
        ),
        'standard_fonts/LiberationSans-Regular.ttf'
    );
    for (const [kind, name] of [
        ['other', 'file'],
        ['cMapUrl', '../private'],
        ['wasmUrl', 'unknown.wasm'],
        ['standardFontDataUrl', 'private.json'],
        ['cMapUrl', {}],
    ])
        assert.equal(documentPDFResourcePath(kind, name), null);
});

const fixtures = JSON.parse(
    readFileSync('scripts/fixtures/document-thumbnail.json', 'utf8')
) as Record<string, string>;

it('compares worker/resource origins against actual document URL despite a foreign base', () => {
    const document = {
        URL: 'https://owned.test/page',
        baseURI: 'https://other.test/base/',
    } as Document;
    assert.equal(localDocumentAsset('worker.mjs', document), null);
    assert.equal(
        localDocumentAsset('https://owned.test/worker.mjs', document),
        'https://owned.test/worker.mjs'
    );
    for (const value of [
        null,
        '',
        'data:text/javascript,unsafe',
        'blob:owned',
        'https://user:pass@owned.test/worker',
        'https://owned.test/worker#fragment',
    ])
        assert.equal(localDocumentAsset(value, document), null);
});

for (const [mime, media] of [
    ['text/plain', 'text'],
    ['text/csv', 'csv'],
    ['text/html', 'html'],
    ['image/tiff', 'tiff'],
    ['application/pdf', 'pdf'],
    ['image/png', 'image'],
    ['image/jpeg', 'image'],
    ['image/bmp', 'image'],
    ['image/gif', 'image'],
]) {
    it(`admits native thumbnail ${mime} without a provider renderer`, () => {
        assert.equal(documentMedia(mime)?.media, media);
        assert.equal(documentMedia(`${mime}; charset=utf-8`)?.media, media);
    });
}

it('refuses unknown, Office, octet-stream and malformed MIME without coercion', () => {
    for (const mime of [
        null,
        undefined,
        {},
        'application/octet-stream',
        'application/msword',
        'application/zip',
        'image/svg+xml',
    ])
        assert.equal(documentMedia(mime), null);
});

it('retains whole-URI native form/grid/icon exclusions', () => {
    assert.equal(
        admitsDocumentThumbnail('https://owned.test/file.pdf', false, false),
        false
    );
    assert.equal(
        admitsDocumentThumbnail('https://owned.test/file.pdf', true, false),
        true
    );
    assert.equal(
        admitsDocumentThumbnail('https://owned.test/file.PDF', false, false),
        true
    );
    assert.equal(
        admitsDocumentThumbnail('https://owned.test/file.docx', true, false),
        false
    );
    assert.equal(
        admitsDocumentThumbnail(
            'https://owned.test/file.docx?opaque',
            true,
            false
        ),
        true
    );
    assert.equal(
        admitsDocumentThumbnail('https://owned.test/opaque', true, true),
        false
    );
});

it('copies admitted byte views rather than retaining mutable source storage', () => {
    const backing = new Uint8Array([0, 65, 66, 0]);
    const value = copyDocumentSource({
        kind: 'bytes',
        revision: {},
        mimeType: 'text/plain',
        bytes: backing.subarray(1, 3),
    });
    backing[1] = 90;
    assert.deepEqual(Array.from(value!.bytes), [65, 66]);
    assert.equal(
        copyDocumentSource({
            kind: 'bytes',
            revision: {},
            mimeType: 'application/octet-stream',
            bytes: backing,
        }),
        null
    );
});

it('uses the native CSV parser contract with literal quoted fields', async () => {
    assert.deepEqual(await parseDocumentCSV(fixtures.csv), [
        ['Name', 'Value'],
        ['First, row', '<img src=x onerror=alert(1)>'],
        ['Second', 'a"b'],
    ]);
});

it('rejects malformed CSV instead of displaying a partial parse', async () => {
    await assert.rejects(parseDocumentCSV('Name,Value\n"unterminated,value'));
});

for (const name of ['tiff', 'packBitsTiff']) {
    it(`decodes the native ${name} first-directory pixel subset`, async () => {
        const image = await decodeDocumentTIFF(
            Buffer.from(fixtures[name], 'base64')
        );
        assert.equal(image.width, 2);
        assert.equal(image.height, 1);
        assert.deepEqual(
            Array.from(image.rgba),
            [255, 0, 0, 255, 0, 0, 255, 255]
        );
    });
}

it('does not acquire fetch authority for a retired preloaded source', async () => {
    const value = await loadDocumentSource(
        'https://owned.test/document',
        {
            kind: 'bytes',
            revision: {},
            mimeType: 'text/plain',
            bytes: new Uint8Array([65]),
        },
        new AbortController(),
        () => false
    );
    assert.equal(value, null);
});
