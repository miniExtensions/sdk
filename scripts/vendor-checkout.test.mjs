import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    cpSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

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
