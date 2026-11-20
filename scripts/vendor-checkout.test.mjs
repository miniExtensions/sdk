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

test('a CRLF checkout preserves pinned Portal and Form fixture source bytes', (t) => {
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
    // Older metadata leaves these paths in the corresponding source checks.
    const generatorPaths = {
        'sectionProjection.json':
            'scripts/generate-section-projection-fixtures.mjs',
        'sessionRestorationCanonical.json':
            'scripts/generate-session-restoration-fixtures.mjs',
    };
    const casesPaths = {
        'canonicalForms.json': 'canonicalFormCases.mjs',
        'conditionalPageValidation.json': 'conditionalPageValidationCases.mjs',
        'crossPageChoices.json': 'crossPageChoicesCases.mjs',
        'dateRanges.json': 'dateRangeCases.mjs',
        'formPages.json': 'formPageCases.mjs',
        'linkedProjection.json': 'linkedProjectionCases.mjs',
        'sectionProjection.json': 'sectionProjectionCases.mjs',
    };
    const addPin = (path, digest, name) => {
        if (digest == null) return;
        assert.match(
            path,
            /^(?:scripts\/[a-z0-9-]+|test\/fixtures\/[A-Za-z0-9-]+)\.mjs$/,
            name
        );
        assert.match(digest, /^[a-f0-9]{64}$/, name);
        assert.equal(pins.get(path) ?? digest, digest, name);
        pins.set(path, digest);
    };
    for (const name of readdirSync(fixtures, { recursive: true })) {
        if (!name.endsWith('.json')) continue;
        const fixture = JSON.parse(
            readFileSync(join(fileURLToPath(fixtures), name), 'utf8')
        );
        const provenance = fixture?.provenance ?? fixture;
        const fields = Object.fromEntries(
            Object.entries(provenance ?? {}).map(([key, value]) => [
                key.toLowerCase(),
                value,
            ])
        );
        addPin(
            fields.generator ?? generatorPaths[name],
            fields.generatorsha256,
            name
        );
        addPin(
            fields.casessource ??
                (casesPaths[name] && `test/fixtures/${casesPaths[name]}`),
            fields.casessourcesha256,
            name
        );
        addPin(
            fields.caseshelperssource ??
                (name === 'crossPageChoices.json' &&
                    'test/fixtures/conditionalPageValidationCases.mjs'),
            fields.caseshelperssourcesha256,
            name
        );
    }
    assert.equal(
        [...pins.keys()].filter((path) => path.startsWith('scripts/')).length,
        19
    );
    assert.equal(
        [...pins.keys()].filter((path) => path.startsWith('test/fixtures/'))
            .length,
        9
    );

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
        mkdirSync(dirname(join(source, path)), { recursive: true });
        writeFileSync(join(source, path), bytes);
    }
    git(
        '-c',
        'core.autocrlf=false',
        'add',
        '--',
        '.gitattributes',
        ordinary,
        ...pins.keys()
    );
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
