import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    cpSync,
    mkdtempSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('a CRLF checkout preserves vendor blobs without disabling conversion outside vendor', (t) => {
    const temporary = mkdtempSync(join(tmpdir(), 'sdk-vendor-checkout-'));
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const source = join(temporary, 'source');
    const checkout = join(temporary, 'checkout');
    const prefix = checkout.replaceAll('\\', '/') + '/';
    mkdirSync(source);
    mkdirSync(checkout);
    const git = (...args) => execFileSync('git', args, { cwd: source });
    git('init', '--quiet');
    cpSync(
        new URL('../.gitattributes', import.meta.url),
        join(source, '.gitattributes')
    );
    const address = 'vendor/headlessui-address/combobox.js';
    const fixtures = {
        [address]: readFileSync(new URL(`../${address}`, import.meta.url)),
        'vendor/checkout-fixture/lf.txt': Buffer.from('one\ntwo\n'),
        'vendor/checkout-fixture/crlf.txt': Buffer.from('one\r\ntwo\r\n'),
        'vendor/checkout-fixture/mixed.txt': Buffer.from('one\r\ntwo\n'),
        'vendor/checkout-fixture/binary.dat': Buffer.from([0, 13, 10, 255, 10]),
        'ordinary.txt': Buffer.from('one\ntwo\n'),
    };
    for (const [path, bytes] of Object.entries(fixtures)) {
        const destination = join(source, path);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, bytes);
    }
    git(
        '-c',
        'core.autocrlf=false',
        'add',
        '--',
        '.gitattributes',
        ...Object.keys(fixtures)
    );
    git(
        '-c',
        'core.autocrlf=true',
        'checkout-index',
        '--all',
        `--prefix=${prefix}`
    );
    for (const [path, bytes] of Object.entries(fixtures)) {
        assert.deepEqual(git('cat-file', 'blob', `:${path}`), bytes, path);
        assert.deepEqual(
            readFileSync(join(checkout, path)),
            path === 'ordinary.txt' ? Buffer.from('one\r\ntwo\r\n') : bytes,
            path
        );
    }
});

test('a CRLF checkout preserves pinned Portal and Form fixture generator bytes', (t) => {
    const temporary = mkdtempSync(join(tmpdir(), 'sdk-fixture-checkout-'));
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const source = join(temporary, 'source');
    const checkout = join(temporary, 'checkout');
    const prefix = checkout.replaceAll('\\', '/') + '/';
    mkdirSync(source);
    mkdirSync(checkout);
    const git = (...args) => execFileSync('git', args, { cwd: source });
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    git('init', '--quiet');

    const fixtures = new URL('../test/fixtures/', import.meta.url);
    const pins = new Map();
    for (const name of readdirSync(fixtures, { recursive: true })) {
        if (!name.endsWith('.json')) continue;
        const fixture = JSON.parse(
            readFileSync(join(fileURLToPath(fixtures), name), 'utf8')
        );
        const provenance = fixture?.provenance ?? fixture;
        if (provenance?.generatorSha256 == null) continue;
        // This older fixture stores the pin, but its test supplies the path.
        const path =
            name === 'sessionRestorationCanonical.json'
                ? 'scripts/generate-session-restoration-fixtures.mjs'
                : provenance.generator;
        assert.match(path, /^scripts\/[a-z0-9-]+\.mjs$/, name);
        assert.equal(
            pins.get(path) ?? provenance.generatorSha256,
            provenance.generatorSha256,
            name
        );
        pins.set(path, provenance.generatorSha256);
    }
    for (const path of [
        'scripts/generate-portal-filter-fixtures.mjs',
        'scripts/generate-form-page-fixtures.mjs',
        'scripts/generate-conditional-page-validation-fixtures.mjs',
        'scripts/generate-linked-projection-fixtures.mjs',
        'scripts/generate-session-restoration-fixtures.mjs',
    ]) {
        assert(pins.has(path), path);
    }

    cpSync(
        new URL('../.gitattributes', import.meta.url),
        join(source, '.gitattributes')
    );
    mkdirSync(join(source, 'scripts'));
    const ordinary = 'scripts/ordinary.mjs';
    const ordinaryBytes = Buffer.from('export {};\n');
    writeFileSync(join(source, ordinary), ordinaryBytes);
    for (const [path, expected] of pins) {
        const bytes = readFileSync(new URL(`../${path}`, import.meta.url));
        assert.equal(hash(bytes), expected, `source: ${path}`);
        writeFileSync(join(source, path), bytes);
    }
    git('-c', 'core.autocrlf=false', 'add', '--', '.gitattributes', 'scripts');
    git(
        '-c',
        'core.autocrlf=true',
        'checkout-index',
        '--all',
        `--prefix=${prefix}`
    );
    for (const [path, expected] of pins) {
        const blob = git('cat-file', 'blob', `:${path}`);
        const bytes = readFileSync(join(checkout, path));
        assert.equal(hash(blob), expected, `index: ${path}`);
        assert.equal(hash(bytes), expected, `CRLF checkout: ${path}`);
        assert.deepEqual(bytes, blob, path);
    }
    assert.deepEqual(git('cat-file', 'blob', `:${ordinary}`), ordinaryBytes);
    assert.deepEqual(
        readFileSync(join(checkout, ordinary)),
        Buffer.from('export {};\r\n')
    );
});
