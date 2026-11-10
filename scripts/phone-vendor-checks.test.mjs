import assert from 'node:assert/strict';
import {
    cpSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
    unlinkSync,
    symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertPhoneVendor } from './phone-vendor-checks.mjs';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'sdk-phone-vendor-test-'));
    const directory = join(root, 'phone');
    cpSync('vendor/phone-number-input', directory, { recursive: true });
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return { root, directory };
}

test('checks the complete frozen private Phone closure without importing it', () => {
    assert.deepEqual(assertPhoneVendor(), {
        packages: 8,
        runtimeFiles: 111,
        privateFiles: 146,
        rewrites: 34,
        external: ['react'],
    });
});

test('refuses changed adapted runtime bytes', (t) => {
    const { directory } = fixture(t);
    const file = join(
        directory,
        'packages/react-phone-number-input/commonjs/InputSmart.js'
    );
    writeFileSync(
        file,
        readFileSync(file, 'utf8') + '\n// unexpected change\n'
    );
    assert.throws(
        () => assertPhoneVendor(directory),
        /Changed Phone vendor file/
    );
});

test('refuses changed frozen metadata bytes', (t) => {
    const { directory } = fixture(t);
    const file = join(
        directory,
        'packages/libphonenumber-js/metadata.min.json'
    );
    writeFileSync(file, '{}');
    assert.throws(
        () => assertPhoneVendor(directory),
        /Changed Phone vendor file/
    );
});

test('refuses an unlisted runtime file', (t) => {
    const { directory } = fixture(t);
    writeFileSync(join(directory, 'unexpected.js'), 'module.exports = null;\n');
    assert.throws(
        () => assertPhoneVendor(directory),
        /Unexpected Phone vendor file/
    );
});

test('refuses a source symlink without following it', (t) => {
    const { root, directory } = fixture(t);
    const file = join(
        directory,
        'packages/libphonenumber-js/metadata.min.json'
    );
    const ownedTarget = join(root, 'owned-target.json');
    writeFileSync(ownedTarget, '{}');
    unlinkSync(file);
    symlinkSync(ownedTarget, file);
    assert.throws(
        () => assertPhoneVendor(directory),
        /Unsafe Phone vendor file/
    );
});

test('refuses semantic-layer preimage corruption', (t) => {
    const { directory } = fixture(t);
    const path = join(directory, 'ADAPTATIONS.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const file = data.changedUpstreamFiles.find(
        (entry) => entry.semanticEdits?.length
    );
    file.semanticEdits[0].originalLiteral += '\n';
    writeFileSync(path, JSON.stringify(data));
    assert.throws(
        () => assertPhoneVendor(directory),
        /Wrong semantic Phone preimage/
    );
});

test('refuses altered owned facade history', (t) => {
    const { directory } = fixture(t);
    const path = join(directory, 'ADAPTATIONS.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    data.ownedFileChanges[0].previousSha256 = '0'.repeat(64);
    writeFileSync(path, JSON.stringify(data));
    assert.throws(
        () => assertPhoneVendor(directory),
        /Wrong owned Phone history preimage/
    );
});

test('refuses missing owned facade history with unchanged current bytes', (t) => {
    const { directory } = fixture(t);
    const path = join(directory, 'ADAPTATIONS.json');
    const facadePath = join(directory, 'sdk-runtime.d.ts');
    const currentFacade = readFileSync(facadePath);
    const data = JSON.parse(readFileSync(path, 'utf8'));
    data.ownedFileChanges = [];
    writeFileSync(path, JSON.stringify(data));
    assert.deepEqual(readFileSync(facadePath), currentFacade);
    assert.throws(
        () => assertPhoneVendor(directory),
        /Missing required owned Phone evolution/
    );
});

test('refuses a bare React edge without changing the frozen source bytes', (t) => {
    const { directory } = fixture(t);
    const path = join(directory, 'ADAPTATIONS.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const edge = data.runtimeEdges.find((item) =>
        item.target?.endsWith('/react-peer.js')
    );
    edge.specifier = 'react';
    edge.external = true;
    delete edge.target;
    writeFileSync(path, JSON.stringify(data));
    assert.throws(
        () => assertPhoneVendor(directory),
        /Private Phone runtime must receive React through its bound peer/
    );
});

test('refuses missing owned lazy runtime history with unchanged current bytes', (t) => {
    const { directory } = fixture(t);
    const path = join(directory, 'ADAPTATIONS.json');
    const runtimePath = join(directory, 'sdk-runtime.js');
    const current = readFileSync(runtimePath);
    const data = JSON.parse(readFileSync(path, 'utf8'));
    data.ownedFileChanges = data.ownedFileChanges.filter(
        (item) => item.path !== 'sdk-runtime.js'
    );
    writeFileSync(path, JSON.stringify(data));
    assert.deepEqual(readFileSync(runtimePath), current);
    assert.throws(
        () => assertPhoneVendor(directory),
        /Missing required owned Phone evolution/
    );
});
